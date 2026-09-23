/**
 * One project's plan: tasks grouped by phase, issues, and plan history
 * (baselines and change requests). Replaces the plan, issues and baseline
 * pages of the standalone Delivery Governance app.
 *
 * Edits save on blur / change, one row at a time. Users with view-only access
 * on the 'project-plans' tab get the same page with the controls disabled.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ChevronDown, ChevronRight, Plus, Trash2, Loader2, AlertTriangle, CheckCircle2, Circle, History, ListChecks, Flag, LayoutGrid, ClipboardCheck,
} from 'lucide-react';
import { Card, Badge, Button, EmptyState } from '../../components/ui';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import { useTabPermission } from '../../hooks/useTabPermission';
import { groupPhases, isDone, isLate, planProgress, fmtDate } from '../../lib/deliveryPlan';
import type { DeliveryTask, DeliveryIssue, IssueCriticality, DeliveryProjectStatus, DeliveryBaseline } from '../../types/delivery';
import { EditCell, cellInput } from './planUi';
import { alertError } from '../../lib/planToast';
import { HeatmapTab } from './HeatmapTab';
import { GanttChart } from './GanttChart';
import { CheckinsTab } from './CheckinsTab';

type Tab = 'plan' | 'issues' | 'heatmap' | 'checkins' | 'history';

export default function ProjectPlanDetailPage() {
  const { id = '' } = useParams();
  const perm = useTabPermission('project-plans');
  const s = useDeliveryStore();
  const [tab, setTab] = useState<Tab>('plan');

  useEffect(() => { if (perm.canView && id) void s.loadDetail(id); }, [perm.canView, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const project = s.projects.find((p) => p.id === id);
  const tasks = s.detailId === id ? s.tasks : [];
  const issues = s.detailId === id ? s.issues : [];
  const progress = planProgress(tasks);
  const late = tasks.filter((t) => isLate(t)).length;
  const openIssues = issues.filter((i) => i.state === 'open').length;
  const planEnd = tasks.reduce<string | null>((m, t) => (t.endDate && (!m || t.endDate > m) ? t.endDate : m), null);

  if (!perm.loading && !perm.canView) return <Navigate to="/" replace />;
  if (s.detailLoading && !project) {
    return <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Loading plan…</div>;
  }
  if (!project) {
    return (
      <div className="space-y-4">
        <Link to="/project-plans" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Project Plans</Link>
        <EmptyState title="Project not found" description={s.error ?? 'It may have been removed, or you may not have access.'} />
      </div>
    );
  }

  const canEdit = perm.canEdit;
  const save = (patch: Parameters<typeof s.updateProject>[1]) => s.updateProject(project.id, patch);

  return (
    <div className="space-y-6">
      <div>
        <Link to="/project-plans" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Project Plans</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-[-0.02em] text-ink">{project.name}</h1>
            <div className="mt-1 text-sm text-muted">{[project.client, project.pm && `PM ${project.pm}`, project.deliveryLead && `Lead ${project.deliveryLead}`].filter(Boolean).join(' · ') || '—'}</div>
          </div>
          <select
            value={project.status}
            disabled={!canEdit}
            onChange={(e) => save({ status: e.target.value as DeliveryProjectStatus }).catch(alertError)}
            className="text-sm rounded-lg border border-line bg-surface px-3 py-2 disabled:opacity-70"
          >
            <option value="active">Active</option>
            <option value="on_hold">On hold</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Plan complete" value={`${progress.pct}%`} sub={`${progress.done} of ${progress.total} tasks`} />
        <Stat label="Late tasks" value={String(late)} tone={late ? 'rose' : undefined} />
        <Stat label="Open issues" value={String(openIssues)} tone={issues.some((i) => i.state === 'open' && (i.criticality === 'critical' || i.criticality === 'high')) ? 'rose' : undefined} />
        <div className="rounded-xl border border-line/70 bg-surface px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Start</div>
          <EditCell type="date" value={project.startDate} disabled={!canEdit} onSave={(v) => save({ startDate: v })} className="!px-0 font-semibold" />
        </div>
        <div className="rounded-xl border border-line/70 bg-surface px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            End{project.plannedEnd ? ` (baseline ${fmtDate(project.plannedEnd)})` : ''}
          </div>
          <EditCell type="date" value={project.currentEnd ?? project.plannedEnd} disabled={!canEdit} onSave={(v) => save({ currentEnd: v })} className="!px-0 font-semibold" />
          {!project.currentEnd && !project.plannedEnd && planEnd && (
            <div className="text-[11px] text-muted">Plan ends {fmtDate(planEnd)}</div>
          )}
        </div>
      </div>

      <div className="flex gap-1 border-b border-line overflow-x-auto">
        {([['plan', 'Plan', ListChecks, tasks.length], ['issues', 'Issues', Flag, openIssues], ['heatmap', 'Heatmap', LayoutGrid, s.features.filter((f) => f.projectId === project.id).length], ['checkins', 'Check-ins', ClipboardCheck, s.checkins.filter((c) => c.projectId === project.id && c.status === 'submitted').length], ['history', 'History', History, s.baselines.filter((b) => b.projectId === project.id).length + s.changeRequests.filter((c) => c.projectId === project.id).length]] as const).map(([k, label, Icon, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px ${tab === k ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            <Icon size={15} /> {label} <span className="text-xs text-muted tabular-nums">{n}</span>
          </button>
        ))}
      </div>

      {s.error && <div className="rounded-lg border border-rose/30 bg-rose/5 px-4 py-3 text-sm text-rose">{s.error}</div>}

      {tab === 'plan' && <PlanTab projectId={project.id} tasks={tasks} canEdit={canEdit} baseline={s.baselines.filter((b) => b.projectId === project.id).at(-1) ?? null} />}
      {tab === 'issues' && <IssuesTab projectId={project.id} issues={issues} canEdit={canEdit} />}
      {tab === 'heatmap' && <HeatmapTab projectId={project.id} canEdit={canEdit} />}
      {tab === 'checkins' && <CheckinsTab projectId={project.id} projectName={project.name} canEdit={canEdit} />}
      {tab === 'history' && <HistoryTab projectId={project.id} />}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'rose' }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${tone === 'rose' ? 'text-rose' : 'text-ink'}`}>{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </div>
  );
}

/* ── Plan ─────────────────────────────────────────────────────────────── */

