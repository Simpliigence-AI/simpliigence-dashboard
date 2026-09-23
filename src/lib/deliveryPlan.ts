/**
 * Pure helpers for project plans. No Supabase, no React — easy to reason
 * about and reuse from the projects page.
 */
import type { DeliveryTask, PhaseGroup } from '../types/delivery';

/**
 * Group tasks by their phase label, keeping phases in the order their first
 * task appears (tasks arrive sorted by sort_order). Same rule the old
 * governance-sync function used, so phase order on Current Projects doesn't
 * change after the move.
 */
export function groupPhases(tasks: DeliveryTask[]): PhaseGroup[] {
  const groups = new Map<string, DeliveryTask[]>();
  for (const t of tasks) {
    const key = (t.phase ?? '').trim() || 'Unphased';
    const g = groups.get(key);
    if (g) g.push(t); else groups.set(key, [t]);
  }
  return Array.from(groups, ([name, items]) => {
    const starts = items.map((t) => t.startDate).filter((v): v is string => !!v).sort();
    const ends = items.map((t) => t.endDate).filter((v): v is string => !!v).sort();
    return {
      name,
      tasks: items,
      start: starts[0] ?? null,
      end: ends[ends.length - 1] ?? null,
      done: items.filter(isDone).length,
      total: items.length,
    };
  });
}

/** Governance had two flags for "finished"; honour either. */
export function isDone(t: DeliveryTask): boolean {
  return t.status === 'done' || t.percent >= 100;
}

/** A task is late when it isn't done and its end date is before today. */
export function isLate(t: DeliveryTask, today = todayIso()): boolean {
  return !isDone(t) && !!t.endDate && t.endDate < today;
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function planProgress(tasks: DeliveryTask[]): { done: number; total: number; pct: number } {
  const total = tasks.length;
  const done = tasks.filter(isDone).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
}

/** Project health flag from the AI summary. */
export const HEALTH = {
  green: { label: 'On track', dot: 'bg-green', cls: 'text-green' },
  amber: { label: 'At risk', dot: 'bg-gold', cls: 'text-gold' },
  red: { label: 'Off track', dot: 'bg-rose', cls: 'text-rose' },
} as const;
