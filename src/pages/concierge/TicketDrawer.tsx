import { useEffect, useState } from 'react';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { useConciergeStore, type ConciergeTicket } from '../../store/useConciergeStore';
import { useConciergeAccountsStore } from '../../store/useConciergeAccountsStore';
import { useAuthStore } from '../../store/useAuthStore';
import { Clock, Mail, StickyNote, Check, RotateCcw } from 'lucide-react';

interface Props {
  ticket: ConciergeTicket;
  onClose: () => void;
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function TicketDrawer({ ticket, onClose }: Props) {
  const store = useConciergeStore();
  const { accounts } = useConciergeAccountsStore();
  const directory = useAuthStore((s) => s.directory);
  const currentUser = useAuthStore((s) => s.currentUser);
  const users = Object.values(directory).sort((a, b) =>
    (a.fullName || a.email).localeCompare(b.fullName || b.email));

  const [notesDraft, setNotesDraft] = useState('');
  const [hoursInput, setHoursInput] = useState('');
  const [hoursNotes, setHoursNotes] = useState('');
  const [resolutionDraft, setResolutionDraft] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const [busy, setBusy] = useState<'note' | 'hours' | 'resolve' | null>(null);

  const messages = store.messagesByTicket[ticket.id] ?? [];
  const entries = store.timeEntriesByTicket[ticket.id] ?? [];

  useEffect(() => {
    void store.loadMessages(ticket.id);
    void store.loadTimeEntries(ticket.id);
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

  return (
    <Drawer open={true} onClose={onClose} title={`#${ticket.ticketNumber} — ${ticket.subject}`} width="max-w-3xl">
      <div className="space-y-6">
        {/* Header meta */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className={priorityChip(ticket.priority)}>{ticket.priority ?? 'medium'}</span>
          <span className="px-2 py-0.5 rounded border border-slate-300 bg-white font-medium">{ticket.status}</span>
          {ticket.source && <span className="text-slate-400">via {ticket.source}</span>}
          {ticket.senderEmail && <span>from {ticket.senderName ?? ticket.senderEmail}</span>}
          <span className="ml-auto">Created {fmt(ticket.createdTime)}</span>
        </div>

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

        {/* Time tracker */}
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Clock size={16} /> Hours logged
              <span className="ml-2 font-normal text-slate-500">total {ticket.hoursLogged.toFixed(1)}h</span>
            </div>
          </div>
          <div className="grid grid-cols-[80px_1fr_auto] gap-2 items-end">
            <Input label="Hours" type="number" step="0.25" min="0" value={hoursInput} onChange={(e) => setHoursInput(e.target.value)} placeholder="1.5" />
            <Input label="Notes" value={hoursNotes} onChange={(e) => setHoursNotes(e.target.value)} placeholder="What did you work on?" />
            <Button
              disabled={busy === 'hours' || !hoursInput}
              onClick={async () => {
                const h = Number(hoursInput);
                if (!Number.isFinite(h) || h <= 0) return;
                setBusy('hours');
                await store.logHours(ticket.id, h, hoursNotes, currentUser?.email ?? 'unknown');
                setHoursInput(''); setHoursNotes('');
                setBusy(null);
              }}
            >Log</Button>
          </div>
          {entries.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-slate-600 max-h-40 overflow-auto">
              {entries.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="font-mono w-14">{e.hours.toFixed(2)}h</span>
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
      </div>
    </Drawer>
  );
}
