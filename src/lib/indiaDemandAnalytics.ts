/**
 * India demand analytics — the maths behind the Demand Analytics tab.
 *
 * Kept out of the page so the rules are testable and quotable. Three rules
 * matter and all three were learned the hard way (see the 12 Sep 2026 funnel
 * review):
 *
 *  1. `status_field` is the outcome, never `stage`. Nine of thirty Closed Won
 *     requisitions never left Sourcing / Interview / Profiles Shared, and one
 *     Cancelled row sits at Onboarding. Any stage-based rule miscounts.
 *  2. A close is credited to the month the status *flipped*, taken from
 *     india_staffing_history, not the month the requisition was raised — so a
 *     July req won in August counts to August, and a locked past month does
 *     not drift as old reqs finally close. `updated_at` is the fallback for
 *     rows seeded already closed.
 *  3. Account names are matched case-insensitively. The account table holds
 *     QBurst/Qburst and Skechers/Sketchers as separate rows; splitting a
 *     customer in two makes its win rate meaningless.
 */
import type {
  StaffingAccount,
  StaffingRequisition,
  StaffingHistoryEntry,
  DailyStatus,
  StaffingStatus,
} from '../types/staffing';

export type Outcome = 'won' | 'cancelled' | 'lost' | 'live';

export function outcomeOf(status: StaffingStatus): Outcome {
  if (status === 'Closed Won') return 'won';
  if (status === 'Cancelled') return 'cancelled';
  if (status === 'Closed Lost') return 'lost';
  return 'live'; // Open, In Progress, On Hold
}

/** YYYY-MM from any ISO-ish date or timestamp string. */
export function monthKey(iso: string | null | undefined): string {
  return iso ? String(iso).slice(0, 7) : '';
}

