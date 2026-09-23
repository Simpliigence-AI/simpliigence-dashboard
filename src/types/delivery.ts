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
  state: string;
  at?: string;
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
