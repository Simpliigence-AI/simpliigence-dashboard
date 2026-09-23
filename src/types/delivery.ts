/**
 * Delivery governance — project plans, tasks, baselines, change requests and
 * issues. Moved in from the standalone Delivery Governance app (migration 033).
 * Dates are 'YYYY-MM-DD' strings or null.
 */

export type DeliveryProjectStatus = 'active' | 'completed' | 'on_hold' | 'cancelled';

export interface DeliveryProject {
  id: string;
  pipelineProjectId: string | null;
  name: string;
  client: string | null;
  sowId: string | null;
  template: string | null;
  status: DeliveryProjectStatus;
  startDate: string | null;
  plannedEnd: string | null;
  currentEnd: string | null;
  pm: string | null;
  deliveryLead: string | null;
  architect: string | null;
  sponsor: string | null;
  sharepointFolder: string | null;
  teamsChannelId: string | null;
  /** Signed scope — what the scope classifier judges client requests against. */
  frozenRequirements: string[];
  frozenExclusions: string[];
  /** AI executive summary (migration 036). */
  summary: string | null;
  summaryAt: string | null;
  health: 'green' | 'amber' | 'red' | null;
  zohoProjectId: string | null;
  updatedAt: string;
}

export type TaskStatus = 'task' | 'done';
export type TaskSource = 'manual' | 'sow' | 'cr';

export interface DeliveryTask {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  phase: string | null;
  startDate: string | null;
  endDate: string | null;
  percent: number;
  status: TaskStatus;
  source: TaskSource;
  crId: string | null;
  assignee: string | null;
  sortOrder: number;
}

export interface BaselineTask {
  id: string;
  name: string;
  phase?: string;
  start?: string | null;
  end?: string | null;
}

export interface DeliveryBaseline {
  id: string;
  projectId: string;
  snapshotAt: string;
  source: string;
  crId: string | null;
  label: string | null;
  tasksSnapshot: BaselineTask[];
  taskCount: number;
  plannedEnd: string | null;
}

export interface CrApprover {
  role: string;
  who: string;
  state: 'pending' | 'approved' | 'rejected' | string;
  at?: string;
  /** Who recorded the decision in the Dashboard (migration 036). */
  by?: string;
  note?: string;
}

export interface DeliveryChangeRequest {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  impactDays: number | null;
  impactHours: number | null;
  milestoneShift: string | null;
  approvers: CrApprover[];
  state: string;
  createdAt: string;
  requestId: string | null;
  requestedBy: string | null;
  decidedAt: string | null;
  baselineId: string | null;
}

export type IssueCriticality = 'low' | 'medium' | 'high' | 'critical';
export type IssueState = 'open' | 'closed';

export interface DeliveryIssue {
  id: string;
  projectId: string;
  description: string;
  owner: string | null;
  dueDate: string | null;
  criticality: IssueCriticality;
  impact: string | null;
  state: IssueState;
  createdAt: string;
  closedAt: string | null;
  createdBy: string | null;
}

/** Tasks grouped into phases, in first-appearance order (see groupPhases). */
export interface PhaseGroup {
  name: string;
  tasks: DeliveryTask[];
  start: string | null;
  end: string | null;
  done: number;
  total: number;
}

export type FeatureCompletion = 'not_started' | 'partial' | 'complete';
export type FeatureDemo = 'not_demoed' | 'demoed';

/** One row of the feature heatmap: what's built and what the client has seen. */
export interface DeliveryFeature {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  completionState: FeatureCompletion;
  demoState: FeatureDemo;
  orderIndex: number;
  notes: string | null;
}

export type CheckinStatus = 'draft' | 'submitted';

/** Snapshot shapes are whatever was frozen at submit time — Governance rows
 *  use snake_case, Dashboard rows use the same keys, so read defensively. */
export interface SnapshotTask { id: string; name: string; phase?: string | null; start?: string | null; end?: string | null; percent?: number; status?: string }
export interface SnapshotFeature { id: string; name: string; completion_state?: string; demo_state?: string }
export interface SnapshotIssue { id: string; description: string; owner?: string | null; due_date?: string | null; criticality?: string }

export interface DeliveryCheckin {
  id: string;
  projectId: string;
  weekEnding: string;
  status: CheckinStatus;
  activitiesBuild: string | null;
  activitiesTesting: string | null;
  activitiesDemos: string | null;
  activitiesPm: string | null;
  upcomingFocus: string | null;
  planSnapshot: SnapshotTask[];
  heatmapSnapshot: SnapshotFeature[];
  parkingLotSnapshot: SnapshotIssue[];
  submittedAt: string | null;
  submittedBy: string | null;
  createdAt: string;
}

export type DocumentState = 'draft' | 'review' | 'frozen';

/** A project document. The file is in the 'delivery-documents' bucket
 *  (storagePath) or, for source='link', elsewhere at webUrl (migration 035). */
export interface DeliveryDocument {
  id: string;
  projectId: string;
  name: string;
  docType: string | null;
  source: 'upload' | 'generated' | 'link';
  version: string | null;
  state: DocumentState;
  storagePath: string | null;
  mimeType: string | null;
  webUrl: string | null;
  legacyId: string | null;
  importError: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  supersedesId: string | null;
  addedBy: string | null;
  createdAt: string;
  /** Set on AI-generated documents: which generator made it (migration 036). */
  generator: DocGenerator | null;
}

export type DocGenerator = 'user_stories' | 'test_cases' | 'process_flows' | 'status_report';

export interface DocFeedback {
  id: string;
  documentId: string;
  projectId: string;
  author: string | null;
  body: string;
  state: 'open' | 'resolved';
  createdAt: string;
}

/** One entry in the project's change log (migration 036). */
export interface AuditEvent {
  id: string;
  projectId: string | null;
  at: string;
  actor: string | null;
  action: string;
  payload: { id?: string; label?: string; fields?: string[]; [k: string]: unknown };
}

export interface Person { email: string; fullName: string }

export interface PipelineOption { id: string; name: string; status: string | null; startDate: string | null; endDate: string | null; linkedTo: string | null }

/** What delivery-ai's sow-parse proposes. Nothing is saved until applied. */
export interface SowProposal {
  requirements: string[];
  exclusions: string[];
  phases: { name: string; tasks: { name: string; start_week: number; duration_weeks: number }[] }[];
  features: { name: string; description?: string }[];
  milestones?: string[];
  total_weeks?: number;
}

export type RequestVerdict = 'green' | 'amber' | 'red';
export type RequestState = 'open' | 'awaiting-clarification' | 'applied' | 'cr-raised' | 'declined';

/** Something the client asked for mid-project, with the scope verdict. */
export interface DeliveryRequest {
  id: string;
  projectId: string;
  receivedAt: string;
  requester: string | null;
  source: string | null;
  text: string;
  verdict: RequestVerdict | null;
  confidence: number | null;
  impactDays: number | null;
  impactHours: number | null;
  matched: string | null;
  detail: string | null;
  classifier: string | null;
  state: RequestState;
  crId: string | null;
  originalVerdict: RequestVerdict | null;
  appealResolution: string | null;
  appealResolvedBy: string | null;
  createdBy: string | null;
}
