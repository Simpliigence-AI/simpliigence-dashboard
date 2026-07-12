/**
 * concierge-ai-query
 *
 * A natural-language assistant that answers questions against the entire
 * Concierge dataset in one shot. Not tool-calling — the edge fn just packs
 * a compact JSON digest of everything (accounts + features + billing +
 * ticket counts + AI profiles + upsell backlog) into Claude's context and
 * lets Sonnet do the reasoning. That works because the Concierge dataset
 * is small (~20 accounts × ~500 tokens each ≈ 10k tokens) — well under
 * the 200k context limit and cheaper than a multi-turn tool loop.
 *
 * Input:  { question: string }
 * Output: { ok, answer, citedAccountIds[], usage }
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);
// @ts-expect-error esm.sh runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const CLAUDE_MODEL = 'claude-sonnet-4-5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildDigest(supabase: any): Promise<string> {
  const [accounts, features, billing, tickets, profiles, backlog, opps] = await Promise.all([
    supabase.from('concierge_accounts').select('*').order('name'),
    supabase.from('concierge_features').select('account_id, name, category, status, priority, upsell_estimate'),
    supabase.from('concierge_billing').select('account_id, month, amount, hours').order('month', { ascending: false }),
    supabase.from('concierge_tickets').select('account, status, subject, priority').limit(500),
    supabase.from('concierge_account_profile').select('account_id, what_we_do, key_stakeholders, technologies, current_initiatives, risks, upsell_opportunities, cross_sell_opportunities'),
    supabase.from('concierge_upsell_backlog').select('account_id, title, kind, source, service_area, cloud, rationale, estimated_value_usd, assignee_email, due_date, status'),
    supabase.from('account_opportunities').select('account_id, name, stage_name, amount, close_date').limit(200),
  ]);

  const acctRows = accounts.data ?? [];
  const featRows = features.data ?? [];
  const billRows = billing.data ?? [];
  const ticketRows = tickets.data ?? [];
  const profRows = profiles.data ?? [];
  const backlogRows = backlog.data ?? [];
  const oppRows = opps.data ?? [];

  // Index by account for O(N) assembly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byAcct: Record<string, any> = {};
  for (const a of acctRows) {
    byAcct[a.id] = {
      id: a.id,
      name: a.name,
      industry: a.industry ?? null,
      health: a.health,
      billing_model: a.billing_model,
      monthly_rate: a.monthly_rate,
      contract_start: a.contract_start,
      contract_end: a.contract_end,
      is_dormant: a.is_dormant,
      owner: a.owner_email,
      tech_stack_declared: a.tech_stack ?? [],
      current_work: a.current_work,
      previous_work: a.previous_work,
      notes: a.notes,
      features_implemented: [] as string[],
      features_in_progress: [] as string[],
      features_planned: [] as string[],
      features_not_implemented: [] as string[],
      recent_billing: [] as Array<{ month: string; amount: number; hours: number }>,
      open_tickets: 0,
      on_hold_tickets: 0,
      top_ticket_subjects: [] as string[],
      salesforce_opps: [] as Array<{ name: string; stage: string; amount: number; close_date: string }>,
      profile: null as Record<string, unknown> | null,
      backlog: [] as Array<Record<string, unknown>>,
    };
  }

  for (const f of featRows) {
    const a = byAcct[f.account_id];
    if (!a) continue;
    const line = `${f.name}${f.category ? ` (${f.category})` : ''}`;
    if (f.status === 'implemented') a.features_implemented.push(line);
    else if (f.status === 'in_progress') a.features_in_progress.push(line);
    else if (f.status === 'planned') a.features_planned.push(line);
    else a.features_not_implemented.push(line);
  }

  const billByAcct: Record<string, typeof billRows> = {};
  for (const b of billRows) (billByAcct[b.account_id] ||= []).push(b);
  for (const [accId, rows] of Object.entries(billByAcct)) {
    const a = byAcct[accId];
    if (!a) continue;
    a.recent_billing = rows.slice(0, 3).map((b) => ({ month: b.month, amount: Number(b.amount), hours: Number(b.hours) }));
  }

  // Match tickets by account name (fuzzy — concierge_tickets uses a text
  // `account` field, not an id). Case-insensitive contains works because
  // ticket account strings are usually a substring of the concierge name.
  const nameToId: Record<string, string> = {};
  for (const a of acctRows) nameToId[a.name.toLowerCase()] = a.id;
  for (const t of ticketRows) {
    const key = (t.account || '').toLowerCase();
    let matchId: string | null = null;
    for (const [n, id] of Object.entries(nameToId)) {
      if (key.includes(n) || n.includes(key)) { matchId = id; break; }
    }
    if (!matchId) continue;
    const a = byAcct[matchId];
    if (t.status === 'Open') a.open_tickets += 1;
    else if (t.status === 'On Hold') a.on_hold_tickets += 1;
    if (a.top_ticket_subjects.length < 5 && (t.status === 'Open' || t.status === 'On Hold')) {
      a.top_ticket_subjects.push(`[${t.status}${t.priority ? '/' + t.priority : ''}] ${t.subject}`);
    }
  }

  for (const p of profRows) {
    const a = byAcct[p.account_id];
    if (!a) continue;
    a.profile = {
      what_we_do: p.what_we_do,
      technologies: p.technologies ?? [],
      stakeholders: (p.key_stakeholders ?? []).map((s: Record<string, string>) => `${s.name}${s.role ? ` (${s.role})` : ''}`),
      current_initiatives: p.current_initiatives ?? [],
      risks: p.risks ?? [],
      upsell_opportunities: p.upsell_opportunities ?? [],
      cross_sell_opportunities: p.cross_sell_opportunities ?? [],
    };
  }

  for (const b of backlogRows) {
    const a = byAcct[b.account_id];
    if (!a) continue;
    a.backlog.push({
      title: b.title,
      kind: b.kind,
      service_area: b.service_area,
      status: b.status,
      assignee: b.assignee_email,
      due: b.due_date,
      value_usd: b.estimated_value_usd,
    });
  }

  for (const o of oppRows) {
    const a = byAcct[o.account_id];
    if (!a) continue;
    a.salesforce_opps.push({
      name: o.name,
      stage: o.stage_name ?? '',
      amount: Number(o.amount ?? 0),
      close_date: o.close_date ?? '',
    });
  }

  const digest = {
    generated_at: new Date().toISOString(),
    account_count: acctRows.length,
    accounts: Object.values(byAcct),
  };
  return JSON.stringify(digest, null, 2);
}

async function askClaude(question: string, digest: string): Promise<{ answer: string; usage: Record<string, unknown> }> {
  const prompt = `You are the Simpliigence Concierge AI Assistant. Answer the user's question using ONLY the account snapshot below. Cite specific account names when you make claims.

CONCIERGE DATASET (all accounts + features + billing + tickets + AI profiles + upsell backlog):
${digest}

USER QUESTION:
${question}

Response rules:
- Be concise. Bullet points are fine. Do not restate the question.
- Cite account names when a claim is grounded in one — e.g. "Ciklum, Acme, and Balkan all have Marketing Cloud implemented".
- For cross-account questions ("which other clients have X"), scan ALL accounts including their features, technologies, profile.technologies, and profile initiatives.
- If asked about revenue, billing, or margin, use recent_billing arrays. If asked about health, use the health field + open_tickets. If asked about upsell/cross-sell ideas, look at profile.upsell_opportunities + backlog.
- If the data doesn't support an answer, say so honestly — "No account in the current dataset has ...". Never fabricate accounts or numbers.
- Use plain Markdown for structure (headings, bullets, bold). Do NOT wrap the whole answer in code fences.
- If the question is ambiguous, answer the most likely interpretation and note the assumption at the end.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
  const json = await resp.json();
  return {
    answer: json.content?.[0]?.text ?? '(no answer)',
    usage: json.usage ?? {},
  };
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY missing' }), { status: 500, headers: corsHeaders });

  let question = '';
  try {
    const body = await req.json();
    question = String(body?.question ?? '').trim();
    if (!question) throw new Error('question required');
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const digest = await buildDigest(supabase);
    const { answer, usage } = await askClaude(question, digest);
    return new Response(JSON.stringify({ ok: true, answer, usage, digestSize: digest.length }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message.slice(0, 500) }), { status: 500, headers: corsHeaders });
  }
});
