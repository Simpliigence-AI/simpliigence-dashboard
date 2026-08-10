/**
 * Supabase Edge Function: twilio-recording
 *
 * recordingStatusCallback for dialer calls. When Twilio finishes a
 * dual-channel recording we:
 *   1. Download the mp3 from Twilio (basic-auth) and mirror it into the
 *      private `call-recordings` storage bucket (Twilio URLs are auth-gated
 *      so the UI can't play them directly).
 *   2. Transcribe with Deepgram (multichannel: ch0 = agent, ch1 = contact).
 *   3. Ask Claude for structured sales-call notes (summary, action items,
 *      objections, sentiment, next steps).
 *   4. Write everything back to the dialer_calls row.
 *
 * Deploy with --no-verify-jwt; authenticity via X-Twilio-Signature.
 *
 * Required secrets:
 *   TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN  — download recording media
 *   DEEPGRAM_API_KEY                        — transcription (already set)
 *   ANTHROPIC_API_KEY                       — AI notes (already set)
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_ACCOUNT_SID = env('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = env('TWILIO_AUTH_TOKEN');
const DEEPGRAM_API_KEY = env('DEEPGRAM_API_KEY');
const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const SKIP_SIG = env('DIALER_SKIP_TWILIO_SIG') === 'true';

const CLAUDE_MODEL = 'claude-sonnet-4-5';
const jsonHeaders = { 'Content-Type': 'application/json' };

async function validSignature(req: Request, form: URLSearchParams): Promise<boolean> {
  if (SKIP_SIG) return true;
  if (!TWILIO_AUTH_TOKEN) return false;
  const sigHeader = req.headers.get('x-twilio-signature');
  if (!sigHeader) return false;
  const u = new URL(req.url);
  const url = `${SUPABASE_URL}/functions/v1${u.pathname.replace(/^\/functions\/v1/, '')}${u.search}`;
  const keys = [...new Set([...form.keys()])].sort();
  let data = url;
  for (const k of keys) data += k + (form.get(k) ?? '');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(TWILIO_AUTH_TOKEN),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  let b64 = '';
  for (const b of new Uint8Array(sig)) b64 += String.fromCharCode(b);
  return btoa(b64) === sigHeader;
}

interface DeepgramUtterance { channel: number; transcript: string; start: number }

/** Deepgram multichannel transcription → "Agent: …\nContact: …" transcript. */
async function transcribe(audio: Uint8Array): Promise<{ text: string | null; error: string | null }> {
  if (!DEEPGRAM_API_KEY) return { text: null, error: 'DEEPGRAM_API_KEY not set' };
  if (!audio || audio.byteLength === 0) return { text: null, error: 'audio was empty (0 bytes)' };
  const params = new URLSearchParams({
    model: 'nova-2',
    smart_format: 'true',
    punctuate: 'true',
    multichannel: 'true',
    utterances: 'true',
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${DEEPGRAM_API_KEY}`, 'Content-Type': 'audio/mpeg' },
    body: audio,
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    console.warn('[twilio-recording] deepgram failed:', res.status, detail);
    return { text: null, error: `Deepgram ${res.status}: ${detail}` };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = await res.json() as any;
  const utterances: DeepgramUtterance[] | undefined = j?.results?.utterances;
  if (Array.isArray(utterances) && utterances.length) {
    // Dual-channel <Dial> recording: channel 0 is the browser (agent) leg,
    // channel 1 the dialed contact.
    const text = utterances
      .sort((a, b) => a.start - b.start)
      .map((u) => `${u.channel === 0 ? 'Agent' : 'Contact'}: ${u.transcript}`)
      .join('\n');
    return { text: text.trim() || null, error: text.trim() ? null : 'empty transcript (silent recording?)' };
  }
  const flat = j?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  const text = typeof flat === 'string' && flat.trim() ? flat.trim() : null;
  return { text, error: text ? null : 'empty transcript (silent recording?)' };
}

const NOTES_SYSTEM = `You receive the transcript of a business phone call placed by a Simpliigence (IT consulting) team member ("Agent") to an external contact ("Contact") — typically sales/BD outreach, a client check-in, or a vendor/partner conversation. Produce call notes as ONLY this JSON shape (omit list items you can't support from the transcript; never invent facts):

{
  "summary": string,              // 2-4 sentences, third person, factual
  "key_points": string[],         // the substantive things discussed
  "action_items": string[],       // concrete follow-ups, each starting with a verb; prefix owner when clear, e.g. "Agent: send MSA draft"
  "next_steps": string,           // one sentence on where this goes next, or "" if unclear
  "objections": string[],         // concerns/pushback the contact raised
  "opportunity_signals": string[],// buying signals, budget/timeline mentions, expansion hints
  "sentiment": "positive" | "neutral" | "negative",  // the contact's overall tone
  "follow_up_recommended": string // suggested timeframe like "this week" / "in 2 weeks" / "" if none
}

Rules:
  - Base everything strictly on the transcript. No speculation.
  - Keep each list item under 20 words.
  - sentiment reflects the CONTACT's receptiveness, not the agent's energy.
  - No prose around the JSON. No markdown fences.`;

async function extractNotes(transcript: string): Promise<Record<string, unknown> | null> {
  if (!ANTHROPIC_API_KEY || !transcript.trim()) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: NOTES_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Transcript:\n\n${transcript}` }],
    }),
  });
  if (!res.ok) {
    console.warn('[twilio-recording] claude failed:', (await res.text()).slice(0, 300));
    return null;
  }
  const j = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const reply = j.content?.find((b) => b.type === 'text')?.text?.trim() || '';
  const cleaned = reply.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { return null; }
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  try {
    const form = new URLSearchParams(await req.text());
    if (!(await validSignature(req, form))) {
      console.warn('[twilio-recording] rejected: bad or missing X-Twilio-Signature');
      return new Response('Forbidden', { status: 403 });
    }

    if ((form.get('RecordingStatus') || '') !== 'completed') {
      return new Response(JSON.stringify({ ok: true, ignored: 'not completed' }), { headers: jsonHeaders });
    }

    const recordingSid = form.get('RecordingSid') || '';
    const recordingUrl = form.get('RecordingUrl') || '';
    const callSid = form.get('CallSid') || '';
    const recDuration = parseInt(form.get('RecordingDuration') || '', 10);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // <Dial record> attaches the recording to the parent (browser) leg.
    let { data: row } = await supabase.from('dialer_calls')
      .select('id').eq('provider_call_sid', callSid).maybeSingle();
    if (!row) {
      const r = await supabase.from('dialer_calls')
        .select('id').eq('child_call_sid', callSid).maybeSingle();
      row = r.data;
    }
    if (!row) {
      return new Response(JSON.stringify({ ok: true, ignored: 'unknown call' }), { headers: jsonHeaders });
    }

    await supabase.from('dialer_calls').update({
      recording_sid: recordingSid,
      recording_url: recordingUrl,
      ai_status: 'transcribing',
      updated_at: new Date().toISOString(),
      updated_by: 'twilio-recording',
    }).eq('id', row.id);

    // 1. Download the mp3 from Twilio. Twilio finalizes recordings a beat
    // after the callback fires, so retry briefly on a 404.
    let audio: Uint8Array | null = null;
    if (recordingUrl && TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      for (let attempt = 0; attempt < 3 && !audio; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 1500));
        const mediaRes = await fetch(`${recordingUrl}.mp3`, {
          headers: { Authorization: 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`) },
        });
        if (mediaRes.ok) audio = new Uint8Array(await mediaRes.arrayBuffer());
        else console.warn('[twilio-recording] media download attempt', attempt, 'failed:', mediaRes.status);
      }
    }
    if (!audio) {
      await supabase.from('dialer_calls').update({
        ai_status: 'failed',
        error_msg: 'Could not download recording from Twilio',
        updated_at: new Date().toISOString(),
        updated_by: 'twilio-recording',
      }).eq('id', row.id);
      return new Response(JSON.stringify({ ok: false, error: 'download failed' }), { headers: jsonHeaders });
    }

    // 2. Transcribe FIRST (on its own copy of the bytes) so the storage
    // upload can't interfere with the buffer, then mirror to the bucket.
    const { text: transcript, error: txErr } = await transcribe(audio.slice());

    const path = `${row.id}.mp3`;
    const { error: upErr } = await supabase.storage
      .from('call-recordings')
      .upload(path, audio, { contentType: 'audio/mpeg', upsert: true });
    if (upErr) console.warn('[twilio-recording] storage upload failed:', upErr.message);

    await supabase.from('dialer_calls').update({
      recording_path: upErr ? null : path,
      transcript,
      ai_status: transcript ? 'analyzing' : 'failed',
      error_msg: transcript ? null : (txErr || 'transcription failed'),
      ...(Number.isFinite(recDuration) ? { duration_sec: recDuration } : {}),
      updated_at: new Date().toISOString(),
      updated_by: 'twilio-recording',
    }).eq('id', row.id);

    // 3. AI notes.
    let aiOk = false;
    if (transcript) {
      const notes = await extractNotes(transcript);
      aiOk = !!notes;
      await supabase.from('dialer_calls').update({
        ai_notes: notes,
        ai_status: notes ? 'done' : 'failed',
        error_msg: notes ? null : 'AI note generation failed (Claude)',
        updated_at: new Date().toISOString(),
        updated_by: 'twilio-recording',
      }).eq('id', row.id);
    }

    return new Response(JSON.stringify({ ok: true, transcribed: !!transcript, analyzed: aiOk, txErr }), { headers: jsonHeaders });
  } catch (e) {
    console.error('[twilio-recording]', (e as Error).message || String(e));
    return new Response(JSON.stringify({ ok: false }), { headers: jsonHeaders });
  }
});
