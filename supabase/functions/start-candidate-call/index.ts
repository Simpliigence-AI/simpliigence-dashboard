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
  /** Concatenated role / JD facts from the linked requisition (may be empty). */
  roleContext: string;
}): string {
  const filledOpening = opts.openingScript
    .replaceAll('{{candidate_name}}', opts.candidateName || 'there')
    .replaceAll('{{role_title}}', opts.roleTitle || 'the role we are screening for');

  const questionsText = opts.questions
    .map((q, i) => `${i + 1}. ${q.prompt}`)
    .join('\n');

  return `You are a screening recruiter from Simpligence (India IT consulting). A real human-sounding conversation, NOT a robotic survey. 2–3 minute call total.

# Pronunciation (CRITICAL — keep saying it right every time)
The company name is spelled "Simpliigence" but pronounced as if it were written "Simpligence" — "SIM-pli-jens", three syllables, last syllable rhymes with "fence" / "sense" / "intelligence". It's literally "simple" + "intelligence" meshed together. Whenever the brand comes out of your mouth, say it that way. In any text you generate that goes to TTS, ALWAYS write it as "Simpligence" (no double-i, no hyphen). Never write "Simpliigence" verbatim in a sentence — the TTS will mis-stress it.

# Pace / voice
Clear, neutral Indian English. Unhurried. Distinct enunciation. No filler. After each candidate answer, take a beat — don't rush straight into the next question.

# WAITING — most important rule
Wait for the candidate to FINISH their thought before you respond. If they pause mid-sentence (thinking, breathing, searching for a word), DO NOT jump in. A two-second pause is normal human conversation, not a cue to talk. Never speak while they are speaking. If you accidentally overlap, immediately stop and let them finish.

# Opening (verbatim, then pause)
${filledOpening}

# If not a good time
Brief apology, end the call using the closing line.

# Otherwise — cover these 4 topics IN ORDER
${questionsText}

# How to actually have the conversation (not a survey)
For EACH of the 4 topics, the flow is:
  1. Ask the question — pick natural phrasing, don't read verbatim.
  2. Listen to the answer.
  3. If their answer was vague or interesting, ask ONE short natural follow-up. Examples:
       Candidate: "I'm in Bangalore."        → "Got it. How long have you been there?"
       Candidate: "I work at Wipro."         → "Nice. What's your current role there?"
       Candidate: "12 LPA"                   → "Thanks. And what are you looking for in the new role?"
       Candidate: "2 months notice."         → "Okay. Is that negotiable, or fixed?"
       Candidate: "I want 30 LPA"            → "Got it. Is that base, or including bonus?"
     ONE follow-up max. Don't dig further. Move on.
  4. Brief acknowledgement ("Got it" / "Thanks" / "Makes sense" / "Okay" — vary it). One word or two, not a sentence.
  5. Transition to the next topic naturally.

DO NOT recap. DO NOT summarize what they just said. DO NOT stack two questions.

# When candidate asks YOU something (during the 4 topics)
NEVER say "Should I continue?" — it's annoying when repeated. Briefly answer their question using the ROLE CONTEXT below if it covers the answer, otherwise say a recruiter will share, then smoothly move to your next topic. Examples:
  - "What's the role?" → answer with the role title + 1-sentence summary from ROLE CONTEXT, then "Let me ask about [next topic]…"
  - "Where is it?" → if Location is in ROLE CONTEXT, give the city. Else "A recruiter will share the exact location."
  - "Office or hybrid?" → only if ROLE CONTEXT explicitly mentions work mode. Else "A recruiter will confirm the work mode."
  - "What's the salary range?" → "The recruiter will share that — they have the latest range."
  - Something not in ROLE CONTEXT → "A recruiter can confirm that. Meanwhile, [next topic]?"
  - "Are you a human?" → "I'm an AI assistant from Simpligence doing a quick screening — a recruiter follows up afterwards." (then continue)
Reserve "Should I continue?" for ONE moment only: if the candidate seems hesitant at the very start about whether they have time.

# Closing flow — DO THIS, in order
After all 4 topics are covered (or the candidate has clearly declined to share something), say something like: "Thanks. Before I let you go — do you have any quick questions for me?"
Wait. If the candidate has questions, handle them using ROLE CONTEXT below. Cap at 2–3 questions; if they keep going, say "A recruiter can answer more of these in detail — they'll be in touch shortly." Then go to the closing line.

If the candidate says "no questions" or similar, go straight to the closing line.

# ROLE CONTEXT (use ONLY this. Never invent facts.)
${opts.roleContext || '(No requisition linked. If candidate asks any role-specific question, say: "A recruiter will share those details when they follow up.")'}

# Rules for the ROLE CONTEXT
  - Do NOT recite the full job description. Summarize in 1–2 sentences if asked for the JD.
  - Do NOT name the client company unless the candidate explicitly asks "which company".
  - Do NOT make up salary ranges, perks, interview rounds, work mode, or anything else not literally in ROLE CONTEXT.
  - If something isn't in ROLE CONTEXT, the answer is always "A recruiter will share that".

# Edge cases
  - Vague salary ("decent", "competitive") → ONE polite follow-up for a number. If they still won't say, accept "I'd prefer to discuss with the recruiter" and move on.
  - "Bad time" / asks you to call back → Apologize once, use closing line, end.
  - Hostile / "stop calling" → Apologize once, use closing line, end immediately.

# Closing (after the 4 topics OR if ending early)
${opts.closingScript}

# Language
English only. Do not switch to Hindi unless the candidate speaks Hindi back.`;
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
      .select('id, name, phone, email, requisition_id')
      .eq('id', body.candidateId)
      .single();
    if (candErr || !cand) {
      return new Response(JSON.stringify({ error: 'Candidate not found', detail: candErr?.message }), { status: 404, headers: corsHeaders });
    }

    const toPhone = toE164India(cand.phone);
    if (!toPhone) {
      return new Response(JSON.stringify({ error: 'Candidate has no usable phone number on file' }), { status: 400, headers: corsHeaders });
    }

    // 1b. Look up requisition + account so the AI has context for "what's the
    // role?" / "where?" / "office or hybrid?" / "share JD" candidate questions.
    let roleContext = '';
    let resolvedRoleTitle = body.roleTitle || '';
    if (cand.requisition_id) {
      const { data: req } = await supabase
        .from('india_staffing_requisitions')
        .select('title, location, department, job_description, account_id')
        .eq('id', cand.requisition_id)
        .maybeSingle();
      if (req) {
        if (!resolvedRoleTitle) resolvedRoleTitle = req.title || resolvedRoleTitle;
        let accountName = '';
        if (req.account_id) {
          const { data: acct } = await supabase
            .from('india_staffing_accounts').select('name').eq('id', req.account_id).maybeSingle();
          accountName = acct?.name ?? '';
        }
        const parts: string[] = [];
        if (req.title) parts.push(`Role title: ${req.title}`);
        if (accountName) parts.push(`Client (do NOT name them on the call unless asked): ${accountName}`);
        if (req.location) parts.push(`Location: ${req.location}`);
        if (req.department) parts.push(`Team / department: ${req.department}`);
        if (req.job_description) {
          // Pass the full JD — the AI is told NOT to dump it; only summarize on request.
          parts.push(`Job description:\n${String(req.job_description).slice(0, 4000)}`);
        }
        if (parts.length) roleContext = parts.join('\n');
      }
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
      roleTitle: resolvedRoleTitle || 'the open role',
      openingScript: tpl.opening_script,
      closingScript: tpl.closing_script,
      questions,
      roleContext,
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
          // Slightly warmer + more varied — was 0.3, but the candidate
          // feedback was "too robotic". 0.55 still keeps it on-script but
          // varies acknowledgements and lets natural follow-ups feel less
          // canned.
          temperature: 0.55,
          messages: [{ role: 'system', content: systemPrompt }],
        },
        voice: {
          // Azure neural Indian English — clear, professional, well-paced.
          // NeerjaNeural is the most-used female Indian English voice for
          // recruitment/customer-service apps. Slightly slower (0.95) so the
          // pronunciation is unambiguous for candidates on a phone line.
          provider: 'azure',
          voiceId: 'en-IN-NeerjaNeural',
          speed: 0.95,
        },
        transcriber: {
          provider: 'deepgram',
          model: 'nova-2',
          language: 'en',
          endpointing: 500,
        },
        recordingEnabled: true,
        endCallFunctionEnabled: true,
        maxDurationSeconds: 240,
        silenceTimeoutSeconds: 30,
        // Smart endpointing — Vapi runs an LLM that looks at the transcript
        // so far and decides "is this person done?". Catches the obvious
        // "...so" trailing-off and won't interrupt during thinking pauses.
        // Way better than the fixed-silence transcriber.endpointing knob.
        startSpeakingPlan: {
          // How long after we think the user is done before the AI starts.
          waitSeconds: 0.8,
          // Use AI to detect "user is still talking" vs "user is done".
          smartEndpointingEnabled: true,
          // Fallback rules for when smart endpointing isn't confident.
          transcriptionEndpointingPlan: {
            // If the candidate's last word ended in punctuation (".?!"),
            // they're probably done — start fairly quickly.
            onPunctuationSeconds: 0.4,
            // No punctuation = likely mid-thought. Wait longer.
            onNoPunctuationSeconds: 2.0,
            // Trailing numbers ("...30 LPA") — wait, they might continue.
            onNumberSeconds: 1.0,
          },
        },
        // Candidate needs to say 5+ words to interrupt the AI mid-sentence
        // (up from 3). Filler like "yeah uh-huh okay" won't cut the AI off.
        numWordsToInterruptAssistant: 5,
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
