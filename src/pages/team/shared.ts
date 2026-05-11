import { MONTHS } from '../../types/forecast';
import type { Month, ForecastAssignment, ZohoPipelineProject } from '../../types/forecast';

/* ─── Project options grouped by source ───────────────────────── */

export type ProjectSource = 'current' | 'pipeline' | 'legacy';

export interface ProjectOption {
  value: string;
  label: string;
  source: ProjectSource;
}

export function buildProjectOptions(
  pipelineProjects: ZohoPipelineProject[],
  assignments: ForecastAssignment[],
): ProjectOption[] {
  const seen = new Set<string>();
  const out: ProjectOption[] = [];

  const add = (label: string, value: string, source: ProjectSource) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ value, label, source });
  };

  for (const p of pipelineProjects) {
    if (p.source !== 'zoho') continue;
    add(p.name, p.forecastName || p.name, 'current');
  }
  for (const p of pipelineProjects) {
    if (p.source !== 'manual') continue;
    add(p.name, p.forecastName || p.name, 'pipeline');
  }
  for (const a of assignments) {
    if (!a.project) continue;
    add(a.project, a.project, 'legacy');
  }
  return out;
}

export const SOURCE_LABEL: Record<ProjectSource, string> = {
  current: 'Current Projects (Zoho)',
  pipeline: 'Pipeline (Planned)',
  legacy: 'Other (legacy)',
};

export function groupOptionsBySource(
  options: ProjectOption[],
): Record<ProjectSource, ProjectOption[]> {
  const grouped: Record<ProjectSource, ProjectOption[]> = {
    current: [],
    pipeline: [],
    legacy: [],
  };
  for (const o of options) grouped[o.source].push(o);
  return grouped;
}

/* ─── Week date helpers ───────────────────────────────────────── */

export function getWeeksInMonth(year: number, monthIdx: number): string[] {
  const weeks: string[] = [];
  const first = new Date(year, monthIdx, 1);
  const day = first.getDay();
  const startOffset = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(year, monthIdx, 1 + startOffset);

  const d = new Date(weekStart);
  while (d.getMonth() <= monthIdx || (d.getMonth() === 11 && monthIdx === 0)) {
    const weekEnd = new Date(d);
    weekEnd.setDate(weekEnd.getDate() + 6);
    if (d.getMonth() === monthIdx || weekEnd.getMonth() === monthIdx) {
      weeks.push(d.toISOString().slice(0, 10));
    }
    d.setDate(d.getDate() + 7);
    if (d.getMonth() > monthIdx && d.getFullYear() >= year) break;
    if (d.getFullYear() > year) break;
    if (weeks.length >= 6) break;
  }
  return weeks;
}

export function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

export function getMonthFromWeek(dateStr: string): Month {
  const d = new Date(dateStr + 'T00:00:00');
  return MONTHS[d.getMonth()];
}

/** Distribute monthly hours evenly across weeks for display when weeklyHours is empty */
export function getWeeklyHoursForAssignment(
  a: ForecastAssignment,
  weekDates: string[],
): Record<string, number> {
  const hasWeeklyData = weekDates.some((w) => (a.weeklyHours[w] ?? 0) > 0);
  if (hasWeeklyData) {
    const result: Record<string, number> = {};
    for (const w of weekDates) result[w] = a.weeklyHours[w] ?? 0;
    return result;
  }
  const result: Record<string, number> = {};
  const monthWeekCounts: Record<string, number> = {};
  for (const w of weekDates) {
    const m = getMonthFromWeek(w);
    monthWeekCounts[m] = (monthWeekCounts[m] ?? 0) + 1;
  }
  for (const w of weekDates) {
    const m = getMonthFromWeek(w);
    const total = a.monthlyTotals[m] ?? 0;
    const count = monthWeekCounts[m] ?? 1;
    result[w] = Math.round(total / count);
  }
  return result;
}

/* ─── Employee groups ─────────────────────────────────────────── */

export interface EmployeeGroup {
  name: string;
  role: string;
  rateCard: number | null;
  isSI: boolean;
  isContractor: boolean;
  assignments: ForecastAssignment[];
  totalHours: number;
}

export function groupAssignments(assignments: ForecastAssignment[]): EmployeeGroup[] {
  const map = new Map<string, ForecastAssignment[]>();
  for (const a of assignments) {
    const key = a.employeeName;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return [...map.entries()]
    .map(([name, assgns]) => {
      const first = assgns[0];
      const totalHours = assgns.reduce(
        (sum, a) => sum + MONTHS.reduce((s, m) => s + a.monthlyTotals[m], 0),
        0,
      );
      return {
        name,
        role: first.role,
        rateCard: first.rateCard,
        isSI: first.isSI,
        isContractor: first.isContractor,
        assignments: assgns,
        totalHours,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ─── Role buckets for grouping ───────────────────────────────── */

export const roleBucket = (role: string): string => {
  const r = (role || '').toLowerCase().trim();
  if (!r) return 'Unspecified';
  if (/(^|\b)(ba|business analyst|analyst)\b/.test(r)) return 'BAs';
  if (/(^|\b)(architect|sa|solution\s*architect)\b/.test(r)) return 'Architects';
  if (/(tech lead|techlead|tl|team lead|lead developer|engineering lead)/.test(r)) return 'Tech Leads';
  if (/(project manager|^pm$|program manager|delivery manager)/.test(r)) return 'PMs';
  if (/\b(senior|sr\.?|sr )/.test(r) && /(dev|developer|engineer)/.test(r)) return 'Senior Developers';
  if (/\b(junior|jr\.?|jr )/.test(r) && /(dev|developer|engineer)/.test(r)) return 'Junior Developers';
  if (/(dev|developer|engineer)/.test(r)) return 'Developers';
  if (/(qa|quality|tester|sdet)/.test(r)) return 'QA';
  if (/(devops|sre|platform)/.test(r)) return 'DevOps';
  if (/(designer|ux|ui)/.test(r)) return 'Designers';
  if (/(consultant|advisor)/.test(r)) return 'Consultants';
  return 'Other';
};

export const BUCKET_ORDER = [
  'PMs',
  'Architects',
  'Tech Leads',
  'Senior Developers',
  'Developers',
  'Junior Developers',
  'BAs',
  'Consultants',
  'QA',
  'DevOps',
  'Designers',
  'Other',
  'Unspecified',
];

/* ─── Initials avatar ─────────────────────────────────────────── */

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Deterministic color (hue) from a string — for avatar/chip backgrounds. */
export function colorHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

/* ─── Hours → utilization color (based on 160 hr/month full-time) ── */

export function hoursColor(hours: number, capacity = 160): {
  fill: string;
  text: string;
  ring: string;
} {
  if (hours <= 0) {
    return { fill: 'bg-slate-100', text: 'text-slate-400', ring: 'ring-slate-200' };
  }
  const util = hours / capacity;
  if (util >= 0.8) return { fill: 'bg-emerald-500', text: 'text-emerald-50', ring: 'ring-emerald-300' };
  if (util >= 0.5) return { fill: 'bg-sky-500', text: 'text-sky-50', ring: 'ring-sky-300' };
  return { fill: 'bg-amber-400', text: 'text-amber-900', ring: 'ring-amber-300' };
}
