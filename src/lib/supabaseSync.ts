/**
 * Supabase sync layer — bridges Zustand stores ↔ Supabase database.
 *
 * Architecture:
 *  - On app init: fetch from Supabase → hydrate stores (overrides localStorage)
 *  - On store mutations: store actions call db.* functions (fire-and-forget)
 *  - On realtime: remote changes update stores via setState (bypasses actions → no echo)
 *  - localStorage persist middleware kept as offline fallback / instant page load cache
 */
import { nanoid } from 'nanoid';
import { supabase, CLIENT_ID } from './supabase';
import type { ForecastAssignment, Month, ZohoPipelineProject } from '../types/forecast';
import type { FinancialSettings } from '../types/financial';
import type { ConciergeConfig, ScenarioSettings, StaffingRequest } from '../types/hiringForecast';
import { emptyMonthRecord } from '../types/forecast';
import type { StaffingAccount as IndiaAccount, StaffingRequisition as IndiaRequisition, DailyStatus, StaffingHistoryEntry, StaffingCandidate } from '../types/staffing';
import type { USStaffingAccount, USStaffingRequisition, AccountCategory } from '../types/usStaffing';
import type { BenchResource, BenchUpdate, VisaCategory, JobPriority, BenchUpdateType } from '../types/openBench';
import type { IndiaRosterMember, IndiaRosterStatus } from '../types/indiaRoster';
import type { USRosterMember, USRosterStatus } from '../types/usRoster';
import type { ActualHourEntry } from '../types/actualHours';
import type { TADailyLogEntry, TeamMember } from '../types/taLog';
import type { TimeEntry } from '../types/timeEntry';
import type { Account, AccountConnect, AccountActionItem } from '../types/accountMgmt';

// ─── Conversion helpers ────────────────────────────────────────────

