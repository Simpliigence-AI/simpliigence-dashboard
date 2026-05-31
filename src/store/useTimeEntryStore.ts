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

  /** Approve a submitted entry (manager/admin only — RLS enforces). */
  approveEntry: (id: string, approverEmail: string) => Promise<void>;

  /** Reject a submitted entry with a reason. */
  rejectEntry: (id: string, approverEmail: string, reason: string) => Promise<void>;

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
        // Default = 'submitted' (waiting on manager approval). Auto-approval is
        // off; pass status='approved' explicitly to skip the workflow.
        const finalStatus = status ?? 'submitted';
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
          status: finalStatus,
          submittedAt: finalStatus === 'submitted' || finalStatus === 'approved' ? now : null,
          approvedBy: null,
          approvedAt: finalStatus === 'approved' ? now : null,
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
        // Editing a non-draft entry resets it to 'submitted' so the manager
        // can re-approve (mirrors most timesheet tools).
        const resetStatus = current.status === 'approved' && (
          patch.hours !== undefined || patch.billable !== undefined || patch.projectName !== undefined
        );
        const merged: TimeEntry = {
          ...current,
          ...patch,
          ...(resetStatus ? { status: 'submitted', approvedBy: null, approvedAt: null, rejectReason: null } : {}),
          updatedAt: new Date().toISOString(),
        };
        set({ entries: get().entries.map((e) => (e.id === id ? merged : e)) });
        await db.upsertTimeEntry(merged);
      },

      approveEntry: async (id, approverEmail) => {
        const current = get().entries.find((e) => e.id === id);
        if (!current) return;
        const now = new Date().toISOString();
        const merged: TimeEntry = {
          ...current,
          status: 'approved',
          approvedBy: approverEmail.toLowerCase(),
          approvedAt: now,
          rejectReason: null,
          updatedAt: now,
        };
        set({ entries: get().entries.map((e) => (e.id === id ? merged : e)) });
        await db.upsertTimeEntry(merged);
      },

      rejectEntry: async (id, approverEmail, reason) => {
        const current = get().entries.find((e) => e.id === id);
        if (!current) return;
        const now = new Date().toISOString();
        const merged: TimeEntry = {
          ...current,
          status: 'rejected',
          approvedBy: approverEmail.toLowerCase(),
          approvedAt: now,
          rejectReason: reason || 'Rejected',
          updatedAt: now,
        };
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
