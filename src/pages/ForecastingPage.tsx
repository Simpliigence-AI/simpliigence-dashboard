/**
 * Utilization Forecast — visual-first view of team capacity over the year.
 *
 * Two tabs:
 *   • Visual (default): KPIs + stacked monthly bar chart + per-person
 *     utilization heatmap. Designed to answer "is the team being utilized
 *     well, and where are the gaps?" at a glance.
 *   • Detail: the original spreadsheet-style breakdown by employee × project ×
 *     month — kept for power users who need the raw numbers.
 *
 * Capacity assumption: 160 hrs/month per person (the same constant used
 * throughout the app).
 */
import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import {
  TrendingUp, AlertTriangle, Target, BarChart3, LayoutGrid, Table as TableIcon,
} from 'lucide-react';
import { useForecastStore } from '../store';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard } from '../components/ui';
import { MONTHS, emptyMonthRecord } from '../types/forecast';
import type { Month } from '../types/forecast';
import { deriveEmployeeSummaries } from '../lib/parseSpreadsheet';

const CAPACITY = 160; // hrs / person / month

/** Map a utilization percentage (0..N+) to a Tailwind class for the heatmap cell.
 *  Caps at 100% for color (over-utilized cells get red regardless of value). */
function utilColor(pct: number): { bg: string; text: string } {
  if (pct === 0) return { bg: 'bg-surface-2/70', text: 'text-line' };
  if (pct > 110) return { bg: 'bg-red-500', text: 'text-white' };           // over-allocated
  if (pct >= 90)  return { bg: 'bg-emerald-600', text: 'text-white' };       // fully loaded
  if (pct >= 70)  return { bg: 'bg-emerald-500', text: 'text-white' };
  if (pct >= 50)  return { bg: 'bg-emerald-400', text: 'text-white' };
  if (pct >= 30)  return { bg: 'bg-amber-300', text: 'text-amber-900' };
  return { bg: 'bg-rose-200', text: 'text-rose-800' };                       // under-utilized
}

