/**
 * Quick-add speed-dial — floating "+" button bottom-right of India Demand
 * that opens a tiny menu with two actions:
 *   - Quick requisition  (account, title, month + mandatory bill start date,
 *     budget/hr USD, work mode, and location when Hybrid/WFO)
 *   - Quick account      (1 field: name)
 *
 * Designed for the morning "we got a new req from QBurst today" workflow —
 * the user types the bare minimum, hits Save, and the req appears in the
 * list as a fresh draft they can flesh out inline.
 */
import { useState, useRef, useEffect } from 'react';
import { Plus, X, Briefcase, Building2 } from 'lucide-react';
import type { StaffingAccount, WorkMode } from '../../types/staffing';
import { WORK_MODES, workModeNeedsLocation, validateReqBillingFields } from '../../types/staffing';

export interface QuickReqInput {
  accountId: string; title: string; month: string;
  billStartDate: string; budgetPerHourUsd: number; workMode: WorkMode; location: string;
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'] as const;

interface Props {
  accounts: StaffingAccount[];
  onAddAccount: (name: string) => Promise<StaffingAccount> | StaffingAccount;
  onAddRequisition: (p: QuickReqInput) => Promise<void> | void;
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
              className="bg-surface text-ink border border-line shadow-md rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-2 hover:bg-violet-50 hover:border-violet-300"
            >
              <Briefcase size={12} className="text-violet-600" /> Quick requisition
            </button>
            <button
              type="button"
              onClick={() => { setModal('account'); setOpen(false); }}
              className="bg-surface text-ink border border-line shadow-md rounded-full px-4 py-2 text-xs font-semibold inline-flex items-center gap-2 hover:bg-amber-50 hover:border-amber-300"
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
  onAdd: (p: QuickReqInput) => Promise<void> | void;
  onClose: () => void;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id || '');
  const [newAccountName, setNewAccountName] = useState('');
  const [title, setTitle] = useState('');
  const monthIdx = new Date().getMonth();
  const [month, setMonth] = useState<string>(MONTHS[monthIdx]);
  const [billStartDate, setBillStartDate] = useState('');
  const [budgetPerHour, setBudgetPerHour] = useState('');
  const [workMode, setWorkMode] = useState<WorkMode | ''>('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const submit = async () => {
    if (!title.trim()) { setError('Title is required'); return; }
    const billingError = validateReqBillingFields({ billStartDate, budgetPerHour, workMode, location });
    if (billingError) { setError(billingError); return; }
    setSaving(true); setError(null);
    try {
      let finalAccountId = accountId;
      if (accountId === '__new__') {
        if (!newAccountName.trim()) { setError('Account name is required'); setSaving(false); return; }
        const a = await onAddAccount(newAccountName.trim());
        finalAccountId = a.id;
      }
      if (!finalAccountId) { setError('Pick an account'); setSaving(false); return; }
      await onAdd({
        accountId: finalAccountId, title: title.trim(), month,
        billStartDate,
        budgetPerHourUsd: Math.round(Number(budgetPerHour) * 100) / 100,
        workMode: workMode as WorkMode,
        location: workModeNeedsLocation(workMode) ? location.trim() : '',
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Quick requisition" subtitle="The essentials — fill the rest inline on the row." onClose={onClose}>
      <div className="space-y-3">
        <Field label="Account">
          <select value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-line rounded-md bg-surface focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            <option value="__new__">+ Add new account…</option>
          </select>
        </Field>
        {accountId === '__new__' && (
          <Field label="New account name">
            <input value={newAccountName}
                   onChange={(e) => setNewAccountName(e.target.value)}
                   placeholder="e.g. ACME Corp"
                   className="w-full h-9 px-3 text-sm border border-line rounded-md focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </Field>
        )}
        <Field label="Title">
          <input ref={titleRef}
                 value={title}
                 onChange={(e) => setTitle(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
                 placeholder="e.g. Salesforce Architect"
                 className="w-full h-9 px-3 text-sm border border-line rounded-md focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200" />
        </Field>
        <Field label="Month">
          <select value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="w-full h-9 px-3 text-sm border border-line rounded-md bg-surface focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200">
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bill start date *">
            <input type="date" value={billStartDate} onChange={(e) => setBillStartDate(e.target.value)}
                   className="w-full h-9 px-3 text-sm border border-line rounded-md focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </Field>
          <Field label="Budget / hr (USD) *">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">$</span>
              <input type="number" min={0.01} step="0.01" inputMode="decimal" value={budgetPerHour}
                     onChange={(e) => setBudgetPerHour(e.target.value)} placeholder="e.g. 25"
                     className="w-full h-9 px-3 text-sm border border-line rounded-md focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200 pl-7" />
            </div>
          </Field>
          <Field label="Work mode *">
            <select value={workMode} onChange={(e) => setWorkMode(e.target.value as WorkMode | '')}
                    className="w-full h-9 px-3 text-sm border border-line rounded-md focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200 bg-surface">
              <option value="">Select…</option>
              {WORK_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label={workModeNeedsLocation(workMode) ? 'Location *' : 'Location'}>
            <input value={location} onChange={(e) => setLocation(e.target.value)}
                   placeholder={workModeNeedsLocation(workMode) ? 'e.g. Bangalore' : 'Optional for Remote'}
                   className="w-full h-9 px-3 text-sm border border-line rounded-md focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200" />
          </Field>
        </div>
        {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-xs text-muted hover:text-ink px-3 py-1.5">Cancel</button>
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
                 className="w-full h-9 px-3 text-sm border border-line rounded-md focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200" />
        </Field>
        {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="text-xs text-muted hover:text-ink px-3 py-1.5">Cancel</button>
          <button type="button" onClick={submit} disabled={saving}
                  className="text-xs font-semibold bg-amber-400 text-amber-950 px-4 py-1.5 rounded-md hover:bg-amber-600 disabled:opacity-50">
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
      <div className="bg-surface rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="px-5 py-4 border-b border-line/60 flex items-start justify-between">
          <div>
            <h2 className="text-sm font-bold text-ink">{title}</h2>
            {subtitle && <p className="text-[11px] text-muted mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-muted/70 hover:text-ink/80 p-1">
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
      <label className="text-[10px] font-semibold text-muted uppercase tracking-wider block mb-1">{label}</label>
      {children}
    </div>
  );
}
