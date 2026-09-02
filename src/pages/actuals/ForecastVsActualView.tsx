/**
 * Forecast vs Actual comparison view.
 *
 * Inner toggle: Month | Week | Project. Each cell shows (Forecast / Actual / Δ)
 * with a hover tooltip explaining the calculation.
 *
 * Three rules keep the comparison honest:
 *
 *  - Actuals come straight from `time_entries` — the table /my-time writes to
 *    — and never from the Zoho side. The other tabs read the
 *    `unified_actual_hours` view, which UNIONs Zoho history in and tags each
 *    branch with a `source`; this tab wanted only one of those branches, so
 *    reading the branch itself is both narrower and one fewer thing to go
 *    wrong (a view that stops emitting `source`, or a fallback to the legacy
 *    Zoho table, used to empty this tab out completely).
 *  - Only `submitted` and `approved` rows count, the same statuses the view
 *    admitted. A draft is hours someone typed but has not stood behind yet.
 *  - Both sides are keyed on the person's EMAIL. `time_entries` stores one
 *    (`employee_email`), so the actuals side needs no name matching at all;
 *    the forecast sheet stores free-text names, so those go through the
 *    shared resolver, and a name the directory cannot identify is listed
 *    under the table as a data-quality item rather than silently splitting
 *    into a second half-empty row.
 *
 * Only from COMPARISON_START_DATE onward, either way — /my-time became how
 * hours are recorded in Aug 2026, and earlier months hold almost no entries,
 * so showing them would read as a shortfall when it is really missing data.
 *
 * The other tabs on this page are unaffected: they still read the view.
 */
import { useEffect, useMemo, useState } from 'react';
import { useForecastStore } from '../../store';
import { useTimeEntryStore } from '../../store/useTimeEntryStore';
import { useAuthStore } from '../../store/useAuthStore';
import type { Month, ForecastAssignment } from '../../types/forecast';
import type { TimeEntry, TimeEntryStatus } from '../../types/timeEntry';
import { buildEmailResolver, type Resolver } from '../../lib/resolveEmployeeEmail';
import {
  emptyMonthCounter,
  monthOf,
  isoWeekStart,
  ymd,
  fmtWeek,
  ytdWeeks,
  isComparisonDate,
  COMPARISON_MONTHS,
  COMPARISON_START_LABEL,
  COMPARISON_WINDOW_LABEL,
} from './shared';

type ForecastSubTab = 'month' | 'week' | 'project';
const FCAST_SUB_KEY = 'actual-hours-forecast-sub';

/**
 * The statuses that count as actual worked hours — the same set
 * `unified_actual_hours` admitted from `time_entries`. `draft` is hours typed
 * but not stood behind; `rejected` was looked at and sent back.
 *
 * Deliberately NOT filtered on `time_entries.source`: the view didn't either,
 * it tagged the whole `time_entries` branch 'simpliigence' regardless, and
 * dropping rows on a column that defaults to the value we want is how this
 * tab emptied itself out in the first place.
 */
const COUNTED_STATUSES = new Set<TimeEntryStatus>(['submitted', 'approved']);

/** One /my-time row cut down to what the sub-views compare, already keyed on
 *  the person the same way the forecast side is. */
interface ActualRow {
  key: string;
  workDate: string;
  hours: number;
  project: string;
}

