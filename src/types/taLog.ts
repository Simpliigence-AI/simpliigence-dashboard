/** Talent Acquisition daily activity log types. */

export interface TADailyLogEntry {
  id: string;
  taEmail: string;
  logDate: string;                 // YYYY-MM-DD
  requisitionId: string;
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
