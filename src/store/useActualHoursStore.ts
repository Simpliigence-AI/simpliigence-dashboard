import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../lib/supabase';
import { db } from '../lib/supabaseSync';
import type { ActualHourEntry } from '../types/actualHours';

interface ZohoPeopleSyncResult {
  ok: boolean;
  count?: number;
  error?: string;
  range?: { from: string; to: string };
}

interface ActualHoursState {
  entries: ActualHourEntry[];
  lastZohoSync: string | null;
  setEntries: (entries: ActualHourEntry[], syncedAt?: string) => void;
  /** Invoke the zoho-people-sync edge function, persist results to Supabase + store. */
  syncFromZohoPeople: () => Promise<ZohoPeopleSyncResult>;
}

export const useActualHoursStore = create<ActualHoursState>()(
  persist(
    (set) => ({
      entries: [],
      lastZohoSync: null,

      setEntries: (entries, syncedAt) => {
        set({ entries, lastZohoSync: syncedAt ?? new Date().toISOString() });
      },

      syncFromZohoPeople: async () => {
        try {
          const { data, error } = await supabase.functions.invoke<{
            entries: ActualHourEntry[];
            syncedAt: string;
            range?: { from: string; to: string };
            counts?: { fetched: number; kept: number };
          }>('zoho-people-sync');

          if (error) throw error;
          if (!data?.entries) throw new Error('Edge function returned no entries');

          // Edge function returns rows in DB shape (snake_case). Re-key to
          // ActualHourEntry. The function actually returns camelCase below
          // for the timestamp and DB rows are snake_case; handle both.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const normalised: ActualHourEntry[] = (data.entries as unknown[]).map((r) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const row = r as Record<string, any>;
            return {
              id: String(row.id),
              employeeId: row.employee_id ?? row.employeeId ?? '',
              employeeName: row.employee_name ?? row.employeeName ?? '',
              email: row.email ?? null,
              project: row.project ?? null,
              workDate: row.work_date ?? row.workDate ?? '',
              hours: Number(row.hours ?? 0),
              billing: row.billing ?? null,
              notes: row.notes ?? null,
              syncedAt: data.syncedAt,
            };
          });

          set({ entries: normalised, lastZohoSync: data.syncedAt });
          await db.replaceAllActualHours(normalised);
          return { ok: true, count: normalised.length, range: data.range };
        } catch (e) {
          const msg = (e as Error).message || String(e);
          console.warn('[zoho-people-sync] failed:', msg);
          return { ok: false, error: msg };
        }
      },
    }),
    {
      name: 'simpliigence-actual-hours',
      version: 1,
    },
  ),
);
