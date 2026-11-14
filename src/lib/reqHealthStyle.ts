/**
 * Colours and icons for requisition health. Kept apart from the badge component so
 * the table, split view and filter chips can share them (and so the component file
 * exports only components).
 */
import { AlarmClock, Hourglass, Rocket, type LucideIcon } from 'lucide-react';
import type { ReqHealth, ReqHealthInfo } from './reqHealth';

export const HEALTH_META: Record<Exclude<ReqHealth, 'ok'>, {
  name: string; icon: LucideIcon; badge: string; rowTint: string; bar: string; chipOn: string;
}> = {
  overdue: { name: 'Overdue', icon: AlarmClock,
    badge: 'text-rose-800 bg-rose-100 border-rose-300', rowTint: 'bg-rose-50/70', bar: 'border-l-rose-500', chipOn: 'bg-rose-600 text-white border-rose-600' },
  push: { name: 'Needs a push', icon: Hourglass,
    badge: 'text-amber-900 bg-amber-100 border-amber-300', rowTint: 'bg-amber-50/60', bar: 'border-l-amber-500', chipOn: 'bg-amber-500 text-white border-amber-500' },
  fast: { name: 'Fast closing', icon: Rocket,
    badge: 'text-emerald-800 bg-emerald-100 border-emerald-300', rowTint: 'bg-emerald-50/70', bar: 'border-l-emerald-500', chipOn: 'bg-emerald-600 text-white border-emerald-600' },
};

/** Tint + left bar classes for a row in the given state ('' when on track). */
export function healthRowClass(h: ReqHealthInfo | undefined): string {
  if (!h || h.health === 'ok') return 'border-l-4 border-l-transparent';
  const m = HEALTH_META[h.health];
  return `border-l-4 ${m.bar} ${m.rowTint}`;
}
