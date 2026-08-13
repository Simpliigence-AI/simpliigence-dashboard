import { useCallback, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Plus, Search, Trash2 } from 'lucide-react';
import { useForecastStore, usePipelineStore } from '../../store';
import { usePodAssignmentsStore } from '../../store/usePodAssignmentsStore';
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
import { useCollapsedGroups } from '../../lib/useCollapsedGroups';

interface ProjectCard {
  name: string;
  source: ProjectSource;
  assignments: ForecastAssignment[];
  totalHours: number;
  /** No recent and no planned allocation — see isProjectCompleted(). */
  completed: boolean;
  /** Last month with any allocated hours; null if the project has none at all. */
  lastActiveMonth: Month | null;
  /** Pod with the most assigned resources on this project (majority wins,
   *  ties broken alphabetically). null if nobody on the project has a
   *  pod assignment yet. */
  primaryPod: string | null;
}

/** Compute the majority pod on a project. Returns null if no assigned
 *  resource has a pod set. Ties break alphabetically. */
function primaryPodFor(list: ForecastAssignment[], podByEmployee: Map<string, string>): string | null {
  const counts = new Map<string, number>();
  for (const a of list) {
    const p = podByEmployee.get(a.employeeName.toLowerCase().trim());
    if (!p) continue;
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return sorted[0][0];
}

/**
 * A project counts as completed when nobody is allocated to it in the
 * previous month, the current month, or ANY month still to come this year.
 *
 * The "and nothing to come" half matters: a project that's quiet right now
 * but has people booked from September is ramping up, not finished, and
 * archiving it would hide live work. Checking from (currentMonth - 1)
 * through December covers both halves in one sweep.
 *
 * This is derived, never stored — so a completed project reappears under
 * Active by itself the moment someone allocates hours to it again. Nothing
 * is deleted or hidden permanently.
 */
function completionCutoffIndex(now = new Date()): number {
  return Math.max(0, now.getMonth() - 1);
}

function isProjectCompleted(list: ForecastAssignment[], cutoffIdx: number): boolean {
  for (let i = cutoffIdx; i < MONTHS.length; i++) {
    const m = MONTHS[i];
    for (const a of list) {
      if ((a.monthlyTotals[m] ?? 0) > 0) return false;
    }
  }
  return true;
}

/** Latest month (across everyone on the project) that has hours on it. */
function lastAllocatedMonth(list: ForecastAssignment[]): Month | null {
  for (let i = MONTHS.length - 1; i >= 0; i--) {
    const m = MONTHS[i];
    for (const a of list) {
      if ((a.monthlyTotals[m] ?? 0) > 0) return m;
    }
  }
  return null;
}

export default function ProjectsView() {
  const assignments = useForecastStore((s) => s.assignments);
  const pipelineProjects = usePipelineStore((s) => s.projects);
  /** Pod assignments live in project_team_pods, edited on the People tab.
   *  DO NOT read from india_roster — that's the T&M team, different roster. */
  const podByEmployee = usePodAssignmentsStore((s) => s.byName);
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
    const cutoffIdx = completionCutoffIndex();
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
        completed: isProjectCompleted(list, cutoffIdx),
        lastActiveMonth: lastAllocatedMonth(list),
        primaryPod: primaryPodFor(list, podByEmployee),
      });
    }
    return out.sort((a, b) => b.totalHours - a.totalHours);
  }, [assignments, sourceByValue, podByEmployee]);

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

  const activeCards = useMemo(() => filtered.filter((c) => !c.completed), [filtered]);
  const completedCards = useMemo(() => filtered.filter((c) => c.completed), [filtered]);

  /** Completed section starts collapsed — it's reference, not daily work. */
  const [showCompleted, setShowCompleted] = useState(false);

  // Collapsed by default: the allocation grid is ~10 rows per project, so an
  // all-expanded page is several screens of scrolling before you reach the
  // project you came for. The collapsed header still carries the headline
  // numbers and the names, so it stays useful without being opened.
  const { isCollapsed, toggle, expand, expandAll, collapseAll } =
    useCollapsedGroups('team-projects', { defaultCollapsed: true });
  // Only cards actually on screen. Completed cards live inside their own
  // collapsed section, so including them would let "Collapse all" report on —
  // and act on — headers nobody can see: the button would read "Collapse all"
  // with everything already collapsed, then appear to do nothing when clicked.
  const visibleKeys = useMemo(
    () => (showCompleted ? filtered : activeCards).map((c) => c.name),
    [filtered, activeCards, showCompleted],
  );
  const anyExpanded = visibleKeys.some((k) => !isCollapsed(k));

  // Human-readable description of the rule, shown on the section header so
  // nobody has to guess why a project landed in here.
  const cutoffLabel = MONTHS[completionCutoffIndex()];

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

  /** One project card. Shared by the Active and Completed sections so the
   *  two render identically — `muted` only dials back the visual weight. */
  const renderCard = (card: ProjectCard, muted = false) => {
            const hue = colorHash(card.name);
            const assignedNames = new Set(card.assignments.map((a) => a.employeeName));
            const availablePeople = allPeople.filter((p) => !assignedNames.has(p.name));
            // Assigning into a collapsed card force-expands it, otherwise the
            // picker (and the person you just added) would be hidden.
            const collapsed = isCollapsed(card.name) && assigningTo !== card.name;

            return (
              <div key={card.name} className={`bg-white rounded-xl border overflow-hidden ${muted ? 'border-slate-200 opacity-75 hover:opacity-100 transition-opacity' : 'border-slate-200'}`}>
                <div
                  className={`px-4 py-3 flex items-center justify-between gap-3 ${collapsed ? '' : 'border-b border-slate-100'}`}
                  style={{ backgroundColor: `hsl(${hue} 70% 97%)` }}
                >
                  {/* The whole left side is the toggle — a 2px chevron is a mean
                   *  click target when you're collapsing a dozen of these. */}
                  <button
                    type="button"
                    onClick={() => toggle(card.name)}
                    aria-expanded={!collapsed}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left group"
                  >
                    <div
                      className="w-2 h-10 rounded-full shrink-0"
                      style={{ backgroundColor: `hsl(${hue} 60% 55%)` }}
                    />
                    <span className="shrink-0 text-slate-400 group-hover:text-slate-600">
                      {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-slate-800 truncate">{card.name}</h3>
                        <SourceBadge source={card.source} />
                        {card.primaryPod && (
                          <span
                            className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200"
                            title={`Primary pod on this project — resources not from ${card.primaryPod} are marked with *`}
                          >
                            {card.primaryPod}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {card.assignments.length} {card.assignments.length === 1 ? 'person' : 'people'} ·{' '}
                        <span className="font-semibold text-slate-700 tabular-nums">{card.totalHours.toLocaleString()} hrs/yr</span>
                        {collapsed && card.assignments.length > 0 && (
                          <span className="text-slate-400"> · {card.assignments.map((a) => a.employeeName.split(' ')[0]).join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => { expand(card.name); setAssigningTo(card.name); }}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-primary/40 text-slate-700 flex items-center gap-1"
                  >
                    <Plus size={12} /> Assign
                  </button>
                </div>
                {!collapsed && (<>

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
                              <div className="text-sm font-medium text-slate-800 truncate flex items-center gap-1">
                                <span className="truncate">{a.employeeName}</span>
                                {(() => {
                                  const pod = podByEmployee.get(a.employeeName.toLowerCase().trim());
                                  if (!pod) return null;
                                  const isOutsider = card.primaryPod != null && pod !== card.primaryPod;
                                  return (
                                    <span
                                      className={`shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                        isOutsider
                                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                          : 'bg-indigo-50 text-indigo-700 border border-indigo-100'
                                      }`}
                                      title={isOutsider
                                        ? `${pod} — borrowed from another pod (primary here is ${card.primaryPod})`
                                        : `${pod}${card.primaryPod ? ' — primary pod on this project' : ''}`}
                                    >
                                      {pod}{isOutsider ? '*' : ''}
                                    </span>
                                  );
                                })()}
                              </div>
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
                </>)}
              </div>
            );
  };

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
        {/* One button rather than a pair: which action is useful is always
         *  determined by the current state, so offering both wastes a slot. */}
        <button
          type="button"
          onClick={() => (anyExpanded ? collapseAll(visibleKeys) : expandAll(visibleKeys))}
          className="shrink-0 px-3 py-1.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
        >
          {anyExpanded ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          {anyExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
          {cards.length === 0 ? 'No projects with allocations yet.' : 'No projects match the filter.'}
        </div>
      ) : (
        <>
          {/* ── Active ── */}
          {activeCards.length > 0 && (
            <div className="space-y-4">
              {activeCards.map((card) => renderCard(card))}
            </div>
          )}
          {activeCards.length === 0 && completedCards.length > 0 && (
            <div className="text-center py-10 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
              No active projects — everything matching this filter has wrapped up.
            </div>
          )}

          {/* ── Completed ──
              Auto-derived, collapsed by default. Nothing is deleted: a project
              reappears above the moment someone allocates hours to it again. */}
          {completedCards.length > 0 && (
            <div className={activeCards.length > 0 ? 'mt-6' : 'mt-4'}>
              <button
                type="button"
                onClick={() => setShowCompleted((v) => !v)}
                className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
                aria-expanded={showCompleted}
              >
                {showCompleted
                  ? <ChevronDown size={16} className="text-slate-400 shrink-0" />
                  : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                <CheckCircle2 size={15} className="text-slate-400 shrink-0" />
                <span className="text-sm font-bold text-slate-700">Completed projects</span>
                <span className="text-[11px] font-semibold bg-slate-200 text-slate-600 rounded-full px-2 py-0.5 tabular-nums">
                  {completedCards.length}
                </span>
                <span className="text-[11px] text-slate-400 truncate">
                  no allocation since {cutoffLabel} — and none booked ahead
                </span>
                <span className="ml-auto text-[11px] text-slate-400 shrink-0">
                  {showCompleted ? 'Hide' : 'Show'}
                </span>
              </button>

              {showCompleted && (
                <div className="space-y-4 mt-3">
                  {completedCards.map((card) => (
                    <div key={card.name} className="relative">
                      {/* Ribbon carrying the "why" — last month with hours */}
                      <div className="absolute -top-2 left-4 z-10 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-slate-600 text-white px-2 py-0.5 rounded-full shadow-sm">
                        <CheckCircle2 size={10} />
                        {card.lastActiveMonth ? `Last allocated ${card.lastActiveMonth}` : 'Never allocated'}
                      </div>
                      {renderCard(card, true)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <p className="mt-4 text-[11px] text-slate-400 leading-relaxed">
        Tip — click any month bar to set hours. Use the arrow icon to move a person to another project (their hours come with them).
        A project moves to <span className="font-semibold text-slate-500">Completed</span> automatically when it has no hours
        in {cutoffLabel}, this month, or any month ahead — and moves straight back once you allocate to it again.
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
