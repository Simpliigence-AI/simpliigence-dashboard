/**
 * Actual hours store — holds the hydrated view from `unified_actual_hours`.
 *
 * As of 2026-08-22 the Zoho People sync path is retired. The rows here
 * come from `time_entries` (submitted / approved) plus a frozen historical
 * cut of Zoho rows for dates before 2026-08-01, joined server-side by the
 * `unified_actual_hours` view. There is no client-side ingestion action
 * anymore — the app just fetches on init and reacts to realtime.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ActualHourEntry } from '../types/actualHours';

interface ActualHoursState {
  entries: ActualHourEntry[];
  /** ISO timestamp when we last hydrated from Supabase (advisory only). */
  lastHydratedAt: string | null;
  setEntries: (entries: ActualHourEntry[], hydratedAt?: string) => void;
}

export const useActualHoursStore = create<ActualHoursState>()(
  persist(
    (set) => ({
      entries: [],
      lastHydratedAt: null,

      setEntries: (entries, hydratedAt) => {
        set({ entries, lastHydratedAt: hydratedAt ?? new Date().toISOString() });
      },
    }),
    {
      name: 'simpliigence-actual-hours',
      version: 2,
      // On upgrade from v1 the state shape lost `lastZohoSync`; drop it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      migrate: (persistedState: any, fromVersion) => {
        if (fromVersion < 2 && persistedState && typeof persistedState === 'object') {
          const { lastZohoSync: _drop, ...rest } = persistedState;
          return { ...rest, lastHydratedAt: rest.lastHydratedAt ?? null };
        }
        return persistedState as ActualHoursState;
      },
    },
  ),
);
