/**
 * AvailabilityView — who on each project is away, and when.
 *
 * A calendar grid: projects down the side with their allocated people beneath,
 * working days across the top, one cell per person per day. A cell is marked
 * when that person has leave covering it, coloured by whether the leave is
 * approved or still pending.
 *
 * ── Joining allocations to leave ──
 * Allocations key on employee NAME, leave keys on EMAIL, and nothing in the
 * schema joins them — see lib/resolveEmployeeEmail. Names that can't be
 * resolved are shown greyed with a "not linked" note rather than as a row of
 * empty (= available) cells: reporting someone as available because we failed
 * to identify them is the one genuinely misleading outcome here.
 *
 * ── Weekdays only ──
 * Leave is booked as an inclusive date range and nobody works weekends, so
 * Sat/Sun columns would be dead space in an already wide grid. A range that
 * spans a weekend still renders correctly on the weekdays either side.
 */
import { Fragment, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, AlertTriangle } from 'lucide-react';
import { useForecastStore, usePipelineStore } from '../../store';
import { useLeaveStore } from '../../store/useLeaveStore';
import { useAuthStore } from '../../store/useAuthStore';
import { buildEmailResolver } from '../../lib/resolveEmployeeEmail';
import { colorHash, getInitials } from './shared';
import type { LeaveRequest } from '../../types/leave';

/** Statuses that occupy a person's calendar. Cancelled/rejected do not. */
const LIVE_STATUSES = new Set(['approved', 'pending']);

const WEEKS_SHOWN = 2;

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday of the week containing `d`, at local midnight. */
function mondayOf(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay() || 7; // Sunday = 7, so Mon..Sun = 1..7
  if (day !== 1) out.setDate(out.getDate() - (day - 1));
  out.setHours(0, 0, 0, 0);
  return out;
}

interface Column { iso: string; weekday: string; date: string; isToday: boolean; isWeekStart: boolean }

function buildColumns(start: Date, weeks: number): Column[] {
  const todayIso = toIso(new Date());
  const out: Column[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < 5; i++) { // Mon–Fri
      const d = new Date(start);
      d.setDate(start.getDate() + w * 7 + i);
      out.push({
        iso: toIso(d),
        weekday: d.toLocaleDateString(undefined, { weekday: 'short' }),
        date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        isToday: toIso(d) === todayIso,
        isWeekStart: i === 0,
      });
    }
  }
  return out;
}

