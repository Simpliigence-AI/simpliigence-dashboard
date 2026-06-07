/**
 * TA Daily Log + Team Members Zustand store.
 *
 *  - `entries` = ta_daily_log rows (TA × day × requisition)
 *  - `teamMembers` = team_members rows (email × team, e.g. team='ta')
 *
 * Stores hydrate from Supabase on app init (App.tsx) and refresh
 * via the realtime subscription wired in supabaseSync.setupRealtimeSubscriptions.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { db } from '../lib/supabaseSync';
import type { TADailyLogEntry, TeamMember, TALogCounterKey } from '../types/taLog';

interface TaLogState {
  entries: TADailyLogEntry[];
  teamMembers: TeamMember[];

  // hydration (called by App.tsx + realtime)
  setEntries: (entries: TADailyLogEntry[]) => void;
  setTeamMembers: (members: TeamMember[]) => void;

  // mutators
  /** Insert or update a single counter-set + notes for (taEmail, logDate, requisitionId|activityType).
   *  Pass either `requisitionId` (requisition-keyed work) or `activityType`
   *  (non-requisition work like "Vendor Coordination") — but not both. */
  upsertEntry: (params: {
    taEmail: string;
    logDate: string;
    requisitionId?: string | null;
    activityType?: string | null;
    counters?: Partial<Record<TALogCounterKey, number>>;
    notes?: string;
    dailyStatusId?: string | null;
  }) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;

  addTeamMember: (email: string, team: string) => Promise<void>;
  removeTeamMember: (id: string) => Promise<void>;
}

export const useTaLogStore = create<TaLogState>()(
  persist(
    (set, get) => ({
      entries: [],
      teamMembers: [],

      setEntries: (entries) => set({ entries }),
      setTeamMembers: (teamMembers) => set({ teamMembers }),

      upsertEntry: async ({ taEmail, logDate, requisitionId, activityType, counters, notes, dailyStatusId }) => {
        const reqId = requisitionId ?? null;
        const actType = activityType ?? null;
        if (!reqId && !actType) {
          console.warn('[ta-log] upsertEntry called with neither requisitionId nor activityType');
          return;
        }
        // Uniqueness: match on (taEmail, logDate, requisitionId) OR (taEmail, logDate, activityType)
        // — mirrors the partial-unique indexes on the DB.
        const existing = get().entries.find(
          (e) =>
            e.taEmail === taEmail &&
            e.logDate === logDate &&
            (reqId ? e.requisitionId === reqId : e.requisitionId === null && e.activityType === actType),
        );
        const now = new Date().toISOString();
        const merged: TADailyLogEntry = existing
          ? {
              ...existing,
              sourcedOutreach: counters?.sourcedOutreach ?? existing.sourcedOutreach,
              screensCompleted: counters?.screensCompleted ?? existing.screensCompleted,
              submissionsInterviews: counters?.submissionsInterviews ?? existing.submissionsInterviews,
              notes: notes ?? existing.notes,
              dailyStatusId: dailyStatusId ?? existing.dailyStatusId,
              updatedAt: now,
            }
          : {
              id: nanoid(),
              taEmail,
              logDate,
              requisitionId: reqId,
              activityType: actType,
              sourcedOutreach: counters?.sourcedOutreach ?? 0,
              screensCompleted: counters?.screensCompleted ?? 0,
              submissionsInterviews: counters?.submissionsInterviews ?? 0,
              notes: notes ?? '',
              dailyStatusId: dailyStatusId ?? null,
              createdAt: now,
              updatedAt: now,
            };
        const next = existing
          ? get().entries.map((e) => (e.id === merged.id ? merged : e))
          : [...get().entries, merged];
        set({ entries: next });
        await db.upsertTaLog(merged);
      },

      deleteEntry: async (id) => {
        set({ entries: get().entries.filter((e) => e.id !== id) });
        await db.deleteTaLog(id);
      },

      addTeamMember: async (email, team) => {
        const norm = email.trim().toLowerCase();
        if (!norm || get().teamMembers.some((m) => m.email === norm && m.team === team)) return;
        const m: TeamMember = {
          id: nanoid(),
          email: norm,
          team,
          addedBy: null,
          addedAt: new Date().toISOString(),
        };
        set({ teamMembers: [...get().teamMembers, m] });
        await db.upsertTeamMember(m);
      },

      removeTeamMember: async (id) => {
        set({ teamMembers: get().teamMembers.filter((m) => m.id !== id) });
        await db.deleteTeamMember(id);
      },
    }),
    {
      name: 'simpliigence-ta-log',
      version: 1,
    },
  ),
);
