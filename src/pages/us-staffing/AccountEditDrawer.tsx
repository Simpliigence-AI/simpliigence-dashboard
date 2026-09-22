/**
 * Edit-account drawer for Global Demand.
 *
 * Opens from the account row on USStaffingPage. Lets the user edit the
 * name/category/notes/website/key contact, and manage the named contact
 * list (email, phone, title). Also surfaces the "promoted from TNM"
 * origin when relevant.
 */
import { useState } from 'react';
import { Trash2, UserPlus, X } from 'lucide-react';
import { useUSStaffingStore } from '../../store/useUSStaffingStore';
import type { USStaffingAccount, AccountCategory } from '../../types/usStaffing';

export function AccountEditDrawer({
  accountId,
  onClose,
}: {
  accountId: string | null;
  onClose: () => void;
}) {
  const accounts = useUSStaffingStore((s) => s.accounts);
  const contacts = useUSStaffingStore((s) => s.contacts);
  const updateAccount = useUSStaffingStore((s) => s.updateAccount);
  const removeAccount = useUSStaffingStore((s) => s.removeAccount);
  const addContact = useUSStaffingStore((s) => s.addContact);
  const updateContact = useUSStaffingStore((s) => s.updateContact);
  const removeContact = useUSStaffingStore((s) => s.removeContact);

  const account = accountId ? accounts.find((a) => a.id === accountId) : null;
  const acctContacts = accountId ? contacts.filter((c) => c.accountId === accountId) : [];

  const [addName, setAddName] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addPhone, setAddPhone] = useState('');

  if (!account) return null;

  const patch = (field: keyof USStaffingAccount, value: unknown) => {
    updateAccount(account.id, { [field]: value } as Partial<USStaffingAccount>);
  };

  const submitContact = () => {
    if (!addName.trim()) return;
    addContact(account.id, {
      name: addName,
      email: addEmail || null,
      phone: addPhone || null,
      title: addTitle || null,
    });
    setAddName(''); setAddTitle(''); setAddEmail(''); setAddPhone('');
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[1px]" onClick={onClose}>
      <div className="w-full max-w-lg bg-surface h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-surface border-b border-line/60 px-6 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Global Demand account</div>
            <div className="text-lg font-extrabold text-ink truncate">{account.name}</div>
            {account.promoted_from_tnm_id && (
              <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                Promoted from TNM Accounts
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted/70 hover:text-ink hover:bg-surface-2"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <Field label="Name">
            <input
              value={account.name}
              onChange={(e) => patch('name', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-line bg-surface-2 text-sm text-ink"
            />
          </Field>

          <Field label="Category">
            <select
              value={account.category}
              onChange={(e) => patch('category', e.target.value as AccountCategory)}
              className="w-full px-3 py-2 rounded-lg border border-line bg-surface-2 text-sm text-ink"
            >
              <option value="MSP">MSP</option>
              <option value="SI">SI</option>
            </select>
          </Field>

          <Field label="Website">
            <input
              value={account.website ?? ''}
              onChange={(e) => patch('website', e.target.value || null)}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded-lg border border-line bg-surface-2 text-sm text-ink"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Key contact name">
              <input
                value={account.key_contact_name ?? ''}
                onChange={(e) => patch('key_contact_name', e.target.value || null)}
                className="w-full px-3 py-2 rounded-lg border border-line bg-surface-2 text-sm text-ink"
              />
            </Field>
            <Field label="Key contact phone">
              <input
                value={account.key_contact_phone ?? ''}
                onChange={(e) => patch('key_contact_phone', e.target.value || null)}
                className="w-full px-3 py-2 rounded-lg border border-line bg-surface-2 text-sm text-ink"
              />
            </Field>
            <div className="col-span-2">
              <Field label="Key contact email">
                <input
                  type="email"
                  value={account.key_contact_email ?? ''}
                  onChange={(e) => patch('key_contact_email', e.target.value || null)}
                  placeholder="email@company.com"
                  className="w-full px-3 py-2 rounded-lg border border-line bg-surface-2 text-sm text-ink"
                />
              </Field>
            </div>
          </div>

          <Field label="Notes">
            <textarea
              value={account.notes ?? ''}
              onChange={(e) => patch('notes', e.target.value || null)}
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-line bg-surface-2 text-sm text-ink resize-none"
            />
          </Field>

          <div className="pt-4 border-t border-line/60">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                <UserPlus size={15} /> Contacts <span className="text-xs text-muted font-normal">({acctContacts.length})</span>
              </h3>
            </div>

            <div className="space-y-2">
              {acctContacts.map((c) => (
                <div key={c.id} className="border border-line rounded-lg p-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      className="flex-1 px-2 py-1 rounded border border-line bg-surface-2 text-sm font-semibold text-ink"
                      value={c.name}
                      onChange={(e) => updateContact(c.id, { name: e.target.value })}
                    />
                    <button
                      onClick={() => removeContact(c.id)}
                      className="p-1.5 rounded-md text-red-500 hover:bg-red-50"
                      title="Remove contact"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="px-2 py-1 rounded border border-line bg-surface-2 text-xs text-ink"
                      placeholder="Title"
                      value={c.title ?? ''}
                      onChange={(e) => updateContact(c.id, { title: e.target.value || null })}
                    />
                    <input
                      className="px-2 py-1 rounded border border-line bg-surface-2 text-xs text-ink"
                      placeholder="Email"
                      value={c.email ?? ''}
                      onChange={(e) => updateContact(c.id, { email: e.target.value || null })}
                    />
                    <input
                      className="px-2 py-1 rounded border border-line bg-surface-2 text-xs text-ink col-span-2"
                      placeholder="Phone"
                      value={c.phone ?? ''}
                      onChange={(e) => updateContact(c.id, { phone: e.target.value || null })}
                    />
                  </div>
                </div>
              ))}

              <div className="border-2 border-dashed border-line rounded-lg p-3 space-y-2">
                <div className="text-[11px] font-semibold text-muted uppercase tracking-wider">Add contact</div>
                <input
                  className="w-full px-2 py-1 rounded border border-line bg-surface-2 text-sm text-ink"
                  placeholder="Name *"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="px-2 py-1 rounded border border-line bg-surface-2 text-xs text-ink"
                    placeholder="Title"
                    value={addTitle}
                    onChange={(e) => setAddTitle(e.target.value)}
                  />
                  <input
                    className="px-2 py-1 rounded border border-line bg-surface-2 text-xs text-ink"
                    placeholder="Email"
                    value={addEmail}
                    onChange={(e) => setAddEmail(e.target.value)}
                  />
                  <input
                    className="px-2 py-1 rounded border border-line bg-surface-2 text-xs text-ink col-span-2"
                    placeholder="Phone"
                    value={addPhone}
                    onChange={(e) => setAddPhone(e.target.value)}
                  />
                </div>
                <button
                  onClick={submitContact}
                  disabled={!addName.trim()}
                  className="w-full py-1.5 rounded bg-primary text-white text-xs font-semibold disabled:opacity-40"
                >
                  Add contact
                </button>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-line/60">
            <button
              onClick={() => {
                if (confirm(`Delete account "${account.name}" and all its requisitions + contacts?`)) {
                  removeAccount(account.id);
                  onClose();
                }
              }}
              className="text-xs font-semibold text-red-600 hover:text-red-700"
            >
              Delete account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-semibold text-muted uppercase tracking-wider">{label}</label>
      {children}
    </div>
  );
}
