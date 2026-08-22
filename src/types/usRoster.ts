/** US Roster types — full US FTE list (billable + bench + allocated).
 *  Superset of Open Bench (which only shows the available subset). */

import type { VisaCategory } from './openBench';

/**
 * A US roster member's current allocation state.
 *   Billable         — on a paid project.
 *   Bench            — full-time, currently unassigned but available.
 *   Proactive Bench  — deliberately kept on bench to be ready for an
 *                      imminent named opportunity or a strategic
 *                      capability we're staffing ahead of demand.
 *                      Distinct from regular Bench so leadership can see
 *                      the "planned idle" vs "surprise idle" split.
 *   On Leave         — temporarily out.
 *   Notice           — resigned; working out notice.
 */
export type USRosterStatus = 'Billable' | 'Bench' | 'Proactive Bench' | 'On Leave' | 'Notice';

export const US_ROSTER_STATUSES: USRosterStatus[] = [
  'Billable', 'Bench', 'Proactive Bench', 'On Leave', 'Notice',
];

export const US_ROSTER_STATUS_COLORS: Record<USRosterStatus, string> = {
  Billable:          '#10b981',
  Bench:             '#f59e0b',
  'Proactive Bench': '#8b5cf6',
  'On Leave':        '#94a3b8',
  Notice:            '#ef4444',
};

export interface USRosterMember {
  id: string;
  name: string;
  /** Role classification — same vocabulary as the India Roster */
  role: string;
  /** Current project allocation. Empty = unallocated / on bench. */
  project: string;
  status: USRosterStatus;
  /** Visa category — important context for US team allocation */
  visa_category: VisaCategory;
  /** Internal cost per hour (USD) — used for margin */
  cost_per_hour: number;
  /** Bill rate per hour (USD) — used for margin */
  bill_rate: number;
  /** ISO date when the person joined */
  start_date: string;
  /** Free-text skills */
  skills: string;
  /** US-specific: state/city like "Dallas, TX" */
  location: string;
  email: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export function calcUSMarginPercent(m: Pick<USRosterMember, 'cost_per_hour' | 'bill_rate'>): number {
  if (!m.bill_rate || m.bill_rate <= 0) return 0;
  return Math.round(((m.bill_rate - m.cost_per_hour) / m.bill_rate) * 100);
}

export function calcUSMarginAbsolute(m: Pick<USRosterMember, 'cost_per_hour' | 'bill_rate'>): number {
  return Math.round((m.bill_rate - m.cost_per_hour) * 100) / 100;
}

/**
 * A single contract a consultant is on. One consultant → many assignments,
 * each with its own SI, end client, and cost/bill. This is the source of
 * truth going forward; the deprecated `project` / `cost_per_hour` / `bill_rate`
 * fields on `USRosterMember` are kept only for rollback safety and are
 * ignored by the client-view and consultant-view UIs.
 */
export interface USRosterAssignment {
  id: string;
  roster_id: string;
  /** System integrator we bill (Ciklum, Cognizant, …). Null when direct. */
  si: string | null;
  /** Where the consultant actually sits (the SI's client). */
  end_client: string | null;
  /** Contract / project label */
  project: string | null;
  cost_per_hour: number;
  bill_rate: number;
  start_date: string | null;
  end_date: string | null;
  /** % of the consultant's time on this contract (null = unspecified). */
  allocation_pct: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function calcAssignmentMarginPercent(a: Pick<USRosterAssignment, 'cost_per_hour' | 'bill_rate'>): number {
  if (!a.bill_rate || a.bill_rate <= 0) return 0;
  return Math.round(((a.bill_rate - a.cost_per_hour) / a.bill_rate) * 100);
}
export function calcAssignmentMarginAbsolute(a: Pick<USRosterAssignment, 'cost_per_hour' | 'bill_rate'>): number {
  return Math.round((a.bill_rate - a.cost_per_hour) * 100) / 100;
}
/** Monthly revenue at 160 billable hrs/mo — same convention used elsewhere. */
export function calcAssignmentMonthlyRevenue(a: Pick<USRosterAssignment, 'bill_rate'>): number {
  return Math.round((a.bill_rate || 0) * 160);
}
