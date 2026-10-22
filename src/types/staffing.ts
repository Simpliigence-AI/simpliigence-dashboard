/** India Staffing Dashboard types */

export type AccountTier = 1 | 2;

export interface StaffingAccount {
  id: string;
  name: string;
  /** Strategic segmentation. Tier 1 = named / must-serve strategic accounts,
   *  surfaced at the top of the demand page. Tier 2 = everything else. */
  tier: AccountTier;
  created_at: string;
}

export type StaffingStatus =
  | 'Open'
  | 'In Progress'
  | 'On Hold'
  | 'Closed Won'
  | 'Closed Lost'
  | 'Cancelled';

/** Statuses that move a requisition into the archive (out of the main list) */
export const ARCHIVED_STATUSES: StaffingStatus[] = ['Closed Won', 'Closed Lost', 'Cancelled'];

/** Sub-buckets inside the Archived section:
 *  - Closed Won → celebrated separately
 *  - Closed Lost / Cancelled → grouped together (both are non-wins) */
export const CLOSED_WON_STATUSES: StaffingStatus[] = ['Closed Won'];
export const LOST_OR_CANCELLED_STATUSES: StaffingStatus[] = ['Closed Lost', 'Cancelled'];

export interface StaffingRequisition {
  id: string;
  account_id: string;
  account_name?: string;
  title: string;
  month: string;
  new_positions: number;
  expected_closure: string;
  /** ISO date (YYYY-MM-DD) when the requisition opened — drives Ageing calculation */
  start_date: string;
  /** ISO date (YYYY-MM-DD) for planned closure */
  close_by_date: string;
  status_field: StaffingStatus;
  stage: PipelineStage;
  /** ISO date (YYYY-MM-DD) when the candidate actually joined. Set separately
   *  from status; a req can be Closed Won but not yet Onboarded until this
   *  date is filled in. Used to split the Closed Won archive into two
   *  buckets: won-and-onboarded vs won-but-awaiting-onboarding. */
  onboarding_date?: string | null;
  anticipation: string;
  client_spoc: string;
  department: string;
  /** Manually entered probability (0–100). 0 or null means "use AI probability". */
  probability: number;
  /** AI-derived probability (0–100). Re-calculated automatically from status text + anticipation. */
  ai_probability: number;
  /** Persisted JD markdown (set by the Generate JD flow). Null/undefined until generated. */
  job_description?: string | null;
  /** ISO timestamp when `job_description` was last set. */
  job_description_at?: string | null;
  /** Post this req on the Hub referral page (internal accounts always post). */
  share_to_referrals?: boolean;
  /** ISO date (YYYY-MM-DD) billing starts. Required on new requisitions. */
  bill_start_date?: string;
  /** Client budget per hour, always USD. Required on new requisitions. */
  budget_per_hour_usd?: number | null;
  /** Remote / Hybrid / WFO. Required on new requisitions. */
  work_mode?: WorkMode | '';
  /** Work location — required when work_mode is Hybrid or WFO. */
  location?: string;
  created_at: string;
  updated_at: string;
}

export type WorkMode = 'Remote' | 'Hybrid' | 'WFO';
export const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: 'Remote', label: 'Remote' },
  { value: 'Hybrid', label: 'Hybrid' },
  { value: 'WFO', label: 'Work from office (WFO)' },
];
export const workModeNeedsLocation = (m: string | null | undefined) => m === 'Hybrid' || m === 'WFO';

/** Billing fields every new India requisition must carry. Returns the first
 *  missing field's message, or null when all are valid. */
export function validateReqBillingFields(f: {
  billStartDate: string; budgetPerHour: string | number; workMode: string; location: string;
}): string | null {
  if (!f.billStartDate) return 'Bill start date is required';
  const b = Number(f.budgetPerHour);
  if (f.budgetPerHour === '' || !Number.isFinite(b) || b <= 0) return 'Budget per hour (USD) is required';
  if (!f.workMode) return 'Work mode is required';
  if (workModeNeedsLocation(f.workMode) && !f.location.trim()) return 'Location is required for Hybrid / WFO';
  return null;
}

