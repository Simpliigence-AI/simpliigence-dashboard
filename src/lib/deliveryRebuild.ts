/**
 * Data access for the Nov 2026 delivery rebuild (migration 048):
 * accounts + segments, suggested issues, weekly check-in status, client
 * portal administration and Concierge check-ins / issues.
 */
import { create } from 'zustand';
import { supabase } from './supabase';
import { useAuthStore } from '../store/useAuthStore';
import type { DeliveryAccount, DeliverySegment, ExtractedIssue, IssueCriticality } from '../types/delivery';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const SEGMENTS: { key: DeliverySegment; label: string; blurb: string }[] = [
  { key: 'strategic', label: 'Strategic Accounts', blurb: 'Programmes grouped by client account' },
  { key: 'smb', label: 'SMB', blurb: 'Small and mid-size implementations' },
  { key: 'placement', label: 'Strategic Placement', blurb: 'People placed with partner and client teams' },
];
export const SEGMENT_LABEL: Record<DeliverySegment, string> = { strategic: 'Strategic Accounts', smb: 'SMB', placement: 'Strategic Placement' };

const me = () => useAuthStore.getState().currentUser?.email ?? null;

/* ── Accounts ─────────────────────────────────────────────────────────── */

const toAccount = (r: any): DeliveryAccount => ({
  id: r.id, name: r.name, segment: r.segment, conciergeAccountId: r.concierge_account_id ?? null, sortOrder: r.sort_order ?? 100,
});

interface AccountsState {
  accounts: DeliveryAccount[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (a: { id?: string; name: string; segment: DeliverySegment }) => Promise<DeliveryAccount>;
  remove: (id: string) => Promise<void>;
}

export const useDeliveryAccounts = create<AccountsState>((set, get) => ({
  accounts: [],
  loaded: false,
  load: async () => {
    const { data, error } = await supabase.from('delivery_accounts').select('*').order('sort_order').order('name');
    if (error) throw new Error(error.message);
    set({ accounts: (data ?? []).map(toAccount), loaded: true });
  },
  save: async (a) => {
    const name = a.name.trim();
    if (!name) throw new Error('Account name can’t be empty.');
    const row = { name, segment: a.segment, updated_by: me(), updated_at: new Date().toISOString() };
    const q = a.id
      ? supabase.from('delivery_accounts').update(row).eq('id', a.id).select().single()
      : supabase.from('delivery_accounts').insert({ ...row, sort_order: 100 + get().accounts.length }).select().single();
    const { data, error } = await q;
    if (error || !data) throw new Error(error?.message ?? 'Save refused — you may only have view access.');
    const acc = toAccount(data);
    set((s) => ({ accounts: a.id ? s.accounts.map((x) => (x.id === acc.id ? acc : x)) : [...s.accounts, acc] }));
    return acc;
  },
  remove: async (id) => {
    const { error } = await supabase.from('delivery_accounts').delete().eq('id', id);
    if (error) throw new Error(error.message);
    set((s) => ({ accounts: s.accounts.filter((x) => x.id !== id) }));
  },
}));

/* ── Weekly check-ins ─────────────────────────────────────────────────── */

/** Friday of the week containing `d` (check-ins are week-ending Friday). */
export function fridayOf(d = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + ((5 - x.getDay() + 7) % 7));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function previousFriday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return fridayOf(d);
}

export type CheckinState = 'done' | 'due' | 'overdue' | 'na';
/** done: submitted this week · due: not yet, last week was done · overdue: last week was missed too. */
export function checkinState(lastSubmitted: string | null, active: boolean): CheckinState {
  if (!active) return 'na';
  const week = fridayOf();
  if (lastSubmitted && lastSubmitted >= week) return 'done';
  if (lastSubmitted && lastSubmitted >= previousFriday()) return 'due';
  return 'overdue';
}
export const CHECKIN_STYLE: Record<CheckinState, { label: string; cls: string }> = {
  done: { label: 'Done this week', cls: 'bg-emerald-500/12 text-emerald-600 ring-emerald-500/30' },
  due: { label: 'Due Friday', cls: 'bg-amber-500/12 text-amber-600 ring-amber-500/30' },
  overdue: { label: 'Overdue', cls: 'bg-rose-500/12 text-rose-600 ring-rose-500/30' },
  na: { label: '—', cls: 'bg-surface-2 text-muted ring-line' },
};