function loadForecastSub(): ForecastSubTab {
  if (typeof window === 'undefined') return 'month';
  const v = window.localStorage.getItem(FCAST_SUB_KEY);
  return v === 'week' || v === 'project' ? v : 'month';
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The join key for one person, used identically for forecast rows and for
 * timesheet rows: their email when we know it — straight off the row, or
 * resolved from their name — else the normalised name, so an unidentifiable
 * spelling at least groups with itself.
 */
function personKey(name: string, email: string | null, resolve: Resolver): string {
  const resolved = (email ?? resolve(name))?.trim().toLowerCase();
  return resolved || normName(name);
}

interface Person {
  /** personKey() — what both lookup maps below are keyed on. */
  key: string;
  /** Name to show in the Employee column. */
  name: string;
  /** Lowercased haystack for the page's search box. */
  search: string;
}

function fmtSigned(n: number): string {
  if (Math.abs(n) < 0.5) return '0';
  return (n > 0 ? '+' : '') + (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
}

function deltaColor(forecast: number, actual: number): string {
  if (forecast <= 0 && actual <= 0) return 'text-line';
  if (forecast <= 0) return 'bg-sky-50 text-sky-700';
  if (actual <= 0) return 'bg-surface-2/70 text-muted/70';
  const ratio = actual / forecast;
  const off = Math.abs(ratio - 1);
  if (off <= 0.1) return 'bg-emerald-50 text-emerald-700';
  if (off <= 0.25) return 'bg-amber-50 text-amber-700';
  return 'bg-rose-50 text-rose-700';
}

function tooltip(label: string, forecast: number, actual: number): string {
  const delta = actual - forecast;
  const pct = forecast > 0 ? Math.round((actual / forecast - 1) * 100) : null;
  const pctStr = pct === null ? 'n/a (no forecast)' : `${pct > 0 ? '+' : ''}${pct}%`;
  return [
    label,
    `  Forecast: ${forecast.toFixed(1)} hrs`,
    `  Actual:   ${actual.toFixed(1)} hrs`,
    `  Δ:        ${delta > 0 ? '+' : ''}${delta.toFixed(1)} hrs (${pctStr})`,
  ].join('\n');
}

interface ForecastVsActualProps {
  search?: string;
}

export default function ForecastVsActualView({ search = '' }: ForecastVsActualProps) {
  // `time_entries`, not the unified view — see the note at the top of the
  // file. App.tsx hydrates this store on init alongside everything else, and
  // the realtime subscription refreshes it, so /actual-hours already has it.
  const entries = useTimeEntryStore((s) => s.entries);
  const assignments = useForecastStore((s) => s.assignments);
  const directory = useAuthStore((s) => s.directory);
  const [sub, setSub] = useState<ForecastSubTab>(() => loadForecastSub());
  useEffect(() => {
    try { window.localStorage.setItem(FCAST_SUB_KEY, sub); } catch { /* ignore */ }
  }, [sub]);

  const resolveEmail = useMemo(
    () => buildEmailResolver(Object.values(directory).map((u) => ({ fullName: u.fullName, email: u.email }))),
    [directory],
  );

  /** In-window rows of ANY status. The three sets are kept apart so an empty
   *  Actual column can say which step lost the hours: the date, the status, or
   *  nothing having loaded at all. */
  const windowEntries = useMemo(
    () => entries.filter((e) => !!e.workDate && isComparisonDate(e.workDate)),
    [entries],
  );

  /** The only actuals this tab counts. */
  const actualRows = useMemo(
    () => windowEntries
      .filter((e) => COUNTED_STATUSES.has(e.status) && e.hours > 0 && !!e.employeeEmail)
      .map((e): ActualRow => ({
        // `employee_email` IS the identity column on time_entries, so the
        // join key needs no resolving on this side — it is already an email.
        key: e.employeeEmail.trim().toLowerCase(),
        workDate: e.workDate,
        hours: e.hours,
        project: e.projectName,
      })),
    [windowEntries],
  );

  const actualsByKey = useMemo(() => {
    const map = new Map<string, ActualRow[]>();
    for (const r of actualRows) {
      const list = map.get(r.key);
      if (list) list.push(r); else map.set(r.key, [r]);
    }
    return map;
  }, [actualRows]);

  const keyOfName = useMemo(
    () => (name: string) => personKey(name, null, resolveEmail),
    [resolveEmail],
  );

  /** One row per person, from both sides of the comparison. */
  const people = useMemo(() => {
    const spellings = new Map<string, Set<string>>();
    const note = (key: string, spelling: string) => {
      const seen = spellings.get(key);
      if (seen) seen.add(spelling); else spellings.set(key, new Set([spelling]));
    };
    for (const a of assignments) note(personKey(a.employeeName, null, resolveEmail), a.employeeName);
    // The actuals side has an email and no name, so the email is the only
    // spelling it can offer; the directory supplies a real name below when it
    // knows the person, and the email is a fair label when it does not.
    for (const r of actualRows) note(r.key, r.key);
    return [...spellings]
      .map(([key, names]): Person => {
        // Prefer the directory spelling — it is the name both sides resolved to.
        const name = directory[key]?.fullName ?? [...names][0];
        // Search still has to find the row by whatever the searcher remembers,
        // which may be the forecast sheet's short name rather than the full one.
        return { key, name, search: [name, ...names, key].join(' ').toLowerCase() };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assignments, actualRows, resolveEmail, directory]);

  /**
   * Forecast names no one in the directory matches. Shown under the table: a
   * genuine spelling drift in the forecast sheet should read as something to
   * fix, not quietly render as two half-empty rows. Only the forecast side can
   * land here now — every `time_entries` row carries an email.
   */
  const unmatchedNames = useMemo(() => {
    // Directory not loaded yet — every name would look unmatched.
    if (Object.keys(directory).length === 0) return [];
    const set = new Set<string>();
    for (const a of assignments) if (!resolveEmail(a.employeeName)) set.add(a.employeeName);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [assignments, resolveEmail, directory]);

  const filteredPeople = useMemo(() => {
    if (!search) return people;
    const q = search.toLowerCase();
    return people.filter((p) => p.search.includes(q));
  }, [people, search]);

  if (assignments.length === 0) {
    return (
      <div className="text-center py-10 text-muted/70 text-sm">
        No forecast data — fill in the Project Team page first.
      </div>
    );
  }

  const subViewProps = { people: filteredPeople, assignments, keyOfName, actualsByKey };

  // Nothing loaded at all — not even a draft. There is no comparison to draw
  // and the store may simply still be cold, so don't draw a grid of blanks.
  if (entries.length === 0) {
    return <NoActuals entries={entries} windowEntries={windowEntries} standalone />;
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] text-muted uppercase tracking-wider">Compare by</span>
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-xs">
          <SubToggle active={sub === 'month'} onClick={() => setSub('month')}>Month</SubToggle>
          <SubToggle active={sub === 'week'} onClick={() => setSub('week')}>Week</SubToggle>
          <SubToggle active={sub === 'project'} onClick={() => setSub('project')}>Project</SubToggle>
        </div>
        <span className="ml-3 text-[10px] text-muted/70">
          Hover any cell for the calculation.
        </span>
      </div>

      <p className="mb-3 text-[10px] text-muted/70">
        Actuals are the hours people entered on My Time, totalled per person per month.
        {' '}{COMPARISON_WINDOW_LABEL} only — My Time became the record of hours in {COMPARISON_START_LABEL}.
      </p>

      {actualRows.length === 0 && (
        <NoActuals entries={entries} windowEntries={windowEntries} />
      )}

      <Legend />

      {sub === 'month' && <FCMonthView {...subViewProps} />}
      {sub === 'week' && <FCWeekView {...subViewProps} />}
      {sub === 'project' && <FCProjectView {...subViewProps} />}

      {unmatchedNames.length > 0 && (
        <p className="mt-3 text-[10px] text-amber-700">
          {unmatchedNames.length} name{unmatchedNames.length === 1 ? '' : 's'} could not be matched
          to a person: {unmatchedNames.join(', ')}. These are compared on spelling alone, so a name
          written differently in the forecast sheet and on My Time stays on two rows.
        </p>
      )}
    </div>
  );
}

function SubToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 border-r last:border-r-0 border-line ${
        active ? 'bg-primary text-white' : 'bg-surface text-muted hover:bg-surface-2/70'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Why the Actual column is empty. Four different things go wrong here and
 * they need different people to fix them, so each gets its own sentence:
 * nothing loaded, nothing dated in the window, everything still sitting in
 * draft, or rows that somehow carry no hours. The draft case is the one an
 * admin can act on, so it names the count.
 */
function NoActuals({ entries, windowEntries, standalone = false }: {
  entries: TimeEntry[]; windowEntries: TimeEntry[]; standalone?: boolean;
}) {
  const uncounted = windowEntries.filter((e) => !COUNTED_STATUSES.has(e.status));
  const drafts = uncounted.filter((e) => e.status === 'draft').length;
  const rejected = uncounted.filter((e) => e.status === 'rejected').length;

  // Ordered by which step lost the hours, earliest first.
  const detail = entries.length === 0 ? (
    <>
      No time entries loaded at all. Either the <code>time_entries</code> fetch failed or nobody
      has ever entered time — reload, and check the browser console for a{' '}
      <code>[supabase] fetch time_entries failed</code> line.
    </>
  ) : windowEntries.length === 0 ? (
    <>
      {entries.length.toLocaleString()} time {entries.length === 1 ? 'entry' : 'entries'} loaded,
      but not one is dated {COMPARISON_WINDOW_LABEL}. Nobody has logged hours inside the comparison
      window yet; everything on record predates it.
    </>
  ) : uncounted.length > 0 ? (
    <>
      {windowEntries.length.toLocaleString()} {windowEntries.length === 1 ? 'entry' : 'entries'} dated{' '}
      {COMPARISON_WINDOW_LABEL} exist, but none is submitted or approved
      {drafts > 0 && <> — {drafts.toLocaleString()} {drafts === 1 ? 'is' : 'are'} still a draft</>}
      {rejected > 0 && <>{drafts > 0 ? ' and' : ' —'} {rejected.toLocaleString()} {rejected === 1 ? 'was' : 'were'} rejected</>}.
      Draft hours do not count until the person submits them and a manager approves. Chase the
      submissions rather than the data.
    </>
  ) : (
    <>
      {windowEntries.length.toLocaleString()} submitted or approved{' '}
      {windowEntries.length === 1 ? 'entry' : 'entries'} dated {COMPARISON_WINDOW_LABEL} exist, but
      none carries hours above zero or an employee email. That should not be possible —{' '}
      <code>time_entries</code> constrains hours to be positive, so treat it as a data problem.
    </>
  );

  // Amber only for the case someone can act on; the rest is just news.
  return (
    <div className={`rounded-lg border px-4 py-3 text-xs ${standalone ? '' : 'mb-3'} ${
      uncounted.length > 0
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-line bg-surface-2/70 text-muted'
    }`}>
      <p className="font-semibold mb-1">No actual hours to compare.</p>
      <p>{detail}</p>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-3 text-[10px] text-muted">
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-200" /> ≤10% off</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-50 border border-amber-200" /> ≤25% off</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-50 border border-rose-200" /> &gt;25% off</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-50 border border-sky-200" /> unplanned (actual w/o forecast)</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-surface-2/70 border border-line" /> no actuals yet</span>
    </div>
  );
}

interface SubViewProps {
  people: Person[];
  assignments: ForecastAssignment[];
  /** A forecast row's employee_name → the key `actualsByKey` is grouped on. */
  keyOfName: (employeeName: string) => string;
  actualsByKey: Map<string, ActualRow[]>;
}

/* ─── Month sub-view ───────────────────────────────────────────── */
function FCMonthView({ people, assignments, keyOfName, actualsByKey }: SubViewProps) {
  const forecastByKey = useMemo(() => {
    const map = new Map<string, Record<Month, number>>();
    for (const a of assignments) {
      const k = keyOfName(a.employeeName);
      let bucket = map.get(k);
      if (!bucket) { bucket = emptyMonthCounter(); map.set(k, bucket); }
      // Only the window's months, so the Total row can never pick up a month
      // the grid does not show.
      for (const m of COMPARISON_MONTHS) bucket[m] += a.monthlyTotals[m] ?? 0;
    }
    return map;
  }, [assignments, keyOfName]);

  const actualByKey = useMemo(() => {
    const map = new Map<string, Record<Month, number>>();
    for (const [k, list] of actualsByKey) {
      const bucket = emptyMonthCounter();
      for (const e of list) bucket[monthOf(e.workDate)] += e.hours;
      map.set(k, bucket);
    }
    return map;
  }, [actualsByKey]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th rowSpan={2} className="pb-2 pr-3 font-semibold text-muted align-bottom min-w-[180px]">Employee</th>
            {COMPARISON_MONTHS.map((m) => (
              <th key={m} colSpan={3} className="px-1.5 text-center font-semibold text-muted text-xs border-l border-line/60">{m}</th>
            ))}
          </tr>
          <tr className="border-b border-line text-left">
            {COMPARISON_MONTHS.map((m) => <FCHeaderTriplet key={m} />)}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const fcastMonthly = forecastByKey.get(p.key) ?? emptyMonthCounter();
            const actMonthly = actualByKey.get(p.key) ?? emptyMonthCounter();
            return (
              <tr key={p.key} className="border-b border-line/40 hover:bg-surface-2/70">
                <td className="py-1.5 pr-3 font-medium text-ink">{p.name}</td>
                {COMPARISON_MONTHS.map((m) => {
                  const f = fcastMonthly[m];
                  const a = actMonthly[m];
                  return (
                    <FCTriplet key={m} forecast={f} actual={a} delta={a - f} title={tooltip(`${p.name} — ${m}`, f, a)} />
                  );
                })}
              </tr>
            );
          })}
          {people.length > 1 && (() => {
            // Every person appears once, and their hours live under exactly one
            // key, so summing row by row cannot double-count anybody.
            const totalF = emptyMonthCounter();
            const totalA = emptyMonthCounter();
            for (const p of people) {
              const fc = forecastByKey.get(p.key);
              const ac = actualByKey.get(p.key);
              for (const m of COMPARISON_MONTHS) {
                totalF[m] += fc?.[m] ?? 0;
                totalA[m] += ac?.[m] ?? 0;
              }
            }
            return (
              <tr className="border-t-2 border-line bg-surface-2/70 font-bold">
                <td className="py-2 pr-3 text-ink/80">Total ({people.length})</td>
                {COMPARISON_MONTHS.map((m) => (
                  <FCTriplet key={m} forecast={totalF[m]} actual={totalA[m]} delta={totalA[m] - totalF[m]} title={tooltip(`All — ${m}`, totalF[m], totalA[m])} />
                ))}
              </tr>
            );
          })()}
        </tbody>
      </table>
    </div>
  );
}

function FCHeaderTriplet() {
  return (
    <>
      <th className="pb-2 px-1 font-semibold text-muted/70 text-[9px] text-right uppercase border-l border-line/60">F</th>
      <th className="pb-2 px-1 font-semibold text-muted/70 text-[9px] text-right uppercase">A</th>
      <th className="pb-2 px-1 font-semibold text-muted/70 text-[9px] text-right uppercase">Δ</th>
    </>
  );
}

function FCTriplet({ forecast, actual, delta, title }: {
  forecast: number; actual: number; delta: number; title: string;
}) {
  const color = deltaColor(forecast, actual);
  return (
    <>
      <td className="py-1.5 px-1 text-right tabular-nums text-[11px] text-muted border-l border-line/60" title={title}>
        {forecast > 0 ? forecast.toFixed(0) : '—'}
      </td>
      <td className="py-1.5 px-1 text-right tabular-nums text-[11px] text-ink/80" title={title}>
        {actual > 0 ? actual.toFixed(0) : '—'}
      </td>
      <td className="py-1.5 px-1 text-right tabular-nums" title={title}>
        <span className={`inline-block px-1 py-0.5 rounded text-[11px] font-semibold ${color}`}>
          {(forecast > 0 || actual > 0) ? fmtSigned(delta) : '—'}
        </span>
      </td>
    </>
  );
}

/* ─── Week sub-view ────────────────────────────────────────────── */
function FCWeekView({ people, assignments, keyOfName, actualsByKey }: SubViewProps) {
  // A week belongs to the month its Monday falls in — the same rule the
  // forecast spread below uses, so the window cuts both sides identically.
  const weeks = useMemo(() => ytdWeeks().filter((w) => isComparisonDate(w)), []);
  const weekIndex = useMemo(() => new Map(weeks.map((w, i) => [w, i])), [weeks]);

  const forecastByEmpWeek = useMemo(() => {
    const weeksPerMonth: Record<Month, number> = emptyMonthCounter();
    for (const w of weeks) weeksPerMonth[monthOf(w)] += 1;

    const map = new Map<string, Record<string, number>>();
    for (const a of assignments) {
      const k = keyOfName(a.employeeName);
      let bucket = map.get(k);
      if (!bucket) { bucket = {}; for (const w of weeks) bucket[w] = 0; map.set(k, bucket); }
      const hasWeekly = Object.keys(a.weeklyHours || {}).some((d) => (a.weeklyHours[d] ?? 0) > 0);
      if (hasWeekly) {
        for (const w of weeks) bucket[w] += a.weeklyHours[w] ?? 0;
      } else {
        for (const w of weeks) {
          const m = monthOf(w);
          const total = a.monthlyTotals[m] ?? 0;
          const denom = weeksPerMonth[m] || 1;
          bucket[w] += total / denom;
        }
      }
    }
    return map;
  }, [assignments, keyOfName, weeks]);

  if (weeks.length === 0) {
    return (
      <div className="text-center py-10 text-muted/70 text-sm">
        No weeks to compare yet — the comparison starts in {COMPARISON_START_LABEL}.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line text-left">
            <th rowSpan={2} className="pb-2 pr-3 font-semibold text-muted align-bottom min-w-[180px] sticky left-0 bg-surface">Employee</th>
            {weeks.map((w) => (
              <th key={w} colSpan={3} className="px-1 font-semibold text-muted text-center text-[10px] whitespace-nowrap border-l border-line/60">
                {fmtWeek(w)}
              </th>
            ))}
          </tr>
          <tr className="border-b border-line">
            {weeks.map((w) => <FCHeaderTriplet key={w} />)}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const fcast = forecastByEmpWeek.get(p.key) ?? {};
            const actMap: Record<string, number> = {};
            for (const w of weeks) actMap[w] = 0;
            for (const e of actualsByKey.get(p.key) ?? []) {
              const ws = ymd(isoWeekStart(new Date(e.workDate + 'T00:00:00Z')));
              if (weekIndex.has(ws)) actMap[ws] += e.hours;
            }
            return (
              <tr key={p.key} className="border-b border-line/40 hover:bg-surface-2/70">
                <td className="py-1.5 pr-3 font-medium text-ink sticky left-0 bg-surface">{p.name}</td>
                {weeks.map((w) => {
                  const f = fcast[w] ?? 0;
                  const a = actMap[w];
                  return <FCTriplet key={w} forecast={f} actual={a} delta={a - f} title={tooltip(`${p.name} — week of ${fmtWeek(w)}`, f, a)} />;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Project sub-view ─────────────────────────────────────────── */
function FCProjectView({ people, assignments, keyOfName, actualsByKey }: SubViewProps) {
  const projKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

  const assignmentsByKey = useMemo(() => {
    const map = new Map<string, ForecastAssignment[]>();
    for (const a of assignments) {
      const k = keyOfName(a.employeeName);
      const list = map.get(k);
      if (list) list.push(a); else map.set(k, [a]);
    }
    return map;
  }, [assignments, keyOfName]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="pb-2 pr-3 font-semibold text-muted min-w-[160px]">Employee</th>
            <th className="pb-2 pr-3 font-semibold text-muted min-w-[200px]">Project</th>
            <th className="pb-2 pr-2 font-semibold text-muted text-right text-xs">Forecast {COMPARISON_WINDOW_LABEL}</th>
            <th className="pb-2 pr-2 font-semibold text-muted text-right text-xs">Actual {COMPARISON_WINDOW_LABEL}</th>
            <th className="pb-2 pl-2 font-semibold text-muted text-right text-xs">Δ</th>
          </tr>
        </thead>
        <tbody>
          {people.flatMap((p) => {
            const fcastByProj = new Map<string, { display: string; total: number }>();
            for (const a of assignmentsByKey.get(p.key) ?? []) {
              const total = COMPARISON_MONTHS.reduce((s, m) => s + (a.monthlyTotals[m] ?? 0), 0);
              const key = projKey(a.project);
              const prev = fcastByProj.get(key);
              fcastByProj.set(key, { display: a.project, total: (prev?.total ?? 0) + total });
            }
            const actByProj = new Map<string, { display: string; total: number }>();
            for (const e of actualsByKey.get(p.key) ?? []) {
              if (!e.project) continue;
              const key = projKey(e.project);
              const prev = actByProj.get(key);
              actByProj.set(key, { display: e.project, total: (prev?.total ?? 0) + e.hours });
            }

            const remainingActuals = new Map(actByProj);
            const rows: Array<{ key: string; project: string; forecast: number; actual: number; source: 'matched' | 'forecastOnly' | 'actualOnly' }> = [];

            for (const [fk, f] of fcastByProj) {
              let matchedKey: string | null = null;
              for (const ak of remainingActuals.keys()) {
                if (ak.includes(fk) || fk.includes(ak)) { matchedKey = ak; break; }
              }
              if (matchedKey) {
                const a = remainingActuals.get(matchedKey)!;
                rows.push({ key: `${fk}|${matchedKey}`, project: `${f.display} ⇆ ${a.display}`, forecast: f.total, actual: a.total, source: 'matched' });
                remainingActuals.delete(matchedKey);
              } else {
                rows.push({ key: fk, project: f.display, forecast: f.total, actual: 0, source: 'forecastOnly' });
              }
            }
            for (const [ak, a] of remainingActuals) {
              rows.push({ key: ak, project: a.display, forecast: 0, actual: a.total, source: 'actualOnly' });
            }
            rows.sort((a, b) => b.actual + b.forecast - (a.actual + a.forecast));

            if (rows.length === 0) {
              return [(
                <tr key={`${p.key}-empty`} className="border-b border-line/40">
                  <td className="py-1.5 pr-3 font-medium text-ink">{p.name}</td>
                  <td colSpan={4} className="py-1.5 text-xs text-muted/70 italic">No forecast or actuals.</td>
                </tr>
              )];
            }
            return rows.map((r, i) => (
              <tr key={`${p.key}-${r.key}-${i}`} className="border-b border-line/40 hover:bg-surface-2/70">
                <td className="py-1.5 pr-3 font-medium text-ink">{i === 0 ? p.name : ''}</td>
                <td className="py-1.5 pr-3 text-ink/80">
                  {r.project}
                  {r.source === 'forecastOnly' && <span className="ml-1.5 text-[9px] text-muted/70 italic">(no actual)</span>}
                  {r.source === 'actualOnly' && <span className="ml-1.5 text-[9px] text-sky-500 italic">(unplanned)</span>}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-muted">{r.forecast > 0 ? r.forecast.toFixed(0) : '—'}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-ink/80">{r.actual > 0 ? r.actual.toFixed(0) : '—'}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums" title={tooltip(`${p.name} — ${r.project}`, r.forecast, r.actual)}>
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${deltaColor(r.forecast, r.actual)}`}>
                    {fmtSigned(r.actual - r.forecast)}
                  </span>
                </td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
