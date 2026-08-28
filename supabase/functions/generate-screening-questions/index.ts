/**
 * generate-screening-questions
 *
 * Input: { jd: string, criteria: [{name, weight?, notes?}], candidateProfile: string,
 *          requisitionTitle?: string, candidateName?: string }
 * Output: { ok, questions: [{ criterion, question, why_ask, red_flags[] }] }
 *
 * The prompt asks Claude to write recruiter-usable screening questions per
 * criterion, calibrated to what the candidate's résumé actually claims and
 * what the JD requires. Returns 3-5 questions per criterion by default.
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

  let body: { jd?: string; criteria?: Array<{ name: string; weight?: number; notes?: string }>; candidateProfile?: string; requisitionTitle?: string; candidateName?: string } = {};
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ ok: false, error: 'bad json' }), { status: 400, headers: corsHeaders }); }
  const jd = (body.jd || '').trim();
  const criteria = Array.isArray(body.criteria) ? body.criteria : [];
  const profile = (body.candidateProfile || '').trim();
  if (!jd || criteria.length === 0 || !profile) {
    return new Response(JSON.stringify({ ok: false, error: 'jd, criteria (non-empty), and candidateProfile required' }), { status: 400, headers: corsHeaders });
  }

  const criteriaBlock = criteria.map((c, i) => `${i + 1}. ${c.name}${c.weight ? ` (weight ${c.weight})` : ''}${c.notes ? ` — ${c.notes}` : ''}`).join('\n');

  const prompt = `You are Simpliigence's recruiter-screening AI. Generate screening questions a phone screen recruiter can use to evaluate this candidate against these criteria for this role.

REQUISITION: ${body.requisitionTitle || '(unspecified)'}
CANDIDATE: ${body.candidateName || '(unspecified)'}

JOB DESCRIPTION:
"""
${jd}
"""

SCREENING CRITERIA (ordered by priority; higher weight = more important):
${criteriaBlock}

CANDIDATE PROFILE / RÉSUMÉ:
"""
${profile}
"""

Return ONLY a JSON object with this exact shape (no code fences):
{
  "questions": [
    {
      "criterion": "<exact criterion name from the list above>",
      "question": "<open-ended question the recruiter should ask>",
      "why_ask": "<1-sentence rationale — what specifically about the JD or the candidate's claims makes this question worth asking>",
      "red_flags": ["<specific answer patterns that would be a bad sign>", "..."]
    }
  ]
}

Rules:
- Produce 3-5 questions per criterion. Higher-weight criteria get 4-5, lower get 3.
- Questions must reference specifics from either the JD or the candidate profile — no generic questions.
- Prefer behavioral / STAR-style ("Tell me about a time...") over hypothetical for skills; direct probes for gaps or inconsistencies where the résumé is vague or over-claimed.
- red_flags: 2-3 concrete answer patterns per question (not generic like "vague answer" — say what specifically).
- Do NOT wrap the JSON in code fences or add prose outside it.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!resp.ok) throw new Error(`Claude ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
    const json = await resp.json();
    const raw = json.content?.[0]?.text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude did not return JSON.');
    const parsed = JSON.parse(match[0]);
    return new Response(JSON.stringify({ ok: true, questions: parsed.questions ?? [] }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message.slice(0, 500) }), { status: 500, headers: corsHeaders });
  }
});
