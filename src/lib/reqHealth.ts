/**
 * Requisition health and closure scorecards for the India Demand screen.
 *
 * Health answers "which roles need me today?" with one colour per role:
 *   red    overdue      past its close-by date, or open 30+ days with no close-by date set
 *   green  fast close   a candidate is at interview stage or beyond (interview, client
 *                       round, selected, offer) — the role is close to closing
 *   amber  needs a push close-by date within 7 days, or open 15+ days with no close-by
 *                       date, or no status update for 7+ days
 *   none   on track     everything else; also On Hold roles, which nobody should chase
 *
 * Overdue wins over fast close (the date is a fact), but an overdue role that is
 * interviewing keeps `interviewing: true` so the screen can show both.
 *
 * The signal for "fast close" is the CANDIDATES on the role, never the role's own
 * `stage`: in practice every live role sits at "Sourcing" regardless of progress.
 *
 * Closures count positions, not requisitions: a position closes when a candidate
 * accepts the offer. See buildClosureScorecard. Internal accounts are always reported
 * separately.
 */
import type { StaffingAccount, StaffingRequisition, StaffingHistoryEntry, StaffingStatus, StaffingCandidate } from '../types/staffing';
import { ARCHIVED_STATUSES } from '../types/staffing';
import { closedMonth, monthKey } from './indiaDemandAnalytics';

export type ReqHealth = 'overdue' | 'fast' | 'push' | 'ok';

export interface ReqHealthInfo {
  health: ReqHealth;
  /** Short label for the badge: "Overdue 12d", "Interviewing", "Due in 3d". */
  label: string;
  /** One sentence for the tooltip explaining why. */
  detail: string;
  /** A candidate is at interview stage or beyond, whatever the headline colour is. */
  interviewing: boolean;
}

/** Candidate stages that mean the role is close to closing. */
export const FAST_CLOSE_STAGES = [
  'Interview Scheduled', 'Interviewed', 'Shortlisted', 'Client Round', 'Selected', 'Offer Extended',
] as const;
const OFFER_STAGES = new Set<string>(['Selected', 'Offer Extended']);
const FAST_SET = new Set<string>(FAST_CLOSE_STAGES);

export const OVERDUE_NO_DATE_DAYS = 30;
export const PUSH_NO_DATE_DAYS = 15;
export const PUSH_DUE_WITHIN_DAYS = 7;
export const PUSH_STALE_UPDATE_DAYS = 7;

