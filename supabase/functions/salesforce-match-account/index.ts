/**
 * Supabase Edge Function: salesforce-match-account
 *
 * Given a dashboard account (name + optional signals), finds the best-matching
 * Salesforce Account using Claude as a judge. Not a naive string match — feeds
 * Claude the top-N SOQL candidates plus their revenue + industry + closed-won
 * history and asks which one this dashboard account actually IS.
 *
 * Persists the winning match into salesforce_account_link so subsequent syncs
 * can find the SF account directly by dashboard_account_id.
 *
 * Required secrets:
 *   SF_CLIENT_ID, SF_CLIENT_SECRET, SF_INSTANCE_URL, ANTHROPIC_API_KEY
 *
 * Request body:
 *   { dashboardAccountId: string, dashboardAccountName: string,
 *     signals?: { contactEmails?: string[], knownDomain?: string, region?: string } }
 *
 * Response (success):
 *   { ok: true, sfAccountId, sfAccountName, confidence (0-1),
 *     matchMethod, reasoning, alternatives: [{id,name,confidence,note}, ...] }
 *   confidence < 0.5 → treat as "no confident match" on the UI side.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);
// @ts-expect-error esm.sh runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SF_CLIENT_ID = env('SF_CLIENT_ID');
const SF_CLIENT_SECRET = env('SF_CLIENT_SECRET');
const SF_INSTANCE_URL = (env('SF_INSTANCE_URL') || '').replace(/\/$/, '');
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

interface Candidate {
  id: string;
  name: string;
  industry: string | null;
  annualRevenue: number | null;
  billingCity: string | null;
  billingCountry: string | null;
  ownerName: string | null;
  contactCount: number;
  closedWonCount: number;
}

/** Exchange client credentials for a short-lived Salesforce access token. */
async function getSalesforceToken(): Promise<{ accessToken: string; instanceUrl: string }> {
  if (!SF_CLIENT_ID || !SF_CLIENT_SECRET || !SF_INSTANCE_URL) {
    throw new Error('Missing SF_CLIENT_ID / SF_CLIENT_SECRET / SF_INSTANCE_URL secrets');
  }
  const res = await fetch(`${SF_INSTANCE_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: SF_CLIENT_ID,
      client_secret: SF_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Salesforce OAuth failed (${res.status}): ${detail.slice(0, 400)}`);
  }
  const json = await res.json() as { access_token: string; instance_url?: string };
  return { accessToken: json.access_token, instanceUrl: (json.instance_url || SF_INSTANCE_URL).replace(/\/$/, '') };
}

