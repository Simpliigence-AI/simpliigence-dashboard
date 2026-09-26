/**
 * Delivery Home + project calendar — data access.
 *
 * Everything the home page flags is computed in SQL (migration 040):
 *   v_delivery_home_projects  one row per current project, every signal
 *   v_delivery_pod_util       pod booking % per month touching the next 60 days
 *   delivery_calendar_events  Outlook invites read by the delivery-calendar edge function
 * so the numbers here match whatever a query in the database says.
 */
import { supabase } from './supabase';

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface HomeProject {
  pipelineId: string;
  planId: string | null;
  name: string;
  client: string;
  owner: string | null;
  status: string;
  health: string | null;
  startDate: string | null;
  endDate: string | null;
  goLive: string | null;
  windowMonths: number;
  allocatedHours: number;
  teamSize: number;
  unstaffedMonths: string[];
  allocState: 'none' | 'gaps' | 'ok';
  nRequirements: number;
  nDesign: number;
  nUserStories: number;
  rdDonePerPlan: boolean;
  missingDocs: string[];
  docGap: boolean;
  recordings14d: number;
  lastRecordingAt: string | null;
  meetingsHeld14d: number;
  lastHeldAt: string | null;
  nextMeetingAt: string | null;
  upcoming14d: number;
  lastTouchAt: string | null;
  cadenceGap: boolean;
  openIssues: number;
  overdueIssues: number;
  unownedIssues: number;
  severeIssues: number;
  latePhases: number;
  lateTasks: number;
  slipDays: number;
  breachReasons: string[];
}

export interface PodMonth {
  pod: string;
  mon: string;
  monthLabel: string;
  members: number;
  capacity: number;
  hours: number;
  pct: number;
  projects: Array<{ project: string; hours: number }>;
}

export interface CalendarAttendee { email: string; name: string | null; response: string | null; type: string | null }

export interface CalendarEvent {
  id: string;
  subject: string;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  isCancelled: boolean;
  organizer: string | null;
  organizerName: string | null;
  attendees: CalendarAttendee[];
  mailboxes: string[];
  joinUrl: string | null;
  webLink: string | null;
  location: string | null;
  isExternal: boolean;
  projectId: string | null;
  matchSource: 'auto' | 'manual' | 'ignored' | null;
  matchReason: string | null;
}

export interface Mailbox { email: string; name: string | null; kind: 'core' | 'team'; active: boolean; lastSyncedAt: string | null; lastError: string | null; eventCount: number | null }

export interface OpenIssue {
  id: string; projectId: string; description: string; owner: string | null; dueDate: string | null;
  criticality: string; createdAt: string;
}

const num = (v: any) => (v == null ? 0 : Number(v));

const toProject = (r: any): HomeProject => ({
  pipelineId: r.pipeline_id, planId: r.plan_id ?? null, name: r.name, client: r.client, owner: r.owner ?? null,
  status: r.status ?? '', health: r.health ?? null, startDate: r.start_date ?? null, endDate: r.end_date ?? null, goLive: r.go_live ?? null,
  windowMonths: num(r.window_months), allocatedHours: num(r.allocated_hours), teamSize: num(r.team_size),
  unstaffedMonths: r.unstaffed_months ?? [], allocState: r.alloc_state,
  nRequirements: num(r.n_requirements), nDesign: num(r.n_design), nUserStories: num(r.n_user_stories),
  rdDonePerPlan: !!r.rd_done_per_plan, missingDocs: r.missing_docs ?? [], docGap: !!r.doc_gap,
  recordings14d: num(r.recordings_14d), lastRecordingAt: r.last_recording_at ?? null,
  meetingsHeld14d: num(r.meetings_held_14d), lastHeldAt: r.last_held_at ?? null,
  nextMeetingAt: r.next_meeting_at ?? null, upcoming14d: num(r.upcoming_14d), lastTouchAt: r.last_touch_at ?? null,
  cadenceGap: !!r.cadence_gap,
  openIssues: num(r.open_issues), overdueIssues: num(r.overdue_issues), unownedIssues: num(r.unowned_issues), severeIssues: num(r.severe_issues),
  latePhases: num(r.late_phases), lateTasks: num(r.late_tasks), slipDays: num(r.slip_days), breachReasons: r.breach_reasons ?? [],
});

