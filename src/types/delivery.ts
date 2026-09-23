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
