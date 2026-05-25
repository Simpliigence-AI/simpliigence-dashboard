/**
 * Financials — project-level revenue / cost / margin summary, with a
 * per-project monthly breakdown on expand.
 *
 * Data sources:
 *   - useForecastStore.assignments → monthly hours × rateCard = monthly cost
 *   - usePipelineStore.projects   → revenue (USD or CAD) per project
 *   - useFinancialStore.settings  → exchangeRate (INR), cadToUsdRate
 *
 * Honors useDemoStore: when the demo-mode mask is on, the whole page is
 * replaced with a "hidden during demo" placeholder.
 */
import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, DollarSign, EyeOff, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useForecastStore, useFinancialStore, usePipelineStore } from '../store';
import { StatCard, Card, Badge } from '../components/ui';
import { PageHeader } from '../components/shared/PageHeader';
import { deriveEmployeeSummaries } from '../lib/parseSpreadsheet';
import { MONTHS } from '../types/forecast';
import type { Month, ZohoPipelineProject } from '../types/forecast';
import { useFinancialsMasked } from '../store/useDemoStore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

/* ─── Per-project monthly aggregation ─────────────────────────── */

interface ProjectMonth {
  month: Month;
  hours: number;
  cost: number;          // USD
  revenue: number;       // USD (revenue distributed across the project's active months)
  margin: number;        // revenue - cost
}

interface ProjectFinancials {
  /** The "project" key as used in ForecastAssignment.project. */
  name: string;
  /** Source pipeline project, if matched. */
  pipeline?: ZohoPipelineProject;
  /** Whether the project has any pipeline match (used to colour the badge). */
  source: 'zoho' | 'manual' | 'legacy';
  /** Unique employees who logged time on this project. */
  headcount: number;
  ytdHours: number;
  ytdCost: number;
  ytdRevenue: number;
  ytdMargin: number;
  ytdMarginPct: number;
  byMonth: ProjectMonth[];
}

/** Build per-(project, month) financials from raw assignments + pipeline data. */
function buildProjectFinancials(
  assignments: ReturnType<typeof useForecastStore.getState>['assignments'],
  pipelineProjects: ZohoPipelineProject[],
  cadToUsdRate: number,
): ProjectFinancials[] {
  // Map pipeline projects by both their canonical and forecast-alias names so
  // we can match what assignments use as `project`.
  const pipelineByName = new Map<string, ZohoPipelineProject>();
  for (const p of pipelineProjects) {
    pipelineByName.set(p.name.toLowerCase(), p);
    if (p.forecastName) pipelineByName.set(p.forecastName.toLowerCase(), p);
  }

  // Aggregate hours + cost per (project, month).
  type Bucket = {
    name: string;
    employees: Set<string>;
    monthlyHours: Record<Month, number>;
    monthlyCost: Record<Month, number>;
  };
  const empty = (): Record<Month, number> =>
    ({ Jan: 0, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0, Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0 });

  const byProject = new Map<string, Bucket>();
  for (const a of assignments) {
    if (!a.project) continue;
    let b = byProject.get(a.project);
    if (!b) {
      b = { name: a.project, employees: new Set(), monthlyHours: empty(), monthlyCost: empty() };
      byProject.set(a.project, b);
    }
    b.employees.add(a.employeeName);
    for (const m of MONTHS) {
      const h = a.monthlyTotals[m] ?? 0;
      b.monthlyHours[m] += h;
      if (h > 0 && a.rateCard) b.monthlyCost[m] += h * a.rateCard;
    }
  }

  const out: ProjectFinancials[] = [];
  for (const [name, b] of byProject) {
    const pipeline = pipelineByName.get(name.toLowerCase());
    const revenueUsd = pipeline
      ? (pipeline.revenueCurrency === 'CAD' ? (pipeline.revenue ?? 0) * cadToUsdRate : (pipeline.revenue ?? 0))
      : 0;

    // Distribute project revenue across active months. "Active" = months
    // with > 0 forecasted hours. If no active months exist (rare), fall
    // back to dividing across all 12.
    const activeMonths = MONTHS.filter((m) => b.monthlyHours[m] > 0);
    const denom = activeMonths.length || 12;
    const monthlyRevenue = revenueUsd / denom;
    const activeSet = new Set(activeMonths);

    const byMonth: ProjectMonth[] = MONTHS.map((m) => {
      const revenue = activeSet.has(m) ? monthlyRevenue : (activeMonths.length === 0 ? monthlyRevenue : 0);
      const cost = Math.round(b.monthlyCost[m]);
      return {
        month: m,
        hours: Math.round(b.monthlyHours[m]),
        cost,
        revenue: Math.round(revenue),
        margin: Math.round(revenue - cost),
      };
    });

    const ytdHours = byMonth.reduce((s, x) => s + x.hours, 0);
    const ytdCost = byMonth.reduce((s, x) => s + x.cost, 0);
    const ytdRevenue = Math.round(revenueUsd);
    const ytdMargin = ytdRevenue - ytdCost;
    const ytdMarginPct = ytdRevenue > 0 ? Math.round((ytdMargin / ytdRevenue) * 100) : 0;

    out.push({
      name,
      pipeline,
      source: pipeline?.source ?? 'legacy',
      headcount: b.employees.size,
      ytdHours,
      ytdCost,
      ytdRevenue,
      ytdMargin,
      ytdMarginPct,
      byMonth,
    });
  }
  // Sort: projects with revenue first (by margin desc), then cost-only (by cost desc).
  return out.sort((a, b) => {
    if ((a.ytdRevenue > 0) !== (b.ytdRevenue > 0)) return a.ytdRevenue > 0 ? -1 : 1;
    if (a.ytdRevenue > 0) return b.ytdMargin - a.ytdMargin;
    return b.ytdCost - a.ytdCost;
  });
}

