/**
 * Supabase Edge Function: candidate-search
 *
 * Natural-language search across india_staffing_candidates. The caller sends a
 * query like "all servicemax candidates" or "salesforce architects in bangalore"
 * and Claude returns the candidate IDs that match — semantically, not just by
 * substring — using each candidate's name, skills, profile_summary, source,
 * stage, current title, and (where available) location.
 *
 * Required secrets:
 *   ANTHROPIC_API_KEY   — Anthropic Messages API key
 *
 * Request body:
 *   { query: string }
 *
 * Response:
 *   { ok: true, matchedIds: string[], explanation: string }
 *   { error: string, detail?: string }
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno runtime
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;

const CLAUDE_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_CANDIDATES_TO_LLM = 500; // safety cap on prompt size

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const SYSTEM_PROMPT = `You are a smart recruitment search engine. The user gives a natural-language query and a JSON list of candidates. Each candidate has id, name, skills[], summary, source, stage, location, experience (current title), and email.

# Mission
Return the candidates a recruiter would WANT to see for this query — not just literal-keyword matches. Use semantics, synonyms, world knowledge, and reasonable inference. Recruiters are scanning hundreds of profiles; your job is to surface the ones worth a closer look, not to be a strict literal filter.

# Smart matching playbook

**Skills / role queries** — match the family, not the exact phrase:
  - "servicemax" → ServiceMax + Field Service Lightning + FSL + Salesforce Service Cloud
  - "salesforce dev" → Apex, LWC, Visualforce, Aura, SOQL, Salesforce CRM, any Salesforce cloud
  - "react developer" → React, Next.js, Redux, Vite, JSX (and "frontend dev" candidates with React in their skills)
  - "senior X" → infer from experience field, summary, or "Senior/Lead/Principal/Staff" in title
  - "data engineer" → ETL, Spark, Airflow, Snowflake, BigQuery, Databricks, dbt, Kafka

**Location queries** — be GENEROUS, not strict:
  - The "location" field is the primary signal when present.
  - But also INFER location from other signals:
      · Email domain (.in / @company.in → India; .uk → UK; etc.)
      · Current company in summary/title (TCS, Infosys, Wipro, Mindtree, HCL, Cognizant → typically India unless said otherwise; specific company HQs may indicate city)
      · Name origin (recognizably Telugu/Kannada/Tamil/Hindi names with no other location info → probably India). Use this as a WEAK signal — never the only signal — but combined with India-centric skills/companies it's strong enough to include.
      · Time-zone hints in summary ("IST", "5+ hrs ahead of EST")
  - Place-name normalization: Bangalore == Bengaluru == Bengaluru, KA == Karnataka; Mumbai == Bombay; Chennai == Madras; Calcutta == Kolkata; Pune == Poona; "NCR" includes Delhi/Gurgaon/Noida.
  - "Remote" queries → candidates whose location says Remote / Anywhere / "Work from home", or whose summary mentions remote work.
  - **If a candidate is a great skills match and there's NO contradicting location signal, INCLUDE them with a note** — better to show a strong-skills candidate the recruiter can ask about location than to silently exclude.

**Funnel / stage queries** — use the stage column:
  - "ready to interview" → Submitted / Screening / Shortlisted
  - "joined recently" → Joined (look at submit_date if visible)
  - "rejected" / "dropped" → Rejected / Dropped Out
  - "active candidates" → anything NOT in Rejected/Dropped Out/On Hold

**Seniority queries** — infer from experience text (current title) and summary years-of-experience phrases. "Senior" usually = 6+ yrs, "Lead" = 8+, "Principal/Architect" = 10+. Don't refuse if not stated; use signals.

# Output format
Return ONLY this JSON, no markdown:
{
  "matchedIds": ["id1", "id2", ...],
  "explanation": "1–2 sentences on how you interpreted the query and what signals you used. Call out any inference (e.g. 'Inferred Bangalore location from Wipro employment and Karnataka-origin names')."
}

# Rules of thumb
  - Prefer INCLUSION over exclusion when there's a defensible reason. Recruiters can dismiss a candidate in one click; they cannot find one you hid.
  - Cap matchedIds at the 50 strongest matches.
  - If the query is genuinely unsatisfiable (e.g. "Cobol developers" and nobody has Cobol skills), return empty matchedIds and explain WHY in plain language — the recruiter learns something.
  - The explanation is for the human, not for the model. Make it informative.`;

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY secret is not set on this Supabase project');
    }

    const { query } = await req.json() as { query?: string };
    if (!query || !query.trim()) {
      return new Response(JSON.stringify({ error: 'query is required' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Pull a slim projection of every candidate. Cap to MAX_CANDIDATES_TO_LLM to keep prompt tractable.
    const { data: cands, error } = await supabase
      .from('india_staffing_candidates')
      .select('id, name, email, source, stage, skills, profile_summary, experience, location')
      .order('updated_at', { ascending: false })
      .limit(MAX_CANDIDATES_TO_LLM);
    if (error) {
      return new Response(JSON.stringify({ error: 'DB read failed', detail: error.message }), { status: 500, headers: corsHeaders });
    }

    const slim = (cands || []).map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email ?? undefined,
      source: c.source ?? undefined,
      stage: c.stage ?? undefined,
      experience: c.experience ?? undefined,
      location: c.location ?? undefined,
      skills: Array.isArray(c.skills) ? c.skills : [],
      summary: c.profile_summary ?? undefined,
    }));

    const userContent = [
      { type: 'text', text: `Query: ${query.trim()}\n\nCandidates (${slim.length}):\n${JSON.stringify(slim)}` },
    ];

    const claudeRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        // System prompt cached for 5 min — subsequent searches in the same
        // session pay ~10% of the input cost on the cached prefix.
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      return new Response(JSON.stringify({ error: 'Claude API failed', detail: text.slice(0, 500) }), { status: 502, headers: corsHeaders });
    }
    const claudeJson = await claudeRes.json() as { content?: Array<{ type: string; text?: string }> };
    const reply = claudeJson.content?.find((b) => b.type === 'text')?.text?.trim() || '';

    const cleaned = reply.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    let parsed: { matchedIds?: string[]; explanation?: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({ error: 'Claude returned non-JSON', detail: reply.slice(0, 500) }), { status: 502, headers: corsHeaders });
    }

    const matchedIds = Array.isArray(parsed.matchedIds)
      ? parsed.matchedIds.filter((s) => typeof s === 'string')
      : [];
    const explanation = typeof parsed.explanation === 'string' ? parsed.explanation : '';

    return new Response(
      JSON.stringify({ ok: true, matchedIds, explanation, totalScanned: slim.length }),
      { headers: corsHeaders },
    );
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[candidate-search]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
