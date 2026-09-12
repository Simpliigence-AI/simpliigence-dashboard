import { useEffect, useMemo, useRef, useState } from 'react';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import {
  MAX_ATTACHMENT_MB,
  useConciergeStore,
  type ConciergeAttachment,
  type ConciergeTicket,
  type ConciergeTicketMessage,
  type ConciergeTimeEntry,
} from '../../store/useConciergeStore';
import { useAccountStore } from '../../store/useAccountStore';
import { useAuthStore } from '../../store/useAuthStore';
import { EmailBody } from './EmailBody';
import { Clock, Mail, StickyNote, Check, RotateCcw, Trash2, Loader2, Paperclip, Download, UploadCloud } from 'lucide-react';

interface Props {
  ticket: ConciergeTicket;
  onClose: () => void;
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* Stable empty arrays. Selectors below fall back to these rather than a fresh
 * `[]`, so an unloaded ticket does not hand a new reference to every effect. */
const NO_MESSAGES: ConciergeTicketMessage[] = [];
const NO_ENTRIES: ConciergeTimeEntry[] = [];
const NO_ATTACHMENTS: ConciergeAttachment[] = [];

export function TicketDrawer({ ticket, onClose }: Props) {
  /* Per-action / per-slice selectors, NOT `useConciergeStore()`.
   * Subscribing to the whole store handed this component a new state object
   * after every `set()` anywhere in the store; with `store` in the effect's
   * dependency list below, and `loadMessages` itself calling `set()`, that was
   * a fetch loop for as long as the drawer stayed open. Action identities are
   * created once, so these deps are stable. */
  const loadMessages = useConciergeStore((s) => s.loadMessages);
  const loadTimeEntries = useConciergeStore((s) => s.loadTimeEntries);
  const loadAttachments = useConciergeStore((s) => s.loadAttachments);
  const updateTicket = useConciergeStore((s) => s.updateTicket);
  const logHours = useConciergeStore((s) => s.logHours);
  const addInternalNote = useConciergeStore((s) => s.addInternalNote);
  const resolveTicket = useConciergeStore((s) => s.resolveTicket);
  const reopenTicket = useConciergeStore((s) => s.reopenTicket);
  const deleteTicket = useConciergeStore((s) => s.deleteTicket);
  const attachmentDownloadUrl = useConciergeStore((s) => s.attachmentDownloadUrl);
  const uploadAttachment = useConciergeStore((s) => s.uploadAttachment);

  /* Account Management accounts — the table `tickets.account_id` actually
   * references. The drawer used to populate this control from
   * `concierge_accounts`, whose ids live in a different namespace: a routed
   * ticket's account_id matched no option (so the select showed "— none —"
   * even when routing had worked), and picking an option wrote an id that
   * violated tickets_account_id_fkey — a failure updateTicket only warns about.
   * See the same note in NewTicketModal.tsx. */
  const accounts = useAccountStore((s) => s.accounts);
  const directory = useAuthStore((s) => s.directory);
  const currentUser = useAuthStore((s) => s.currentUser);
  const users = Object.values(directory).sort((a, b) =>
    (a.fullName || a.email).localeCompare(b.fullName || b.email));

  const [notesDraft, setNotesDraft] = useState('');
  // Informational fields admins fill in on any ticket; committed on blur.
  const [estHoursDraft, setEstHoursDraft] = useState(
    ticket.estimatedHours == null ? '' : String(ticket.estimatedHours));
  const [resolutionEdit, setResolutionEdit] = useState(ticket.resolution ?? '');
  const [hoursInput, setHoursInput] = useState('');
  const [hoursNotes, setHoursNotes] = useState('');
  const [resolutionDraft, setResolutionDraft] = useState('');
  const [showResolve, setShowResolve] = useState(false);
  const [busy, setBusy] = useState<'note' | 'hours' | 'resolve' | 'delete' | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const attachInput = useRef<HTMLInputElement>(null);

  const messages = useConciergeStore((s) => s.messagesByTicket[ticket.id]) ?? NO_MESSAGES;
  const entries = useConciergeStore((s) => s.timeEntriesByTicket[ticket.id]) ?? NO_ENTRIES;
  const attachments = useConciergeStore((s) => s.attachmentsByTicket[ticket.id]) ?? NO_ATTACHMENTS;

  useEffect(() => {
    void loadMessages(ticket.id);
    void loadTimeEntries(ticket.id);
    void loadAttachments(ticket.id);
    // An upload failure belongs to the ticket it happened on.
    setUploadError(null);
  }, [ticket.id, loadMessages, loadTimeEntries, loadAttachments]);

  /* Inline images are referenced from the body as src="cid:<content_id>";
   * everything else is offered as a download. Memoized because EmailBody takes
   * the inline list as an effect dependency. */
  const inlineAttachments = useMemo(() => attachments.filter((a) => a.isInline), [attachments]);
  const fileAttachments = useMemo(() => attachments.filter((a) => !a.isInline), [attachments]);

  /* cid: references are per-message, so scope each body to its own inline
   * images. Rows written before message_id existed have none, so those fall
   * back to the ticket's whole inline set. Both branches return a reference
   * that is stable while `attachments` is — EmailBody depends on it. */
  const inlineByMessage = useMemo(() => {
    const m = new Map<string, ConciergeAttachment[]>();
    for (const a of inlineAttachments) {
      if (!a.messageId) continue;
      const list = m.get(a.messageId);
      if (list) list.push(a); else m.set(a.messageId, [a]);
    }
    return m;
  }, [inlineAttachments]);
  const inlineFor = (messageId: string | undefined) =>
    (messageId ? inlineByMessage.get(messageId) : undefined) ?? inlineAttachments;

  /* The rich body of the message this ticket was created from. desk-inbound
   * stores it on the message row, so there is no second copy (and no extra
   * migration) on `tickets`; `ticket.description` holds the plain-text
   * flattening that the list view and search use. */
  const firstInbound = useMemo(
    () => messages.find((m) => m.direction === 'inbound' && (m.bodyHtml || m.bodyText)) ?? null,
    [messages],
  );

  const accountsById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const openAttachment = async (storagePath: string) => {
    const url = await attachmentDownloadUrl(storagePath);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  /* Attach files to a ticket that already exists — uploadAttachment refreshes
   * the list itself. Serial, so the failure list follows the pick order. */
  const attachFiles = async (picked: FileList | null) => {
    const list = Array.from(picked ?? []);
    // Clearing the input lets the same file be picked again after a failure.
    if (attachInput.current) attachInput.current.value = '';
    if (list.length === 0) return;
    setUploading(true);
    setUploadError(null);
    const failed: string[] = [];
    for (const file of list) {
      const res = await uploadAttachment(ticket.id, file);
      if (!res.ok) failed.push(res.message ?? file.name);
    }
    setUploading(false);
    if (failed.length > 0) setUploadError(failed.join('; '));
  };

  const priorityChip = (p: string | null) => {
    const val = (p ?? 'medium').toLowerCase();
    const map: Record<string, string> = {
      urgent: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-surface-2 text-ink/80 border-line',
      low: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    };
    return `inline-block px-2 py-0.5 text-xs font-semibold rounded border ${map[val] || map.medium}`;
  };

  const isResolved = ticket.status === 'Resolved' || ticket.status === 'Closed';

  return (
    <Drawer open={true} onClose={onClose} title={`#${ticket.ticketNumber} — ${ticket.subject}`} width="max-w-3xl">
      <div className="space-y-6">
        {/* Header meta */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className={priorityChip(ticket.priority)}>{ticket.priority ?? 'medium'}</span>
          <span className="px-2 py-0.5 rounded border border-line bg-surface font-medium">{ticket.status}</span>
          {ticket.source && <span className="text-muted/70">via {ticket.source}</span>}
          {ticket.senderEmail && <span>from {ticket.senderName ?? ticket.senderEmail}</span>}
          {/* Resolved only on a terminal ticket: an em-dash "Resolved" on every
            * open one is noise, but a Resolved ticket that predates the stamp
            * should still show the field rather than hide it. Both dates sit in
            * one right-aligned group so the second does not wrap to its own row. */}
          <span className="ml-auto flex items-center gap-3">
            <span>Created {fmt(ticket.createdTime)}</span>
            {isResolved && <span>Resolved {fmt(ticket.resolvedAt)}</span>}
          </span>
        </div>

        {/* Editable fields grid */}
        <section className="grid grid-cols-2 gap-4">
          <Select label="Assignee" value={ticket.assigneeEmail ?? ''}
            placeholder="— unassigned —"
            options={users.map((u) => ({ value: u.email, label: u.fullName || u.email }))}
            onChange={(e) => updateTicket(ticket.id, { assigneeEmail: e.target.value || null })}
          />
          <Select label="Priority" value={ticket.priority ?? 'medium'}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' },
            ]}
            onChange={(e) => updateTicket(ticket.id, { priority: e.target.value })}
          />
          <div className="space-y-1.5">
            {accounts.length === 0 ? (
              /* Account Management has not hydrated (or is empty). Rather than
               * offer a dropdown that can only write null, show what the ticket
               * is already routed to. */
              <>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider">Account</label>
                <div className="w-full px-3 py-2 rounded-lg border border-line bg-surface-2/70 text-sm text-ink">
                  {ticket.account || '— none —'}
                </div>
              </>
            ) : (
              <Select label="Account" value={ticket.accountId ?? ''}
                placeholder="— none —"
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                onChange={(e) => {
                  const acct = accounts.find((a) => a.id === e.target.value);
                  updateTicket(ticket.id, { accountId: acct?.id ?? null, account: acct?.name ?? '' });
                }}
              />
            )}
            {/* The name desk-inbound resolved from the sender's domain. Shown
              * always, because it is the answer to "which client is this?"
              * even when account_id points at a row this client cannot see. */}
            <div className="text-[11px] text-muted">
              Routed to <span className="font-medium text-ink/80">{ticket.account || '—'}</span>
              {ticket.accountId && !accountsById.has(ticket.accountId) && (
                <span className="text-amber-700"> · id not in Account Management</span>
              )}
            </div>
          </div>
          <Select label="Status" value={ticket.status}
            options={[
              { value: 'Open', label: 'Open' },
              { value: 'On Hold', label: 'On Hold' },
              { value: 'Escalated', label: 'Escalated' },
              { value: 'Resolved', label: 'Resolved' },
              { value: 'Closed', label: 'Closed' },
            ]}
            onChange={(e) => updateTicket(ticket.id, { status: e.target.value })}
          />
          <Input label="Estimated hours" type="number" step="0.25" min="0"
            value={estHoursDraft}
            onChange={(e) => setEstHoursDraft(e.target.value)}
            onBlur={() => {
              const next = estHoursDraft.trim() === '' ? null : Number(estHoursDraft);
              if (next !== null && !Number.isFinite(next)) return;
              if (next !== ticket.estimatedHours) updateTicket(ticket.id, { estimatedHours: next });
            }}
            placeholder="e.g. 4"
          />
        </section>

        {(firstInbound || ticket.description) && (
          <section>
            <label className="text-xs font-medium text-muted uppercase tracking-wider">Description</label>
            <div className="mt-1 rounded border border-line bg-surface-2/70 p-3 text-sm text-ink">
              <EmailBody
                html={firstInbound?.bodyHtml ?? null}
                text={firstInbound?.bodyText ?? ticket.description}
                inlineAttachments={inlineFor(firstInbound?.id)}
              />
            </div>
          </section>
        )}

        {/* Attachments — inline images render inside the body above, so only
          * the real files are listed here. The section always renders: the
          * upload control has to be reachable on a ticket with no files yet. */}
        <section>
          <label className="text-xs font-medium text-muted uppercase tracking-wider flex items-center gap-1">
            <Paperclip size={12} /> Attachments{fileAttachments.length > 0 ? ` (${fileAttachments.length})` : ''}
          </label>
          {fileAttachments.length > 0 && (
            <ul className="mt-1 space-y-1">
              {fileAttachments.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => { void openAttachment(a.storagePath); }}
                    className="w-full flex items-center gap-2 rounded border border-line bg-surface px-3 py-2 text-sm text-left hover:bg-surface-2/70 hover:border-primary/40"
                  >
                    <Download size={14} className="text-muted/70 shrink-0" />
                    <span className="flex-1 truncate text-ink">{a.fileName}</span>
                    <span className="text-xs text-muted shrink-0">{fmtSize(a.sizeBytes)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input ref={attachInput} type="file" multiple className="hidden"
              onChange={(e) => { void attachFiles(e.target.files); }}
            />
            <Button variant="secondary" size="sm" disabled={uploading}
              onClick={() => attachInput.current?.click()}
            >
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
              {uploading ? 'Uploading…' : 'Attach files'}
            </Button>
            <span className="text-[11px] text-muted">Up to {MAX_ATTACHMENT_MB} MB per file.</span>
          </div>
          {uploadError && <div className="mt-1 text-xs text-red-600">{uploadError}</div>}
        </section>

        {/* Resolution — free-text write-up, editable on any ticket and committed on blur */}
        <section>
          <Textarea label="Resolution" rows={4} value={resolutionEdit}
            onChange={(e) => setResolutionEdit(e.target.value)}
            onBlur={() => {
              const next = resolutionEdit.trim() === '' ? null : resolutionEdit;
              if (next !== (ticket.resolution ?? null)) updateTicket(ticket.id, { resolution: next });
            }}
            placeholder="Summary of how this ticket was resolved."
          />
        </section>

        {/* Time tracker */}
        <section className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink/80">
              <Clock size={16} /> Hours logged
              <span className="ml-2 font-normal text-muted">total {ticket.hoursLogged.toFixed(1)}h</span>
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
                await logHours(ticket.id, h, hoursNotes, currentUser?.email ?? 'unknown');
                setHoursInput(''); setHoursNotes('');
                setBusy(null);
              }}
            >Log</Button>
          </div>
          {entries.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted max-h-40 overflow-auto">
              {entries.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="font-mono w-14">{e.hours.toFixed(2)}h</span>
                  <span className="flex-1 truncate">{e.notes || <em className="text-muted/70">no notes</em>}</span>
                  <span className="text-muted/70">{e.userEmail} · {fmt(e.loggedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Timeline */}
        <section>
          <div className="text-sm font-semibold text-ink/80 mb-2">Timeline</div>
          {messages.length === 0 ? (
            <div className="text-xs text-muted italic">No messages yet.</div>
          ) : (
            <ul className="space-y-2">
              {messages.map((m) => {
                const icon = m.direction === 'internal_note' ? <StickyNote size={14} className="text-amber-600" />
                  : m.direction === 'outbound' ? <Mail size={14} className="text-primary" />
                  : m.direction === 'system' ? <Check size={14} className="text-muted/70" />
                  : <Mail size={14} className="text-muted" />;
                const bg = m.direction === 'internal_note' ? 'bg-amber-50 border-amber-200'
                  : m.direction === 'outbound' ? 'bg-primary/5 border-primary/20'
                  : 'bg-surface border-line';
                return (
                  <li key={m.id} className={`rounded border p-3 ${bg}`}>
                    <div className="flex items-center gap-2 text-xs text-muted mb-1">
                      {icon}
                      <span className="font-medium text-ink/80">{m.fromName || m.fromEmail || 'unknown'}</span>
                      <span className="text-muted/70">{fmt(m.receivedAt)}</span>
                      <span className="ml-auto uppercase tracking-wide text-[10px]">{m.direction.replace('_', ' ')}</span>
                    </div>
                    {/* Internal notes are ours and plain text by construction;
                      * inbound/outbound mail goes through the sanitizer. */}
                    {m.direction === 'internal_note' ? (
                      <div className="text-sm text-ink whitespace-pre-wrap">
                        {m.bodyText || <em className="text-muted/70">(empty)</em>}
                      </div>
                    ) : (
                      <EmailBody
                        html={m.bodyHtml}
                        text={m.bodyText}
                        inlineAttachments={inlineFor(m.id)}
                        className="text-sm text-ink"
                      />
                    )}
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
                await addInternalNote(ticket.id, notesDraft.trim(), currentUser?.email ?? 'unknown');
                setNotesDraft('');
                setBusy(null);
              }}
            >Post note</Button>
          </div>
        </section>

        {/* Resolve / reopen */}
        <section className="pt-2 border-t border-line">
          {isResolved ? (
            <div className="flex items-center justify-between">
              <div className="text-sm text-emerald-700">
                <Check size={14} className="inline mr-1" />
                Resolved on {fmt(ticket.resolvedAt)}
              </div>
              <Button variant="secondary" onClick={() => reopenTicket(ticket.id)}>
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
                    await resolveTicket(ticket.id, resolutionDraft.trim());
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

          {/* Delete — separated visually so it's obviously destructive */}
          <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted">
              Permanently delete this ticket and all its messages/notes/hours.
            </span>
            <button
              type="button"
              disabled={busy === 'delete'}
              onClick={async () => {
                if (!confirm(`Delete ticket #${ticket.ticketNumber} — "${ticket.subject}"?\n\nThis is permanent and removes all messages, internal notes, and hours logs.`)) return;
                setBusy('delete');
                try {
                  await deleteTicket(ticket.id);
                  onClose();
                } catch (e) {
                  alert(`Delete failed: ${(e as Error).message}`);
                } finally {
                  setBusy(null);
                }
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-50"
            >
              {busy === 'delete' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Delete ticket
            </button>
          </div>
        </section>
      </div>
    </Drawer>
  );
}
