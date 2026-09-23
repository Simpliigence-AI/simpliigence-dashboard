/**
 * Client requests and the scope check. Each request the client makes
 * mid-project is logged here and judged by Claude against the signed scope
 * (frozen requirements, exclusions and the frozen SOW PDF):
 *   green — in scope, absorb it · amber — unclear, clarify · red — out of
 *   scope, raise a change request.
 * PMs can override a verdict (the first verdict is kept) and turn a request
 * into a change request in one click.
 */
import { useMemo, useState } from 'react';
import { MessageSquareWarning, Loader2, RefreshCw, FileSignature, Copy, Trash2, ChevronDown, ChevronRight, Pencil, ShieldCheck, AlertTriangle } from 'lucide-react';
import { Card, Button, Badge, EmptyState } from '../../components/ui';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import { alertError, toast } from '../../lib/planToast';
import { fmtDate, todayIso } from '../../lib/deliveryPlan';
import type { DeliveryProject, DeliveryRequest, RequestVerdict, RequestState } from '../../types/delivery';

const VERDICT: Record<RequestVerdict, { label: string; cls: string; dot: string }> = {
  green: { label: 'In scope', cls: 'bg-green/15 text-green ring-green/30', dot: 'bg-green' },
  amber: { label: 'Unclear', cls: 'bg-gold/15 text-gold ring-gold/30', dot: 'bg-gold' },
  red: { label: 'Out of scope', cls: 'bg-rose/15 text-rose ring-rose/30', dot: 'bg-rose' },
};
const STATE_LABEL: Record<RequestState, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  open: { label: 'Open', variant: 'info' },
  'awaiting-clarification': { label: 'Awaiting clarification', variant: 'warning' },
  applied: { label: 'Absorbed', variant: 'success' },
  'cr-raised': { label: 'CR raised', variant: 'neutral' },
  declined: { label: 'Declined', variant: 'neutral' },
};
const SOURCES = ['Client Email', 'Verbal / Meeting', 'Teams', 'Status call', 'Zoho Desk', 'Manual'];
const isOpen = (r: DeliveryRequest) => r.state === 'open' || r.state === 'awaiting-clarification';