/** Inclusive list of YYYY-MM keys from `from` to `to`. */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${String(y).slice(2)}`;
}

/**
 * The month a requisition reached its terminal status, from the history table.
 * Falls back to `updated_at` when no history row exists (rows seeded already
 * closed). Returns '' for requisitions that are still live.
 */
export function closedMonth(
  req: StaffingRequisition,
  historyByReq: Map<string, StaffingHistoryEntry[]>,
): string {
  const outcome = outcomeOf(req.status_field);
  if (outcome === 'live') return '';
  const rows = historyByReq.get(req.id) ?? [];
  let earliest = '';
  for (const h of rows) {
    if (h.field !== 'status_field' || h.new_value !== req.status_field) continue;
    if (!earliest || h.changed_at < earliest) earliest = h.changed_at;
  }
  return monthKey(earliest || req.updated_at);
}

/** Reason buckets for requisitions that did not close won. */
export const CANCEL_REASONS = [
  'Client went silent',
  'Filled internally / other vendor',
  'Commercial — budget, mode, duration',
  'On hold, deferred or re-scoped',
  'Duplicate or data cleanup',
  'In pipeline when closed — reason unclear',
  'No reason recorded',
] as const;
export type CancelReason = typeof CANCEL_REASONS[number];

export const REASON_COLORS: Record<CancelReason, string> = {
  'Client went silent':                       '#ef4444',
  'Filled internally / other vendor':         '#f59e0b',
  'Commercial — budget, mode, duration':      '#8b5cf6',
  'On hold, deferred or re-scoped':           '#3b82f6',
  'Duplicate or data cleanup':                '#64748b',
  'In pipeline when closed — reason unclear': '#f97316',
  'No reason recorded':                       '#94a3b8',
};

/**
 * Bucket a closing reason from the requisition's last status note.
 *
 * Deliberately conservative: anything without a note is "No reason recorded",
 * and a note that only reports pipeline activity is called out as such rather
 * than being read as a reason. Those two buckets together are the measure of
 * how much closing discipline is missing — in the September 2026 review they
 * were 71% of all cancellations.
 */
export function classifyReason(note: string | null | undefined): CancelReason {
  const t = (note ?? '').trim();
  if (!t) return 'No reason recorded';
  const has = (re: RegExp) => re.test(t);
  if (has(/no news|no update|no response|clueless|no clarity|slow response|no hopes/i)) return 'Client went silent';
  if (has(/duplicat|typo|re-created/i)) return 'Duplicate or data cleanup';
  if (has(/internal|closed by the client|precedence/i)) return 'Filled internally / other vendor';
  if (has(/budget|hybrid|contract duration|rate/i)) return 'Commercial — budget, mode, duration';
  if (has(/hold|pause|delay|cancel|change in plan|got changed/i)) return 'On hold, deferred or re-scoped';
  return 'In pipeline when closed — reason unclear';
}

export interface ReqView {
  id: string;
  customer: string;
  title: string;
  positions: number;
  createdMonth: string;
  closedMonth: string;
  status: StaffingStatus;
  stage: string;
  outcome: Outcome;
  reason: CancelReason | null;
  lastNote: string;
  lastNoteDate: string;
  /** True when status_field says closed won but stage never advanced. */
  stageMismatch: boolean;
}

export interface CustomerRow {
  customer: string;
  byMonth: Record<string, number>;
  created: number;
  positions: number;
  won: number;
  wonPositions: number;
  cancelled: number;
  lost: number;
  live: number;
  winRate: number;
}

export interface MonthRow {
  key: string;
  label: string;
  created: number;
  positions: number;
  won: number;
  cancelled: number;
  lost: number;
}

export interface DemandAnalytics {
  months: string[];
  reqs: ReqView[];
  customers: CustomerRow[];
  monthRows: MonthRow[];
  reasons: Array<{ reason: CancelReason; reqs: number; positions: number }>;
  totals: {
    created: number; positions: number;
    won: number; wonPositions: number;
    cancelled: number; cancelledPositions: number;
    lost: number; live: number; onHold: number;
    winRate: number;
  };
  /** Data-quality counts surfaced on the page so nobody quotes a bad number. */
  quality: { stageMismatch: number; noReason: number; duplicateAccounts: string[] };
}

const ADVANCED_STAGES = ['Closed/Selected', 'Onboarding'];

export function buildDemandAnalytics(
  accounts: StaffingAccount[],
  requisitions: StaffingRequisition[],
  statuses: DailyStatus[],
  history: StaffingHistoryEntry[],
  fromMonth: string,
  toMonth: string,
): DemandAnalytics {
  const months = monthRange(fromMonth, toMonth);
  const inRange = (k: string) => !!k && k >= fromMonth && k <= toMonth;

  // Account id → display name, with case-insensitive de-duplication so
  // QBurst/Qburst land on one row. First spelling seen wins as the label.
  const canonical = new Map<string, string>();
  const dupes = new Map<string, Set<string>>();
  for (const a of accounts) {
    const k = a.name.trim().toLowerCase();
    if (!canonical.has(k)) canonical.set(k, a.name.trim());
    const set = dupes.get(k) ?? new Set<string>();
    set.add(a.name.trim());
    dupes.set(k, set);
  }
  const nameOf = (id: string): string => {
    const acct = accounts.find((a) => a.id === id);
    if (!acct) return 'Unassigned';
    return canonical.get(acct.name.trim().toLowerCase()) ?? acct.name.trim();
  };

  const historyByReq = new Map<string, StaffingHistoryEntry[]>();
  for (const h of history) {
    const arr = historyByReq.get(h.requisition_id);
    if (arr) arr.push(h); else historyByReq.set(h.requisition_id, [h]);
  }

  const lastStatus = new Map<string, DailyStatus>();
  for (const s of statuses) {
    const cur = lastStatus.get(s.requisition_id);
    if (!cur || (s.status_date ?? '') > (cur.status_date ?? '')) lastStatus.set(s.requisition_id, s);
  }

  const reqs: ReqView[] = requisitions
    .map((r) => {
      const outcome = outcomeOf(r.status_field);
      const note = lastStatus.get(r.id);
      return {
        id: r.id,
        customer: nameOf(r.account_id),
        title: r.title,
        positions: r.new_positions || 0,
        createdMonth: monthKey(r.created_at),
        closedMonth: closedMonth(r, historyByReq),
        status: r.status_field,
        stage: r.stage,
        outcome,
        reason: outcome === 'cancelled' || outcome === 'lost'
          ? classifyReason(note?.status_text)
          : null,
        lastNote: note?.status_text?.trim() ?? '',
        lastNoteDate: note?.status_date ?? '',
        stageMismatch: outcome === 'won' && !ADVANCED_STAGES.includes(r.stage),
      };
    })
    .filter((r) => inRange(r.createdMonth));

  // ── per customer ──
  const custMap = new Map<string, CustomerRow>();
  for (const r of reqs) {
    let row = custMap.get(r.customer);
    if (!row) {
      row = {
        customer: r.customer,
        byMonth: Object.fromEntries(months.map((m) => [m, 0])),
        created: 0, positions: 0, won: 0, wonPositions: 0,
        cancelled: 0, lost: 0, live: 0, winRate: 0,
      };
      custMap.set(r.customer, row);
    }
    row.byMonth[r.createdMonth] = (row.byMonth[r.createdMonth] ?? 0) + 1;
    row.created += 1;
    row.positions += r.positions;
    if (r.outcome === 'won') { row.won += 1; row.wonPositions += r.positions; }
    else if (r.outcome === 'cancelled') row.cancelled += 1;
    else if (r.outcome === 'lost') row.lost += 1;
    else row.live += 1;
  }
  const customers = Array.from(custMap.values())
    .map((c) => ({ ...c, winRate: c.created ? Math.round((c.won / c.created) * 100) : 0 }))
    .sort((a, b) => b.created - a.created || a.customer.localeCompare(b.customer));

  // ── per month: raised by created month, closed by the month the status flipped ──
  const monthRows: MonthRow[] = months.map((key) => ({
    key, label: monthLabel(key), created: 0, positions: 0, won: 0, cancelled: 0, lost: 0,
  }));
  const byKey = new Map(monthRows.map((m) => [m.key, m]));
  for (const r of reqs) {
    const made = byKey.get(r.createdMonth);
    if (made) { made.created += 1; made.positions += r.positions; }
    const closed = byKey.get(r.closedMonth);
    if (closed) {
      if (r.outcome === 'won') closed.won += 1;
      else if (r.outcome === 'cancelled') closed.cancelled += 1;
      else if (r.outcome === 'lost') closed.lost += 1;
    }
  }

  // ── reasons ──
  const reasonMap = new Map<CancelReason, { reqs: number; positions: number }>();
  for (const r of reqs) {
    if (!r.reason) continue;
    const cur = reasonMap.get(r.reason) ?? { reqs: 0, positions: 0 };
    cur.reqs += 1; cur.positions += r.positions;
    reasonMap.set(r.reason, cur);
  }
  const reasons = CANCEL_REASONS
    .map((reason) => ({ reason, ...(reasonMap.get(reason) ?? { reqs: 0, positions: 0 }) }))
    .filter((r) => r.reqs > 0)
    .sort((a, b) => b.reqs - a.reqs);

  const totals = {
    created: reqs.length,
    positions: reqs.reduce((s, r) => s + r.positions, 0),
    won: reqs.filter((r) => r.outcome === 'won').length,
    wonPositions: reqs.filter((r) => r.outcome === 'won').reduce((s, r) => s + r.positions, 0),
    cancelled: reqs.filter((r) => r.outcome === 'cancelled').length,
    cancelledPositions: reqs.filter((r) => r.outcome === 'cancelled').reduce((s, r) => s + r.positions, 0),
    lost: reqs.filter((r) => r.outcome === 'lost').length,
    live: reqs.filter((r) => r.outcome === 'live').length,
    onHold: reqs.filter((r) => r.status === 'On Hold').length,
    winRate: 0,
  };
  totals.winRate = totals.created ? Math.round((totals.won / totals.created) * 100) : 0;

  const duplicateAccounts = Array.from(dupes.values())
    .filter((set) => set.size > 1)
    .map((set) => Array.from(set).join(' / '));

  return {
    months,
    reqs,
    customers,
    monthRows,
    reasons,
    totals,
    quality: {
      stageMismatch: reqs.filter((r) => r.stageMismatch).length,
      noReason: reqs.filter((r) => r.reason === 'No reason recorded'
        || r.reason === 'In pipeline when closed — reason unclear').length,
      duplicateAccounts,
    },
  };
}
