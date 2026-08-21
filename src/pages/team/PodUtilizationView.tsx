/**
 * Pod Utilization view — how hard each pod is booked, month by month.
 *
 * One row per pod, one column per month, each cell a heat-mapped percentage:
 *
 *     utilisation = hours allocated to the pod's members ÷ (members × 160)
 *
 * A six-person pod has 960 hours of capacity in a month; 660 booked reads
 * 69%. Click a row to see the members behind the number, how each is booked,
 * and which projects the hours are on.
 *
 * ── Capacity comes from pod membership, not from hours ──
 * The denominator is the pod's roster (project_team_pods), so a pod that goes
 * quiet reports as under-utilised rather than silently shrinking its own
 * target. That's the point of the view: an idle pod should look idle.
 *
 * ── Current month forward ──
 * Past months can't be staffed differently now, so the grid opens on the
 * current month through December. "Show earlier months" brings back the
 * run-up for anyone reviewing history.
 */
import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useForecastStore } from '../../store';
import { usePodAssignmentsStore } from '../../store/usePodAssignmentsStore';
import { MONTHS } from '../../types/forecast';
import type { Month } from '../../types/forecast';
import { colorHash, getInitials } from './shared';

/**
 * Nominal capacity for one person for one month — 4 weeks × 40 hours, the
 * basis the forecast is planned on. Not calendar-accurate (a 23-working-day
 * month is ~184h) and deliberately so: every pod is measured against the same
 * yardstick, which is what makes the columns comparable to each other.
 */
const HOURS_PER_PERSON_MONTH = 160;

/**
 * Heat thresholds, as % of capacity. Over 100% is NOT "extra green" — a pod
 * booked past its capacity is a staffing problem, not a success — so it gets
 * its own colour instead of being lumped in with healthy.
 */
const LOW = 50;
const GOOD = 80;

type Band = 'none' | 'low' | 'mid' | 'high' | 'over';

function bandFor(pct: number | null): Band {
  if (pct === null) return 'none';
  if (pct > 100) return 'over';
  if (pct >= GOOD) return 'high';
  if (pct >= LOW) return 'mid';
  return 'low';
}

const BAND_CELL: Record<Band, string> = {
  none: 'bg-surface-2/70 text-line border-line/60',
  low: 'bg-rose-100 text-rose-900 border-rose-200 hover:bg-rose-200/70',
  mid: 'bg-amber-100 text-amber-900 border-amber-200 hover:bg-amber-200/70',
  high: 'bg-emerald-100 text-emerald-900 border-emerald-200 hover:bg-emerald-200/70',
  over: 'bg-violet-100 text-violet-900 border-violet-300 hover:bg-violet-200/70',
};

interface MemberMonth { hours: number; projects: Array<{ name: string; hours: number }> }
interface Member { name: string; byMonth: Record<Month, MemberMonth> }
interface PodRow {
  pod: string;
  members: Member[];
  capacity: number;
  /** Hours booked per visible month, index-aligned with `months`. */
  hoursByMonth: number[];
}

function emptyMonths(): Record<Month, MemberMonth> {
  const rec = {} as Record<Month, MemberMonth>;
  for (const m of MONTHS) rec[m] = { hours: 0, projects: [] };
  return rec;
}

