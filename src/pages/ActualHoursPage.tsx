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
import { useActualHoursStore } from '../store';
import { MONTHS } from '../types/forecast';
import type { Month } from '../types/forecast';
import type { ActualHourEntry } from '../types/actualHours';

type TabKey = 'week' | 'month' | 'project';
const TAB_KEY = 'actual-hours-tab';

function loadTab(): TabKey {
  if (typeof window === 'undefined') return 'week';
  const v = window.localStorage.getItem(TAB_KEY);
  return v === 'month' || v === 'project' ? v : 'week';
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
        </div>

        {entries.length === 0 ? (
          <EmptyState onSync={handleSync} syncing={syncing} />
        ) : tab === 'week' ? (
          <WeekView buckets={filteredBuckets} />
        ) : tab === 'month' ? (
          <MonthView buckets={filteredBuckets} />
        ) : (
          <ProjectView buckets={filteredBuckets} />
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
