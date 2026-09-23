/**
 * Project plans store — delivery_projects and, for the open project, its
 * tasks, issues, baselines and change requests (migration 033).
 *
 * Not persisted locally: every read is from Supabase so PMs editing the same
 * plan see the same record. Access is enforced by RLS on the 'project-plans'
 * tab; this store just surfaces the error if a write is refused.
 */
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { supabase } from '../lib/supabase';
import { useAuthStore } from './useAuthStore';
import type {
  DeliveryProject,
  DeliveryTask,
  DeliveryIssue,
  DeliveryBaseline,
  DeliveryChangeRequest,
  DeliveryFeature,
  DeliveryCheckin,
  DeliveryDocument,
  DeliveryRequest,
  RequestVerdict,
  RequestState,
  DocumentState,
} from '../types/delivery';

/* eslint-disable @typescript-eslint/no-explicit-any */
const toProject = (r: any): DeliveryProject => ({
  id: r.id,
  pipelineProjectId: r.pipeline_project_id ?? null,
  name: r.name,
  client: r.client ?? null,
  sowId: r.sow_id ?? null,
  template: r.template ?? null,
  status: r.status,
  startDate: r.start_date ?? null,
  plannedEnd: r.planned_end ?? null,
  currentEnd: r.current_end ?? null,
  pm: r.pm ?? null,
  deliveryLead: r.delivery_lead ?? null,
  architect: r.architect ?? null,
  sponsor: r.sponsor ?? null,
  sharepointFolder: r.sharepoint_folder ?? null,
  teamsChannelId: r.teams_channel_id ?? null,
  frozenRequirements: Array.isArray(r.frozen_requirements) ? r.frozen_requirements.map(String) : [],
  frozenExclusions: Array.isArray(r.frozen_exclusions) ? r.frozen_exclusions.map(String) : [],
  zohoProjectId: r.zoho_project_id ?? null,
  updatedAt: r.updated_at,
});

const toTask = (r: any): DeliveryTask => ({
  id: r.id,
  projectId: r.project_id,
  parentId: r.parent_id ?? null,
  name: r.name,
  phase: r.phase ?? null,
  startDate: r.start_date ?? null,
  endDate: r.end_date ?? null,
  percent: r.percent ?? 0,
  status: r.status === 'done' ? 'done' : 'task',
  source: r.source ?? 'manual',
  crId: r.cr_id ?? null,
  assignee: r.assignee ?? null,
  sortOrder: r.sort_order ?? 0,
});

const toIssue = (r: any): DeliveryIssue => ({
  id: r.id,
  projectId: r.project_id,
  description: r.description,
  owner: r.owner ?? null,
  dueDate: r.due_date ?? null,
  criticality: r.criticality ?? 'medium',
  impact: r.impact ?? null,
  state: r.state === 'closed' ? 'closed' : 'open',
  createdAt: r.created_at,
  closedAt: r.closed_at ?? null,
  createdBy: r.created_by ?? null,
});

const toBaseline = (r: any): DeliveryBaseline => ({
  id: r.id,
  projectId: r.project_id,
  snapshotAt: r.snapshot_at,
  source: r.source,
  crId: r.cr_id ?? null,
  label: r.label ?? null,
  tasksSnapshot: Array.isArray(r.tasks_snapshot) ? r.tasks_snapshot : [],
  taskCount: r.task_count ?? 0,
  plannedEnd: r.planned_end ?? null,
});

const toCr = (r: any): DeliveryChangeRequest => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  description: r.description ?? null,
  impactDays: r.impact_days ?? null,
  impactHours: r.impact_hours ?? null,
  milestoneShift: r.milestone_shift ?? null,
  approvers: Array.isArray(r.approvers) ? r.approvers : [],
  state: r.state,
  createdAt: r.created_at,
});
const toFeature = (r: any): DeliveryFeature => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  description: r.description ?? null,
  completionState: r.completion_state ?? 'not_started',
  demoState: r.demo_state ?? 'not_demoed',
  orderIndex: r.order_index ?? 0,
  notes: r.notes ?? null,
});