function assignmentToRow(a: ForecastAssignment) {
  return {
    id: a.id || nanoid(),
    employee_name: a.employeeName,
    notes: a.notes || '',
    role: a.role,
    rate_card: a.rateCard,
    is_si: a.isSI,
    is_contractor: a.isContractor,
    project: a.project,
    weekly_hours: a.weeklyHours || {},
    monthly_totals: a.monthlyTotals || emptyMonthRecord(),
    manually_edited: a._manuallyEdited || false,
    manually_added: a._manuallyAdded || false,
    original_key: a._originalKey || null,
    updated_by: CLIENT_ID,
    updated_at: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToAssignment(row: any): ForecastAssignment {
  return {
    id: row.id,
    employeeName: row.employee_name,
    notes: row.notes || '',
    role: row.role,
    rateCard: row.rate_card,
    isSI: row.is_si,
    isContractor: row.is_contractor,
    project: row.project,
    weeklyHours: row.weekly_hours || {},
    monthlyTotals: row.monthly_totals || emptyMonthRecord(),
    _manuallyEdited: row.manually_edited || false,
    _manuallyAdded: row.manually_added || false,
    _originalKey: row.original_key || undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pipelineRowToProject(row: any): ZohoPipelineProject {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    owner: row.owner,
    startDate: row.start_date,
    endDate: row.end_date,
    source: row.source || 'manual',
    zohoId: row.zoho_id || undefined,
    forecastName: row.forecast_name || undefined,
    goLiveDate: row.go_live_date || undefined,
    revenue: row.revenue,
    revenueCurrency: row.revenue_currency || 'USD',
    resources: row.resources || [],
    phases: row.phases || [],
  };
}

function projectToRow(p: ZohoPipelineProject) {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    owner: p.owner,
    start_date: p.startDate,
    end_date: p.endDate,
    source: p.source,
    zoho_id: p.zohoId || null,
    forecast_name: p.forecastName || null,
    go_live_date: p.goLiveDate || null,
    revenue: p.revenue || null,
    revenue_currency: p.revenueCurrency || 'USD',
    resources: p.resources || [],
    phases: p.phases || [],
    updated_by: CLIENT_ID,
    updated_at: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToActualHour(row: any): ActualHourEntry {
  return {
    id: String(row.id),
    employeeId: row.employee_id ?? '',
    employeeName: row.employee_name ?? '',
    email: row.email ?? null,
    project: row.project ?? null,
    workDate: row.work_date ?? '',
    hours: Number(row.hours ?? 0),
    billing: row.billing ?? null,
    notes: row.notes ?? null,
    source: row.source ?? 'zoho_people',
    syncedAt: row.synced_at ?? new Date().toISOString(),
  };
}

function actualHourToRow(e: ActualHourEntry) {
  return {
    id: e.id,
    employee_id: e.employeeId,
    employee_name: e.employeeName,
    email: e.email,
    project: e.project,
    work_date: e.workDate,
    hours: e.hours,
    billing: e.billing,
    notes: e.notes,
    synced_at: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToStaffingRequest(row: any): StaffingRequest {
  return {
    id: row.id,
    roleCategory: row.role_category,
    hoursPerMonth: row.hours_per_month,
    startMonth: row.start_month as Month,
    endMonth: row.end_month as Month,
    clientName: row.client_name,
  };
}

function staffingRequestToRow(r: StaffingRequest) {
  return {
    id: r.id,
    role_category: r.roleCategory,
    hours_per_month: r.hoursPerMonth,
    start_month: r.startMonth,
    end_month: r.endMonth,
    client_name: r.clientName,
    updated_by: CLIENT_ID,
  };
}

// ─── India Staffing converters ──────────────────────────────────────

function indiaAccountToRow(a: IndiaAccount) {
  return { id: a.id, name: a.name, created_at: a.created_at, updated_by: CLIENT_ID, updated_at: new Date().toISOString() };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToIndiaAccount(row: any): IndiaAccount {
  return { id: row.id, name: row.name, created_at: row.created_at };
}

function indiaReqToRow(r: IndiaRequisition) {
  return {
    id: r.id, account_id: r.account_id, title: r.title, month: r.month,
    new_positions: r.new_positions, expected_closure: r.expected_closure,
    start_date: r.start_date,
    close_by_date: r.close_by_date, status_field: r.status_field,
    stage: r.stage, anticipation: r.anticipation,
    client_spoc: r.client_spoc, department: r.department,
    probability: r.probability ?? 0,
    ai_probability: r.ai_probability ?? 0,
    created_at: r.created_at, updated_at: r.updated_at, updated_by: CLIENT_ID,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToIndiaReq(row: any): IndiaRequisition {
  return {
    id: row.id, account_id: row.account_id, title: row.title, month: row.month,
    new_positions: row.new_positions ?? 0, expected_closure: row.expected_closure ?? '',
    start_date: row.start_date ?? '',
    close_by_date: row.close_by_date ?? '', status_field: row.status_field ?? 'Open',
    stage: row.stage ?? 'Sourcing', anticipation: row.anticipation ?? '',
    client_spoc: row.client_spoc ?? '', department: row.department ?? '',
    probability: row.probability ?? 0,
    ai_probability: row.ai_probability ?? 0,
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

function candidateToRow(c: StaffingCandidate) {
  return {
    id: c.id,
    // Requisition is optional — empty string from the UI maps to null in the DB
    // so the candidate row is "unassigned" until a TA attaches it later.
    requisition_id: c.requisition_id ? c.requisition_id : null,
    name: c.name,
    experience: c.experience,
    stage: c.stage,
    submit_date: c.submit_date,
    feedback: c.feedback,
    source: c.source,
    email: c.email,
    phone: c.phone,
    owning_ta_email: c.owning_ta_email ?? null,
    location: c.location ?? null,
    linkedin_url: c.linkedin_url ?? null,
    resume_url: c.resume_url ?? null,
    resume_filename: c.resume_filename ?? null,
    resume_uploaded_at: c.resume_uploaded_at ?? null,
    skills: c.skills ?? [],
    profile_summary: c.profile_summary ?? null,
    parsed_at: c.parsed_at ?? null,
    referrer_email: c.referrer_email ?? null,
    referrer_name: c.referrer_name ?? null,
    referred_at: c.referred_at ?? null,
    availability: c.availability ?? [],
    expected_salary: c.expected_salary ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at,
    updated_by: CLIENT_ID,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToCandidate(row: any): StaffingCandidate {
  return {
    id: row.id,
    requisition_id: row.requisition_id ?? '',
    name: row.name,
    experience: row.experience ?? '',
    stage: row.stage ?? 'Submitted',
    submit_date: row.submit_date ?? '',
    feedback: row.feedback ?? '',
    source: row.source ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    owning_ta_email: row.owning_ta_email ?? undefined,
    location: row.location ?? undefined,
    linkedin_url: row.linkedin_url ?? undefined,
    resume_url: row.resume_url ?? undefined,
    resume_filename: row.resume_filename ?? undefined,
    resume_uploaded_at: row.resume_uploaded_at ?? undefined,
    skills: Array.isArray(row.skills) ? row.skills : [],
    profile_summary: row.profile_summary ?? undefined,
    parsed_at: row.parsed_at ?? undefined,
    referrer_email: row.referrer_email ?? undefined,
    referrer_name: row.referrer_name ?? undefined,
    referred_at: row.referred_at ?? undefined,
    availability: Array.isArray(row.availability) ? row.availability : [],
    expected_salary: row.expected_salary ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function historyToRow(h: StaffingHistoryEntry) {
  return {
    id: h.id,
    requisition_id: h.requisition_id,
    field: h.field,
    old_value: h.old_value,
    new_value: h.new_value,
    changed_at: h.changed_at,
    changed_by: h.changed_by,
    updated_by: CLIENT_ID,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToHistory(row: any): StaffingHistoryEntry {
  return {
    id: row.id,
    requisition_id: row.requisition_id,
    field: row.field,
    old_value: row.old_value ?? '',
    new_value: row.new_value ?? '',
    changed_at: row.changed_at,
    changed_by: row.changed_by ?? '',
  };
}

function dailyStatusToRow(s: DailyStatus) {
  return {
    id: s.id, requisition_id: s.requisition_id, status_date: s.status_date,
    status_text: s.status_text, anticipation: s.anticipation,
    created_at: s.created_at, updated_by: CLIENT_ID,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToDailyStatus(row: any): DailyStatus {
  return {
    id: row.id, requisition_id: row.requisition_id, status_date: row.status_date,
    status_text: row.status_text, anticipation: row.anticipation ?? '',
    created_at: row.created_at,
  };
}

// ─── Time entries converters ───────────────────────────────────────

function timeEntryToRow(e: TimeEntry) {
  return {
    id: e.id,
    employee_email: e.employeeEmail.toLowerCase(),
    work_date: e.workDate,
    project_id: e.projectId,
    project_name: e.projectName,
    hours: e.hours,
    billable: e.billable,
    notes: e.notes ?? '',
    source: e.source,
    status: e.status,
    submitted_at: e.submittedAt,
    approved_by: e.approvedBy,
    approved_at: e.approvedAt,
    reject_reason: e.rejectReason,
    updated_by: CLIENT_ID,
    updated_at: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTimeEntry(row: any): TimeEntry {
  return {
    id: row.id,
    employeeEmail: row.employee_email,
    workDate: row.work_date,
    projectId: row.project_id ?? null,
    projectName: row.project_name,
    hours: Number(row.hours ?? 0),
    billable: !!row.billable,
    notes: row.notes ?? '',
    source: (row.source ?? 'simpliigence') as TimeEntry['source'],
    status: (row.status ?? 'approved') as TimeEntry['status'],
    submittedAt: row.submitted_at ?? null,
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at ?? null,
    rejectReason: row.reject_reason ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── TA daily log + team_members converters ────────────────────────

function taLogToRow(e: TADailyLogEntry) {
  return {
    id: e.id,
    ta_email: e.taEmail,
    log_date: e.logDate,
    requisition_id: e.requisitionId,        // null for activity-type rows
    activity_type: e.activityType,          // null for requisition rows
    customer_name: e.customerName,          // free-text subject for activity rows
    minutes_spent: e.minutesSpent ?? 0,
    sourced_outreach: e.sourcedOutreach,
    screens_completed: e.screensCompleted,
    submissions_interviews: e.submissionsInterviews,
    notes: e.notes ?? '',
    daily_status_id: e.dailyStatusId,
    updated_by: CLIENT_ID,
    updated_at: new Date().toISOString(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTaLog(row: any): TADailyLogEntry {
  return {
    id: row.id,
    taEmail: row.ta_email,
    logDate: row.log_date,
    requisitionId: row.requisition_id ?? null,
    activityType: row.activity_type ?? null,
    customerName: row.customer_name ?? null,
    minutesSpent: Number(row.minutes_spent ?? 0),
    sourcedOutreach: Number(row.sourced_outreach ?? 0),
    screensCompleted: Number(row.screens_completed ?? 0),
    submissionsInterviews: Number(row.submissions_interviews ?? 0),
    notes: row.notes ?? '',
    dailyStatusId: row.daily_status_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function teamMemberToRow(m: TeamMember) {
  return {
    id: m.id,
    email: m.email,
    team: m.team,
    added_by: m.addedBy ?? CLIENT_ID,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTeamMember(row: any): TeamMember {
  return {
    id: row.id,
    email: row.email,
    team: row.team,
    addedBy: row.added_by ?? null,
    addedAt: row.added_at,
  };
}

// ─── US Staffing converters ────────────────────────────────────────

function usAccountToRow(a: USStaffingAccount) {
  return { id: a.id, name: a.name, category: a.category, created_at: a.created_at, updated_by: CLIENT_ID, updated_at: new Date().toISOString() };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUSAccount(row: any): USStaffingAccount {
  return { id: row.id, name: row.name, category: (row.category || 'SI') as AccountCategory, created_at: row.created_at };
}

function usReqToRow(r: USStaffingRequisition) {
  return {
    id: r.id, account_id: r.account_id, role: r.role,
    initiation_date: r.initiation_date, stage: r.stage,
    closure_date: r.closure_date, notes: r.notes,
    created_at: r.created_at, updated_at: r.updated_at, updated_by: CLIENT_ID,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUSReq(row: any): USStaffingRequisition {
  return {
    id: row.id, account_id: row.account_id, role: row.role,
    initiation_date: row.initiation_date ?? '', stage: row.stage ?? 'New',
    closure_date: row.closure_date ?? '', notes: row.notes ?? '',
    created_at: row.created_at, updated_at: row.updated_at,
  };
}

// ─── Data fetchers (used on app init) ──────────────────────────────

export async function fetchAssignments(): Promise<{ assignments: ForecastAssignment[]; weekDates: string[] } | null> {
  const [{ data: rows, error }, { data: meta }] = await Promise.all([
    supabase.from('forecast_assignments').select('*'),
    supabase.from('forecast_meta').select('*').eq('id', 'singleton').single(),
  ]);
  if (error) { console.warn('[supabase] fetch assignments failed:', error.message, error.code, error.details); return null; }
  return {
    assignments: (rows || []).map(rowToAssignment),
    weekDates: (meta?.week_dates as string[]) || [],
  };
}

export async function fetchFinancialSettings(): Promise<FinancialSettings | null> {
  const { data, error } = await supabase.from('financial_settings').select('*').eq('id', 'singleton').single();
  if (error || !data) return null;
  return {
    exchangeRate: data.exchange_rate ?? 83.5,
    cadToUsdRate: data.cad_to_usd_rate ?? 0.73,
    displayCurrency: data.display_currency ?? 'inr',
  };
}

export async function fetchSyncConfig() {
  const { data, error } = await supabase.from('sync_config').select('*').eq('id', 'singleton').single();
  if (error || !data) return null;
  return {
    oneDriveUrl: data.onedrive_url || '',
    sheetName: data.sheet_name || 'Forecasting Hrs',
    autoSyncOnLoad: data.auto_sync_on_load ?? true,
    lastSyncAt: data.last_sync_at,
    lastSyncStatus: data.last_sync_status || 'never',
    lastSyncError: data.last_sync_error,
    lastSyncRowCount: data.last_sync_row_count || 0,
    lastSyncMemberCount: data.last_sync_member_count || 0,
    lastSyncProjectCount: data.last_sync_project_count || 0,
  };
}

export async function fetchHiringForecastConfig() {
  const { data, error } = await supabase.from('hiring_forecast_config').select('*').eq('id', 'singleton').single();
  if (error || !data) return null;
  return {
    conciergeConfig: (data.concierge_config || {}) as ConciergeConfig,
    scenarioSettings: (data.scenario_settings || {}) as ScenarioSettings,
  };
}

export async function fetchStaffingRequests(): Promise<StaffingRequest[] | null> {
  const { data, error } = await supabase.from('staffing_requests').select('*');
  if (error) return null;
  return (data || []).map(rowToStaffingRequest);
}

export async function fetchPipelineProjects(): Promise<ZohoPipelineProject[] | null> {
  const { data, error } = await supabase.from('pipeline_projects').select('*');
  if (error) return null;
  return (data || []).map(pipelineRowToProject);
}

// ─── Account Management converters ─────────────────────────────────

function accountToRow(a: Account) {
  return {
    id: a.id,
    name: a.name,
    sales_owner_email: a.salesOwnerEmail?.toLowerCase() ?? null,
    delivery_owner_email: a.deliveryOwnerEmail?.toLowerCase() ?? null,
    status: a.status,
    industry: a.industry,
    notes: a.notes ?? '',
    updated_by: CLIENT_ID,
    updated_at: new Date().toISOString(),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAccount(row: any): Account {
  return {
    id: row.id, name: row.name,
    salesOwnerEmail: row.sales_owner_email ?? null,
    deliveryOwnerEmail: row.delivery_owner_email ?? null,
    status: row.status ?? 'active',
    industry: row.industry ?? null,
    notes: row.notes ?? '',
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
function accountConnectToRow(c: AccountConnect) {
  return {
    id: c.id, account_id: c.accountId, connect_type: c.connectType,
    meeting_date: c.meetingDate, attendees: c.attendees ?? '',
    discussion: c.discussion ?? '', outcome: c.outcome ?? '',
    created_by: c.createdBy ?? CLIENT_ID,
    updated_by: CLIENT_ID, updated_at: new Date().toISOString(),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAccountConnect(row: any): AccountConnect {
  return {
    id: row.id, accountId: row.account_id, connectType: row.connect_type,
    meetingDate: row.meeting_date,
    attendees: row.attendees ?? '', discussion: row.discussion ?? '', outcome: row.outcome ?? '',
    createdAt: row.created_at, updatedAt: row.updated_at,
    createdBy: row.created_by ?? null, updatedBy: row.updated_by ?? null,
  };
}
function accountActionToRow(a: AccountActionItem) {
  return {
    id: a.id, account_id: a.accountId, connect_id: a.connectId,
    title: a.title, description: a.description ?? '',
    owner_email: a.ownerEmail?.toLowerCase() ?? null,
    due_date: a.dueDate, status: a.status, completed_at: a.completedAt,
    updated_by: CLIENT_ID, updated_at: new Date().toISOString(),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAccountAction(row: any): AccountActionItem {
  return {
    id: row.id, accountId: row.account_id, connectId: row.connect_id ?? null,
    title: row.title, description: row.description ?? '',
    ownerEmail: row.owner_email ?? null, dueDate: row.due_date ?? null,
    status: row.status ?? 'open', completedAt: row.completed_at ?? null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function fetchAccountManagement(): Promise<{
  accounts: Account[]; connects: AccountConnect[]; actions: AccountActionItem[];
} | null> {
  const [accRes, conRes, actRes] = await Promise.all([
    supabase.from('accounts').select('*'),
    supabase.from('account_connects').select('*'),
    supabase.from('account_action_items').select('*'),
  ]);
  if (accRes.error) { console.warn('[supabase] fetch accounts failed:', accRes.error); return null; }
  return {
    accounts: (accRes.data || []).map(rowToAccount),
    connects: (conRes.data || []).map(rowToAccountConnect),
    actions: (actRes.data || []).map(rowToAccountAction),
  };
}

export async function fetchTimeEntries(): Promise<TimeEntry[] | null> {
  // RLS already restricts to (own + reports + admin/manager) so a plain select is fine.
  const { data, error } = await supabase
    .from('time_entries')
    .select('*')
    .order('work_date', { ascending: false });
  if (error) {
    console.warn('[supabase] fetch time_entries failed:', error);
    return null;
  }
  return (data || []).map(rowToTimeEntry);
}

export async function fetchTaDailyLog(): Promise<TADailyLogEntry[] | null> {
  const { data, error } = await supabase
    .from('ta_daily_log')
    .select('*')
    .order('log_date', { ascending: false });
  if (error) {
    console.warn('[supabase] fetch ta_daily_log failed:', error);
    return null;
  }
  return (data || []).map(rowToTaLog);
}

export async function fetchTeamMembers(): Promise<TeamMember[] | null> {
  const { data, error } = await supabase.from('team_members').select('*');
  if (error) {
    console.warn('[supabase] fetch team_members failed:', error);
    return null;
  }
  return (data || []).map(rowToTeamMember);
}

export async function fetchActualHours(): Promise<ActualHourEntry[] | null> {
  // unified_actual_hours UNIONs Zoho-synced rows with approved Simpliigence
  // time_entries (the source-of-truth for going-forward entry). Same columns
  // as the legacy actual_hours table plus a `source` tag.
  const { data, error } = await supabase.from('unified_actual_hours').select('*');
  if (error) {
    console.warn('[supabase] fetch unified_actual_hours failed:', error.message);
    // Fall back to legacy table if the view fails for any reason
    const fallback = await supabase.from('actual_hours').select('*');
    if (fallback.error) return null;
    return (fallback.data || []).map(rowToActualHour);
  }
  return (data || []).map(rowToActualHour);
}

// ─── India Staffing fetchers ──────────────────────────────────────

export async function fetchIndiaStaffing(): Promise<{
  accounts: IndiaAccount[];
  requisitions: IndiaRequisition[];
  statuses: DailyStatus[];
  history: StaffingHistoryEntry[];
  candidates: StaffingCandidate[];
} | null> {
  const [acctRes, reqRes, statusRes, histRes, candRes] = await Promise.all([
    supabase.from('india_staffing_accounts').select('*'),
    supabase.from('india_staffing_requisitions').select('*'),
    supabase.from('india_staffing_statuses').select('*'),
    supabase.from('india_staffing_history').select('*'),
    supabase.from('india_staffing_candidates').select('*'),
  ]);
  if (acctRes.error || reqRes.error || statusRes.error) {
    console.warn('[supabase] fetch india staffing failed:', acctRes.error?.message, reqRes.error?.message, statusRes.error?.message);
    return null;
  }
  if (histRes.error) {
    console.warn('[supabase] fetch india history failed (table may be missing):', histRes.error.message);
  }
  if (candRes.error) {
    console.warn('[supabase] fetch india candidates failed (table may be missing):', candRes.error.message);
  }
  return {
    accounts: (acctRes.data || []).map(rowToIndiaAccount),
    requisitions: (reqRes.data || []).map(rowToIndiaReq),
    statuses: (statusRes.data || []).map(rowToDailyStatus),
    history: (histRes.data || []).map(rowToHistory),
    candidates: (candRes.data || []).map(rowToCandidate),
  };
}

// ─── Open Bench converters ────────────────────────────────────────

function benchResourceToRow(r: BenchResource) {
  return {
    id: r.id,
    resource_name: r.resource_name,
    years_of_experience: r.years_of_experience,
    visa_category: r.visa_category,
    primary_skill: r.primary_skill,
    roles: r.roles,
    job_priority: r.job_priority,
    target_rate: r.target_rate,
    location: r.location,
    key_opportunities: r.key_opportunities,
    notes: r.notes,
    available: r.available,
    created_at: r.created_at,
    updated_at: r.updated_at,
    updated_by: CLIENT_ID,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToBenchResource(row: any): BenchResource {
  return {
    id: row.id,
    resource_name: row.resource_name ?? '',
    years_of_experience: row.years_of_experience ?? 0,
    visa_category: (row.visa_category ?? 'Other') as VisaCategory,
    primary_skill: row.primary_skill ?? '',
    roles: row.roles ?? '',
    job_priority: (row.job_priority ?? 'Primary') as JobPriority,
    target_rate: row.target_rate ?? 0,
    location: row.location ?? '',
    key_opportunities: row.key_opportunities ?? '',
    notes: row.notes ?? '',
    available: row.available ?? true,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function benchUpdateToRow(u: BenchUpdate) {
  return {
    id: u.id,
    resource_id: u.resource_id,
    update_date: u.update_date,
    update_text: u.update_text,
    type: u.type,
    client_or_role: u.client_or_role,
    recruiter: u.recruiter,
    created_at: u.created_at,
    updated_by: CLIENT_ID,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToBenchUpdate(row: any): BenchUpdate {
  return {
    id: row.id,
    resource_id: row.resource_id,
    update_date: row.update_date ?? '',
    update_text: row.update_text ?? '',
    type: (row.type ?? 'Note') as BenchUpdateType,
    client_or_role: row.client_or_role ?? '',
    recruiter: row.recruiter ?? '',
    created_at: row.created_at,
  };
}

// ─── India Roster converters ──────────────────────────────────────

function indiaRosterToRow(m: IndiaRosterMember) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    project: m.project,
    status: m.status,
    cost_per_hour: m.cost_per_hour,
    bill_rate: m.bill_rate,
    start_date: m.start_date,
    skills: m.skills,
    email: m.email,
    notes: m.notes,
    created_at: m.created_at,
    updated_at: m.updated_at,
    updated_by: CLIENT_ID,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToIndiaRoster(row: any): IndiaRosterMember {
  return {
    id: row.id,
    name: row.name ?? '',
    role: row.role ?? '',
    project: row.project ?? '',
    status: (row.status ?? 'Bench') as IndiaRosterStatus,
    cost_per_hour: row.cost_per_hour ?? 0,
    bill_rate: row.bill_rate ?? 0,
    start_date: row.start_date ?? '',
    skills: row.skills ?? '',
    email: row.email ?? '',
    notes: row.notes ?? '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── US Roster converters ─────────────────────────────────────────

function usRosterToRow(m: USRosterMember) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    project: m.project,
    status: m.status,
    visa_category: m.visa_category,
    cost_per_hour: m.cost_per_hour,
    bill_rate: m.bill_rate,
    start_date: m.start_date,
    skills: m.skills,
    location: m.location,
    email: m.email,
    notes: m.notes,
    created_at: m.created_at,
    updated_at: m.updated_at,
    updated_by: CLIENT_ID,
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToUSRoster(row: any): USRosterMember {
  return {
    id: row.id,
    name: row.name ?? '',
    role: row.role ?? '',
    project: row.project ?? '',
    status: (row.status ?? 'Bench') as USRosterStatus,
    visa_category: (row.visa_category ?? 'Other') as VisaCategory,
    cost_per_hour: row.cost_per_hour ?? 0,
    bill_rate: row.bill_rate ?? 0,
    start_date: row.start_date ?? '',
    skills: row.skills ?? '',
    location: row.location ?? '',
    email: row.email ?? '',
    notes: row.notes ?? '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── US Staffing fetchers ─────────────────────────────────────────

export async function fetchUSStaffing(): Promise<{ accounts: USStaffingAccount[]; requisitions: USStaffingRequisition[] } | null> {
  const [acctRes, reqRes] = await Promise.all([
    supabase.from('us_staffing_accounts').select('*'),
    supabase.from('us_staffing_requisitions').select('*'),
  ]);
  if (acctRes.error || reqRes.error) {
    console.warn('[supabase] fetch us staffing failed:', acctRes.error?.message, reqRes.error?.message);
    return null;
  }
  return {
    accounts: (acctRes.data || []).map(rowToUSAccount),
    requisitions: (reqRes.data || []).map(rowToUSReq),
  };
}

// ─── India Roster fetcher ─────────────────────────────────────────

export async function fetchIndiaRoster(): Promise<IndiaRosterMember[] | null> {
  const { data, error } = await supabase.from('india_roster').select('*');
  if (error) {
    console.warn('[supabase] fetch india_roster failed (table may be missing):', error.message);
    return null;
  }
  return (data || []).map(rowToIndiaRoster);
}

// ─── US Roster fetcher ────────────────────────────────────────────

export async function fetchUSRoster(): Promise<USRosterMember[] | null> {
  const { data, error } = await supabase.from('us_roster').select('*');
  if (error) {
    console.warn('[supabase] fetch us_roster failed (table may be missing):', error.message);
    return null;
  }
  return (data || []).map(rowToUSRoster);
}

// ─── Open Bench fetcher ──────────────────────────────────────────

export async function fetchOpenBench(): Promise<{ resources: BenchResource[]; updates: BenchUpdate[] } | null> {
  const [resRes, upRes] = await Promise.all([
    supabase.from('open_bench_resources').select('*'),
    supabase.from('open_bench_updates').select('*'),
  ]);
  if (resRes.error) {
    console.warn('[supabase] fetch open_bench_resources failed (table may be missing):', resRes.error.message);
    return null;
  }
  if (upRes.error) {
    console.warn('[supabase] fetch open_bench_updates failed (table may be missing):', upRes.error.message);
  }
  return {
    resources: (resRes.data || []).map(rowToBenchResource),
    updates: (upRes.data || []).map(rowToBenchUpdate),
  };
}

// ─── Writers (called by store actions) ─────────────────────────────

export const db = {
  // --- Assignments ---
  async upsertAssignment(a: ForecastAssignment) {
    const row = assignmentToRow(a);
    const { error } = await supabase.from('forecast_assignments').upsert(row, { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert assignment failed:', error);
  },

  async upsertAssignments(assignments: ForecastAssignment[]) {
    if (assignments.length === 0) return;
    const rows = assignments.map(assignmentToRow);
    const { error } = await supabase.from('forecast_assignments').upsert(rows, { onConflict: 'id' });
    if (error) console.warn('[supabase] bulk upsert assignments failed:', error);
  },

  async deleteAssignment(id: string) {
    const { error } = await supabase.from('forecast_assignments').delete().eq('id', id);
    if (error) console.warn('[supabase] delete assignment failed:', error);
  },

  async deleteAssignmentsByEmployee(employeeName: string) {
    const { error } = await supabase.from('forecast_assignments').delete().ilike('employee_name', employeeName);
    if (error) console.warn('[supabase] delete employee assignments failed:', error);
  },

  async deleteAllAssignments() {
    const { error } = await supabase.from('forecast_assignments').delete().neq('id', '');
    if (error) console.warn('[supabase] delete all assignments failed:', error);
  },

  async saveWeekDates(weekDates: string[]) {
    const { error } = await supabase.from('forecast_meta').upsert({
      id: 'singleton',
      week_dates: weekDates,
      updated_by: CLIENT_ID,
      updated_at: new Date().toISOString(),
    });
    if (error) console.warn('[supabase] save week dates failed:', error);
  },

  /** Full sync: replace all assignments in Supabase with the given list. */
  async replaceAllAssignments(assignments: ForecastAssignment[], weekDates: string[]) {
    // Delete all existing, then insert new
    await db.deleteAllAssignments();
    if (assignments.length > 0) {
      const rows = assignments.map(assignmentToRow);
      // Supabase has a limit of ~1000 rows per request, batch if needed
      const batchSize = 500;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const { error } = await supabase.from('forecast_assignments').insert(batch);
        if (error) console.warn('[supabase] batch insert assignments failed:', error);
      }
    }
    await db.saveWeekDates(weekDates);
  },

  // --- Financial ---
  async saveFinancialSettings(settings: FinancialSettings) {
    const { error } = await supabase.from('financial_settings').upsert({
      id: 'singleton',
      exchange_rate: settings.exchangeRate,
      cad_to_usd_rate: settings.cadToUsdRate,
      display_currency: settings.displayCurrency,
      updated_by: CLIENT_ID,
      updated_at: new Date().toISOString(),
    });
    if (error) console.warn('[supabase] save financial settings failed:', error);
  },

  // --- Sync Config ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async saveSyncConfig(config: Record<string, any>) {
    const { error } = await supabase.from('sync_config').upsert({
      id: 'singleton',
      onedrive_url: config.oneDriveUrl ?? config.onedrive_url,
      sheet_name: config.sheetName ?? config.sheet_name,
      auto_sync_on_load: config.autoSyncOnLoad ?? config.auto_sync_on_load,
      last_sync_at: config.lastSyncAt ?? config.last_sync_at,
      last_sync_status: config.lastSyncStatus ?? config.last_sync_status,
      last_sync_error: config.lastSyncError ?? config.last_sync_error,
      last_sync_row_count: config.lastSyncRowCount ?? config.last_sync_row_count,
      last_sync_member_count: config.lastSyncMemberCount ?? config.last_sync_member_count,
      last_sync_project_count: config.lastSyncProjectCount ?? config.last_sync_project_count,
      updated_by: CLIENT_ID,
      updated_at: new Date().toISOString(),
    });
    if (error) console.warn('[supabase] save sync config failed:', error);
  },

  // --- Hiring Forecast ---
  async saveHiringConfig(conciergeConfig: ConciergeConfig, scenarioSettings: ScenarioSettings) {
    const { error } = await supabase.from('hiring_forecast_config').upsert({
      id: 'singleton',
      concierge_config: conciergeConfig,
      scenario_settings: scenarioSettings,
      updated_by: CLIENT_ID,
      updated_at: new Date().toISOString(),
    });
    if (error) console.warn('[supabase] save hiring config failed:', error);
  },

  async insertStaffingRequest(r: StaffingRequest) {
    const { error } = await supabase.from('staffing_requests').insert(staffingRequestToRow(r));
    if (error) console.warn('[supabase] insert staffing request failed:', error);
  },

  async deleteStaffingRequest(id: string) {
    const { error } = await supabase.from('staffing_requests').delete().eq('id', id);
    if (error) console.warn('[supabase] delete staffing request failed:', error);
  },

  async deleteAllStaffingRequests() {
    const { error } = await supabase.from('staffing_requests').delete().neq('id', '');
    if (error) console.warn('[supabase] delete all staffing requests failed:', error);
  },

  // --- Pipeline ---
  async upsertPipelineProject(p: ZohoPipelineProject) {
    const { error } = await supabase.from('pipeline_projects').upsert(projectToRow(p), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert pipeline project failed:', error);
  },

  async upsertPipelineProjects(projects: ZohoPipelineProject[]) {
    if (projects.length === 0) return;
    const rows = projects.map(projectToRow);
    const { error } = await supabase.from('pipeline_projects').upsert(rows, { onConflict: 'id' });
    if (error) console.warn('[supabase] bulk upsert pipeline projects failed:', error);
  },

  async deletePipelineProject(id: string) {
    const { error } = await supabase.from('pipeline_projects').delete().eq('id', id);
    if (error) console.warn('[supabase] delete pipeline project failed:', error);
  },

  async replacePipelineProjects(projects: ZohoPipelineProject[]) {
    const { error: delErr } = await supabase.from('pipeline_projects').delete().neq('id', '');
    if (delErr) console.warn('[supabase] delete all pipeline projects failed:', delErr);
    if (projects.length > 0) {
      const rows = projects.map(projectToRow);
      const { error } = await supabase.from('pipeline_projects').insert(rows);
      if (error) console.warn('[supabase] batch insert pipeline projects failed:', error);
    }
  },

  // --- Actual Hours (Zoho People timesheets) ---
  async replaceAllActualHours(entries: ActualHourEntry[]) {
    const { error: delErr } = await supabase.from('actual_hours').delete().neq('id', '');
    if (delErr) console.warn('[supabase] delete all actual_hours failed:', delErr);
    if (entries.length === 0) return;
    // Chunk inserts to keep payload size reasonable.
    const CHUNK = 500;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK).map(actualHourToRow);
      const { error } = await supabase.from('actual_hours').insert(slice);
      if (error) console.warn('[supabase] batch insert actual_hours failed:', error);
    }
  },

  // --- India Staffing ---
  async upsertIndiaAccount(a: IndiaAccount) {
    const { error } = await supabase.from('india_staffing_accounts').upsert(indiaAccountToRow(a), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert india account failed:', error);
  },
  async deleteIndiaAccount(id: string) {
    await Promise.all([
      supabase.from('india_staffing_statuses').delete().in(
        'requisition_id',
        // subquery: get req ids for this account
        (await supabase.from('india_staffing_requisitions').select('id').eq('account_id', id)).data?.map((r) => r.id) || [],
      ),
      supabase.from('india_staffing_requisitions').delete().eq('account_id', id),
      supabase.from('india_staffing_accounts').delete().eq('id', id),
    ]);
  },
  async upsertIndiaRequisition(r: IndiaRequisition) {
    const { error } = await supabase.from('india_staffing_requisitions').upsert(indiaReqToRow(r), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert india req failed:', error);
  },
  async deleteIndiaRequisition(id: string) {
    await Promise.all([
      supabase.from('india_staffing_requisitions').delete().eq('id', id),
      supabase.from('india_staffing_statuses').delete().eq('requisition_id', id),
    ]);
  },
  async upsertIndiaStatus(s: DailyStatus) {
    const { error } = await supabase.from('india_staffing_statuses').upsert(dailyStatusToRow(s), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert india status failed:', error);
  },
  async deleteIndiaStatus(id: string) {
    const { error } = await supabase.from('india_staffing_statuses').delete().eq('id', id);
    if (error) console.warn('[supabase] delete india status failed:', error);
  },
  async insertIndiaHistory(entries: StaffingHistoryEntry[]) {
    if (!entries.length) return;
    const { error } = await supabase.from('india_staffing_history').insert(entries.map(historyToRow));
    if (error) console.warn('[supabase] insert india history failed:', error);
  },
  async upsertIndiaCandidate(c: StaffingCandidate) {
    const { error } = await supabase.from('india_staffing_candidates').upsert(candidateToRow(c), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert india candidate failed:', error);
  },
  async deleteIndiaCandidate(id: string) {
    const { error } = await supabase.from('india_staffing_candidates').delete().eq('id', id);
    if (error) console.warn('[supabase] delete india candidate failed:', error);
  },
  async replaceAllIndiaStaffing(accounts: IndiaAccount[], requisitions: IndiaRequisition[], statuses: DailyStatus[]) {
    await Promise.all([
      supabase.from('india_staffing_statuses').delete().neq('id', ''),
      supabase.from('india_staffing_requisitions').delete().neq('id', ''),
      supabase.from('india_staffing_accounts').delete().neq('id', ''),
    ]);
    if (accounts.length) await supabase.from('india_staffing_accounts').insert(accounts.map(indiaAccountToRow));
    if (requisitions.length) await supabase.from('india_staffing_requisitions').insert(requisitions.map(indiaReqToRow));
    if (statuses.length) await supabase.from('india_staffing_statuses').insert(statuses.map(dailyStatusToRow));
  },

  // --- US Staffing ---
  async upsertUSAccount(a: USStaffingAccount) {
    const { error } = await supabase.from('us_staffing_accounts').upsert(usAccountToRow(a), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert us account failed:', error);
  },
  async deleteUSAccount(id: string) {
    await Promise.all([
      supabase.from('us_staffing_accounts').delete().eq('id', id),
      supabase.from('us_staffing_requisitions').delete().eq('account_id', id),
    ]);
  },
  async upsertUSRequisition(r: USStaffingRequisition) {
    const { error } = await supabase.from('us_staffing_requisitions').upsert(usReqToRow(r), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert us req failed:', error);
  },
  async deleteUSRequisition(id: string) {
    const { error } = await supabase.from('us_staffing_requisitions').delete().eq('id', id);
    if (error) console.warn('[supabase] delete us req failed:', error);
  },
  async replaceAllUSStaffing(accounts: USStaffingAccount[], requisitions: USStaffingRequisition[]) {
    await Promise.all([
      supabase.from('us_staffing_requisitions').delete().neq('id', ''),
      supabase.from('us_staffing_accounts').delete().neq('id', ''),
    ]);
    if (accounts.length) await supabase.from('us_staffing_accounts').insert(accounts.map(usAccountToRow));
    if (requisitions.length) await supabase.from('us_staffing_requisitions').insert(requisitions.map(usReqToRow));
  },

  // --- Open Bench ---
  async upsertOpenBenchResource(r: BenchResource) {
    const { error } = await supabase.from('open_bench_resources').upsert(benchResourceToRow(r), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert open bench resource failed:', error);
  },
  async deleteOpenBenchResource(id: string) {
    await Promise.all([
      supabase.from('open_bench_updates').delete().eq('resource_id', id),
      supabase.from('open_bench_resources').delete().eq('id', id),
    ]);
  },
  async upsertOpenBenchUpdate(u: BenchUpdate) {
    const { error } = await supabase.from('open_bench_updates').upsert(benchUpdateToRow(u), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert open bench update failed:', error);
  },
  async deleteOpenBenchUpdate(id: string) {
    const { error } = await supabase.from('open_bench_updates').delete().eq('id', id);
    if (error) console.warn('[supabase] delete open bench update failed:', error);
  },
  async replaceAllOpenBench(resources: BenchResource[], updates: BenchUpdate[]) {
    await Promise.all([
      supabase.from('open_bench_updates').delete().neq('id', ''),
      supabase.from('open_bench_resources').delete().neq('id', ''),
    ]);
    if (resources.length) await supabase.from('open_bench_resources').insert(resources.map(benchResourceToRow));
    if (updates.length) await supabase.from('open_bench_updates').insert(updates.map(benchUpdateToRow));
  },

  // --- India Roster ---
  async upsertIndiaRosterMember(m: IndiaRosterMember) {
    const { error } = await supabase.from('india_roster').upsert(indiaRosterToRow(m), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert india_roster failed:', error);
  },
  async deleteIndiaRosterMember(id: string) {
    const { error } = await supabase.from('india_roster').delete().eq('id', id);
    if (error) console.warn('[supabase] delete india_roster failed:', error);
  },
  async replaceAllIndiaRoster(members: IndiaRosterMember[]) {
    await supabase.from('india_roster').delete().neq('id', '');
    if (members.length) await supabase.from('india_roster').insert(members.map(indiaRosterToRow));
  },

  // --- US Roster ---
  async upsertUSRosterMember(m: USRosterMember) {
    const { error } = await supabase.from('us_roster').upsert(usRosterToRow(m), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert us_roster failed:', error);
  },
  async deleteUSRosterMember(id: string) {
    const { error } = await supabase.from('us_roster').delete().eq('id', id);
    if (error) console.warn('[supabase] delete us_roster failed:', error);
  },
  async replaceAllUSRoster(members: USRosterMember[]) {
    await supabase.from('us_roster').delete().neq('id', '');
    if (members.length) await supabase.from('us_roster').insert(members.map(usRosterToRow));
  },

  // --- Account Management ---
  async upsertAccount(a: Account) {
    const { error } = await supabase.from('accounts').upsert(accountToRow(a), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert account failed:', error);
  },
  async deleteAccount(id: string) {
    const { error } = await supabase.from('accounts').delete().eq('id', id);
    if (error) console.warn('[supabase] delete account failed:', error);
  },
  async upsertAccountConnect(c: AccountConnect) {
    const { error } = await supabase.from('account_connects').upsert(accountConnectToRow(c), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert account_connect failed:', error);
  },
  async deleteAccountConnect(id: string) {
    const { error } = await supabase.from('account_connects').delete().eq('id', id);
    if (error) console.warn('[supabase] delete account_connect failed:', error);
  },
  async upsertAccountAction(a: AccountActionItem) {
    const { error } = await supabase.from('account_action_items').upsert(accountActionToRow(a), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert account_action failed:', error);
  },
  async deleteAccountAction(id: string) {
    const { error } = await supabase.from('account_action_items').delete().eq('id', id);
    if (error) console.warn('[supabase] delete account_action failed:', error);
  },

  // --- Time entries ---
  async upsertTimeEntry(e: TimeEntry) {
    const { error } = await supabase.from('time_entries').upsert(timeEntryToRow(e), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert time_entry failed:', error);
  },
  async deleteTimeEntry(id: string) {
    const { error } = await supabase.from('time_entries').delete().eq('id', id);
    if (error) console.warn('[supabase] delete time_entry failed:', error);
  },

  // --- User avatars (Supabase Storage: user-avatars bucket) ---
  /** Upload an avatar image and return the storage object path. */
  async uploadUserAvatar(email: string, file: File): Promise<{ path: string } | { error: string }> {
    const safeEmail = email.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${safeEmail}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('user-avatars')
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (error) {
      console.warn('[supabase] upload avatar failed:', error);
      return { error: error.message };
    }
    return { path };
  },

  /** Public URL for an avatar storage path. */
  publicAvatarUrl(path: string): string | null {
    const { data } = supabase.storage.from('user-avatars').getPublicUrl(path);
    return data?.publicUrl || null;
  },

  /** Update an authorized_users row's avatar_url. */
  async setUserAvatar(email: string, avatarUrl: string | null) {
    const { error } = await supabase
      .from('authorized_users')
      .update({ avatar_url: avatarUrl })
      .eq('email', email.trim().toLowerCase());
    if (error) console.warn('[supabase] setUserAvatar failed:', error);
  },

  // --- Profile Format (format-resume edge function) ---
  /** Invoke format-resume. Pass exactly one of pdfBase64 / resumeText / priorDraft.
   *  Optionally attach `targetFormatPdfBase64` to make Claude match that layout
   *  instead of the default Simpliigence template. */
  async formatResume(input: {
    pdfBase64?: string;
    resumeText?: string;
    priorDraft?: string;
    targetFormatPdfBase64?: string;
    instructions?: string;
  }): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
    const { data, error } = await supabase.functions.invoke<{
      ok?: boolean;
      markdown?: string;
      error?: string;
      detail?: string;
    }>('format-resume', { body: input });
    if (error) return { ok: false, error: error.message };
    if (data?.error) return { ok: false, error: `${data.error}${data.detail ? ` — ${data.detail}` : ''}` };
    return { ok: true, markdown: data?.markdown || '' };
  },

  // --- Candidate resumes (Supabase Storage + parse-resume edge function) ---
  /** Upload a resume file to storage and return the object path stored on the candidate row. */
  async uploadCandidateResume(candidateId: string, file: File): Promise<{ path: string; filename: string } | { error: string }> {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    const path = `${candidateId}/${Date.now()}-${safeName}`;
    const { error } = await supabase.storage
      .from('candidate-resumes')
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (error) {
      console.warn('[supabase] upload resume failed:', error);
      return { error: error.message };
    }
    return { path, filename: file.name };
  },

  /** Get a temporary download URL for a stored resume. */
  async signedResumeUrl(path: string, ttlSeconds = 300): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from('candidate-resumes')
      .createSignedUrl(path, ttlSeconds);
    if (error) {
      console.warn('[supabase] signed url failed:', error);
      return null;
    }
    return data?.signedUrl || null;
  },

  /** Invoke the parse-resume edge function. Returns the parsed skills + summary. */
  async parseCandidateResume(candidateId: string): Promise<
    | {
        ok: true;
        skills: string[];
        summary: string;
        parsedAt: string;
        firstName?: string;
        lastName?: string;
        fullName?: string;
        email?: string;
        phone?: string;
        linkedinUrl?: string;
        currentTitle?: string;
        location?: string;
        yearsExperience?: number;
      }
    | { ok: false; error: string }
  > {
    const { data, error } = await supabase.functions.invoke<{
      ok?: boolean;
      skills?: string[];
      summary?: string;
      parsedAt?: string;
      firstName?: string;
      lastName?: string;
      fullName?: string;
      email?: string;
      phone?: string;
      linkedinUrl?: string;
      currentTitle?: string;
      location?: string;
      yearsExperience?: number;
      error?: string;
      detail?: string;
    }>('parse-resume', { body: { candidateId } });
    if (error) return { ok: false, error: error.message };
    if (data?.error) return { ok: false, error: `${data.error}${data.detail ? ` — ${data.detail}` : ''}` };
    return {
      ok: true,
      skills: data?.skills || [],
      summary: data?.summary || '',
      parsedAt: data?.parsedAt || new Date().toISOString(),
      firstName: data?.firstName,
      lastName: data?.lastName,
      fullName: data?.fullName,
      email: data?.email,
      phone: data?.phone,
      linkedinUrl: data?.linkedinUrl,
      currentTitle: data?.currentTitle,
      location: data?.location,
      yearsExperience: data?.yearsExperience,
    };
  },

  /** Invoke the candidate-search edge function. Semantic Claude match across
   *  name + skills + summary + stage + source. */
  async searchCandidates(query: string): Promise<
    | { ok: true; matchedIds: string[]; explanation: string; totalScanned: number }
    | { ok: false; error: string }
  > {
    const { data, error } = await supabase.functions.invoke<{
      ok?: boolean;
      matchedIds?: string[];
      explanation?: string;
      totalScanned?: number;
      error?: string;
      detail?: string;
    }>('candidate-search', { body: { query } });
    if (error) return { ok: false, error: error.message };
    if (data?.error) return { ok: false, error: `${data.error}${data.detail ? ` — ${data.detail}` : ''}` };
    return {
      ok: true,
      matchedIds: data?.matchedIds || [],
      explanation: data?.explanation || '',
      totalScanned: data?.totalScanned || 0,
    };
  },

  /** Invoke the generate-jd edge function. By default returns the cached JD
   *  on the requisition if one exists; pass regenerate=true to force a fresh
   *  Claude call (the new JD is written back to the row). */
  async generateJobDescription(requisitionId: string, regenerate = false): Promise<
    | { ok: true; jobDescription: string; generatedAt: string; cached: boolean }
    | { ok: false; error: string }
  > {
    const { data, error } = await supabase.functions.invoke<{
      ok?: boolean;
      jobDescription?: string;
      generatedAt?: string;
      cached?: boolean;
      error?: string;
      detail?: string;
    }>('generate-jd', { body: { requisitionId, regenerate } });
    if (error) return { ok: false, error: error.message };
    if (data?.error) return { ok: false, error: `${data.error}${data.detail ? ` — ${data.detail}` : ''}` };
    return {
      ok: true,
      jobDescription: data?.jobDescription || '',
      generatedAt: data?.generatedAt || new Date().toISOString(),
      cached: !!data?.cached,
    };
  },

  /** Persist a manually edited JD back to the requisition. */
  async saveJobDescription(requisitionId: string, jd: string): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase
      .from('india_staffing_requisitions')
      .update({
        job_description: jd,
        job_description_at: new Date().toISOString(),
        updated_by: CLIENT_ID,
      })
      .eq('id', requisitionId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  // --- TA Daily Log ---
  async upsertTaLog(e: TADailyLogEntry) {
    const { error } = await supabase.from('ta_daily_log').upsert(taLogToRow(e), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert ta_daily_log failed:', error);
  },
  async deleteTaLog(id: string) {
    const { error } = await supabase.from('ta_daily_log').delete().eq('id', id);
    if (error) console.warn('[supabase] delete ta_daily_log failed:', error);
  },

  // --- Team members ---
  async upsertTeamMember(m: TeamMember) {
    const { error } = await supabase.from('team_members').upsert(teamMemberToRow(m), { onConflict: 'id' });
    if (error) console.warn('[supabase] upsert team_member failed:', error);
  },
  async deleteTeamMember(id: string) {
    const { error } = await supabase.from('team_members').delete().eq('id', id);
    if (error) console.warn('[supabase] delete team_member failed:', error);
  },

  /** Clear all tables (for Settings → Clear All Data). */
  async clearAll() {
    await Promise.all([
      supabase.from('forecast_assignments').delete().neq('id', ''),
      supabase.from('forecast_meta').upsert({ id: 'singleton', week_dates: [], updated_by: CLIENT_ID }),
      supabase.from('financial_settings').upsert({
        id: 'singleton', exchange_rate: 83.5, cad_to_usd_rate: 0.73, display_currency: 'inr', updated_by: CLIENT_ID,
      }),
      supabase.from('sync_config').upsert({
        id: 'singleton', onedrive_url: '', sheet_name: 'Forecasting Hrs', auto_sync_on_load: true,
        last_sync_at: null, last_sync_status: 'never', last_sync_error: null,
        last_sync_row_count: 0, last_sync_member_count: 0, last_sync_project_count: 0,
        updated_by: CLIENT_ID,
      }),
      supabase.from('hiring_forecast_config').upsert({
        id: 'singleton', concierge_config: {}, scenario_settings: {}, updated_by: CLIENT_ID,
      }),
      supabase.from('staffing_requests').delete().neq('id', ''),
      supabase.from('pipeline_projects').delete().neq('id', ''),
      supabase.from('india_staffing_candidates').delete().neq('id', ''),
      supabase.from('india_staffing_history').delete().neq('id', ''),
      supabase.from('india_staffing_statuses').delete().neq('id', ''),
      supabase.from('india_staffing_requisitions').delete().neq('id', ''),
      supabase.from('india_staffing_accounts').delete().neq('id', ''),
      supabase.from('us_staffing_requisitions').delete().neq('id', ''),
      supabase.from('us_staffing_accounts').delete().neq('id', ''),
      supabase.from('open_bench_updates').delete().neq('id', ''),
      supabase.from('open_bench_resources').delete().neq('id', ''),
      supabase.from('india_roster').delete().neq('id', ''),
      supabase.from('us_roster').delete().neq('id', ''),
      supabase.from('ta_daily_log').delete().neq('id', ''),
      supabase.from('team_members').delete().neq('id', ''),
      supabase.from('time_entries').delete().neq('id', ''),
      supabase.from('time_entry_periods').delete().neq('id', ''),
      supabase.from('account_action_items').delete().neq('id', ''),
      supabase.from('account_connects').delete().neq('id', ''),
      supabase.from('accounts').delete().neq('id', ''),
    ]);
  },
};

// ─── Realtime subscriptions ────────────────────────────────────────

type StoreSetters = {
  setForecastState: (assignments: ForecastAssignment[], weekDates?: string[]) => void;
  setFinancialSettings: (s: FinancialSettings) => void;
  setSyncConfig: (c: Record<string, unknown>) => void;
  setHiringConfig: (concierge: ConciergeConfig, scenario: ScenarioSettings, requests: StaffingRequest[]) => void;
  setPipelineProjects: (p: ZohoPipelineProject[]) => void;
  setIndiaStaffing: (accounts: IndiaAccount[], requisitions: IndiaRequisition[], statuses: DailyStatus[], history?: StaffingHistoryEntry[], candidates?: StaffingCandidate[]) => void;
  setUSStaffing: (accounts: USStaffingAccount[], requisitions: USStaffingRequisition[]) => void;
  setOpenBench: (resources: BenchResource[], updates: BenchUpdate[]) => void;
  setIndiaRoster: (members: IndiaRosterMember[]) => void;
  setUSRoster: (members: USRosterMember[]) => void;
  setTaDailyLog?: (entries: TADailyLogEntry[]) => void;
  setTeamMembers?: (members: TeamMember[]) => void;
  setTimeEntries?: (entries: TimeEntry[]) => void;
  setActualHours?: (rows: ActualHourEntry[]) => void;
  setAccountManagement?: (data: { accounts: Account[]; connects: AccountConnect[]; actions: AccountActionItem[] }) => void;
  getForecastAssignments: () => ForecastAssignment[];
  getStaffingRequests: () => StaffingRequest[];
  getPipelineProjects: () => ZohoPipelineProject[];
};

export function setupRealtimeSubscriptions(setters: StoreSetters) {
  // Use unique channel name to avoid conflicts on React StrictMode re-renders
  const channel = supabase.channel(`db-sync-${nanoid(6)}`);

  // --- Forecast assignments ---
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'forecast_assignments' },
    (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (payload.new || payload.old) as any;
      if (row?.updated_by === CLIENT_ID) return; // Skip own changes

      const current = setters.getForecastAssignments();
      if (payload.eventType === 'INSERT') {
        const a = rowToAssignment(payload.new);
        if (!current.find((x) => x.id === a.id)) {
          setters.setForecastState([...current, a]);
        }
      } else if (payload.eventType === 'UPDATE') {
        const a = rowToAssignment(payload.new);
        setters.setForecastState(current.map((x) => (x.id === a.id ? a : x)));
      } else if (payload.eventType === 'DELETE') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const oldRow = payload.old as any;
        if (oldRow?.id) {
          setters.setForecastState(current.filter((x) => x.id !== oldRow.id));
        }
      }
    },
  );

  // --- Forecast meta ---
  channel.on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'forecast_meta' },
    (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = payload.new as any;
      if (row?.updated_by === CLIENT_ID) return;
      setters.setForecastState(setters.getForecastAssignments(), row.week_dates || []);
    },
  );

  // --- Financial settings ---
  channel.on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'financial_settings' },
    (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = payload.new as any;
      if (row?.updated_by === CLIENT_ID) return;
      setters.setFinancialSettings({
        exchangeRate: row.exchange_rate ?? 83.5,
        cadToUsdRate: row.cad_to_usd_rate ?? 0.73,
        displayCurrency: row.display_currency ?? 'inr',
      });
    },
  );

  // --- Sync config ---
  channel.on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'sync_config' },
    (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = payload.new as any;
      if (row?.updated_by === CLIENT_ID) return;
      setters.setSyncConfig({
        oneDriveUrl: row.onedrive_url || '',
        sheetName: row.sheet_name || 'Forecasting Hrs',
        autoSyncOnLoad: row.auto_sync_on_load ?? true,
        lastSyncAt: row.last_sync_at,
        lastSyncStatus: row.last_sync_status || 'never',
        lastSyncError: row.last_sync_error,
        lastSyncRowCount: row.last_sync_row_count || 0,
        lastSyncMemberCount: row.last_sync_member_count || 0,
        lastSyncProjectCount: row.last_sync_project_count || 0,
      });
    },
  );

  // --- Hiring config ---
  channel.on(
    'postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'hiring_forecast_config' },
    (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = payload.new as any;
      if (row?.updated_by === CLIENT_ID) return;
      setters.setHiringConfig(
        row.concierge_config || {},
        row.scenario_settings || {},
        setters.getStaffingRequests(),
      );
    },
  );

  // --- Staffing requests ---
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'staffing_requests' },
    (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (payload.new || payload.old) as any;
      if (row?.updated_by === CLIENT_ID) return;
      // Refetch all staffing requests (simpler than diffing)
      fetchStaffingRequests().then((requests) => {
        if (requests) {
          const { conciergeConfig, scenarioSettings } = getHiringConfigFromStore();
          setters.setHiringConfig(conciergeConfig, scenarioSettings, requests);
        }
      });
    },
  );

  // --- Pipeline projects ---
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'pipeline_projects' },
    (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (payload.new || payload.old) as any;
      if (row?.updated_by === CLIENT_ID) return;
      const current = setters.getPipelineProjects();
      if (payload.eventType === 'INSERT') {
        const p = pipelineRowToProject(payload.new);
        if (!current.find((x) => x.id === p.id)) {
          setters.setPipelineProjects([...current, p]);
        }
      } else if (payload.eventType === 'UPDATE') {
        const p = pipelineRowToProject(payload.new);
        setters.setPipelineProjects(current.map((x) => (x.id === p.id ? p : x)));
      } else if (payload.eventType === 'DELETE') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const oldRow = payload.old as any;
        if (oldRow?.id) {
          setters.setPipelineProjects(current.filter((x) => x.id !== oldRow.id));
        }
      }
    },
  );

  // --- India Staffing (refetch all on any change) ---
  for (const table of ['india_staffing_accounts', 'india_staffing_requisitions', 'india_staffing_statuses', 'india_staffing_history', 'india_staffing_candidates'] as const) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = (payload.new || payload.old) as any;
        if (row?.updated_by === CLIENT_ID) return;
        fetchIndiaStaffing().then((data) => {
          if (data) setters.setIndiaStaffing(data.accounts, data.requisitions, data.statuses, data.history, data.candidates);
        });
      },
    );
  }

  // --- US Staffing (refetch all on any change) ---
  for (const table of ['us_staffing_accounts', 'us_staffing_requisitions'] as const) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = (payload.new || payload.old) as any;
        if (row?.updated_by === CLIENT_ID) return;
        fetchUSStaffing().then((data) => {
          if (data) setters.setUSStaffing(data.accounts, data.requisitions);
        });
      },
    );
  }

  // --- Open Bench (refetch on any change) ---
  for (const table of ['open_bench_resources', 'open_bench_updates'] as const) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = (payload.new || payload.old) as any;
        if (row?.updated_by === CLIENT_ID) return;
        fetchOpenBench().then((data) => {
          if (data) setters.setOpenBench(data.resources, data.updates);
        });
      },
    );
  }

  // --- India Roster ---
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'india_roster' },
    (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (payload.new || payload.old) as any;
      if (row?.updated_by === CLIENT_ID) return;
      fetchIndiaRoster().then((members) => {
        if (members) setters.setIndiaRoster(members);
      });
    },
  );

  // --- US Roster ---
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'us_roster' },
    (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (payload.new || payload.old) as any;
      if (row?.updated_by === CLIENT_ID) return;
      fetchUSRoster().then((members) => {
        if (members) setters.setUSRoster(members);
      });
    },
  );

  // --- Time entries (refetch on any change) ---
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'time_entries' },
    (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (payload.new || payload.old) as any;
      if (row?.updated_by === CLIENT_ID) return;
      if (setters.setTimeEntries) {
        fetchTimeEntries().then((entries) => {
          if (entries) setters.setTimeEntries!(entries);
        });
      }
      // Also refresh the unified actual_hours feed so the cockpit picks up
      // approved/submitted time_entries rows without a page reload.
      fetchActualHours().then((rows) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const set = (setters as any).setActualHours as ((rows: ActualHourEntry[]) => void) | undefined;
        if (set && rows) set(rows);
      });
    },
  );

  // --- TA Daily Log (refetch on any change) ---
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'ta_daily_log' },
    (payload) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (payload.new || payload.old) as any;
      if (row?.updated_by === CLIENT_ID) return;
      if (!setters.setTaDailyLog) return;
      fetchTaDailyLog().then((entries) => {
        if (entries) setters.setTaDailyLog!(entries);
      });
    },
  );

  // --- Team Members (refetch on any change) ---
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'team_members' },
    () => {
      if (!setters.setTeamMembers) return;
      fetchTeamMembers().then((members) => {
        if (members) setters.setTeamMembers!(members);
      });
    },
  );

  // --- Account Management: any change to accounts / connects / action_items → refetch the bundle.
  for (const table of ['accounts', 'account_connects', 'account_action_items'] as const) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const row = (payload.new || payload.old) as any;
        if (row?.updated_by === CLIENT_ID) return;
        if (!setters.setAccountManagement) return;
        fetchAccountManagement().then((data) => {
          if (data) setters.setAccountManagement!(data);
        });
      },
    );
  }

  channel.subscribe();
  return () => { supabase.removeChannel(channel); };
}

// Helper: read hiring config from the store (avoids circular import)
let _getHiringConfig: () => { conciergeConfig: ConciergeConfig; scenarioSettings: ScenarioSettings } = () => ({
  conciergeConfig: { monthlyHours: { BA: {} as Record<Month, number>, JuniorDev: {} as Record<Month, number>, SeniorDev: {} as Record<Month, number> } },
  scenarioSettings: { targetUtilization: 80, forecastStartMonth: 'Mar' as Month, forecastEndMonth: 'Dec' as Month },
});

export function registerHiringConfigGetter(fn: typeof _getHiringConfig) {
  _getHiringConfig = fn;
}

function getHiringConfigFromStore() {
  return _getHiringConfig();
}
