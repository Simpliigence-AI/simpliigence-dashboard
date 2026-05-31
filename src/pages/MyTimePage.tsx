/**
 * My Time — employee daily time entry.
 *
 * Mobile-first layout: a week picker, day cards Mon → Sun, each day expandable
 * to one or more time entries against projects. Project dropdown is filtered
 * to:
 *   1. Pipeline projects the user is forecasted to (forecast_assignments
 *      where employee_name matches the user's full_name / email).
 *   2. Pipeline projects they've previously logged time on (stickiness).
 *   3. Internal / non-billable buckets (Admin, Bench, Leave, etc.).
 *
 * Hours support 0.25 increments. Billable toggle. Optional notes. Saving fires
 * useTimeEntryStore.addEntry / updateEntry which writes to Supabase and
 * broadcasts via realtime.
 *
 * Mini stat strip at the bottom: this-week logged vs forecast for awareness.
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Save, Trash2, X } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useAuthStore } from '../store/useAuthStore';
import { useForecastStore } from '../store/useForecastStore';
import { usePipelineStore } from '../store/usePipelineStore';
import { useTimeEntryStore } from '../store/useTimeEntryStore';
import { INTERNAL_PROJECTS } from '../types/timeEntry';
import type { TimeEntry } from '../types/timeEntry';

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeek(iso: string): Date {
  const d = new Date(iso);
  const day = d.getDay() || 7;
  if (day !== 1) d.setDate(d.getDate() - (day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

function weekDays(weekStartIso: string): { iso: string; label: string; isToday: boolean }[] {
  const start = startOfWeek(weekStartIso);
  const todayIso = toIsoDate(new Date());
  const days: { iso: string; label: string; isToday: boolean }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const iso = toIsoDate(d);
    days.push({
      iso,
      label: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      isToday: iso === todayIso,
    });
  }
  return days;
}

export default function MyTimePage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const myEmail = (currentUser?.email || '').toLowerCase();
  const myFullName = (currentUser?.fullName || '').toLowerCase();

  const { entries: allEntries, addEntry, updateEntry, deleteEntry } = useTimeEntryStore();
  const { assignments } = useForecastStore();
  const { projects: pipelineProjects } = usePipelineStore();

  const [weekStart, setWeekStart] = useState(toIsoDate(startOfWeek(toIsoDate(new Date()))));
  const [openDay, setOpenDay] = useState<string | null>(toIsoDate(new Date()));

  // Project list relevant to this user:
  //  - pipeline projects where their forecast assignment lives
  //  - pipeline projects they've previously logged on
  //  - all active pipeline projects (fallback so they can always find one)
  const myProjects = useMemo(() => {
    const set = new Map<string, { id: string | null; name: string; billable: boolean }>();

    // Forecast-driven
    assignments
      .filter((a) =>
        a.employeeName.toLowerCase() === myFullName ||
        a.employeeName.toLowerCase().startsWith(myFullName.split(' ')[0])
      )
      .forEach((a) => {
        if (!set.has(a.project)) set.set(a.project, { id: null, name: a.project, billable: true });
      });

    // Already-logged-on
    allEntries
      .filter((e) => e.employeeEmail.toLowerCase() === myEmail)
      .forEach((e) => {
        if (!set.has(e.projectName)) set.set(e.projectName, { id: e.projectId, name: e.projectName, billable: e.billable });
      });

    // All pipeline projects (so user can find a new one)
    pipelineProjects.forEach((p) => {
      if (!set.has(p.name)) set.set(p.name, { id: p.id, name: p.name, billable: true });
    });

    return Array.from(set.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [assignments, myEmail, myFullName, allEntries, pipelineProjects]);

  // My entries this week, grouped by day
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const entriesByDay = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const d of days) map.set(d.iso, []);
    for (const e of allEntries) {
      if (e.employeeEmail.toLowerCase() !== myEmail) continue;
      if (map.has(e.workDate)) map.get(e.workDate)!.push(e);
    }
    return map;
  }, [allEntries, days, myEmail]);

  const weekStats = useMemo(() => {
    let logged = 0, billable = 0;
    for (const day of days) {
      for (const e of entriesByDay.get(day.iso) || []) {
        logged += e.hours;
        if (e.billable) billable += e.hours;
      }
    }
    // Forecast for this week ≈ sum of forecast assignments' weekly_hours that match this week's days
    // (the forecast model is weekly-keyed; we just sum the user's row totals for the relevant ISO weeks)
    return { logged, billable };
  }, [days, entriesByDay]);

  if (!currentUser) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center text-slate-500">
        Sign in to enter time.
      </div>
    );
  }

  const niceWeek = `${new Date(days[0].iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(days[6].iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="max-w-3xl mx-auto pb-24">
      <PageHeader
        title="My Time"
        subtitle={`${currentUser.email} · ${niceWeek}`}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWeekStart(toIsoDate(addDays(startOfWeek(weekStart), -7)))}
              className="text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50"
              title="Previous week"
            >‹ Prev</button>
            <button
              type="button"
              onClick={() => setWeekStart(toIsoDate(startOfWeek(toIsoDate(new Date()))))}
              className="text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50"
              title="This week"
            >Today</button>
            <button
              type="button"
              onClick={() => setWeekStart(toIsoDate(addDays(startOfWeek(weekStart), 7)))}
              className="text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50"
              title="Next week"
            >Next ›</button>
          </div>
        }
      />

      {/* Day cards */}
      <div className="space-y-3">
        {days.map((d) => {
          const entries = entriesByDay.get(d.iso) || [];
          const dayTotal = entries.reduce((s, e) => s + e.hours, 0);
          const isOpen = openDay === d.iso;
          return (
            <Card key={d.iso} className={d.isToday ? 'ring-2 ring-primary/40' : ''}>
              <button
                type="button"
                onClick={() => setOpenDay(isOpen ? null : d.iso)}
                className="w-full -m-6 px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50 rounded-xl transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isOpen ? <ChevronDown size={16} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />}
                  <div>
                    <div className="text-sm font-semibold text-slate-900">
                      {d.label}
                      {d.isToday && <span className="ml-2 text-[10px] uppercase tracking-wider text-primary font-bold">Today</span>}
                    </div>
                    {entries.length > 0 && (
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`text-sm font-bold tabular-nums ${dayTotal === 0 ? 'text-slate-300' : dayTotal >= 8 ? 'text-emerald-600' : 'text-slate-900'}`}>
                    {dayTotal.toFixed(2)}h
                  </div>
                </div>
              </button>

              {isOpen && (
                <div className="mt-4 space-y-3">
                  {entries.map((e) => (
                    <EntryRow
                      key={e.id}
                      entry={e}
                      projectOptions={myProjects}
                      onSave={(patch) => updateEntry(e.id, patch)}
                      onDelete={() => deleteEntry(e.id)}
                    />
                  ))}
                  <NewEntryRow
                    workDate={d.iso}
                    projectOptions={myProjects}
                    onAdd={(params) => addEntry({
                      employeeEmail: myEmail,
                      workDate: d.iso,
                      projectId: params.projectId,
                      projectName: params.projectName,
                      hours: params.hours,
                      billable: params.billable,
                      notes: params.notes,
                    })}
                  />
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Sticky bottom mini stat */}
      <div className="fixed bottom-0 left-0 right-0 md:left-60 bg-white border-t border-slate-200 shadow-lg px-4 py-2.5 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <div>
            <span className="font-semibold text-slate-900 tabular-nums">{weekStats.logged.toFixed(2)}h</span>
            <span className="text-slate-500"> logged</span>
          </div>
          <div>
            <span className="font-semibold text-emerald-600 tabular-nums">{weekStats.billable.toFixed(2)}h</span>
            <span className="text-slate-500"> billable</span>
          </div>
        </div>
        <div className="text-slate-400 text-[10px]">{niceWeek}</div>
      </div>
    </div>
  );
}

/* ── Existing entry — inline editable ── */
function EntryRow({ entry, projectOptions, onSave, onDelete }: {
  entry: TimeEntry;
  projectOptions: { id: string | null; name: string; billable: boolean }[];
  onSave: (patch: Partial<TimeEntry>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [projectName, setProjectName] = useState(entry.projectName);
  const [hours, setHours] = useState(entry.hours);
  const [billable, setBillable] = useState(entry.billable);
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [saving, setSaving] = useState(false);

  const dirty =
    projectName !== entry.projectName ||
    hours !== entry.hours ||
    billable !== entry.billable ||
    notes !== (entry.notes ?? '');

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await onSave({
        projectName,
        projectId: projectOptions.find((p) => p.name === projectName)?.id ?? null,
        hours,
        billable,
        notes,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
        <ProjectPicker value={projectName} onChange={setProjectName} options={projectOptions} />
        <input
          type="number" step={0.25} min={0} max={24}
          value={hours}
          onChange={(e) => setHours(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
          className="w-20 border border-slate-300 rounded-md px-2 py-1.5 text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="button"
          onClick={() => setBillable(!billable)}
          className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-md whitespace-nowrap ${billable ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          title="Toggle billable"
        >
          {billable ? 'Billable' : 'Non-billable'}
        </button>
        <button
          type="button"
          onClick={() => { if (confirm('Delete this entry?')) onDelete(); }}
          className="text-red-500 hover:text-red-700 p-1"
          title="Delete entry"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="mt-2 w-full text-xs text-slate-700 bg-transparent border-0 px-1 py-0.5 rounded focus:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      {dirty && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="text-[11px] font-semibold bg-primary text-white px-2.5 py-1 rounded-md hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1"
          >
            <Save size={11} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── New entry row — quick add ── */
function NewEntryRow({ workDate: _workDate, projectOptions, onAdd }: {
  workDate: string;
  projectOptions: { id: string | null; name: string; billable: boolean }[];
  onAdd: (params: { projectId: string | null; projectName: string; hours: number; billable: boolean; notes: string }) => Promise<unknown>;
}) {
  const [projectName, setProjectName] = useState('');
  const [hours, setHours] = useState<number>(0);
  const [billable, setBillable] = useState(true);
  const [notes, setNotes] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setProjectName('');
    setHours(0);
    setBillable(true);
    setNotes('');
    setAdding(false);
  };

  const handleAdd = async () => {
    if (!projectName || hours <= 0) return;
    setSaving(true);
    try {
      await onAdd({
        projectId: projectOptions.find((p) => p.name === projectName)?.id ?? null,
        projectName,
        hours,
        billable,
        notes,
      });
      reset();
    } finally {
      setSaving(false);
    }
  };

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="w-full border border-dashed border-slate-300 rounded-lg p-3 text-xs text-slate-500 hover:text-slate-800 hover:border-slate-400 hover:bg-slate-50 flex items-center justify-center gap-1"
      >
        <Plus size={12} /> Add time entry
      </button>
    );
  }

  return (
    <div className="border-2 border-primary/30 rounded-lg p-3 bg-primary/5">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-center">
        <ProjectPicker value={projectName} onChange={setProjectName} options={projectOptions} autoFocus />
        <input
          type="number" step={0.25} min={0} max={24}
          value={hours || ''}
          onChange={(e) => setHours(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
          placeholder="Hours"
          className="w-20 border border-slate-300 rounded-md px-2 py-1.5 text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <button
          type="button"
          onClick={() => setBillable(!billable)}
          className={`text-[11px] font-semibold px-2.5 py-1.5 rounded-md whitespace-nowrap ${billable ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
        >
          {billable ? 'Billable' : 'Non-billable'}
        </button>
      </div>
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (optional)"
        className="mt-2 w-full text-xs text-slate-700 bg-white border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          className="text-[11px] text-slate-500 hover:text-slate-700 flex items-center gap-1"
        >
          <X size={11} /> Cancel
        </button>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!projectName || hours <= 0 || saving}
          className="text-[11px] font-semibold bg-primary text-white px-3 py-1 rounded-md hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1"
        >
          <Save size={11} /> {saving ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

/* ── Project picker (datalist for searchability) ── */
function ProjectPicker({ value, onChange, options, autoFocus = false }: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string | null; name: string; billable: boolean }[];
  autoFocus?: boolean;
}) {
  const internalSet = new Set<string>(INTERNAL_PROJECTS);
  const sorted = [
    ...options.filter((p) => !internalSet.has(p.name)),
    ...INTERNAL_PROJECTS.map((n) => ({ id: null as string | null, name: n, billable: false })),
  ];
  return (
    <>
      <input
        list="my-time-project-options"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Pick a project…"
        autoFocus={autoFocus}
        className="border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <datalist id="my-time-project-options">
        {sorted.map((p) => <option key={p.name} value={p.name} />)}
      </datalist>
    </>
  );
}
