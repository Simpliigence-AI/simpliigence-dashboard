/**
 * Realistic close forecast for India Demand.
 *
 * Replaces the "optimistic / realistic / conservative / at risk" buckets
 * (which just applied a probability threshold to the raw open-position sum,
 * ignoring account history and the "many open, few close" reality) with two
 * grounded numbers: what's realistically closing THIS month and NEXT month.
 *
 * The core idea is a per-account monthly close cadence. If Persistent has
 * closed ~2 positions/month over the last 6 months, they can't magically
 * close their 10 open reqs this month — even if half of them are at 70%
 * probability. So per account we:
 *   1. Compute how many positions they've historically closed per month.
 *   2. Rank their open reqs by likelihood (stage + probability + ageing).
 *   3. Pick top-ranked reqs into "this month" or "next month" up to their
 *      historical cadence — the rest stay in the "queue" and don't show up
 *      in either bucket (they're implicitly deferred).
 *
 * Target month for each individual req is decided by close_by_date when set,
 * else stage: Client Round / Onboarding → this month, Screening / Sourcing
 * → next month.
 */

export interface ForecastRow {
  id: string;
  account: string;
  requisition: string;
  stage: string;
  ageing: number;
  newPositions: number;
  openPositions: number;
  closureProb: number;
  statusField: string;
  closeByDate: string;
}

export interface ForecastEntry {
  reqId: string;
  account: string;
  title: string;
  positions: number;
  stage: string;
  ageing: number;
  closureProb: number;
  score: number;
  reason: string;
}

export interface MonthBucket {
  monthLabel: string;      // "August 2026"
  positions: number;       // total positions realistically closing
  entries: ForecastEntry[];
}

export interface RealisticForecast {
  thisMonth: MonthBucket;
  nextMonth: MonthBucket;
  perAccount: Array<{
    account: string;
    monthlyCadence: number;   // avg positions/mo over the last 6 months
    openReqs: number;
    thisMonthPicked: number;
    nextMonthPicked: number;
    deferred: number;         // open reqs that didn't make either bucket
  }>;
}

const HISTORICAL_MONTHS = 6;
const MIN_SCORE_TO_BET = 30;
const DEFAULT_CADENCE_NO_HISTORY = 1;
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** Score how likely one req is to close in its target month — stage + prob + ageing decay. */
function scoreReq(r: ForecastRow): number {
  let s = r.closureProb || 0;
  // Stage progress boost — a req at Client Round is closer than one at Sourcing
  // even at the same manual probability.
  const stageBoost: Record<string, number> = {
    'Onboarding': 25,
    'Client Round': 15,
    'Interview': 12,
    'Screening': 6,
    'Sourcing': 0,
    'Open': -5,
  };
  s += stageBoost[r.stage] ?? 0;
  // Ageing decay — reqs that have sat unfilled for a long time are stalling.
  if (r.ageing > 60) s -= 20;
  else if (r.ageing > 45) s -= 12;
  else if (r.ageing > 30) s -= 5;
  return Math.max(0, Math.min(100, s));
}

/**
 * Decide whether an open req is targeting this month, next month, or beyond.
 * close_by_date wins if set. Otherwise fall back to stage: reqs at
 * Client Round / Onboarding usually finish inside the current month; earlier
 * stages slip to next.
 */
function classifyMonth(
  r: ForecastRow,
  thisMonthStart: Date,
  thisMonthEnd: Date,
  nextMonthStart: Date,
  nextMonthEnd: Date,
): 'this' | 'next' | null {
  if (r.closeByDate) {
    const cd = new Date(r.closeByDate);
    if (isNaN(cd.getTime())) return classifyByStage(r.stage);
    if (cd < thisMonthStart) return 'this';           // past due — still trying
    if (cd >= thisMonthStart && cd <= thisMonthEnd) return 'this';
    if (cd >= nextMonthStart && cd <= nextMonthEnd) return 'next';
    return null;                                       // further out — don't include
  }
  return classifyByStage(r.stage);
}

function classifyByStage(stage: string): 'this' | 'next' {
  if (stage === 'Onboarding' || stage === 'Client Round' || stage === 'Interview') return 'this';
  return 'next';
}

/** "August 2026" style label */
export function monthLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Build a per-account map of positions historically closed per month over
 * the last N months. This is the ceiling we cap each account's per-month
 * forecast at, so multiple open reqs against the same account don't inflate
 * the total.
 */
function computeMonthlyCadence(rows: ForecastRow[], now: Date): Map<string, number> {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - HISTORICAL_MONTHS);
  const perAccount = new Map<string, number>();
  for (const r of rows) {
    if (r.statusField !== 'Closed Won' && r.statusField !== 'Closed' && r.statusField !== 'Onboarding') continue;
    if (!r.closeByDate) continue;
    const cd = new Date(r.closeByDate);
    if (isNaN(cd.getTime()) || cd < cutoff) continue;
    perAccount.set(r.account, (perAccount.get(r.account) ?? 0) + r.newPositions);
  }
  const cadence = new Map<string, number>();
  for (const [acct, total] of perAccount) {
    cadence.set(acct, total / HISTORICAL_MONTHS);
  }
  return cadence;
}

