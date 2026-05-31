/**
 * Time Entry Zustand store.
 *
 * Single source of truth for time_entries rows. Hydrates from Supabase on app
 * init (App.tsx) and refreshes via the realtime subscription wired in
 * supabaseSync.setupRealtimeSubscriptions. RLS already restricts what each
 * user sees (own rows + reports' rows + admin/manager sees everyone) so a
 * plain fetchTimeEntries() is safe.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { db } from '../lib/supabaseSync';
import type { TimeEntry, TimeEntryStatus } from '../types/timeEntry';

interface TimeEntryState {
  entries: TimeEntry[];
  setEntries: (entries: TimeEntry[]) => void;

  /** Insert a new entry. Returns the inserted row (with generated id). */
  addEntry: (input: {
    employeeEmail: string;
    workDate: string;
    projectId?: string | null;
    projectName: string;
    hours: number;
    billable: boolean;
    notes?: string;
    status?: TimeEntryStatus;
  }) => Promise<TimeEntry>;

  /** Patch an existing entry. */
  updateEntry: (id: string, patch: Partial<TimeEntry>) => Promise<void>;

  /** Delete an entry. */
  deleteEntry: (id: string) => Promise<void>;
}

export const useTimeEntryStore = create<TimeEntryState>()(
  persist(
    (set, get) => ({
      entries: [],

      setEntries: (entries) => set({ entries }),

      addEntry: async ({ employeeEmail, workDate, projectId, projectName, hours, billable, notes, status }) => {
        const now = new Date().toISOString();
        const e: TimeEntry = {
          id: nanoid(),
          employeeEmail: employeeEmail.toLowerCase(),
          workDate,
          projectId: projectId ?? null,
          projectName,
          hours,
          billable,
          notes: notes ?? '',
          source: 'simpliigence',
          status: status ?? 'approved',
          submittedAt: status === 'submitted' ? now : null,
          approvedBy: null,
          approvedAt: status === 'approved' ? now : null,
          rejectReason: null,
          createdAt: now,
          updatedAt: now,
        };
        set({ entries: [...get().entries, e] });
        await db.upsertTimeEntry(e);
        return e;
      },

      updateEntry: async (id, patch) => {
        const current = get().entries.find((e) => e.id === id);
        if (!current) return;
        const merged: TimeEntry = { ...current, ...patch, updatedAt: new Date().toISOString() };
        set({ entries: get().entries.map((e) => (e.id === id ? merged : e)) });
        await db.upsertTimeEntry(merged);
      },

      deleteEntry: async (id) => {
        set({ entries: get().entries.filter((e) => e.id !== id) });
        await db.deleteTimeEntry(id);
      },
    }),
    {
      name: 'simpliigence-time-entries',
      version: 1,
    },
  ),
);
