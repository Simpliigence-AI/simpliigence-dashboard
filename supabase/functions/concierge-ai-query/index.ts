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

/** Ticket row shape pulled for the digest — deliberately narrow, `tickets` can be large. */
interface TicketRow {
  id: string;
  account: string | null;
  account_id: string | null;
  status: string | null;
  subject: string | null;
  priority: string | null;
}

interface TicketFetch {
  rows: TicketRow[];
  /** Exact server-side row count for `tickets` — null when the count could not be read. */
  exactCount: number | null;
  /** True only when the scan reached the end of the table. */
  complete: boolean;
  /** Non-null when the read failed; the digest must then report tickets as unavailable. */
  error: string | null;
}

const TICKET_PAGE_SIZE = 1000;
/** 50k tickets — orders of magnitude above current volume; guards against a runaway loop. */
const TICKET_MAX_PAGES = 50;

/**
 * Read every row of `public.tickets` — the table the whole app uses (see
 * src/store/useConciergeStore.ts and supabase/functions/desk-inbound). The
 * previous version read one `.limit(500)` page of a `concierge_tickets` table
 * nothing else touches and tallied whatever came back, so counts silently
 * truncated (and a missing table read as "zero tickets").
 *
 * Paging is keyset (`id > cursor`) rather than `.range()` offsets, so a
 * concurrent insert can't make us skip or double-count a row, and the exact
 * server-side count from the first page proves whether the scan finished.
 * Bucketing still happens in JS because `status` is free text (see
 * `statusBucket`) — but over every row, never a truncated page.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchTickets(supabase: any): Promise<TicketFetch> {
  const rows: TicketRow[] = [];
  let exactCount: number | null = null;
  let error: string | null = null;
  let complete = false;
  let cursor: string | null = null;

  for (let page = 0; page < TICKET_MAX_PAGES; page++) {
    let query = supabase
      .from('tickets')
      .select('id, account, account_id, status, subject, priority', { count: 'exact' })
      .order('id', { ascending: true })
      .limit(TICKET_PAGE_SIZE);
    if (cursor !== null) query = query.gt('id', cursor);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let res: any;
    try {
      res = await query;
    } catch (e) {
      error = (e as Error).message || 'tickets query threw';
      break;
    }
    if (res.error) { error = String(res.error.message ?? res.error); break; }
    // Only the first page counts the whole table; later pages are filtered by
    // the cursor, so their count is "rows remaining", not the total.
    if (cursor === null && typeof res.count === 'number') exactCount = res.count;

    const batch: TicketRow[] = res.data ?? [];
    rows.push(...batch);
    if (batch.length === 0) { complete = true; break; }
    const nextCursor = batch[batch.length - 1]?.id;
    // No usable cursor means we cannot page on safely; leave `complete` false
    // so the digest reports the totals as a lower bound rather than as truth.
    if (!nextCursor) break;
    cursor = nextCursor;
    if (exactCount !== null && rows.length >= exactCount) { complete = true; break; }
    // A short page is only proof of exhaustion when we have no count to check
    // against: the project's max-rows setting can cap a page below
    // TICKET_PAGE_SIZE, in which case we must keep paging.
    if (exactCount === null && batch.length < TICKET_PAGE_SIZE) { complete = true; break; }
  }

  return { rows, exactCount, complete: complete && error === null, error };
}

type StatusBucket = 'open' | 'on_hold' | 'escalated' | 'resolved' | 'closed' | 'unknown';

/**
 * `tickets.status` is free text. The UI writes five capitalised values —
 * 'Open' | 'On Hold' | 'Escalated' | 'Resolved' | 'Closed'
 * (src/store/useConciergeStore.ts, src/pages/concierge/TicketDrawer.tsx) — and
 * legacy Zoho-synced rows add case/spacing variants ('OPEN', 'On-Hold', ...).
 * Trim + lowercase + collapse separators, then bucket. Anything unrecognised
 * becomes 'unknown' and is reported as such in the digest; it is never quietly
 * counted as open or as closed.
 *
 * KEEP IN SYNC: src/ carries its own copy of this bucketing (the Concierge
 * page's "Open Tickets" stat). A Deno edge function cannot import from src/,
 * so the two must be changed together or the UI and the AI will disagree again.
 */
