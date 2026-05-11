import { useCallback, useMemo, useState } from 'react';
import { Plus, Search, Trash2, X } from 'lucide-react';
import { Badge } from '../../components/ui';
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
  roleBucket,
  BUCKET_ORDER,
  type ProjectSource,
} from './shared';
import { AllocationStrip, AllocationStripRow } from './AllocationStrip';
import { AddResourceForm } from './TableView';

export default function PeopleView() {
  const assignments = useForecastStore((s) => s.assignments);
  const pipelineProjects = usePipelineStore((s) => s.projects);
  const {
    addAssignment,
    removeEmployee,
    removeAssignment,
    updateMonthlyHours,
    updateWeeklyHours,
    renameEmployee,
    updateEmployeeRole,
    updateEmployeeRate,
    updateEmployeeType,
  } = useForecastStore();

  const year = new Date().getFullYear();

  const groups = useMemo(() => groupAssignments(assignments), [assignments]);
  const projectOptions = useMemo(
    () => buildProjectOptions(pipelineProjects, assignments),
    [pipelineProjects, assignments],
  );
  const groupedOptions = useMemo(() => groupOptionsBySource(projectOptions), [projectOptions]);
  const roles = useMemo(() => [...new Set(groups.map((g) => g.role).filter(Boolean))].sort(), [groups]);

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [groupByRole, setGroupByRole] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(groups[0]?.name ?? null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [addingProject, setAddingProject] = useState(false);

  const filtered = useMemo(() => {
    return groups.filter((g) => {
      if (search && !g.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (roleFilter && g.role !== roleFilter) return false;
      return true;
    });
  }, [groups, search, roleFilter]);

  const sections = useMemo(() => {
    if (!groupByRole) return [{ bucket: null as string | null, items: filtered }];
    const map = new Map<string, typeof filtered>();
    for (const g of filtered) {
      const b = roleBucket(g.role);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(g);
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        const ai = BUCKET_ORDER.indexOf(a);
        const bi = BUCKET_ORDER.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
      .map(([bucket, items]) => ({ bucket, items }));
  }, [groupByRole, filtered]);

  const selected = useMemo(
    () => filtered.find((g) => g.name === selectedName) ?? filtered[0] ?? null,
    [filtered, selectedName],
  );

  const handleApplyMonthly = useCallback(
    (project: string) => (months: Month[], hours: number) => {
      if (!selected) return;
      for (const m of months) updateMonthlyHours(selected.name, project, m, hours);
    },
    [selected, updateMonthlyHours],
  );

  const handleApplyWeekly = useCallback(
    (project: string) => (weekDate: string, hours: number) => {
      if (!selected) return;
      updateWeeklyHours(selected.name, project, weekDate, hours);
    },
    [selected, updateWeeklyHours],
  );

  const handleAddProject = useCallback(
    (projectName: string) => {
      if (!selected) return;
      const existing = assignments.find((a) => a.employeeName === selected.name);
      addAssignment({
        id: '',
        employeeName: selected.name,
        notes: '',
        role: existing?.role ?? '',
        rateCard: existing?.rateCard ?? null,
        isSI: existing?.isSI ?? false,
        isContractor: existing?.isContractor ?? false,
        project: projectName,
        weeklyHours: {},
        monthlyTotals: emptyMonthRecord(),
      });
      setAddingProject(false);
    },
    [selected, assignments, addAssignment],
  );

  const handleAddResource = useCallback(
    (a: ForecastAssignment) => {
      addAssignment(a);
      setSelectedName(a.employeeName);
      setShowAddForm(false);
    },
    [addAssignment],
  );

  return (
    <div className="flex flex-col lg:flex-row gap-4 min-h-[600px]">
      {/* ── Master list ─────────────────────── */}
      <div className="lg:w-80 shrink-0 flex flex-col">
        <div className="flex gap-2 mb-3">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search people..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-300 pl-8 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <button
            onClick={() => setShowAddForm((v) => !v)}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary/90 flex items-center gap-1"
            title="Add new resource"
          >
            <Plus size={14} /> Add
          </button>
        </div>

        <div className="flex gap-2 mb-3 text-xs">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-xs"
          >
            <option value="">All Roles</option>
            {roles.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button
            onClick={() => setGroupByRole((v) => !v)}
            className={`px-2 py-1 rounded-lg border text-xs transition-colors ${
              groupByRole ? 'bg-primary/10 border-primary/40 text-primary font-semibold' : 'bg-white border-slate-300 text-slate-600'
            }`}
            title="Group by role"
          >
            {groupByRole ? '✓ Grouped' : 'Group'}
          </button>
        </div>

        {showAddForm && (
          <div className="mb-3">
            <AddResourceForm
              roles={roles}
              projectOptions={projectOptions}
              onAdd={handleAddResource}
              onCancel={() => setShowAddForm(false)}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-0.5 pr-1 -mr-1">
          {sections.map((s) => (
            <div key={s.bucket ?? '_'}>
              {s.bucket && (
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50 sticky top-0 z-10">
                  {s.bucket} · {s.items.length}
                </div>
              )}
              {s.items.map((g) => {
                const isSel = selected?.name === g.name;
                const yearCap = 12 * 160;
                const utilPct = Math.min((g.totalHours / yearCap) * 100, 130);
                return (
                  <button
                    key={g.name}
                    onClick={() => setSelectedName(g.name)}
                    className={`w-full text-left p-2 rounded-lg flex items-center gap-2 transition-colors ${
                      isSel ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div
                      className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        backgroundColor: `hsl(${colorHash(g.name)} 70% 90%)`,
                        color: `hsl(${colorHash(g.name)} 60% 30%)`,
                      }}
                    >
                      {getInitials(g.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800 truncate">{g.name}</span>
                        <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{Math.round(utilPct)}%</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-slate-500 truncate">{g.role || 'No role'}</span>
                        {g.assignments.length > 0 && (
                          <span className="text-[9px] text-slate-400 shrink-0">· {g.assignments.length}p</span>
                        )}
                      </div>
                      <div className="mt-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            utilPct >= 80 ? 'bg-emerald-500' : utilPct >= 50 ? 'bg-sky-500' : utilPct > 0 ? 'bg-amber-400' : 'bg-slate-200'
                          }`}
                          style={{ width: `${Math.min(utilPct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-slate-400 text-sm">
              {groups.length === 0 ? 'No team yet. Click + Add.' : 'No matches.'}
            </div>
          )}
        </div>
      </div>

      {/* ── Detail pane ─────────────────────── */}
      <div className="flex-1 min-w-0">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl py-16">
            Select a person to view and edit their allocations.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold"
                  style={{
                    backgroundColor: `hsl(${colorHash(selected.name)} 70% 88%)`,
                    color: `hsl(${colorHash(selected.name)} 60% 28%)`,
                  }}
                >
                  {getInitials(selected.name)}
                </div>
                <div>
                  <EditableField
                    value={selected.name}
                    onSave={(v) => v && v !== selected.name && (renameEmployee(selected.name, v), setSelectedName(v))}
                    className="text-xl font-bold text-slate-900"
                  />
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                    <EditableField
                      value={selected.role || ''}
                      placeholder="Role"
                      onSave={(v) => updateEmployeeRole(selected.name, v)}
                    />
                    <span>·</span>
                    <EditableField
                      value={selected.rateCard != null ? `$${selected.rateCard}` : ''}
                      placeholder="Rate"
                      onSave={(v) => {
                        const n = parseFloat(v.replace(/[^0-9.]/g, ''));
                        updateEmployeeRate(selected.name, n > 0 ? n : null);
                      }}
                    />
                    <span>·</span>
                    <button
                      onClick={() => {
                        const { isSI, isContractor } = selected;
                        if (!isSI && !isContractor) updateEmployeeType(selected.name, true, false);
                        else if (isSI) updateEmployeeType(selected.name, false, true);
                        else updateEmployeeType(selected.name, false, false);
                      }}
                      title="Click to change type"
                    >
                      {selected.isContractor ? (
                        <Badge variant="warning">Contractor</Badge>
                      ) : selected.isSI ? (
                        <Badge variant="info">SI</Badge>
                      ) : (
                        <Badge variant="neutral">Employee</Badge>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <StatBlock label="Year" value={selected.totalHours} unit="hrs" />
                <StatBlock
                  label="Util"
                  value={Math.round((selected.totalHours / (12 * 160)) * 100)}
                  unit="%"
                />
                <button
                  onClick={() => setConfirmDelete(selected.name)}
                  className="p-2 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50"
                  title="Remove resource"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {confirmDelete === selected.name && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4 flex items-center justify-between">
                <span className="text-sm text-red-700">Remove <strong>{selected.name}</strong> and all their allocations?</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      removeEmployee(selected.name);
                      setConfirmDelete(null);
                      setSelectedName(null);
                    }}
                    className="px-3 py-1 text-sm font-medium rounded bg-red-600 text-white hover:bg-red-700"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="px-3 py-1 text-sm font-medium rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Year row */}
            <div className="flex items-center gap-3 text-[10px] text-slate-400 uppercase tracking-wider mb-1 px-1">
              <span className="w-40 shrink-0">Project</span>
              <span className="flex-1">
                <span className="grid grid-cols-12 gap-0.5">
                  {MONTHS.map((m) => (
                    <span key={m} className="text-center">{m}</span>
                  ))}
                </span>
              </span>
              <span className="shrink-0 w-16 text-right">Total</span>
            </div>

            {/* Allocation strips */}
            <div className="space-y-1">
              {selected.assignments.map((a) => {
                const total = MONTHS.reduce((s, m) => s + (a.monthlyTotals[m] ?? 0), 0);
                return (
                  <AllocationStripRow
                    key={a.project}
                    label={a.project}
                    hue={colorHash(a.project)}
                    trailing={
                      <div className="flex items-center gap-1.5 w-16 justify-end">
                        <span className="text-xs font-bold tabular-nums text-slate-700">
                          {total > 0 ? total : '—'}
                        </span>
                        {selected.assignments.length > 1 && (
                          <button
                            onClick={() => {
                              const idx = assignments.findIndex(
                                (x) => x.employeeName === selected.name && x.project === a.project,
                              );
                              if (idx >= 0) removeAssignment(idx);
                            }}
                            className="text-slate-300 hover:text-red-400"
                            title="Remove project"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    }
                  >
                    <AllocationStrip
                      employeeName={selected.name}
                      project={a.project}
                      monthlyTotals={a.monthlyTotals}
                      weeklyHours={a.weeklyHours}
                      year={year}
                      onChangeMonthly={handleApplyMonthly(a.project)}
                      onChangeWeekly={handleApplyWeekly(a.project)}
                    />
                  </AllocationStripRow>
                );
              })}

              {/* Add project row */}
              <div className="pt-2 border-t border-slate-100 mt-2">
                {addingProject ? (
                  <div className="flex items-center gap-2">
                    <select
                      autoFocus
                      className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      defaultValue=""
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) return;
                        if (val === '__new__') {
                          const name = prompt('New project name:');
                          if (name && name.trim()) handleAddProject(name.trim());
                          else setAddingProject(false);
                        } else {
                          handleAddProject(val);
                        }
                      }}
                    >
                      <option value="">Select project to add...</option>
                      {(['current', 'pipeline', 'legacy'] as ProjectSource[]).map((src) => {
                        const opts = groupedOptions[src].filter(
                          (o) => !selected.assignments.some((a) => a.project === o.value),
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
                      <option value="__new__">+ Custom project</option>
                    </select>
                    <button
                      onClick={() => setAddingProject(false)}
                      className="text-xs text-slate-400 hover:text-slate-600"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingProject(true)}
                    className="text-sm text-primary/70 hover:text-primary font-medium flex items-center gap-1.5"
                  >
                    <Plus size={14} /> Add project
                  </button>
                )}
              </div>
            </div>

            <p className="mt-5 text-[11px] text-slate-400 leading-relaxed">
              Tip — click any month bar to set hours. Use the presets (Full / Half / Quarter / Off), the +/- stepper for fine-tuning, or “Apply to” to fill multiple months at once. Need weekly precision? Hit “Edit by week →” inside the popover.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBlock({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="text-right">
      <div className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</div>
      <div className="text-base font-bold tabular-nums text-slate-800">
        {value > 0 ? value.toLocaleString() : '—'}
        <span className="text-[10px] text-slate-400 ml-0.5">{unit}</span>
      </div>
    </div>
  );
}

function EditableField({
  value,
  onSave,
  placeholder = '—',
  className = '',
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft !== value) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={`rounded border border-primary/40 bg-white px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/50 ${className}`}
      />
    );
  }
  return (
    <button
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={`hover:text-primary text-left ${className}`}
    >
      {value || <span className="text-slate-300">{placeholder}</span>}
    </button>
  );
}