export function firstName(email: string | null | undefined): string {
  if (!email) return '—';
  const local = email.split('@')[0];
  const n = local.split(/[._-]/)[0];
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/* ── Suggested issues ─────────────────────────────────────────────────── */

const toExtracted = (r: any): ExtractedIssue => ({
  id: r.id, projectId: r.project_id ?? null, conciergeAccountId: r.concierge_account_id ?? null,
  description: r.description, criticality: r.criticality, ownerHint: r.owner_hint ?? null, dueHint: r.due_hint ?? null,
  source: r.source, sourceTitle: r.source_title ?? null, sourceFrom: r.source_from ?? null, sourceUrl: r.source_url ?? null,
  sourceExcerpt: r.source_excerpt ?? null, sourceAt: r.source_at ?? null, state: r.state, createdAt: r.created_at,
});

export async function loadSuggestions(target: { projectId?: string; conciergeAccountId?: string }): Promise<ExtractedIssue[]> {
  let q = supabase.from('extracted_issues').select('*').eq('state', 'suggested').order('source_at', { ascending: false });
  q = target.projectId ? q.eq('project_id', target.projectId) : q.eq('concierge_account_id', target.conciergeAccountId!);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(toExtracted);
}

export async function decideSuggestion(id: string, accept: boolean, criticality?: IssueCriticality): Promise<string | null> {
  const { data, error } = await supabase.rpc('extracted_issue_decide', { p_id: id, p_accept: accept, p_criticality: criticality ?? null, p_owner: null });
  if (error) throw new Error(error.message);
  return (data as string) ?? null;
}

export async function lastExtractionRun(): Promise<{ at: string; ok: boolean; error: string | null } | null> {
  const { data } = await supabase.from('extraction_runs').select('started_at, ok, error').order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  // A run that only ran out of time is not a failure — the next run carries on.
  let failed = false;
  try { failed = !!data.error && Object.keys(JSON.parse(data.error)).some((k) => k !== 'budget'); } catch { failed = !!data.error; }
  return { at: data.started_at, ok: !failed, error: data.error ?? null };
}

export async function runExtractionNow(): Promise<any> {
  const { data, error } = await supabase.functions.invoke('delivery-extract', { body: { action: 'run' } });
  if (error) throw new Error(error.message);
  return data;
}

export const SOURCE_LABEL: Record<string, string> = { email: 'Email', teams: 'Teams', slack: 'Slack', status_report: 'Status report', ticket: 'Ticket' };

/* ── Client portal administration ─────────────────────────────────────── */

export interface PortalUser {
  id: string;
  email: string;
  fullName: string | null;
  company: string | null;
  active: boolean;
  lastLoginAt: string | null;
  passwordSetAt: string | null;
  lockedUntil: string | null;
}
const toPortalUser = (r: any): PortalUser => ({
  id: r.id, email: r.email, fullName: r.full_name ?? null, company: r.company ?? null, active: !!r.active,
  lastLoginAt: r.last_login_at ?? null, passwordSetAt: r.password_set_at ?? null, lockedUntil: r.locked_until ?? null,
});
const PU_COLS = 'id,email,full_name,company,active,last_login_at,password_set_at,locked_until';

export const PORTAL_URL = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/portal`;

/** People who can open this project / concierge account on the portal. */
export async function loadPortalAccess(target: { projectId?: string; conciergeAccountId?: string }): Promise<PortalUser[]> {
  const col = target.projectId ? 'project_id' : 'concierge_account_id';
  const id = target.projectId ?? target.conciergeAccountId!;
  const { data, error } = await supabase.from('portal_grants').select(`user_id, portal_users(${PU_COLS})`).eq(col, id);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => toPortalUser(r.portal_users)).filter((u) => u.id);
}

export async function findPortalUser(email: string): Promise<PortalUser | null> {
  const { data } = await supabase.from('portal_users').select(PU_COLS).eq('email', email.trim().toLowerCase()).maybeSingle();
  return data ? toPortalUser(data) : null;
}

/** Strong, readable password: 4 groups of 4 from an unambiguous alphabet. */
export function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

/** Create (or reuse) the person, set a fresh password, grant access. Returns the password to hand over. */
export async function grantPortalAccess(
  target: { projectId?: string; conciergeAccountId?: string },
  person: { email: string; fullName: string; company: string },
): Promise<{ user: PortalUser; password: string | null }> {
  const email = person.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (email.endsWith('@simpliigence.com')) throw new Error('Simpliigence staff use the Delivery Cockpit, not the client portal.');
  let user = await findPortalUser(email);
  let password: string | null = null;
  if (!user) {
    const { error } = await supabase.from('portal_users').insert({ email, full_name: person.fullName.trim() || null, company: person.company.trim() || null, created_by: me() });
    if (error) throw new Error(error.message);
    user = await findPortalUser(email);
    if (!user) throw new Error('Could not create the portal login.');
    password = generatePassword();
    await setPortalPassword(user.id, password);
  }
  const row = target.projectId ? { user_id: user.id, project_id: target.projectId, created_by: me() } : { user_id: user.id, concierge_account_id: target.conciergeAccountId, created_by: me() };
  const { error } = await supabase.from('portal_grants').insert(row);
  if (error && !error.message.includes('duplicate')) throw new Error(error.message);
  return { user, password };
}

export async function setPortalPassword(userId: string, password: string) {
  const { error } = await supabase.rpc('portal_set_password', { p_user: userId, p_password: password });
  if (error) throw new Error(error.message);
}

export async function revokePortalAccess(target: { projectId?: string; conciergeAccountId?: string }, userId: string) {
  const col = target.projectId ? 'project_id' : 'concierge_account_id';
  const { error } = await supabase.from('portal_grants').delete().eq('user_id', userId).eq(col, target.projectId ?? target.conciergeAccountId!);
  if (error) throw new Error(error.message);
}

export async function setPortalUserActive(userId: string, active: boolean) {
  const { error } = await supabase.from('portal_users').update({ active }).eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function setDocumentSharing(docId: string, patch: { clientVisible?: boolean; clientDeliverable?: boolean }) {
  const db: Record<string, boolean> = {};
  if (patch.clientVisible !== undefined) db.client_visible = patch.clientVisible;
  if (patch.clientDeliverable !== undefined) { db.client_deliverable = patch.clientDeliverable; if (patch.clientDeliverable) db.client_visible = true; }
  const { error } = await supabase.from('delivery_documents').update(db).eq('id', docId);
  if (error) throw new Error(error.message);
}

export interface SharedDoc { id: string; name: string; docType: string | null; clientVisible: boolean; clientDeliverable: boolean; fromClient: string | null; at: string | null }
export async function loadProjectDocsForSharing(projectId: string): Promise<SharedDoc[]> {
  const { data, error } = await supabase.from('delivery_documents')
    .select('id,name,doc_type,client_visible,client_deliverable,uploaded_by_client,modified_at,created_at,storage_path,sp_item_id')
    .eq('project_id', projectId).order('modified_at', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []).filter((d: any) => d.storage_path || d.sp_item_id).map((d: any) => ({
    id: d.id, name: d.name, docType: d.doc_type, clientVisible: d.client_visible, clientDeliverable: d.client_deliverable,
    fromClient: d.uploaded_by_client ?? null, at: d.modified_at ?? d.created_at,
  }));
}

export async function portalActivity(target: { projectId?: string; conciergeAccountId?: string }) {
  const col = target.projectId ? 'project_id' : 'concierge_account_id';
  const { data } = await supabase.from('portal_events').select('kind, at, detail, portal_users(email)').eq(col, target.projectId ?? target.conciergeAccountId!).order('at', { ascending: false }).limit(15);
  return (data ?? []).map((r: any) => ({ kind: r.kind as string, at: r.at as string, who: r.portal_users?.email as string | undefined, detail: r.detail }));
}

/* ── Concierge check-ins and issues ───────────────────────────────────── */

export interface ConciergeCheckin {
  id: string; accountId: string; weekEnding: string; health: 'green' | 'amber' | 'red' | null;
  summary: string | null; risks: string | null; nextWeek: string | null; status: 'draft' | 'submitted';
  submittedBy: string | null; submittedAt: string | null;
}
const toCc = (r: any): ConciergeCheckin => ({
  id: r.id, accountId: r.account_id, weekEnding: r.week_ending, health: r.health ?? null, summary: r.summary ?? null,
  risks: r.risks ?? null, nextWeek: r.next_week ?? null, status: r.status, submittedBy: r.submitted_by ?? null, submittedAt: r.submitted_at ?? null,
});

export interface ConciergeIssue { id: string; accountId: string; description: string; owner: string | null; dueDate: string | null; criticality: IssueCriticality; state: 'open' | 'closed'; createdAt: string }
const toCi = (r: any): ConciergeIssue => ({ id: r.id, accountId: r.account_id, description: r.description, owner: r.owner ?? null, dueDate: r.due_date ?? null, criticality: r.criticality, state: r.state, createdAt: r.created_at });

export async function loadConciergeWeekly() {
  const since = new Date(); since.setDate(since.getDate() - 120);
  const [c, i, x] = await Promise.all([
    supabase.from('concierge_checkins').select('*').gte('week_ending', since.toISOString().slice(0, 10)).order('week_ending', { ascending: false }),
    supabase.from('concierge_issues').select('*').order('created_at', { ascending: false }),
    supabase.from('extracted_issues').select('*').eq('state', 'suggested').not('concierge_account_id', 'is', null).order('source_at', { ascending: false }),
  ]);
  const err = c.error || i.error || x.error;
  if (err) throw new Error(err.message);
  return { checkins: (c.data ?? []).map(toCc), issues: (i.data ?? []).map(toCi), suggestions: (x.data ?? []).map(toExtracted) };
}

export async function saveConciergeCheckin(accountId: string, patch: Partial<Pick<ConciergeCheckin, 'health' | 'summary' | 'risks' | 'nextWeek'>>, submit: boolean): Promise<ConciergeCheckin> {
  const week = fridayOf();
  const row: Record<string, unknown> = { account_id: accountId, week_ending: week, updated_at: new Date().toISOString() };
  if (patch.health !== undefined) row.health = patch.health;
  if (patch.summary !== undefined) row.summary = patch.summary;
  if (patch.risks !== undefined) row.risks = patch.risks;
  if (patch.nextWeek !== undefined) row.next_week = patch.nextWeek;
  if (submit) { row.status = 'submitted'; row.submitted_by = me(); row.submitted_at = new Date().toISOString(); }
  const { data, error } = await supabase.from('concierge_checkins').upsert(row, { onConflict: 'account_id,week_ending' }).select().single();
  if (error || !data) throw new Error(error?.message ?? 'Could not save the check-in');
  return toCc(data);
}

export async function addConciergeIssue(accountId: string, description: string, criticality: IssueCriticality, owner: string | null) {
  const { data, error } = await supabase.from('concierge_issues').insert({ account_id: accountId, description: description.trim(), criticality, owner, created_by: me() }).select().single();
  if (error || !data) throw new Error(error?.message ?? 'Could not add the issue');
  return toCi(data);
}
export async function setConciergeIssueState(id: string, state: 'open' | 'closed') {
  const { error } = await supabase.from('concierge_issues').update({ state, closed_at: state === 'closed' ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
}
export async function setConciergeCheckinOwner(accountId: string, email: string | null) {
  const { error } = await supabase.from('concierge_accounts').update({ checkin_owner: email?.trim().toLowerCase() || null }).eq('id', accountId);
  if (error) throw new Error(error.message);
}
export async function setConciergeDocVisible(docId: string, visible: boolean) {
  const { error } = await supabase.from('concierge_account_documents').update({ client_visible: visible }).eq('id', docId);
  if (error) throw new Error(error.message);
}
