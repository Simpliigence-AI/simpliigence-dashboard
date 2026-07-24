/**
 * Types for the human Dialer (browser softphone → Twilio → PSTN).
 * Mirrors the dialer_calls table (migration 016).
 */

export type DialerCallStatus =
  | 'queued' | 'ringing' | 'in-progress'
  | 'completed' | 'no-answer' | 'busy' | 'failed' | 'canceled';

export type DialerAiStatus = 'transcribing' | 'analyzing' | 'done' | 'failed' | null;

export interface DialerAiNotes {
  summary?: string;
  key_points?: string[];
  action_items?: string[];
  next_steps?: string;
  objections?: string[];
  opportunity_signals?: string[];
  sentiment?: 'positive' | 'neutral' | 'negative';
  follow_up_recommended?: string;
}

/** Row shape as stored in Supabase (snake_case, straight from the table). */
export interface DialerCallRow {
  id: string;
  direction: string;
  to_phone: string;
  to_name: string | null;
  to_title: string | null;
  to_company: string | null;
  contact_source: 'salesforce' | 'zoominfo' | 'manual' | null;
  contact_id: string | null;
  placed_by: string | null;
  caller_id: string | null;
  provider: string;
  provider_call_sid: string | null;
  child_call_sid: string | null;
  status: DialerCallStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_sec: number | null;
  recording_sid: string | null;
  recording_url: string | null;
  recording_path: string | null;
  transcript: string | null;
  ai_notes: DialerAiNotes | null;
  ai_status: DialerAiStatus;
  error_msg: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

/** A contact hit from dialer-contact-search (Salesforce or ZoomInfo). */
export interface DialerContact {
  source: 'salesforce' | 'zoominfo';
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
}

export interface ContactSearchResponse {
  ok: boolean;
  error?: string;
  results: DialerContact[];
  salesforce?: { configured: boolean; error?: string };
  zoominfo?: { configured: boolean; error?: string; message?: string };
}

export interface TwilioTokenResponse {
  ok: boolean;
  token?: string;
  identity?: string;
  ttlSec?: number;
  error?: string;
}
