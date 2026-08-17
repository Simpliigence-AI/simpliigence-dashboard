import { useState, useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { HiringGapRow } from '../../types/hiringForecast';

type ViewMode = 'all' | 'BA' | 'Dev';

interface Props {
  rows: HiringGapRow[];
}

export function DemandCapacityChart({ rows }: Props) {
  const [view, setView] = useState<ViewMode>('all');

  const chartData = useMemo(() => {
    const months = [...new Set(rows.map((r) => r.month))];
    return months.map((m) => {
      const filtered = rows.filter((r) => {
        if (r.month !== m) return false;
        if (view === 'BA') return r.roleCategory === 'BA';
        if (view === 'Dev') return r.roleCategory === 'JuniorDev' || r.roleCategory === 'SeniorDev';
        return true;
      });

      const projectDemand = filtered.reduce((s, r) => s + r.projectDemand, 0);
      const staffingDemand = filtered.reduce((s, r) => s + r.staffingDemand, 0);
      const pipelineDemand = filtered.reduce((s, r) => s + r.pipelineDemand, 0);
      const capacity = filtered.reduce((s, r) => s + r.totalCapacity, 0);

      return {
        month: m,
        'Project Demand': Math.round(projectDemand),
        'Pipeline Projects': Math.round(pipelineDemand),
        'Staffing Demand': Math.round(staffingDemand),
        Capacity: Math.round(capacity),
      };
    });
  }, [rows, view]);

  return (
    <div>
      <div className="flex gap-1 mb-4">
        {(['all', 'BA', 'Dev'] as ViewMode[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
              view === v
                ? 'bg-primary text-white'
                : 'bg-surface-2 text-muted hover:bg-line/60'
            }`}
          >
            {v === 'all' ? 'All Roles' : v === 'BA' ? 'BAs Only' : 'Devs Only'}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
          <Tooltip formatter={(v) => `${Number(v).toLocaleString()} hrs`} />
          <Legend />
          <Bar dataKey="Project Demand" stackId="demand" fill="#3b82f6" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Pipeline Projects" stackId="demand" fill="#ef4444" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Staffing Demand" stackId="demand" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="Capacity" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} name="Capacity" />
          <ReferenceLine y={0} stroke="#94a3b8" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
