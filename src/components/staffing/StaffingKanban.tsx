/**
 * India Staffing Kanban board — drag & drop cards across the 7 pipeline stages.
 *
 * Each column is one PipelineStage. Each card represents a StaffingRequisition.
 * Dragging a card onto another column calls onMoveStage(reqId, newStage),
 * which fires updateRequisition in the store — that in turn writes a
 * StaffingHistoryEntry via the existing audit pipeline, so moves are
 * automatically logged without any extra plumbing here.
 */
import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { AlertTriangle, Building2, Clock } from 'lucide-react';
import type { PipelineStage, StaffingHistoryEntry, StaffingRequisition } from '../../types/staffing';
import { STAGE_COLORS } from '../../types/staffing';
import { computeStageTiming } from '../../lib/staffingAlerts';

const STAGES: PipelineStage[] = [
  'Sourcing',
  'Profiles Shared',
  'Interview',
  'Shortlisted',
  'Client Round',
  'Closed/Selected',
  'Onboarding',
];

export interface KanbanReq {
  id: string;
  title: string;
  account: string;
  positions: number;
  stage: PipelineStage;
  aiProbability: number;
  probability: number;
  ageing: number;
  hasStartDate: boolean;
  daysInStage: number;
  stuckThreshold: number;
  isStuck: boolean;
  alertSeverity?: 'high' | 'medium' | 'info';
  alertMessage?: string;
}

/* ── Helpers ────────────────────────────────────────────────────────── */

const probColor = (p: number) => (p >= 65 ? '#10b981' : p >= 40 ? '#f59e0b' : '#ef4444');

/* ── Card ───────────────────────────────────────────────────────────── */

function KanbanCard({ req }: { req: KanbanReq }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: req.id,
    data: { reqId: req.id },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`rounded-lg border bg-white p-2.5 shadow-sm cursor-grab active:cursor-grabbing select-none transition-all ${
        isDragging ? 'opacity-40 ring-2 ring-blue-400' : 'hover:shadow-md hover:border-slate-300'
      } ${req.isStuck ? 'border-red-200 bg-red-50/30' : 'border-slate-200'}`}
      style={{ touchAction: 'none' }}
    >
      <div className="flex items-start gap-1.5 mb-1">
        <Building2 size={11} className="text-slate-400 mt-0.5 flex-shrink-0" />
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide truncate">{req.account}</span>
      </div>
      <div className="text-[12px] font-semibold text-slate-800 leading-tight mb-2 line-clamp-2" title={req.title}>
        {req.title}
      </div>

      <div className="flex items-center justify-between gap-1 text-[10px]">
        <span className="inline-flex items-center gap-0.5 font-bold text-slate-600">
          {req.positions}&nbsp;<span className="font-normal text-slate-400">pos</span>
        </span>
        <div className="flex items-center gap-1" title="AI probability">
          <div className="w-8 h-1 rounded bg-slate-100 overflow-hidden">
            <div className="h-full" style={{ width: `${req.aiProbability}%`, background: probColor(req.aiProbability) }} />
          </div>
          <span className="font-bold tabular-nums" style={{ color: probColor(req.aiProbability) }}>
            {req.aiProbability}%
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-1.5 text-[10px]">
        <span
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-semibold"
          title={`In ${req.stage} for ${req.daysInStage} days (threshold ${req.stuckThreshold})`}
          style={{
            color: req.isStuck ? '#b91c1c' : '#64748b',
            background: req.isStuck ? '#fee2e2' : '#f1f5f9',
          }}
        >
          <Clock size={9} /> {req.daysInStage}d
        </span>
        {req.hasStartDate && (
          <span className="text-slate-400" title={`${req.ageing} days since start date`}>· {req.ageing}d age</span>
        )}
      </div>

      {req.alertMessage && (
        <div
          className="mt-1.5 flex items-start gap-1 text-[10px] leading-tight px-1.5 py-1 rounded"
          style={{
            color: req.alertSeverity === 'high' ? '#991b1b' : req.alertSeverity === 'medium' ? '#92400e' : '#1e40af',
            background: req.alertSeverity === 'high' ? '#fee2e2' : req.alertSeverity === 'medium' ? '#fef3c7' : '#dbeafe',
          }}
        >
          <AlertTriangle size={10} className="flex-shrink-0 mt-0.5" />
          <span>{req.alertMessage}</span>
        </div>
      )}
    </div>
  );
}

/* ── Column ─────────────────────────────────────────────────────────── */

