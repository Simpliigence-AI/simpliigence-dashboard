/** Time entry types — one row per (employee × day × project × billable-flag). */

export type TimeEntryStatus = 'draft' | 'submitted' | 'approved' | 'rejected';
export type TimeEntrySource = 'simpliigence' | 'zoho_people';

export interface TimeEntry {
  id: string;
  employeeEmail: string;
  workDate: string;            // YYYY-MM-DD
  /** Optional FK to pipeline_projects.id; null when entering against a free-text label. */
  projectId: string | null;
  /** Denormalised project label, survives project rename or deletion. */
  projectName: string;
  hours: number;               // 0 < hours <= 24, supports 0.25 increments
  billable: boolean;
  notes: string;
  source: TimeEntrySource;
  status: TimeEntryStatus;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntryPeriod {
  id: string;
  periodStart: string;
  periodEnd: string;
  locked: boolean;
  lockedBy: string | null;
  lockedAt: string | null;
}

/** Client-approved timesheet file attached to a week (period_start = Monday). */
export interface TimesheetDocument {
  id: string;
  employeeEmail: string;
  periodStart: string;         // YYYY-MM-DD (Monday)
  periodEnd: string;           // YYYY-MM-DD (Sunday)
  filename: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One immutable audit row per change to a time entry, written by a DB trigger.
 *  See supabase migration 019_time_entry_audit.sql. */
export interface TimeEntryAudit {
  id: string;
  timeEntryId: string;
  employeeEmail: string | null;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  changedByEmail: string | null;
  changedByRole: string | null;
  /** Columns that changed on UPDATE; empty/null for insert & delete. */
  changedFields: string[];
  /** Full row snapshot before the change (null on INSERT). */
  oldData: Record<string, unknown> | null;
  /** Full row snapshot after the change (null on DELETE). */
  newData: Record<string, unknown> | null;
  changedAt: string;
}

/** Common non-billable buckets surfaced as quick-pick projects. */
export const INTERNAL_PROJECTS = [
  'Internal — Admin',
  'Internal — Training',
  'Internal — Bench',
  'Internal — Other',
  'Leave / PTO',
  'Holiday',
] as const;