function statusBucket(raw: unknown): StatusBucket {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  switch (s) {
    case 'open': return 'open';
    case 'on hold': return 'on_hold';
    case 'escalated': return 'escalated';
    case 'resolved': return 'resolved';
    case 'closed': return 'closed';
    default: return 'unknown';
  }
}

/** Our one definition of "open": everything not yet Resolved/Closed. */
const UNRESOLVED_BUCKETS: StatusBucket[] = ['open', 'on_hold', 'escalated'];

interface TicketCounts {
  total_tickets: number;
  /** open + on hold + escalated */
  unresolved_tickets: number;
  open_tickets: number;
  on_hold_tickets: number;
  escalated_tickets: number;
  resolved_tickets: number;
  closed_tickets: number;
  unknown_status_tickets: number;
}

function makeTicketCounts(): TicketCounts {
  return {
    total_tickets: 0,
    unresolved_tickets: 0,
    open_tickets: 0,
    on_hold_tickets: 0,
    escalated_tickets: 0,
    resolved_tickets: 0,
    closed_tickets: 0,
    unknown_status_tickets: 0,
  };
}

function tallyTicket(counts: TicketCounts, bucket: StatusBucket): void {
  counts.total_tickets += 1;
  if (bucket === 'open') counts.open_tickets += 1;
  else if (bucket === 'on_hold') counts.on_hold_tickets += 1;
  else if (bucket === 'escalated') counts.escalated_tickets += 1;
  else if (bucket === 'resolved') counts.resolved_tickets += 1;
  else if (bucket === 'closed') counts.closed_tickets += 1;
  else counts.unknown_status_tickets += 1;
  if (UNRESOLVED_BUCKETS.includes(bucket)) counts.unresolved_tickets += 1;
}

/** Bucket key for tickets that belong to no concierge account. */
const UNASSIGNED_KEY = '(unassigned)';

