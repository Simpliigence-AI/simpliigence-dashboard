import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type {
  USStaffingAccount,
  USStaffingRequisition,
  USStaffingAccountContact,
  AccountCategory,
} from '../types/usStaffing';
import { db } from '../lib/supabaseSync';

/* ââ Seed accounts ââ */
const SEED_ACCOUNTS: USStaffingAccount[] = [
  // MSPs
  { id: 'us-acct-1', name: 'TEKsystems', category: 'MSP', created_at: '2025-04-01' },
  { id: 'us-acct-2', name: 'Randstad', category: 'MSP', created_at: '2025-04-01' },
  { id: 'us-acct-3', name: 'Allegis', category: 'MSP', created_at: '2025-04-01' },
  // SIs
  { id: 'us-acct-4', name: 'Cognizant', category: 'SI', created_at: '2025-04-01' },
  { id: 'us-acct-5', name: 'Infosys', category: 'SI', created_at: '2025-04-01' },
  { id: 'us-acct-6', name: 'Wipro', category: 'SI', created_at: '2025-04-01' },
];

const SEED_REQS: USStaffingRequisition[] = [
  { id: 'us-r1', account_id: 'us-acct-1', role: 'Salesforce Developer', initiation_date: '2025-03-15', stage: 'Interview', closure_date: '2025-04-15', notes: '2 candidates in pipeline', created_at: '2025-03-15', updated_at: '2025-04-01' },
  { id: 'us-r2', account_id: 'us-acct-1', role: 'Java Full Stack', initiation_date: '2025-03-20', stage: 'Profiles Shared', closure_date: '2025-04-20', notes: '5 profiles sent', created_at: '2025-03-20', updated_at: '2025-04-01' },
  { id: 'us-r3', account_id: 'us-acct-2', role: 'DevOps Engineer', initiation_date: '2025-04-01', stage: 'Sourcing', closure_date: '2025-04-30', notes: 'New requirement', created_at: '2025-04-01', updated_at: '2025-04-01' },
  { id: 'us-r4', account_id: 'us-acct-4', role: 'Python AI/ML Engineer', initiation_date: '2025-03-10', stage: 'Client Round', closure_date: '2025-04-10', notes: 'Final round scheduled', created_at: '2025-03-10', updated_at: '2025-04-02' },
  { id: 'us-r5', account_id: 'us-acct-5', role: '.NET Architect', initiation_date: '2025-03-25', stage: 'Shortlisted', closure_date: '2025-04-25', notes: '3 shortlisted', created_at: '2025-03-25', updated_at: '2025-04-01' },
  { id: 'us-r6', account_id: 'us-acct-6', role: 'QA Automation Lead', initiation_date: '2025-04-01', stage: 'New', closure_date: '', notes: 'Just received', created_at: '2025-04-01', updated_at: '2025-04-01' },
];

/* ââ Store ââ */
interface USStaffingState {
  accounts: USStaffingAccount[];
  requisitions: USStaffingRequisition[];
  contacts: USStaffingAccountContact[];

  addAccount: (name: string, category: AccountCategory) => USStaffingAccount;
  updateAccount: (id: string, patch: Partial<USStaffingAccount>) => void;
  removeAccount: (id: string) => void;

  addRequisition: (req: Omit<USStaffingRequisition, 'id' | 'created_at' | 'updated_at'>) => USStaffingRequisition;
  updateRequisition: (id: string, patch: Partial<USStaffingRequisition>) => void;
  removeRequisition: (id: string) => void;

  addContact: (accountId: string, p: { name: string; email?: string | null; phone?: string | null; title?: string | null; notes?: string | null }) => USStaffingAccountContact;
  updateContact: (id: string, patch: Partial<USStaffingAccountContact>) => void;
  removeContact: (id: string) => void;

  /** Internal: called by realtime subscriptions to hydrate from Supabase */
  _setFromSupabase: (accounts: USStaffingAccount[], requisitions: USStaffingRequisition[], contacts?: USStaffingAccountContact[]) => void;
}

export const useUSStaffingStore = create<USStaffingState>()(
  persist(
    (set, get) => ({
      accounts: SEED_ACCOUNTS,
      requisitions: SEED_REQS,
      contacts: [],

      addAccount: (name, category) => {
        const acct: USStaffingAccount = { id: nanoid(), name, category, created_at: new Date().toISOString() };
        set((s) => ({ accounts: [...s.accounts, acct] }));
        db.upsertUSAccount(acct);
        return acct;
      },

      updateAccount: (id, patch) => {
        set((s) => ({
          accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        }));
        const updated = get().accounts.find((a) => a.id === id);
        if (updated) db.upsertUSAccount(updated);
      },

      removeAccount: (id) => {
        set((s) => ({
          accounts: s.accounts.filter((a) => a.id !== id),
          requisitions: s.requisitions.filter((r) => r.account_id !== id),
          contacts: s.contacts.filter((c) => c.accountId !== id),
        }));
        db.deleteUSAccount(id);
      },

      addRequisition: (req) => {
        const now = new Date().toISOString();
        const r: USStaffingRequisition = { ...req, id: nanoid(), created_at: now, updated_at: now };
        set((s) => ({ requisitions: [...s.requisitions, r] }));
        db.upsertUSRequisition(r);
        return r;
      },

      updateRequisition: (id, patch) => {
        set((s) => ({
          requisitions: s.requisitions.map((r) =>
            r.id === id ? { ...r, ...patch, updated_at: new Date().toISOString() } : r,
          ),
        }));
        const updated = get().requisitions.find((r) => r.id === id);
        if (updated) db.upsertUSRequisition(updated);
      },

      removeRequisition: (id) => {
        set((s) => ({
          requisitions: s.requisitions.filter((r) => r.id !== id),
        }));
        db.deleteUSRequisition(id);
      },

      addContact: (accountId, p) => {
        const now = new Date().toISOString();
        const c: USStaffingAccountContact = {
          id: nanoid(),
          accountId,
          name: p.name.trim(),
          email: p.email?.trim().toLowerCase() || null,
          phone: p.phone?.trim() || null,
          title: p.title?.trim() || null,
          notes: p.notes ?? null,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ contacts: [...s.contacts, c] }));
        db.upsertUSAccountContact(c);
        return c;
      },

      updateContact: (id, patch) => {
        set((s) => ({
          contacts: s.contacts.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c)),
        }));
        const updated = get().contacts.find((c) => c.id === id);
        if (updated) db.upsertUSAccountContact(updated);
      },

      removeContact: (id) => {
        set((s) => ({ contacts: s.contacts.filter((c) => c.id !== id) }));
        db.deleteUSAccountContact(id);
      },

      _setFromSupabase: (accounts, requisitions, contacts) =>
        set((s) => ({ accounts, requisitions, contacts: contacts ?? s.contacts })),
    }),
    { name: 'simpliigence-us-staffing' },
  ),
);
