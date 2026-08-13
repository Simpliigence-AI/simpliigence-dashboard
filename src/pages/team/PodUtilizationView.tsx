/**
 * Pod Utilization view — the fifth /team sub-tab.
 *
 * Shows a pods × months matrix. Each row is a pod (from india_roster.pod),
 * each column is a month of the current year. Every cell lists the
 * projects any member of that pod has forecast hours against that month.
 *
 * Rationale: the People / Projects / Table views all pivot on individual
 * resources; this view pivots on pods so you can see at a glance
 * "Pod 1 is on Ciklum + Acme Aug→Sep, then just Acme through Dec" without
 * clicking into each project.
 */
import { useMemo } from 'react';
import { useForecastStore } from '../../store';
import { usePodAssignmentsStore } from '../../store/usePodAssignmentsStore';
import { MONTHS } from '../../types/forecast';
import type { Month } from '../../types/forecast';

interface PodCellSummary {
  projects: Array<{ name: string; hours: number; peopleCount: number }>;
  totalHours: number;
  totalPeople: number;
}

export default function PodUtilizationView() {
  const assignments = useForecastStore((s) => s.assignments);
  const podAssignments = usePodAssignmentsStore((s) => s.assignments);

  /** employeeName (lowercased+trimmed) → pod. From project_team_pods. */
  const podByEmployee = usePodAssignmentsStore((s) => s.byName);

  /** pod → sorted array of member names (from project_team_pods) */
  const podRoster = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of podAssignments) {
      const pod = r.pod.trim();
      if (!pod || !r.employeeName) continue;
      if (!m.has(pod)) m.set(pod, []);
      m.get(pod)!.push(r.employeeName);
    }
    for (const list of m.values()) list.sort();
    return m;
  }, [podAssignments]);

  const pods = useMemo(() => [...podRoster.keys()].sort(), [podRoster]);

  /** For each (pod, month), which projects have hours and how much. */
  const matrix = useMemo(() => {
    // pod → month → project → { hours, peopleCount (distinct names) }
    const grid = new Map<string, Map<Month, Map<string, { hours: number; people: Set<string> }>>>();
    for (const pod of pods) grid.set(pod, new Map());

    for (const a of assignments) {
      const pod = podByEmployee.get(a.employeeName.toLowerCase().trim());
      if (!pod) continue;
      const podRow = grid.get(pod);
      if (!podRow) continue;
      for (const m of MONTHS) {
        const hrs = a.monthlyTotals[m] ?? 0;
        if (hrs <= 0) continue;
        if (!podRow.has(m)) podRow.set(m, new Map());
        const projectMap = podRow.get(m)!;
        const proj = a.project;
        if (!projectMap.has(proj)) projectMap.set(proj, { hours: 0, people: new Set() });
        const cell = projectMap.get(proj)!;
        cell.hours += hrs;
        cell.people.add(a.employeeName);
      }
    }

    // Flatten into a plain object shape the UI can render directly.
    const out = new Map<string, Map<Month, PodCellSummary>>();
    for (const [pod, monthMap] of grid.entries()) {
      const monthOut = new Map<Month, PodCellSummary>();
      for (const [m, projMap] of monthMap.entries()) {
        const projects = [...projMap.entries()]
          .map(([name, { hours, people }]) => ({ name, hours, peopleCount: people.size }))
          .sort((a, b) => b.hours - a.hours);
        const totalHours = projects.reduce((s, p) => s + p.hours, 0);
        const totalPeople = new Set([...projMap.values()].flatMap((v) => [...v.people])).size;
        monthOut.set(m, { projects, totalHours, totalPeople });
      }
      out.set(pod, monthOut);
    }
    return out;
  }, [assignments, podByEmployee, pods]);

  // Count team members without a pod so we can nudge admins to fix it.
  // "Team members" here = distinct employee names on forecast_assignments.
  const noPodCount = useMemo(() => {
    const allNames = new Set(assignments.map((a) => a.employeeName));
    let missing = 0;
    for (const n of allNames) {
      if (!podByEmployee.has(n.toLowerCase().trim())) missing++;
    }
    return missing;
  }, [assignments, podByEmployee]);

  if (pods.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        <div className="text-base font-semibold text-slate-700 mb-1">No pods assigned yet</div>
        <p>
          Open the <span className="font-medium text-slate-800">People</span> tab,
          pick a resource, and set their <span className="font-medium text-slate-800">Pod</span>{' '}
          (e.g. <span className="font-medium">Pod 1</span>). Pods will start showing up here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {noPodCount > 0 && (
        <div className="mb-3 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
          {noPodCount} team member{noPodCount === 1 ? '' : 's'} without a pod — set one on the <span className="font-semibold">People</span> tab so they show up here.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold uppercase tracking-wide text-[10px] text-slate-500 border-b border-slate-200">
                Pod
              </th>
              {MONTHS.map((m) => (
                <th
                  key={m}
                  className="px-2 py-2 text-center font-semibold uppercase tracking-wide text-[10px] text-slate-500 border-b border-slate-200 min-w-[110px]"
                >
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pods.map((pod) => {
              const roster = podRoster.get(pod) ?? [];
              const row = matrix.get(pod);
              return (
                <tr key={pod} className="hover:bg-slate-50/50">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 align-top border-b border-slate-100">
                    <div className="font-bold text-slate-800">{pod}</div>
                    <div className="text-[10px] text-slate-500">{roster.length} {roster.length === 1 ? 'member' : 'members'}</div>
                    <div className="text-[10px] text-slate-400 truncate max-w-[180px]" title={roster.join(', ')}>
                      {roster.slice(0, 3).map((n) => n.split(' ')[0]).join(', ')}
                      {roster.length > 3 ? ` +${roster.length - 3}` : ''}
                    </div>
                  </td>
                  {MONTHS.map((m) => {
                    const cell = row?.get(m);
                    if (!cell || cell.projects.length === 0) {
                      return (
                        <td key={m} className="px-2 py-2 text-center align-top border-b border-slate-100 text-slate-300">
                          —
                        </td>
                      );
                    }
                    return (
                      <td key={m} className="px-2 py-2 align-top border-b border-slate-100">
                        <div className="space-y-1">
                          {cell.projects.map((p) => (
                            <div
                              key={p.name}
                              className="rounded-md bg-indigo-50 border border-indigo-100 px-1.5 py-1 text-[10px] leading-tight"
                              title={`${p.name} — ${Math.round(p.hours)} hrs across ${p.peopleCount} ${p.peopleCount === 1 ? 'person' : 'people'}`}
                            >
                              <div className="font-semibold text-indigo-800 truncate">{p.name}</div>
                              <div className="text-indigo-600/80 tabular-nums">
                                {Math.round(p.hours)}h · {p.peopleCount}p
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-1 text-[9px] text-slate-400 uppercase tracking-wide text-right">
                          {Math.round(cell.totalHours)}h total
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[10px] text-slate-500">
        Each cell lists the projects that have any forecast hours from members of that pod in that month.
        The badge shows <span className="font-mono">{'{project}'}</span>, hours, and distinct people count.
        Pods come from the <span className="font-medium">Pod</span> field on the <span className="font-medium">People</span> tab.
      </p>
    </div>
  );
}
