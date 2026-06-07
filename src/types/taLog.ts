/** Talent Acquisition daily activity log types. */

export interface TADailyLogEntry {
  id: string;
  taEmail: string;
  logDate: string;                 // YYYY-MM-DD
  /** EITHER `requisitionId` is set (work against a specific req) OR
   *  `activityType` is set (non-req work — vendor coord, training, etc).
   *  Server-side CHECK enforces at least one is set. */
  requisitionId: string | null;
  /** Label for non-requisition work. See ACTIVITY_TYPES below for the canonical set. */
  activityType: string | null;
  /** Top-of-funnel: profiles sourced + outreach (calls/emails/InMails) sent. */
  sourcedOutreach: number;
  /** Recruiter screens completed today. */
  screensCompleted: number;
  /** Mid-funnel: candidates submitted + interviews scheduled. */
  submissionsInterviews: number;
  notes: string;
  /** Optional soft-link to a matching india_staffing_statuses row. */
  dailyStatusId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Canonical non-requisition activity types. "Other" is the catch-all — the
 *  TA can then type a freeform label in the notes field. */
export const ACTIVITY_TYPES = [
  'Vendor Coordination',
  'Strategic Sourcing',
  'Training',
  'Documentation',
  'Team Meeting / 1:1',
  'Process Improvement',
  'Other',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const TA_LOG_COUNTERS = [
  { key: 'sourcedOutreach',       label: 'Sourced + Outreach',           short: 'Sourced' },
  { key: 'screensCompleted',      label: 'Screens Completed',            short: 'Screens' },
  { key: 'submissionsInterviews', label: 'Submissions + Interviews',     short: 'Submits' },
] as const;

export type TALogCounterKey = (typeof TA_LOG_COUNTERS)[number]['key'];

export interface TeamMember {
  id: string;
  email: string;
  team: string;                    // 'ta', 'delivery', 'leadership', etc.
  addedBy: string | null;
  addedAt: string;
}

export const TA_TEAM = 'ta';
