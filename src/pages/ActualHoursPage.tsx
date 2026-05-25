/**
 * Actual Hours page — read-only view of timesheet data synced from Zoho People.
 *
 * Three tabs, all sharing the same dataset (useActualHoursStore.entries):
 *   - Week:    employees × weeks pivot (ISO week buckets, year-to-date)
 *   - Month:   employees × Jan-Dec pivot
 *   - Project: employees × project pivot (expandable per-project monthly split)
 *
 * Source of truth: Zoho People Timetracker, refreshed via the
 * `zoho-people-sync` Supabase edge function. The button at the top of the
 * page triggers a re-sync — entries cached in Supabase + localStorage in
 * between syncs.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, Loader2, RefreshCw, Search } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useActualHoursStore, useForecastStore } from '../store';
import { MONTHS } from '../types/forecast';
import type { Month, ForecastAssignment } from '../types/forecast';
import type { ActualHourEntry } from '../types/actualHours';

type TabKey = 'week' | 'month' | 'project' | 'forecast';
const TAB_KEY = 'actual-hours-tab';

function loadTab(): TabKey {
  if (typeof window === 'undefined') return 'week';
  const v = window.localStorage.getItem(TAB_KEY);
  return v === 'month' || v === 'project' || v === 'forecast' ? v : 'week';
}

/* ─── Week helpers ─────────────────────────────────────────────── */