function PlanTab({ projectId, tasks, canEdit, baseline }: { projectId: string; tasks: DeliveryTask[]; canEdit: boolean; baseline: DeliveryBaseline | null }) {
  const phases = useMemo(() => groupPhases(tasks), [tasks]);
  const [view, setView] = useState<'gantt' | 'table'>('gantt');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const addTask = useDeliveryStore((st) => st.addTask);
  const [newPhase, setNewPhase] = useState('');
  const [newName, setNewName] = useState('');

  if (tasks.length === 0 && !canEdit) {
    return <Card><EmptyState icon={<ListChecks size={36} />} title="No plan yet" description="Nobody has added tasks to this project." /></Card>;
  }

  const viewToggle = (
    <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {(['gantt', 'table'] as const).map((v) => (
        <button key={v} onClick={() => setView(v)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md ${view === v ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}>
          {v === 'gantt' ? 'Gantt chart' : 'Table'}
        </button>
      ))}
    </div>
  );

  if (view === 'gantt') {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">{viewToggle}</div>
        <Card flush><GanttChart tasks={tasks} baseline={baseline} canEdit={canEdit} /></Card>
        <p className="text-xs text-muted">To add or rename tasks, switch to Table.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">{viewToggle}</div>
      {phases.map((ph) => {
        const open = !collapsed[ph.name];
        const pct = ph.total ? Math.round((ph.done / ph.total) * 100) : 0;
        return (
          <Card key={ph.name} flush>
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [ph.name]: open }))}
              className="w-full flex items-center gap-3 px-5 py-3 text-left"
            >
              {open ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
              <span className="font-bold text-ink">{ph.name}</span>
              <span className="text-xs text-muted tabular-nums">{fmtDate(ph.start)} – {fmtDate(ph.end)}</span>
              <span className="ml-auto flex items-center gap-2 text-xs text-muted tabular-nums">
                {ph.done}/{ph.total}
                <span className="w-20 h-1.5 bg-surface-2 rounded-full overflow-hidden"><span className="block h-full bg-green" style={{ width: `${pct}%` }} /></span>
              </span>
            </button>
            {open && (
              <div className="border-t border-line/60 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="w-10 pl-5 py-2" />
                      <th className="py-2 font-semibold">Task</th>
                      <th className="py-2 font-semibold w-40">Assignee</th>
                      <th className="py-2 font-semibold w-36">Start</th>
                      <th className="py-2 font-semibold w-36">End</th>
                      <th className="py-2 font-semibold w-20 text-right">%</th>
                      <th className="w-12 pr-5" />
                    </tr>
                  </thead>
                  <tbody>
                    {ph.tasks.map((t) => <TaskRow key={t.id} t={t} canEdit={canEdit} />)}
                    {canEdit && <AddTaskRow projectId={projectId} phase={ph.name === 'Unphased' ? null : ph.name} />}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        );
      })}

      {canEdit && (
        <Card>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              try { await addTask(projectId, { name: newName, phase: newPhase }); setNewName(''); } catch (err) { alertError(err); }
            }}
          >
            <label className="text-xs text-muted">Phase
              <input value={newPhase} onChange={(e) => setNewPhase(e.target.value)} placeholder="e.g. Build" list="plan-phases"
                className="block mt-1 w-44 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" />
              <datalist id="plan-phases">{phases.map((p) => <option key={p.name} value={p.name} />)}</datalist>
            </label>
            <label className="text-xs text-muted flex-1 min-w-[14rem]">New task
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Task name"
                className="block mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" />
            </label>
            <Button type="submit" size="md" disabled={!newName.trim()}><Plus size={14} /> Add task</Button>
          </form>
          <p className="mt-2 text-xs text-muted">A new phase name starts a new phase group.</p>
        </Card>
      )}
    </div>
  );
}