const DAY = 86_400_000;
const dayStart = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
/** Whole days from `iso` (YYYY-MM-DD…) to `today`; positive when `iso` is in the past. null if unparseable. */
export function daysSince(iso: string | null | undefined, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  return Math.round((dayStart(today) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / DAY);
}

export function computeReqHealth(input: {
  statusField: StaffingStatus;
  closeByDate: string;
  /** Days since the role opened; 0 when no start date. */
  ageing: number;
  /** Stages of the candidates currently on this role. */
  candidateStages: string[];
  /** Date of the latest status update (YYYY-MM-DD), '' if none. */
  lastStatusDate: string;
}, today: Date = new Date()): ReqHealthInfo {
  const interviewing = input.candidateStages.some((s) => FAST_SET.has(s));
  const atOffer = input.candidateStages.some((s) => OFFER_STAGES.has(s));
  const fastLabel = atOffer ? 'Offer stage' : 'Interviewing';

  if (ARCHIVED_STATUSES.includes(input.statusField)) return { health: 'ok', label: '', detail: '', interviewing: false };
  if (input.statusField === 'On Hold') return { health: 'ok', label: '', detail: 'On hold', interviewing };

  const pastDue = daysSince(input.closeByDate, today); // > 0 once the close-by date has passed
  if (pastDue != null && pastDue > 0) {
    return { health: 'overdue', label: `Overdue ${pastDue}d`, interviewing,
      detail: `Close-by date was ${input.closeByDate}, ${pastDue} day${pastDue === 1 ? '' : 's'} ago.${interviewing ? ` ${fastLabel}.` : ''}` };
  }
  if (pastDue == null && input.ageing >= OVERDUE_NO_DATE_DAYS) {
    return { health: 'overdue', label: `Open ${input.ageing}d`, interviewing,
      detail: `Open ${input.ageing} days with no close-by date set.${interviewing ? ` ${fastLabel}.` : ''}` };
  }

  if (interviewing) {
    return { health: 'fast', label: fastLabel, interviewing,
      detail: atOffer ? 'A candidate is selected or has an offer. Close it out.' : 'A candidate is at interview stage or beyond.' };
  }

  if (pastDue != null && pastDue > -PUSH_DUE_WITHIN_DAYS - 1) {
    const left = -pastDue;
    return { health: 'push', label: left === 0 ? 'Due today' : `Due in ${left}d`, interviewing,
      detail: `Close-by date is ${input.closeByDate} and nobody is at interview stage yet.` };
  }
  if (pastDue == null && input.ageing >= PUSH_NO_DATE_DAYS) {
    return { health: 'push', label: `Open ${input.ageing}d`, interviewing,
      detail: `Open ${input.ageing} days with no close-by date and nobody at interview stage.` };
  }
  const stale = daysSince(input.lastStatusDate, today);
  if (stale != null && stale >= PUSH_STALE_UPDATE_DAYS) {
    return { health: 'push', label: `No update ${stale}d`, interviewing,
      detail: `No status update for ${stale} days.` };
  }
  return { health: 'ok', label: '', detail: '', interviewing };
}

/** Keep in sync with ShareToReferralsToggle.isInternalAccountName (not imported: this file stays UI-free). */
export function isInternalAccount(name?: string | null): boolean {
  const n = (name || '').trim().toLowerCase();
  return n.startsWith('internal') || n.startsWith('simpliigence');
}

/** External positions the team aims to close each month. */
export const MONTHLY_EXTERNAL_CLOSE_TARGET = 10;

export interface ClosureScorecard {
  /** YYYY-MM of "this month". */
  month: string;
  year: number;
  external: { closedThisMonth: number; target: number; closedThisYear: number; openPositions: number };
  internal: { closedThisMonth: number; openPositions: number; closedThisYear: number };
  /** External positions closed per month, January to the current month. */
  externalByMonth: { month: string; closed: number }[];
}

/** Candidate stages that lock a position in. A position counts as closed from this point. */
const FILLED_STAGES = new Set<string>(['Offer Accepted', 'Joined']);

/**
 * Positions closed this month and this year, external and internal apart.
 *
 * A position is closed when a candidate accepts the offer (or joins), which is what
 * the team means by "closed" — not when the requisition's status is later switched to
 * Closed Won. A four-position role that has filled one seat shows one closure now,
 * while the role itself stays In Progress.
 *
 *  1. Each candidate at Offer Accepted / Joined is one closed position, in the month
 *     of `filled_at` (stamped by the database when the stage is first reached).
 *  2. A Closed Won requisition also counts any positions NOT covered by such
 *     candidates (many closed roles have no candidate rows at all), in the month the
 *     status flipped. So nothing is counted twice and nothing closed is missed.
 *
 * `openPositionsByReq` is the page's own open-position count per live requisition
 * (requested minus filled), so the scorecard agrees with the rows beneath it.
 */
export function buildClosureScorecard(
  accounts: StaffingAccount[],
  requisitions: StaffingRequisition[],
  history: StaffingHistoryEntry[],
  candidates: Pick<StaffingCandidate, 'requisition_id' | 'stage' | 'filled_at' | 'updated_at'>[],
  openPositionsByReq: Map<string, number>,
  today: Date = new Date(),
): ClosureScorecard {
  const year = today.getFullYear();
  const month = `${year}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const internalById = new Map(accounts.map((a) => [a.id, isInternalAccount(a.name)]));
  const historyByReq = new Map<string, StaffingHistoryEntry[]>();
  for (const h of history) {
    if (h.field !== 'status_field') continue;
    const list = historyByReq.get(h.requisition_id);
    if (list) list.push(h); else historyByReq.set(h.requisition_id, [h]);
  }
  // Months in which each requisition's filled candidates locked in.
  const filledMonthsByReq = new Map<string, string[]>();
  for (const c of candidates) {
    if (!c.requisition_id || !FILLED_STAGES.has(c.stage)) continue;
    // filled_at is missing for a moment after a local stage change, until the next sync.
    const m = monthKey(c.filled_at || c.updated_at);
    const list = filledMonthsByReq.get(c.requisition_id);
    if (list) list.push(m); else filledMonthsByReq.set(c.requisition_id, [m]);
  }

  const byMonth = new Map<string, number>();
  for (let m = 1; m <= today.getMonth() + 1; m++) byMonth.set(`${year}-${String(m).padStart(2, '0')}`, 0);
  const out: ClosureScorecard = {
    month, year,
    external: { closedThisMonth: 0, target: MONTHLY_EXTERNAL_CLOSE_TARGET, closedThisYear: 0, openPositions: 0 },
    internal: { closedThisMonth: 0, openPositions: 0, closedThisYear: 0 },
    externalByMonth: [],
  };

  for (const r of requisitions) {
    const internal = internalById.get(r.account_id) === true;
    const side = internal ? out.internal : out.external;
    const credit = (m: string, positions: number) => {
      if (positions <= 0 || !m) return;
      if (m.startsWith(String(year))) {
        side.closedThisYear += positions;
        if (!internal && byMonth.has(m)) byMonth.set(m, (byMonth.get(m) || 0) + positions);
      }
      if (m === month) side.closedThisMonth += positions;
    };

    // A cancelled or lost role closes nothing, even if a candidate row was left at a filled stage.
    const dead = r.status_field === 'Cancelled' || r.status_field === 'Closed Lost';
    const filledMonths = dead ? [] : (filledMonthsByReq.get(r.id) ?? []);
    for (const m of filledMonths) credit(m, 1);

    if (r.status_field === 'Closed Won') {
      const remainder = Math.max(1, r.new_positions || 0) - filledMonths.length;
      credit(closedMonth(r, historyByReq), remainder);
    } else if (!ARCHIVED_STATUSES.includes(r.status_field) && r.status_field !== 'On Hold') {
      side.openPositions += openPositionsByReq.get(r.id) ?? Math.max(0, r.new_positions || 0);
    }
  }
  out.externalByMonth = Array.from(byMonth, ([m, closed]) => ({ month: m, closed }));
  return out;
}
