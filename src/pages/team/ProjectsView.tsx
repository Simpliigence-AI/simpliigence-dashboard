import { useCallback, useMemo, useState } from 'react';
import { ArrowRight, Plus, Search, Trash2 } from 'lucide-react';
import { useForecastStore, usePipelineStore } from '../../store';
import { MONTHS, emptyMonthRecord } from '../../types/forecast';
import type { Month, ForecastAssignment } from '../../types/forecast';
import {
  buildProjectOptions,
  groupOptionsBySource,
  SOURCE_LABEL,
  colorHash,
  getInitials,
  groupAssignments,
  type ProjectSource,
} from './shared';
import { AllocationStrip } from './AllocationStrip';

interface ProjectCard {
  name: string;
  source: ProjectSource;
  assignments: ForecastAssignment[];
  totalHours: number;
}

export default function ProjectsView() {
  const assignments = useForecastStore((s) => s.assignments);
  const pipelineProjects = usePipelineStore((s) => s.projects);
  const {
    addAssignment,
    removeAssignment,
    updateMonthlyHours,
    updateWeeklyHours,
  } = useForecastStore();

  const year = new Date().getFullYear();

  const projectOptions = useMemo(
    () => buildProjectOptions(pipelineProjects, assignments),
    [pipelineProjects, assignments],
  );
  const groupedOptions = useMemo(() => groupOptionsBySource(projectOptions), [projectOptions]);
  const sourceByValue = useMemo(() => {
    const map = new Map<string, ProjectSource>();
    for (const o of projectOptions) map.set(o.value, o.source);
    return map;
  }, [projectOptions]);

  const cards: ProjectCard[] = useMemo(() => {
    const byProject = new Map<string, ForecastAssignment[]>();
    for (const a of assignments) {
      if (!byProject.has(a.project)) byProject.set(a.project, []);
      byProject.get(a.project)!.push(a);
    }
    const out: ProjectCard[] = [];
    for (const [name, list] of byProject.entries()) {
      const total = list.reduce(
        (s, a) => s + MONTHS.reduce((ss, m) => ss + (a.monthlyTotals[m] ?? 0), 0),
        0,
      );
      out.push({
        name,
        source: sourceByValue.get(name) ?? 'legacy',
        assignments: list.sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
        totalHours: total,
      });
    }
    return out.sort((a, b) => b.totalHours - a.totalHours);
  }, [assignments, sourceByValue]);

  const allPeople = useMemo(() => groupAssignments(assignments), [assignments]);

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'' | ProjectSource>('');
  const [assigningTo, setAssigningTo] = useState<string | null>(null);
  const [movingFrom, setMovingFrom] = useState<{ empName: string; project: string } | null>(null);

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (sourceFilter && c.source !== sourceFilter) return false;
      return true;
    });
  }, [cards, search, sourceFilter]);

  const handleApplyMonthly = useCallback(
    (empName: string, project: string) => (months: Month[], hours: number) => {
      for (const m of months) updateMonthlyHours(empName, project, m, hours);
    },
    [updateMonthlyHours],
  );

  const handleApplyWeekly = useCallback(
    (empName: string, project: string) => (weekDate: string, hours: number) => {
      updateWeeklyHours(empName, project, weekDate, hours);
    },
    [updateWeeklyHours],
  );

  const handleAssignPerson = useCallback(
    (project: string, empName: string) => {
      const existing = assignments.find((a) => a.employeeName === empName);
      addAssignment({
        id: '',
        employeeName: empName,
        notes: '',
        role: existing?.role ?? '',
        rateCard: existing?.rateCard ?? null,
        isSI: existing?.isSI ?? false,
        isContractor: existing?.isContractor ?? false,
        project,
        weeklyHours: {},
        monthlyTotals: emptyMonthRecord(),
      });
      setAssigningTo(null);
    },
    [assignments, addAssignment],
  );

  const handleMoveAssignment = useCallback(
    (empName: string, fromProject: string, toProject: string) => {
      const source = assignments.find(
        (a) => a.employeeName === empName && a.project === fromProject,
      );
      if (!source) return;
      const existingAtTarget = assignments.find(
        (a) => a.employeeName === empName && a.project === toProject,
      );
      if (existingAtTarget) {
        // Merge hours into existing target row
        for (const m of MONTHS) {
          const merged = (existingAtTarget.monthlyTotals[m] ?? 0) + (source.monthlyTotals[m] ?? 0);
          if (merged > 0) updateMonthlyHours(empName, toProject, m, merged);
        }
        for (const [wk, hrs] of Object.entries(source.weeklyHours)) {
          if (hrs) updateWeeklyHours(empName, toProject, wk, (existingAtTarget.weeklyHours[wk] ?? 0) + hrs);
        }
      } else {
        addAssignment({
          ...source,
          id: '',
          project: toProject,
          monthlyTotals: { ...source.monthlyTotals },
          weeklyHours: { ...source.weeklyHours },
        });
      }
      const idx = assignments.findIndex(
        (a) => a.employeeName === empName && a.project === fromProject,
      );
      if (idx >= 0) removeAssignment(idx);
      setMovingFrom(null);
    },
    [assignments, addAssignment, removeAssignment, updateMonthlyHours, updateWeeklyHours],
  );

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-300 pl-8 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as '' | ProjectSource)}
          className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
        >
          <option value="">All sources</option>
          <option value="current">Current Projects (Zoho)</option>
          <option value="pipeline">Pipeline (Planned)</option>
          <option value="legacy">Other (legacy)</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
          {cards.length === 0 ? 'No projects with allocations yet.' : 'No projects match the filter.'}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((card) => {
            const hue = colorHash(card.name);
            const assignedNames = new Set(card.assignments.map((a) => a.employeeName));
            const availablePeople = allPeople.filter((p) => !assignedNames.has(p.name));

            return (
              <div key={card.name} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div
                  className="px-4 py-3 flex items-center justify-between gap-3 border-b border-slate-100"
                  style={{ backgroundColor: `hsl(${hue} 70% 97%)` }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-2 h-10 rounded-full"
                      style={{ backgroundColor: `hsl(${hue} 60% 55%)` }}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-slate-800 truncate">{card.name}</h3>
                        <SourceBadge source={card.source} />
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {card.assignments.length} {card.assignments.length === 1 ? 'person' : 'people'} ·{' '}
                        <span className="font-semibold text-slate-700 tabular-nums">{card.totalHours.toLocaleString()} hrs/yr</span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setAssigningTo(card.name)}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-primary/40 text-slate-700 flex items-center gap-1"
                  >
                    <Plus size={12} /> Assign
                  </button>
                </div>

                {assigningTo === card.name && (
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                    <select
                      autoFocus
                      defaultValue=""
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) return;
                        handleAssignPerson(card.name, v);
                      }}
                      className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">Pick someone to assign…</option>
                      {availablePeople.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name} {p.role ? `— ${p.role}` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setAssigningTo(null)}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                <div className="divide-y divide-slate-50">
                  {card.assignments.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-slate-400 text-center">
                      No one assigned yet. Click <span className="font-semibold">+ Assign</span> to add a person.
                    </div>
                  ) : (
                    card.assignments.map((a) => {
                      const total = MONTHS.reduce((s, m) => s + (a.monthlyTotals[m] ?? 0), 0);
                      const personHue = colorHash(a.employeeName);
                      const isMoving = movingFrom?.empName === a.employeeName && movingFrom?.project === card.name;
                      const otherProjects = cards
                        .filter((c) => c.name !== card.name)
                        .map((c) => c.name);

                      return (
                        <div key={`${card.name}-${a.employeeName}`} className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <div
                              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                              style={{
                                backgroundColor: `hsl(${personHue} 70% 90%)`,
                                color: `hsl(${personHue} 60% 30%)`,
                              }}
                            >
                              {getInitials(a.employeeName)}
                            </div>
                            <div className="w-40 shrink-0 min-w-0">
                              <div className="text-sm font-medium text-slate-800 truncate">{a.employeeName}</div>
                              <div className="text-[11px] text-slate-500 truncate">{a.role || '—'}</div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <AllocationStrip
                                employeeName={a.employeeName}
                                project={card.name}
                                monthlyTotals={a.monthlyTotals}
                                weeklyHours={a.weeklyHours}
                                year={year}
                                compact
                                onChangeMonthly={handleApplyMonthly(a.employeeName, card.name)}
                                onChangeWeekly={handleApplyWeekly(a.employeeName, card.name)}
                              />
                            </div>
                            <div className="w-14 shrink-0 text-right tabular-nums">
                              <div className="text-sm font-bold text-slate-700">{total > 0 ? total : '—'}</div>
                              <div className="text-[9px] text-slate-400 uppercase">hrs/yr</div>
                            </div>
                            <div className="shrink-0 flex items-center gap-1">
                              <button
                                onClick={() => setMovingFrom(isMoving ? null : { empName: a.employeeName, project: card.name })}
                                className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                                title="Move to another project"
                              >
                                <ArrowRight size={14} />
                              </button>
                              <button
                                onClick={() => {
                                  const idx = assignments.findIndex(
                                    (x) => x.employeeName === a.employeeName && x.project === card.name,
                                  );
                                  if (idx >= 0) removeAssignment(idx);
                                }}
                                className="p-1.5 rounded hover:bg-red-50 text-slate-300 hover:text-red-500"
                                title="Remove from project"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                          {isMoving && (
                            <div className="mt-2 pl-10 flex items-center gap-2">
                              <span className="text-xs text-slate-500">Move all hours to:</span>
                              <select
                                autoFocus
                                defaultValue=""
                                onChange={(e) => {
                                  const target = e.target.value;
                                  if (!target) return;
                                  if (target === '__new__') {
                                    const name = prompt('Move to new project name:');
                                    if (name && name.trim()) handleMoveAssignment(a.employeeName, card.name, name.trim());
                                    else setMovingFrom(null);
                                  } else {
                                    handleMoveAssignment(a.employeeName, card.name, target);
                                  }
                                }}
                                className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                              >
                                <option value="">Pick a project…</option>
                                {otherProjects.map((p) => (
                                  <option key={p} value={p}>{p}</option>
                                ))}
                                {(['current', 'pipeline'] as ProjectSource[]).map((src) => {
                                  const opts = groupedOptions[src].filter(
                                    (o) => o.value !== card.name && !otherProjects.includes(o.value),
                                  );
                                  return opts.length > 0 ? (
                                    <optgroup key={src} label={SOURCE_LABEL[src]}>
                                      {opts.map((o) => (
                                        <option key={o.value} value={o.value}>
                                          {o.label === o.value ? o.label : `${o.label} → ${o.value}`}
                                        </option>
                                      ))}
                                    </optgroup>
                                  ) : null;
                                })}
                                <option value="__new__">+ New project</option>
                              </select>
                              <button
                                onClick={() => setMovingFrom(null)}
                                className="text-xs text-slate-400 hover:text-slate-600"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-400 leading-relaxed">
        Tip — click any month bar to set hours. Use the arrow icon to move a person to another project (their hours come with them).
      </p>
    </div>
  );
}

function SourceBadge({ source }: { source: ProjectSource }) {
  const cls =
    source === 'current'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : source === 'pipeline'
        ? 'bg-sky-50 text-sky-700 border-sky-200'
        : 'bg-slate-100 text-slate-500 border-slate-200';
  const label = source === 'current' ? 'Current' : source === 'pipeline' ? 'Pipeline' : 'Legacy';
  return (
    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-medium rounded border ${cls}`}>
      {label}
    </span>
  );
}
