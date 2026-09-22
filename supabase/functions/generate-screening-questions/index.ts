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

  let body: { jd?: string; criteria?: Array<{ name: string; weight?: number; notes?: string }>; candidateProfile?: string; requisitionTitle?: string; candidateName?: string; roleFocus?: string } = {};
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ ok: false, error: 'bad json' }), { status: 400, headers: corsHeaders }); }
  const jd = (body.jd || '').trim();
  const criteria = Array.isArray(body.criteria) ? body.criteria : [];
  const profile = (body.candidateProfile || '').trim();
  const roleFocus = (body.roleFocus || '').trim();
  if (!jd || criteria.length === 0 || !profile) {
    return new Response(JSON.stringify({ ok: false, error: 'jd, criteria (non-empty), and candidateProfile required' }), { status: 400, headers: corsHeaders });
  }

  const criteriaBlock = criteria.map((c, i) => `${i + 1}. ${c.name}${c.weight ? ` (weight ${c.weight})` : ''}${c.notes ? ` — ${c.notes}` : ''}`).join('\n');

  const prompt = `You are Simpliigence's recruiter-screening AI. You write TECHNICAL / SUBJECT-MATTER screening questions for a hiring engagement — the depth a senior practitioner would ask, NOT generic HR filler.

REQUISITION: ${body.requisitionTitle || '(unspecified)'}
CANDIDATE: ${body.candidateName || '(unspecified)'}
ROLE FOCUS (recruiter's steer — take this as the primary direction for depth): ${roleFocus || '(none — infer role focus from JD)'}

JOB DESCRIPTION:
"""
${jd}
"""

SCREENING CRITERIA (ordered by priority; higher weight = more emphasis):
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
      "question": "<the question — see rules below>",
      "why_ask": "<1-sentence rationale grounded in the JD or the candidate's specific claims>",
      "red_flags": ["<concrete wrong or hand-wavy answer patterns>", "..."]
    }
  ]
}

MANDATORY RULES ON DEPTH:

1. IDENTIFY THE ROLE-SPECIFIC TECHNICAL SURFACE FIRST.
   Read the JD + role focus + résumé and extract 3-6 core technical areas the role actually requires. Examples of what "role-specific" means:
   - Salesforce BA → Sales Cloud vs Service Cloud object model, Flow / Process Builder, Omnistudio, security model (profiles, permission sets, sharing), reports & dashboards, integration patterns, deployment (change sets vs. DevOps), Agentforce / Einstein features
   - Salesforce Developer → Apex triggers, SOQL/SOSL, LWC, governor limits, async patterns, unit testing, integration patterns (REST/SOAP/Platform Events)
   - AWS Architect → VPC + subnets + routing, IAM roles vs. policies, HA/DR patterns, cost optimization, specific service tradeoffs (RDS vs Aurora, ALB vs NLB, EKS vs ECS), Well-Architected pillars
   - Data engineer → warehouse choice (Snowflake / BigQuery / Redshift), modeling (Kimball / OBT / One Big Table), orchestration (Airflow / Dagster), streaming vs batch, cost/perf tradeoffs
   Do this analysis silently; do not include it in the output. But use it to drive the questions.

2. QUESTION MIX — for technical / subject-matter criteria, USE THIS RATIO:
   - ~70% deep technical / SME questions grounded in the specific technologies named in the JD or profile. These probe HOW — architecture choices, tradeoffs, edge cases, real project decisions.
   - ~20% scenario / troubleshooting questions ("A user reports X — walk me through diagnosis") anchored in role-specific tools.
   - ~10% behavioral / STAR — reserved for genuinely non-technical criteria (e.g. Cultural fit).
   NEVER produce a bland "tell me about a time you solved a hard problem" for a technical criterion — that's HR filler and useless for screening.

3. QUESTIONS MUST BE SPECIFIC.
   Bad: "Tell me about your Salesforce experience."
   Good: "The résumé says you built a Service Cloud → Marketing Cloud integration for Cadence Health. Walk me through the object mapping — did you use Data Cloud or a Marketing Cloud Connector, and how did you handle bounce-back and unsubscribe sync?"
   Bad: "What is IAM?"
   Good: "You have an EC2 instance in Account A that needs to write to an S3 bucket in Account B. Walk me through the least-privilege setup — trust policies, resource policies, and what could go wrong at request time."

4. CALIBRATE TO CLAIMS.
   For every skill on the résumé, generate at least one probe that would catch someone who claimed it but hasn't used it. Ask about specifics only a real practitioner would know (config-level, gotchas, version-specific behavior).

5. PRODUCE 4-7 questions per technical criterion. For behavioral / fit criteria, 2-3 is enough.

6. red_flags MUST be role-specific.
   Bad: "vague answer".
   Good: "Confuses profile-level vs. permission-set-group permissions", "Cites the wrong governor limit for query rows", "Describes VPC peering as bidirectional-by-default", "Uses 'microservice' interchangeably with 'API endpoint'".

7. If a criterion is delivery-oriented (communication, cultural warmth, energy, confidence), SKIP IT — do not produce questions for it. Those are recruiter-observation criteria, not question-based. Return no questions for those criterion names.

8. Do NOT wrap the JSON in code fences or add any prose outside the JSON.`;

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
