/**
 * Presales tracker — types shared between the store, sync layer, and UI.
 *
 * A `PresalesMeeting` is a single source event (Read.AI report, recording,
 * or a paste of notes). The Claude extractor turns it into N
 * `PresalesActivity` line items that the SE team can then track, edit, and
 * close out.
 */

export type ActivityType = 'POC' | 'Demo' | 'POV' | 'Capability' | 'Research' | 'Other';
export type Priority = 'high' | 'medium' | 'low';
export type ActivityStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

export const ACTIVITY_TYPES: ActivityType[] = ['POC', 'Demo', 'POV', 'Capability', 'Research', 'Other'];
export const PRIORITIES: Priority[] = ['high', 'medium', 'low'];
export const ACTIVITY_STATUSES: ActivityStatus[] = ['open', 'in_progress', 'done', 'cancelled'];

export interface PresalesMeeting {
  id: string;
  meetingDate: string;         // YYYY-MM-DD
  title?: string | null;
  attendees?: string | null;
  sourceUrl?: string | null;
  recordingPath?: string | null;
  rawNotes?: string | null;
  summary?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PresalesActivity {
  id: string;
  meetingId?: string | null;
  pipelineProjectId?: string | null;
  accountName?: string | null;
  title: string;
  description?: string | null;
  activityType: ActivityType;
  priority: Priority;
  status: ActivityStatus;
  ownerEmail?: string | null;
  dueDate?: string | null;     // YYYY-MM-DD
  revenueImpact?: number | null;
  notes?: string | null;
  createdBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const ACTIVITY_TYPE_META: Record<ActivityType, { label: string; cls: string; }> = {
  POC:        { label: 'POC',          cls: 'bg-violet-100 text-violet-800' },
  Demo:       { label: 'Demo',         cls: 'bg-sky-100 text-sky-800' },
  POV:        { label: 'Point of View', cls: 'bg-indigo-100 text-indigo-800' },
  Capability: { label: 'Capability',   cls: 'bg-emerald-100 text-emerald-800' },
  Research:   { label: 'Research',     cls: 'bg-amber-100 text-amber-800' },
  Other:      { label: 'Other',        cls: 'bg-slate-100 text-slate-700' },
};

export const PRIORITY_META: Record<Priority, { label: string; cls: string; rank: number; }> = {
  high:   { label: 'High',   cls: 'bg-rose-100 text-rose-800',     rank: 0 },
  medium: { label: 'Medium', cls: 'bg-amber-100 text-amber-800',   rank: 1 },
  low:    { label: 'Low',    cls: 'bg-slate-100 text-slate-600',   rank: 2 },
};

export const STATUS_META: Record<ActivityStatus, { label: string; cls: string; rank: number; }> = {
  open:        { label: 'Open',        cls: 'bg-sky-100 text-sky-800',         rank: 0 },
  in_progress: { label: 'In progress', cls: 'bg-amber-100 text-amber-800',     rank: 1 },
  done:        { label: 'Done',        cls: 'bg-emerald-100 text-emerald-800', rank: 2 },
  cancelled:   { label: 'Cancelled',   cls: 'bg-slate-100 text-slate-500',     rank: 3 },
};
