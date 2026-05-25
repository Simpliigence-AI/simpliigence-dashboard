/**
 * Read-only "People" view for /actual-hours. Mirrors the Project Team's
 * PeopleView layout (master list on the left, detail pane on the right
 * with per-project 12-month allocation strips) but sources its data from
 * useActualHoursStore instead of useForecastStore — so the strips show
 * what people actually logged, not what was forecast.
 */
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useActualHoursStore } from '../../store';
import { MONTHS } from '../../types/forecast';
import { colorHash, getInitials } from '../team/shared';
import { AllocationStrip, AllocationStripRow } from '../team/AllocationStrip';
import { aggregateActuals } from './shared';

export default function ActualPeopleView() {
  const entries = useActualHoursStore((s) => s.entries);
  const groups = useMemo(() => aggregateActuals(entries), [entries]);
  const year = new Date().getFullYear();

  const projects = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) for (const a of g.assignments) s.add(a.project);
    return [...s].sort();
  }, [groups]);

  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [selectedName, setSelectedName] = useState<string | null>(groups[0]?.name ?? null);

  const filtered = useMemo(() => {
    return groups.filter((g) => {
      if (search && !g.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (projectFilter && !g.assignments.some((a) => a.project === projectFilter)) return false;
      return true;
    });
  }, [groups, search, projectFilter]);

  const selected = useMemo(
    () => filtered.find((g) => g.name === selectedName) ?? filtered[0] ?? null,
    [filtered, selectedName],
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[600px]">
      {/* Master list */}
      <div className="lg:w-80 shrink-0 flex flex-col">
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search people..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 pl-8 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>

        <div className="mb-3 text-xs">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">All Projects</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto space-y-0.5 pr-1 -mr-1">
          {filtered.map((g) => {
            const isSel = selected?.name === g.name;
            const yearCap = 12 * 160;
            const utilPct = Math.min((g.totalHours / yearCap) * 100, 130);
            return (
              <button
                key={g.name}
                onClick={() => setSelectedName(g.name)}
                className={`w-full text-left p-2 rounded-lg flex items-center gap-2 transition-colors ${
                  isSel ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-slate-50'
                }`}
              >
                <div
                  className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold"
                  style={{
                    backgroundColor: `hsl(${colorHash(g.name)} 70% 90%)`,
                    color: `hsl(${colorHash(g.name)} 60% 30%)`,
                  }}
                >
                  {getInitials(g.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">{g.name}</span>
                    <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{Math.round(utilPct)}%</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-slate-500 truncate">{g.totalHours.toFixed(0)} hrs logged</span>
                    {g.assignments.length > 0 && (
                      <span className="text-[9px] text-slate-400 shrink-0">· {g.assignments.length}p</span>
                    )}
                  </div>
                  <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        utilPct >= 80 ? 'bg-emerald-500' : utilPct >= 50 ? 'bg-sky-500' : utilPct > 0 ? 'bg-amber-400' : 'bg-slate-200'
                      }`}
                      style={{ width: `${Math.min(utilPct, 100)}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">
              {groups.length === 0 ? 'No actuals synced yet.' : 'No matches.'}
            </div>
          )}
        </div>
      </div>

      {/* Detail pane */}
      <div className="flex-1 min-w-0">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl py-16">
            Sync from Zoho People, then pick someone to see their actuals.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold"
                  style={{
                    backgroundColor: `hsl(${colorHash(selected.name)} 70% 88%)`,
                    color: `hsl(${colorHash(selected.name)} 60% 28%)`,
                  }}
                >
                  {getInitials(selected.name)}
                </div>
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{selected.name}</h2>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                    {selected.email && <span>{selected.email}</span>}
                    {selected.email && <span>·</span>}
                    <span>{selected.assignments.length} {selected.assignments.length === 1 ? 'project' : 'projects'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <StatBlock label="YTD" value={Math.round(selected.totalHours)} unit="hrs" />
                <StatBlock
                  label="Util"
                  value={Math.round((selected.totalHours / (12 * 160)) * 100)}
                  unit="%"
                />
              </div>
            </div>

            {/* Year row */}
            <div className="flex items-center gap-3 text-[10px] text-slate-400 uppercase tracking-wider mb-1 px-1">
              <span className="w-40 shrink-0">Project</span>
              <span className="flex-1">
                <span className="grid grid-cols-12 gap-0.5">
                  {MONTHS.map((m) => (
                    <span key={m} className="text-center">{m}</span>
                  ))}
                </span>
              </span>
              <span className="shrink-0 w-16 text-right">Total</span>
            </div>

            {/* Allocation strips — read-only, one per project */}
            <div className="space-y-1">
              {selected.assignments.map((a) => {
                const total = MONTHS.reduce((s, m) => s + (a.monthlyTotals[m] ?? 0), 0);
                return (
                  <AllocationStripRow
                    key={a.project}
                    label={a.project}
                    hue={colorHash(a.project)}
                    trailing={
                      <div className="w-16 text-right">
                        <span className="text-xs font-bold tabular-nums text-slate-700">
                          {total > 0 ? total.toFixed(0) : '—'}
                        </span>
                      </div>
                    }
                  >
                    <AllocationStrip
                      employeeName={selected.name}
                      project={a.project}
                      monthlyTotals={a.monthlyTotals}
                      weeklyHours={a.weeklyHours}
                      year={year}
                      readOnly
                    />
                  </AllocationStripRow>
                );
              })}
            </div>

            <p className="mt-5 text-[11px] text-slate-400 leading-relaxed">
              Read-only view of timesheet entries from Zoho People. To edit forecast plans, head to the Project Team page.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBlock({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</div>
      <div className="text-base font-bold tabular-nums text-slate-800">
        {value > 0 ? value.toLocaleString() : '—'}
        <span className="text-[10px] text-slate-400 ml-0.5">{unit}</span>
      </div>
    </div>
  );
}