export default function PodUtilizationView() {
  const assignments = useForecastStore((s) => s.assignments);
  const podAssignments = usePodAssignmentsStore((s) => s.assignments);
  /** employeeName (lowercased+trimmed) → pod. From project_team_pods. */
  const podByEmployee = usePodAssignmentsStore((s) => s.byName);

  const [showEarlier, setShowEarlier] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const currentMonthIdx = new Date().getMonth();
  const months = useMemo<Month[]>(
    () => (showEarlier ? [...MONTHS] : MONTHS.slice(currentMonthIdx)),
    [showEarlier, currentMonthIdx],
  );

  /** pod → member names, from the pod roster (the source of capacity). */
  const podRoster = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of podAssignments) {
      const pod = r.pod.trim();
      if (!pod || !r.employeeName) continue;
      if (!m.has(pod)) m.set(pod, []);
      m.get(pod)!.push(r.employeeName);
    }
    for (const list of m.values()) list.sort((a, b) => a.localeCompare(b));
    return m;
  }, [podAssignments]);

  const pods = useMemo<PodRow[]>(() => {
    // Seed every roster member so someone with zero hours still counts
    // towards capacity — that's exactly the under-utilisation we're measuring.
    const byPod = new Map<string, Map<string, Member>>();
    for (const [pod, names] of podRoster) {
      const members = new Map<string, Member>();
      for (const n of names) members.set(n, { name: n, byMonth: emptyMonths() });
      byPod.set(pod, members);
    }

    for (const a of assignments) {
      const pod = podByEmployee.get(a.employeeName.toLowerCase().trim());
      if (!pod) continue;
      const members = byPod.get(pod.trim());
      if (!members) continue;
      let member = members.get(a.employeeName);
      if (!member) {
        // On the forecast under a spelling the roster doesn't carry. Count the
        // hours rather than drop them; capacity still comes from the roster.
        member = { name: a.employeeName, byMonth: emptyMonths() };
        members.set(a.employeeName, member);
      }
      for (const m of MONTHS) {
        const hrs = a.monthlyTotals[m] ?? 0;
        if (hrs <= 0) continue;
        member.byMonth[m].hours += hrs;
        if (a.project) member.byMonth[m].projects.push({ name: a.project, hours: hrs });
      }
    }

    return [...byPod.entries()]
      .map(([pod, members]) => {
        const list = [...members.values()].sort((a, b) => a.name.localeCompare(b.name));
        return {
          pod,
          members: list,
          // Roster size, not "people with hours" — an idle member is spare
          // capacity, which is the whole thing we're trying to surface.
          capacity: (podRoster.get(pod)?.length ?? list.length) * HOURS_PER_PERSON_MONTH,
          hoursByMonth: months.map((m) => list.reduce((s, p) => s + p.byMonth[m].hours, 0)),
        };
      })
      .sort((a, b) => a.pod.localeCompare(b.pod));
  }, [assignments, podByEmployee, podRoster, months]);

  const totals = useMemo(
    () =>
      months.map((_, i) => {
        const hours = pods.reduce((s, p) => s + p.hoursByMonth[i], 0);
        const capacity = pods.reduce((s, p) => s + p.capacity, 0);
        return { hours, capacity, pct: capacity > 0 ? (hours / capacity) * 100 : null };
      }),
    [pods, months],
  );

  const noPodCount = useMemo(() => {
    const allNames = new Set(assignments.map((a) => a.employeeName));
    let missing = 0;
    for (const n of allNames) if (!podByEmployee.has(n.toLowerCase().trim())) missing++;
    return missing;
  }, [assignments, podByEmployee]);

  const toggle = (pod: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(pod)) next.delete(pod); else next.add(pod);
      return next;
    });

  if (pods.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted">
        <div className="text-base font-semibold text-ink/80 mb-1">No pods assigned yet</div>
        <p>
          Open the <span className="font-medium text-ink">People</span> tab, pick a resource, and set their{' '}
          <span className="font-medium text-ink">Pod</span> (e.g. <span className="font-medium">Pod 1</span>).
          Pods will start showing up here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <button
          type="button"
          onClick={() => setShowEarlier((v) => !v)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-line bg-surface text-ink/80 hover:bg-surface-2/70"
        >
          {showEarlier ? 'Hide earlier months' : 'Show earlier months'}
        </button>
        <span className="text-xs text-muted/70">
          {showEarlier ? 'Full year' : `${months[0]} – Dec`} · capacity = pod members × {HOURS_PER_PERSON_MONTH}h
        </span>

        <div className="ml-auto flex items-center gap-2.5 text-[11px] text-muted">
          <span className="flex items-center gap-1"><span className="w-4 h-3.5 rounded bg-rose-100 border border-rose-200 inline-block" /> under {LOW}%</span>
          <span className="flex items-center gap-1"><span className="w-4 h-3.5 rounded bg-amber-100 border border-amber-200 inline-block" /> {LOW}–{GOOD - 1}%</span>
          <span className="flex items-center gap-1"><span className="w-4 h-3.5 rounded bg-emerald-100 border border-emerald-200 inline-block" /> {GOOD}–100%</span>
          <span className="flex items-center gap-1"><span className="w-4 h-3.5 rounded bg-violet-100 border border-violet-300 inline-block" /> over</span>
        </div>
      </div>

      {noPodCount > 0 && (
        <div className="mb-3 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
          {noPodCount} team member{noPodCount === 1 ? '' : 's'} without a pod — their hours aren&apos;t counted here.
          Set a pod on the <span className="font-semibold">People</span> tab.
        </div>
      )}

      <div className="overflow-x-auto border border-line rounded-xl bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2/70">
              <th className="sticky left-0 z-20 bg-surface-2/70 px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted border-b border-line min-w-[210px]">
                Pod
              </th>
              {months.map((m, i) => (
                <th
                  key={m}
                  className={`px-2 py-2.5 text-center text-[11px] font-semibold border-b border-line min-w-[84px] ${
                    !showEarlier && i === 0 ? 'text-blue-700' : 'text-muted'
                  }`}
                >
                  {m}
                  {!showEarlier && i === 0 && <div className="text-[9px] font-normal text-blue-500">this month</div>}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {pods.map((row) => {
              const open = expanded.has(row.pod);
              const roster = podRoster.get(row.pod) ?? [];
              const hue = colorHash(row.pod);
              return (
                <Fragment key={row.pod}>
                  <tr className="hover:bg-surface-2/70">
                    <td className="sticky left-0 z-10 bg-surface px-2 py-2 border-b border-line/60">
                      <button
                        type="button"
                        onClick={() => toggle(row.pod)}
                        aria-expanded={open}
                        className="w-full flex items-center gap-2 text-left group"
                      >
                        <span className="text-muted/70 group-hover:text-muted shrink-0">
                          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </span>
                        <span className="w-1.5 h-7 rounded-full shrink-0" style={{ backgroundColor: `hsl(${hue} 60% 55%)` }} />
                        <span className="min-w-0">
                          <span className="block font-bold text-ink">{row.pod}</span>
                          <span className="block text-[10px] text-muted/70 truncate max-w-[150px]" title={roster.join(', ')}>
                            {roster.length} {roster.length === 1 ? 'member' : 'members'} · {row.capacity}h/mo
                          </span>
                        </span>
                      </button>
                    </td>

                    {months.map((m, i) => {
                      const hours = row.hoursByMonth[i];
                      const pct = row.capacity > 0 ? (hours / row.capacity) * 100 : null;
                      return (
                        <td key={m} className="px-1.5 py-2 border-b border-line/60">
                          <button
                            type="button"
                            onClick={() => toggle(row.pod)}
                            title={`${row.pod} — ${m}: ${Math.round(hours)} of ${row.capacity} hrs across ${roster.length} members (${pct === null ? '—' : Math.round(pct) + '%'}). Click for the breakdown.`}
                            className={`w-full rounded-lg border px-1 py-1.5 text-center transition-colors ${BAND_CELL[bandFor(pct)]}`}
                          >
                            <span className="block text-sm font-bold tabular-nums leading-tight">
                              {pct === null ? '—' : `${Math.round(pct)}%`}
                            </span>
                            <span className="block text-[9px] opacity-70 tabular-nums">
                              {Math.round(hours)}/{row.capacity}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>

                  {open && row.members.map((mem) => (
                    <tr key={`${row.pod}-${mem.name}`} className="bg-surface-2/40">
                      <td className="sticky left-0 z-10 bg-surface-2/40 px-4 py-1.5 border-b border-line/60">
                        <div className="flex items-center gap-2 pl-5 min-w-0">
                          <span
                            className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0"
                            style={{
                              backgroundColor: `hsl(${colorHash(mem.name)} 70% 92%)`,
                              color: `hsl(${colorHash(mem.name)} 60% 32%)`,
                            }}
                          >
                            {getInitials(mem.name)}
                          </span>
                          <span className="text-xs text-ink/80 truncate">{mem.name}</span>
                        </div>
                      </td>
                      {months.map((m) => {
                        const cell = mem.byMonth[m];
                        const pct = (cell.hours / HOURS_PER_PERSON_MONTH) * 100;
                        const projects = cell.projects
                          .slice()
                          .sort((a, b) => b.hours - a.hours);
                        return (
                          <td key={m} className="px-1.5 py-1.5 border-b border-line/60 text-center">
                            {cell.hours > 0 ? (
                              <span
                                title={`${mem.name} — ${m}: ${Math.round(cell.hours)}h (${Math.round(pct)}% of ${HOURS_PER_PERSON_MONTH}h)\n${projects.map((p) => `${p.name}: ${Math.round(p.hours)}h`).join('\n')}`}
                                className="inline-block text-[11px] tabular-nums"
                              >
                                <span className={`font-semibold ${pct >= GOOD ? 'text-emerald-700' : pct >= LOW ? 'text-amber-700' : 'text-rose-700'}`}>
                                  {Math.round(pct)}%
                                </span>
                                <span className="block text-[9px] text-muted/70 truncate max-w-[80px]">
                                  {projects.length === 1
                                    ? projects[0].name
                                    : projects.length > 1
                                      ? `${projects.length} projects`
                                      : ''}
                                </span>
                              </span>
                            ) : (
                              <span className="text-[11px] text-line">idle</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>

          <tfoot>
            <tr className="bg-surface-2/70">
              <td className="sticky left-0 z-10 bg-surface-2/70 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-muted border-t border-line">
                All pods
              </td>
              {totals.map((t, i) => (
                <td key={months[i]} className="px-1.5 py-2 border-t border-line text-center">
                  <span className="block text-sm font-bold tabular-nums text-ink">
                    {t.pct === null ? '—' : `${Math.round(t.pct)}%`}
                  </span>
                  <span className="block text-[9px] text-muted/70 tabular-nums">
                    {Math.round(t.hours)}/{t.capacity}
                  </span>
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-muted/70 flex items-start gap-1.5">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>
          Capacity is the pod&apos;s full roster, so members with no hours count as spare capacity rather than being
          excluded. A person&apos;s hours count once for their pod no matter how many projects they&apos;re split
          across. Click any pod to see who&apos;s behind the number.
        </span>
      </p>
    </div>
  );
}
