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
export interface ScreeningEvaluation {
  overall_score: number;
  overall_recommendation: ScreeningRecommendation;
  per_criterion: ScreeningEvaluationCriterion[];
  summary: string;
  next_steps?: string[];
}

export interface Screening {
  id: string;
  requisitionId: string | null;
  requisitionSource: RequisitionSource;
  requisitionTitle: string | null;
  accountName: string | null;
  jd: string;
  criteria: ScreeningCriterion[];
  candidateProfile: string;
  candidateName: string | null;
  generatedQuestions: ScreeningQuestion[];
  transcript: string | null;
  evaluation: ScreeningEvaluation | null;
  status: ScreeningStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Default criterion menu — recruiters can add/edit/remove per screening. */
export const DEFAULT_SCREENING_CRITERIA: ScreeningCriterion[] = [
  { name: 'Development skills', weight: 30, notes: 'Depth in the required tech stack from the JD' },
  { name: 'Communication skills', weight: 20, notes: 'Clarity, active listening, English fluency' },
  { name: 'Relevant experience', weight: 25, notes: 'Recent work matching the JD scope + domain' },
  { name: 'Problem-solving', weight: 15 },
  { name: 'Cultural fit', weight: 10 },
];

export const RECOMMENDATION_META: Record<ScreeningRecommendation, { label: string; cls: string; dot: string }> = {
  strong_yes: { label: 'Strong Yes', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  yes:        { label: 'Yes',        cls: 'bg-sky-100 text-sky-800 border-sky-200',             dot: 'bg-sky-500' },
  no:         { label: 'No',         cls: 'bg-amber-100 text-amber-800 border-amber-200',       dot: 'bg-amber-500' },
  strong_no:  { label: 'Strong No',  cls: 'bg-rose-100 text-rose-800 border-rose-200',          dot: 'bg-rose-500' },
};
