import { useMemo } from 'react';
import { Users, TrendingUp, AlertTriangle, UserPlus } from 'lucide-react';
import { useForecastStore, useHiringForecastStore, usePipelineStore } from '../store';
import { StatCard, Card } from '../components/ui';
import { PageHeader } from '../components/shared/PageHeader';
import { MONTHS } from '../types/forecast';
import type { Month } from '../types/forecast';
import { ROLE_CATEGORIES, ROLE_CATEGORY_LABELS } from '../types/hiringForecast';
import type { PipelineProject } from '../types/hiringForecast';
import { computeHiringForecast, aggregateGapRows } from '../lib/hiringForecastCalc';
import { DemandCapacityChart } from '../components/hiring/DemandCapacityChart';
import { StaffingRequestList } from '../components/hiring/StaffingRequestList';

export default function HiringForecastPage() {
  const assignments = useForecastStore((s) => s.assignments);
  const {
    staffingRequests, scenarioSettings,
    addStaffingRequest, removeStaffingRequest,
    updateScenarioSettings,
  } = useHiringForecastStore();
  const pipelineStoreProjects = usePipelineStore((s) => s.projects);

  // Convert pipeline projects (manual source) from usePipelineStore → HiringForecast PipelineProject format
  const pipelineProjects: PipelineProject[] = useMemo(() => {
    return pipelineStoreProjects
      .filter((p) => p.source === 'manual')
      .map((zp) => {
        const startMonth: Month = zp.startDate ? MONTHS[new Date(zp.startDate).getMonth()] : 'Jan';
        const endMonth: Month = zp.endDate ? MONTHS[new Date(zp.endDate).getMonth()] : 'Dec';
        const headcount = { BA: 0, JuniorDev: 0, SeniorDev: 0 } as Record<'BA' | 'JuniorDev' | 'SeniorDev', number>;
        let hoursPerPerson = 160;
        for (const r of zp.resources) {
          if (r.roleCategory === 'BA' || r.roleCategory === 'JuniorDev' || r.roleCategory === 'SeniorDev') {
            headcount[r.roleCategory] = r.count;
            hoursPerPerson = r.hoursPerMonth || 160;
          }
        }
        return {
          id: zp.id,
          projectName: zp.name,
          startMonth,
          endMonth,
          headcount,
          hoursPerPerson,
          source: 'manual' as const,
        };
      });
  }, [pipelineStoreProjects]);

  const gapRows = useMemo(
    () => computeHiringForecast(assignments, staffingRequests, pipelineProjects, scenarioSettings),
    [assignments, staffingRequests, pipelineProjects, scenarioSettings],
  );

  const summary = useMemo(() => aggregateGapRows(gapRows), [gapRows]);

  const activeMonths = useMemo(() => {
    const s = MONTHS.indexOf(scenarioSettings.forecastStartMonth);
    const e = MONTHS.indexOf(scenarioSettings.forecastEndMonth);
    return MONTHS.slice(s, e + 1);
  }, [scenarioSettings]);

  return (
    <>
      <PageHeader title="Hiring Forecast" subtitle={`Scenario planner for staffing needs — ${new Date().getFullYear()}`} />

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard icon={<TrendingUp size={24} />} label="Total Demand" value={`${Math.round(summary.totalDemand).toLocaleString()} hrs`} />
        <StatCard icon={<Users size={24} />} label="Current Capacity" value={`${Math.round(summary.totalCapacity).toLocaleString()} hrs`} />
        <StatCard icon={<AlertTriangle size={24} />} label="Capacity Gap" value={`${Math.round(summary.totalGap).toLocaleString()} hrs`} />
        <StatCard icon={<UserPlus size={24} />} label="Hires Needed" value={summary.totalHiresNeeded} />
      </div>

      {/* Scenario Controls */}
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Target Utilization</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={50}
                max={100}
                step={5}
                value={scenarioSettings.targetUtilization}
                onChange={(e) => updateScenarioSettings({ targetUtilization: Number(e.target.value) })}
                className="w-32 accent-primary"
              />
              <span className="text-sm font-semibold text-ink/80 tabular-nums w-10">
                {scenarioSettings.targetUtilization}%
              </span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Forecast Period</label>
            <div className="flex items-center gap-2">
              <select
                className="rounded border border-line px-2 py-1.5 text-sm"
                value={scenarioSettings.forecastStartMonth}
                onChange={(e) => updateScenarioSettings({ forecastStartMonth: e.target.value as Month })}
              >
                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <span className="text-muted/70 text-sm">to</span>
              <select
                className="rounded border border-line px-2 py-1.5 text-sm"
                value={scenarioSettings.forecastEndMonth}
                onChange={(e) => updateScenarioSettings({ forecastEndMonth: e.target.value as Month })}
              >
                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="flex-1" />
          <div className="flex gap-3 text-xs text-muted">
            <span><span className="inline-block w-3 h-3 rounded bg-[#3b82f6] mr-1 align-middle" />Project</span>
            <span><span className="inline-block w-3 h-3 rounded bg-[#ef4444] mr-1 align-middle" />Pipeline</span>
            <span><span className="inline-block w-3 h-3 rounded bg-[#8b5cf6] mr-1 align-middle" />Staffing</span>
            <span><span className="inline-block w-3 h-3 rounded bg-[#10b981] mr-1 align-middle" />Capacity</span>
          </div>
        </div>
      </Card>

      {/* Demand vs Capacity Chart */}
      <Card title="Demand vs Capacity" className="mb-6">
        <DemandCapacityChart rows={gapRows} />
      </Card>

      {/* Pipeline info banner */}
      {pipelineProjects.length > 0 && (
        <Card className="mb-6">
          <div className="flex items-center gap-3 text-sm">
            <span className="text-violet-600 font-medium">{pipelineProjects.length} pipeline project{pipelineProjects.length > 1 ? 's' : ''}</span>
            <span className="text-muted/70">contributing to demand forecast.</span>
            <a href="pipeline" className="text-primary hover:underline text-xs font-medium ml-auto">Manage in Pipeline tab &rarr;</a>
          </div>
        </Card>
      )}

      {/* Staffing Requests */}
      <Card title="Staffing Requests" className="mb-6">
        <StaffingRequestList
          requests={staffingRequests}
          onAdd={addStaffingRequest}
          onRemove={removeStaffingRequest}
        />
      </Card>

      {/* Hiring Summary Table */}
      <Card title="Hiring Summary">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="pb-3 pr-4 font-semibold text-muted">Role</th>
                {activeMonths.map((m) => (
                  <th key={m} className="pb-3 text-center font-semibold text-muted">{m}</th>
                ))}
                <th className="pb-3 text-right font-semibold text-muted">Peak Hires</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_CATEGORIES.map((cat) => {
                const catRows = gapRows.filter((r) => r.roleCategory === cat);
                const peakHires = Math.max(0, ...catRows.map((r) => r.hiresNeeded));
                return (
                  <tr key={cat} className="border-b border-line/60">
                    <td className="py-3 pr-4 font-medium text-ink/80 text-xs">{ROLE_CATEGORY_LABELS[cat]}</td>
                    {activeMonths.map((m) => {
                      const row = catRows.find((r) => r.month === m);
                      if (!row) return <td key={m} className="py-3 text-center text-line">—</td>;
                      const hasGap = row.gap > 0;
                      const tip = `Project: ${Math.round(row.projectDemand)} hrs\nPipeline: ${Math.round(row.pipelineDemand)} hrs\nStaffing: ${Math.round(row.staffingDemand)} hrs\n──────\nTotal Demand: ${Math.round(row.totalDemand)} hrs\nCapacity: ${Math.round(row.totalCapacity)} hrs (${row.currentHeadcount} × ${Math.round(row.effectiveCapacityPerPerson)})`;
                      return (
                        <td key={m} className="py-3 text-center">
                          <div title={tip} className={`inline-flex flex-col items-center px-2 py-1 rounded cursor-help ${hasGap ? 'bg-red-50' : 'bg-green-50'}`}>
                            <span className={`text-xs font-semibold tabular-nums ${hasGap ? 'text-red-700' : 'text-green-700'}`}>
                              {row.hiresNeeded > 0 ? `+${row.hiresNeeded}` : '0'}
                            </span>
                            <span className="text-[10px] text-muted tabular-nums">
                              {Math.round(row.totalDemand)} / {Math.round(row.totalCapacity)}
                            </span>
                          </div>
                        </td>
                      );
                    })}
                    <td className="py-3 text-right">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-bold ${peakHires > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {peakHires > 0 ? `Hire ${peakHires}` : 'OK'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line font-bold">
                <td className="pt-3 text-ink/80">Total</td>
                {activeMonths.map((m) => {
                  const monthRows = gapRows.filter((r) => r.month === m);
                  const totalHires = monthRows.reduce((s, r) => s + r.hiresNeeded, 0);
                  return (
                    <td key={m} className="pt-3 text-center">
                      <span className={`text-xs font-bold ${totalHires > 0 ? 'text-red-700' : 'text-green-700'}`}>
                        {totalHires > 0 ? `+${totalHires}` : '0'}
                      </span>
                    </td>
                  );
                })}
                <td className="pt-3 text-right">
                  <span className={`text-xs font-bold ${summary.totalHiresNeeded > 0 ? 'text-red-700' : 'text-green-700'}`}>
                    {summary.totalHiresNeeded > 0 ? `Hire ${summary.totalHiresNeeded}` : 'Fully Staffed'}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}
