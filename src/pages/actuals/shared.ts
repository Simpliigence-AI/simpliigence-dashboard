/**
 * Aggregation helpers for the Actual Hours page.
 *
 * Re-shapes the raw `ActualHourEntry[]` from useActualHoursStore into the
 * same `EmployeeGroup` structure the Project Team page uses for forecast
 * data, so we can reuse the same visual primitives (AllocationStrip,
 * master-list rows, etc.) with the actuals values.
 */
import { MONTHS } from '../../types/forecast';
import type { Month, ForecastAssignment } from '../../types/forecast';
import type { ActualHourEntry } from '../../types/actualHours';

/** Per-(employee, project) bucket shaped like ForecastAssignment so the
 *  team-page AllocationStrip can render it without modification. */
export interface ActualAssignment {
  /** Synthetic id: `<empId>|<projectKey>`. */
  id: string;
  employeeName: string;
  email: string | null;
  project: string;
  monthlyTotals: Record<Month, number>;
  /** Real per-date hours from Zoho People. Sparse — only days they logged. */
  weeklyHours: Record<string, number>;
  /** All Zoho rows that went into this bucket (for detail / drilldown). */
  raw: ActualHourEntry[];
}

export interface ActualEmployeeGroup {
  name: string;
  email: string | null;
  assignments: ActualAssignment[];
  totalHours: number;
}

export function emptyMonthCounter(): Record<Month, number> {
  return { Jan: 0, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0, Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0 };
}

/** Month-of-year only — the year is dropped. Never use it to decide whether a
 *  date is inside a window; that is what `isComparisonDate` is for. */
export function monthOf(dateStr: string): Month {
  const d = new Date(dateStr + 'T00:00:00Z');
  return MONTHS[d.getUTCMonth()];
}

/* ─── Forecast-vs-Actual comparison window ───────────────────────── */

/**
 * First date the Forecast-vs-Actual tab compares.
 *
 * That tab counts only hours people entered themselves on /my-time, and
 * /my-time became the way hours are recorded in August 2026. Earlier months
 * hold almost no entries, so including them would read as a huge shortfall
 * against forecast when really it is just missing data. Move the window by
 * editing this one constant — nothing else hard-codes the date.
 */
export const COMPARISON_START_DATE = '2026-08-01';

/** Last date of the window. The grid runs to Dec, so without an upper bound a
 *  January-2027 row would pass the `>=` test and then be counted by the
 *  Project sub-view (which sums whole entries, not months) but not shown. */
export const COMPARISON_END_DATE = `${COMPARISON_START_DATE.slice(0, 4)}-12-31`;

export const COMPARISON_START_MONTH: Month = monthOf(COMPARISON_START_DATE);

/** The months the comparison covers: COMPARISON_START_MONTH through Dec. */
export const COMPARISON_MONTHS: Month[] = MONTHS.slice(MONTHS.indexOf(COMPARISON_START_MONTH));

/** e.g. "Aug 2026" — for prose that names when the window opens. */
export const COMPARISON_START_LABEL =
  `${COMPARISON_START_MONTH} ${COMPARISON_START_DATE.slice(0, 4)}`;

/** e.g. "Aug–Dec 2026" — for column headers and captions. */
export const COMPARISON_WINDOW_LABEL =
  `${COMPARISON_MONTHS[0]}–${COMPARISON_MONTHS[COMPARISON_MONTHS.length - 1]} ${COMPARISON_START_DATE.slice(0, 4)}`;

/** True when a `YYYY-MM-DD` date falls inside the comparison window. A real
 *  date comparison, not a month-name test: an Aug 2025 row is out of window
 *  even though its month is in it. `YYYY-MM-DD` sorts lexicographically. */
export function isComparisonDate(dateStr: string): boolean {
  return dateStr >= COMPARISON_START_DATE && dateStr <= COMPARISON_END_DATE;
}

/* ─── Week helpers (used by Forecast-vs-Actual week view) ────────── */

export function isoWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function fmtWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function ytdWeeks(): string[] {
  const now = new Date();
  const year = now.getUTCFullYear();
  const start = isoWeekStart(new Date(Date.UTC(year, 0, 1)));
  const end = isoWeekStart(now);
  const weeks: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    weeks.push(ymd(d));
  }
  return weeks;
}

/** Aggregate raw timesheet rows into employee × project buckets. */
export function aggregateActuals(entries: ActualHourEntry[]): ActualEmployeeGroup[] {
  const byEmp = new Map<string, Map<string, ActualAssignment>>();
  const emailByEmp = new Map<string, string | null>();

  for (const e of entries) {
    if (!e.employeeName || !e.workDate || !Number.isFinite(e.hours) || e.hours <= 0) continue;
    const empKey = e.employeeName;
    const projKey = e.project || '(no project)';

    if (!byEmp.has(empKey)) byEmp.set(empKey, new Map());
    if (!emailByEmp.has(empKey)) emailByEmp.set(empKey, e.email);

    const projMap = byEmp.get(empKey)!;
    let bucket = projMap.get(projKey);
    if (!bucket) {
      bucket = {
        id: `${e.employeeId || empKey}|${projKey}`,
        employeeName: empKey,
        email: e.email,
        project: projKey,
        monthlyTotals: emptyMonthCounter(),
        weeklyHours: {},
        raw: [],
      };
      projMap.set(projKey, bucket);
    }
    bucket.monthlyTotals[monthOf(e.workDate)] += e.hours;
    bucket.weeklyHours[e.workDate] = (bucket.weeklyHours[e.workDate] ?? 0) + e.hours;
    bucket.raw.push(e);
  }

  const out: ActualEmployeeGroup[] = [];
  for (const [name, projMap] of byEmp) {
    const assignments = [...projMap.values()].sort((a, b) => {
      const aT = MONTHS.reduce((s, m) => s + a.monthlyTotals[m], 0);
      const bT = MONTHS.reduce((s, m) => s + b.monthlyTotals[m], 0);
      return bT - aT;
    });
    const totalHours = assignments.reduce(
      (s, a) => s + MONTHS.reduce((ss, m) => ss + a.monthlyTotals[m], 0),
      0,
    );
    out.push({ name, email: emailByEmp.get(name) ?? null, assignments, totalHours });
  }
  return out.sort((a, b) => b.totalHours - a.totalHours);
}

/** Cast our ActualAssignment to the shape AllocationStrip expects.
 *  AllocationStrip props read employeeName, project, monthlyTotals, weeklyHours —
 *  which our type already provides directly. Pass-through. */
export function toForecastAssignmentShape(a: ActualAssignment): Pick<ForecastAssignment, 'employeeName' | 'project' | 'monthlyTotals' | 'weeklyHours'> {
  return {
    employeeName: a.employeeName,
    project: a.project,
    monthlyTotals: a.monthlyTotals,
    weeklyHours: a.weeklyHours,
  };
}
