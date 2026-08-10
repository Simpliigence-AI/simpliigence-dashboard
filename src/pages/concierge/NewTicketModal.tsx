import { useState } from 'react';
import { Drawer } from '../../components/ui/Drawer';
import { Button } from '../../components/ui/Button';
import { Input, Select, Textarea } from '../../components/ui/Input';
import { useConciergeStore } from '../../store/useConciergeStore';
import { useConciergeAccountsStore } from '../../store/useConciergeAccountsStore';

interface Props {
  open: boolean;
  onClose: () => void;
  defaultAccountId?: string | null;
}

export function NewTicketModal({ open, onClose, defaultAccountId }: Props) {
  const { createTicket } = useConciergeStore();
  const { accounts } = useConciergeAccountsStore();

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [accountId, setAccountId] = useState<string>(defaultAccountId ?? '');
  const [assigneeEmail, setAssigneeEmail] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!subject.trim()) { setError('Subject required'); return; }
    setSubmitting(true);
    setError(null);
    const acct = accounts.find((a) => a.id === accountId);
    const res = await createTicket({
      subject: subject.trim(),
      description: description.trim() || undefined,
      priority,
      account: acct?.name ?? null,
      // Do not persist concierge_accounts.id into tickets.account_id: the FK
      // tickets_account_id_fkey points at a different parent table, so writing
      // this id violates the constraint. Grouping uses the `account` name text,
      // not account_id, so null is safe (inbound path also writes null on no-match).
      accountId: null,
      assigneeEmail: assigneeEmail.trim() || null,
      estimatedHours: estimatedHours.trim() === '' ? null : Number(estimatedHours),
      senderEmail: senderEmail.trim() || null,
      senderName: senderName.trim() || null,
    });
    setSubmitting(false);
    if (!res.ok) { setError(res.message || 'Failed to create ticket'); return; }
    setSubject(''); setDescription(''); setPriority('medium'); setAccountId(defaultAccountId ?? '');
    setAssigneeEmail(''); setEstimatedHours(''); setSenderEmail(''); setSenderName('');
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
          <Select label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)}
            placeholder="— none —"
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Assignee email" type="email" value={assigneeEmail} onChange={(e) => setAssigneeEmail(e.target.value)} placeholder="you@simpliigence.com" />
          <Input label="Estimated hours" type="number" step="0.25" min="0" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} placeholder="e.g. 4" />
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
