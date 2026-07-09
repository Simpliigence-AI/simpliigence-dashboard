/**
 * Concierge Accounts store — 360-view of managed-services customers.
 *
 * Distinct from useConciergeStore (which holds Zoho Desk tickets).
 * This store owns:
 *   - concierge_accounts (contract, billing model, tech stack, health)
 *   - concierge_features (implemented / backlog / upsell ideas)
 *   - concierge_billing (monthly amount + hours history)
 *
 * Hydrated from Supabase on app init; mutations fire-and-forget to Supabase
 * via `db.upsertConcierge*` helpers so state remains consistent across users.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { db } from '../lib/supabaseSync';
import type {
  ConciergeAccount,
  ConciergeFeature,
  ConciergeBillingEntry,
  BillingModel,
  AccountHealth,
  FeatureStatus,
  FeaturePriority,
} from '../types/concierge';

interface ConciergeAccountsState {
  accounts: ConciergeAccount[];
  features: ConciergeFeature[];
  billing: ConciergeBillingEntry[];

  hydrate: (a: ConciergeAccount[], f: ConciergeFeature[], b: ConciergeBillingEntry[]) => void;

  // Accounts
  addAccount: (params: {
    name: string;
    billingModel?: BillingModel;
    monthlyRate?: number | null;
    ownerEmail?: string | null;
    techStack?: string[];
  }) => Promise<ConciergeAccount>;
  updateAccount: (id: string, patch: Partial<ConciergeAccount>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  setHealth: (id: string, health: AccountHealth) => Promise<void>;

  // Features
  addFeature: (params: {
    accountId: string;
    name: string;
    category?: string;
    status?: FeatureStatus;
    priority?: FeaturePriority;
    upsellEstimate?: number | null;
    notes?: string | null;
  }) => Promise<ConciergeFeature>;
  updateFeature: (id: string, patch: Partial<ConciergeFeature>) => Promise<void>;
  removeFeature: (id: string) => Promise<void>;
  setFeatureStatus: (id: string, status: FeatureStatus) => Promise<void>;

  // Billing
  addBilling: (params: {
    accountId: string;
    month: string;         // YYYY-MM
    amount: number;
    hours?: number;
    notes?: string | null;
  }) => Promise<ConciergeBillingEntry>;
  updateBilling: (id: string, patch: Partial<ConciergeBillingEntry>) => Promise<void>;
  removeBilling: (id: string) => Promise<void>;
}

export const useConciergeAccountsStore = create<ConciergeAccountsState>()(
  persist(
    (set, get) => ({
      accounts: [],
      features: [],
      billing: [],

      hydrate: (accounts, features, billing) => set({ accounts, features, billing }),

      addAccount: async ({ name, billingModel = 'monthly_retainer', monthlyRate = null, ownerEmail = null, techStack = [] }) => {
        const now = new Date().toISOString();
        const a: ConciergeAccount = {
          id: nanoid(),
          name: name.trim(),
          billingModel,
          monthlyRate,
          contractStart: null,
          contractEnd: null,
          health: 'green',
          ownerEmail: ownerEmail?.toLowerCase() ?? null,
          techStack,
          currentWork: null,
          previousWork: null,
          notes: null,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ accounts: [...s.accounts, a] }));
        await db.upsertConciergeAccount(a);
        return a;
      },

      updateAccount: async (id, patch) => {
        const current = get().accounts.find((a) => a.id === id);
        if (!current) return;
        const updated: ConciergeAccount = { ...current, ...patch, updatedAt: new Date().toISOString() };
        set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? updated : a)) }));
        await db.upsertConciergeAccount(updated);
      },

      removeAccount: async (id) => {
        set((s) => ({
          accounts: s.accounts.filter((a) => a.id !== id),
          features: s.features.filter((f) => f.accountId !== id),
          billing: s.billing.filter((b) => b.accountId !== id),
        }));
        await db.deleteConciergeAccount(id);
      },

      setHealth: async (id, health) => get().updateAccount(id, { health }),

      addFeature: async ({ accountId, name, category = '', status = 'not_implemented', priority = 'medium', upsellEstimate = null, notes = null }) => {
        const now = new Date().toISOString();
        const f: ConciergeFeature = {
          id: nanoid(),
          accountId,
          name: name.trim(),
          category,
          status,
          priority,
          upsellEstimate,
          notes,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ features: [...s.features, f] }));
        await db.upsertConciergeFeature(f);
        return f;
      },

      updateFeature: async (id, patch) => {
        const current = get().features.find((f) => f.id === id);
        if (!current) return;
        const updated: ConciergeFeature = { ...current, ...patch, updatedAt: new Date().toISOString() };
        set((s) => ({ features: s.features.map((f) => (f.id === id ? updated : f)) }));
        await db.upsertConciergeFeature(updated);
      },

      removeFeature: async (id) => {
        set((s) => ({ features: s.features.filter((f) => f.id !== id) }));
        await db.deleteConciergeFeature(id);
      },

      setFeatureStatus: async (id, status) => get().updateFeature(id, { status }),

      addBilling: async ({ accountId, month, amount, hours = 0, notes = null }) => {
        // enforce unique (account, month) — replace existing row rather than duplicate
        const existing = get().billing.find((b) => b.accountId === accountId && b.month === month);
        if (existing) {
          await get().updateBilling(existing.id, { amount, hours, notes });
          return { ...existing, amount, hours, notes };
        }
        const now = new Date().toISOString();
        const b: ConciergeBillingEntry = {
          id: nanoid(),
          accountId,
          month,
          amount,
          hours,
          notes,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ billing: [...s.billing, b] }));
        await db.upsertConciergeBilling(b);
        return b;
      },

      updateBilling: async (id, patch) => {
        const current = get().billing.find((b) => b.id === id);
        if (!current) return;
        const updated: ConciergeBillingEntry = { ...current, ...patch, updatedAt: new Date().toISOString() };
        set((s) => ({ billing: s.billing.map((b) => (b.id === id ? updated : b)) }));
        await db.upsertConciergeBilling(updated);
      },

      removeBilling: async (id) => {
        set((s) => ({ billing: s.billing.filter((b) => b.id !== id) }));
        await db.deleteConciergeBilling(id);
      },
    }),
    { name: 'simpliigence-concierge-accounts', version: 1 },
  ),
);
