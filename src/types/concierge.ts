/**
 * Concierge — Simpliigence's managed-services offering.
 *
 * A `ConciergeAccount` represents an ongoing managed-support customer with
 * either a monthly retainer or annual unlimited contract. Each account has:
 *   - a catalog of `ConciergeFeature` entries tracking what's implemented vs
 *     what's a candidate for upsell (the "backlog of ideas");
 *   - a tech stack list used to identify cross-sell opportunities;
 *   - a monthly `ConciergeBillingEntry` history showing hours + amount trend.
 *
 * Zoho Desk tickets ({@link ConciergeTicket} in useConciergeStore) attach to
 * an account by name-match on `account`.
 */

export type BillingModel = 'monthly_retainer' | 'annual_unlimited' | 'hourly';
export type AccountHealth = 'green' | 'yellow' | 'red';
export type FeatureStatus = 'implemented' | 'in_progress' | 'planned' | 'not_implemented';
export type FeaturePriority = 'high' | 'medium' | 'low';

export interface ConciergeAccount {
  id: string;
  name: string;
  billingModel: BillingModel;
  monthlyRate: number | null;       // USD/month for monthly_retainer or amortized annual/12
  contractStart: string | null;     // YYYY-MM-DD
  contractEnd: string | null;       // YYYY-MM-DD
  health: AccountHealth;
  isDormant: boolean;               // true = re-engagement target (inactive concierge relationship)
  ownerEmail: string | null;
  techStack: string[];              // e.g. ["Salesforce Sales Cloud", "Marketing Cloud"]
  currentWork: string | null;       // free-text: what we're doing this month
  previousWork: string | null;      // free-text: last month/quarter
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConciergeFeature {
  id: string;
  accountId: string;
  name: string;
  category: string;                 // e.g. "Sales Cloud", "Service Cloud", "Marketing Cloud", "Integration"
  status: FeatureStatus;
  priority: FeaturePriority;
  upsellEstimate: number | null;    // USD revenue potential (0 for implemented)
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConciergeBillingEntry {
  id: string;
  accountId: string;
  month: string;                    // YYYY-MM
  amount: number;                   // USD billed
  hours: number;                    // hours worked
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const BILLING_MODEL_META: Record<BillingModel, { label: string; cls: string }> = {
  monthly_retainer:  { label: 'Monthly Retainer',   cls: 'bg-sky-100 text-sky-800' },
  annual_unlimited:  { label: 'Annual Unlimited',   cls: 'bg-violet-100 text-violet-800' },
  hourly:            { label: 'Hourly',             cls: 'bg-slate-100 text-slate-700' },
};

export const HEALTH_META: Record<AccountHealth, { label: string; cls: string; ring: string }> = {
  green:  { label: 'Healthy',  cls: 'bg-emerald-100 text-emerald-800', ring: 'ring-emerald-200' },
  yellow: { label: 'Watch',    cls: 'bg-amber-100 text-amber-800',     ring: 'ring-amber-200' },
  red:    { label: 'At risk',  cls: 'bg-rose-100 text-rose-800',       ring: 'ring-rose-200' },
};

export const FEATURE_STATUS_META: Record<FeatureStatus, { label: string; cls: string; heat: string }> = {
  implemented:     { label: 'Implemented',      cls: 'bg-emerald-100 text-emerald-800', heat: 'bg-emerald-500' },
  in_progress:     { label: 'In Progress',      cls: 'bg-sky-100 text-sky-800',         heat: 'bg-sky-400' },
  planned:         { label: 'Planned',          cls: 'bg-amber-100 text-amber-800',     heat: 'bg-amber-400' },
  not_implemented: { label: 'Not Implemented',  cls: 'bg-slate-100 text-slate-500',     heat: 'bg-slate-200' },
};

export const FEATURE_PRIORITY_META: Record<FeaturePriority, { label: string; cls: string; rank: number }> = {
  high:   { label: 'High',   cls: 'bg-rose-100 text-rose-800',   rank: 0 },
  medium: { label: 'Medium', cls: 'bg-amber-100 text-amber-800', rank: 1 },
  low:    { label: 'Low',    cls: 'bg-slate-100 text-slate-600', rank: 2 },
};

/** Standard Salesforce/related capability catalog — seed suggestions for
 *  building out a new concierge account's feature map. */
export const STANDARD_FEATURE_CATALOG: Array<{ name: string; category: string }> = [
  { name: 'Sales Cloud — Lead Management',       category: 'Sales Cloud' },
  { name: 'Sales Cloud — Opportunity Pipeline',  category: 'Sales Cloud' },
  { name: 'Sales Cloud — Forecasting',           category: 'Sales Cloud' },
  { name: 'Sales Cloud — Territory Management',  category: 'Sales Cloud' },
  { name: 'CPQ / Revenue Cloud',                 category: 'Revenue Cloud' },
  { name: 'Service Cloud — Case Management',     category: 'Service Cloud' },
  { name: 'Service Cloud — Knowledge Base',      category: 'Service Cloud' },
  { name: 'Service Cloud — Omnichannel',         category: 'Service Cloud' },
  { name: 'Digital Engagement — Chat',           category: 'Service Cloud' },
  { name: 'Field Service Lightning',             category: 'Service Cloud' },
  { name: 'Marketing Cloud — Email Journeys',    category: 'Marketing Cloud' },
  { name: 'Marketing Cloud — SMS/Push',          category: 'Marketing Cloud' },
  { name: 'Account Engagement (Pardot)',         category: 'Marketing Cloud' },
  { name: 'Data Cloud / CDP',                    category: 'Data Cloud' },
  { name: 'Experience Cloud (Community)',        category: 'Experience Cloud' },
  { name: 'Commerce Cloud',                      category: 'Commerce' },
  { name: 'Einstein AI / Agentforce',            category: 'AI' },
  { name: 'Analytics / Tableau',                 category: 'Analytics' },
  { name: 'MuleSoft Integration',                category: 'Integration' },
  { name: 'DocuSign / e-signature',              category: 'Integration' },
];
