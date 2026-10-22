/**
 * Change requests and their approvals. Each CR carries Governance's four
 * sign-offs (PM, architect, delivery lead, client sponsor). An editor
 * records each decision; when the last one approves, the database adds the
 * CR work to the plan, moves the end date and saves a new baseline
 * (delivery_cr_decide, migration 036). One rejection rejects the CR.
 */
import { useMemo, useState } from 'react';
import { FileSignature, Plus, Loader2, Check, X, Undo2, Trash2, Sparkles, Pencil } from 'lucide-react';
import { Card, Badge, Button, EmptyState, Drawer } from '../../components/ui';
import { useDeliveryStore, type CrDraft } from '../../store/useDeliveryStore';
import { alertError, toast } from '../../lib/planToast';
import { fmtDate } from '../../lib/deliveryPlan';
import { Field, inputClass, PeopleDatalist } from './planUi';
import type { DeliveryChangeRequest, CrApprover } from '../../types/delivery';

const STATE: Record<string, { label: string; variant: 'warning' | 'success' | 'danger' | 'neutral' }> = {
  pending: { label: 'Awaiting approval', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
};

export function ChangeRequestsTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const all = useDeliveryStore((s) => s.changeRequests);
  const crs = useMemo(() => all.filter((c) => c.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [all, projectId]);
  const [editing, setEditing] = useState<DeliveryChangeRequest | 'new' | null>(null);
  const approved = crs.filter((c) => c.state === 'approved');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid grid-cols-3 gap-3 flex-1 min-w-[18rem]">
          <Tile label="Awaiting approval" value={String(crs.filter((c) => c.state === 'pending').length)} />
          <Tile label="Approved" value={String(approved.length)} sub={approved.length ? `+${approved.reduce((n, c) => n + (c.impactDays ?? 0), 0)} days · ${approved.reduce((n, c) => n + (c.impactHours ?? 0), 0)} hrs` : undefined} />
          <Tile label="Rejected" value={String(crs.filter((c) => c.state === 'rejected').length)} />
        </div>
        {canEdit && <Button onClick={() => setEditing('new')}><Plus size={14} /> New change request</Button>}
      </div>

      {crs.length === 0 ? (
        <Card><EmptyState icon={<FileSignature size={32} />} title="No change requests" description="Raise one from an out-of-scope client request on the Requests tab, or create one here." /></Card>
      ) : (
        crs.map((c) => <CrCard key={c.id} cr={c} canEdit={canEdit} onEdit={() => setEditing(c)} />)
      )}

      <CrEditor projectId={projectId} target={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function CrCard({ cr, canEdit, onEdit }: { cr: DeliveryChangeRequest; canEdit: boolean; onEdit: () => void }) {
  const { decideCr, removeChangeRequest, updateChangeRequest } = useDeliveryStore.getState();
  const requests = useDeliveryStore((s) => s.requests);
  const req = cr.requestId ? requests.find((r) => r.id === cr.requestId) : null;
  const st = STATE[cr.state] ?? { label: cr.state, variant: 'neutral' as const };
  const [busy, setBusy] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const pending = cr.state === 'pending';
  const done = cr.approvers.filter((a) => a.state === 'approved').length;

  const decide = async (i: number, d: 'approved' | 'rejected' | 'pending', n?: string) => {
    setBusy(i);
    try {
      await decideCr(cr.id, i, d, n);
      const after = useDeliveryStore.getState().changeRequests.find((x) => x.id === cr.id);
      if (after?.state === 'approved') toast('Approved — plan, end date and baseline updated', 'ok');
      else if (after?.state === 'rejected') toast('Change request rejected', 'ok');
    } catch (e) { alertError(e); } finally { setBusy(null); setRejecting(null); setNote(''); }
  };

  const setWho = (i: number, who: string) => {
    const next: CrApprover[] = cr.approvers.map((a, j) => (j === i ? { ...a, who: who.trim() || 'TBD' } : a));
    updateChangeRequest(cr.id, { approvers: next }).catch(alertError);
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[16rem]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-ink">{cr.title}</span>
            <Badge variant={st.variant}>{st.label}</Badge>
          </div>
          <div className="mt-1 text-xs text-muted">
            Raised {fmtDate(cr.createdAt.slice(0, 10))}{cr.requestedBy && ` by ${cr.requestedBy}`}
            {cr.impactDays != null && ` · +${cr.impactDays} days`}{cr.impactHours != null && ` · ${cr.impactHours} hrs`}
            {cr.decidedAt && ` · decided ${fmtDate(cr.decidedAt.slice(0, 10))}`}
          </div>
          {cr.milestoneShift && <div className="mt-1 text-xs text-ink">{cr.milestoneShift}</div>}
          {req && <div className="mt-1 text-xs text-muted">From client request: “{req.text.slice(0, 120)}{req.text.length > 120 ? '…' : ''}”</div>}
          {cr.description && <p className="mt-2 text-sm text-ink whitespace-pre-line">{cr.description}</p>}
          {cr.state === 'approved' && cr.baselineId && <p className="mt-2 text-xs text-green">Applied: CR task added to the plan and a new baseline saved.</p>}
        </div>
        {canEdit && pending && (
          <div className="flex items-center gap-2 text-muted">
            <button title="Edit" className="hover:text-ink" onClick={onEdit}><Pencil size={14} /></button>
            <button title="Delete" className="hover:text-rose" onClick={() => { if (window.confirm(`Delete “${cr.title}”?`)) removeChangeRequest(cr.id).catch(alertError); }}><Trash2 size={14} /></button>
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-line/60 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Sign-off {done}/{cr.approvers.length}</div>
        <div className="grid gap-2 md:grid-cols-2">
          {cr.approvers.map((a, i) => (
            <div key={i} className={`rounded-lg border px-3 py-2 ${a.state === 'approved' ? 'border-green/40 bg-green/5' : a.state === 'rejected' ? 'border-rose/40 bg-rose/5' : 'border-line'}`}>
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted">{a.role}</div>
                  {canEdit && pending && a.state === 'pending' ? (
                    <input defaultValue={a.who === 'TBD' ? '' : a.who} placeholder="Name" list="cr-people"
                      onBlur={(e) => { if ((e.target.value.trim() || 'TBD') !== a.who) setWho(i, e.target.value); }}
                      className="w-full bg-transparent text-sm font-semibold text-ink border-b border-transparent hover:border-line focus:border-primary focus:outline-none" />
                  ) : (
                    <div className="text-sm font-semibold text-ink truncate">{a.who}</div>
                  )}
                </div>
                {a.state === 'approved' && <span className="text-xs font-semibold text-green inline-flex items-center gap-1"><Check size={12} /> Approved</span>}
                {a.state === 'rejected' && <span className="text-xs font-semibold text-rose inline-flex items-center gap-1"><X size={12} /> Rejected</span>}
                {canEdit && pending && a.state === 'pending' && (
                  <div className="flex gap-1">
                    <Button size="sm" disabled={busy !== null} onClick={() => decide(i, 'approved')}>{busy === i ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Approve</Button>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setRejecting(rejecting === i ? null : i)}>Reject</Button>
                  </div>
                )}
                {canEdit && pending && a.state !== 'pending' && (
                  <button title="Undo" className="text-muted hover:text-ink" disabled={busy !== null} onClick={() => decide(i, 'pending')}><Undo2 size={14} /></button>
                )}
              </div>
              {(a.at || a.note) && (
                <div className="mt-1 text-[11px] text-muted">
                  {a.at && fmtDate(a.at.slice(0, 10))}{a.by && a.by !== a.who && ` · recorded by ${a.by}`}{a.note && ` · “${a.note}”`}
                </div>
              )}
              {rejecting === i && (
                <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (note.trim()) void decide(i, 'rejected', note); }}>
                  <input autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (kept on record)" className="flex-1 rounded border border-line px-2 py-1 text-xs" />
                  <Button size="sm" variant="danger" type="submit" disabled={!note.trim()}>Reject CR</Button>
                </form>
              )}
            </div>
          ))}
        </div>
        <PeopleDatalist id="cr-people" />
        {pending && <p className="mt-2 text-[11px] text-muted">When every sign-off is approved, the work is added to the plan as a task, the end date moves by {cr.impactDays ?? 0} days and a new baseline is saved.</p>}
      </div>
    </Card>
  );
}

function CrEditor({ projectId, target, onClose }: { projectId: string; target: DeliveryChangeRequest | 'new' | null; onClose: () => void }) {
  const { createChangeRequest, updateChangeRequest, ai } = useDeliveryStore.getState();
  const requests = useDeliveryStore((s) => s.requests);
  const openReqs = requests.filter((r) => r.projectId === projectId && !r.crId && r.verdict !== 'green');
  const isNew = target === 'new';
  const cr = target && target !== 'new' ? target : null;
  const [seen, setSeen] = useState<typeof target>(null);
  const [f, setF] = useState<CrDraft & { requestId: string }>({ title: '', description: '', impactDays: null, impactHours: null, milestoneShift: '', requestId: '' });
  const [busy, setBusy] = useState<string | null>(null);
  if (seen !== target) {
    setSeen(target);
    setF(cr ? { title: cr.title, description: cr.description ?? '', impactDays: cr.impactDays, impactHours: cr.impactHours, milestoneShift: cr.milestoneShift ?? '', requestId: cr.requestId ?? '' }
      : { title: '', description: '', impactDays: null, impactHours: null, milestoneShift: '', requestId: '' });
  }
  const num = (v: string) => (v === '' ? null : Math.max(0, Math.round(Number(v)) || 0));

  const draftFromRequest = async (requestId: string) => {
    setBusy('Drafting with AI…');
    try {
      const out = await ai<{ draft: { title: string; description: string; impact_days: number; impact_hours: number; milestone_shift: string } }>('draft-cr', { requestId });
      setF({ requestId, title: out.draft.title, description: out.draft.description, impactDays: out.draft.impact_days, impactHours: out.draft.impact_hours, milestoneShift: out.draft.milestone_shift });
    } catch (e) { alertError(e); } finally { setBusy(null); }
  };

  return (
    <Drawer open={!!target} onClose={onClose} title={isNew ? 'New change request' : 'Edit change request'} width="max-w-xl">
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        setBusy('Saving…');
        try {
          if (cr) await updateChangeRequest(cr.id, f);
          else await createChangeRequest(projectId, { ...f, requestId: f.requestId || null });
          onClose();
        } catch (err) { alertError(err); } finally { setBusy(null); }
      }}>
        {isNew && openReqs.length > 0 && (
          <Field label="From a client request (optional)" hint="Claude drafts the title, scope, estimate and milestone impact from the request and the SOW.">
            <div className="flex gap-2">
              <select value={f.requestId} onChange={(e) => setF({ ...f, requestId: e.target.value })} className={inputClass}>
                <option value="">— None —</option>
                {openReqs.map((r) => <option key={r.id} value={r.id}>{r.text.slice(0, 90)}</option>)}
              </select>
              <Button type="button" variant="secondary" disabled={!f.requestId || !!busy} onClick={() => draftFromRequest(f.requestId)}><Sparkles size={14} /> Draft</Button>
            </div>
          </Field>
        )}
        <Field label="Title *"><input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inputClass} /></Field>
        <Field label="What will be delivered"><textarea rows={7} value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} className={inputClass} /></Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Effort (hours)"><input type="number" min={0} value={f.impactHours ?? ''} onChange={(e) => setF({ ...f, impactHours: num(e.target.value) })} className={inputClass} /></Field>
          <Field label="Plan delay (days)"><input type="number" min={0} value={f.impactDays ?? ''} onChange={(e) => setF({ ...f, impactDays: num(e.target.value) })} className={inputClass} /></Field>
        </div>
        <Field label="Milestone impact"><input value={f.milestoneShift ?? ''} onChange={(e) => setF({ ...f, milestoneShift: e.target.value })} className={inputClass} placeholder="e.g. Go-live moves from 14 Nov to 28 Nov" /></Field>
        {busy && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> {busy}</div>}
        <div className="flex justify-end gap-2 border-t border-line/60 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!!busy || !f.title.trim()}>{isNew ? 'Create — send for sign-off' : 'Save'}</Button>
        </div>
      </form>
    </Drawer>
  );
}