const normaliseName = (raw: unknown): string =>
  String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildDigest(supabase: any): Promise<string> {
  const [accounts, features, billing, ticketFetch, profiles, backlog, opps, crmAccounts] = await Promise.all([
    supabase.from('concierge_accounts').select('*').order('name'),
    supabase.from('concierge_features').select('account_id, name, category, status, priority, upsell_estimate'),
    supabase.from('concierge_billing').select('account_id, month, amount, hours').order('month', { ascending: false }),
    fetchTickets(supabase),
    supabase.from('concierge_account_profile').select('account_id, what_we_do, key_stakeholders, technologies, current_initiatives, risks, upsell_opportunities, cross_sell_opportunities'),
    supabase.from('concierge_upsell_backlog').select('account_id, title, kind, source, service_area, cloud, rationale, estimated_value_usd, assignee_email, due_date, status'),
    supabase.from('account_opportunities').select('account_id, name, stage_name, amount, close_date').limit(200),
    // `tickets.account_id` is a FK into the Account-Management `accounts`
    // table, NOT concierge_accounts (different id spaces — see the note in
    // src/pages/concierge/NewTicketModal.tsx). Pull id -> name so tickets can
    // be matched by id first and by name only as a fallback.
    supabase.from('accounts').select('id, name'),
  ]);

  const acctRows = accounts.data ?? [];
  const featRows = features.data ?? [];
  const billRows = billing.data ?? [];
  const ticketRows = ticketFetch.rows;
  // A failed ticket read must never look like "no tickets": every ticket
  // number is suppressed and the digest is marked unavailable instead.
  const ticketsUnavailable = ticketFetch.error !== null;
  const crmRows = crmAccounts.data ?? [];
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
      // Ticket counters are omitted entirely when the ticket read failed, so
      // the model cannot mistake "could not read" for "zero".
      ...(ticketsUnavailable ? { ticket_counts: 'unavailable' } : makeTicketCounts()),
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

  // Attribute every ticket to an account and count it. Order of attempts:
  //   1. `account_id` that is already a concierge_accounts id,
  //   2. `account_id` resolved through `accounts` to a name, matched by name,
  //   3. the free-text `account` column, matched by name,
  //   4. the explicit "(unassigned)" bucket.
  // Nothing is dropped — a blank account, or one routed to Others / Internal
  // Simpliigence, lands in "(unassigned)" and still counts towards the totals.
  const nameToId: Record<string, string> = {};
  for (const a of acctRows) {
    const key = normaliseName(a.name);
    if (key) nameToId[key] = a.id;
  }
  const crmIdToName: Record<string, string> = {};
  for (const r of crmRows) if (r?.id) crmIdToName[r.id] = String(r.name ?? '');

  const matchByName = (raw: unknown): string | null => {
    const key = normaliseName(raw);
    if (!key) return null;                         // never let a blank name match
    if (nameToId[key]) return nameToId[key];       // exact (normalised) match wins
    for (const [n, id] of Object.entries(nameToId)) {
      if (n && (key.includes(n) || n.includes(key))) return id;
    }
    return null;
  };

  const totals = makeTicketCounts();
  const unknownStatusValues = new Set<string>();
  let unassignedTickets = 0;

  if (!ticketsUnavailable) {
    for (const t of ticketRows) {
      const bucket = statusBucket(t.status);
      if (bucket === 'unknown') unknownStatusValues.add(String(t.status ?? '(null)').slice(0, 60));
      tallyTicket(totals, bucket);

      let key: string | null = null;
      if (t.account_id) {
        if (byAcct[t.account_id]) key = t.account_id;
        else key = matchByName(crmIdToName[t.account_id]);
      }
      if (!key) key = matchByName(t.account);
      if (!key) {
        key = UNASSIGNED_KEY;
        unassignedTickets += 1;
        byAcct[UNASSIGNED_KEY] ||= {
          id: UNASSIGNED_KEY,
          name: UNASSIGNED_KEY,
          is_concierge_account: false,
          note: 'Pseudo-account: tickets that matched no concierge account (blank account, Others, Internal Simpliigence, or an unrecognised name). Included in ticket_totals.',
          ...makeTicketCounts(),
          top_ticket_subjects: [] as string[],
        };
      }

      const a = byAcct[key];
      tallyTicket(a, bucket);
      if (a.top_ticket_subjects.length < 5 && UNRESOLVED_BUCKETS.includes(bucket)) {
        a.top_ticket_subjects.push(`[${t.status}${t.priority ? '/' + t.priority : ''}] ${t.subject}`);
      }
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

  // Authoritative, whole-table ticket numbers. The model must read counts
  // from here instead of summing the per-account arrays.
  const ticket_totals = ticketsUnavailable
    ? {
        available: false,
        source_table: 'tickets',
        error: ticketFetch.error,
        note: 'The tickets table could not be read. There are NO ticket counts in this digest — every per-account ticket field is marked "unavailable". Do not answer any ticket-count question with a number.',
      }
    : {
        available: true,
        source_table: 'tickets',
        open_definition: 'unresolved_tickets = open + on hold + escalated (everything not Resolved/Closed). open_tickets counts status "Open" only.',
        ...totals,
        unassigned_to_concierge_account: unassignedTickets,
        exact_row_count: ticketFetch.exactCount,
        rows_scanned: ticketRows.length,
        scan_complete: ticketFetch.complete,
        unknown_status_values: Array.from(unknownStatusValues).sort(),
      };

  const digest = {
    generated_at: new Date().toISOString(),
    account_count: acctRows.length,
    tickets_unavailable: ticketsUnavailable,
    ticket_totals,
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
- If asked about revenue, billing, or margin, use recent_billing arrays. If asked about health, use the health field + the account's unresolved_tickets. If asked about upsell/cross-sell ideas, look at profile.upsell_opportunities + backlog.
- TICKET COUNTS: read them from the top-level ticket_totals block. It is the authoritative, whole-table count — never add up the per-account numbers yourself, and never assume the accounts array is complete.
- "Open tickets" means ticket_totals.unresolved_tickets (Open + On Hold + Escalated). State that definition whenever you give an open-ticket number, and give the per-status breakdown when it is useful. Use open_tickets only when the question is specifically about status "Open".
- Tickets that matched no concierge account are grouped under the pseudo-account "(unassigned)" (count: ticket_totals.unassigned_to_concierge_account) and ARE part of the totals. Mention it when it materially affects the answer, and exclude it from "which client" rankings.
- If tickets_unavailable is true (or ticket_totals.available is false), the ticket data could NOT be read. Say exactly that, quote ticket_totals.error, and give no ticket number at all — never "0 tickets", and never infer a count from anything else in the digest.
- If ticket_totals.scan_complete is false, or rows_scanned is below exact_row_count, say the ticket numbers are a lower bound. If ticket_totals.unknown_status_values is non-empty, those statuses were not recognised — flag them when they could change a count.
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