export default function AvailabilityView() {
  const assignments = useForecastStore((s) => s.assignments);
  const pipelineProjects = usePipelineStore((s) => s.projects);
  const requests = useLeaveStore((s) => s.requests);
  const types = useLeaveStore((s) => s.types);
  const directory = useAuthStore((s) => s.directory);

  const [offsetWeeks, setOffsetWeeks] = useState(0);

  const start = useMemo(() => {
    const d = mondayOf(new Date());
    d.setDate(d.getDate() + offsetWeeks * 7);
    return d;
  }, [offsetWeeks]);
  const columns = useMemo(() => buildColumns(start, WEEKS_SHOWN), [start]);
  const rangeStart = columns[0]?.iso ?? '';
  const rangeEnd = columns[columns.length - 1]?.iso ?? '';

  const resolveEmail = useMemo(
    () => buildEmailResolver(Object.values(directory).map((u) => ({ fullName: u.fullName, email: u.email }))),
    [directory],
  );

  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  /**
   * email → the live leave requests overlapping the visible window.
   * Filtering to the window first keeps the per-cell lookup to a handful of
   * range checks instead of scanning every request the org has ever filed.
   */
  const leaveByEmail = useMemo(() => {
    const map = new Map<string, LeaveRequest[]>();
    for (const r of requests) {
      if (!LIVE_STATUSES.has(r.status)) continue;
      if (r.endDate < rangeStart || r.startDate > rangeEnd) continue;
      const k = r.employeeEmail.toLowerCase();
      const arr = map.get(k);
      if (arr) arr.push(r); else map.set(k, [r]);
    }
    return map;
  }, [requests, rangeStart, rangeEnd]);

  /** Projects → allocated people, matching how the Projects tab groups them. */
  const projects = useMemo(() => {
    const byProject = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!a.project) continue;
      const set = byProject.get(a.project);
      if (set) set.add(a.employeeName); else byProject.set(a.project, new Set([a.employeeName]));
    }
    // Archived projects are finished work — nobody needs their availability.
    const archived = new Set(
      pipelineProjects
        .filter((p) => p.status === 'Archived')
        .map((p) => (p.forecastName || p.name).toLowerCase()),
    );
    return [...byProject.entries()]
      .filter(([name]) => !archived.has(name.toLowerCase()))
      .map(([name, people]) => ({
        name,
        people: [...people].sort((a, b) => a.localeCompare(b)).map((n) => {
          const email = resolveEmail(n);
          return { name: n, email, leave: email ? (leaveByEmail.get(email) ?? []) : [] };
        }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assignments, pipelineProjects, resolveEmail, leaveByEmail]);

  const unresolvedCount = useMemo(
    () => projects.reduce((n, p) => n + p.people.filter((x) => !x.email).length, 0),
    [projects],
  );

  /** Total distinct people away on each day, for the summary strip. */
  const awayPerDay = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const p of projects) {
      for (const person of p.people) {
        for (const col of columns) {
          if (person.leave.some((r) => r.startDate <= col.iso && r.endDate >= col.iso)) {
            const s = counts.get(col.iso) ?? new Set<string>();
            s.add(person.name);
            counts.set(col.iso, s);
          }
        }
      }
    }
    return counts;
  }, [projects, columns]);

  const label = `${new Date(rangeStart).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(rangeEnd).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setOffsetWeeks((v) => v - WEEKS_SHOWN)}
            className="p-1.5 rounded-lg border border-line bg-surface text-muted hover:bg-surface-2/70"
            title="Earlier"
          >
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            onClick={() => setOffsetWeeks(0)}
            disabled={offsetWeeks === 0}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-line bg-surface text-ink/80 hover:bg-surface-2/70 disabled:opacity-40"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setOffsetWeeks((v) => v + WEEKS_SHOWN)}
            className="p-1.5 rounded-lg border border-line bg-surface text-muted hover:bg-surface-2/70"
            title="Later"
          >
            <ChevronRight size={15} />
          </button>
        </div>

        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <CalendarDays size={14} className="text-muted/70" />
          {label}
        </div>

        {/* Legend */}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-3.5 rounded border border-line bg-surface inline-block" /> Available
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-3.5 rounded bg-rose-200 inline-block" /> Leave — approved
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 h-3.5 rounded bg-amber-300 inline-block" /> Leave — pending
          </span>
        </div>
      </div>

      {unresolvedCount > 0 && (
        <div className="mb-3 flex items-start gap-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            <strong>{unresolvedCount}</strong> allocated {unresolvedCount === 1 ? 'person has' : 'people have'} a name
            that doesn&apos;t match anyone in the user directory, so their leave can&apos;t be checked. They&apos;re greyed
            out below rather than shown as available. Fixing the spelling on the Project Team tab (or adding them on
            Admin → Users) links them up.
          </span>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-12 text-muted/70 text-sm border border-dashed border-line rounded-xl">
          No projects with allocations yet.
        </div>
      ) : (
        <div className="overflow-x-auto border border-line rounded-xl bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-surface-2/70">
                <th className="sticky left-0 z-20 bg-surface-2/70 text-left px-4 py-2.5 font-semibold text-muted text-xs uppercase tracking-wider border-b border-line min-w-[220px]">
                  Resource
                </th>
                {columns.map((c) => (
                  <th
                    key={c.iso}
                    className={`px-1 py-2 text-center border-b border-line font-medium ${c.isWeekStart ? 'border-l border-line' : ''} ${c.isToday ? 'bg-blue-50' : ''}`}
                  >
                    <div className={`text-[11px] ${c.isToday ? 'text-blue-700 font-bold' : 'text-ink/80'}`}>{c.weekday}</div>
                    <div className={`text-[10px] ${c.isToday ? 'text-blue-600' : 'text-muted/70'}`}>{c.date}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map((proj) => {
                const hue = colorHash(proj.name);
                return (
                  <Fragment key={proj.name}>
                    <tr>
                      <td
                        colSpan={columns.length + 1}
                        className="px-4 py-2 font-bold text-ink text-sm border-y border-line/60"
                        style={{ backgroundColor: `hsl(${hue} 70% 97%)` }}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span className="w-1.5 h-4 rounded-full inline-block" style={{ backgroundColor: `hsl(${hue} 60% 55%)` }} />
                          {proj.name}
                          <span className="font-normal text-muted/70 text-xs">
                            {proj.people.length} {proj.people.length === 1 ? 'person' : 'people'}
                          </span>
                        </span>
                      </td>
                    </tr>

                    {proj.people.map((person) => {
                      const personHue = colorHash(person.name);
                      return (
                        <tr key={`${proj.name}-${person.name}`} className="hover:bg-surface-2/60">
                          <td className="sticky left-0 z-10 bg-surface px-4 py-1.5 border-b border-line/40">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                                style={{
                                  backgroundColor: person.email ? `hsl(${personHue} 70% 92%)` : '#f1f5f9',
                                  color: person.email ? `hsl(${personHue} 60% 32%)` : '#94a3b8',
                                }}
                              >
                                {getInitials(person.name)}
                              </span>
                              <span className={`truncate text-sm ${person.email ? 'text-ink' : 'text-muted/70'}`}>
                                {person.name}
                              </span>
                              {!person.email && (
                                <span className="text-[9px] uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1 py-0.5 shrink-0">
                                  not linked
                                </span>
                              )}
                            </div>
                          </td>

                          {columns.map((col) => {
                            const req = person.email
                              ? person.leave.find((r) => r.startDate <= col.iso && r.endDate >= col.iso)
                              : undefined;
                            const approved = req?.status === 'approved';
                            const typeName = req ? (typeById.get(req.leaveTypeId)?.name ?? 'Leave') : '';
                            return (
                              <td
                                key={col.iso}
                                className={`px-1 py-1.5 border-b border-line/40 ${col.isWeekStart ? 'border-l border-line' : ''} ${col.isToday ? 'bg-blue-50/40' : ''}`}
                              >
                                <div
                                  title={req ? `${person.name} — ${typeName} (${req.status}), ${req.startDate} to ${req.endDate}` : undefined}
                                  className={`h-6 rounded-md border text-[10px] font-bold flex items-center justify-center ${
                                    !person.email
                                      ? 'border-line/60 bg-surface-2/60'
                                      : req
                                        ? approved
                                          ? 'border-rose-200 bg-rose-200 text-rose-900'
                                          : 'border-amber-300 bg-amber-300 text-amber-900'
                                        : 'border-line bg-surface'
                                  }`}
                                >
                                  {req ? 'L' : ''}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>

            {/* Daily totals */}
            <tfoot>
              <tr className="bg-surface-2/70">
                <td className="sticky left-0 z-10 bg-surface-2/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted border-t border-line">
                  Away that day
                </td>
                {columns.map((col) => {
                  const n = awayPerDay.get(col.iso)?.size ?? 0;
                  return (
                    <td
                      key={col.iso}
                      className={`px-1 py-2 text-center border-t border-line ${col.isWeekStart ? 'border-l border-line' : ''} ${col.isToday ? 'bg-blue-50' : ''}`}
                    >
                      <span className={`text-xs font-bold tabular-nums ${n > 0 ? 'text-ink/80' : 'text-line'}`}>
                        {n || '—'}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted/70">
        A person appears under every project they&apos;re allocated to, so one absence shows on each of them. Cancelled
        and rejected requests are not shown.
      </p>
    </div>
  );
}
