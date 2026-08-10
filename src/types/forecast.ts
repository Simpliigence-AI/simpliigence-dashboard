/** Core types for the forecast-driven dashboard. */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export type Month = (typeof MONTHS)[number];

/** Create a zero-initialized Record<Month, number>. */
export function emptyMonthRecord(): Record<Month, number> {
  return { Jan: 0, Feb: 0, Mar: 0, Apr: 0, May: 0, Jun: 0, Jul: 0, Aug: 0, Sep: 0, Oct: 0, Nov: 0, Dec: 0 };
}

/** One row from the "Forecasting Hrs" sheet: one employee on one project. */
export interface ForecastAssignment {
  /** Stable unique ID for database persistence. Generated via nanoid. */
  id: string;
  employeeName: string;
  notes: string;
  role: string;
  rateCard: number | null; // USD/hr
  isSI: boolean;
  isContractor: boolean;
  project: string;
  /** Weekly hours keyed by ISO date string, e.g. "2026-01-05" */
  weeklyHours: Record<string, number>;
  /** Monthly total hours keyed by month name */
  monthlyTotals: Record<Month, number>;
  /** True when user has edited this row in the UI (survives spreadsheet re-sync). */
  _manuallyEdited?: boolean;
  /** True when user added this row manually (not from spreadsheet). */
  _manuallyAdded?: boolean;
  /** Original employee+project key before any renames, used to match during sync. */
  _originalKey?: string;
}

/** Aggregated view of one employee across all their projects. */
export interface EmployeeSummary {
  name: string;
  role: string;
  rateCard: number | null;
  isSI: boolean;
  isContractor: boolean;
  projects: string[];
  monthlyHours: Record<Month, number>;
  totalHours: number;
  q1Hours: number; // Jan–Mar
  q2Hours: number; // Apr–Jun
}

/** Aggregated view of one project across all assigned employees. */
export interface ProjectSummary {
  name: string;
  employees: { name: string; role: string; totalHours: number; rateCard: number | null }[];
  monthlyHours: Record<Month, number>;
  totalHours: number;
  loadedCost: number; // sum of employee hours × rate card
}

/** Weekly date column parsed from the header. */
export interface WeekColumn {
  colIndex: number;
  date: string; // ISO date string
  label: string; // e.g. "5 Jan"
}

/** A phase/milestone within a Zoho project. */
export interface ZohoPhase {
  id: string;
  name: string;
  startDate: string; // ISO date
  endDate: string;   // ISO date
  status: 'Completed' | 'In Progress' | 'Active' | string;
  isClosed: boolean;
  completedOn?: string; // ISO date
  owner: string;
}

/** A project from Zoho Projects (or manually added) for the pipeline/forecast. */
export interface ZohoPipelineProject {
  id: string;
  name: string;
  status: string; // e.g. "In Progress", "On Track", "Delayed", "Completed"
  owner: string;
  startDate: string | null; // ISO date
  endDate: string | null;   // ISO date
  source: 'zoho' | 'manual';
  zohoId?: string;
  /** Short name used in the forecast spreadsheet (for matching). */
  forecastName?: string;
  /** Go-Live date — auto-detected from phases or manually set. */
  goLiveDate?: string | null;
  /** Project revenue (manually entered). */
  revenue?: number | null;
  /** Revenue currency — defaults to USD. */
  revenueCurrency?: 'USD' | 'CAD';
  /** Estimated resource needs (for forecast) */
  resources: PipelineResource[];
  /** Phases/milestones — from Zoho originally, from Delivery Governance once linked. */
  phases?: ZohoPhase[];
  /**
   * Delivery Governance project id this is linked to, set by the "Sync with
   * Delivery Governance" flow. The two tools name projects differently, so
   * the link is stored explicitly rather than re-matched on names every time.
   */
  governanceProjectId?: string | null;
  /** Governance's own name for this project, kept for display in the sync dialog. */
  governanceProjectName?: string | null;
  /** ISO timestamp of the last successful plan pull. */
  governanceSyncedAt?: string | null;
}

export interface PipelineResource {
  roleCategory: 'BA' | 'JuniorDev' | 'SeniorDev' | 'Other';
  count: number;
  hoursPerMonth: number; // per person, default 160
}
