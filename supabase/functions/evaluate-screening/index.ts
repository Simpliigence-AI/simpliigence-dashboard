/**
 * evaluate-screening
 *
 * Input: { jd, criteria, candidateProfile, generatedQuestions, transcript }
 * Output: { ok, evaluation: {
 *   overall_score: 0-100,
 *   overall_recommendation: 'strong_yes'|'yes'|'no'|'strong_no',
 *   per_criterion: [{ name, score (0-100), evidence[], gaps[], summary }],
 *   summary: string,
 *   next_steps: string[]
 * }}
 *
 * The prompt asks Claude to grade each criterion by pulling verbatim
 * excerpts from the transcript as evidence, not general impressions.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />
// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);
const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const CLAUDE_MODEL = 'claude-sonnet-4-5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY missing' }), { status: 500, headers: corsHeaders });

  interface RecruiterObs { verbal_fluency?: number; confidence?: number; energy?: number; structured_thinking?: number; cultural_warmth?: number; notes?: string }
  let body: { jd?: string; criteria?: Array<{ name: string; weight?: number; notes?: string }>; candidateProfile?: string; generatedQuestions?: unknown[]; transcript?: string; requisitionTitle?: string; candidateName?: string; roleFocus?: string; recruiterObservations?: RecruiterObs } = {};
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ ok: false, error: 'bad json' }), { status: 400, headers: corsHeaders }); }
  const jd = (body.jd || '').trim();
  const criteria = Array.isArray(body.criteria) ? body.criteria : [];
  const profile = (body.candidateProfile || '').trim();
  const transcript = (body.transcript || '').trim();
  const roleFocus = (body.roleFocus || '').trim();
  const obs = body.recruiterObservations || {};
  if (!jd || criteria.length === 0 || !profile || !transcript) {
    return new Response(JSON.stringify({ ok: false, error: 'jd, criteria, candidateProfile, transcript all required' }), { status: 400, headers: corsHeaders });
  }
  const obsBlock = Object.keys(obs).length === 0
    ? '(recruiter did not submit observations)'
    : `- Verbal fluency: ${obs.verbal_fluency ?? 'n/a'} / 5\n- Confidence: ${obs.confidence ?? 'n/a'} / 5\n- Energy: ${obs.energy ?? 'n/a'} / 5\n- Structured thinking: ${obs.structured_thinking ?? 'n/a'} / 5\n- Cultural warmth: ${obs.cultural_warmth ?? 'n/a'} / 5\n- Notes: ${obs.notes || '(none)'}`;
  const truncatedTranscript = transcript.length > 40000 ? transcript.slice(0, 40000) + '\n[...truncated at 40k chars]' : transcript;

  const criteriaBlock = criteria.map((c, i) => `${i + 1}. ${c.name}${c.weight ? ` (weight ${c.weight})` : ''}${c.notes ? ` — ${c.notes}` : ''}`).join('\n');

  const prompt = `You are Simpliigence's recruiter-screening AI. Grade this candidate on CONTENT ONLY (what they said) using VERBATIM excerpts from the transcript. Delivery (fluency, confidence, energy, body language) came from a human recruiter — you must use those observations as-provided, NOT infer them from the transcript.

REQUISITION: ${body.requisitionTitle || '(unspecified)'}
CANDIDATE: ${body.candidateName || '(unspecified)'}
ROLE FOCUS: ${roleFocus || '(none)'}

JOB DESCRIPTION:
"""
${jd}
"""

CRITERIA (weight matters — higher weight contributes more to overall_score):
${criteriaBlock}

CANDIDATE PROFILE / RÉSUMÉ:
"""
${profile}
"""

SCREENING TRANSCRIPT (recruiter's phone/video screen — either literal transcript or the recruiter's notes):
"""
${truncatedTranscript}
"""

RECRUITER OBSERVATIONS (post-call ratings the recruiter made from watching/hearing the call — you cannot see body language or hear tone, so treat these as authoritative for delivery):
${obsBlock}

Return ONLY a JSON object with this exact shape (no code fences):
{
  "overall_score": 0-100,
  "overall_recommendation": "strong_yes" | "yes" | "no" | "strong_no",
  "per_criterion": [
    {
      "name": "<exact criterion name>",
      "score": 0-100,
      "evidence": ["<verbatim quote from transcript that supports the score>", "..."],
      "gaps": ["<what wasn't demonstrated or was contradicted>", "..."],
      "summary": "<1-sentence assessment>"
    }
  ],
  "delivery_assessment": {
    "summary": "<2-3 sentences summarizing the recruiter's delivery ratings — fluency, confidence, energy, structured thinking, warmth>",
    "avg_score": 0-100
  },
  "summary": "<3-5 sentence overall read — content strengths, delivery from recruiter, risks, JD calibration>",
  "next_steps": ["<concrete action e.g. 'Send technical assessment on X'>", "..."]
}

CRITICAL RULES:

1. CONTENT vs DELIVERY separation:
   - Content criteria (technical skills, domain knowledge, problem-solving, relevant experience): grade from the TRANSCRIPT with verbatim evidence.
   - Delivery criteria if any are in the criteria list (communication skills, cultural fit, energy, confidence): use the RECRUITER OBSERVATIONS. Map 1-5 → 0-100 as: 1=20, 2=40, 3=60, 4=80, 5=95. Evidence = the recruiter's own notes if any; otherwise state "Recruiter rated X/5 for {aspect}".
   - Do NOT try to infer tone, pace, body language, confidence, or emotional cues from a transcript. If a delivery criterion has no recruiter rating, mark it "unrated" in gaps and score conservatively (60).

2. TECHNICAL DEPTH BAR:
   - Judge technical answers by senior-practitioner standards, not by whether the candidate used the right jargon. A confident-sounding answer that gets a governor limit wrong, misidentifies a Salesforce feature, or describes an AWS service incorrectly is a LOW score, even if fluent.
   - Score high only when the candidate demonstrates specific, correct, decision-oriented knowledge (tradeoffs, gotchas, config-level detail) — not textbook definitions.

3. EVIDENCE:
   - evidence[] for content criteria must be verbatim from the transcript. If nothing in the transcript addresses a criterion, evidence=[] and gaps must call that out. Do not fabricate quotes.
   - If a claim in the résumé was directly probed and the answer contradicted or hand-waved, call that out explicitly.

4. SCORING:
   - overall_score = weighted average across per_criterion. Respect the criterion weights.
   - Recommendation cutoffs: strong_yes ≥85, yes 70-84, no 50-69, strong_no <50.
   - A short or off-topic transcript = low confidence + low overall_score with an honest summary. Do not inflate.

5. delivery_assessment must always be present. If no recruiter observations provided, say so and use avg_score=60 (neutral placeholder).

6. Do NOT wrap the JSON in code fences.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 8000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!resp.ok) throw new Error(`Claude ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
    const json = await resp.json();
    const raw = json.content?.[0]?.text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude did not return JSON.');
    const parsed = JSON.parse(match[0]);
    return new Response(JSON.stringify({ ok: true, evaluation: parsed }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message.slice(0, 500) }), { status: 500, headers: corsHeaders });
  }
});