/** Human explanation for one entry in the forecast — what's earning the bet. */
function reasonText(r: ForecastRow, cadence: number | null): string {
  const parts: string[] = [];
  if (cadence != null && cadence > 0) {
    parts.push(`${r.account} closes ~${cadence.toFixed(1)}/mo`);
  } else {
    parts.push(`${r.account} has no recent close history`);
  }
  parts.push(`${r.stage.toLowerCase()}`);
  if (r.ageing > 0) parts.push(`${r.ageing}d ageing`);
  parts.push(`prob ${r.closureProb}%`);
  return parts.join(' · ');
}

/**
 * Main entry. Given the enriched row list, return two buckets ranked by
 * likelihood, respecting each account's historical cadence.
 */
export function forecastRealisticClosures(rows: ForecastRow[], now: Date = new Date()): RealisticForecast {
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59);

  const cadence = computeMonthlyCadence(rows, now);

  const openByAccount = new Map<string, ForecastRow[]>();
  for (const r of rows) {
    // Skip closed / cancelled — they don't need forecasting.
    const skip = new Set(['Closed Won', 'Closed', 'Closed Lost', 'Cancelled', 'On Hold']);
    if (skip.has(r.statusField)) continue;
    if (r.openPositions <= 0) continue;
    if (!openByAccount.has(r.account)) openByAccount.set(r.account, []);
    openByAccount.get(r.account)!.push(r);
  }

  const thisMonthEntries: ForecastEntry[] = [];
  const nextMonthEntries: ForecastEntry[] = [];
  const perAccount: RealisticForecast['perAccount'] = [];

  for (const [acct, reqs] of openByAccount) {
    const c = cadence.get(acct);
    // If we have no history, assume they can close 1 position/mo if they've
    // moved anything into interview / onboarding, otherwise 0.5. This prevents
    // a brand-new account from getting an inflated forecast, but doesn't
    // punish them entirely for not having history yet.
    const hasProgress = reqs.some((r) => r.stage === 'Client Round' || r.stage === 'Interview' || r.stage === 'Onboarding');
    const effectiveCadence = c != null && c > 0 ? c : (hasProgress ? DEFAULT_CADENCE_NO_HISTORY : 0.5);
    const cap = Math.max(1, Math.round(effectiveCadence));

    const scored = reqs
      .map((r) => {
        const score = scoreReq(r);
        const target = classifyMonth(r, thisMonthStart, thisMonthEnd, nextMonthStart, nextMonthEnd);
        return { req: r, score, target };
      })
      .filter((x) => x.score >= MIN_SCORE_TO_BET && x.target !== null)
      .sort((a, b) => b.score - a.score);

    let thisPicked = 0;
    let nextPicked = 0;
    for (const { req, score, target } of scored) {
      const entry: ForecastEntry = {
        reqId: req.id,
        account: acct,
        title: req.requisition,
        positions: req.openPositions,
        stage: req.stage,
        ageing: req.ageing,
        closureProb: req.closureProb,
        score,
        reason: reasonText(req, c ?? null),
      };
      if (target === 'this' && thisPicked + req.openPositions <= cap) {
        thisMonthEntries.push(entry);
        thisPicked += req.openPositions;
      } else if (target === 'next' && nextPicked + req.openPositions <= cap) {
        nextMonthEntries.push(entry);
        nextPicked += req.openPositions;
      }
    }

    perAccount.push({
      account: acct,
      monthlyCadence: c ?? 0,
      openReqs: reqs.reduce((s, r) => s + r.openPositions, 0),
      thisMonthPicked: thisPicked,
      nextMonthPicked: nextPicked,
      deferred: reqs.reduce((s, r) => s + r.openPositions, 0) - thisPicked - nextPicked,
    });
  }

  thisMonthEntries.sort((a, b) => b.score - a.score);
  nextMonthEntries.sort((a, b) => b.score - a.score);
  perAccount.sort((a, b) => b.thisMonthPicked + b.nextMonthPicked - (a.thisMonthPicked + a.nextMonthPicked));

  return {
    thisMonth: {
      monthLabel: monthLabel(now),
      positions: thisMonthEntries.reduce((s, e) => s + e.positions, 0),
      entries: thisMonthEntries,
    },
    nextMonth: {
      monthLabel: monthLabel(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
      positions: nextMonthEntries.reduce((s, e) => s + e.positions, 0),
      entries: nextMonthEntries,
    },
    perAccount,
  };
}
