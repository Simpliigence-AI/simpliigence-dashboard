/**
 * Account Management Zustand store — accounts, connects (sales + delivery),
 * action items. Hydrated from Supabase on app init; realtime subscription
 * refreshes the whole bundle on any change to keep the store consistent.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { db } from '../lib/supabaseSync';
import type {
  Account,
  AccountConnect,
  AccountActionItem,
  ActionStatus,
  ConnectType,
} from '../types/accountMgmt';

interface AccountState {
  accounts: Account[];
  connects: AccountConnect[];
  actions: AccountActionItem[];

  setAll: (data: { accounts: Account[]; connects: AccountConnect[]; actions: AccountActionItem[] }) => void;

  // Account CRUD
  addAccount: (params: {
    name: string;
    salesOwnerEmail?: string;
    deliveryOwnerEmail?: string;
    industry?: string;
    notes?: string;
  }) => Promise<Account>;
  updateAccount: (id: string, patch: Partial<Account>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;

  // Connect CRUD
  addConnect: (params: {
    accountId: string;
    connectType: ConnectType;
    meetingDate: string;
    attendees?: string;
    discussion?: string;
    outcome?: string;
    createdBy?: string;
  }) => Promise<AccountConnect>;
  updateConnect: (id: string, patch: Partial<AccountConnect>) => Promise<void>;
  removeConnect: (id: string) => Promise<void>;

  // Action item CRUD
  addAction: (params: {
    accountId: string;
    connectId?: string;
    title: string;
    description?: string;
    ownerEmail?: string;
    dueDate?: string;
  }) => Promise<AccountActionItem>;
  updateAction: (id: string, patch: Partial<AccountActionItem>) => Promise<void>;
  removeAction: (id: string) => Promise<void>;
  setActionStatus: (id: string, status: ActionStatus) => Promise<void>;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get) => ({
      accounts: [],
      connects: [],
      actions: [],

      setAll: ({ accounts, connects, actions }) => set({ accounts, connects, actions }),

      addAccount: async ({ name, salesOwnerEmail, deliveryOwnerEmail, industry, notes }) => {
        const now = new Date().toISOString();
        const a: Account = {
          id: nanoid(),
          name: name.trim(),
          salesOwnerEmail: salesOwnerEmail?.toLowerCase() || null,
          deliveryOwnerEmail: deliveryOwnerEmail?.toLowerCase() || null,
          status: 'active',
          industry: industry || null,
          notes: notes || '',
          createdAt: now,
          updatedAt: now,
        };
        set({ accounts: [...get().accounts, a] });
        await db.upsertAccount(a);
        return a;
      },

      updateAccount: async (id, patch) => {
        const cur = get().accounts.find((a) => a.id === id);
        if (!cur) return;
        const next: Account = { ...cur, ...patch, updatedAt: new Date().toISOString() };
        set({ accounts: get().accounts.map((a) => (a.id === id ? next : a)) });
        await db.upsertAccount(next);
      },

      removeAccount: async (id) => {
        set({
          accounts: get().accounts.filter((a) => a.id !== id),
          connects: get().connects.filter((c) => c.accountId !== id),
          actions: get().actions.filter((x) => x.accountId !== id),
        });
        await db.deleteAccount(id);
      },

      addConnect: async ({ accountId, connectType, meetingDate, attendees, discussion, outcome, createdBy }) => {
        const now = new Date().toISOString();
        const c: AccountConnect = {
          id: nanoid(),
          accountId,
          connectType,
          meetingDate,
          attendees: attendees ?? '',
          discussion: discussion ?? '',
          outcome: outcome ?? '',
          createdAt: now,
          updatedAt: now,
          createdBy: createdBy?.toLowerCase() || null,
          updatedBy: null,
        };
        set({ connects: [...get().connects, c] });
        await db.upsertAccountConnect(c);
        return c;
      },

      updateConnect: async (id, patch) => {
        const cur = get().connects.find((c) => c.id === id);
        if (!cur) return;
        const next: AccountConnect = { ...cur, ...patch, updatedAt: new Date().toISOString() };
        set({ connects: get().connects.map((c) => (c.id === id ? next : c)) });
        await db.upsertAccountConnect(next);
      },

      removeConnect: async (id) => {
        set({
          connects: get().connects.filter((c) => c.id !== id),
          // Detach actions tied to this connect (DB ON DELETE SET NULL will mirror)
          actions: get().actions.map((a) => (a.connectId === id ? { ...a, connectId: null } : a)),
        });
        await db.deleteAccountConnect(id);
      },

      addAction: async ({ accountId, connectId, title, description, ownerEmail, dueDate }) => {
        const now = new Date().toISOString();
        const a: AccountActionItem = {
          id: nanoid(),
          accountId,
          connectId: connectId ?? null,
          title: title.trim(),
          description: description ?? '',
          ownerEmail: ownerEmail?.toLowerCase() || null,
          dueDate: dueDate ?? null,
          status: 'open',
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        set({ actions: [...get().actions, a] });
        await db.upsertAccountAction(a);
        return a;
      },

      updateAction: async (id, patch) => {
        const cur = get().actions.find((a) => a.id === id);
        if (!cur) return;
        const next: AccountActionItem = { ...cur, ...patch, updatedAt: new Date().toISOString() };
        set({ actions: get().actions.map((a) => (a.id === id ? next : a)) });
        await db.upsertAccountAction(next);
      },

      removeAction: async (id) => {
        set({ actions: get().actions.filter((a) => a.id !== id) });
        await db.deleteAccountAction(id);
      },

      setActionStatus: async (id, status) => {
        const cur = get().actions.find((a) => a.id === id);
        if (!cur) return;
        const next: AccountActionItem = {
          ...cur,
          status,
          completedAt: status === 'done' ? new Date().toISOString() : null,
          updatedAt: new Date().toISOString(),
        };
        set({ actions: get().actions.map((a) => (a.id === id ? next : a)) });
        await db.upsertAccountAction(next);
      },
    }),
    {
      name: 'simpliigence-accounts',
      version: 1,
    },
  ),
);