export type ReqBillingField = 'bill_start_date' | 'budget_per_hour_usd' | 'work_mode' | 'location';
export const REQ_BILLING_FIELD_LABELS: Record<ReqBillingField, string> = {
  bill_start_date: 'Bill start date',
  budget_per_hour_usd: 'Budget / hr (USD)',
  work_mode: 'Work mode',
  location: 'Location',
};

/** Required billing fields still blank on an existing requisition. Reqs created
 *  from a forwarded India-demand email skip the create-time check, so these
 *  are flagged on the row until someone fills them in. */
export function missingReqBillingFields(r: {
  billStartDate?: string; budgetPerHourUsd?: number | null; workMode?: string; location?: string;
}): ReqBillingField[] {
  const out: ReqBillingField[] = [];
  if (!r.billStartDate) out.push('bill_start_date');
  if (r.budgetPerHourUsd == null || !(r.budgetPerHourUsd > 0)) out.push('budget_per_hour_usd');
  if (!r.workMode) out.push('work_mode');
  if (workModeNeedsLocation(r.workMode) && !(r.location || '').trim()) out.push('location');
  return out;
}

export interface DailyStatus {
  id: string;
  requisition_id: string;
  status_date: string;
  status_text: string;
  anticipation: string;
  created_at: string;
}

/** Audit log — one row per field change on a requisition */
export interface StaffingHistoryEntry {
  id: string;
  requisition_id: string;
  field: string;
  old_value: string;
  new_value: string;
  changed_at: string;
  changed_by: string;
}

/** Lifecycle stage for a single candidate on a requisition. */
export type CandidateStage =
  | 'Submitted'
  | 'Screening'
  | 'Interview Scheduled'
  | 'Interviewed'
  | 'Shortlisted'
  | 'Client Round'
  | 'Selected'
  | 'Offer Extended'
  | 'Offer Accepted'
  | 'Joined'
  | 'Rejected'
  | 'Dropped Out'
  | 'On Hold';

export const CANDIDATE_STAGES: CandidateStage[] = [
  'Submitted', 'Screening', 'Interview Scheduled', 'Interviewed', 'Shortlisted',
  'Client Round', 'Selected', 'Offer Extended', 'Offer Accepted', 'Joined',
  'Rejected', 'Dropped Out', 'On Hold',
];

/** Stages considered "alive" (still in the running). */
export const ACTIVE_CANDIDATE_STAGES: CandidateStage[] = [
  'Submitted', 'Screening', 'Interview Scheduled', 'Interviewed', 'Shortlisted',
  'Client Round', 'Selected', 'Offer Extended', 'Offer Accepted', 'Joined',
];

export const CANDIDATE_STAGE_COLORS: Record<CandidateStage, string> = {
  'Submitted':           '#94a3b8',
  'Screening':           '#60a5fa',
  'Interview Scheduled': '#06b6d4',
  'Interviewed':         '#f59e0b',
  'Shortlisted':         '#8b5cf6',
  'Client Round':        '#3b82f6',
  'Selected':            '#22c55e',
  'Offer Extended':      '#10b981',
  'Offer Accepted':      '#059669',
  'Joined':              '#047857',
  'Rejected':            '#ef4444',
  'Dropped Out':         '#b91c1c',
  'On Hold':             '#64748b',
};

