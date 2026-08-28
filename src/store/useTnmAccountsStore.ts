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
import type { USStaffingAccount, AccountCategory } from '../types/usStaffing';
import { useUSStaffingStore } from './useUSStaffingStore';

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

  /**
   * Promote a TNM prospect to a real Global Demand account:
   *   - Create a us_staffing_accounts row (SI when entity=SI, MSP otherwise).
   *   - Copy every tnm_account_contacts row into us_staffing_account_contacts.
   *   - Mark the TNM row promoted_to_us_id + status='inactive' so it doesn't
   *     show up in Prospects any more but the history is preserved.
   * Returns the new US account, or null if already promoted / not found.
   */
  promoteToGlobalDemand: (accountId: string) => Promise<USStaffingAccount | null>;
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

      promoteToGlobalDemand: async (accountId) => {
        const tnm = get().accounts.find((a) => a.id === accountId);
        if (!tnm) return null;
        if (tnm.promotedToUsId) return null;

        const usStore = useUSStaffingStore.getState();
        // SI on the TNM side maps to SI in Global Demand's MSP/SI category;
        // End Client also lands under MSP (they're the closest fit for the
        // existing category enum). Users can flip it in the account editor.
        const category: AccountCategory = tnm.entity === 'SI' ? 'SI' : 'MSP';
        const newAcct = usStore.addAccount(tnm.name, category);
        // Enrich with the fields the TNM record carries.
        usStore.updateAccount(newAcct.id, {
          key_contact_name: tnm.keyContact ?? null,
          notes: tnm.notes ?? null,
          promoted_from_tnm_id: tnm.id,
        });

        // Copy contacts over.
        for (const c of get().contacts.filter((c) => c.accountId === accountId)) {
          usStore.addContact(newAcct.id, {
            name: c.name,
            email: c.email,
            phone: c.phone,
            title: c.title,
            notes: c.notes,
          });
        }

        // Record the link on the TNM side and set status inactive so it
        // leaves the Prospects tab.
        await get().updateAccount(accountId, {
          promotedToUsId: newAcct.id,
          status: 'inactive',
          notes: [tnm.notes, `Promoted to Global Demand ${new Date().toISOString().slice(0,10)}`]
            .filter(Boolean).join(' · '),
        });

        return { ...newAcct, key_contact_name: tnm.keyContact ?? null, notes: tnm.notes ?? null } as USStaffingAccount;
      },
    }),
    {
      name: 'simpliigence-tnm-accounts',
      version: 1,
    },
  ),
);
