/**
 * Corporate Check-ins.
 *
 * One scorecard per person per month, per corporate function. The forecast
 * is set and locked by the owner; actuals and the rolling feed stay open all
 * month. Every forecast change and every overwritten actual is written to
 * checkin_audit by a database trigger — the app cannot skip it.
 *
 * Backed by: checkin_functions, checkin_members, checkin_kpis,
 * checkin_templates, checkin_scorecard_kpis, checkins, checkin_targets,
 * checkin_updates, checkin_audit and the v_checkin_* views.
 */

export type ActualSource = 'auto' | 'manual';
export type KpiUnit = 'count' | 'hours' | 'percent' | 'currency';
export type KpiDirection = 'higher' | 'lower';

export interface CheckinFunction {
  functionKey: string;
  label: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
}

export interface CheckinScope {
  scopeKey: string;
  label: string;
  kind: 'global' | 'region' | 'pod' | 'none';
  value: string | null;
}

export interface CheckinMember {
  email: string;
  displayName: string;
  functionKey: string;
  scopeKey: string;
  active: boolean;
  sortOrder: number;
  notes: string | null;
}

export interface CheckinKpi {
  kpiKey: string;
  label: string;
  description: string | null;
  actualSource: ActualSource;
  metricKey: string | null;
  poolMetric: string | null;
  unit: KpiUnit;
  direction: KpiDirection;
  functionKey: string | null;
  sortOrder: number;
  active: boolean;
}

/** Which KPIs sit on one person's card. The matrix the owner edits. */
export interface ScorecardKpi {
  ownerEmail: string;
  kpiKey: string;
  customLabel: string | null;
  sortOrder: number;
  active: boolean;
}

/** A function's default KPI set — what a new joiner inherits. */
export interface CheckinTemplateRow {
  functionKey: string;
  kpiKey: string;
  defaultTarget: number | null;
  sortOrder: number;
  active: boolean;
}

/** One row of v_checkin_scorecard: a person, a month, a KPI. */
export interface ScorecardRow {
  checkinId: string;
  period: string;
  ownerEmail: string;
  displayName: string;
  functionKey: string;
  functionLabel: string;
  scopeKey: string;
  scopeLabel: string;
  focus: string | null;
  locked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  kpiKey: string;
  label: string;
  description: string | null;
  actualSource: ActualSource;
  unit: KpiUnit;
  direction: KpiDirection;
  sortOrder: number;
  targetId: string | null;
  targetValue: number;
  autoActual: number | null;
  manualActual: number | null;
  manualActualNote: string | null;
  manualActualBy: string | null;
  manualActualAt: string | null;
  targetSetBy: string | null;
  feedDelta: number | null;
  updateCount: number;
  lastUpdateAt: string | null;
  actualValue: number;
  poolValue: number | null;
  isOverridden: boolean;
  auditCount: number;
  variance: number;
  attainmentPct: number | null;
}

/** A line in the rolling feed. */
export interface CheckinUpdate {
  id: string;
  checkinId: string;
  kpiKey: string | null;
  updateDate: string;
  note: string;
  delta: number | null;
  refType: string | null;
  refId: string | null;
  authorEmail: string;
  createdAt: string;
  editedAt: string | null;
}

/** A row of v_checkin_audit — trigger-written, never editable. */
export interface CheckinAuditRow {
  id: number;
  changedAt: string;
  changedBy: string;
  changedByName: string;
  ownerName: string | null;
  period: string | null;
  kpiKey: string | null;
  kpiLabel: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  action: 'insert' | 'update' | 'delete';
}
