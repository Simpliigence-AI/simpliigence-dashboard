/**
 * GTM List — strategic accounts we're pursuing partnerships with.
 * Owned by tables gtm_accounts, gtm_contacts, gtm_actions.
 */

export type GtmStatus = 'prospecting' | 'engaged' | 'active_discussion' | 'proposal' | 'won' | 'lost' | 'paused';
export type GtmPriority = 'high' | 'medium' | 'low';
export type GtmActionStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

export interface GtmAccount {
  id: string;
  name: string;
  website: string | null;
  industry: string | null;
  segment: string | null;
  geo: string | null;
  partnershipType: string | null;
  status: GtmStatus;
  priority: GtmPriority;
  assigneeEmail: string | null;
  estimatedAnnualValueUsd: number | null;
  nextStep: string | null;
  nextStepDate: string | null;
  rationale: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GtmContact {
  id: string;
  gtmAccountId: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  relationshipOwner: string | null;
  lastTouched: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GtmAction {
  id: string;
  gtmAccountId: string;
  title: string;
  description: string | null;
  assigneeEmail: string | null;
  dueDate: string | null;
  status: GtmActionStatus;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const GTM_STATUS_META: Record<GtmStatus, { label: string; cls: string; rank: number }> = {
  prospecting:        { label: 'Prospecting',        cls: 'bg-slate-100 text-slate-700 border-slate-200', rank: 0 },
  engaged:            { label: 'Engaged',            cls: 'bg-sky-50 text-sky-700 border-sky-200',       rank: 1 },
  active_discussion:  { label: 'Active Discussion',  cls: 'bg-indigo-50 text-indigo-700 border-indigo-200', rank: 2 },
  proposal:           { label: 'Proposal',           cls: 'bg-violet-50 text-violet-700 border-violet-200', rank: 3 },
  won:                { label: 'Won',                cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', rank: 4 },
  lost:               { label: 'Lost',               cls: 'bg-rose-50 text-rose-800 border-rose-200',    rank: 5 },
  paused:             { label: 'Paused',             cls: 'bg-amber-50 text-amber-800 border-amber-200', rank: 6 },
};

export const GTM_PRIORITY_META: Record<GtmPriority, { label: string; cls: string; dot: string }> = {
  high:   { label: 'High',   cls: 'bg-rose-100 text-rose-800 border-rose-200',       dot: 'bg-rose-500' },
  medium: { label: 'Medium', cls: 'bg-amber-100 text-amber-800 border-amber-200',    dot: 'bg-amber-500' },
  low:    { label: 'Low',    cls: 'bg-slate-100 text-slate-600 border-slate-200',    dot: 'bg-slate-400' },
};

export const GTM_ACTION_STATUS_META: Record<GtmActionStatus, { label: string; cls: string }> = {
  open:         { label: 'Open',        cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  in_progress:  { label: 'In Progress', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  done:         { label: 'Done',        cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  cancelled:    { label: 'Cancelled',   cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

export const GTM_PARTNERSHIP_TYPES = [
  'Reseller',
  'SI Partner',
  'Referral',
  'Co-sell',
  'Strategic Alliance',
  'Channel Partner',
  'Integration Partner',
] as const;

export const GTM_SEGMENTS = ['Enterprise', 'Mid-Market', 'SMB', 'Boutique'] as const;
