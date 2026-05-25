/** A single timesheet entry pulled from Zoho People Timetracker.
 *  Mirrors the `actual_hours` Supabase table 1:1 (snake_case → camelCase
 *  is applied at the row<->object boundary inside supabaseSync.ts). */
export interface ActualHourEntry {
  /** Stable Zoho recordId. Primary key. */
  id: string;
  employeeId: string;
  employeeName: string;
  email: string | null;
  /** jobName / clientName from Zoho People. Free-text — may not match a
   *  forecast/pipeline project name exactly. v1 displays as-is. */
  project: string | null;
  /** ISO date string, YYYY-MM-DD. */
  workDate: string;
  hours: number;
  billing: string | null;
  notes: string | null;
  /** When this row was last written to Supabase. */
  syncedAt: string;
}
