/**
 * Weekly check-ins (status reports). The PM writes this week's update; on
 * submit the plan, heatmap and open issues are frozen into the report so a
 * past week always reads as it did then. Submitted reports are read-only
 * (enforced in the database, migration 034).
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, Send, Copy, ClipboardCheck, Trash2, Loader2 } from 'lucide-react';
import { Card, Badge, Button, EmptyState } from '../../components/ui';
import { useDeliveryStore, currentWeekEnding, type CheckinTextField } from '../../store/useDeliveryStore';
import { fmtDate } from '../../lib/deliveryPlan';
import { alertError, toast } from '../../lib/planToast';
import type { DeliveryCheckin } from '../../types/delivery';

const FIELDS: { key: CheckinTextField; label: string; hint: string }[] = [
  { key: 'activitiesBuild', label: 'Build', hint: 'What was configured or developed this week' },
  { key: 'activitiesTesting', label: 'Testing', hint: 'SIT / UAT progress, defects' },
  { key: 'activitiesDemos', label: 'Demos', hint: 'What was shown to the client and their reaction' },
  { key: 'activitiesPm', label: 'Project management', hint: 'Decisions, risks, staffing, commercials' },
  { key: 'upcomingFocus', label: 'Next week', hint: 'What the team will focus on' },
];

export function CheckinsTab({ projectId, projectName, canEdit }: { projectId: string; projectName: string; canEdit: boolean }) {
  const all = useDeliveryStore((s) => s.checkins);
  const tasks = useDeliveryStore((s) => s.tasks);
  const features = useDeliveryStore((s) => s.features);
  const issues = useDeliveryStore((s) => s.issues);
  const { startCheckin, updateCheckin, submitCheckin, removeCheckin } = useDeliveryStore.getState();
  const checkins = all.filter((c) => c.projectId === projectId);
  const week = currentWeekEnding();
  const draft = checkins.find((c) => c.status === 'draft' && c.weekEnding === week);
  const oldDrafts = checkins.filter((c) => c.status === 'draft' && c.weekEnding !== week);
  const submitted = checkins.filter((c) => c.status === 'submitted');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const openIssues = issues.filter((i) => i.projectId === projectId && i.state === 'open').length;
  const featureCount = features.filter((f) => f.projectId === projectId).length;

  return (
    <div className="space-y-4">
      <Card title={`This week · ending ${fmtDate(week)}`}>
        {draft ? (
          <div className="space-y-4">
            {FIELDS.map((f) => (
              <DraftField key={f.key} label={f.label} hint={f.hint} value={draft[f.key]} disabled={!canEdit}
                onSave={(v) => updateCheckin(draft.id, f.key, v)} />
            ))}
            {canEdit && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/60 pt-4">
                <p className="text-xs text-muted max-w-lg">
                  Submitting freezes the plan ({tasks.length} tasks), heatmap ({featureCount} features) and {openIssues} open issue{openIssues === 1 ? '' : 's'} into this report. It can’t be edited afterwards.
                </p>
                <Button disabled={busy} onClick={async () => {
                  if (!window.confirm('Submit this week’s check-in? It becomes read-only.')) return;
                  setBusy(true);
                  try { await submitCheckin(draft.id); setOpen(draft.id); } catch (e) { alertError(e); } finally { setBusy(false); }
                }}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Submit check-in
                </Button>
              </div>
            )}
          </div>
        ) : canEdit ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-muted">No check-in started for this week.</p>
            <Button disabled={busy} onClick={async () => {
              setBusy(true);
              try { await startCheckin(projectId); } catch (e) { alertError(e); } finally { setBusy(false); }
            }}>
              <ClipboardCheck size={14} /> Start this week’s check-in
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted">No check-in for this week yet.</p>
        )}
      </Card>

      {oldDrafts.length > 0 && (
        <Card title="Unsubmitted drafts from earlier weeks">
          <ul className="space-y-2">
            {oldDrafts.map((c) => (
              <li key={c.id} className="flex items-center justify-between text-sm">
                <span>Week ending {fmtDate(c.weekEnding)}</span>
                {canEdit && (
                  <button className="text-muted/70 hover:text-rose inline-flex items-center gap-1 text-xs"
                    onClick={() => { if (window.confirm('Delete this draft?')) removeCheckin(c.id).catch(alertError); }}>
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card flush title={`Submitted reports · ${submitted.length}`}>
        {submitted.length === 0 ? (
          <EmptyState icon={<ClipboardCheck size={32} />} title="No submitted check-ins" description="Submitted weekly reports for this project will be listed here." />
        ) : (
          <ul>
            {submitted.map((c) => (
              <li key={c.id} className="border-b border-line/40 last:border-0">
                <button onClick={() => setOpen(open === c.id ? null : c.id)} className="w-full flex items-center gap-3 px-5 py-3 text-left">
                  {open === c.id ? <ChevronDown size={15} className="text-muted" /> : <ChevronRight size={15} className="text-muted" />}
                  <span className="font-semibold text-ink">Week ending {fmtDate(c.weekEnding)}</span>
                  <span className="text-xs text-muted">{c.submittedBy ? `by ${c.submittedBy}` : ''}{c.submittedAt ? ` · ${fmtDate(c.submittedAt.slice(0, 10))}` : ''}</span>
                  <span className="ml-auto"><SnapshotBadge c={c} /></span>
                </button>
                {open === c.id && <Report c={c} projectName={projectName} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DraftField({ label, hint, value, disabled, onSave }: {
  label: string; hint: string; value: string | null; disabled: boolean; onSave: (v: string) => Promise<void>;
}) {
  const [v, setV] = useState(value ?? '');
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setV(value ?? ''); }
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <textarea
        value={v}
        disabled={disabled}
        rows={3}
        placeholder={hint}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { if ((value ?? '') !== v) onSave(v).catch((e) => { alertError(e); setV(value ?? ''); }); }}
        className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink disabled:opacity-70"
      />
    </label>
  );
}

function stats(c: DeliveryCheckin) {
  const tasks = c.planSnapshot;
  const done = tasks.filter((t) => t.status === 'done' || (t.percent ?? 0) >= 100).length;
  const built = c.heatmapSnapshot.filter((f) => f.completion_state === 'complete').length;
  const demoed = c.heatmapSnapshot.filter((f) => f.demo_state === 'demoed').length;
  return { total: tasks.length, done, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0, built, demoed, features: c.heatmapSnapshot.length };
}

function SnapshotBadge({ c }: { c: DeliveryCheckin }) {
  const s = stats(c);
  return (
    <span className="flex items-center gap-2">
      {s.total > 0 && <Badge variant="neutral">Plan {s.pct}%</Badge>}
      {c.parkingLotSnapshot.length > 0 && <Badge variant="warning">{c.parkingLotSnapshot.length} open issue{c.parkingLotSnapshot.length === 1 ? '' : 's'}</Badge>}
    </span>
  );
}

/** Plain-text version for pasting into an email or Teams. */
function asText(c: DeliveryCheckin, projectName: string): string {
  const s = stats(c);
  const lines = [`${projectName} — status for week ending ${fmtDate(c.weekEnding)}`, ''];
  if (s.total) lines.push(`Plan: ${s.done}/${s.total} tasks complete (${s.pct}%)`);
  if (s.features) lines.push(`Features: ${s.built}/${s.features} built, ${s.demoed} demoed`);
  lines.push('');
  for (const f of FIELDS) {
    const v = c[f.key];
    if (v) lines.push(`${f.label}:`, v, '');
  }
  if (c.parkingLotSnapshot.length) {
    lines.push('Open issues:');
    for (const i of c.parkingLotSnapshot) lines.push(`- [${i.criticality ?? 'medium'}] ${i.description.split('\n')[0]}${i.owner ? ` (owner: ${i.owner})` : ''}${i.due_date ? ` — due ${fmtDate(i.due_date)}` : ''}`);
  }
  return lines.join('\n').trim();
}