function KanbanColumn({
  stage,
  reqs,
  isActiveDrop,
}: {
  stage: PipelineStage;
  reqs: KanbanReq[];
  isActiveDrop: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage, data: { stage } });
  const totalPositions = reqs.reduce((s, r) => s + r.positions, 0);
  const stuckCount = reqs.filter((r) => r.isStuck).length;

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-xl border transition-colors ${
        isOver ? 'border-blue-400 bg-blue-50/40' : isActiveDrop ? 'border-slate-300 bg-slate-50/50' : 'border-slate-200 bg-slate-50/30'
      }`}
    >
      {/* Column header */}
      <div className="px-3 pt-3 pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-1">
          <span className="h-2 w-2 rounded-full" style={{ background: STAGE_COLORS[stage] }} />
          <span className="text-[11px] font-bold uppercase tracking-wide text-slate-700">{stage}</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-400">
          <span>
            <span className="font-semibold text-slate-600">{reqs.length}</span> reqs · <span className="font-semibold text-slate-600">{totalPositions}</span> pos
          </span>
          {stuckCount > 0 && (
            <span className="inline-flex items-center gap-0.5 font-semibold text-red-600">
              <AlertTriangle size={10} /> {stuckCount} stuck
            </span>
          )}
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
        {reqs.length === 0 && (
          <div className="text-center text-[10px] text-slate-300 py-4 italic">Drop reqs here</div>
        )}
        {reqs.map((r) => (
          <KanbanCard key={r.id} req={r} />
        ))}
      </div>
    </div>
  );
}

/* ── Main Kanban ────────────────────────────────────────────────────── */

export interface KanbanAlert {
  requisitionId: string;
  severity: 'high' | 'medium' | 'info';
  message: string;
}

interface StaffingKanbanProps {
  requisitions: StaffingRequisition[];
  history: StaffingHistoryEntry[];
  accountNameById: Record<string, string>;
  onMoveStage: (reqId: string, newStage: PipelineStage) => void;
  /** Optional alerts keyed by requisition id — surfaced as a banner on the card */
  alerts?: KanbanAlert[];
}

export function StaffingKanban({
  requisitions,
  history,
  accountNameById,
  onMoveStage,
  alerts = [],
}: StaffingKanbanProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const alertByReq = useMemo(() => {
    const m: Record<string, KanbanAlert> = {};
    // If a req has multiple alerts, keep the most severe.
    const sev = { high: 3, medium: 2, info: 1 } as const;
    for (const a of alerts) {
      const existing = m[a.requisitionId];
      if (!existing || sev[a.severity] > sev[existing.severity]) m[a.requisitionId] = a;
    }
    return m;
  }, [alerts]);

  const cards: KanbanReq[] = useMemo(() => {
    // Only active reqs — archived ones don't appear on the board.
    const active = requisitions.filter(
      (r) => !['Closed Won', 'Closed Lost', 'Cancelled'].includes(r.status_field),
    );
    return active.map((r) => {
      const timing = computeStageTiming(r, history);
      const alert = alertByReq[r.id];
      return {
        id: r.id,
        title: r.title,
        account: accountNameById[r.account_id] || 'Unknown',
        positions: r.new_positions,
        stage: r.stage,
        aiProbability: r.ai_probability || 0,
        probability: r.probability || 0,
        ageing: r.start_date
          ? Math.max(0, Math.floor((Date.now() - Date.parse(r.start_date)) / 86_400_000))
          : 0,
        hasStartDate: !!r.start_date,
        daysInStage: timing.daysInStage,
        stuckThreshold: timing.stuckThreshold,
        isStuck: timing.isStuck,
        alertSeverity: alert?.severity,
        alertMessage: alert?.message,
      };
    });
  }, [requisitions, history, accountNameById, alertByReq]);

  // Bucket cards by stage
  const byStage = useMemo(() => {
    const out: Record<PipelineStage, KanbanReq[]> = {
      Sourcing: [], 'Profiles Shared': [], Interview: [], Shortlisted: [],
      'Client Round': [], 'Closed/Selected': [], Onboarding: [],
    };
    for (const c of cards) out[c.stage]?.push(c);
    // Within each column, stuck first (descending days), then by AI prob descending
    for (const s of STAGES) {
      out[s].sort((a, b) => {
        if (a.isStuck !== b.isStuck) return a.isStuck ? -1 : 1;
        if (a.isStuck && b.isStuck) return b.daysInStage - a.daysInStage;
        return b.aiProbability - a.aiProbability;
      });
    }
    return out;
  }, [cards]);

  const draggingCard = draggingId ? cards.find((c) => c.id === draggingId) : null;

  const handleDragStart = (e: DragStartEvent) => {
    setDraggingId(String(e.active.id));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setDraggingId(null);
    const id = String(e.active.id);
    const targetStage = e.over?.id as PipelineStage | undefined;
    if (!targetStage || !STAGES.includes(targetStage)) return;
    const card = cards.find((c) => c.id === id);
    if (!card || card.stage === targetStage) return;
    onMoveStage(id, targetStage);
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="overflow-x-auto pb-2">
        <div className="grid gap-3 min-w-[1200px]" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(200px, 1fr))` }}>
          {STAGES.map((s) => (
            <KanbanColumn
              key={s}
              stage={s}
              reqs={byStage[s]}
              isActiveDrop={draggingId !== null && byStage[s].every((r) => r.id !== draggingId)}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>
        {draggingCard ? (
          <div className="rotate-2 scale-105 shadow-lg">
            <KanbanCard req={draggingCard} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
