/**
 * Supabase Edge Function: structure-connect-notes
 *
 * Powers the "AI organize" button on the Accounts page (India Demand →
 * Accounts → Add Connect). Takes the rep's raw notes (+ optionally a
 * recording path) and turns them into a clean structured connect record:
 *   { discussion, outcome, actionItems[] }
 *
 * Required secrets:
 *   ANTHROPIC_API_KEY   — Anthropic console key with messages access
 *
 * Optional (either one enables audio transcription; Deepgram is preferred):
 *   DEEPGRAM_API_KEY    — Deepgram key. Uses nova-3 model, cheaper + faster
 *                         than Whisper, and the format we standardized on.
 *   OPENAI_API_KEY      — OpenAI key. Used as a fallback if Deepgram fails
 *                         or if only OpenAI is configured. Whisper-1 model.
 *
 * If neither is set and an audioPath is supplied, the function returns a
 * clear error and the client should paste the notes as text instead.
 *
 * Request body:
 *   { accountName?: string, connectType?: 'sales' | 'delivery',
 *     text?: string, audioPath?: string }
 *
 * Response:
 *   { ok: true, transcript: string, discussion: string, outcome: string,
 *     actionItems: Array<{ title, description, owner_email|null, due_date|null }> }
 *   or { error: string, detail?: string } on 4xx/5xx.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global provided by edge runtime
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh resolves at runtime in Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const DEEPGRAM_API_KEY = env('DEEPGRAM_API_KEY');
const OPENAI_API_KEY = env('OPENAI_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;

const CLAUDE_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true';
const WHISPER_API_URL = 'https://api.openai.com/v1/audio/transcriptions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface ActionItem {
  title: string;
  description: string;
  owner_email: string | null;
  due_date: string | null;
}

interface StructuredResult {
  discussion: string;
  outcome: string;
  actionItems: ActionItem[];
}

const SYSTEM_PROMPT = `You are a sales/delivery operations assistant. The user pastes raw notes (or an audio transcript) from a customer connect / meeting. Turn it into a clean structured summary.

Return ONLY valid JSON in this exact shape:
{
  "discussion": "...",      // 3-6 sentences covering what was discussed. Past-tense, professional, NO bullet points.
  "outcome": "...",         // 1-3 sentences on where things landed: agreed direction, next decision point, or open question. Past/present tense.
  "actionItems": [          // 0-8 concrete next actions. ONLY actual commitments — not generic "follow up". Skip if none.
    {
      "title": "Short imperative phrase (≤8 words)",
      "description": "1-2 sentences expanding on what to do and why",
      "owner_email": null,  // best-guess email if a name appears in the notes that matches a known pattern, else null
      "due_date": null      // ISO YYYY-MM-DD if a date is stated (e.g. "by Friday" → next Friday), else null
    }
  ]
}

Rules:
  - The discussion and outcome must be a polished narrative, not bullet points.
  - Don't invent details that aren't in the notes. If the notes are sparse, the output is sparse.
  - actionItems must be concrete and SPECIFIC. "Send proposal" is OK; "follow up" is too vague — skip it.
  - No markdown, no code fences, no prose outside the JSON object.`;

/** Transcribe audio via Deepgram (primary, nova-3). Throws if the key is
 *  missing or the API call fails. */
