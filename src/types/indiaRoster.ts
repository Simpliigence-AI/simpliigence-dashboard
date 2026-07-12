/** India Roster types — full FTE list (billable + bench). */

/**
 * A person's current allocation state.
 *   Billable  — currently on a paid project.
 *   Bench     — full-time employee temporarily unassigned but available.
 *   On Leave  — temporarily out (parental, medical, etc.).
 *   Notice    — resigned; working out notice period.
 *   Inactive  — no longer on the team: ex-contractors whose contracts ended,
 *               alumni. Kept on the roster for historical reference but
 *               excluded from the active-team headcount and from bench.
 */
export type IndiaRosterStatus = 'Billable' | 'Bench' | 'On Leave' | 'Notice' | 'Inactive';

export const INDIA_ROSTER_STATUSES: IndiaRosterStatus[] = [
  'Billable', 'Bench', 'On Leave', 'Notice', 'Inactive',
];

/** Statuses that count toward the active team (excludes Inactive alumni). */
export const ACTIVE_INDIA_ROSTER_STATUSES: IndiaRosterStatus[] = [
  'Billable', 'Bench', 'On Leave', 'Notice',
];

export const INDIA_ROSTER_STATUS_COLORS: Record<IndiaRosterStatus, string> = {
  Billable:  '#10b981',  // emerald — earning revenue
  Bench:     '#f59e0b',  // amber  — available but not earning
  'On Leave':'#94a3b8',  // slate  — temporarily out
  Notice:    '#ef4444',  // red    — leaving
  Inactive:  '#cbd5e1',  // slate-300 — off the team
};

/** Common role categories for the Roster + Project Team views. Free-text
 *  is also allowed; this is just for sectioning + autocomplete. */
export const ROSTER_ROLES = [
  'BA',
  'Junior Developer',
  'Developer',
  'Senior Developer',
  'Architect',
  'Tech Lead',
  'Project Manager',
  'QA',
  'DevOps',
  'Designer',
  'Other',
] as const;

export interface IndiaRosterMember {
  id: string;
  name: string;
  /** Current role classification — drives the Project Team grouping */
  role: string;
  /** Current project allocation. Empty string = on bench / unallocated. */
  project: string;
  /** Allocation status — drives stats and color coding */
  status: IndiaRosterStatus;
  /** Internal cost per hour (USD). Used to compute margin. */
  cost_per_hour: number;
  /** Bill rate per hour (USD). Used to compute margin. */
  bill_rate: number;
  /** ISO date (YYYY-MM-DD) when the person joined Simpliigence. */
  start_date: string;
  /** Comma- or pipe-separated skills (free text for now). */
  skills: string;
  /** Optional contact info */
  email: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

/** Computed margin % from cost + bill_rate. Returns 0 if bill_rate is 0/negative. */
export function calcMarginPercent(member: Pick<IndiaRosterMember, 'cost_per_hour' | 'bill_rate'>): number {
  if (!member.bill_rate || member.bill_rate <= 0) return 0;
  return Math.round(((member.bill_rate - member.cost_per_hour) / member.bill_rate) * 100);
}

/** Absolute hourly margin in USD ($/hr). */
export function calcMarginAbsolute(member: Pick<IndiaRosterMember, 'cost_per_hour' | 'bill_rate'>): number {
  return Math.round((member.bill_rate - member.cost_per_hour) * 100) / 100;
}