/* ─── Component ───────────────────────────────────────────────── */

export default function FinancialsPage() {
  const masked = useFinancialsMasked();
  const assignments = useForecastStore((s) => s.assignments);
  const pipelineProjects = usePipelineStore((s) => s.projects);
  const exchangeRate = useFinancialStore((s) => s.settings.exchangeRate);
  const cadToUsdRate = useFinancialStore((s) => s.settings.cadToUsdRate) || 0.73;

  const employees = useMemo(() => deriveEmployeeSummaries(assignments), [assignments]);
  const projectFin = useMemo(
    () => buildProjectFinancials(assignments, pipelineProjects, cadToUsdRate),
    [assignments, pipelineProjects, cadToUsdRate],
  );

  const totalCost = projectFin.reduce((s, p) => s + p.ytdCost, 0);
  const totalRevenue = projectFin.reduce((s, p) => s + p.ytdRevenue, 0);
  const totalMargin = totalRevenue - totalCost;
  const totalMarginPct = totalRevenue > 0 ? Math.round((totalMargin / totalRevenue) * 100) : 0;

  // Monthly aggregate across all projects (for the trend chart)
  const monthlyAgg = useMemo(() => {
    return MONTHS.map((m) => {
      let cost = 0;
      let revenue = 0;
      for (const p of projectFin) {
        const row = p.byMonth.find((x) => x.month === m);
        if (row) {
          cost += row.cost;
          revenue += row.revenue;
        }
      }
      return { month: m, cost, revenue, margin: revenue - cost };
    });
  }, [projectFin]);

  // Top contributors (unchanged)
  const employeeCost = useMemo(() => {
    const map = new Map<string, { name: string; role: string; hours: number; cost: number; rate: number | null }>();
    for (const a of assignments) {
      const totalHrs = MONTHS.reduce((s, m) => s + a.monthlyTotals[m], 0);
      const c = a.rateCard ? totalHrs * a.rateCard : 0;
      const existing = map.get(a.employeeName);
      if (existing) {
        existing.hours += totalHrs;
        existing.cost += c;
      } else {
        map.set(a.employeeName, { name: a.employeeName, role: a.role, hours: totalHrs, cost: c, rate: a.rateCard });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 15);
  }, [assignments]);

  const billableHours = employees.filter((e) => e.rateCard).reduce((s, e) => s + e.totalHours, 0);

  if (masked) {
    return (
      <>
        <PageHeader title="Financials" subtitle="Project margin and monthly breakdown" />
        <Card>
          <div className="flex flex-col items-center justify-center text-center py-16 px-6">
            <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 mb-4">
              <EyeOff size={28} />
            </div>
            <h2 className="text-lg font-bold text-slate-800 mb-1">Financials hidden during demo</h2>
            <p className="text-sm text-slate-500 max-w-md">
              Cost, revenue, and margin figures are masked across the app while demo mode is on. Re-enable
              from <strong>Settings → Demo mode</strong> to view this page.
            </p>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Financials" subtitle="Project margin and monthly breakdown" />

      {/* Top KPIs: revenue / cost / margin / margin% */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard
          icon={<DollarSign size={24} />}
          label="Total Revenue (USD)"
          value={`$${totalRevenue.toLocaleString()}`}
          subtitle={`${projectFin.filter((p) => p.ytdRevenue > 0).length} priced project${projectFin.filter((p) => p.ytdRevenue > 0).length === 1 ? '' : 's'}`}
        />
        <StatCard
          icon={<DollarSign size={24} />}
          label="Total Loaded Cost (USD)"
          value={`$${totalCost.toLocaleString()}`}
          subtitle={`≈ ₹${Math.round(totalCost * exchangeRate).toLocaleString()}`}
        />
        <StatCard
          icon={totalMargin >= 0 ? <TrendingUp size={24} /> : <TrendingDown size={24} />}
          label="Total Margin (USD)"
          value={
            <span className={totalMargin >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
              ${totalMargin.toLocaleString()}
            </span>
          }
          subtitle={`${totalMarginPct}% blended`}
        />
        <StatCard
          icon={<TrendingUp size={24} />}
          label="Avg Cost / Billable Hr"
          value={billableHours > 0 ? `$${Math.round(totalCost / billableHours)}` : '—'}
          subtitle={`${billableHours.toLocaleString()} billable hrs YTD`}
        />
      </div>

      {/* Monthly revenue / cost / margin chart */}
      <Card title="Monthly Revenue, Cost & Margin (USD)" className="mb-6">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={monthlyAgg}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => `$${Number(v).toLocaleString()}`} />
            <Bar dataKey="revenue" name="Revenue" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            <Bar dataKey="cost" name="Cost" fill="#f97316" radius={[4, 4, 0, 0]} />
            <Bar dataKey="margin" name="Margin" fill="#10b981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Project financial summary — main view */}
      <Card title="Project Financial Summary" className="mb-6">
        <p className="text-xs text-slate-400 mb-3">
          Revenue, cost, and margin per project. Click a row to expand the month-by-month breakdown.
          Revenue is distributed evenly across the project's active forecast months.
        </p>
        <ProjectFinancialsTable rows={projectFin} totalRevenue={totalRevenue} totalCost={totalCost} totalMargin={totalMargin} exchangeRate={exchangeRate} />
      </Card>

      {/* Top contributors */}
      <Card title="Top Cost Contributors">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="pb-3 font-semibold text-slate-600">Employee</th>
              <th className="pb-3 font-semibold text-slate-600">Role</th>
              <th className="pb-3 font-semibold text-slate-600 text-right">Rate ($/hr)</th>
              <th className="pb-3 font-semibold text-slate-600 text-right">Hours</th>
              <th className="pb-3 font-semibold text-slate-600 text-right">Loaded Cost (USD)</th>
            </tr>
          </thead>
          <tbody>
            {employeeCost.map((e) => (
              <tr key={e.name} className="border-b border-slate-100">
                <td className="py-2.5 font-medium text-slate-800">{e.name}</td>
                <td className="py-2.5 text-slate-500 text-xs">{e.role || '—'}</td>
                <td className="py-2.5 text-right tabular-nums">{e.rate ? `$${e.rate}` : '—'}</td>
                <td className="py-2.5 text-right tabular-nums">{e.hours.toLocaleString()}</td>
                <td className="py-2.5 text-right tabular-nums font-semibold">
                  {e.cost > 0 ? (
                    <span className="text-green-700">${e.cost.toLocaleString()}</span>
                  ) : (
                    <Badge variant="neutral">No rate</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/* ─── Project financials table with per-project monthly expand ─── */

function ProjectFinancialsTable({
  rows,
  totalRevenue,
  totalCost,
  totalMargin,
  exchangeRate,
}: {
  rows: ProjectFinancials[];
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  exchangeRate: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (name: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left">
            <th className="pb-3 pr-2 w-6" />
            <th className="pb-3 pr-3 font-semibold text-slate-600">Project</th>
            <th className="pb-3 pr-3 font-semibold text-slate-600 text-right">People</th>
            <th className="pb-3 pr-3 font-semibold text-slate-600 text-right">Hours (YTD)</th>
            <th className="pb-3 pr-3 font-semibold text-slate-600 text-right">Revenue</th>
            <th className="pb-3 pr-3 font-semibold text-slate-600 text-right">Cost</th>
            <th className="pb-3 pr-3 font-semibold text-slate-600 text-right">Margin</th>
            <th className="pb-3 pr-3 font-semibold text-slate-600 text-right">Margin %</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={8} className="py-6 text-center text-slate-400 text-sm">No projects with forecasted hours yet.</td></tr>
          )}
          {rows.map((p) => {
            const open = expanded.has(p.name);
            return (
              <Fragment key={p.name}>
                <tr className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-2.5 pr-2">
                    <button onClick={() => toggle(p.name)} className="text-slate-400 hover:text-slate-600">
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{p.name}</span>
                      <SourceBadge source={p.source} />
                    </div>
                    {p.pipeline?.revenue != null && (
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        Pipeline revenue: {p.pipeline.revenueCurrency === 'CAD' ? 'CA$' : '$'}{p.pipeline.revenue.toLocaleString()} {p.pipeline.revenueCurrency ?? 'USD'}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{p.headcount}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{p.ytdHours.toLocaleString()}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {p.ytdRevenue > 0 ? (
                      <span className="text-sky-700 font-semibold">${p.ytdRevenue.toLocaleString()}</span>
                    ) : (
                      <span className="text-slate-300 italic">no revenue set</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {p.ytdCost > 0 ? (
                      <span className="text-orange-700 font-semibold">${p.ytdCost.toLocaleString()}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    <MarginCell margin={p.ytdMargin} hasRevenue={p.ytdRevenue > 0} />
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    <MarginPctCell pct={p.ytdMarginPct} hasRevenue={p.ytdRevenue > 0} />
                  </td>
                </tr>

                {/* Expanded — monthly breakdown */}
                {open && (
                  <tr className="bg-slate-50/60">
                    <td />
                    <td colSpan={7} className="px-3 py-3">
                      <MonthlyBreakdown rows={p.byMonth} hasRevenue={p.ytdRevenue > 0} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-bold">
            <td />
            <td className="pt-3 pr-3">Total ({rows.length})</td>
            <td className="pt-3 pr-3 text-right">{rows.reduce((s, p) => s + p.headcount, 0)}</td>
            <td className="pt-3 pr-3 text-right">{rows.reduce((s, p) => s + p.ytdHours, 0).toLocaleString()}</td>
            <td className="pt-3 pr-3 text-right text-sky-700">${totalRevenue.toLocaleString()}</td>
            <td className="pt-3 pr-3 text-right text-orange-700">${totalCost.toLocaleString()}</td>
            <td className="pt-3 pr-3 text-right">
              <span className={totalMargin >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                ${totalMargin.toLocaleString()}
              </span>
            </td>
            <td className="pt-3 pr-3 text-right">
              {totalRevenue > 0 ? `${Math.round((totalMargin / totalRevenue) * 100)}%` : '—'}
            </td>
          </tr>
          <tr>
            <td colSpan={5} />
            <td colSpan={3} className="pt-1 text-right text-[10px] text-slate-400">
              ≈ ₹{Math.round(totalCost * exchangeRate).toLocaleString()} cost
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function MonthlyBreakdown({ rows, hasRevenue }: { rows: ProjectMonth[]; hasRevenue: boolean }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-50 text-left">
            <th className="px-3 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Month</th>
            <th className="px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px] text-right">Hours</th>
            {hasRevenue && <th className="px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px] text-right">Revenue</th>}
            <th className="px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px] text-right">Cost</th>
            {hasRevenue && <th className="px-2 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px] text-right">Margin</th>}
            {hasRevenue && <th className="px-3 py-2 font-semibold text-slate-500 uppercase tracking-wider text-[10px] text-right">Margin %</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = r.revenue > 0 ? Math.round((r.margin / r.revenue) * 100) : 0;
            const isEmpty = r.hours === 0 && r.cost === 0 && r.revenue === 0;
            return (
              <tr key={r.month} className={`border-t border-slate-50 ${isEmpty ? 'opacity-50' : ''}`}>
                <td className="px-3 py-1.5 font-medium text-slate-700">{r.month}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{r.hours > 0 ? r.hours.toLocaleString() : '—'}</td>
                {hasRevenue && (
                  <td className="px-2 py-1.5 text-right tabular-nums text-sky-700">
                    {r.revenue > 0 ? `$${r.revenue.toLocaleString()}` : '—'}
                  </td>
                )}
                <td className="px-2 py-1.5 text-right tabular-nums text-orange-700">
                  {r.cost > 0 ? `$${r.cost.toLocaleString()}` : '—'}
                </td>
                {hasRevenue && (
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    <MarginCell margin={r.margin} hasRevenue={hasRevenue} compact />
                  </td>
                )}
                {hasRevenue && (
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    <MarginPctCell pct={pct} hasRevenue={hasRevenue} compact />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourceBadge({ source }: { source: 'zoho' | 'manual' | 'legacy' }) {
  const cls =
    source === 'zoho'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : source === 'manual'
        ? 'bg-sky-50 text-sky-700 border-sky-200'
        : 'bg-slate-100 text-slate-500 border-slate-200';
  const label = source === 'zoho' ? 'Current' : source === 'manual' ? 'Pipeline' : 'Legacy';
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-medium rounded border ${cls}`}>
      {label}
    </span>
  );
}

function MarginCell({ margin, hasRevenue, compact = false }: { margin: number; hasRevenue: boolean; compact?: boolean }) {
  if (!hasRevenue) return <span className="text-slate-300">—</span>;
  const positive = margin >= 0;
  const cls = positive ? 'text-emerald-700' : 'text-rose-600';
  return (
    <span className={`font-semibold ${cls} ${compact ? 'text-xs' : ''}`}>
      ${margin.toLocaleString()}
    </span>
  );
}

function MarginPctCell({ pct, hasRevenue, compact = false }: { pct: number; hasRevenue: boolean; compact?: boolean }) {
  if (!hasRevenue) return <span className="text-slate-300">—</span>;
  const positive = pct >= 0;
  const colour = pct >= 40 ? 'bg-emerald-50 text-emerald-700' :
                 pct >= 20 ? 'bg-sky-50 text-sky-700' :
                 pct >= 0 ? 'bg-amber-50 text-amber-700' :
                            'bg-rose-50 text-rose-700';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold ${colour} ${compact ? 'text-xs' : 'text-sm'}`}>
      {positive ? <TrendingUp size={10} /> : <Minus size={10} />}
      {pct}%
    </span>
  );
}
