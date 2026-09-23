/**
 * History: baselines (the plan as it stood at kick-off and after each
 * approved change request) and the change log — every edit to the plan,
 * issues, heatmap, requests, CRs and documents, including Governance's.
 */
import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { Card, EmptyState } from '../../components/ui';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import { fmtDate } from '../../lib/deliveryPlan';

const ENTITY: Record<string, string> = {
  task: 'Task', issue: 'Issue', heatmap: 'Feature', checkin: 'Check-in', cr: 'Change request', request: 'Client request',
  document: 'Document', project: 'Project', baseline: 'Baseline', sow: 'SOW', feedback: 'Feedback', team: 'Team',
};
const VERB: Record<string, string> = {
  insert: 'added', add: 'added', create: 'added', update: 'changed', delete: 'deleted', remove: 'deleted',
  submit: 'submitted', approve: 'approved', reject: 'rejected', classify: 'classified', upload: 'uploaded',
  generate: 'generated', apply: 'applied', shift: 'shifted', appeal: 'appealed',
};
const FIELD: Record<string, string> = {
  start_date: 'start', end_date: 'end', percent: '% done', status: 'status', name: 'name', phase: 'phase', assignee: 'assignee',
  current_end: 'end date', planned_end: 'baseline end', state: 'state', verdict: 'verdict', criticality: 'criticality',
  completion_state: 'build state', demo_state: 'demo state', approvers: 'sign-off', frozen_requirements: 'scope list',
  frozen_exclusions: 'exclusions', pm: 'PM', delivery_lead: 'delivery lead', storage_path: 'file', doc_type: 'type',
  sort_order: 'order', impact_hours: 'hours', impact_days: 'days', owner: 'owner', due_date: 'due date', description: 'description',
};

function describe(action: string, payload: Record<string, unknown>): string {
  const [ent, verb] = action.split('.');
  const what = ENTITY[ent] ?? ent;
  const did = VERB[verb] ?? verb ?? '';
  const label = (payload.label ?? payload.name ?? payload.title ?? payload.desc ?? payload.week ?? '') as string;
  const fields = Array.isArray(payload.fields) ? (payload.fields as string[]).map((f) => FIELD[f] ?? f.replace(/_/g, ' ')) : [];
  return `${what} ${did}${label ? ` — ${String(label).slice(0, 120)}` : ''}${fields.length ? ` (${fields.join(', ')})` : ''}`;
}

export function HistoryTab({ projectId }: { projectId: string }) {
  const allBaselines = useDeliveryStore((st) => st.baselines);
  const allAudit = useDeliveryStore((st) => st.audit);
  const baselines = allBaselines.filter((b) => b.projectId === projectId);
  const [filter, setFilter] = useState('all');
  const audit = useMemo(() => allAudit.filter((a) => a.projectId === projectId), [allAudit, projectId]);
  const kinds = useMemo(() => Array.from(new Set(audit.map((a) => a.action.split('.')[0]))), [audit]);
  const shown = audit.filter((a) => filter === 'all' || a.action.startsWith(filter + '.'));

  if (baselines.length === 0 && audit.length === 0) {
    return <Card><EmptyState icon={<History size={32} />} title="No history yet" description="Baselines and every change to this project will appear here." /></Card>;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <Card title="Baselines">
        {baselines.length === 0 ? <p className="text-sm text-muted">No baselines captured.</p> : (
          <ul className="space-y-3">
            {baselines.slice().reverse().map((b) => (
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
        <p className="mt-3 text-[11px] text-muted">The Gantt chart’s “Baseline” overlay compares the plan with the latest one.</p>
      </Card>
      <Card title="Change log" flush>
        <div className="flex flex-wrap gap-1 px-5 py-3 border-b border-line/60">
          {['all', ...kinds].map((k) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold ${filter === k ? 'bg-ink text-white' : 'text-muted hover:text-ink hover:bg-surface-2'}`}>
              {k === 'all' ? `All ${audit.length}` : ENTITY[k] ?? k}
            </button>
          ))}
        </div>
        <ul className="max-h-[36rem] overflow-y-auto">
          {shown.map((a) => (
            <li key={a.id} className="flex gap-3 px-5 py-2 border-b border-line/30 last:border-0 text-sm">
              <span className="w-28 shrink-0 text-xs text-muted tabular-nums">{new Date(a.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              <span className="w-32 shrink-0 truncate text-xs font-semibold text-ink" title={a.actor ?? ''}>{a.actor ?? '—'}</span>
              <span className="text-ink/90">{describe(a.action, a.payload)}</span>
            </li>
          ))}
          {shown.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">Nothing logged yet.</li>}
        </ul>
        <p className="px-5 py-2 text-[11px] text-muted border-t border-line/60">Latest 300 entries.</p>
      </Card>
    </div>
  );
}
