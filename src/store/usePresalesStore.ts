/**
 * Presales tracker store — meetings + activities synced from Supabase.
 *
 * Pattern mirrors useAccountStore: local cache hydrated on app boot via
 * fetchPresales(), realtime keeps it in sync, mutations write through to
 * Supabase (db.upsertPresalesActivity / db.upsertPresalesMeeting).
 */
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { db } from '../lib/supabaseSync';
import type {
  PresalesActivity, PresalesMeeting, ActivityType, Priority, ActivityStatus,
} from '../types/presales';

interface State {
  meetings: PresalesMeeting[];
  activities: PresalesActivity[];

  /** Replace store contents from a fresh fetch. */
  hydrate: (meetings: PresalesMeeting[], activities: PresalesActivity[]) => void;

  /** Insert/update a single meeting locally + persist. Returns the row. */
  upsertMeeting: (partial: Partial<PresalesMeeting> & { meetingDate: string }) => Promise<PresalesMeeting>;

  /** Bulk-create activities (after AI extract). Returns the persisted rows. */
  addActivities: (rows: Array<Omit<PresalesActivity, 'id' | 'createdAt' | 'updatedAt'>>) => Promise<PresalesActivity[]>;

  /** Add a single activity (manual create). */
  addActivity: (row: Omit<PresalesActivity, 'id' | 'createdAt' | 'updatedAt'>) => Promise<PresalesActivity>;

  /** Patch an activity inline. */
  updateActivity: (id: string, patch: Partial<PresalesActivity>) => Promise<void>;
  setStatus: (id: string, status: ActivityStatus) => Promise<void>;
  setPriority: (id: string, priority: Priority) => Promise<void>;
  setActivityType: (id: string, t: ActivityType) => Promise<void>;
  removeActivity: (id: string) => Promise<void>;

  removeMeeting: (id: string) => Promise<void>;
}

export const usePresalesStore = create<State>((set, get) => ({
  meetings: [],
  activities: [],

  hydrate: (meetings, activities) => set({ meetings, activities }),

  upsertMeeting: async (partial) => {
    const now = new Date().toISOString();
    const existingId = partial.id;
    const meeting: PresalesMeeting = {
      id: existingId || nanoid(),
      meetingDate: partial.meetingDate,
      title: partial.title ?? null,
      attendees: partial.attendees ?? null,
      sourceUrl: partial.sourceUrl ?? null,
      recordingPath: partial.recordingPath ?? null,
      rawNotes: partial.rawNotes ?? null,
      summary: partial.summary ?? null,
      createdBy: partial.createdBy ?? null,
      createdAt: existingId ? get().meetings.find((m) => m.id === existingId)?.createdAt ?? now : now,
      updatedAt: now,
    };
    set((s) => {
      const idx = s.meetings.findIndex((m) => m.id === meeting.id);
      const next = idx >= 0
        ? s.meetings.map((m, i) => i === idx ? meeting : m)
        : [meeting, ...s.meetings];
      return { meetings: next };
    });
    await db.upsertPresalesMeeting(meeting);
    return meeting;
  },

  addActivities: async (rows) => {
    const now = new Date().toISOString();
    const created: PresalesActivity[] = rows.map((r) => ({
      id: nanoid(),
      meetingId: r.meetingId ?? null,
      pipelineProjectId: r.pipelineProjectId ?? null,
      accountName: r.accountName ?? null,
      title: r.title,
      description: r.description ?? null,
      activityType: r.activityType,
      priority: r.priority,
      status: r.status ?? 'open',
      ownerEmail: r.ownerEmail ?? null,
      dueDate: r.dueDate ?? null,
      revenueImpact: r.revenueImpact ?? null,
      notes: r.notes ?? null,
      createdBy: r.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    }));
    set((s) => ({ activities: [...created, ...s.activities] }));
    for (const a of created) await db.upsertPresalesActivity(a);
    return created;
  },

  addActivity: async (row) => {
    const [created] = await get().addActivities([row]);
    return created;
  },

  updateActivity: async (id, patch) => {
    const now = new Date().toISOString();
    let updated: PresalesActivity | undefined;
    set((s) => ({
      activities: s.activities.map((a) => {
        if (a.id !== id) return a;
        updated = { ...a, ...patch, updatedAt: now };
        return updated;
      }),
    }));
    if (updated) await db.upsertPresalesActivity(updated);
  },

  setStatus: (id, status) => get().updateActivity(id, { status }),
  setPriority: (id, priority) => get().updateActivity(id, { priority }),
  setActivityType: (id, activityType) => get().updateActivity(id, { activityType }),

  removeActivity: async (id) => {
    set((s) => ({ activities: s.activities.filter((a) => a.id !== id) }));
    await db.deletePresalesActivity(id);
  },

  removeMeeting: async (id) => {
    set((s) => ({ meetings: s.meetings.filter((m) => m.id !== id) }));
    await db.deletePresalesMeeting(id);
  },
}));