export const toEvent = (r: any): CalendarEvent => ({
  id: r.id, subject: r.subject ?? '(no subject)', startAt: r.start_at, endAt: r.end_at, isAllDay: !!r.is_all_day,
  isCancelled: !!r.is_cancelled, organizer: r.organizer ?? null, organizerName: r.organizer_name ?? null,
  attendees: Array.isArray(r.attendees) ? r.attendees : [], mailboxes: r.mailboxes ?? [], joinUrl: r.join_url ?? null,
  webLink: r.web_link ?? null, location: r.location ?? null, isExternal: !!r.is_external, projectId: r.project_id ?? null,
  matchSource: r.match_source ?? null, matchReason: r.match_reason ?? null,
});

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? ([] as unknown as T));
}

export async function loadHomeProjects(): Promise<HomeProject[]> {
  const rows = check(await supabase.from('v_delivery_home_projects').select('*').order('name'));
  return (rows as any[]).map(toProject);
}

export async function loadPodUtil(): Promise<PodMonth[]> {
  const rows = check(await supabase.from('v_delivery_pod_util').select('*').order('pod').order('mon'));
  return (rows as any[]).map((r) => ({
    pod: r.pod, mon: r.mon, monthLabel: r.month_label, members: num(r.members), capacity: num(r.capacity),
    hours: num(r.hours), pct: num(r.pct), projects: Array.isArray(r.projects) ? r.projects : [],
  }));
}

export async function loadOpenIssues(): Promise<OpenIssue[]> {
  const rows = check(await supabase.from('delivery_issues').select('id, project_id, description, owner, due_date, criticality, created_at').eq('state', 'open').order('due_date', { nullsFirst: true }));
  return (rows as any[]).map((r) => ({ id: r.id, projectId: r.project_id, description: r.description, owner: r.owner ?? null, dueDate: r.due_date ?? null, criticality: r.criticality ?? 'medium', createdAt: r.created_at }));
}

/** Events from `from` (default: 30 days ago) up to 60 days ahead; optionally one project's. */
export async function loadEvents(opts: { projectId?: string; fromIso?: string } = {}): Promise<CalendarEvent[]> {
  const from = opts.fromIso ?? new Date(Date.now() - 30 * 86400_000).toISOString();
  let q = supabase.from('delivery_calendar_events').select('*').gte('start_at', from).order('start_at').limit(2000);
  if (opts.projectId) q = q.eq('project_id', opts.projectId);
  return (check(await q) as any[]).map(toEvent);
}

export async function loadMailboxes(): Promise<Mailbox[]> {
  const rows = check(await supabase.from('delivery_calendar_mailboxes').select('*').order('kind').order('name'));
  return (rows as any[]).map((r) => ({ email: r.email, name: r.name ?? null, kind: r.kind, active: !!r.active, lastSyncedAt: r.last_synced_at ?? null, lastError: r.last_error ?? null, eventCount: r.event_count ?? null }));
}

export async function tagEvent(eventId: string, projectId: string | null, ignore = false): Promise<void> {
  const { error } = await supabase.rpc('delivery_calendar_tag', { p_event_id: eventId, p_project_id: projectId, p_ignore: ignore });
  if (error) throw new Error(error.message);
}

export async function setCalendarKeywords(projectId: string, keywords: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('delivery_calendar_set_keywords', { p_project_id: projectId, p_keywords: keywords });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Pull calendars now. Throws with the edge function's own message (e.g. the Azure permission step). */
export async function syncCalendars(): Promise<{ mailboxes: number; events: number; errors: number }> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string; mailboxes: number; events: number; errors: number }>('delivery-calendar', { body: { action: 'sync' } });
  if (error || !data?.ok) {
    let msg = data?.error ?? error?.message ?? 'Calendar sync failed';
    const ctx = (error as any)?.context;
    if (ctx && typeof ctx.json === 'function') { try { msg = (await ctx.json()).error ?? msg; } catch { /* keep */ } }
    throw new Error(msg);
  }
  return data;
}

/** Direct link to the Azure app's API permissions blade (the app the Graph functions sign in as). */
export const AZURE_APP_PERMISSIONS_URL =
  'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/CallAnAPI/appId/58ec6b69-ad13-44f6-b656-b290dce6ce7d';

// ── Formatting ──────────────────────────────────────────────────────────

export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
export function fmtAgo(iso: string | null): string {
  if (!iso) return 'never';
  const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
}
export function fmtIn(iso: string | null): string {
  if (!iso) return 'none booked';
  const d = Math.floor((new Date(iso).getTime() - Date.now()) / 86400_000);
  if (d <= 0) return `today ${fmtTime(iso)}`;
  if (d === 1) return `tomorrow ${fmtTime(iso)}`;
  return `${fmtDay(iso)}`;
}
/** Local YYYY-MM-DD for grouping by day. */
export const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
