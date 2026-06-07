/**
 * Supabase Edge Function: vapi-webhook
 *
 * Receives Vapi call lifecycle events. We care about:
 *   - status-update         → keep candidate_calls.status fresh (dialing → in-progress → completed)
 *   - end-of-call-report    → final transcript, duration, cost, recording URL.
 *     On this event we ALSO ask Claude to extract structured answers from
 *     the transcript and write them back to candidate + call rows.
 *
 * verify_jwt is intentionally DISABLED on this function — Vapi has no way to
 * present a Supabase JWT. We instead validate authenticity by looking up the
 * provider_call_id in our DB; unknown call ids are rejected.
 *
 * Required secrets:
 *   ANTHROPIC_API_KEY   — for the post-call extraction step (already used by parse-resume)
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const CLAUDE_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const EXTRACT_SYSTEM = `You receive a transcript of a recruitment screening phone call between an AI assistant and a job candidate. Extract structured answers and return ONLY this JSON shape. Omit fields the transcript does not give a confident answer for.

{
  "name_confirmed": boolean | null,
  "confirmed_name": string,
  "current_employer": string,
  "current_location": string,
  "willing_to_relocate": boolean | null,
  "current_ctc_inr": number | null,
  "expected_ctc_inr": number | null,
  "notice_period_days": number | null,
  "engagement": "engaged" | "rushed" | "declined" | null,
  "overall_summary": string
}

Rules:
  - CTC values: convert to INR per annum. A candidate saying "20 LPA" → 2000000. "10 lakhs" → 1000000. "1.2 crore" → 12000000. If they only gave monthly, multiply by 12.
  - Notice period: convert to integer days. "2 months" → 60. "30 days" → 30. "1 month" → 30. "immediate" → 0. "3 weeks" → 21.
  - willing_to_relocate: true / false / null based on what they actually said. Don't guess.
  - engagement reflects the tone of the call, NOT the answers. "engaged" = thoughtful answers; "rushed" = short / one-word; "declined" = refused to answer multiple questions or hung up.
  - overall_summary: 2–3 sentences, third person, factual, suitable for a recruiter to scan.
  - No prose around the JSON. No markdown fences.`;

async function extractAnswers(transcript: string): Promise<Record<string, unknown> | null> {
  if (!ANTHROPIC_API_KEY) return null;
  if (!transcript || !transcript.trim()) return null;
  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: [{ type: 'text', text: EXTRACT_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Transcript:\n\n${transcript}` }],
    }),
  });
  if (!res.ok) {
    console.warn('[vapi-webhook] extract failed:', await res.text());
    return null;
  }
  const json = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const reply = json.content?.find((b) => b.type === 'text')?.text?.trim() || '';
  const cleaned = reply.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flattenTranscript(payload: any): string {
  // Vapi sends either `transcript: "..."` (full text) OR `messages: [{role, message}, ...]`
  if (typeof payload?.transcript === 'string') return payload.transcript;
  if (Array.isArray(payload?.messages)) {
    return payload.messages
      .map((m: { role?: string; message?: string }) => `${m.role || '?'}: ${m.message || ''}`)
      .join('\n');
  }
  if (Array.isArray(payload?.artifact?.messages)) {
    return payload.artifact.messages
      .map((m: { role?: string; message?: string }) => `${m.role || '?'}: ${m.message || ''}`)
      .join('\n');
  }
  return '';
}

/** Map Vapi end-call reasons to our internal status. */
function mapEndedReason(reason: string | undefined): 'completed' | 'no-answer' | 'failed' | 'cancelled' {
  if (!reason) return 'completed';
  const r = reason.toLowerCase();
  if (r.includes('customer-did-not-answer') || r.includes('no-answer')) return 'no-answer';
  if (r.includes('customer-hung-up') || r.includes('assistant-ended-call')) return 'completed';
  if (r.includes('cancelled') || r.includes('canceled')) return 'cancelled';
  if (r.includes('failed') || r.includes('error') || r.includes('twilio')) return 'failed';
  return 'completed';
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = await req.json() as any;
    // Vapi nests the event under .message in recent SDK versions.
    const msg = body?.message || body;
    const type = msg?.type as string | undefined;
    const call = msg?.call || {};
    const providerCallId: string | undefined = call?.id || msg?.call?.id;
    const metadata = call?.metadata || msg?.metadata || {};
    const ourCallId: string | undefined = metadata?.candidate_call_id;

    if (!providerCallId && !ourCallId) {
      // Not enough info to correlate — ack and drop.
      return new Response(JSON.stringify({ ok: true, ignored: 'no call id' }), { headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find the row by provider_call_id (preferred) or by our id (fallback)
    let { data: row } = await supabase
      .from('candidate_calls')
      .select('id, candidate_id, status')
      .eq('provider_call_id', providerCallId || '')
      .maybeSingle();
    if (!row && ourCallId) {
      const r = await supabase.from('candidate_calls').select('id, candidate_id, status').eq('id', ourCallId).maybeSingle();
      row = r.data;
    }
    if (!row) {
      // Unknown call — ack and move on (might be a Vapi test ping).
      return new Response(JSON.stringify({ ok: true, ignored: 'unknown call' }), { headers: corsHeaders });
    }

    // ── status-update: keep our row's status fresh ──
    if (type === 'status-update' || type === 'call.in-progress' || type === 'call.dialing' || type === 'call.ringing') {
      const newStatus =
        msg?.status === 'in-progress' ? 'in-progress'
        : msg?.status === 'ringing' ? 'ringing'
        : msg?.status === 'queued' ? 'queued'
        : type === 'call.in-progress' ? 'in-progress'
        : type === 'call.ringing' ? 'ringing'
        : null;
      if (newStatus) {
        await supabase.from('candidate_calls').update({ status: newStatus, updated_by: 'vapi' }).eq('id', row.id);
      }
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    }

    // ── end-of-call-report: this is the meat ──
    if (type === 'end-of-call-report' || type === 'call.ended' || type === 'call.end') {
      const transcript = flattenTranscript(msg?.artifact || msg);
      const recordingUrl: string | undefined =
        msg?.artifact?.recordingUrl
        || msg?.recordingUrl
        || msg?.call?.recordingUrl;
      const durationSec: number | undefined =
        msg?.durationSeconds || msg?.duration || msg?.artifact?.durationSeconds;
      const costUsd: number | undefined = msg?.cost || call?.cost;
      const endedReason = msg?.endedReason || call?.endedReason;
      const status = mapEndedReason(endedReason);

      const extracted = transcript ? await extractAnswers(transcript) : null;

      // Update the call row
      const callPatch: Record<string, unknown> = {
        status,
        transcript: transcript || null,
        recording_url: recordingUrl ?? null,
        duration_sec: durationSec ?? null,
        cost_usd: costUsd ?? null,
        ended_at: new Date().toISOString(),
        updated_by: 'vapi',
      };
      if (extracted) callPatch.extracted_answers = extracted;
      await supabase.from('candidate_calls').update(callPatch).eq('id', row.id);

      // Patch candidate row with extracted answers (only fill blanks; never
      // overwrite a TA's hand-typed values without explicit intent)
      if (extracted && row.candidate_id) {
        const { data: candNow } = await supabase
          .from('india_staffing_candidates')
          .select('current_employer, current_ctc_inr, expected_ctc_inr, notice_period_days, willing_to_relocate')
          .eq('id', row.candidate_id)
          .single();
        const candPatch: Record<string, unknown> = {
          latest_call_summary: typeof extracted.overall_summary === 'string' ? extracted.overall_summary : null,
          latest_call_at: new Date().toISOString(),
          updated_by: 'vapi',
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const e = extracted as any;
        if (!candNow?.current_employer && typeof e.current_employer === 'string') candPatch.current_employer = e.current_employer;
        if (candNow?.current_ctc_inr == null && typeof e.current_ctc_inr === 'number') candPatch.current_ctc_inr = e.current_ctc_inr;
        if (candNow?.expected_ctc_inr == null && typeof e.expected_ctc_inr === 'number') candPatch.expected_ctc_inr = e.expected_ctc_inr;
        if (candNow?.notice_period_days == null && typeof e.notice_period_days === 'number') candPatch.notice_period_days = e.notice_period_days;
        if (candNow?.willing_to_relocate == null && typeof e.willing_to_relocate === 'boolean') candPatch.willing_to_relocate = e.willing_to_relocate;
        await supabase.from('india_staffing_candidates').update(candPatch).eq('id', row.candidate_id);
      }

      return new Response(JSON.stringify({ ok: true, extracted: !!extracted }), { headers: corsHeaders });
    }

    // Other event types we don't care about → ack
    return new Response(JSON.stringify({ ok: true, type }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[vapi-webhook]', msg);
    // Always ack 200 to Vapi to prevent retry storms; log the issue.
    return new Response(JSON.stringify({ ok: false, error: msg }), { headers: corsHeaders });
  }
});