/** Return the Monday of the ISO week containing `date`. */
function isoWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  if (day !== 1) d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function ytdWeeks(): string[] {
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

function monthOf(dateStr: string): Month {
  const d = new Date(dateStr + 'T00:00:00Z');
  return MONTHS[d.getUTCMonth()];
}

function utilColor(hours: number): string {
  if (hours <= 0) return 'text-slate-300';
  if (hours >= 32) return 'text-emerald-700 bg-emerald-50';
  if (hours >= 16) return 'text-sky-700 bg-sky-50';
  return 'text-amber-700 bg-amber-50';
}

function monthColor(hours: number): string {
  if (hours <= 0) return 'text-slate-300';
  if (hours >= 140) return 'text-emerald-700 bg-emerald-50';
  if (hours >= 80) return 'text-sky-700 bg-sky-50';
  return 'text-amber-700 bg-amber-50';
}

/* ─── Aggregation ──────────────────────────────────────────────── */

interface EmployeeBucket {
  name: string;
  total: number;
  byWeek: Record<string, number>;
  byMonth: Record<Month, number>;
  byProject: Record<string, { total: number; byMonth: Record<Month, number> }>;
}

function aggregate(entries: ActualHourEntry[]): EmployeeBucket[] {
  const map = new Map<string, EmployeeBucket>();
  for (const e of entries) {
    const key = e.employeeName || `(unnamed)`;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        name: key,
        total: 0,
        byWeek: {},
        byMonth: emptyMonthCounter(),
        byProject: {},
      };
      map.set(key, bucket);
    }
    if (!e.workDate || !Number.isFinite(e.hours) || e.hours <= 0) continue;
    const weekKey = ymd(isoWeekStart(new Date(e.workDate + 'T00:00:00Z')));
    const month = monthOf(e.workDate);
    bucket.byWeek[weekKey] = (bucket.byWeek[weekKey] ?? 0) + e.hours;
    bucket.byMonth[month] = (bucket.byMonth[month] ?? 0) + e.hours;
    bucket.total += e.hours;

    const project = e.project || '(no project)';
    if (!bucket.byProject[project]) {
      bucket.byProject[project] = { total: 0, byMonth: emptyMonthCounter() };
    }
    bucket.byProject[project].total += e.hours;
    bucket.byProject[project].byMonth[month] += e.hours;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function emptyMonthCounter(): Record<Month, number> {
  return { Jan: 0, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0, Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0 };
}

function fmtHours(n: number): string {
  if (n <= 0) return '—';
  return n >= 100 ? n.toFixed(0) : n.toFixed(1);
}

/* ─── Page ─────────────────────────────────────────────────────── */

export default function ActualHoursPage() {
  const entries = useActualHoursStore((s) => s.entries);
  const lastSync = useActualHoursStore((s) => s.lastZohoSync);
  const syncFromZohoPeople = useActualHoursStore((s) => s.syncFromZohoPeople);

  const [tab, setTab] = useState<TabKey>(() => loadTab());
  useEffect(() => {
    try { window.localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
  }, [tab]);

  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const projects = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) if (e.project) s.add(e.project);
    return [...s].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    if (!projectFilter) return entries;
    return entries.filter((e) => e.project === projectFilter);
  }, [entries, projectFilter]);

  const buckets = useMemo(() => aggregate(filtered), [filtered]);
  const filteredBuckets = useMemo(() => {
    if (!search) return buckets;
    const q = search.toLowerCase();
    return buckets.filter((b) => b.name.toLowerCase().includes(q));
  }, [buckets, search]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    const r = await syncFromZohoPeople();
    setSyncing(false);
    if (r.ok) {
      const range = r.range ? ` (${r.range.from} → ${r.range.to})` : '';
      setSyncMsg(`Synced ${r.count ?? 0} entries${range}.`);
    } else {
      setSyncMsg(`Sync failed: ${r.error ?? 'unknown error'}`);
    }
    setTimeout(() => setSyncMsg(null), 6000);
  };

  return (
    <>
      <PageHeader
        title="Actual Hours"
        subtitle={
          entries.length > 0
            ? `${entries.length.toLocaleString()} timesheet entries · ${buckets.length} people · ${projects.length} projects`
            : 'Sync from Zoho People to populate this view.'
        }
      />

      <Card>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex-1 min-w-[180px] relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search employee..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 pl-8 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">All Projects</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sync from Zoho People
          </button>
          {lastSync && (
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <Clock size={12} />
              Last synced {new Date(lastSync).toLocaleString()}
            </span>
          )}
        </div>

        {syncMsg && (
          <div
            className={`mb-3 rounded-lg px-3 py-2 text-xs ${
              syncMsg.startsWith('Sync failed')
                ? 'bg-red-50 text-red-700 border border-red-200'
                : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            }`}
          >
            {syncMsg}
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 border-b border-slate-200 -mx-5 px-5">
          <TabButton active={tab === 'week'} onClick={() => setTab('week')}>By Week</TabButton>
          <TabButton active={tab === 'month'} onClick={() => setTab('month')}>By Month</TabButton>
          <TabButton active={tab === 'project'} onClick={() => setTab('project')}>By Project</TabButton>
          <TabButton active={tab === 'forecast'} onClick={() => setTab('forecast')}>vs Forecast</TabButton>
        </div>

        {entries.length === 0 ? (
          <EmptyState onSync={handleSync} syncing={syncing} />
        ) : tab === 'week' ? (
          <WeekView buckets={filteredBuckets} />
        ) : tab === 'month' ? (
          <MonthView buckets={filteredBuckets} />
        ) : tab === 'project' ? (
          <ProjectView buckets={filteredBuckets} />
        ) : (
          <ForecastVsActualView entries={filtered} search={search} />
        )}
      </Card>
    </>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`relative px-3.5 py-2 text-sm font-medium transition-colors ${
        active ? 'text-primary' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
      {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary rounded-full" />}
    </button>
  );
}

function EmptyState({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-4">
        <Clock size={26} />
      </div>
      <h3 className="text-base font-bold text-slate-800 mb-1">No actuals synced yet</h3>
      <p className="text-sm text-slate-500 max-w-md mb-4">
        Click <strong>Sync from Zoho People</strong> to pull this year's timesheet entries.
        If the sync fails, an admin needs to add the <code>ZOHO_PEOPLE_REFRESH_TOKEN</code>{' '}
        secret in Supabase and deploy the <code>zoho-people-sync</code> edge function.
      </p>
      <button
        onClick={onSync}
        disabled={syncing}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
      >
        {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        Sync from Zoho People
      </button>
    </div>
  );
}

/* ─── Week view ────────────────────────────────────────────────── */

function WeekView({ buckets }: { buckets: EmployeeBucket[] }) {
  const weeks = useMemo(() => ytdWeeks(), []);
  if (buckets.length === 0) {
    return <div className="text-center py-8 text-slate-400 text-sm">No matches.</div>;
  }
  const grandWeekly: Record<string, number> = {};
  for (const w of weeks) grandWeekly[w] = 0;
  let grandTotal = 0;
  for (const b of buckets) {
    grandTotal += b.total;
    for (const w of weeks) grandWeekly[w] += b.byWeek[w] ?? 0;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="pb-2 pr-3 font-semibold text-slate-600 min-w-[180px] sticky left-0 bg-white">Employee</th>
            {weeks.map((w) => (
              <th key={w} className="pb-2 px-1 font-semibold text-slate-500 text-center text-[10px] w-14 whitespace-nowrap">
                {fmtWeek(w)}
              </th>
            ))}
            <th className="pb-2 pl-3 font-semibold text-slate-600 text-right w-16">Total</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.name} className="border-b border-slate-50 hover:bg-slate-50">
              <td className="py-1.5 pr-3 font-medium text-slate-800 sticky left-0 bg-white">{b.name}</td>
              {weeks.map((w) => {
                const v = b.byWeek[w] ?? 0;
                return (
                  <td key={w} className="py-1.5 px-1 text-center tabular-nums">
                    <span className={`inline-block px-1 py-0.5 rounded text-[11px] ${utilColor(v)}`}>
                      {fmtHours(v)}
                    </span>
                  </td>
                );
              })}
              <td className="py-1.5 pl-3 text-right tabular-nums font-bold text-slate-700">{fmtHours(b.total)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
            <td className="py-2 pr-3 text-slate-700 sticky left-0 bg-slate-50">Total ({buckets.length})</td>
            {weeks.map((w) => (
              <td key={w} className="py-2 px-1 text-center tabular-nums text-[11px] text-slate-700">
                {fmtHours(grandWeekly[w])}
              </td>
            ))}
            <td className="py-2 pl-3 text-right tabular-nums text-slate-800">{fmtHours(grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ─── Month view ───────────────────────────────────────────────── */

function MonthView({ buckets }: { buckets: EmployeeBucket[] }) {
  if (buckets.length === 0) {
    return <div className="text-center py-8 text-slate-400 text-sm">No matches.</div>;
  }
  const grandMonthly = emptyMonthCounter();
  let grandTotal = 0;
  for (const b of buckets) {
    grandTotal += b.total;
    for (const m of MONTHS) grandMonthly[m] += b.byMonth[m];
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="pb-2 pr-3 font-semibold text-slate-600 min-w-[180px]">Employee</th>
            {MONTHS.map((m) => (
              <th key={m} className="pb-2 px-1.5 font-semibold text-slate-500 text-center text-xs w-14">{m}</th>
            ))}
            <th className="pb-2 pl-3 font-semibold text-slate-600 text-right w-16">Total</th>
          </tr>
        </thead>
        <tbody>
          {buckets.map((b) => (
            <tr key={b.name} className="border-b border-slate-50 hover:bg-slate-50">
              <td className="py-1.5 pr-3 font-medium text-slate-800">{b.name}</td>
              {MONTHS.map((m) => {
                const v = b.byMonth[m];
                return (
                  <td key={m} className="py-1.5 px-1.5 text-center tabular-nums">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${monthColor(v)}`}>
                      {fmtHours(v)}
                    </span>
                  </td>
                );
              })}
              <td className="py-1.5 pl-3 text-right tabular-nums font-bold text-slate-700">{fmtHours(b.total)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
            <td className="py-2 pr-3 text-slate-700">Total ({buckets.length})</td>
            {MONTHS.map((m) => (
              <td key={m} className="py-2 px-1.5 text-center tabular-nums text-xs text-slate-700">
                {fmtHours(grandMonthly[m])}
              </td>
            ))}
            <td className="py-2 pl-3 text-right tabular-nums text-slate-800">{fmtHours(grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ─── Project view ─────────────────────────────────────────────── */

/* ─── Forecast vs Actual ───────────────────────────────────────── */

type ForecastSubTab = 'month' | 'week' | 'project';
const FCAST_SUB_KEY = 'actual-hours-forecast-sub';

function loadForecastSub(): ForecastSubTab {
  if (typeof window === 'undefined') return 'month';
  const v = window.localStorage.getItem(FCAST_SUB_KEY);
  return v === 'week' || v === 'project' ? v : 'month';
}

/** Normalised key for matching forecast ↔ actual employee names. */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();
}
function firstNameKey(s: string): string {
  const n = normName(s);
  return n.split(' ')[0] || n;
}

/** Best-effort matcher: given a forecast employeeName, find any actual
 *  entries that belong to them. Match strategy:
 *    1. exact normalised match
 *    2. first-name match (so spreadsheet "Anukanth" finds Zoho "Anukanth Sudarsanam")
 */
function buildActualLookupByEmployee(entries: ActualHourEntry[]) {
  const exact = new Map<string, ActualHourEntry[]>();
  const byFirst = new Map<string, ActualHourEntry[]>();
  for (const e of entries) {
    const full = normName(e.employeeName);
    const first = firstNameKey(e.employeeName);
    if (!exact.has(full)) exact.set(full, []);
    exact.get(full)!.push(e);
    if (!byFirst.has(first)) byFirst.set(first, []);
    byFirst.get(first)!.push(e);
  }
  return (forecastName: string): ActualHourEntry[] => {
    const full = normName(forecastName);
    if (exact.has(full)) return exact.get(full)!;
    const first = firstNameKey(forecastName);
    return byFirst.get(first) ?? [];
  };
}

function fmtSigned(n: number): string {
  if (Math.abs(n) < 0.5) return '0';
  return (n > 0 ? '+' : '') + (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
}

/** Cell colour from delta as fraction of forecast (-1..+∞).
 *  Green = on target, amber = ±25%, red = >±25%.
 *  Blue = unplanned (forecast 0, actual > 0). */
function deltaColor(forecast: number, actual: number): string {
  if (forecast <= 0 && actual <= 0) return 'text-slate-300';
  if (forecast <= 0) return 'bg-sky-50 text-sky-700';
  if (actual <= 0) return 'bg-slate-50 text-slate-400';
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
  entries: ActualHourEntry[];
  search: string;
}

function ForecastVsActualView({ entries, search }: ForecastVsActualProps) {
  const assignments = useForecastStore((s) => s.assignments);
  const [sub, setSub] = useState<ForecastSubTab>(() => loadForecastSub());
  useEffect(() => {
    try { window.localStorage.setItem(FCAST_SUB_KEY, sub); } catch { /* ignore */ }
  }, [sub]);

  const lookupActual = useMemo(() => buildActualLookupByEmployee(entries), [entries]);

  // Build the canonical list of employees: union of (forecast assignees ∪ actuals).
  const employeeNames = useMemo(() => {
    const set = new Map<string, string>();   // normName → display name
    for (const a of assignments) set.set(normName(a.employeeName), a.employeeName);
    for (const e of entries) {
      const k = normName(e.employeeName);
      if (!set.has(k)) set.set(k, e.employeeName);
    }
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }, [assignments, entries]);

  const filteredEmployees = useMemo(() => {
    if (!search) return employeeNames;
    const q = search.toLowerCase();
    return employeeNames.filter((n) => n.toLowerCase().includes(q));
  }, [employeeNames, search]);

  if (assignments.length === 0) {
    return (
      <div className="text-center py-10 text-slate-400 text-sm">
        No forecast data — fill in the Project Team page first.
      </div>
    );
  }

  return (
    <div>
      {/* Sub-toggle */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] text-slate-500 uppercase tracking-wider">Compare by</span>
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
          <SubToggle active={sub === 'month'} onClick={() => setSub('month')}>Month</SubToggle>
          <SubToggle active={sub === 'week'} onClick={() => setSub('week')}>Week</SubToggle>
          <SubToggle active={sub === 'project'} onClick={() => setSub('project')}>Project</SubToggle>
        </div>
        <span className="ml-3 text-[10px] text-slate-400">
          Hover any cell for the calculation.
        </span>
      </div>

      <Legend />

      {sub === 'month' && <FCMonthView employees={filteredEmployees} assignments={assignments} lookupActual={lookupActual} />}
      {sub === 'week' && <FCWeekView employees={filteredEmployees} assignments={assignments} lookupActual={lookupActual} />}
      {sub === 'project' && <FCProjectView employees={filteredEmployees} assignments={assignments} lookupActual={lookupActual} />}
    </div>
  );
}

function SubToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 border-r last:border-r-0 border-slate-200 ${
        active ? 'bg-primary text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-3 text-[10px] text-slate-500">
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-200" /> ≤10% off</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-50 border border-amber-200" /> ≤25% off</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-50 border border-rose-200" /> &gt;25% off</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-sky-50 border border-sky-200" /> unplanned (actual w/o forecast)</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-50 border border-slate-200" /> no actuals yet</span>
    </div>
  );
}

interface SubViewProps {
  employees: string[];
  assignments: ForecastAssignment[];
  lookupActual: (forecastName: string) => ActualHourEntry[];
}

/* ─── Month sub-view ───────────────────────────────────────────── */
function FCMonthView({ employees, assignments, lookupActual }: SubViewProps) {
  // Sum forecast monthly hours per (employee, month)
  const forecastByEmpMonth = useMemo(() => {
    const map = new Map<string, Record<Month, number>>();
    for (const a of assignments) {
      const k = normName(a.employeeName);
      let bucket = map.get(k);
      if (!bucket) { bucket = emptyMonthCounter(); map.set(k, bucket); }
      for (const m of MONTHS) bucket[m] += a.monthlyTotals[m] ?? 0;
    }
    return map;
  }, [assignments]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th rowSpan={2} className="pb-2 pr-3 font-semibold text-slate-600 align-bottom min-w-[180px]">Employee</th>
            {MONTHS.map((m) => (
              <th key={m} colSpan={3} className="px-1.5 text-center font-semibold text-slate-600 text-xs border-l border-slate-100">{m}</th>
            ))}
          </tr>
          <tr className="border-b border-slate-200 text-left">
            {MONTHS.map((m) => (
              <FCHeaderTriplet key={m} />
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((name) => {
            const fkey = normName(name);
            const fcastMonthly = forecastByEmpMonth.get(fkey) ?? emptyMonthCounter();
            const actuals = lookupActual(name);
            const actMonthly = emptyMonthCounter();
            for (const e of actuals) {
              if (!e.workDate || e.hours <= 0) continue;
              actMonthly[monthOf(e.workDate)] += e.hours;
            }
            return (
              <tr key={name} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 pr-3 font-medium text-slate-800">{name}</td>
                {MONTHS.map((m) => {
                  const f = fcastMonthly[m];
                  const a = actMonthly[m];
                  const d = a - f;
                  return (
                    <FCTriplet key={m} forecast={f} actual={a} delta={d} title={tooltip(`${name} — ${m}`, f, a)} />
                  );
                })}
              </tr>
            );
          })}
          {/* Totals */}
          {employees.length > 1 && (() => {
            const totalF = emptyMonthCounter();
            const totalA = emptyMonthCounter();
            for (const name of employees) {
              const fkey = normName(name);
              const fc = forecastByEmpMonth.get(fkey);
              if (fc) for (const m of MONTHS) totalF[m] += fc[m];
              for (const e of lookupActual(name)) {
                if (!e.workDate || e.hours <= 0) continue;
                totalA[monthOf(e.workDate)] += e.hours;
              }
            }
            return (
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                <td className="py-2 pr-3 text-slate-700">Total ({employees.length})</td>
                {MONTHS.map((m) => (
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
      <th className="pb-2 px-1 font-semibold text-slate-400 text-[9px] text-right uppercase border-l border-slate-100">F</th>
      <th className="pb-2 px-1 font-semibold text-slate-400 text-[9px] text-right uppercase">A</th>
      <th className="pb-2 px-1 font-semibold text-slate-400 text-[9px] text-right uppercase">Δ</th>
    </>
  );
}

function FCTriplet({ forecast, actual, delta, title }: {
  forecast: number; actual: number; delta: number; title: string;
}) {
  const color = deltaColor(forecast, actual);
  return (
    <>
      <td className="py-1.5 px-1 text-right tabular-nums text-[11px] text-slate-500 border-l border-slate-100" title={title}>
        {forecast > 0 ? forecast.toFixed(0) : '—'}
      </td>
      <td className="py-1.5 px-1 text-right tabular-nums text-[11px] text-slate-700" title={title}>
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
function FCWeekView({ employees, assignments, lookupActual }: SubViewProps) {
  const weeks = useMemo(() => ytdWeeks(), []);
  const weekIndex = useMemo(() => new Map(weeks.map((w, i) => [w, i])), [weeks]);

  /** For each (employee, week), forecast = sum across their assignments of:
   *  - explicit weeklyHours[weekStart] if set, OR
   *  - monthlyTotals[month] / (# weeks in YTD that fall within that month).  */
  const forecastByEmpWeek = useMemo(() => {
    // First, count how many YTD weeks fall in each month (for even distribution).
    const weeksPerMonth: Record<Month, number> = emptyMonthCounter();
    for (const w of weeks) weeksPerMonth[monthOf(w)] += 1;

    const map = new Map<string, Record<string, number>>();
    for (const a of assignments) {
      const k = normName(a.employeeName);
      let bucket = map.get(k);
      if (!bucket) { bucket = {}; for (const w of weeks) bucket[w] = 0; map.set(k, bucket); }
      // Use weekly hours where set
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
  }, [assignments, weeks]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th rowSpan={2} className="pb-2 pr-3 font-semibold text-slate-600 align-bottom min-w-[180px] sticky left-0 bg-white">Employee</th>
            {weeks.map((w) => (
              <th key={w} colSpan={3} className="px-1 font-semibold text-slate-500 text-center text-[10px] whitespace-nowrap border-l border-slate-100">
                {fmtWeek(w)}
              </th>
            ))}
          </tr>
          <tr className="border-b border-slate-200">
            {weeks.map((w) => <FCHeaderTriplet key={w} />)}
          </tr>
        </thead>
        <tbody>
          {employees.map((name) => {
            const fkey = normName(name);
            const fcast = forecastByEmpWeek.get(fkey) ?? {};
            const actMap: Record<string, number> = {};
            for (const w of weeks) actMap[w] = 0;
            for (const e of lookupActual(name)) {
              if (!e.workDate || e.hours <= 0) continue;
              const ws = ymd(isoWeekStart(new Date(e.workDate + 'T00:00:00Z')));
              if (weekIndex.has(ws)) actMap[ws] += e.hours;
            }
            return (
              <tr key={name} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 pr-3 font-medium text-slate-800 sticky left-0 bg-white">{name}</td>
                {weeks.map((w) => {
                  const f = fcast[w] ?? 0;
                  const a = actMap[w];
                  return <FCTriplet key={w} forecast={f} actual={a} delta={a - f} title={tooltip(`${name} — week of ${fmtWeek(w)}`, f, a)} />;
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
function FCProjectView({ employees, assignments, lookupActual }: SubViewProps) {
  // Normalise project names for fuzzy-ish matching: lower-case, alnum only.
  const projKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

  // For each employee, build sets of (project → forecast hours) and (project → actual hours).
  // For matching, build a map from actualProjKey → forecastProj names that "contain" it
  // (or vice-versa). For v1 keep it simple: best-effort substring match.

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="pb-2 pr-3 font-semibold text-slate-600 min-w-[160px]">Employee</th>
            <th className="pb-2 pr-3 font-semibold text-slate-600 min-w-[200px]">Project</th>
            <th className="pb-2 pr-2 font-semibold text-slate-500 text-right text-xs">Forecast YTD</th>
            <th className="pb-2 pr-2 font-semibold text-slate-500 text-right text-xs">Actual YTD</th>
            <th className="pb-2 pl-2 font-semibold text-slate-500 text-right text-xs">Δ</th>
          </tr>
        </thead>
        <tbody>
          {employees.flatMap((name) => {
            const fkey = normName(name);
            // Forecast per project for this employee (YTD = sum of monthlyTotals)
            const fcastByProj = new Map<string, { display: string; total: number }>();
            for (const a of assignments) {
              if (normName(a.employeeName) !== fkey) continue;
              const total = MONTHS.reduce((s, m) => s + (a.monthlyTotals[m] ?? 0), 0);
              const key = projKey(a.project);
              const prev = fcastByProj.get(key);
              fcastByProj.set(key, { display: a.project, total: (prev?.total ?? 0) + total });
            }
            // Actual per project for this employee
            const actByProj = new Map<string, { display: string; total: number }>();
            for (const e of lookupActual(name)) {
              if (!e.project || e.hours <= 0) continue;
              const key = projKey(e.project);
              const prev = actByProj.get(key);
              actByProj.set(key, { display: e.project, total: (prev?.total ?? 0) + e.hours });
            }

            // Merge: try to match actual project to forecast project by substring.
            const remainingActuals = new Map(actByProj);
            const rows: Array<{ key: string; project: string; forecast: number; actual: number; source: 'matched' | 'forecastOnly' | 'actualOnly' }> = [];

            // Pass 1: each forecast project — find best actual match (substring either direction)
            for (const [fk, f] of fcastByProj) {
              let matchedKey: string | null = null;
              for (const ak of remainingActuals.keys()) {
                if (ak.includes(fk) || fk.includes(ak)) {
                  matchedKey = ak;
                  break;
                }
              }
              if (matchedKey) {
                const a = remainingActuals.get(matchedKey)!;
                rows.push({ key: `${fk}|${matchedKey}`, project: `${f.display} ⇆ ${a.display}`, forecast: f.total, actual: a.total, source: 'matched' });
                remainingActuals.delete(matchedKey);
              } else {
                rows.push({ key: fk, project: f.display, forecast: f.total, actual: 0, source: 'forecastOnly' });
              }
            }
            // Pass 2: any leftover actuals = unplanned
            for (const [ak, a] of remainingActuals) {
              rows.push({ key: ak, project: a.display, forecast: 0, actual: a.total, source: 'actualOnly' });
            }
            rows.sort((a, b) => b.actual + b.forecast - (a.actual + a.forecast));

            if (rows.length === 0) {
              return [(
                <tr key={`${name}-empty`} className="border-b border-slate-50">
                  <td className="py-1.5 pr-3 font-medium text-slate-800">{name}</td>
                  <td colSpan={4} className="py-1.5 text-xs text-slate-400 italic">No forecast or actuals.</td>
                </tr>
              )];
            }
            return rows.map((r, i) => (
              <tr key={`${name}-${r.key}-${i}`} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="py-1.5 pr-3 font-medium text-slate-800">{i === 0 ? name : ''}</td>
                <td className="py-1.5 pr-3 text-slate-700">
                  {r.project}
                  {r.source === 'forecastOnly' && <span className="ml-1.5 text-[9px] text-slate-400 italic">(no actual)</span>}
                  {r.source === 'actualOnly' && <span className="ml-1.5 text-[9px] text-sky-500 italic">(unplanned)</span>}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{r.forecast > 0 ? r.forecast.toFixed(0) : '—'}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700">{r.actual > 0 ? r.actual.toFixed(0) : '—'}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums" title={tooltip(`${name} — ${r.project}`, r.forecast, r.actual)}>
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

function ProjectView({ buckets }: { buckets: EmployeeBucket[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (buckets.length === 0) {
    return <div className="text-center py-8 text-slate-400 text-sm">No matches.</div>;
  }
  const toggle = (name: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="space-y-3">
      {buckets.map((b) => {
        const isOpen = expanded.has(b.name);
        const projects = Object.entries(b.byProject).sort((a, b) => b[1].total - a[1].total);
        return (
          <div key={b.name} className="border border-slate-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggle(b.name)}
              className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100"
            >
              <div className="flex items-center gap-2">
                {isOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                <span className="font-medium text-slate-800 text-sm">{b.name}</span>
                <span className="text-[11px] text-slate-500">
                  {projects.length} {projects.length === 1 ? 'project' : 'projects'}
                </span>
              </div>
              <span className="text-sm font-bold tabular-nums text-slate-700">{fmtHours(b.total)} hrs</span>
            </button>

            {isOpen && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-left bg-white">
                      <th className="py-1.5 px-3 font-semibold text-slate-500 min-w-[160px]">Project</th>
                      {MONTHS.map((m) => (
                        <th key={m} className="py-1.5 px-1 font-semibold text-slate-500 text-center w-12">{m}</th>
                      ))}
                      <th className="py-1.5 px-3 font-semibold text-slate-500 text-right w-16">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map(([proj, agg]) => (
                      <tr key={proj} className="border-b border-slate-50">
                        <td className="py-1.5 px-3 text-slate-700">{proj}</td>
                        {MONTHS.map((m) => {
                          const v = agg.byMonth[m];
                          return (
                            <td key={m} className="py-1.5 px-1 text-center tabular-nums">
                              <span className={v > 0 ? 'text-slate-700' : 'text-slate-300'}>{fmtHours(v)}</span>
                            </td>
                          );
                        })}
                        <td className="py-1.5 px-3 text-right tabular-nums font-bold text-slate-700">{fmtHours(agg.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