async function soql<T>(instanceUrl: string, accessToken: string, query: string): Promise<{ records: T[]; totalSize: number }> {
  const res = await fetch(`${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`SOQL failed (${res.status}): ${detail.slice(0, 400)}\nQuery: ${query}`);
  }
  return await res.json() as { records: T[]; totalSize: number };
}

/**
 * Fetch top-N Salesforce Accounts whose name looks anything like the dashboard
 * account name. Uses SOSL for a broader recall, then augments each candidate
 * with contact + opportunity counts so Claude can judge.
 */
async function findCandidates(instanceUrl: string, accessToken: string, dashboardName: string): Promise<Candidate[]> {
  // 1. Try SOSL — much better recall than SOQL LIKE for fuzzy name matches.
  const cleaned = dashboardName.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
  // Take first 2 significant tokens as SOSL search terms
  const tokens = cleaned.split(/\s+/).filter((t) => t.length >= 3).slice(0, 2);
  const searchTerm = tokens.length > 0 ? tokens.join(' ') : cleaned;
  let candidateIds: string[] = [];

  if (searchTerm) {
    try {
      const soslUrl = `${instanceUrl}/services/data/v60.0/search?q=${encodeURIComponent(
        `FIND {${searchTerm}} IN NAME FIELDS RETURNING Account(Id, Name LIMIT 15)`,
      )}`;
      const soslRes = await fetch(soslUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (soslRes.ok) {
        const j = await soslRes.json() as { searchRecords?: Array<{ Id: string; Name: string; attributes?: unknown }> };
        candidateIds = (j.searchRecords || []).map((r) => r.Id);
      }
    } catch { /* fall through to SOQL LIKE */ }
  }

  // 2. Fallback: SOQL LIKE — catches misspellings SOSL might miss
  if (candidateIds.length === 0) {
    const escaped = cleaned.slice(0, 40).replace(/'/g, "\\'");
    const q = `SELECT Id, Name FROM Account WHERE Name LIKE '%${escaped}%' OR Name LIKE '%${escaped.split(/\s+/)[0] || ''}%' LIMIT 15`;
    const r = await soql<{ Id: string; Name: string }>(instanceUrl, accessToken, q);
    candidateIds = r.records.map((x) => x.Id);
  }

  if (candidateIds.length === 0) return [];

  // 3. Enrich each candidate with revenue + industry + owner + contact/opp counts
  const idList = candidateIds.map((i) => `'${i}'`).join(',');
  const enrichQ = `
    SELECT Id, Name, Industry, AnnualRevenue,
           BillingCity, BillingCountry,
           Owner.Name,
           (SELECT Id FROM Contacts LIMIT 200),
           (SELECT Id FROM Opportunities WHERE IsClosed = true AND IsWon = true LIMIT 200)
    FROM Account WHERE Id IN (${idList})
  `.trim();
  const r = await soql<{
    Id: string; Name: string; Industry: string | null; AnnualRevenue: number | null;
    BillingCity: string | null; BillingCountry: string | null;
    Owner?: { Name: string | null };
    Contacts?: { records?: unknown[]; totalSize?: number } | null;
    Opportunities?: { records?: unknown[]; totalSize?: number } | null;
  }>(instanceUrl, accessToken, enrichQ);
  return r.records.map((a) => ({
    id: a.Id,
    name: a.Name,
    industry: a.Industry,
    annualRevenue: a.AnnualRevenue,
    billingCity: a.BillingCity,
    billingCountry: a.BillingCountry,
    ownerName: a.Owner?.Name ?? null,
    contactCount: a.Contacts?.records?.length ?? a.Contacts?.totalSize ?? 0,
    closedWonCount: a.Opportunities?.records?.length ?? a.Opportunities?.totalSize ?? 0,
  }));
}

interface Judgment {
  sfAccountId: string | null;
  confidence: number;
  reasoning: string;
  alternatives: Array<{ id: string; name: string; confidence: number; note: string }>;
}

async function askClaudeToJudge(
  dashboardName: string,
  signals: { contactEmails?: string[]; knownDomain?: string; region?: string } | undefined,
  candidates: Candidate[],
): Promise<Judgment> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY secret is not set');

  const system = `You are matching a dashboard account name to a Salesforce Account record. Your job: pick the SINGLE best match from the candidates, or say "no match" if none are the same real-world company.

Use these signals in priority order:
  1. Name similarity (accounting for common variations: subsidiaries, abbreviations, "Inc"/"Ltd" suffixes, misspellings, transliteration).
  2. Revenue plausibility — if the dashboard hints at a company size, high revenue candidates are likely enterprise/parent, low revenue may indicate a subsidiary.
  3. Activity: candidates with more Contacts and Closed-Won opportunities are more established relationships and MORE likely to be the intended match.
  4. Region — if provided in signals.
  5. Contact email domains — if signals.contactEmails include people at @acme.com, the candidate whose website/name aligns is more likely correct.

Return JSON only, no prose:
{
  "sfAccountId": "0018Z..." | null,     // null when confidence < 0.4
  "confidence": 0.0-1.0,                // 1.0 = certain identical, 0.8+ = strong, 0.5-0.8 = plausible, <0.5 = weak
  "reasoning": "one sentence explaining WHY you picked this, mentioning the signals that clinched it",
  "alternatives": [                     // up to 3 runner-ups (in case admin wants to override)
    {"id":"018...","name":"...","confidence":0.0-1.0,"note":"why this might also be right"}
  ]
}`;

  const userContent = `Dashboard account: "${dashboardName}"
${signals?.contactEmails?.length ? `Known contact emails: ${signals.contactEmails.join(', ')}\n` : ''}${signals?.knownDomain ? `Known domain: ${signals.knownDomain}\n` : ''}${signals?.region ? `Region: ${signals.region}\n` : ''}
Salesforce candidates (${candidates.length}):
${JSON.stringify(candidates, null, 2)}

Pick the best match. Return JSON only.`;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1024, system, messages: [{ role: 'user', content: userContent }] }),
  });
  if (!res.ok) throw new Error(`Claude API failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  const j = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const reply = j.content?.find((b) => b.type === 'text')?.text?.trim() || '';
  const cleaned = reply.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned) as Judgment;
  return {
    sfAccountId: parsed.sfAccountId || null,
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    reasoning: String(parsed.reasoning || ''),
    alternatives: Array.isArray(parsed.alternatives) ? parsed.alternatives.slice(0, 3) : [],
  };
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { dashboardAccountId, dashboardAccountName, signals } = await req.json() as {
      dashboardAccountId?: string;
      dashboardAccountName?: string;
      signals?: { contactEmails?: string[]; knownDomain?: string; region?: string };
    };
    if (!dashboardAccountId || !dashboardAccountName) {
      return new Response(JSON.stringify({ error: 'dashboardAccountId and dashboardAccountName are required' }), { status: 400, headers: corsHeaders });
    }

    const { accessToken, instanceUrl } = await getSalesforceToken();

    // 1. Get candidates
    const candidates = await findCandidates(instanceUrl, accessToken, dashboardAccountName);
    if (candidates.length === 0) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'No Salesforce Accounts matched by name search.',
        hint: 'Either the name differs a lot from what SF has, or the SF user your Client Credentials Flow runs as does not have visibility to that account.',
      }), { status: 404, headers: corsHeaders });
    }

    // 2. Ask Claude to judge
    const judgment = await askClaudeToJudge(dashboardAccountName, signals, candidates);

    // 3. If we have a confident pick, persist the link
    const chosen = candidates.find((c) => c.id === judgment.sfAccountId);
    if (chosen && judgment.confidence >= 0.4) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const method = judgment.confidence >= 0.95 ? 'exact' : judgment.confidence >= 0.8 ? 'fuzzy_name' : 'ai_signals';
      const { error } = await supabase.from('salesforce_account_link').upsert({
        dashboard_account_id: dashboardAccountId,
        sf_account_id: chosen.id,
        sf_account_name: chosen.name,
        confidence: judgment.confidence,
        match_method: method,
        match_reasoning: judgment.reasoning,
        linked_at: new Date().toISOString(),
      }, { onConflict: 'dashboard_account_id' });
      if (error) console.warn('[sf-match] link upsert failed:', error);
    }

    return new Response(JSON.stringify({
      ok: true,
      sfAccountId: judgment.sfAccountId,
      sfAccountName: chosen?.name || null,
      confidence: judgment.confidence,
      matchMethod: judgment.confidence >= 0.95 ? 'exact' : judgment.confidence >= 0.8 ? 'fuzzy_name' : 'ai_signals',
      reasoning: judgment.reasoning,
      alternatives: judgment.alternatives.map((a) => ({
        ...a,
        note: a.note || (candidates.find((c) => c.id === a.id)?.industry || ''),
      })),
      candidateCount: candidates.length,
    }, null, 2), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});
