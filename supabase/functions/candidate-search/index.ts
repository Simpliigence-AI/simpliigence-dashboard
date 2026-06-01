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

const SYSTEM_PROMPT = `You are a recruitment search engine. The user supplies a natural-language query and a JSON list of candidates. Each candidate has id, name, skills[], profile_summary, source, stage, and (optional) email and current title.

Your job: return ONLY the candidate IDs that genuinely match the query. Match semantically — synonyms, related platforms, common stacks. Examples:
  - "servicemax candidates" → candidates with ServiceMax / Field Service Lightning / FSL skills
  - "salesforce candidates in bangalore" → candidates with Salesforce-family skills AND profile_summary or email indicating Bangalore / Bengaluru / Karnataka
  - "senior backend java" → java backend developers with senior-level experience
  - "candidates ready to interview" → candidates whose stage is Submitted / Screening / Shortlisted

Rules:
  - Only include IDs that meaningfully match. If unsure, exclude.
  - If the query specifies a location and the profile has no location info, exclude (don't guess).
  - Use stage if the query mentions funnel intent ("ready to submit", "joined recently", "rejected").
  - Cap output at the 50 best matches if there would be more.
  - Output ONLY a JSON object: {"matchedIds": ["id1","id2",...], "explanation": "one sentence on how you interpreted the query"}.
  - No prose, no markdown fences.`;

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
      .select('id, name, email, source, stage, skills, profile_summary, experience')
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
        system: SYSTEM_PROMPT,
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
