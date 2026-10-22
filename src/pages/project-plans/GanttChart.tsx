/**
 * Gantt view of a project plan.
 *
 * Rows are grouped by phase (a summary bar per phase, then its tasks). Bars
 * are coloured by state: done, late, in progress, not started. A red line
 * marks today. When the project has a baseline, a faint bar behind each task
 * shows where it was originally planned, so slippage is visible at a glance.
 *
 * Editors can drag a bar to move it, or drag its right edge to change the end
 * date. Changes snap to whole days and save when the mouse is released.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import { groupPhases, isDone, isLate, fmtDate, todayIso } from '../../lib/deliveryPlan';
import { alertError } from '../../lib/planToast';
import type { DeliveryTask, DeliveryBaseline } from '../../types/delivery';

type Zoom = 'week' | 'month';
const DAY_PX: Record<Zoom, number> = { week: 28, month: 7 };
const ROW_H = 34;
const LABEL_W = 280;
const DAY_MS = 86_400_000;

const toDay = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY_MS);
const fromDay = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);

type Row =
  | { kind: 'phase'; name: string; start: string | null; end: string | null; done: number; total: number }
  | { kind: 'task'; task: DeliveryTask };

export function GanttChart({ tasks, baseline, canEdit }: {
  tasks: DeliveryTask[];
  baseline: DeliveryBaseline | null;
  canEdit: boolean;
}) {
  const updateTask = useDeliveryStore((s) => s.updateTask);
  // Long plans read better by month; short ones by week.
  const [zoom, setZoom] = useState<Zoom>(() => {
    const ds = tasks.filter((t) => t.startDate && t.endDate);
    if (!ds.length) return 'week';
    const span = Math.max(...ds.map((t) => toDay(t.endDate!))) - Math.min(...ds.map((t) => toDay(t.startDate!)));
    return span > 90 ? 'month' : 'week';
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showBaseline, setShowBaseline] = useState(true);
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'end'; startX: number; delta: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const dated = tasks.filter((t) => t.startDate && t.endDate);
  const undated = tasks.filter((t) => !t.startDate || !t.endDate);
  const phases = useMemo(() => groupPhases(dated), [dated]);
  const baseMap = useMemo(() => {
    const m = new Map<string, { start: string; end: string }>();
    for (const b of baseline?.tasksSnapshot ?? []) if (b.start && b.end) m.set(b.id, { start: b.start, end: b.end });
    return m;
  }, [baseline]);

  const today = todayIso();
  const range = useMemo(() => {
    const days: number[] = [toDay(today)];
    for (const t of dated) days.push(toDay(t.startDate!), toDay(t.endDate!));
    if (showBaseline) for (const b of baseMap.values()) days.push(toDay(b.start), toDay(b.end));
    const lo = Math.min(...days), hi = Math.max(...days);
    // Pad to whole weeks (Monday start) plus a week either side.
    const d0 = new Date(lo * DAY_MS).getUTCDay();
    const start = lo - ((d0 + 6) % 7) - 7;
    return { start, end: hi + 14 };
  }, [dated, baseMap, showBaseline, today]);

  const px = DAY_PX[zoom];
  const totalDays = range.end - range.start + 1;
  const width = totalDays * px;
  const x = (iso: string) => (toDay(iso) - range.start) * px;

  // Open with today in view (a little in from the left edge).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, (toDay(today) - range.start) * px - 160);
  }, [zoom, range.start, px, today]);

  const rows: Row[] = [];
  for (const ph of phases) {
    rows.push({ kind: 'phase', name: ph.name, start: ph.start, end: ph.end, done: ph.done, total: ph.total });
    for (const t of ph.tasks) rows.push({ kind: 'task', task: t });
  }

  // Month and week header ticks.
  const months: { label: string; left: number; w: number }[] = [];
  const weeks: { label: string; left: number }[] = [];
  for (let d = range.start; d <= range.end; d++) {
    const dt = new Date(d * DAY_MS);
    if (dt.getUTCDate() === 1 || d === range.start) {
      const next = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) / DAY_MS;
      months.push({
        label: dt.toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        left: (d - range.start) * px,
        w: (Math.min(next, range.end + 1) - d) * px,
      });
    }
    if (dt.getUTCDay() === 1) weeks.push({ label: String(dt.getUTCDate()), left: (d - range.start) * px });
  }

  function beginDrag(e: React.PointerEvent, id: string, mode: 'move' | 'end') {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id, mode, startX: e.clientX, delta: 0 });
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setDrag({ ...d, delta: Math.round((e.clientX - d.startX) / px) });
  }
  async function endDrag() {
    const d = dragRef.current;
    setDrag(null);
    if (!d || d.delta === 0) return;
    const t = tasks.find((x) => x.id === d.id);
    if (!t?.startDate || !t.endDate) return;
    const s = toDay(t.startDate), en = toDay(t.endDate);
    const patch = d.mode === 'move'
      ? { startDate: fromDay(s + d.delta), endDate: fromDay(en + d.delta) }
      : { endDate: fromDay(Math.max(s, en + d.delta)) };
    try { await updateTask(t.id, patch); } catch (err) { alertError(err); }
  }

  function barFor(t: DeliveryTask) {
    let s = toDay(t.startDate!), en = toDay(t.endDate!);
    if (drag?.id === t.id) {
      if (drag.mode === 'move') { s += drag.delta; en += drag.delta; } else en = Math.max(s, en + drag.delta);
    }
    return { left: (s - range.start) * px, w: (en - s + 1) * px, s: fromDay(s), e: fromDay(en) };
  }

  const colour = (t: DeliveryTask) =>
    isDone(t) ? 'bg-green' : isLate(t) ? 'bg-rose' : t.percent > 0 ? 'bg-gold' : 'bg-brand';

  if (dated.length === 0) {
    return <p className="px-5 py-8 text-sm text-muted text-center">No tasks have both a start and end date yet — add dates in the Table view to see the chart.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-line/60 text-xs">
        <div className="inline-flex rounded-lg border border-line p-0.5">
          {(['week', 'month'] as Zoom[]).map((z) => (
            <button key={z} onClick={() => setZoom(z)}
              className={`px-2.5 py-1 rounded-md font-semibold capitalize ${zoom === z ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}>{z}s</button>
          ))}
        </div>
        {baseline && (
          <label className="inline-flex items-center gap-1.5 text-muted cursor-pointer">
            <input type="checkbox" checked={showBaseline} onChange={(e) => setShowBaseline(e.target.checked)} />
            Show baseline ({baseline.label ?? 'original plan'})
          </label>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-3 text-muted">
          <Legend cls="bg-brand" label="Not started" />
          <Legend cls="bg-gold" label="In progress" />
          <Legend cls="bg-green" label="Done" />
          <Legend cls="bg-rose" label="Late" />
          {baseline && showBaseline && <Legend cls="bg-ink/25" label="Baseline (original dates)" />}
          {canEdit && <span className="italic">Drag a bar to move · drag its right edge to resize</span>}
        </span>
      </div>

      <div className="flex" onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {/* Labels */}
        <div className="shrink-0 border-r border-line/60 bg-surface z-10" style={{ width: LABEL_W }}>
          <div className="h-12 border-b border-line/60" />
          {rows.map((r, i) => r.kind === 'phase' ? (
            <div key={`p${i}`} className="flex items-center justify-between px-4 bg-surface-2/60 font-bold text-ink text-sm border-b border-line/40" style={{ height: ROW_H }}>
              <span className="truncate">{r.name}</span>
              <span className="text-[11px] font-semibold text-muted tabular-nums">{r.done}/{r.total}</span>
            </div>
          ) : (
            <div key={r.task.id} className={`flex items-center px-4 pl-7 text-sm border-b border-line/30 ${isDone(r.task) ? 'text-muted line-through' : 'text-ink'}`} style={{ height: ROW_H }} title={r.task.name}>
              <span className="truncate">{r.task.name}</span>
            </div>
          ))}
        </div>

        {/* Timeline */}
        <div ref={scrollRef} className="overflow-x-auto flex-1">
          <div className="relative" style={{ width }}>
            {/* header */}
            <div className="h-12 border-b border-line/60 relative select-none">
              {months.map((m, i) => (
                <div key={i} className="absolute top-0 h-6 border-l border-line/60 px-1.5 text-[11px] font-semibold text-ink/80 truncate" style={{ left: m.left, width: m.w }}>{m.label}</div>
              ))}
              {weeks.map((w, i) => (
                <div key={i} className="absolute top-6 h-6 border-l border-line/40 px-1 text-[10px] text-muted" style={{ left: w.left }}>{zoom === 'week' ? w.label : ''}</div>
              ))}
            </div>

            {/* grid lines */}
            {weeks.map((w, i) => (
              <div key={i} className="absolute bottom-0 border-l border-line/30" style={{ left: w.left, top: 48 }} />
            ))}
            {/* today */}
            <div className="absolute bottom-0 w-0.5 bg-rose/80 z-10" style={{ left: x(today), top: 40 }} title={`Today, ${fmtDate(today)}`} />

            {rows.map((r, i) => {
              if (r.kind === 'phase') {
                return (
                  <div key={`p${i}`} className="relative bg-surface-2/60 border-b border-line/40" style={{ height: ROW_H }}>
                    {r.start && r.end && (
                      <div className="absolute top-1/2 -translate-y-1/2 h-2.5 rounded-full bg-ink/60"
                        style={{ left: x(r.start), width: (toDay(r.end) - toDay(r.start) + 1) * px }}
                        title={`${r.name}: ${fmtDate(r.start)} – ${fmtDate(r.end)}`} />
                    )}
                  </div>
                );
              }
              const t = r.task;
              const b = barFor(t);
              const base = showBaseline ? baseMap.get(t.id) : undefined;
              return (
                <div key={t.id} className="relative border-b border-line/30" style={{ height: ROW_H }}>
                  {base && (
                    <div className="absolute rounded bg-ink/25" style={{ left: x(base.start), width: (toDay(base.end) - toDay(base.start) + 1) * px, top: ROW_H - 10, height: 5 }}
                      title={`Baseline: ${fmtDate(base.start)} – ${fmtDate(base.end)}`} />
                  )}
                  <div
                    onPointerDown={(e) => beginDrag(e, t.id, 'move')}
                    className={`absolute top-1.5 rounded-md ${colour(t)} ${canEdit ? 'cursor-grab active:cursor-grabbing' : ''} shadow-sm overflow-hidden`}
                    style={{ left: b.left, width: Math.max(b.w, 6), height: ROW_H - 14 }}
                    title={`${t.name}\n${fmtDate(b.s)} – ${fmtDate(b.e)}${t.assignee ? `\n${t.assignee}` : ''}${t.percent ? `\n${t.percent}% complete` : ''}`}
                  >
                    {!isDone(t) && t.percent > 0 && <div className="absolute inset-y-0 left-0 bg-black/15" style={{ width: `${t.percent}%` }} />}
                    {b.w > 70 && <span className="relative px-1.5 text-[10px] font-semibold text-white leading-5 whitespace-nowrap">{t.assignee ?? ''}</span>}
                    {canEdit && (
                      <div onPointerDown={(e) => beginDrag(e, t.id, 'end')} className="absolute right-0 inset-y-0 w-2 cursor-ew-resize hover:bg-black/20" />
                    )}
                  </div>
                  {drag?.id === t.id && (
                    <div className="absolute -top-0.5 text-[10px] font-semibold text-ink bg-surface px-1 rounded shadow z-20 whitespace-nowrap" style={{ left: b.left }}>
                      {fmtDate(b.s)} – {fmtDate(b.e)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {undated.length > 0 && (
        <p className="px-5 py-3 text-xs text-muted border-t border-line/60">
          Not on the chart (missing dates): {undated.map((t) => t.name).join(', ')}
        </p>
      )}
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span className={`w-3 h-2 rounded-sm ${cls}`} />{label}</span>;
}