/** One candidate being submitted/tracked against a requisition. */
export interface StaffingCandidate {
  id: string;
  requisition_id: string;
  name: string;
  /** Job title from Zoho (e.g. "Salesforce Developer", "Fresher") — kept for context. */
  experience: string;
  /** Years of experience (numeric). Populated by the Zoho sync from
   *  Experience_in_Years if present, else computed by summing Experience_Details
   *  work durations. Null when no work history is available. */
  years_of_experience?: number | null;
  /** Current lifecycle stage. Changes are NOT audited by default. */
  stage: CandidateStage;
  /** ISO date when the candidate was first submitted */
  submit_date: string;
  /** Free-text interview / screening feedback */
  feedback: string;
  /** Where the candidate came from — "referral", "LinkedIn", "Naukri", "vendor", etc. */
  source: string;
  /** Candidate contact email (optional) */
  email: string;
  /** Candidate phone (optional) */
  phone: string;
  /** TA who owns this candidate (auth email). Drives the "My Day" auto-populated req list. */
  owning_ta_email?: string;
  /** Candidate's current location — free text, e.g. "Bangalore, India" or "Remote (US-EST)". Searchable. */
  location?: string;
  /** Candidate's LinkedIn profile URL (optional). */
  linkedin_url?: string;
  /** Storage object path within the `candidate-resumes` bucket (optional). */
  resume_url?: string;
  /** Original filename uploaded by the user (optional). */
  resume_filename?: string;
  /** ISO timestamp the resume was uploaded (optional). */
  resume_uploaded_at?: string;
  /** Skills auto-parsed by the parse-resume edge function. */
  skills?: string[];
  /** Profile summary auto-parsed by the parse-resume edge function. */
  profile_summary?: string;
  /** ISO timestamp the resume was last parsed by Claude. */
  parsed_at?: string;
  /** When the candidate was sourced via an employee referral, the referring
   *  employee's email — drives the source='Referral' UI on the row. */
  referrer_email?: string;
  /** Optional display name for the referrer ("Scott Murray"). */
  referrer_name?: string;
  /** ISO date (YYYY-MM-DD) the referral was submitted. */
  referred_at?: string;
  /** Which engagement types the candidate is open to: 'full_time', 'contracting'. */
  availability?: AvailabilityKind[];
  /** Free-text expected salary ("10-12 LPA", "$60/hr", "Negotiable"). */
  expected_salary?: string;
  created_at: string;
  updated_at: string;
}

export type AvailabilityKind = 'full_time' | 'contracting';
export const AVAILABILITY_LABELS: Record<AvailabilityKind, string> = {
  full_time: 'Full-time',
  contracting: 'Contracting',
};

export type RiskLevel = 'high' | 'medium' | 'low';

export type PipelineStage =
  | 'Sourcing'
  | 'Profiles Shared'
  | 'Interview'
  | 'Shortlisted'
  | 'Client Round'
  | 'Closed/Selected'
  | 'Onboarding';

export interface StaffingRow {
  id: string;
  month: string;
  account: string;
  account_id: string;
  requisition: string;
  /** Total positions requested on the requisition (e.g. 6). */
  newPositions: number;
  /** Candidates linked to this req in 'filled' stages (Offer Accepted, Joined). */
  filledPositions: number;
  /** Remaining positions to fill = max(0, newPositions - filledPositions). */
  openPositions: number;
  expectedClosure: string;
  startDate: string;
  closeByDate: string;
  /** Ageing in days (today - start_date). 0 if no start date. */
  ageing: number;
  statusField: StaffingStatus;
  status: string;
  anticipation: string;
  /** Manual Prob (0 = auto / fall back to AI) */
  probability: number;
  /** AI-derived probability */
  aiProbability: number;
  /** Effective probability used for forecasts: manual if set, else AI */
  closureProb: number;
  risk: RiskLevel;
  stage: PipelineStage;
  velocity: number;
  clientSpoc: string;
  department: string;
  /** Ticked "Share to referrals" in the Cockpit. */
  shareToReferrals: boolean;
  billStartDate: string;
  budgetPerHourUsd: number | null;
  workMode: WorkMode | '';
  location: string;
}

export const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
] as const;

export const STAGE_COLORS: Record<PipelineStage, string> = {
  'Onboarding': '#10b981',
  'Closed/Selected': '#22c55e',
  'Client Round': '#3b82f6',
  'Shortlisted': '#8b5cf6',
  'Interview': '#f59e0b',
  'Profiles Shared': '#06b6d4',
  'Sourcing': '#94a3b8',
};
