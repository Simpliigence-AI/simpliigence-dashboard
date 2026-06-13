/** India Staffing Dashboard types */

export interface StaffingAccount {
  id: string;
  name: string;
  created_at: string;
}

export type StaffingStatus =
  | 'Open'
  | 'In Progress'
  | 'On Hold'
  | 'Closed'
  | 'Lost'
  | 'Cancelled';

/** Statuses that move a requisition into the archive (out of the main list) */
export const ARCHIVED_STATUSES: StaffingStatus[] = ['Closed', 'Lost', 'Cancelled'];

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
  created_at: string;
  updated_at: string;
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
  newPositions: number;
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
