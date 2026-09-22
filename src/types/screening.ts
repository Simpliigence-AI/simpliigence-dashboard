/**
 * Recruiter screening records. One row per (requisition × candidate) screen.
 * Owned by table `screenings`.
 */
export type ScreeningStatus = 'draft' | 'questions_generated' | 'evaluated';
export type ScreeningRecommendation = 'strong_yes' | 'yes' | 'no' | 'strong_no';
export type RequisitionSource = 'india' | 'us';

export interface ScreeningCriterion {
  name: string;
  weight?: number;   // 1-100; if omitted, treat as equal weight
  notes?: string;
}
export interface ScreeningQuestion {
  criterion: string;
  question: string;
  why_ask?: string;
  red_flags?: string[];
}
export interface ScreeningEvaluationCriterion {
  name: string;
  score: number;              // 0-100
  evidence: string[];
  gaps: string[];
  summary: string;
}
export interface ScreeningDeliveryAssessment {
  summary: string;
  avg_score: number;
}
export interface ScreeningEvaluation {
  overall_score: number;
  overall_recommendation: ScreeningRecommendation;
  per_criterion: ScreeningEvaluationCriterion[];
  delivery_assessment?: ScreeningDeliveryAssessment;
  summary: string;
  next_steps?: string[];
}

/** Recruiter's post-call ratings — the AI cannot see body language or hear
 *  tone from a transcript, so these are authoritative for delivery.
 *  Each field is 1-5 (Poor → Excellent). Notes is free-form. */
export interface RecruiterObservations {
  verbal_fluency?: number;
  confidence?: number;
  energy?: number;
  structured_thinking?: number;
  cultural_warmth?: number;
  notes?: string;
}

export const RECRUITER_OBSERVATION_LABELS: Array<{ key: keyof RecruiterObservations; label: string; help: string }> = [
  { key: 'verbal_fluency',      label: 'Verbal fluency',      help: 'Clarity of speech, English fluency, pace' },
  { key: 'confidence',          label: 'Confidence',          help: 'How they hold their answers under probing' },
  { key: 'energy',              label: 'Energy & engagement', help: 'Enthusiasm, presence on the call' },
  { key: 'structured_thinking', label: 'Structured thinking', help: 'Answers stay on topic and follow a logical order' },
  { key: 'cultural_warmth',     label: 'Cultural warmth',     help: 'Rapport-building, listening, professionalism' },
];

export interface Screening {
  id: string;
  requisitionId: string | null;
  requisitionSource: RequisitionSource;
  requisitionTitle: string | null;
  accountName: string | null;
  jd: string;
  criteria: ScreeningCriterion[];
  /** Free-text recruiter steer: "Salesforce BA specializing in Service Cloud",
   *  "AWS Solutions Architect with heavy VPC/IAM depth". Drives the technical
   *  emphasis of generated questions. */
  roleFocus: string | null;
  candidateProfile: string;
  candidateName: string | null;
  generatedQuestions: ScreeningQuestion[];
  transcript: string | null;
  recruiterObservations: RecruiterObservations | null;
  evaluation: ScreeningEvaluation | null;
  status: ScreeningStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Default criterion menu — recruiters can add/edit/remove per screening. */
export const DEFAULT_SCREENING_CRITERIA: ScreeningCriterion[] = [
  { name: 'Technical depth (role-specific)', weight: 40, notes: 'Deep understanding of the role\'s core tech — config, tradeoffs, gotchas — not textbook definitions' },
  { name: 'Relevant experience',              weight: 25, notes: 'Recent, verifiable work matching the JD scope + domain' },
  { name: 'Problem-solving',                  weight: 15, notes: 'Diagnosis + reasoning under a scenario' },
  { name: 'Communication skills',             weight: 10, notes: 'Delivery-side — sourced from recruiter observations, not the transcript' },
  { name: 'Cultural fit',                     weight: 10, notes: 'Delivery-side — recruiter observations' },
];

export const RECOMMENDATION_META: Record<ScreeningRecommendation, { label: string; cls: string; dot: string }> = {
  strong_yes: { label: 'Strong Yes', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  yes:        { label: 'Yes',        cls: 'bg-sky-100 text-sky-800 border-sky-200',             dot: 'bg-sky-500' },
  no:         { label: 'No',         cls: 'bg-amber-100 text-amber-800 border-amber-200',       dot: 'bg-amber-500' },
  strong_no:  { label: 'Strong No',  cls: 'bg-rose-100 text-rose-800 border-rose-200',          dot: 'bg-rose-500' },
};
