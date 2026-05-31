/** A single timesheet entry — Zoho-sourced OR Simpliigence-entered.
 *  Reads from the `unified_actual_hours` SQL view that UNIONs the two
 *  sources. The `source` field distinguishes them. */
export interface ActualHourEntry {
  /** Stable id (Zoho recordId for zoho_people rows, nanoid for simpliigence). */
  id: string;
  employeeId: string;
  employeeName: string;
  email: string | null;
  /** Project / job name. Free-text — may not match a forecast/pipeline project
   *  name exactly. */
  project: string | null;
  /** ISO date string, YYYY-MM-DD. */
  workDate: string;
  hours: number;
  billing: string | null;
  notes: string | null;
  /** Source of truth: `zoho_people` (synced from Zoho) or `simpliigence`
   *  (entered directly via /my-time). */
  source?: 'zoho_people' | 'simpliigence';
  /** When this row was last written to Supabase. */
  syncedAt: string;
}
