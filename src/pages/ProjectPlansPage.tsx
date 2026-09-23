/**
 * Project Plans — the list. Every delivery project with its plan progress,
 * late tasks and open issues, so a delivery lead can see where to look first.
 * Replaces the project list in the standalone Delivery Governance app.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ClipboardList, Search, AlertTriangle, Loader2 } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Badge, EmptyState } from '../components/ui';
import { useDeliveryStore } from '../store/useDeliveryStore';
import { useTabPermission } from '../hooks/useTabPermission';
import { fmtDate } from '../lib/deliveryPlan';
import type { DeliveryProjectStatus } from '../types/delivery';

type Filter = 'active' | 'completed' | 'all';

const STATUS_LABEL: Record<DeliveryProjectStatus, string> = {
  active: 'Active',
  completed: 'Completed',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};

function statusVariant(s: DeliveryProjectStatus) {
  if (s === 'active') return 'info' as const;
  if (s === 'on_hold') return 'warning' as const;
  if (s === 'cancelled') return 'danger' as const;
  return 'neutral' as const;
}

export default function ProjectPlansPage() {
  const perm = useTabPermission('project-plans');
  const { projects, summaries, loading, error, loadProjects } = useDeliveryStore();
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');

  useEffect(() => { if (perm.canView) void loadProjects(); }, [perm.canView, loadProjects]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects
      .filter((p) => (filter === 'all' ? true : filter === 'active' ? p.status === 'active' || p.status === 'on_hold' : p.status === 'completed' || p.status === 'cancelled'))
      .filter((p) => !needle || [p.name, p.client, p.pm, p.deliveryLead].some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => {
        // Most attention first: late tasks, then critical issues, then name.
        const sa = summaries[a.id], sb = summaries[b.id];
        const wa = (sa?.late ?? 0) * 10 + (sa?.criticalIssues ?? 0);
        const wb = (sb?.late ?? 0) * 10 + (sb?.criticalIssues ?? 0);
        return wb - wa || a.name.localeCompare(b.name);
      });
  }, [projects, summaries, filter, q]);

  if (!perm.loading && !perm.canView) return <Navigate to="/" replace />;

  const counts = {
    active: projects.filter((p) => p.status === 'active' || p.status === 'on_hold').length,
    completed: projects.filter((p) => p.status === 'completed' || p.status === 'cancelled').length,
    all: projects.length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Delivery"
        tone="brand"
        title="Project Plans"
        subtitle="Plans, tasks and issues for every delivery project — formerly the Delivery Governance tool."
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {(['active', 'completed', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md capitalize ${filter === f ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}
            >
              {f} <span className="opacity-70 tabular-nums">{counts[f]}</span>
            </button>
          ))}
        </div>
        <label className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search project, client or PM"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-line bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-rose/30 bg-rose/5 px-4 py-3 text-sm text-rose">{error}</div>
      )}

      <Card flush>
        {loading && projects.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Loading plans…</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<ClipboardList size={36} />} title="No projects here" description={q ? 'Nothing matches that search.' : 'No projects in this view yet.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="px-5 py-3 font-semibold">Project</th>
                  <th className="px-3 py-3 font-semibold">PM</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">End</th>
                  <th className="px-3 py-3 font-semibold w-40">Plan</th>
                  <th className="px-3 py-3 font-semibold text-right">Late</th>
                  <th className="px-5 py-3 font-semibold text-right">Open issues</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const s = summaries[p.id];
                  const pct = s && s.tasks ? Math.round((s.done / s.tasks) * 100) : 0;
                  const end = p.currentEnd ?? p.plannedEnd;
                  const planEnd = !end ? s?.planEnd ?? null : null;
                  const slipped = p.currentEnd && p.plannedEnd && p.currentEnd > p.plannedEnd;
                  return (
                    <tr key={p.id} className="border-b border-line/40 hover:bg-surface-2/50">
                      <td className="px-5 py-3">
                        <Link to={`/project-plans/${p.id}`} className="font-semibold text-ink hover:text-primary">{p.name}</Link>
                        {p.client && p.client !== p.name && <div className="text-xs text-muted">{p.client}</div>}
                      </td>
                      <td className="px-3 py-3 text-ink/80">{p.pm ?? '—'}</td>
                      <td className="px-3 py-3"><Badge variant={statusVariant(p.status)}>{STATUS_LABEL[p.status] ?? p.status}</Badge></td>
                      <td className="px-3 py-3 tabular-nums text-muted">
                        {end ? fmtDate(end) : planEnd ? <span className="italic" title="No end date set on the project — this is the last task's end">{fmtDate(planEnd)}</span> : '—'}
                        {slipped && <span className="ml-1 text-gold" title={`Baseline end ${fmtDate(p.plannedEnd)}`}>↻</span>}
                      </td>
                      <td className="px-3 py-3">
                        {s && s.tasks ? (
                          <div>
                            <div className="flex justify-between text-[10px] text-muted mb-0.5 tabular-nums"><span>{s.done}/{s.tasks}</span><span>{pct}%</span></div>
                            <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden"><div className="h-full bg-green rounded-full" style={{ width: `${pct}%` }} /></div>
                          </div>
                        ) : <span className="text-xs text-muted/70">No plan</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {s?.late ? <span className="font-semibold text-rose">{s.late}</span> : <span className="text-muted/60">0</span>}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {s?.openIssues ? (
                          <span className="inline-flex items-center gap-1">
                            {s.criticalIssues > 0 && <AlertTriangle size={12} className="text-rose" />}
                            {s.openIssues}
                          </span>
                        ) : <span className="text-muted/60">0</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
