/**
 * TNM Accounts Zustand store.
 * Backs /tnm-accounts. Hydrated from Supabase on app init; optimistic
 * mutations flush to Supabase via db.upsertTnmAccount / db.upsertTnmContact.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { db } from '../lib/supabaseSync';
import type {
  TnmAccount, TnmAccountContact, TnmEntity, TnmWorkType, TnmRegion, TnmStatus,
} from '../types/tnmAccount';

interface TnmAccountsState {
  accounts: TnmAccount[];
  contacts: TnmAccountContact[];

  setAll: (data: { accounts: TnmAccount[]; contacts: TnmAccountContact[] }) => void;

  addAccount: (params: {
    name: string;
    entity: TnmEntity;
    workType?: TnmWorkType | null;
    region?: TnmRegion;
    status?: TnmStatus;
    keyContact?: string | null;
    staffingConsultant?: string | null;
    ownerNote?: string | null;
    notes?: string | null;
    createdBy?: string | null;
  }) => Promise<TnmAccount>;

  updateAccount: (id: string, patch: Partial<TnmAccount>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;

  /** Prospect → active. Also usable for any status change. */
  setStatus: (id: string, status: TnmStatus) => Promise<void>;

  addContact: (accountId: string, params: {
    name: string;
    email?: string | null;
    phone?: string | null;
    title?: string | null;
    notes?: string | null;
  }) => Promise<TnmAccountContact>;

  updateContact: (id: string, patch: Partial<TnmAccountContact>) => Promise<void>;
  removeContact: (id: string) => Promise<void>;
}

export const useTnmAccountsStore = create<TnmAccountsState>()(
  persist(
    (set, get) => ({
      accounts: [],
      contacts: [],

      setAll: ({ accounts, contacts }) => set({ accounts, contacts }),

      addAccount: async (p) => {
        const now = new Date().toISOString();
        const a: TnmAccount = {
          id: nanoid(),
          name: p.name.trim(),
          entity: p.entity,
          workType: p.workType ?? null,
          region: p.region ?? 'USA',
          status: p.status ?? 'active',
          keyContact: p.keyContact ?? null,
          staffingConsultant: p.staffingConsultant ?? null,
          ownerNote: p.ownerNote ?? null,
          notes: p.notes ?? null,
          createdBy: p.createdBy ?? null,
          createdAt: now,
          updatedAt: now,
        };
        set({ accounts: [...get().accounts, a] });
        await db.upsertTnmAccount(a);
        return a;
      },

      updateAccount: async (id, patch) => {
        const cur = get().accounts.find((a) => a.id === id);
        if (!cur) return;
        const next: TnmAccount = { ...cur, ...patch, updatedAt: new Date().toISOString() };
        set({ accounts: get().accounts.map((a) => (a.id === id ? next : a)) });
        await db.upsertTnmAccount(next);
      },

      removeAccount: async (id) => {
        set({
          accounts: get().accounts.filter((a) => a.id !== id),
          contacts: get().contacts.filter((c) => c.accountId !== id),
        });
        await db.deleteTnmAccount(id);
      },

      setStatus: async (id, status) => {
        await get().updateAccount(id, { status });
      },

      addContact: async (accountId, p) => {
        const now = new Date().toISOString();
        const c: TnmAccountContact = {
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
        set({ contacts: [...get().contacts, c] });
        await db.upsertTnmContact(c);
        return c;
      },

      updateContact: async (id, patch) => {
        const cur = get().contacts.find((c) => c.id === id);
        if (!cur) return;
        const next: TnmAccountContact = { ...cur, ...patch, updatedAt: new Date().toISOString() };
        set({ contacts: get().contacts.map((c) => (c.id === id ? next : c)) });
        await db.upsertTnmContact(next);
      },

      removeContact: async (id) => {
        set({ contacts: get().contacts.filter((c) => c.id !== id) });
        await db.deleteTnmContact(id);
      },
    }),
    {
      name: 'simpliigence-tnm-accounts',
      version: 1,
    },
  ),
);
