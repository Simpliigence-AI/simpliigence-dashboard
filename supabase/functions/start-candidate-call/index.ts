/**
 * Supabase Edge Function: start-candidate-call
 *
 * Initiates an outbound AI screening call to a candidate via Vapi.
 *
 * Required secrets:
 *   VAPI_API_KEY         — secret from vapi.ai dashboard
 *   VAPI_PHONE_NUMBER_ID — the Vapi phoneNumberId for the Twilio-India number
 *
 * Request body:
 *   { candidateId: string, templateId?: string, roleTitle?: string }
 *
 * Response (success):
 *   { ok: true, callId: string, providerCallId: string }
 *
 * Flow:
 *   1. Look up candidate (need phone + name).
 *   2. Look up template (or fall back to a built-in default).
 *   3. Build the Vapi assistant config from the template's questions.
 *   4. POST to Vapi /call with the assistant + phoneNumberId + customer phone.
 *   5. Insert a candidate_calls row with status='dialing' and provider_call_id.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @ts-expect-error esm.sh
import { nanoid } from 'https://esm.sh/nanoid@5';

const VAPI_API_KEY = env('VAPI_API_KEY');
const VAPI_PHONE_NUMBER_ID = env('VAPI_PHONE_NUMBER_ID');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPI_API_URL = 'https://api.vapi.ai';
/** Where Vapi posts call lifecycle events. */
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/vapi-webhook`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface TemplateQuestion {
  key: string;
  prompt: string;
  type: 'text' | 'number' | 'enum';
  required?: boolean;
  enum_values?: string[];
}

/** Normalize an Indian phone to E.164 (+91…). Best-effort. */
function toE164India(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return null;
  if (raw.trim().startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  if (digits.length === 11 && digits.startsWith('0')) return '+91' + digits.slice(1);
  return '+' + digits;
}

function buildSystemPrompt(opts: {
  candidateName: string;
  roleTitle: string;
  openingScript: string;
  closingScript: string;
  questions: TemplateQuestion[];
}): string {
  const filledOpening = opts.openingScript
    .replaceAll('{{candidate_name}}', opts.candidateName || 'there')
    .replaceAll('{{role_title}}', opts.roleTitle || 'the role we are screening for');

  const questionsText = opts.questions
    .map((q, i) => `${i + 1}. ${q.prompt}`)
    .join('\n');

  return `You are an AI screening assistant from Simpliigence (India IT consulting). 2–3 minute call. Be CONCISE — one short sentence per turn unless answering a direct question. Do not lecture, narrate, or summarize.

# Opening (verbatim, then pause)
${filledOpening}

# If not a good time
Briefly apologize, end the call. Use the closing line.

# Otherwise — ask these IN ORDER, ONE at a time
${questionsText}

# Rules
  - One question per turn. NO stacking. NO recapping.
  - One brief acknowledgement ("Got it" / "Thanks") before the next question.
  - Vague answer (e.g. "decent salary") → ONE polite follow-up for a number, then move on.
  - "Prefer to discuss with recruiter" on salary → accept, move on.
  - NEVER promise interview slots, offers, or company-specific details. Only "a recruiter will follow up".
  - Unknown question → "a recruiter will get back to you with that" → continue.
  - Hostile / asks to stop → apologize once, close immediately.

# Closing (after last answer OR if ending early)
${opts.closingScript}