function Report({ c, projectName }: { c: DeliveryCheckin; projectName: string }) {
  const s = stats(c);
  const phases = new Map<string, { done: number; total: number }>();
  for (const t of c.planSnapshot) {
    const k = (t.phase ?? '').trim() || 'Unphased';
    const p = phases.get(k) ?? { done: 0, total: 0 };
    p.total += 1;
    if (t.status === 'done' || (t.percent ?? 0) >= 100) p.done += 1;
    phases.set(k, p);
  }
  const written = FIELDS.filter((f) => c[f.key]);
  return (
    <div className="px-5 pb-5 space-y-4">
      <div className="flex justify-end">
        <button className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          onClick={() => navigator.clipboard.writeText(asText(c, projectName)).then(() => toast('Copied — paste into an email or Teams.', 'ok'), alertError)}>
          <Copy size={13} /> Copy as text
        </button>
      </div>

      {written.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {written.map((f) => (
            <div key={f.key}>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">{f.label}</div>
              <p className="text-sm text-ink whitespace-pre-line">{c[f.key]}</p>
            </div>
          ))}
        </div>
      ) : <p className="text-sm text-muted italic">No written update — this report is the plan, heatmap and issues as they stood that week.</p>}

      {s.total > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Plan · {s.done}/{s.total} tasks ({s.pct}%)</div>
          <div className="flex flex-wrap gap-2">
            {Array.from(phases, ([name, p]) => (
              <span key={name} className={`text-xs rounded-md px-2 py-1 ring-1 ring-inset ${p.done === p.total ? 'bg-green/10 text-green ring-green/25' : p.done > 0 ? 'bg-gold/10 text-gold ring-gold/25' : 'bg-surface-2 text-muted ring-line'}`}>
                {name} {p.done}/{p.total}
              </span>
            ))}
          </div>
        </div>
      )}

      {s.features > 0 && (
        <div className="text-sm text-ink"><span className="text-xs font-semibold uppercase tracking-wide text-muted">Features · </span>{s.built}/{s.features} built, {s.demoed} demoed</div>
      )}

      {c.parkingLotSnapshot.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">Open issues that week</div>
          <ul className="space-y-1.5">
            {c.parkingLotSnapshot.map((i) => (
              <li key={i.id} className="text-sm text-ink flex gap-2">
                <Badge className="self-start shrink-0" variant={i.criticality === 'high' || i.criticality === 'critical' ? 'danger' : 'warning'}>{i.criticality ?? 'medium'}</Badge>
                <span className="whitespace-pre-line">{i.description}{i.owner && <span className="text-muted"> · {i.owner}</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
