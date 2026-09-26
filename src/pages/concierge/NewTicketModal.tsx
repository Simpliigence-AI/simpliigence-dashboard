import { useState } from 'react';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { MAX_ATTACHMENT_MB, useConciergeStore } from '../../store/useConciergeStore';
import { resolveTicketAccount, useTicketAccountOptions } from '../../lib/ticketAccountOptions';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultAccountId?: string | null;
}

/** Current month as YYYY-MM, in local time. */
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function NewTicketModal({ open, onClose, defaultAccountId }: Props) {
  const createTicket = useConciergeStore((s) => s.createTicket);
  const uploadAttachment = useConciergeStore((s) => s.uploadAttachment);
  /* Account Management accounts (the parent of tickets_account_id_fkey) merged
   * with the non-dormant Concierge accounts, which have no row there — see
   * src/lib/ticketAccountOptions.ts. */
  const { options: accountOptions, accountNameById } = useTicketAccountOptions();

  const defaultValue = defaultAccountId ? `acct:${defaultAccountId}` : '';

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [accountValue, setAccountValue] = useState<string>(defaultValue);
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [billingMonth, setBillingMonth] = useState<string>(() => currentMonthKey());
  const [senderEmail, setSenderEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Set when the ticket row was written but an attachment was not. The ticket
   * is deliberately not rolled back, so pressing Create again would duplicate
   * it — the footer offers only Close until the drawer is dismissed. */
  const [ticketCreated, setTicketCreated] = useState(false);

  /* The file input is unmounted with the drawer, so its DOM value clears
   * itself; the picked File objects and the post-create state must not
   * survive into the next open. The text fields keep the existing
   * draft-persistence behaviour. */
  const dismiss = () => {
    setFiles([]);
    setError(null);
    setTicketCreated(false);
    onClose();
  };

  const submit = async () => {
    if (!subject.trim()) { setError('Subject required'); return; }
    setSubmitting(true);
    setError(null);
    const { account, accountId } = resolveTicketAccount(accountValue, accountNameById);
    const res = await createTicket({
      subject: subject.trim(),
      description: description.trim() || undefined,
      priority,
      account,
      // Only Account Management ids are persisted — a concierge-only account
      // has no row behind tickets_account_id_fkey, so it is stored by name.
      accountId,
      assigneeEmail: assigneeEmail.trim() || null,
      estimatedHours: estimatedHours.trim() === '' ? null : Number(estimatedHours),
      billingMonth: billingMonth || null,
      senderEmail: senderEmail.trim() || null,
      senderName: senderName.trim() || null,
    });
    if (!res.ok || !res.id) {
      setSubmitting(false);
      setError(res.message || 'Failed to create ticket');
      return;
    }
    /* Attachments go up only now: their row's foreign key points at the ticket,
     * so the ticket has to exist first. Serial, to keep the failure list in the
     * order the user picked the files. */
    const failed: string[] = [];
    for (const file of files) {
      const up = await uploadAttachment(res.id, file);
      if (!up.ok) failed.push(up.message ?? file.name);
    }
    setSubmitting(false);
    if (failed.length > 0) {
      /* The ticket is real and has a number — don't throw it away over a file.
       * Keep the drawer open so the message is actually read. */
      setTicketCreated(true);
      setError(`Ticket created, but ${failed.length} of ${files.length} file(s) did not attach: ${failed.join('; ')} — add them from the ticket's Attachments section.`);
      return;
    }
    setSubject(''); setDescription(''); setPriority('medium'); setAccountValue(defaultValue);
    setAssigneeEmail(''); setEstimatedHours(''); setBillingMonth(currentMonthKey());
    setSenderEmail(''); setSenderName('');
    dismiss();
  };

  return (
    <Drawer open={open} onClose={dismiss} title="New ticket" width="max-w-lg">
      <div className="space-y-4">
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary of the request" />
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="What's the ask?" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'urgent', label: 'Urgent' },
            ]}
          />
          <Select label="Account" value={accountValue} onChange={(e) => setAccountValue(e.target.value)}
            placeholder="— none —"
            options={accountOptions}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Assignee email" type="email" value={assigneeEmail} onChange={(e) => setAssigneeEmail(e.target.value)} placeholder="you@simpliigence.com" />
          <Input label="Estimated hours" type="number" step="0.25" min="0" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} placeholder="e.g. 4" />
        </div>
        <div>
          <Input label="Bill in" type="month" value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} className="max-w-[12rem]" />
          <p className="mt-1 text-[11px] text-muted">Which month this ticket lands in on the Billing tab.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Reporter email" type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} placeholder="client@example.com" />
          <Input label="Reporter name" value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Jane Doe" />
        </div>
        <div>
          <Input label="Attachments" type="file" multiple disabled={submitting}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          <p className="mt-1 text-xs text-muted">Uploaded once the ticket is created. Up to {MAX_ATTACHMENT_MB} MB per file.</p>
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          {ticketCreated ? (
            <Button onClick={dismiss}>Close</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={dismiss}>Cancel</Button>
              <Button onClick={submit} disabled={submitting}>
                {!submitting ? 'Create ticket' : files.length > 0 ? 'Creating & uploading…' : 'Creating…'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
