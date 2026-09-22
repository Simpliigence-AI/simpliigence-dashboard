/**
 * Fixed monthly charges — Concierge → Billing.
 *
 * A retainer or flat fee that is charged to the customer regardless of ticket
 * volume, so it cannot be derived from tickets or time entries. Entered by
 * hand on the Billing tab and stored in `concierge_fixed_billing`, keyed by
 * (account NAME, month) to match how that report groups its rows.
 *
 * Deliberately talks to Supabase directly rather than going through
 * `db`/`supabaseSync` + the App bootstrap: the Billing tab only ever needs one
 * month at a time, and loading it on demand keeps this off the app's startup
 * path. Nothing is persisted to localStorage — amounts are money, and a stale
 * cached figure is worse than a spinner.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';

const nanoid = (len = 21): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
};

export interface FixedBillingEntry {
  id: string;
  accountName: string;
  month: string;        // YYYY-MM
  amount: number;
  notes: string | null;
}

/** Month -> account name -> entry. */
type ByMonth = Record<string, Record<string, FixedBillingEntry>>;

interface FixedBillingState {
  byMonth: ByMonth;
  loadingMonth: string | null;
  /** Set when the table is missing (migration 032 not applied) or RLS refuses. */
  error: string | null;

  loadMonth: (month: string) => Promise<void>;
  /** Upsert one account's fixed charge for a month. 0 clears it. */
  setAmount: (accountName: string, month: string, amount: number) => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntry(row: any): FixedBillingEntry {
  return {
    id: row.id,
    accountName: row.account_name ?? '',
    month: row.month ?? '',
    amount: Number(row.amount ?? 0),
    notes: row.notes ?? null,
  };
}

const EMPTY_MONTH: Record<string, FixedBillingEntry> = {};

export const useConciergeFixedBillingStore = create<FixedBillingState>((set, get) => ({
  byMonth: {},
  loadingMonth: null,
  error: null,

  loadMonth: async (month) => {
    set({ loadingMonth: month });
    const { data, error } = await supabase
      .from('concierge_fixed_billing').select('*').eq('month', month);
    if (error) {
      // Non-fatal: the rest of the report still works, the column just reads 0.
      console.warn('[concierge] loadFixedBilling:', error.message);
      set((s) => ({ error: error.message, loadingMonth: s.loadingMonth === month ? null : s.loadingMonth }));
      return;
    }
    const forMonth: Record<string, FixedBillingEntry> = {};
    for (const row of data ?? []) {
      const e = rowToEntry(row);
      forMonth[e.accountName] = e;
    }
    set((s) => ({
      byMonth: { ...s.byMonth, [month]: forMonth },
      error: null,
      loadingMonth: s.loadingMonth === month ? null : s.loadingMonth,
    }));
  },

  setAmount: async (accountName, month, amount) => {
    const name = accountName.trim();
    if (!name) return;
    const safe = Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0;
    const existing = get().byMonth[month]?.[name];
    const id = existing?.id ?? nanoid();
    const entry: FixedBillingEntry = { id, accountName: name, month, amount: safe, notes: existing?.notes ?? null };

    // Optimistic — the cell is a text input, and waiting on a round-trip before
    // the figure updates makes it feel broken.
    set((s) => ({
      byMonth: { ...s.byMonth, [month]: { ...(s.byMonth[month] ?? EMPTY_MONTH), [name]: entry } },
    }));

    const { error } = await supabase.from('concierge_fixed_billing').upsert({
      id,
      account_name: name,
      month,
      amount: safe,
      notes: entry.notes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_name,month' });

    if (error) {
      console.warn('[concierge] setFixedBilling:', error.message);
      set({ error: error.message });
      await get().loadMonth(month);   // roll back to whatever the DB actually has
    }
  },
}));
