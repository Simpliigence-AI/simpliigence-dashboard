/**
 * Read-only "Table" view for /actual-hours. Mirrors the Project Team's
 * TableView (dense pivot, employees as rows, monthly columns, expandable
 * per-project breakdown) but shows what employees actually logged.
 */
import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useActualHoursStore } from '../../store';
import { MONTHS } from '../../types/forecast';
import { aggregateActuals } from './shared';

export default function ActualTableView() {
  const entries = useActualHoursStore((s) => s.entries);
  const groups = useMemo(() => aggregateActuals(entries), [entries]);

  const projects = useMemo(() => {
    const s = new Set<string>();
    for (const g of groups) for (const a of g.assignments) s.add(a.project);
    return [...s].sort();
  }, [groups]);

  const [search, setSearch] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [expandedEmp, setExpandedEmp] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return groups.filter((g) => {
      if (search && !g.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (projectFilter && !g.assignments.some((a) => a.project === projectFilter)) return false;
      return true;
    });
  }, [groups, search, projectFilter]);

  const toggle = (name: string) =>
    setExpandedEmp((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1 min-w-[180px] relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted/70" />
          <input
            type="text"
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line pl-8 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="rounded-lg border border-line px-2 py-1.5 text-sm"
        >
          <option value="">All Projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              <th className="pb-3 pr-2 w-6" />
              <th className="pb-3 pr-3 font-semibold text-muted min-w-[180px] sticky left-0 bg-white">Name</th>
              <th className="pb-3 pr-3 font-semibold text-muted w-16 text-center">Projects</th>
              {MONTHS.map((m) => (
                <th key={m} className="pb-3 pr-1 font-semibold text-muted text-center text-xs w-14">{m}</th>
              ))}
              <th className="pb-3 pl-2 font-semibold text-muted text-right w-16">YTD</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => {
              const isExpanded = expandedEmp.has(g.name);
              const empMonthly = MONTHS.reduce((acc, m) => {
                acc[m] = g.assignments.reduce((s, a) => s + (a.monthlyTotals[m] ?? 0), 0);
                return acc;
              }, {} as Record<string, number>);

              return (
                <Fragment key={g.name}>
                  <tr className="border-b border-line/60 hover:bg-surface-2/70">
                    <td className="py-2 pr-2">
                      <button onClick={() => toggle(g.name)} className="text-muted/70 hover:text-muted">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    <td className="py-2 pr-3 font-medium text-ink sticky left-0 bg-white">
                      {g.name}
                      {g.email && <div className="text-[10px] text-muted/70">{g.email}</div>}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted text-center">{g.assignments.length}</td>
                    {MONTHS.map((m) => {
                      const v = empMonthly[m];
                      const color =
                        v <= 0 ? 'text-line'
                          : v >= 140 ? 'bg-emerald-50 text-emerald-700'
                          : v >= 80 ? 'bg-sky-50 text-sky-700'
                          : 'bg-amber-50 text-amber-700';
                      return (
                        <td key={m} className="py-2 px-1 text-center tabular-nums">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${color}`}>
                            {v > 0 ? v.toFixed(0) : '—'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="py-2 pl-2 text-right tabular-nums">
                      <span className="inline-block px-1.5 py-0.5 rounded text-xs font-bold text-ink bg-surface-2">
                        {g.totalHours > 0 ? g.totalHours.toFixed(0) : '—'}
                      </span>
                    </td>
                  </tr>

                  {isExpanded && g.assignments.map((a) => {
                    const projTotal = MONTHS.reduce((s, m) => s + (a.monthlyTotals[m] ?? 0), 0);
                    return (
                      <tr key={`${g.name}-${a.project}`} className="border-b border-line/40 bg-surface-2/50">
                        <td />
                        <td className="py-1.5 pl-6 pr-3 sticky left-0 bg-surface-2/50">
                          <span className="inline-block bg-primary/10 text-primary text-xs px-2 py-0.5 rounded font-medium">{a.project}</span>
                        </td>
                        <td />
                        {MONTHS.map((m) => {
                          const v = a.monthlyTotals[m] ?? 0;
                          return (
                            <td key={m} className="py-1.5 px-1 text-center tabular-nums">
                              <span className={`text-[11px] ${v > 0 ? 'text-muted' : 'text-line'}`}>
                                {v > 0 ? v.toFixed(0) : '—'}
                              </span>
                            </td>
                          );
                        })}
                        <td className="py-1.5 pl-2 text-right">
                          <span className="text-xs text-muted font-medium">{projTotal > 0 ? projTotal.toFixed(0) : '—'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              );
            })}

            {filtered.length > 0 && (() => {
              const grandMonthly: Record<string, number> = {};
              for (const m of MONTHS) grandMonthly[m] = 0;
              let grandYear = 0;
              for (const g of filtered) {
                for (const m of MONTHS) {
                  grandMonthly[m] += g.assignments.reduce((s, a) => s + (a.monthlyTotals[m] ?? 0), 0);
                }
                grandYear += g.totalHours;
              }
              return (
                <tr className="border-t-2 border-line bg-surface-2/70 font-bold">
                  <td />
                  <td className="py-2.5 pr-3 text-ink/80 sticky left-0 bg-surface-2/70">Total ({filtered.length})</td>
                  <td />
                  {MONTHS.map((m) => (
                    <td key={m} className="py-2.5 px-1 text-center tabular-nums">
                      <span className="inline-block px-1.5 py-0.5 rounded text-xs font-bold text-ink bg-line/60">
                        {grandMonthly[m] > 0 ? grandMonthly[m].toFixed(0) : '—'}
                      </span>
                    </td>
                  ))}
                  <td className="py-2.5 pl-2 text-right">
                    <span className="inline-block px-1.5 py-0.5 rounded text-xs font-bold text-ink bg-line/60">
                      {grandYear > 0 ? grandYear.toFixed(0) : '—'}
                    </span>
                  </td>
                </tr>
              );
            })()}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="text-center py-8 text-muted/70 text-sm">
            {groups.length === 0 ? 'No actuals synced yet. Click Sync from Zoho People.' : 'No matches for the current filters.'}
          </div>
        )}
      </div>
    </>
  );
}
