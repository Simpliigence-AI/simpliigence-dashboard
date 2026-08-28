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

  let body: { jd?: string; criteria?: Array<{ name: string; weight?: number; notes?: string }>; candidateProfile?: string; generatedQuestions?: unknown[]; transcript?: string; requisitionTitle?: string; candidateName?: string } = {};
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ ok: false, error: 'bad json' }), { status: 400, headers: corsHeaders }); }
  const jd = (body.jd || '').trim();
  const criteria = Array.isArray(body.criteria) ? body.criteria : [];
  const profile = (body.candidateProfile || '').trim();
  const transcript = (body.transcript || '').trim();
  if (!jd || criteria.length === 0 || !profile || !transcript) {
    return new Response(JSON.stringify({ ok: false, error: 'jd, criteria, candidateProfile, transcript all required' }), { status: 400, headers: corsHeaders });
  }
  const truncatedTranscript = transcript.length > 40000 ? transcript.slice(0, 40000) + '\n[...truncated at 40k chars]' : transcript;

  const criteriaBlock = criteria.map((c, i) => `${i + 1}. ${c.name}${c.weight ? ` (weight ${c.weight})` : ''}${c.notes ? ` — ${c.notes}` : ''}`).join('\n');

  const prompt = `You are Simpliigence's recruiter-screening AI. Grade this candidate against each criterion using VERBATIM excerpts from the transcript as evidence.

REQUISITION: ${body.requisitionTitle || '(unspecified)'}
CANDIDATE: ${body.candidateName || '(unspecified)'}

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

SCREENING TRANSCRIPT (recruiter's phone screen — either literal transcript or the recruiter's notes):
"""
${truncatedTranscript}
"""

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
  "summary": "<3-5 sentence overall read of the candidate — strengths, risks, and calibration to the JD>",
  "next_steps": ["<concrete action e.g. 'Send technical assessment on X'>", "..."]
}

Rules:
- overall_score is a weighted average of per_criterion scores (respect the criterion weights).
- overall_recommendation cutoffs: strong_yes ≥85, yes 70-84, no 50-69, strong_no <50.
- evidence[] must be VERBATIM quotes from the transcript. If nothing in the transcript addresses a criterion, evidence=[] and gaps must call that out.
- Do not inflate scores when evidence is thin — a criterion with no transcript coverage should score low with a gap note, not a guess.
- If the transcript is very short or off-topic, say so honestly in summary and lower overall_score accordingly.
- Do NOT wrap the JSON in code fences.`;

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