export function RequestsTab({ project, canEdit }: { project: DeliveryProject; canEdit: boolean }) {
  const all = useDeliveryStore((s) => s.requests);
  const requests = useMemo(() => all.filter((r) => r.projectId === project.id), [all, project.id]);
  const [filter, setFilter] = useState<'open' | 'all' | RequestVerdict>('open');

  const shown = requests.filter((r) =>
    filter === 'all' ? true : filter === 'open' ? isOpen(r) : r.verdict === filter);
  const count = (v: RequestVerdict) => requests.filter((r) => r.verdict === v).length;
  const outHours = requests.filter((r) => r.verdict === 'red' && isOpen(r)).reduce((n, r) => n + (r.impactHours ?? 0), 0);

  return (
    <div className="space-y-4">
      <ScopeCard project={project} canEdit={canEdit} />
      {canEdit && <LogRequest projectId={project.id} />}

      {requests.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Tile label="Open" value={requests.filter(isOpen).length} />
          <Tile label="In scope" value={count('green')} dot="bg-green" />
          <Tile label="Unclear" value={count('amber')} dot="bg-gold" />
          <Tile label="Out of scope" value={count('red')} dot="bg-rose" sub={outHours ? `${outHours} hrs open, unbilled` : undefined} />
        </div>
      )}

      <Card flush>
        {requests.length === 0 ? (
          <EmptyState icon={<MessageSquareWarning size={32} />} title="No client requests logged"
            description="Log anything the client asks for mid-project. Each one is checked against the signed scope so scope creep gets caught before the team builds it." />
        ) : (
          <>
            <div className="flex flex-wrap gap-1 px-5 py-3 border-b border-line/60">
              {([['open', `Open ${requests.filter(isOpen).length}`], ['all', `All ${requests.length}`], ['red', `Out of scope ${count('red')}`], ['amber', `Unclear ${count('amber')}`], ['green', `In scope ${count('green')}`]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold ${filter === k ? 'bg-ink text-white' : 'text-muted hover:text-ink hover:bg-surface-2'}`}>{label}</button>
              ))}
            </div>
            <ul>
              {shown.map((r) => <RequestRow key={r.id} r={r} canEdit={canEdit} />)}
              {shown.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">Nothing here.</li>}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value, dot, sub }: { label: string; value: number; dot?: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-4 py-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}{label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

function ScopeCard({ project, canEdit }: { project: DeliveryProject; canEdit: boolean }) {
  const { updateScope } = useDeliveryStore.getState();
  const docs = useDeliveryStore((s) => s.documents);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reqs, setReqs] = useState('');
  const [excl, setExcl] = useState('');
  const [saving, setSaving] = useState(false);
  const nReq = project.frozenRequirements.length;
  const nExcl = project.frozenExclusions.length;
  const frozenSow = docs.filter((d) => d.projectId === project.id && d.state === 'frozen' && (d.docType ?? '').toUpperCase().startsWith('SOW'));
  const empty = nReq === 0 && nExcl === 0 && frozenSow.length === 0;

  const startEdit = () => {
    setReqs(project.frozenRequirements.join('\n'));
    setExcl(project.frozenExclusions.join('\n'));
    setEditing(true); setOpen(true);
  };

  return (
    <div className={`rounded-xl border px-5 py-3 ${empty ? 'border-gold/40 bg-gold/5' : 'border-line/70 bg-surface'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {empty ? <AlertTriangle size={15} className="text-gold" /> : <ShieldCheck size={15} className="text-green" />}
          Signed scope
        </button>
        <span className="text-sm text-muted">
          {nReq} requirement{nReq === 1 ? '' : 's'} · {nExcl} exclusion{nExcl === 1 ? '' : 's'} · {frozenSow.length ? `SOW: ${frozenSow.map((d) => d.name).join(', ')}` : 'no frozen SOW'}
        </span>
        {canEdit && !editing && <button onClick={startEdit} className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink"><Pencil size={13} /> Edit scope</button>}
      </div>
      {empty && !open && (
        <p className="mt-1 text-xs text-gold">No scope baseline yet — most requests will come back “Unclear”. Add the SOW’s requirements and exclusions, or freeze the signed SOW PDF on the Documents tab.</p>
      )}
      {open && !editing && (
        <div className="mt-3 grid gap-4 md:grid-cols-2 text-sm">
          <ScopeList title="In scope" items={project.frozenRequirements} />
          <ScopeList title="Excluded" items={project.frozenExclusions} />
        </div>
      )}
      {editing && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">In scope — one per line
              <textarea value={reqs} onChange={(e) => setReqs(e.target.value)} rows={10}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink" />
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Excluded — one per line
              <textarea value={excl} onChange={(e) => setExcl(e.target.value)} rows={10}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal normal-case tracking-normal text-ink" />
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={saving} onClick={async () => {
              setSaving(true);
              try {
                await updateScope(project.id, { frozenRequirements: reqs.split('\n'), frozenExclusions: excl.split('\n') });
                setEditing(false); toast('Scope saved', 'ok');
              } catch (err) { alertError(err); } finally { setSaving(false); }
            }}>{saving && <Loader2 size={14} className="animate-spin" />} Save scope</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScopeList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-1">{title}</div>
      {items.length === 0 ? <p className="text-muted">None listed.</p> : (
        <ol className="list-decimal pl-5 space-y-0.5 text-ink">{items.map((x, i) => <li key={i}>{x}</li>)}</ol>
      )}
    </div>
  );
}

function LogRequest({ projectId }: { projectId: string }) {
  const { addRequest, classifyRequest } = useDeliveryStore.getState();
  const [text, setText] = useState('');
  const [requester, setRequester] = useState('');
  const [source, setSource] = useState('Client Email');
  const [date, setDate] = useState(todayIso());
  const [busy, setBusy] = useState<'saving' | 'checking' | null>(null);

  return (
    <form
      className="rounded-xl border border-line/70 bg-surface px-5 py-4 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setBusy('saving');
        try {
          const r = await addRequest(projectId, { text, requester, source, receivedAt: date });
          setText(''); setRequester('');
          setBusy('checking');
          await classifyRequest(r.id).catch((err) => alertError(new Error(`Logged, but the scope check failed: ${(err as Error).message}`)));
        } catch (err) { alertError(err); } finally { setBusy(null); }
      }}
    >
      <div className="text-sm font-semibold text-ink">Log a client request</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
        placeholder="Paste what the client asked for, e.g. “Can we also sync invoices to QuickBooks before go-live?”"
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="Who asked"
          className="w-44 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" />
        <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
          {SOURCES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
        <Button type="submit" size="sm" className="ml-auto" disabled={!text.trim() || !!busy}>
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy === 'checking' ? 'Checking scope…' : busy === 'saving' ? 'Saving…' : 'Log & check scope'}
        </Button>
      </div>
    </form>
  );
}

function RequestRow({ r, canEdit }: { r: DeliveryRequest; canEdit: boolean }) {
  const { classifyRequest, overrideVerdict, setRequestState, removeRequest, raiseChangeRequest } = useDeliveryStore.getState();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [overriding, setOverriding] = useState(false);
  const [ov, setOv] = useState<{ verdict: RequestVerdict; reason: string }>({ verdict: 'green', reason: '' });
  const v = r.verdict ? VERDICT[r.verdict] : null;
  const st = STATE_LABEL[r.state] ?? STATE_LABEL.open;
  const long = r.text.length > 240 || r.text.split('\n').length > 3;

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast(ok, 'ok'); } catch (err) { alertError(err); } finally { setBusy(false); }
  };

  return (
    <li className="px-5 py-4 border-b border-line/40 last:border-0">
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-32 shrink-0">
          {v ? (
            <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-xs font-bold ring-1 ring-inset ${v.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />{v.label}
            </span>
          ) : busy ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted"><Loader2 size={12} className="animate-spin" /> Checking</span>
          ) : (
            <span className="text-xs text-muted">Not checked</span>
          )}
          {r.confidence != null && <div className="mt-1 text-[11px] text-muted">{Math.round(r.confidence * 100)}% sure</div>}
        </div>

        <div className="flex-1 min-w-[16rem]">
          <p className={`text-sm text-ink whitespace-pre-line ${long && !expanded ? 'line-clamp-3' : ''}`}>{r.text}</p>
          {long && <button onClick={() => setExpanded((x) => !x)} className="text-xs font-semibold text-muted hover:text-ink">{expanded ? 'Show less' : 'Show more'}</button>}
          <div className="mt-1 text-xs text-muted">
            {fmtDate(r.receivedAt.slice(0, 10))}{r.requester && ` · ${r.requester}`}{r.source && ` · ${r.source}`}
            {r.verdict && r.verdict !== 'green' && (r.impactHours || r.impactDays) ? ` · est. ${r.impactHours ?? 0} hrs / +${r.impactDays ?? 0} days` : ''}
          </div>
          {(r.matched || r.detail) && (
            <div className="mt-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-ink space-y-1">
              {r.matched && <div><span className="font-semibold text-muted">Matched: </span>{r.matched}</div>}
              {r.detail && <div>{r.detail}</div>}
              {r.originalVerdict && r.originalVerdict !== r.verdict && (
                <div className="text-muted">Overridden from {VERDICT[r.originalVerdict]?.label ?? r.originalVerdict}{r.appealResolvedBy && ` by ${r.appealResolvedBy}`}{r.appealResolution && ` — “${r.appealResolution}”`}</div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <Badge variant={st.variant}>{st.label}</Badge>
          <div className="flex items-center gap-2 text-muted">
            {r.detail && (
              <button title="Copy the explanation for the client" className="hover:text-ink"
                onClick={() => navigator.clipboard.writeText(r.detail ?? '').then(() => toast('Copied', 'ok'), alertError)}><Copy size={14} /></button>
            )}
            {canEdit && (
              <>
                <button title="Check scope again" disabled={busy} className="hover:text-ink disabled:opacity-50"
                  onClick={() => run(() => classifyRequest(r.id), 'Re-checked')}><RefreshCw size={14} className={busy ? 'animate-spin' : ''} /></button>
                <button title="Delete request" className="hover:text-rose"
                  onClick={() => { if (window.confirm('Delete this request?')) removeRequest(r.id).catch(alertError); }}><Trash2 size={14} /></button>
              </>
            )}
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="mt-3 ml-0 md:ml-[8.75rem] flex flex-wrap gap-2">
          {!r.crId && r.verdict !== 'green' && r.state !== 'declined' && (
            <Button size="sm" disabled={busy} onClick={() => run(() => raiseChangeRequest(r.id), 'Change request created — see History')}>
              <FileSignature size={14} /> Raise change request
            </Button>
          )}
          {isOpen(r) && (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => setRequestState(r.id, 'applied'))}>Absorb (no charge)</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => setRequestState(r.id, 'declined'))}>Decline</Button>
            </>
          )}
          {!isOpen(r) && r.state !== 'cr-raised' && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => setRequestState(r.id, 'open'))}>Reopen</Button>
          )}
          {r.verdict && (
            <Button size="sm" variant="ghost" onClick={() => { setOv({ verdict: r.verdict === 'green' ? 'red' : 'green', reason: '' }); setOverriding((x) => !x); }}>
              Override verdict
            </Button>
          )}
        </div>
      )}

      {overriding && (
        <form className="mt-2 ml-0 md:ml-[8.75rem] flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ov.reason.trim()) return;
            void run(() => overrideVerdict(r.id, ov.verdict, ov.reason), 'Verdict updated').then(() => setOverriding(false));
          }}>
          <select value={ov.verdict} onChange={(e) => setOv({ ...ov, verdict: e.target.value as RequestVerdict })}
            className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
            <option value="green">In scope</option>
            <option value="amber">Unclear</option>
            <option value="red">Out of scope</option>
          </select>
          <input value={ov.reason} onChange={(e) => setOv({ ...ov, reason: e.target.value })} placeholder="Why? (kept on record)"
            className="flex-1 min-w-[16rem] rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" />
          <Button type="submit" size="sm" disabled={!ov.reason.trim() || busy}>Save</Button>
        </form>
      )}
    </li>
  );
}