async function transcribeWithDeepgram(audioBlob: Blob): Promise<string> {
  if (!DEEPGRAM_API_KEY) throw new Error('DEEPGRAM_API_KEY not set');
  const contentType = audioBlob.type || 'audio/webm';
  const res = await fetch(DEEPGRAM_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Token ${DEEPGRAM_API_KEY}`,
      'Content-Type': contentType,
    },
    body: audioBlob,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Deepgram API failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  const data = await res.json() as {
    results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
  };
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
  if (!transcript) throw new Error('Deepgram returned an empty transcript');
  return transcript;
}

/** Transcribe audio via OpenAI Whisper. Used only as fallback if Deepgram
 *  fails or isn't configured. Throws if the key is missing or the API call
 *  fails. */
async function transcribeWithWhisper(audioBlob: Blob, filename: string): Promise<string> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  const form = new FormData();
  form.append('file', audioBlob, filename);
  form.append('model', 'whisper-1');
  form.append('response_format', 'text');
  const res = await fetch(WHISPER_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Whisper API failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  return (await res.text()).trim();
}

/** Transcribe an audio blob using whichever provider is configured. Prefers
 *  Deepgram (cheaper, faster, standardized here); falls back to Whisper if
 *  Deepgram errors and Whisper is available. Throws a clear message if
 *  neither is configured. */
async function transcribeAudio(audioBlob: Blob, filename: string): Promise<string> {
  if (!DEEPGRAM_API_KEY && !OPENAI_API_KEY) {
    throw new Error(
      'Audio transcription requires DEEPGRAM_API_KEY (preferred) or OPENAI_API_KEY on this Supabase project. Paste the notes as text instead.',
    );
  }
  const errors: string[] = [];
  if (DEEPGRAM_API_KEY) {
    try {
      return await transcribeWithDeepgram(audioBlob);
    } catch (e) {
      const msg = (e as Error).message;
      console.warn('[structure-connect-notes] Deepgram failed, will try Whisper if available:', msg);
      errors.push(`Deepgram: ${msg}`);
    }
  }
  if (OPENAI_API_KEY) {
    try {
      return await transcribeWithWhisper(audioBlob, filename);
    } catch (e) {
      errors.push(`Whisper: ${(e as Error).message}`);
    }
  }
  throw new Error(`All transcription providers failed — ${errors.join(' | ')}`);
}

/** Ask Claude to structure the raw text into {discussion, outcome, actionItems}. */
async function organizeWithClaude(rawText: string, accountName?: string, connectType?: string): Promise<StructuredResult> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY secret is not set on this Supabase project');
  }
  const contextLines: string[] = [];
  if (accountName) contextLines.push(`Account: ${accountName}`);
  if (connectType) contextLines.push(`Connect type: ${connectType}`);
  const prefix = contextLines.length > 0 ? `${contextLines.join('\n')}\n\n` : '';

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `${prefix}Raw notes:\n${rawText}` }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const reply = json.content?.find((b) => b.type === 'text')?.text?.trim() || '';
  const cleaned = reply.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let parsed: StructuredResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Claude returned non-JSON: ${reply.slice(0, 400)}`);
  }
  return {
    discussion: typeof parsed.discussion === 'string' ? parsed.discussion.trim() : '',
    outcome: typeof parsed.outcome === 'string' ? parsed.outcome.trim() : '',
    actionItems: Array.isArray(parsed.actionItems)
      ? parsed.actionItems.slice(0, 8).map((a) => ({
          title: typeof a?.title === 'string' ? a.title.trim() : '',
          description: typeof a?.description === 'string' ? a.description.trim() : '',
          owner_email: typeof a?.owner_email === 'string' && a.owner_email.trim() ? a.owner_email.trim().toLowerCase() : null,
          due_date: typeof a?.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.due_date) ? a.due_date : null,
        })).filter((a) => a.title)
      : [],
  };
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    const { accountName, connectType, text, audioPath } = await req.json() as {
      accountName?: string;
      connectType?: 'sales' | 'delivery';
      text?: string;
      audioPath?: string;
    };

    if (!text?.trim() && !audioPath) {
      return new Response(JSON.stringify({
        error: 'Provide either text notes or an audioPath (or both).',
      }), { status: 400, headers: corsHeaders });
    }

    // 1. If an audio file is attached, download + transcribe it.
    let transcript = '';
    if (audioPath) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: file, error: dlErr } = await supabase.storage
        .from('account-recordings')
        .download(audioPath);
      if (dlErr || !file) {
        return new Response(JSON.stringify({
          error: 'Could not download recording',
          detail: dlErr?.message,
        }), { status: 500, headers: corsHeaders });
      }
      const ext = audioPath.toLowerCase().split('.').pop() || 'webm';
      const filename = `recording.${ext}`;
      try {
        transcript = await transcribeAudio(file, filename);
      } catch (e) {
        return new Response(JSON.stringify({
          error: (e as Error).message,
        }), { status: 502, headers: corsHeaders });
      }
    }

    // 2. Build the raw text to organize — typed text + transcript.
    const raw = [text?.trim(), transcript.trim()].filter(Boolean).join('\n\n');
    if (!raw) {
      return new Response(JSON.stringify({
        error: 'Nothing to organize (text + transcript were both empty).',
      }), { status: 400, headers: corsHeaders });
    }

    // 3. Ask Claude to structure it.
    const structured = await organizeWithClaude(raw, accountName, connectType);

    return new Response(JSON.stringify({
      ok: true,
      transcript,
      discussion: structured.discussion,
      outcome: structured.outcome,
      actionItems: structured.actionItems,
    }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[structure-connect-notes]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