function TaskRow({ t, canEdit }: { t: DeliveryTask; canEdit: boolean }) {
  const updateTask = useDeliveryStore((st) => st.updateTask);
  const removeTask = useDeliveryStore((st) => st.removeTask);
  const done = isDone(t);
  const late = isLate(t);
  return (
    <tr className={`border-t border-line/40 ${done ? 'opacity-60' : ''}`}>
      <td className="pl-5 py-1">
        <button
          disabled={!canEdit}
          title={done ? 'Mark not done' : 'Mark done'}
          onClick={() => updateTask(t.id, { status: done ? 'task' : 'done' }).catch(alertError)}
          className="text-muted hover:text-green disabled:hover:text-muted"
        >
          {done ? <CheckCircle2 size={17} className="text-green" /> : <Circle size={17} />}
        </button>
      </td>
      <td className="py-1">
        <div className="flex items-center gap-1.5">
          <EditCell value={t.name} disabled={!canEdit} onSave={(v) => (v.trim() ? updateTask(t.id, { name: v }) : Promise.reject(new Error('Task name can’t be empty')))} className={done ? 'line-through' : ''} />
          {t.source === 'cr' && <Badge variant="warning">CR</Badge>}
          {late && <span title="Past its end date"><AlertTriangle size={13} className="text-rose shrink-0" /></span>}
        </div>
      </td>
      <td className="py-1"><EditCell value={t.assignee} disabled={!canEdit} placeholder="Unassigned" onSave={(v) => updateTask(t.id, { assignee: v })} /></td>
      <td className="py-1"><EditCell type="date" value={t.startDate} disabled={!canEdit} onSave={(v) => updateTask(t.id, { startDate: v })} /></td>
      <td className="py-1"><EditCell type="date" value={t.endDate} disabled={!canEdit} onSave={(v) => updateTask(t.id, { endDate: v })} className={late ? 'text-rose' : ''} /></td>
      <td className="py-1"><EditCell type="number" value={String(t.percent)} disabled={!canEdit} onSave={(v) => updateTask(t.id, { percent: Number(v) || 0 })} className="text-right tabular-nums" /></td>
      <td className="pr-5 py-1 text-right">
        {canEdit && (
          <button
            title="Delete task"
            onClick={() => { if (window.confirm(`Delete “${t.name}”?`)) removeTask(t.id).catch(alertError); }}
            className="text-muted/60 hover:text-rose"
          >
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}

function AddTaskRow({ projectId, phase }: { projectId: string; phase: string | null }) {
  const addTask = useDeliveryStore((st) => st.addTask);
  const [name, setName] = useState('');
  return (
    <tr className="border-t border-line/40">
      <td className="pl-5 py-1 text-muted/50"><Plus size={15} /></td>
      <td className="py-1" colSpan={6}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Add a task to ${phase ?? 'this phase'} and press Enter`}
          onKeyDown={async (e) => {
            if (e.key !== 'Enter' || !name.trim()) return;
            try { await addTask(projectId, { name, phase }); setName(''); } catch (err) { alertError(err); }
          }}
          className={`${cellInput} text-muted`}
        />
      </td>
    </tr>
  );
}

/* ── Issues ───────────────────────────────────────────────────────────── */

const CRIT_VARIANT: Record<IssueCriticality, 'danger' | 'warning' | 'info' | 'neutral'> = {
  critical: 'danger', high: 'danger', medium: 'warning', low: 'neutral',
};

function IssuesTab({ projectId, issues, canEdit }: { projectId: string; issues: DeliveryIssue[]; canEdit: boolean }) {
  const addIssue = useDeliveryStore((st) => st.addIssue);
  const updateIssue = useDeliveryStore((st) => st.updateIssue);
  const [showClosed, setShowClosed] = useState(false);
  const [desc, setDesc] = useState('');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  const [crit, setCrit] = useState<IssueCriticality>('medium');

  const shown = issues.filter((i) => showClosed || i.state === 'open');
  const closedCount = issues.filter((i) => i.state === 'closed').length;

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <form
            className="grid gap-3 md:grid-cols-[1fr_12rem_10rem_8rem_auto] items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!desc.trim()) return;
              try { await addIssue(projectId, { description: desc, owner, dueDate: due, criticality: crit }); setDesc(''); setOwner(''); setDue(''); setCrit('medium'); }
              catch (err) { alertError(err); }
            }}
          >
            <label className="text-xs text-muted">Issue
              <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What’s the problem?" className="block mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" />
            </label>
            <label className="text-xs text-muted">Owner
              <input value={owner} onChange={(e) => setOwner(e.target.value)} className="block mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" />
            </label>
            <label className="text-xs text-muted">Due
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="block mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" />
            </label>
            <label className="text-xs text-muted">Criticality
              <select value={crit} onChange={(e) => setCrit(e.target.value as IssueCriticality)} className="block mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink">
                <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
              </select>
            </label>
            <Button type="submit" disabled={!desc.trim()}><Plus size={14} /> Log issue</Button>
          </form>
        </Card>
      )}

      <Card flush title={`${issues.length - closedCount} open`} action={
        closedCount > 0 ? (
          <button onClick={() => setShowClosed((v) => !v)} className="text-xs font-semibold text-muted hover:text-ink">
            {showClosed ? 'Hide' : 'Show'} {closedCount} closed
          </button>
        ) : undefined
      }>
        {shown.length === 0 ? (
          <EmptyState icon={<Flag size={32} />} title="No open issues" description="Log anything blocking delivery here so it’s visible in reviews." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-line">
                  <th className="pl-5 py-2 font-semibold">Issue</th>
                  <th className="py-2 font-semibold w-44">Owner</th>
                  <th className="py-2 font-semibold w-36">Due</th>
                  <th className="py-2 font-semibold w-28">Criticality</th>
                  <th className="pr-5 py-2 font-semibold w-28 text-right">State</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => {
                  const overdue = i.state === 'open' && i.dueDate && i.dueDate < new Date().toISOString().slice(0, 10);
                  return (
                    <tr key={i.id} className={`border-b border-line/40 align-top ${i.state === 'closed' ? 'opacity-60' : ''}`}>
                      <td className="pl-5 py-1.5">
                        <EditCell value={i.description} disabled={!canEdit} onSave={(v) => (v.trim() ? updateIssue(i.id, { description: v }) : Promise.reject(new Error('Issue can’t be empty')))} />
                        <div className="px-1.5 text-[11px] text-muted">Logged {fmtDate(i.createdAt.slice(0, 10))}{i.createdBy ? ` by ${i.createdBy}` : ''}</div>
                      </td>
                      <td className="py-1.5"><EditCell value={i.owner} disabled={!canEdit} placeholder="Unowned" onSave={(v) => updateIssue(i.id, { owner: v })} /></td>
                      <td className="py-1.5"><EditCell type="date" value={i.dueDate} disabled={!canEdit} onSave={(v) => updateIssue(i.id, { dueDate: v })} className={overdue ? 'text-rose' : ''} /></td>
                      <td className="py-1.5">
                        {canEdit ? (
                          <select value={i.criticality} onChange={(e) => updateIssue(i.id, { criticality: e.target.value as IssueCriticality }).catch(alertError)}
                            className="text-xs rounded-md border border-line bg-surface px-2 py-1">
                            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                          </select>
                        ) : <Badge variant={CRIT_VARIANT[i.criticality]}>{i.criticality}</Badge>}
                      </td>
                      <td className="pr-5 py-1.5 text-right">
                        <button
                          disabled={!canEdit}
                          onClick={() => updateIssue(i.id, { state: i.state === 'open' ? 'closed' : 'open' }).catch(alertError)}
                          className="text-xs font-semibold text-primary hover:underline disabled:no-underline disabled:text-muted"
                        >
                          {i.state === 'open' ? (canEdit ? 'Close' : 'Open') : (canEdit ? 'Reopen' : 'Closed')}
                        </button>
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

/* ── History ──────────────────────────────────────────────────────────── */

function HistoryTab({ projectId }: { projectId: string }) {
  const allBaselines = useDeliveryStore((st) => st.baselines);
  const allCrs = useDeliveryStore((st) => st.changeRequests);
  const baselines = allBaselines.filter((b) => b.projectId === projectId);
  const crs = allCrs.filter((c) => c.projectId === projectId);
  if (baselines.length === 0 && crs.length === 0) {
    return <Card><EmptyState icon={<History size={32} />} title="No history yet" description="Baselines and change requests for this project will appear here." /></Card>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Baselines">
        {baselines.length === 0 ? <p className="text-sm text-muted">No baselines captured.</p> : (
          <ul className="space-y-3">
            {baselines.map((b) => (
              <li key={b.id} className="border-b border-line/40 pb-3 last:border-0 last:pb-0">
                <div className="font-semibold text-ink">{b.label ?? 'Baseline'}</div>
                <div className="text-xs text-muted">
                  {fmtDate(b.snapshotAt.slice(0, 10))} · {b.taskCount} tasks · planned end {fmtDate(b.plannedEnd)}
                  {b.source === 'cr' && ' · after change request'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Change requests">
        {crs.length === 0 ? <p className="text-sm text-muted">No change requests.</p> : (
          <ul className="space-y-3">
            {crs.map((c) => (
              <li key={c.id} className="border-b border-line/40 pb-3 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-ink">{c.title}</div>
                  <Badge variant={c.state === 'approved' ? 'success' : c.state === 'rejected' ? 'danger' : 'warning'}>{c.state}</Badge>
                </div>
                <div className="text-xs text-muted">
                  {fmtDate(c.createdAt.slice(0, 10))}
                  {c.impactDays != null && ` · +${c.impactDays} days`}
                  {c.impactHours != null && ` · +${c.impactHours} hrs`}
                </div>
                {c.approvers.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {c.approvers.map((a, n) => (
                      <span key={n} className="text-[11px] rounded bg-surface-2 px-1.5 py-0.5 text-muted">
                        {a.role}: {a.who} — {a.state}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
