import { useMemo } from 'react';
import { DollarSign, EyeOff, TrendingUp } from 'lucide-react';
import { useForecastStore, useFinancialStore } from '../store';
import { StatCard, Card, Badge } from '../components/ui';
import { PageHeader } from '../components/shared/PageHeader';
import { deriveEmployeeSummaries, deriveProjectSummaries } from '../lib/parseSpreadsheet';
import { MONTHS } from '../types/forecast';
import { CHART_COLORS } from '../constants/brand';
import { useFinancialsMasked } from '../store/useDemoStore';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';

export default function FinancialsPage() {
  const masked = useFinancialsMasked();
  const assignments = useForecastStore((s) => s.assignments);
  const exchangeRate = useFinancialStore((s) => s.settings.exchangeRate);
  const employees = useMemo(() => deriveEmployeeSummaries(assignments), [assignments]);
  const projects = useMemo(() => deriveProjectSummaries(assignments), [assignments]);

  const totalCost = projects.reduce((s, p) => s + p.loadedCost, 0);
  const totalCostINR = totalCost * exchangeRate;

  // Loaded cost by month
  const monthlyCost = useMemo(() => {
    return MONTHS.map((m) => {
      let cost = 0;
      for (const a of assignments) {
        if (a.rateCard && a.monthlyTotals[m] > 0) {
          cost += a.monthlyTotals[m] * a.rateCard;
        }
      }
      return { month: m, cost: Math.round(cost), costINR: Math.round(cost * exchangeRate) };
    });
  }, [assignments, exchangeRate]);

  // Loaded cost by project
  const projectCost = useMemo(() =>
    projects
      .filter((p) => p.loadedCost > 0)
      .map((p) => ({
        name: p.name,
        cost: Math.round(p.loadedCost),
        hours: p.totalHours,
        headcount: p.employees.length,
        costPerHour: p.totalHours > 0 ? Math.round(p.loadedCost / p.totalHours) : 0,
      })),
    [projects],
  );

  // Employee cost contribution
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

  // Billable vs non-billable hours
  const billableHours = employees.filter((e) => e.rateCard).reduce((s, e) => s + e.totalHours, 0);
  const nonBillableHours = employees.filter((e) => !e.rateCard).reduce((s, e) => s + e.totalHours, 0);
  const totalHours = billableHours + nonBillableHours;
  const billablePercent = totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0;

  if (masked) {
    return (
      <>
        <PageHeader title="Financials" subtitle="Loaded cost estimates based on rate cards and forecasted hours" />
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
      <PageHeader title="Financials" subtitle="Loaded cost estimates based on rate cards and forecasted hours" />

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard icon={<DollarSign size={24} />} label="Total Loaded Cost (USD)" value={`$${totalCost.toLocaleString()}`} />
        <StatCard icon={<DollarSign size={24} />} label="Total Loaded Cost (INR)" value={`₹${Math.round(totalCostINR).toLocaleString()}`} />
        <StatCard icon={<TrendingUp size={24} />} label="Billable %" value={`${billablePercent}%`} />
        <StatCard icon={<TrendingUp size={24} />} label="Avg Cost/Hr" value={totalHours > 0 ? `$${Math.round(totalCost / billableHours)}` : '—'} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card title="Monthly Loaded Cost (USD)">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyCost}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v) => `$${Number(v).toLocaleString()}`} />
              <Bar dataKey="cost" fill="#10b981" radius={[4, 4, 0, 0]} name="Loaded Cost (USD)" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Loaded Cost by Project">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={projectCost} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => `$${Number(v).toLocaleString()}`} />
              <Bar dataKey="cost" name="Loaded Cost" radius={[0, 4, 4, 0]}>
                {projectCost.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Project financials table */}
      <Card title="Project Loaded Cost Breakdown" className="mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="pb-3 font-semibold text-slate-600">Project</th>
              <th className="pb-3 font-semibold text-slate-600 text-right">Headcount</th>
              <th className="pb-3 font-semibold text-slate-600 text-right">Total Hours</th>
              <th className="pb-3 font-semibold text-slate-600 text-right">Loaded Cost (USD)</th>
              <th className="pb-3 font-semibold text-slate-600 text-right">Loaded Cost (INR)</th>
              <th className="pb-3 font-semibold text-slate-600 text-right">Avg $/hr</th>
            </tr>
          </thead>
          <tbody>
            {projectCost.map((p) => (
              <tr key={p.name} className="border-b border-slate-100">
                <td className="py-2.5 font-medium text-slate-800">{p.name}</td>
                <td className="py-2.5 text-right tabular-nums">{p.headcount}</td>
                <td className="py-2.5 text-right tabular-nums">{p.hours.toLocaleString()}</td>
                <td className="py-2.5 text-right tabular-nums font-semibold text-green-700">${p.cost.toLocaleString()}</td>
                <td className="py-2.5 text-right tabular-nums text-slate-600">₹{Math.round(p.cost * exchangeRate).toLocaleString()}</td>
                <td className="py-2.5 text-right tabular-nums">${p.costPerHour}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 font-bold">
              <td className="pt-3">Total</td>
              <td className="pt-3 text-right">{projectCost.reduce((s, p) => s + p.headcount, 0)}</td>
              <td className="pt-3 text-right">{projectCost.reduce((s, p) => s + p.hours, 0).toLocaleString()}</td>
              <td className="pt-3 text-right text-green-700">${totalCost.toLocaleString()}</td>
              <td className="pt-3 text-right text-slate-600">₹{Math.round(totalCostINR).toLocaleString()}</td>
              <td className="pt-3 text-right">{billableHours > 0 ? `$${Math.round(totalCost / billableHours)}` : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </Card>

      {/* Top cost contributors */}
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
