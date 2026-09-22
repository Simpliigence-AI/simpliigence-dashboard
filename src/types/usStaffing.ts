/** US Staffing Dashboard types */

export type AccountCategory = 'MSP' | 'SI';

export type USStaffingStage =
  | 'New'
  | 'Sourcing'
  | 'Profiles Shared'
  | 'Interview'
  | 'Shortlisted'
  | 'Client Round'
  | 'Closed/Selected'
  | 'Onboarding'
  | 'On Hold'
  | 'Cancelled';

export interface USStaffingAccount {
  id: string;
  name: string;
  category: AccountCategory;
  notes?: string | null;
  website?: string | null;
  key_contact_name?: string | null;
  key_contact_email?: string | null;
  key_contact_phone?: string | null;
  /** Set when this row was promoted from tnm_accounts. FK to tnm_accounts.id. */
  promoted_from_tnm_id?: string | null;
  created_at: string;
}

/** Named SPOC / hiring manager / procurement contact under a Global Demand account. */
export interface USStaffingAccountContact {
  id: string;
  accountId: string;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface USStaffingRequisition {
  id: string;
  account_id: string;
  account_name?: string;
  role: string;
  initiation_date: string;
  stage: USStaffingStage;
  closure_date: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export const US_STAGE_COLORS: Record<USStaffingStage, string> = {
  'Onboarding': '#10b981',
  'Closed/Selected': '#22c55e',
  'Client Round': '#3b82f6',
  'Shortlisted': '#8b5cf6',
  'Interview': '#f59e0b',
  'Profiles Shared': '#06b6d4',
  'Sourcing': '#94a3b8',
  'New': '#e2e8f0',
  'On Hold': '#f97316',
  'Cancelled': '#ef4444',
};
