/**
 * Stage funnel analysis for India Staffing.
 *
 * For each pipeline stage, we compute:
 *   - `everReached`: how many reqs ever made it to this stage (current state
 *     at or past this stage, OR the audit log shows a transition into it)
 *   - `currentlyHere`: active reqs (non-archived) whose current stage === this
 *   - `stalledLost`:  reqs that reached this stage and ended up
 *     Closed-without-progress / Lost / Cancelled before moving forward
 *   - `dropOffFromPrev`: % drop from the previous stage's `everReached`
 *
 * We deliberately use the audit log as a source of truth for "ever reached" —
 * if a req is currently in "Client Round", we know it passed through
 * Sourcing → Profiles Shared → Interview → Shortlisted implicitly, even if
 * every stage change wasn't explicitly audit-logged.
 */
import type {
  PipelineStage,
  StaffingHistoryEntry,
  StaffingRequisition,
} from '../types/staffing';
import { ARCHIVED_STATUSES } from '../types/staffing';

const STAGES: PipelineStage[] = [
  'Sourcing',
  'Profiles Shared',
  'Interview',
  'Shortlisted',
  'Client Round',
  'Closed/Selected',
  'Onboarding',
];

const STAGE_INDEX: Record<PipelineStage, number> = STAGES.reduce(
  (acc, s, i) => ({ ...acc, [s]: i }),
  {} as Record<PipelineStage, number>,
);

export interface FunnelRow {
  stage: PipelineStage;
  /** Reqs that ever touched this stage (current stage at or past, OR seen in audit log) */
  everReached: number;
  /** Active reqs whose current stage === this stage */
  currentlyHere: number;
  /** Positions open at this stage right now (sum of new_positions for currentlyHere) */
  currentPositions: number;
  /** Reqs that hit this stage and ended up Lost / Cancelled (not Closed) without progressing further */
  stalledLost: number;
  /** % drop from the previous stage's everReached. 0 for the first stage. */
  dropOffFromPrev: number;
  /** Overall conversion rate from the first stage to this stage */
  conversionFromStart: number;
}

export interface FunnelSummary {
  rows: FunnelRow[];
  /** Total reqs considered (includes archived) */
  totalReqs: number;
  /** Reqs that made it to Onboarding or Closed/Selected */
  successful: number;
  /** Reqs in terminal Lost / Cancelled states */
  terminallyLost: number;
  /** Biggest drop-off step (for narrative) */
  biggestDrop: { from: PipelineStage; to: PipelineStage; percent: number } | null;
}

export function computeFunnel(
  requisitions: StaffingRequisition[],
  history: StaffingHistoryEntry[],
): FunnelSummary {
  const historyByReq = new Map<string, StaffingHistoryEntry[]>();
  for (const h of history) {
    const arr = historyByReq.get(h.requisition_id) || [];
    arr.push(h);
    historyByReq.set(h.requisition_id, arr);
  }

  // For each req, compute the max stage it ever touched.
  const reqMaxStageIdx = new Map<string, number>();
  for (const r of requisitions) {
    let maxIdx = STAGE_INDEX[r.stage] ?? 0;
    const reqHist = historyByReq.get(r.id) || [];
    for (const h of reqHist) {
      if (h.field === 'stage') {
        const fromIdx = STAGE_INDEX[h.old_value as PipelineStage];
        const toIdx = STAGE_INDEX[h.new_value as PipelineStage];
        if (fromIdx > maxIdx) maxIdx = fromIdx;
        if (toIdx > maxIdx) maxIdx = toIdx;
      }
    }
    reqMaxStageIdx.set(r.id, maxIdx);
  }

  const rows: FunnelRow[] = STAGES.map((stage, i) => {
    // everReached = reqs whose max stage index >= this stage's index
    let everReached = 0;
    let currentlyHere = 0;
    let currentPositions = 0;
    let stalledLost = 0;

    for (const r of requisitions) {
      const maxIdx = reqMaxStageIdx.get(r.id) ?? 0;
      if (maxIdx < i) continue;
      everReached++;
      if (r.stage === stage && !ARCHIVED_STATUSES.includes(r.status_field)) {
        currentlyHere++;
        currentPositions += r.new_positions;
      }
      // Stalled here: max stage is exactly this one AND status is Lost/Cancelled
      if (maxIdx === i && (r.status_field === 'Closed Lost' || r.status_field === 'Cancelled')) {
        stalledLost++;
      }
    }

    return {
      stage,
      everReached,
      currentlyHere,
      currentPositions,
      stalledLost,
      dropOffFromPrev: 0, // filled below
      conversionFromStart: 0, // filled below
    };
  });

  // Compute drop-offs and conversion
  const startCount = rows[0].everReached || 0;
  for (let i = 0; i < rows.length; i++) {
    rows[i].conversionFromStart = startCount > 0 ? Math.round((rows[i].everReached / startCount) * 100) : 0;
    if (i === 0) continue;
    const prev = rows[i - 1].everReached;
    rows[i].dropOffFromPrev = prev > 0
      ? Math.round(((prev - rows[i].everReached) / prev) * 100)
      : 0;
  }

  // Biggest drop-off step
  let biggest: FunnelSummary['biggestDrop'] = null;
  for (let i = 1; i < rows.length; i++) {
    const drop = rows[i].dropOffFromPrev;
    if (drop > 0 && (!biggest || drop > biggest.percent)) {
      biggest = { from: rows[i - 1].stage, to: rows[i].stage, percent: drop };
    }
  }

  const successful = requisitions.filter(
    (r) => r.status_field === 'Closed Won' || r.stage === 'Closed/Selected' || r.stage === 'Onboarding',
  ).length;
  const terminallyLost = requisitions.filter(
    (r) => r.status_field === 'Closed Lost' || r.status_field === 'Cancelled',
  ).length;

  return {
    rows,
    totalReqs: requisitions.length,
    successful,
    terminallyLost,
    biggestDrop: biggest,
  };
}
