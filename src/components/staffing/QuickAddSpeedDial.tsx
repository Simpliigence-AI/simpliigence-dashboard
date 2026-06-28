/**
 * Quick-add speed-dial — floating "+" button bottom-right of India Demand
 * that opens a tiny menu with two actions:
 *   - Quick requisition  (3 fields: account, title, month)
 *   - Quick account      (1 field: name)
 *
 * Designed for the morning "we got a new req from QBurst today" workflow —
 * the user types the bare minimum, hits Save, and the req appears in the
 * list as a fresh draft they can flesh out inline.
 */
import { useState, useRef, useEffect } from 'react';
import { Plus, X, Briefcase, Building2 } from 'lucide-react';
import type { StaffingAccount } from '../../types/staffing';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'] as const;

interface Props {
  accounts: StaffingAccount[];
  onAddAccount: (name: string) => Promise<StaffingAccount> | StaffingAccount;
  onAddRequisition: (p: { accountId: string; title: string; month: string }) => Promise<void> | void;
}

export function QuickAddSpeedDial({ accounts, onAddAccount, onAddRequisition }: Props) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<'req' | 'account' | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <>
      <div ref={menuRef} className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {open && (
          <>
            <button
              type="button"
              onClick={() => { setModal('req'); setOpen(false); }}
              className="bg-white text-slate-900 border border-slate-200 shadow-md rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-2 hover:bg-violet-50 hover:border-violet-300"
            >
              <Briefcase size={12} className="text-violet-600" /> Quick requisition
            </button>
            <button
              type="button"
              onClick={() => { setModal('account'); setOpen(false); }}
              className="bg-white text-slate-900 border border-slate-200 shadow-md rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-2 hover:bg-amber-50 hover:border-amber-300"
            >
              <Building2 size={12} className="text-amber-600" /> Quick account
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform ${open ? 'bg-slate-700 rotate-45' : 'bg-violet-600 hover:bg-violet-700'}`}
          title={open ? 'Close' : 'Add new'}
          aria-label={open ? 'Close add menu' : 'Open add menu'}
        >
          <Plus size={26} />
        </button>
      </div>

      {modal === 'req' && (
        <QuickReqModal
          accounts={accounts}
          onAddAccount={onAddAccount}
          onAdd={onAddRequisition}
          onClose={() => setModal(null)}
        />
      )}
      {modal === 'account' && (
        <QuickAccountModal
          onAdd={onAddAccount}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

/* ── Quick requisition modal ─────────────────────────────────────── */

function QuickReqModal({
  accounts,
  onAddAccount,
  onAdd,
  onClose,
}: {
  accounts: StaffingAccount[];
  onAddAccount: (name: string) => Promise<StaffingAccount> | StaffingAccount;
  onAdd: (p: { accountId: string; title: string; month: string }) => Promise<void> | void;
  onClose: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [newAccountName, setNewAccountName] = useState('');
  const [title, setTitle] = useState('');
  const monthIdx = new Date().getMonth();
  const [month, setMonth] = useState<string>(MONTHS[monthIdx]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const submit = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    setSaving(true); setError(null);
    try {
      let finalAccountId = accountId;
      if (accountId === '__new__') {
        if (!newAccountName.trim()) { setError('Account name is required'); setSaving(false); return; }
        const a = await onAddAccount(newAccountName.trim());
        finalAccountId = a.id;
      }
      if (!finalAccountId) { setError('Pick an account'); setSaving(false); return; }
      await onAdd({ accountId: finalAccountId, title: title.trim(), month });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Quick requisition" subtitle="Just the basics — fill the rest inline on the row." onClose={onClose}>
      <div className="space-y-3">
        <Field label="Account">
          <select value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-slate-300 rounded-md bg-white focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value="__new__">+ Add new account…</option>
          </select>
        </Field>
        {accountId === '__new__' && (
          <Field label="New account name">
            <input value={newAccountName}
                   onChange={(e) => setNewAccountName(e.target.value)}
                   placeholder="e.g. ACME Corp"
                   className="w-full h-9 px-3 text-sm border border-slate-300 rounded-md focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </Field>
        )}
        <Field label="Title">
          <input ref={titleRef}
                 value={title}
                 onChange={(e) => setTitle(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                 placeholder="e.g. Salesforce Architect"
                 className="w-full h-9 px-3 text-sm border border-slate-300 rounded-md focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200" />
        </Field>
        <Field label="Month">
          <select value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-slate-300 rounded-md bg-white focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200">
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-xs text-slate-600 hover:text-slate-900 px-3 py-1.5">Cancel</button>
          <button type="button" onClick={submit} disabled={saving}
                  className="text-xs font-semibold bg-violet-600 text-white px-4 py-1.5 rounded-md hover:bg-violet-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create requisition'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Quick account modal ─────────────────────────────────────────── */

function QuickAccountModal({ onAdd, onClose }: {
  onAdd: (name: string) => Promise<StaffingAccount> | StaffingAccount;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const submit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError(null);
    try {
      await onAddAccount(name.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };
  // alias for readability — onAdd is the account creator
  const onAddAccount = onAdd;

  return (
    <Modal title="Quick account" subtitle="One field. You can flesh it out later in Account Management." onClose={onClose}>
      <div className="space-y-3">
        <Field label="Account name">
          <input ref={ref}
                 value={name}
                 onChange={(e) => setName(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                 placeholder="e.g. ACME Corp"
                 className="w-full h-9 px-3 text-sm border border-slate-300 rounded-md focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200" />
        </Field>
        {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-xs text-slate-600 hover:text-slate-900 px-3 py-1.5">Cancel</button>
          <button type="button" onClick={submit} disabled={saving}
                  className="text-xs font-semibold bg-amber-500 text-white px-4 py-1.5 rounded-md hover:bg-amber-600 disabled:opacity-50">
            {saving ? 'Saving…' : 'Create account'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Shared modal shell ──────────────────────────────────────────── */

function Modal({ title, subtitle, onClose, children }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">{title}</h2>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">{label}</label>
      {children}
    </div>
  );
}
