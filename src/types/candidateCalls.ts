/** Types for the AI outbound calling module. */

export type CandidateCallStatus =
  | 'queued'
  | 'dialing'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'no-answer'
  | 'failed'
  | 'cancelled';

export interface TemplateQuestion {
  key: string;                       // stable id (e.g. "compensation")
  prompt: string;                    // what the AI says to the candidate
  type: 'text' | 'number' | 'enum';
  required?: boolean;
  enum_values?: string[];
}

export interface CallTemplate {
  id: string;
  name: string;
  openingScript: string;
  closingScript: string;
  questions: TemplateQuestion[];
  active: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What we extract from a transcript via Claude. Keys mirror the DB JSON shape. */
export interface ExtractedAnswers {
  name_confirmed?: boolean | null;
  confirmed_name?: string;
  current_employer?: string;
  current_location?: string;
  willing_to_relocate?: boolean | null;
  current_ctc_inr?: number | null;
  expected_ctc_inr?: number | null;
  notice_period_days?: number | null;
  engagement?: 'engaged' | 'rushed' | 'declined' | null;
  overall_summary?: string;
}

export interface CandidateCall {
  id: string;
  candidateId: string;
  templateId: string | null;
  triggeredBy: string;
  provider: 'vapi';
  providerCallId: string | null;
  status: CandidateCallStatus;
  toPhone: string;
  transcript: string | null;
  recordingUrl: string | null;
  extractedAnswers: ExtractedAnswers | null;
  costUsd: number | null;
  durationSec: number | null;
  startedAt: string | null;
  endedAt: string | null;
  errorMsg: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Statuses that mean the call is mid-flight and should show a spinner. */
export const ACTIVE_CALL_STATUSES: CandidateCallStatus[] = ['queued', 'dialing', 'ringing', 'in-progress'];