export default function ForecastingPage() {
  const assignments = useForecastStore((s) => s.assignments);
  const employees = useMemo(() => deriveEmployeeSummaries(assignments), [assignments]);
  const [tab, setTab] = useState<'visual' | 'detail'>('visual');
  const [projectFilter, setProjectFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState<Month | ''>('');

  const allProjects = useMemo(() => [...new Set(assignments.map((a) => a.project))].sort(), [assignments]);

  /* —— Per-employee × per-month utilization (% of 160) —— */
  const empUtil = useMemo(() => {
    return employees.map((e) => {
      const monthly: Record<Month, number> = emptyMonthRecord() as Record<Month, number>;
      for (const m of MONTHS) monthly[m] = Math.round((e.monthlyHours[m] / CAPACITY) * 100);
      const avg = Math.round(MONTHS.reduce((s, m) => s + monthly[m], 0) / 12);
      const peak = Math.max(...MONTHS.map((m) => monthly[m]));
      return { name: e.name, role: e.role, monthly, avg, peak };
    });
  }, [employees]);

  /* —— Team-level monthly stats —— */
  const monthlyStats = useMemo(() => {
    return MONTHS.map((m) => {
      let full = 0, moderate = 0, low = 0, bench = 0;
      let totalHours = 0;
      for (const e of employees) {
        const hrs = e.monthlyHours[m];
        totalHours += hrs;
        const pct = (hrs / CAPACITY) * 100;
        if (pct >= 90) full++;
        else if (pct >= 50) moderate++;
        else if (pct > 0) low++;
        else bench++;
      }
      const teamCapacity = employees.length * CAPACITY;
      const avgUtil = teamCapacity > 0 ? Math.round((totalHours / teamCapacity) * 100) : 0;
      return { month: m, full, moderate, low, bench, totalHours, avgUtil };
    });
  }, [employees]);

  /* —— Headline KPIs —— */
  const yearlyAvgUtil = useMemo(() => {
    if (monthlyStats.length === 0) return 0;
    return Math.round(monthlyStats.reduce((s, m) => s + m.avgUtil, 0) / monthlyStats.length);
  }, [monthlyStats]);

  const peakMonth = useMemo(() => {
    return [...monthlyStats].sort((a, b) => b.avgUtil - a.avgUtil)[0];
  }, [monthlyStats]);

  const lowMonth = useMemo(() => {
    return [...monthlyStats].sort((a, b) => a.avgUtil - b.avgUtil)[0];
  }, [monthlyStats]);

  const currentMonthIdx = new Date().getMonth();
  const currentMonth = monthlyStats[currentMonthIdx];

  const underutilized = empUtil.filter((e) => e.avg > 0 && e.avg < 50).length;
  const overAllocated = empUtil.filter((e) => e.peak > 110).length;

  /* —— Sort employees for the heatmap (descending by avg util) —— */
  const sortedEmpUtil = useMemo(
    () => [...empUtil].sort((a, b) => b.avg - a.avg),
    [empUtil],
  );

  /* —— Top 5 most + least utilized for the side panels —— */
  const top5 = sortedEmpUtil.slice(0, 5).filter((e) => e.avg > 0);
  const bottom5 = [...empUtil]
    .filter((e) => e.avg > 0)
    .sort((a, b) => a.avg - b.avg)
    .slice(0, 5);

  /* —— Detail tab: per-(employee,project) breakdown (existing logic) —— */
  const detailRows = useMemo(() => {
    const grouped = new Map<string, Map<string, Record<Month, number>>>();
    for (const a of assignments) {
      if (projectFilter && a.project !== projectFilter) continue;
      const key = a.employeeName;
      if (!grouped.has(key)) grouped.set(key, new Map());
      const empMap = grouped.get(key)!;
      if (!empMap.has(a.project)) empMap.set(a.project, emptyMonthRecord());
      const m = empMap.get(a.project)!;
      for (const month of MONTHS) m[month] += a.monthlyTotals[month];
    }
    const rows: { employee: string; project: string; monthly: Record<Month, number> }[] = [];
    for (const [employee, projectMap] of grouped) {
      for (const [project, monthly] of projectMap) {
        const total = MONTHS.reduce((s, m) => s + monthly[m], 0);
        if (total > 0) rows.push({ employee, project, monthly });
      }
    }
    rows.sort((a, b) => a.employee.localeCompare(b.employee) || a.project.localeCompare(b.project));
    return rows;
  }, [assignments, projectFilter]);

  /* —— Visual tab —— */
  const renderVisual = () => (
    <>
      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Avg Annual Utilization"
          value={`${yearlyAvgUtil}%`}
          icon={<TrendingUp size={20} />}
          subtitle={yearlyAvgUtil >= 75 ? 'Healthy load' : yearlyAvgUtil >= 50 ? 'Some headroom' : 'Significant slack'}
        />
        <StatCard
          label="Current Month"
          value={`${currentMonth?.avgUtil || 0}%`}
          icon={<Target size={20} />}
          subtitle={`${MONTHS[currentMonthIdx]} · ${currentMonth?.full || 0} fully loaded`}
        />
        <StatCard
          label="Underutilized"
          value={underutilized}
          icon={<AlertTriangle size={20} />}
          subtitle="People avg < 50% across year"
        />
        <StatCard
          label="Peak / Low Month"
          value={`${peakMonth?.month}/${lowMonth?.month}`}
          icon={<BarChart3 size={20} />}
          subtitle={`${peakMonth?.avgUtil || 0}% vs ${lowMonth?.avgUtil || 0}%`}
        />
      </div>

      {/* Monthly stacked-bar chart with capacity reference line */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-ink/80">Monthly Team Mix</h3>
          <div className="flex items-center gap-3 text-[10px] text-muted">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500" />Fully (90%+)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400" />Moderate (50-89%)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-300" />Low (1-49%)</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-line" />Bench</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={monthlyStats}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} label={{ value: 'team members', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#94a3b8' } }} />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
              formatter={(value, name) => [String(value), String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="full" stackId="a" fill="#10b981" name="Fully Loaded" />
            <Bar dataKey="moderate" stackId="a" fill="#f59e0b" name="Moderate" />
            <Bar dataKey="low" stackId="a" fill="#fda4af" name="Low" />
            <Bar dataKey="bench" stackId="a" fill="#cbd5e1" name="Bench" />
            <ReferenceLine y={employees.length} stroke="#64748b" strokeDasharray="4 4" label={{ value: 'Team capacity', fontSize: 10, fill: '#64748b' }} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Avg-utilization line — separate clean chart for the team trend */}
      <Card className="mb-6">
        <h3 className="text-sm font-bold text-ink/80 mb-3">Average Team Utilization by Month</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyStats}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => [`${v}%`, 'Avg utilization']} />
            <Bar dataKey="avgUtil" radius={[4, 4, 0, 0]}>
              {monthlyStats.map((m, i) => {
                const c = m.avgUtil >= 80 ? '#10b981' : m.avgUtil >= 60 ? '#3b82f6' : m.avgUtil >= 40 ? '#f59e0b' : '#ef4444';
                return <Cell key={i} fill={c} />;
              })}
            </Bar>
            <ReferenceLine y={80} stroke="#10b981" strokeDasharray="4 4" label={{ value: 'Target 80%', fontSize: 10, fill: '#10b981', position: 'right' }} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Per-person heatmap + side panels */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-ink/80">Per-person Utilization Heatmap</h3>
            <div className="flex items-center gap-1.5 text-[10px] text-muted">
              <span className="inline-block w-3 h-3 rounded-sm bg-rose-200" />
              <span className="inline-block w-3 h-3 rounded-sm bg-amber-300" />
              <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400" />
              <span className="inline-block w-3 h-3 rounded-sm bg-emerald-600" />
              <span className="inline-block w-3 h-3 rounded-sm bg-red-500" />
              <span className="ml-1">low → over-allocated</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-line/60">
                  <th className="pb-2 pr-3 text-left font-semibold text-muted sticky left-0 bg-white">Member</th>
                  <th className="pb-2 pr-3 text-left font-semibold text-muted">Role</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="pb-2 px-1 text-center font-semibold text-muted w-10">{m}</th>
                  ))}
                  <th className="pb-2 pl-3 text-right font-semibold text-muted">Avg</th>
                </tr>
              </thead>
              <tbody>
                {sortedEmpUtil.map((e) => (
                  <tr key={e.name} className="border-b border-line/40 hover:bg-surface-2/50">
                    <td className="py-1 pr-3 font-medium text-ink/80 sticky left-0 bg-white whitespace-nowrap">{e.name}</td>
                    <td className="py-1 pr-3 text-muted text-[10px] whitespace-nowrap">{e.role || '—'}</td>
                    {MONTHS.map((m) => {
                      const pct = e.monthly[m];
                      const c = utilColor(pct);
                      return (
                        <td key={m} className="px-0.5 py-0.5">
                          <div
                            className={`${c.bg} ${c.text} rounded text-center text-[10px] font-bold py-1 transition-transform hover:scale-110`}
                            title={`${e.name} · ${m}: ${pct}%`}
                          >
                            {pct > 0 ? pct : ''}
                          </div>
                        </td>
                      );
                    })}
                    <td className="py-1 pl-3 text-right tabular-nums font-bold" style={{
                      color: e.avg >= 80 ? '#10b981' : e.avg >= 60 ? '#3b82f6' : e.avg >= 40 ? '#f59e0b' : '#ef4444',
                    }}>
                      {e.avg}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <h4 className="text-xs font-bold text-emerald-700 uppercase tracking-wide mb-2">Most Utilized</h4>
            <div className="space-y-1.5">
              {top5.length === 0 && <p className="text-xs text-muted/70 italic">No data yet</p>}
              {top5.map((e) => (
                <div key={e.name} className="flex items-center justify-between text-xs">
                  <span className="text-ink/80 truncate" title={e.name}>{e.name}</span>
                  <span className="font-bold text-emerald-700 tabular-nums">{e.avg}%</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h4 className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-2">Least Utilized</h4>
            <div className="space-y-1.5">
              {bottom5.length === 0 && <p className="text-xs text-muted/70 italic">No data yet</p>}
              {bottom5.map((e) => (
                <div key={e.name} className="flex items-center justify-between text-xs">
                  <span className="text-ink/80 truncate" title={e.name}>{e.name}</span>
                  <span className="font-bold text-amber-700 tabular-nums">{e.avg}%</span>
                </div>
              ))}
            </div>
            {bottom5.length > 0 && (
              <p className="text-[10px] text-muted/70 mt-2 italic">
                Headroom for new project allocation
              </p>
            )}
          </Card>

          {overAllocated > 0 && (
            <Card>
              <h4 className="text-xs font-bold text-red-700 uppercase tracking-wide mb-2 flex items-center gap-1">
                <AlertTriangle size={11} /> Over-Allocated
              </h4>
              <p className="text-xs text-muted">
                <strong>{overAllocated}</strong> {overAllocated === 1 ? 'person hits' : 'people hit'} &gt;110% in at least one month — possible burnout risk.
              </p>
            </Card>
          )}
        </div>
      </div>
    </>
  );

  /* —— Detail tab (existing spreadsheet) —— */
  const heatColor = (hrs: number): string => {
    if (hrs >= 160) return 'bg-emerald-600 text-white';
    if (hrs >= 120) return 'bg-emerald-400 text-white';
    if (hrs >= 80)  return 'bg-emerald-200 text-emerald-900';
    if (hrs >= 40)  return 'bg-amber-100 text-amber-800';
    if (hrs > 0)    return 'bg-amber-50 text-amber-600';
    return 'bg-surface-2/70 text-line';
  };

  const renderDetail = () => (
    <>
      <Card className="mb-4">
        <div className="flex gap-3">
          <select className="rounded-lg border border-line px-3 py-2 text-sm" value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">All Projects</option>
            {allProjects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="rounded-lg border border-line px-3 py-2 text-sm" value={monthFilter} onChange={(e) => setMonthFilter(e.target.value as Month | '')}>
            <option value="">All Months</option>
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="pb-3 pr-4 font-semibold text-muted">Employee</th>
                <th className="pb-3 pr-4 font-semibold text-muted">Project</th>
                {MONTHS.filter((m) => !monthFilter || m === monthFilter).map((m) => (
                  <th key={m} className="pb-3 font-semibold text-muted text-center w-20">{m}</th>
                ))}
                <th className="pb-3 font-semibold text-muted text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {detailRows.map((row, i) => {
                const fm = MONTHS.filter((m) => !monthFilter || m === monthFilter);
                const total = fm.reduce((s, m) => s + row.monthly[m], 0);
                if (monthFilter && total === 0) return null;
                return (
                  <tr key={i} className="border-b border-line/40 hover:bg-surface-2/50">
                    <td className="py-2 pr-4 font-medium text-ink/80">{row.employee}</td>
                    <td className="py-2 pr-4 text-muted text-xs">{row.project}</td>
                    {fm.map((m) => (
                      <td key={m} className="py-2 text-center">
                        <span className={`inline-block w-14 px-1 py-0.5 rounded text-xs font-medium tabular-nums ${heatColor(row.monthly[m])}`}>
                          {row.monthly[m] > 0 ? row.monthly[m] : '—'}
                        </span>
                      </td>
                    ))}
                    <td className="py-2 text-right font-semibold tabular-nums text-ink/80">{total > 0 ? total : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );

  return (
    <>
      <PageHeader
        title="Utilization Forecast"
        subtitle="Visual view of team capacity, utilization, and headroom across the year"
      />

      {/* Tabs */}
      <div className="flex gap-1 bg-white p-1 rounded-lg shadow-sm mb-6 w-fit">
        {[
          { key: 'visual' as const, label: 'Visual', icon: LayoutGrid },
          { key: 'detail' as const, label: 'Detail (by Project)', icon: TableIcon },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold transition-colors ${
              tab === t.key ? 'bg-primary text-white' : 'text-muted hover:bg-surface-2/70'
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'visual' ? renderVisual() : renderDetail()}
    </>
  );
}
