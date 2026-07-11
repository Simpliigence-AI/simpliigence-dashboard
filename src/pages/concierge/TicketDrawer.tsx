import { useEffect, useState } from 'react';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { useConciergeStore, type ConciergeTicket } from '../../store/useConciergeStore';
import { useConciergeAccountsStore } from '../../store/useConciergeAccountsStore';
import { useAuthStore } from '../../store/useAuthStore';
import { Clock, Mail, StickyNote, Check, RotateCcw, Paperclip, Download, Trash2, Plus, Minus } from 'lucide-react';

interface Props {
  ticket: ConciergeTicket;
  onClose: () => void;
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function TicketDrawer({ ticket, onClose }: Props) {
  const store = useConciergeStore();
  const { accounts } = useConciergeAccountsStore();
  const directory = useAuthStore((s) => s.directory);
  const currentUser = useAuthStore((s) => s.currentUser);
  const users = Object.values(directory).sort((a, b) =>
    (a.fullName || a.email).localeCompare(b.fullName || b.email));

  const [notesDraft, setNotesDraft] = useState('');
  const [draftMinutes, setDraftMinutes] = useState(15);
  const [hoursNotes, setHoursNotes] = useState('');
  const [resolutionDraft, setResolutionDraft] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [busy, setBusy] = useState<'note' | 'hours' | 'resolve' | 'delete' | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const messages = store.messagesByTicket[ticket.id] ?? [];
  const entries = store.timeEntriesByTicket[ticket.id] ?? [];
  const attachments = store.attachmentsByTicket[ticket.id] ?? [];

  useEffect(() => {
    void store.loadMessages(ticket.id);
    void store.loadTimeEntries(ticket.id);
    void store.loadAttachments(ticket.id);
  }, [ticket.id, store]);

  const priorityChip = (p: string | null) => {
    const val = (p ?? 'medium').toLowerCase();
    const map: Record<string, string> = {
      urgent: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-slate-100 text-slate-700 border-slate-300',
      low: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    };
    return `inline-block px-2 py-0.5 text-xs font-semibold rounded border ${map[val] || map.medium}`;
  };

  const isResolved = ticket.status === 'Resolved' || ticket.status === 'Closed';
  const bumpMinutes = (delta: number) => setDraftMinutes((m) => Math.max(15, Math.min(480, m + delta)));

  const openAttachment = async (storagePath: string) => {
    const url = await store.attachmentDownloadUrl(storagePath);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <Drawer open={true} onClose={onClose} title={`#${ticket.ticketNumber} — ${ticket.subject}`} width="max-w-3xl">
      <div className="space-y-6">
        {/* Header meta */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className={priorityChip(ticket.priority)}>{ticket.priority ?? 'medium'}</span>
          <span className="px-2 py-0.5 rounded border border-slate-300 bg-white font-medium">{ticket.status}</span>
          {ticket.source && <span className="text-slate-400">via {ticket.source}</span>}
          <span className="ml-auto">Created {fmt(ticket.createdTime)}</span>
        </div>

        {/* From address (prominent — separate from tiny meta chip) */}
        {(ticket.senderEmail || ticket.senderName) && (
          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
            <span className="text-xs text-slate-500 uppercase tracking-wider mr-2">From</span>
            <span className="font-medium text-slate-800">{ticket.senderName || '—'}</span>
            {ticket.senderEmail && (
              <a href={`mailto:${ticket.senderEmail}`} className="ml-2 text-primary hover:underline">
                &lt;{ticket.senderEmail}&gt;
              </a>
            )}
          </div>
        )}

        {/* Editable fields grid */}
        <section className="grid grid-cols-2 gap-4">
          <Select label="Assignee" value={ticket.assigneeEmail ?? ''}
            placeholder="— unassigned —"
            options={users.map((u) => ({ value: u.email, label: u.fullName || u.email }))}
            onChange={(e) => store.updateTicket(ticket.id, { assigneeEmail: e.target.value || null })}
          />
          <Select label="Priority" value={ticket.priority ?? 'medium'}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' },
            ]}
            onChange={(e) => store.updateTicket(ticket.id, { priority: e.target.value })}
          />
          <Select label="Account" value={ticket.accountId ?? ''}
            placeholder="— none —"
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            onChange={(e) => {
              const acct = accounts.find((a) => a.id === e.target.value);
              store.updateTicket(ticket.id, { accountId: acct?.id ?? null, account: acct?.name ?? undefined });
            }}
          />
          <Select label="Status" value={ticket.status}
            options={[
              { value: 'Open', label: 'Open' },
              { value: 'On Hold', label: 'On Hold' },
              { value: 'Escalated', label: 'Escalated' },
              { value: 'Resolved', label: 'Resolved' },
              { value: 'Closed', label: 'Closed' },
            ]}
            onChange={(e) => store.updateTicket(ticket.id, { status: e.target.value })}
          />
        </section>

        {ticket.description && (
          <section>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Description</label>
            <div className="mt-1 whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
              {ticket.description}
            </div>
          </section>
        )}

        {/* Attachments */}
        {attachments.length > 0 && (
          <section>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <Paperclip size={12} /> Attachments ({attachments.length})
            </label>
            <ul className="mt-1 space-y-1">
              {attachments.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => openAttachment(a.storagePath)}
                    className="w-full flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm text-left hover:bg-slate-50 hover:border-primary/40"
                  >
                    <Download size={14} className="text-slate-400 flex-shrink-0" />
                    <span className="flex-1 truncate text-slate-800">{a.fileName}</span>
                    <span className="text-xs text-slate-500 flex-shrink-0">{fmtSize(a.sizeBytes)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Time tracker — 15-min stepper, logs against whoever taps Log */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Clock size={16} /> Log time
              <span className="ml-2 font-normal text-slate-500">total {ticket.hoursLogged.toFixed(2)}h</span>
            </div>
          </div>
          <div className="flex items-center gap-3 mb-2">
            <button
              type="button"
              onClick={() => bumpMinutes(-15)}
              disabled={draftMinutes <= 15}
              className="w-9 h-9 rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center justify-center"
              aria-label="Decrease 15 minutes"
            ><Minus size={16} /></button>
            <div className="min-w-[6rem] text-center">
              <div className="text-2xl font-semibold text-slate-900 tabular-nums">{fmtDuration(draftMinutes)}</div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">15-min increments</div>
            </div>
            <button
              type="button"
              onClick={() => bumpMinutes(15)}
              disabled={draftMinutes >= 480}
              className="w-9 h-9 rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 flex items-center justify-center"
              aria-label="Increase 15 minutes"
            ><Plus size={16} /></button>
            <div className="flex flex-wrap gap-1 ml-3">
              {[15, 30, 60, 120].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setDraftMinutes(m)}
                  className={`px-2 py-1 text-xs rounded border ${
                    draftMinutes === m
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >{fmtDuration(m)}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <Input label="Notes (optional)" value={hoursNotes} onChange={(e) => setHoursNotes(e.target.value)} placeholder="What did you work on?" />
            <Button
              disabled={busy === 'hours'}
              onClick={async () => {
                setBusy('hours');
                await store.logHours(ticket.id, draftMinutes / 60, hoursNotes, currentUser?.email ?? 'unknown');
                setHoursNotes('');
                setDraftMinutes(15);
                setBusy(null);
              }}
            >Log {fmtDuration(draftMinutes)} as {currentUser?.email ?? 'you'}</Button>
          </div>
          {entries.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-slate-600 max-h-40 overflow-auto">
              {entries.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="font-mono w-14">{fmtDuration(Math.round(e.hours * 60))}</span>
                  <span className="flex-1 truncate">{e.notes || <em className="text-slate-400">no notes</em>}</span>
                  <span className="text-slate-400">{e.userEmail} · {fmt(e.loggedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Timeline */}
        <section>
          <div className="text-sm font-semibold text-slate-700 mb-2">Timeline</div>
          {messages.length === 0 ? (
            <div className="text-xs text-slate-500 italic">No messages yet.</div>
          ) : (
            <ul className="space-y-2">
              {messages.map((m) => {
                const icon = m.direction === 'internal_note' ? <StickyNote size={14} className="text-amber-600" />
                  : m.direction === 'outbound' ? <Mail size={14} className="text-primary" />
                  : m.direction === 'system' ? <Check size={14} className="text-slate-400" />
                  : <Mail size={14} className="text-slate-600" />;
                const bg = m.direction === 'internal_note' ? 'bg-amber-50 border-amber-200'
                  : m.direction === 'outbound' ? 'bg-primary/5 border-primary/20'
                  : 'bg-white border-slate-200';
                return (
                  <li key={m.id} className={`rounded border p-3 ${bg}`}>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                      {icon}
                      <span className="font-medium text-slate-700">{m.fromName || m.fromEmail || 'unknown'}</span>
                      <span className="text-slate-400">{fmt(m.receivedAt)}</span>
                      <span className="ml-auto uppercase tracking-wide text-[10px]">{m.direction.replace('_', ' ')}</span>
                    </div>
                    <div className="text-sm text-slate-800 whitespace-pre-wrap">{m.bodyText || <em className="text-slate-400">(empty)</em>}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Internal note composer */}
        <section className="rounded-lg border border-amber-200 bg-amber-50/40 p-4">
          <div className="text-sm font-semibold text-amber-800 mb-2 flex items-center gap-2">
            <StickyNote size={14} /> Add internal note
          </div>
          <Textarea rows={3} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} placeholder="Not visible to the client." />
          <div className="flex justify-end mt-2">
            <Button
              variant="secondary"
              disabled={busy === 'note' || !notesDraft.trim()}
              onClick={async () => {
                setBusy('note');
                await store.addInternalNote(ticket.id, notesDraft.trim(), currentUser?.email ?? 'unknown');
                setNotesDraft('');
                setBusy(null);
              }}
            >Post note</Button>
          </div>
        </section>

        {/* Resolve / reopen */}
        <section className="pt-2 border-t border-slate-200">
          {isResolved ? (
            <div className="flex items-center justify-between">
              <div className="text-sm text-emerald-700">
                <Check size={14} className="inline mr-1" />
                Resolved {ticket.resolvedAt && `on ${fmt(ticket.resolvedAt)}`}
              </div>
              <Button variant="secondary" onClick={() => store.reopenTicket(ticket.id)}>
                <RotateCcw size={14} /> Reopen
              </Button>
            </div>
          ) : showResolve ? (
            <div className="space-y-2">
              <Textarea label="Resolution" rows={3} value={resolutionDraft} onChange={(e) => setResolutionDraft(e.target.value)} placeholder="What was done to resolve this?" />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setShowResolve(false)}>Cancel</Button>
                <Button
                  disabled={busy === 'resolve' || !resolutionDraft.trim()}
                  onClick={async () => {
                    setBusy('resolve');
                    await store.resolveTicket(ticket.id, resolutionDraft.trim());
                    setBusy(null);
                    setShowResolve(false);
                    onClose();
                  }}
                ><Check size={14} /> Mark resolved</Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setShowResolve(true)}>
              <Check size={14} /> Resolve ticket
            </Button>
          )}
        </section>

        {/* Delete — irreversible; cascades messages + time + attachments */}
        <section className="pt-4 border-t border-slate-200">
          {showDeleteConfirm ? (
            <div className="rounded border border-red-300 bg-red-50 p-3 space-y-2">
              <div className="text-sm font-semibold text-red-800">Delete this ticket?</div>
              <div className="text-xs text-red-700">
                Removes the ticket, all {messages.length} message(s), {entries.length} time entry(ies),
                and {attachments.length} attachment file(s). This cannot be undone.
              </div>
              {deleteError && <div className="text-xs text-red-700">{deleteError}</div>}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => { setShowDeleteConfirm(false); setDeleteError(null); }}>Cancel</Button>
                <button
                  type="button"
                  disabled={busy === 'delete'}
                  onClick={async () => {
                    setBusy('delete');
                    setDeleteError(null);
                    const res = await store.deleteTicket(ticket.id);
                    setBusy(null);
                    if (!res.ok) { setDeleteError(res.message || 'Delete failed'); return; }
                    onClose();
                  }}
                  className="inline-flex items-center gap-1 px-3 py-2 text-sm font-semibold rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                ><Trash2 size={14} /> {busy === 'delete' ? 'Deleting…' : 'Delete permanently'}</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800 hover:underline"
            ><Trash2 size={12} /> Delete ticket</button>
          )}
        </section>
      </div>
    </Drawer>
  );
}
