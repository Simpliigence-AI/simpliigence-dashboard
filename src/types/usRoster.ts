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
 *   SG&A             — Selling, General & Administrative. Corporate
 *                      overhead — leadership, sales, recruiting, finance,
 *                      admin. Never placed on a project, so they are NOT
 *                      bench: they must not sit in the bench pool waiting
 *                      to be staffed, and they must not dilute billable %.
 *                      Excluded from the utilisation denominator.
 *   On Leave         — temporarily out.
 *   Notice           — resigned; working out notice.
 */
export type USRosterStatus = 'Billable' | 'Bench' | 'Proactive Bench' | 'SG&A' | 'On Leave' | 'Notice';

export const US_ROSTER_STATUSES: USRosterStatus[] = [
  'Billable', 'Bench', 'Proactive Bench', 'SG&A', 'On Leave', 'Notice',
];

export const US_ROSTER_STATUS_COLORS: Record<USRosterStatus, string> = {
  Billable:          '#10b981',
  Bench:             '#f59e0b',
  'Proactive Bench': '#8b5cf6',
  'SG&A':            '#0ea5e9',
  'On Leave':        '#94a3b8',
  Notice:            '#ef4444',
};

/** Statuses that are NOT part of the delivery pool — excluded from the
 *  utilisation denominator (billable % / bench %). */
export const NON_DELIVERY_US_STATUSES: USRosterStatus[] = ['SG&A'];

export function isDeliveryHeadcount(status: USRosterStatus): boolean {
  return !NON_DELIVERY_US_STATUSES.includes(status);
}

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

/**
 * Roll a set of contracts up into one consultant-level summary.
 *
 * All four Global Roster views (By Client, By Consultant, Cards, Table)
 * MUST use this so the numbers agree. The legacy per-person cost / bill
 * fields on `us_roster` are ignored — they were captured by an earlier
 * schema (one row per consultant) and became meaningless once a consultant
 * could have N contracts at different rates. `us_roster_assignments` is
 * the source of truth.
 */
export function blendConsultantTotals(
  assignments: Pick<USRosterAssignment, 'cost_per_hour' | 'bill_rate'>[],
): {
  contractCount: number;
  monthlyRevenue: number;
  monthlyCost: number;
  monthlyMargin: number;
  marginPct: number;
  weightedBillRate: number;
  weightedCostRate: number;
} {
  if (assignments.length === 0) {
    return {
      contractCount: 0,
      monthlyRevenue: 0, monthlyCost: 0, monthlyMargin: 0,
      marginPct: 0, weightedBillRate: 0, weightedCostRate: 0,
    };
  }
  const monthlyRevenue = assignments.reduce((s, a) => s + (a.bill_rate || 0) * 160, 0);
  const monthlyCost    = assignments.reduce((s, a) => s + (a.cost_per_hour || 0) * 160, 0);
  const monthlyMargin  = monthlyRevenue - monthlyCost;
  const marginPct      = monthlyRevenue > 0 ? Math.round((monthlyMargin / monthlyRevenue) * 100) : 0;
  // Assumes each contract is 160 hrs; the weighted rates come out the same
  // as the plain average of the rates, weighted by 160.
  const weightedBillRate = Math.round(monthlyRevenue / (assignments.length * 160));
  const weightedCostRate = Math.round(monthlyCost    / (assignments.length * 160));
  return {
    contractCount: assignments.length,
    monthlyRevenue: Math.round(monthlyRevenue),
    monthlyCost: Math.round(monthlyCost),
    monthlyMargin: Math.round(monthlyMargin),
    marginPct,
    weightedBillRate,
    weightedCostRate,
  };
}
