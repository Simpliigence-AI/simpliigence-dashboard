import { useState } from 'react';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { useConciergeStore } from '../../store/useConciergeStore';
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setSubmitting(false);
    if (!res.ok) { setError(res.message || 'Failed to create ticket'); return; }
    setSubject(''); setDescription(''); setPriority('medium'); setAccountValue(defaultValue);
    setAssigneeEmail(''); setEstimatedHours(''); setBillingMonth(currentMonthKey());
    setSenderEmail(''); setSenderName('');
    onClose();
  };

  return (
    <Drawer open={open} onClose={onClose} title="New ticket" width="max-w-lg">
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
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>{submitting ? 'Creating…' : 'Create ticket'}</Button>
        </div>
      </div>
    </Drawer>
  );
}