const arr = (v: any) => (Array.isArray(v) ? v : []);
const toCheckin = (r: any): DeliveryCheckin => ({
  id: r.id,
  projectId: r.project_id,
  weekEnding: r.week_ending,
  status: r.status === 'submitted' ? 'submitted' : 'draft',
  activitiesBuild: r.activities_build ?? null,
  activitiesTesting: r.activities_testing ?? null,
  activitiesDemos: r.activities_demos ?? null,
  activitiesPm: r.activities_pm ?? null,
  upcomingFocus: r.upcoming_focus ?? null,
  planSnapshot: arr(r.plan_snapshot),
  heatmapSnapshot: arr(r.heatmap_snapshot),
  parkingLotSnapshot: arr(r.parking_lot_snapshot),
  submittedAt: r.submitted_at ?? null,
  submittedBy: r.submitted_by ?? null,
  createdAt: r.created_at,
});
const toDocument = (r: any): DeliveryDocument => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  docType: r.doc_type ?? null,
  source: r.source ?? 'upload',
  version: r.version ?? null,
  state: r.state ?? 'review',
  storagePath: r.storage_path ?? null,
  mimeType: r.mime_type ?? null,
  webUrl: r.web_url ?? null,
  legacyId: r.legacy_id ?? null,
  importError: r.import_error ?? null,
  sizeBytes: r.size_bytes ?? null,
  modifiedAt: r.modified_at ?? null,
  supersedesId: r.supersedes_id ?? null,
  addedBy: r.added_by ?? null,
  createdAt: r.created_at,
});
const toRequest = (r: any): DeliveryRequest => ({
  id: r.id,
  projectId: r.project_id,
  receivedAt: r.received_at,
  requester: r.requester ?? null,
  source: r.source ?? null,
  text: r.text,
  verdict: r.verdict ?? null,
  confidence: r.confidence == null ? null : Number(r.confidence),
  impactDays: r.impact_days ?? null,
  impactHours: r.impact_hours ?? null,
  matched: r.matched ?? null,
  detail: r.detail ?? null,
  classifier: r.classifier ?? null,
  state: r.state ?? 'open',
  crId: r.cr_id ?? null,
  originalVerdict: r.original_verdict ?? null,
  appealResolution: r.appeal_resolution ?? null,
  appealResolvedBy: r.appeal_resolved_by ?? null,
  createdBy: r.created_by ?? null,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

export const DOCS_BUCKET = 'delivery-documents';
/** Storage keys: readable, but only characters every client handles. */
const safeName = (name: string) =>
  name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').slice(0, 150) || 'file';

/** The Friday that ends the current week (today, if today is Friday). */
export function currentWeekEnding(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type CheckinTextField = 'activitiesBuild' | 'activitiesTesting' | 'activitiesDemos' | 'activitiesPm' | 'upcomingFocus';
const CHECKIN_COL: Record<CheckinTextField, string> = {
  activitiesBuild: 'activities_build',
  activitiesTesting: 'activities_testing',
  activitiesDemos: 'activities_demos',
  activitiesPm: 'activities_pm',
  upcomingFocus: 'upcoming_focus',
};

const me = () => useAuthStore.getState().currentUser?.email ?? null;
const orNull = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Summary counts per project for the list page, from one round-trip each. */
export interface PlanSummary {
  tasks: number;
  done: number;
  late: number;
  openIssues: number;
  criticalIssues: number;
  /** Latest task end date — the plan's own end when the project has none set. */
  planEnd: string | null;
}

interface State {
  projects: DeliveryProject[];
  summaries: Record<string, PlanSummary>;
  loading: boolean;
  error: string | null;

  /** The project open on the detail page. */
  tasks: DeliveryTask[];
  issues: DeliveryIssue[];
  baselines: DeliveryBaseline[];
  changeRequests: DeliveryChangeRequest[];
  features: DeliveryFeature[];
  checkins: DeliveryCheckin[];
  documents: DeliveryDocument[];
  requests: DeliveryRequest[];
  detailId: string | null;
  detailLoading: boolean;

  loadProjects: () => Promise<void>;
  loadDetail: (projectId: string) => Promise<void>;

  updateProject: (id: string, patch: Partial<Pick<DeliveryProject,
    'status' | 'startDate' | 'plannedEnd' | 'currentEnd' | 'pm' | 'deliveryLead' | 'client'>>) => Promise<void>;

  addTask: (projectId: string, t: { name: string; phase?: string | null; startDate?: string | null; endDate?: string | null; assignee?: string | null }) => Promise<void>;
  updateTask: (id: string, patch: Partial<Pick<DeliveryTask,
    'name' | 'phase' | 'startDate' | 'endDate' | 'percent' | 'status' | 'assignee'>>) => Promise<void>;
  removeTask: (id: string) => Promise<void>;

  addIssue: (projectId: string, i: { description: string; owner?: string | null; dueDate?: string | null; criticality?: DeliveryIssue['criticality'] }) => Promise<void>;
  updateIssue: (id: string, patch: Partial<Pick<DeliveryIssue,
    'description' | 'owner' | 'dueDate' | 'criticality' | 'impact' | 'state'>>) => Promise<void>;

  addFeature: (projectId: string, f: { name: string; description?: string | null }) => Promise<void>;
  updateFeature: (id: string, patch: Partial<Pick<DeliveryFeature, 'name' | 'description' | 'completionState' | 'demoState' | 'notes'>>) => Promise<void>;
  removeFeature: (id: string) => Promise<void>;

  /** Open (or create) this week's draft for the project. */
  startCheckin: (projectId: string) => Promise<DeliveryCheckin>;
  updateCheckin: (id: string, field: CheckinTextField, value: string) => Promise<void>;
  /** Freeze plan, heatmap and open issues into the draft and submit it. */
  submitCheckin: (id: string) => Promise<void>;
  removeCheckin: (id: string) => Promise<void>;

  /** Upload a file into the project's documents. */
  uploadDocument: (projectId: string, file: File, meta: { docType: string | null; state?: DocumentState }) => Promise<void>;
  /** Link a file kept elsewhere (SharePoint, Drive). */
  addDocumentLink: (projectId: string, l: { name: string; url: string; docType: string | null }) => Promise<void>;
  updateDocument: (id: string, patch: Partial<Pick<DeliveryDocument, 'name' | 'docType' | 'state'>>) => Promise<void>;
  removeDocument: (id: string) => Promise<void>;
  /** Short-lived URL to open or download the file. */
  documentUrl: (doc: DeliveryDocument, download?: boolean) => Promise<string>;

  updateScope: (projectId: string, patch: { frozenRequirements?: string[]; frozenExclusions?: string[] }) => Promise<void>;
  /** Log a client request and classify it against the signed scope. */
  addRequest: (projectId: string, r: { text: string; requester?: string | null; source?: string | null; receivedAt?: string | null }) => Promise<DeliveryRequest>;
  classifyRequest: (id: string) => Promise<void>;
  overrideVerdict: (id: string, verdict: RequestVerdict, reason: string) => Promise<void>;
  setRequestState: (id: string, state: RequestState) => Promise<void>;
  removeRequest: (id: string) => Promise<void>;
  /** Create a pending change request from an out-of-scope request. */
  raiseChangeRequest: (requestId: string) => Promise<void>;
}

export const useDeliveryStore = create<State>((set, get) => ({
  projects: [],
  summaries: {},
  loading: false,
  error: null,
  tasks: [],
  issues: [],
  baselines: [],
  changeRequests: [],
  features: [],
  checkins: [],
  documents: [],
  requests: [],
  detailId: null,
  detailLoading: false,

  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      const [p, t, i] = await Promise.all([
        supabase.from('delivery_projects').select('*').order('name'),
        supabase.from('delivery_tasks').select('project_id, status, percent, end_date'),
        supabase.from('delivery_issues').select('project_id, state, criticality'),
      ]);
      const err = p.error || t.error || i.error;
      if (err) throw new Error(err.message);

      const today = new Date().toISOString().slice(0, 10);
      const summaries: Record<string, PlanSummary> = {};
      const row = (id: string) =>
        (summaries[id] ??= { tasks: 0, done: 0, late: 0, openIssues: 0, criticalIssues: 0, planEnd: null });
      for (const r of t.data ?? []) {
        const s = row(r.project_id);
        const done = r.status === 'done' || (r.percent ?? 0) >= 100;
        s.tasks += 1;
        if (r.end_date && (!s.planEnd || r.end_date > s.planEnd)) s.planEnd = r.end_date;
        if (done) s.done += 1;
        else if (r.end_date && r.end_date < today) s.late += 1;
      }
      for (const r of i.data ?? []) {
        if (r.state !== 'open') continue;
        const s = row(r.project_id);
        s.openIssues += 1;
        if (r.criticality === 'critical' || r.criticality === 'high') s.criticalIssues += 1;
      }
      set({ projects: (p.data ?? []).map(toProject), summaries });
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },

  loadDetail: async (projectId) => {
    set({ detailLoading: true, detailId: projectId, error: null });
    try {
      const [p, t, i, b, c, f, k, d, q] = await Promise.all([
        supabase.from('delivery_projects').select('*').eq('id', projectId).maybeSingle(),
        supabase.from('delivery_tasks').select('*').eq('project_id', projectId).order('sort_order').order('start_date'),
        supabase.from('delivery_issues').select('*').eq('project_id', projectId).order('created_at', { ascending: false }),
        supabase.from('delivery_baselines').select('*').eq('project_id', projectId).order('snapshot_at'),
        supabase.from('delivery_change_requests').select('*').eq('project_id', projectId).order('created_at'),
        supabase.from('delivery_features').select('*').eq('project_id', projectId).order('order_index'),
        supabase.from('delivery_checkins').select('*').eq('project_id', projectId).order('week_ending', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('delivery_documents').select('*').eq('project_id', projectId).order('modified_at', { ascending: false, nullsFirst: false }),
        supabase.from('delivery_requests').select('*').eq('project_id', projectId).order('received_at', { ascending: false }),
      ]);
      const err = p.error || t.error || i.error || b.error || c.error || f.error || k.error || d.error || q.error;
      if (err) throw new Error(err.message);
      // A stale response for a project the user has already navigated away from.
      if (get().detailId !== projectId) return;
      const project = p.data ? toProject(p.data) : null;
      set((s) => ({
        projects: project
          ? (s.projects.some((x) => x.id === project.id)
              ? s.projects.map((x) => (x.id === project.id ? project : x))
              : [...s.projects, project])
          : s.projects,
        tasks: (t.data ?? []).map(toTask),
        issues: (i.data ?? []).map(toIssue),
        baselines: (b.data ?? []).map(toBaseline),
        changeRequests: (c.data ?? []).map(toCr),
        features: (f.data ?? []).map(toFeature),
        checkins: (k.data ?? []).map(toCheckin),
        documents: (d.data ?? []).map(toDocument),
        requests: (q.data ?? []).map(toRequest),
      }));
    } catch (e) {
      set({ error: (e as Error).message });
    } finally {
      set({ detailLoading: false });
    }
  },

  updateProject: async (id, patch) => {
    const db: Record<string, unknown> = { updated_by: me() };
    if (patch.status !== undefined) db.status = patch.status;
    if (patch.startDate !== undefined) db.start_date = patch.startDate || null;
    if (patch.plannedEnd !== undefined) db.planned_end = patch.plannedEnd || null;
    if (patch.currentEnd !== undefined) db.current_end = patch.currentEnd || null;
    if (patch.pm !== undefined) db.pm = orNull(patch.pm);
    if (patch.deliveryLead !== undefined) db.delivery_lead = orNull(patch.deliveryLead);
    if (patch.client !== undefined) db.client = orNull(patch.client);
    const { data, error } = await supabase.from('delivery_projects').update(db).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Update refused — you may only have view access.');
    const p = toProject(data);
    set((s) => ({ projects: s.projects.map((x) => (x.id === id ? p : x)) }));
  },

  addTask: async (projectId, t) => {
    const last = get().tasks.reduce((m, x) => Math.max(m, x.sortOrder), 0);
    const row = {
      id: nanoid(16),
      project_id: projectId,
      name: t.name.trim(),
      phase: orNull(t.phase),
      start_date: t.startDate || null,
      end_date: t.endDate || null,
      assignee: orNull(t.assignee),
      source: 'manual',
      sort_order: last + 10,
      updated_by: me(),
    };
    const { data, error } = await supabase.from('delivery_tasks').insert(row).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Could not add task — you may only have view access.');
    set((s) => ({ tasks: [...s.tasks, toTask(data)] }));
  },

  updateTask: async (id, patch) => {
    const db: Record<string, unknown> = { updated_by: me() };
    if (patch.name !== undefined) db.name = patch.name.trim();
    if (patch.phase !== undefined) db.phase = orNull(patch.phase);
    if (patch.startDate !== undefined) db.start_date = patch.startDate || null;
    if (patch.endDate !== undefined) db.end_date = patch.endDate || null;
    if (patch.assignee !== undefined) db.assignee = orNull(patch.assignee);
    if (patch.percent !== undefined) {
      const pct = Math.max(0, Math.min(100, Math.round(patch.percent)));
      db.percent = pct;
      // Keep the two "finished" signals in step so neither view disagrees.
      db.status = pct >= 100 ? 'done' : 'task';
    }
    if (patch.status !== undefined) {
      db.status = patch.status;
      if (patch.status === 'done') db.percent = 100;
      else if (patch.percent === undefined) {
        const cur = get().tasks.find((x) => x.id === id);
        if (cur && cur.percent >= 100) db.percent = 0;
      }
    }
    const { data, error } = await supabase.from('delivery_tasks').update(db).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Update refused — you may only have view access.');
    const t = toTask(data);
    set((s) => ({ tasks: s.tasks.map((x) => (x.id === id ? t : x)) }));
  },

  removeTask: async (id) => {
    const { error } = await supabase.from('delivery_tasks').delete().eq('id', id);
    if (error) throw new Error(error.message);
    set((s) => ({ tasks: s.tasks.filter((x) => x.id !== id && x.parentId !== id) }));
  },

  addIssue: async (projectId, i) => {
    const row = {
      id: nanoid(16),
      project_id: projectId,
      description: i.description.trim(),
      owner: orNull(i.owner),
      due_date: i.dueDate || null,
      criticality: i.criticality ?? 'medium',
      state: 'open',
      created_by: me(),
    };
    const { data, error } = await supabase.from('delivery_issues').insert(row).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Could not add issue — you may only have view access.');
    set((s) => ({ issues: [toIssue(data), ...s.issues] }));
  },

  updateIssue: async (id, patch) => {
    const db: Record<string, unknown> = {};
    if (patch.description !== undefined) db.description = patch.description.trim();
    if (patch.owner !== undefined) db.owner = orNull(patch.owner);
    if (patch.dueDate !== undefined) db.due_date = patch.dueDate || null;
    if (patch.criticality !== undefined) db.criticality = patch.criticality;
    if (patch.impact !== undefined) db.impact = orNull(patch.impact);
    if (patch.state !== undefined) {
      db.state = patch.state;
      db.closed_at = patch.state === 'closed' ? new Date().toISOString() : null;
    }
    const { data, error } = await supabase.from('delivery_issues').update(db).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Update refused — you may only have view access.');
    const i = toIssue(data);
    set((s) => ({ issues: s.issues.map((x) => (x.id === id ? i : x)) }));
  },

  addFeature: async (projectId, f) => {
    const last = get().features.reduce((m, x) => Math.max(m, x.orderIndex), -1);
    const { data, error } = await supabase.from('delivery_features').insert({
      id: nanoid(16), project_id: projectId, name: f.name.trim(), description: orNull(f.description), order_index: last + 1,
    }).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Could not add feature — you may only have view access.');
    set((st) => ({ features: [...st.features, toFeature(data)] }));
  },

  updateFeature: async (id, patch) => {
    const db: Record<string, unknown> = {};
    if (patch.name !== undefined) db.name = patch.name.trim();
    if (patch.description !== undefined) db.description = orNull(patch.description);
    if (patch.completionState !== undefined) db.completion_state = patch.completionState;
    if (patch.demoState !== undefined) db.demo_state = patch.demoState;
    if (patch.notes !== undefined) db.notes = orNull(patch.notes);
    const { data, error } = await supabase.from('delivery_features').update(db).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Update refused — you may only have view access.');
    const f = toFeature(data);
    set((st) => ({ features: st.features.map((x) => (x.id === id ? f : x)) }));
  },

  removeFeature: async (id) => {
    const { error } = await supabase.from('delivery_features').delete().eq('id', id);
    if (error) throw new Error(error.message);
    set((st) => ({ features: st.features.filter((x) => x.id !== id) }));
  },

  startCheckin: async (projectId) => {
    const week = currentWeekEnding();
    const existing = get().checkins.find((c) => c.projectId === projectId && c.weekEnding === week && c.status === 'draft');
    if (existing) return existing;
    const { data, error } = await supabase.from('delivery_checkins')
      .insert({ id: nanoid(16), project_id: projectId, week_ending: week, status: 'draft' })
      .select().single();
    if (error || !data) {
      // Someone else opened this week's draft a moment ago — use theirs.
      const { data: again } = await supabase.from('delivery_checkins').select('*')
        .eq('project_id', projectId).eq('week_ending', week).eq('status', 'draft').maybeSingle();
      if (!again) throw new Error(error?.message ?? 'Could not start a check-in — you may only have view access.');
      const c = toCheckin(again);
      set((st) => ({ checkins: [c, ...st.checkins.filter((x) => x.id !== c.id)] }));
      return c;
    }
    const c = toCheckin(data);
    set((st) => ({ checkins: [c, ...st.checkins] }));
    return c;
  },

  updateCheckin: async (id, field, value) => {
    const { data, error } = await supabase.from('delivery_checkins')
      .update({ [CHECKIN_COL[field]]: orNull(value) }).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Update refused.');
    const c = toCheckin(data);
    set((st) => ({ checkins: st.checkins.map((x) => (x.id === id ? c : x)) }));
  },

  submitCheckin: async (id) => {
    const st = get();
    const draft = st.checkins.find((c) => c.id === id);
    if (!draft) throw new Error('Check-in not found.');
    // Snapshot from the plan currently loaded for this project, in the same
    // snake_case shape Governance used so old and new reports read alike.
    const tasks = st.detailId === draft.projectId ? st.tasks : [];
    const plan = tasks.map((t) => ({
      id: t.id, name: t.name, phase: t.phase, start: t.startDate, end: t.endDate,
      percent: t.percent, status: t.status, source: t.source, assignee: t.assignee,
    }));
    const heat = st.features.filter((f) => f.projectId === draft.projectId).map((f) => ({
      id: f.id, name: f.name, description: f.description, completion_state: f.completionState,
      demo_state: f.demoState, notes: f.notes, order_index: f.orderIndex,
    }));
    const parking = st.issues.filter((i) => i.projectId === draft.projectId && i.state === 'open').map((i) => ({
      id: i.id, description: i.description, owner: i.owner, due_date: i.dueDate, criticality: i.criticality,
    }));
    const { data, error } = await supabase.from('delivery_checkins').update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      submitted_by: useAuthStore.getState().currentUser?.fullName ?? me(),
      plan_snapshot: plan,
      heatmap_snapshot: heat,
      parking_lot_snapshot: parking,
    }).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Submit refused.');
    const c = toCheckin(data);
    set((s2) => ({ checkins: s2.checkins.map((x) => (x.id === id ? c : x)) }));
  },

  removeCheckin: async (id) => {
    const { error } = await supabase.from('delivery_checkins').delete().eq('id', id);
    if (error) throw new Error(error.message);
    set((st) => ({ checkins: st.checkins.filter((x) => x.id !== id) }));
  },

  uploadDocument: async (projectId, file, meta) => {
    const id = nanoid(16);
    const path = `${projectId}/${id}/${safeName(file.name)}`;
    const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file, {
      contentType: file.type || undefined, upsert: false,
    });
    if (up.error) throw new Error(up.error.message.includes('exceeded') ? `${file.name} is larger than the 250 MB limit.` : up.error.message);
    const { data, error } = await supabase.from('delivery_documents').insert({
      id, project_id: projectId, name: file.name, doc_type: orNull(meta.docType), source: 'upload', version: 'v1',
      state: meta.state ?? 'review', storage_path: path, mime_type: file.type || null, size_bytes: file.size,
      modified_at: new Date().toISOString(), added_by: me(),
    }).select().single();
    if (error || !data) {
      await supabase.storage.from(DOCS_BUCKET).remove([path]);
      throw new Error(error?.message ?? 'Could not save the document — you may only have view access.');
    }
    set((st) => ({ documents: [toDocument(data), ...st.documents] }));
  },

  addDocumentLink: async (projectId, l) => {
    const url = l.url.trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('Paste a full link starting with https://');
    const { data, error } = await supabase.from('delivery_documents').insert({
      id: nanoid(16), project_id: projectId, name: l.name.trim() || url, doc_type: orNull(l.docType), source: 'link',
      state: 'review', web_url: url, modified_at: new Date().toISOString(), added_by: me(),
    }).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Could not add the link — you may only have view access.');
    set((st) => ({ documents: [toDocument(data), ...st.documents] }));
  },

  updateDocument: async (id, patch) => {
    const db: Record<string, unknown> = {};
    if (patch.name !== undefined) db.name = patch.name.trim();
    if (patch.docType !== undefined) db.doc_type = orNull(patch.docType);
    if (patch.state !== undefined) db.state = patch.state;
    const { data, error } = await supabase.from('delivery_documents').update(db).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Update refused — you may only have view access.');
    const d = toDocument(data);
    set((st) => ({ documents: st.documents.map((x) => (x.id === id ? d : x)) }));
  },

  removeDocument: async (id) => {
    const doc = get().documents.find((x) => x.id === id);
    const { error } = await supabase.from('delivery_documents').delete().eq('id', id);
    if (error) throw new Error(error.message);
    if (doc?.storagePath) await supabase.storage.from(DOCS_BUCKET).remove([doc.storagePath]);
    set((st) => ({ documents: st.documents.filter((x) => x.id !== id) }));
  },

  documentUrl: async (doc, download = false) => {
    if (doc.webUrl) return doc.webUrl;
    if (!doc.storagePath) throw new Error('This file is still being moved from Governance. Try again in a few minutes.');
    const { data, error } = await supabase.storage.from(DOCS_BUCKET)
      .createSignedUrl(doc.storagePath, 60 * 10, download ? { download: doc.name } : undefined);
    if (error || !data) throw new Error(error?.message ?? 'Could not open the file.');
    return data.signedUrl;
  },

  updateScope: async (projectId, patch) => {
    const db: Record<string, unknown> = { updated_by: me() };
    const clean = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);
    if (patch.frozenRequirements) db.frozen_requirements = clean(patch.frozenRequirements);
    if (patch.frozenExclusions) db.frozen_exclusions = clean(patch.frozenExclusions);
    const { data, error } = await supabase.from('delivery_projects').update(db).eq('id', projectId).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Update refused — you may only have view access.');
    const p = toProject(data);
    set((st) => ({ projects: st.projects.map((x) => (x.id === projectId ? p : x)) }));
  },

  addRequest: async (projectId, r) => {
    const { data, error } = await supabase.from('delivery_requests').insert({
      id: nanoid(16), project_id: projectId, text: r.text.trim(), requester: orNull(r.requester), source: orNull(r.source),
      received_at: r.receivedAt ? new Date(r.receivedAt + 'T12:00:00').toISOString() : new Date().toISOString(),
      state: 'open', created_by: me(),
    }).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Could not log the request — you may only have view access.');
    const req = toRequest(data);
    set((st) => ({ requests: [req, ...st.requests] }));
    return req;
  },

  classifyRequest: async (id) => {
    const { data, error } = await supabase.functions.invoke<{ ok?: boolean; error?: string; detail?: string; request?: unknown }>(
      'scope-classify', { body: { requestId: id } },
    );
    if (error || !data?.ok || !data.request) {
      // functions.invoke hides the JSON body on non-2xx; dig it out for a useful message.
      let msg = data?.error ?? error?.message ?? 'Classification failed.';
      const ctx = (error as { context?: Response } | null)?.context;
      if (ctx && typeof ctx.json === 'function') {
        try { const j = await ctx.json(); msg = j.error ?? msg; } catch { /* keep msg */ }
      }
      throw new Error(msg);
    }
    const r = toRequest(data.request);
    set((st) => ({ requests: st.requests.map((x) => (x.id === id ? r : x)) }));
  },

  overrideVerdict: async (id, verdict, reason) => {
    const cur = get().requests.find((x) => x.id === id);
    if (!cur) throw new Error('Request not found.');
    const who = useAuthStore.getState().currentUser?.fullName ?? me();
    const db: Record<string, unknown> = {
      verdict,
      original_verdict: cur.originalVerdict ?? cur.verdict,
      appeal_state: 'resolved',
      appeal_reason: orNull(reason),
      appeal_resolution: orNull(reason),
      appeal_resolved_by: who,
    };
    if (!cur.crId && cur.state !== 'declined') {
      db.state = verdict === 'green' ? 'applied' : verdict === 'amber' ? 'awaiting-clarification' : 'open';
    }
    const { data, error } = await supabase.from('delivery_requests').update(db).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Update refused — you may only have view access.');
    const r = toRequest(data);
    set((st) => ({ requests: st.requests.map((x) => (x.id === id ? r : x)) }));
  },

  setRequestState: async (id, state) => {
    const { data, error } = await supabase.from('delivery_requests').update({ state }).eq('id', id).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Update refused — you may only have view access.');
    const r = toRequest(data);
    set((st) => ({ requests: st.requests.map((x) => (x.id === id ? r : x)) }));
  },

  removeRequest: async (id) => {
    const { error } = await supabase.from('delivery_requests').delete().eq('id', id);
    if (error) throw new Error(error.message);
    set((st) => ({ requests: st.requests.filter((x) => x.id !== id) }));
  },

  raiseChangeRequest: async (requestId) => {
    const req = get().requests.find((x) => x.id === requestId);
    if (!req) throw new Error('Request not found.');
    if (req.crId) throw new Error('A change request already exists for this request.');
    const firstLine = req.text.split('\n').map((l) => l.trim()).find(Boolean) ?? req.text;
    const title = firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine;
    const crId = nanoid(16);
    const cr = await supabase.from('delivery_change_requests').insert({
      id: crId, project_id: req.projectId, request_id: req.id, title,
      description: [req.text, req.detail && `Scope review: ${req.detail}`].filter(Boolean).join('\n\n'),
      impact_days: req.impactDays, impact_hours: req.impactHours, state: 'pending',
    }).select().single();
    if (cr.error || !cr.data) throw new Error(cr.error?.message ?? 'Could not create the change request.');
    const { data, error } = await supabase.from('delivery_requests').update({ cr_id: crId, state: 'cr-raised' })
      .eq('id', requestId).select().single();
    if (error || !data) throw new Error(error?.message ?? 'Change request created, but the request could not be linked.');
    const r = toRequest(data);
    set((st) => ({
      changeRequests: [...st.changeRequests, toCr(cr.data)],
      requests: st.requests.map((x) => (x.id === requestId ? r : x)),
    }));
  },
}));