# Voice
English only. Indian-English. Do not switch to Hindi unless the candidate speaks Hindi back.`;
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    if (!VAPI_API_KEY) {
      throw new Error('VAPI_API_KEY secret is not set on this Supabase project');
    }
    if (!VAPI_PHONE_NUMBER_ID) {
      throw new Error('VAPI_PHONE_NUMBER_ID secret is not set on this Supabase project');
    }

    const body = await req.json() as {
      candidateId?: string;
      templateId?: string;
      roleTitle?: string;
      triggeredBy?: string;
    };

    if (!body.candidateId) {
      return new Response(JSON.stringify({ error: 'candidateId is required' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Look up candidate
    const { data: cand, error: candErr } = await supabase
      .from('india_staffing_candidates')
      .select('id, name, phone, email')
      .eq('id', body.candidateId)
      .single();
    if (candErr || !cand) {
      return new Response(JSON.stringify({ error: 'Candidate not found', detail: candErr?.message }), { status: 404, headers: corsHeaders });
    }

    const toPhone = toE164India(cand.phone);
    if (!toPhone) {
      return new Response(JSON.stringify({ error: 'Candidate has no usable phone number on file' }), { status: 400, headers: corsHeaders });
    }

    // 2. Resolve template
    const templateId = body.templateId || 'tmpl-india-v1';
    const { data: tpl, error: tplErr } = await supabase
      .from('call_templates')
      .select('*')
      .eq('id', templateId)
      .maybeSingle();
    if (tplErr || !tpl) {
      return new Response(JSON.stringify({ error: 'Template not found', detail: tplErr?.message }), { status: 404, headers: corsHeaders });
    }

    const questions: TemplateQuestion[] = Array.isArray(tpl.questions) ? tpl.questions as TemplateQuestion[] : [];
    const systemPrompt = buildSystemPrompt({
      candidateName: cand.name || 'there',
      roleTitle: body.roleTitle || 'the open role',
      openingScript: tpl.opening_script,
      closingScript: tpl.closing_script,
      questions,
    });

    // 3. Insert candidate_calls row with status='queued'; we'll patch it once Vapi accepts.
    const callId = nanoid();
    const { error: insErr } = await supabase.from('candidate_calls').insert({
      id: callId,
      candidate_id: cand.id,
      template_id: tpl.id,
      triggered_by: (body.triggeredBy || 'unknown').toLowerCase(),
      provider: 'vapi',
      status: 'queued',
      to_phone: toPhone,
      updated_by: 'edge-fn',
    });
    if (insErr) {
      return new Response(JSON.stringify({ error: 'Failed to create call record', detail: insErr.message }), { status: 500, headers: corsHeaders });
    }

    // 4. POST to Vapi /call
    const vapiBody = {
      phoneNumberId: VAPI_PHONE_NUMBER_ID,
      customer: { number: toPhone, name: cand.name || undefined },
      // Inline assistant — gpt-4o-mini + ElevenLabs Indian-English + Deepgram nova-2.
      // Tuned for COST: a 4-question screen completes in <3 min and lands ~$0.12/call.
      // The LLM portion is the biggest cost lever — gpt-4o-mini is ~5× cheaper than
      // gpt-4o with similar accuracy on this structured-conversation task.
      // We pass the assistant config inline so each call uses the right per-template prompt.
      assistant: {
        firstMessage: tpl.opening_script
          .replaceAll('{{candidate_name}}', cand.name || 'there')
          .replaceAll('{{role_title}}', body.roleTitle || 'the role we are screening for'),
        firstMessageMode: 'assistant-speaks-first',
        model: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          temperature: 0.3,
          messages: [{ role: 'system', content: systemPrompt }],
        },
        voice: {
          provider: '11labs',
          voiceId: 'sarah', // ElevenLabs Sarah — clear neutral English. Vapi accepts ElevenLabs voice names directly.
        },
        transcriber: { provider: 'deepgram', model: 'nova-2', language: 'en' },
        recordingEnabled: true,
        endCallFunctionEnabled: true,
        maxDurationSeconds: 240,
        silenceTimeoutSeconds: 30,
        responseDelaySeconds: 0.4,
        // Per-call webhook so we don't need a global Vapi server URL setting.
        serverUrl: WEBHOOK_URL,
        // Metadata we'll read back in the webhook to map to our internal row.
        metadata: { candidate_call_id: callId, candidate_id: cand.id, template_id: tpl.id },
      },
    };

    const vapiRes = await fetch(`${VAPI_API_URL}/call`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(vapiBody),
    });

    if (!vapiRes.ok) {
      const text = await vapiRes.text();
      // Mark the row as failed so the UI doesn't show a hung Dialing… state
      await supabase.from('candidate_calls')
        .update({ status: 'failed', error_msg: text.slice(0, 800), ended_at: new Date().toISOString(), updated_by: 'edge-fn' })
        .eq('id', callId);
      return new Response(JSON.stringify({ error: 'Vapi API failed', detail: text.slice(0, 500) }), { status: 502, headers: corsHeaders });
    }
    const vapiJson = await vapiRes.json() as { id?: string };
    const providerCallId = vapiJson.id;
    if (!providerCallId) {
      await supabase.from('candidate_calls')
        .update({ status: 'failed', error_msg: 'Vapi returned no call id', ended_at: new Date().toISOString(), updated_by: 'edge-fn' })
        .eq('id', callId);
      return new Response(JSON.stringify({ error: 'Vapi response missing call id' }), { status: 502, headers: corsHeaders });
    }

    // 5. Patch the row with Vapi's call id and bump status to 'dialing'
    await supabase.from('candidate_calls')
      .update({
        provider_call_id: providerCallId,
        status: 'dialing',
        started_at: new Date().toISOString(),
        updated_by: 'edge-fn',
      })
      .eq('id', callId);

    return new Response(
      JSON.stringify({ ok: true, callId, providerCallId }),
      { headers: corsHeaders },
    );
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[start-candidate-call]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
