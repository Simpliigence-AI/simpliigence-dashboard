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
import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Save, Trash2, X, Copy, CalendarDays, List as ListIcon } from 'lucide-react';
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

/**
 * Parse YYYY-MM-DD as a LOCAL midnight Date. The naive `new Date('YYYY-MM-DD')`
 * parses as UTC midnight, which shifts the day-of-week in non-UTC timezones
 * (e.g. EDT) — the bug that broke the Prev/Today/Next buttons before this fix.
 */
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfWeek(iso: string): Date {
  const d = parseIsoDate(iso);
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

function isoAddDays(iso: string, n: number): string {
  return toIsoDate(addDays(parseIsoDate(iso), n));
}

function startOfMonth(iso: string): Date {
  const d = parseIsoDate(iso);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoMonthGrid(anchorIso: string): { iso: string; inMonth: boolean }[] {
  // 6 × 7 = 42 cells, Monday-anchored, covering the month containing anchorIso
  const first = startOfMonth(anchorIso);
  const firstDay = first.getDay() || 7;
  const gridStart = addDays(first, -(firstDay - 1));
  const month = first.getMonth();
  const out: { iso: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    out.push({ iso: toIsoDate(d), inMonth: d.getMonth() === month });
  }
  return out;
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
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [calendarAnchor, setCalendarAnchor] = useState(toIsoDate(new Date()));

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

  /** Copy all of `fromIso`'s entries onto `toIso` (cloned, status=submitted). */
  const copyDay = async (fromIso: string, toIso: string) => {
    const source = allEntries.filter((e) => e.employeeEmail.toLowerCase() === myEmail && e.workDate === fromIso);
    if (source.length === 0) return;
    for (const e of source) {
      await addEntry({
        employeeEmail: myEmail,
        workDate: toIso,
        projectId: e.projectId,
        projectName: e.projectName,
        hours: e.hours,
        billable: e.billable,
        notes: e.notes,
      });
    }
    setOpenDay(toIso);
  };

  /** Re-submit every 'draft' or 'rejected' entry in the visible week. */
  const submitWeek = async () => {
    const targets = allEntries.filter((e) =>
      e.employeeEmail.toLowerCase() === myEmail
      && days.some((d) => d.iso === e.workDate)
      && (e.status === 'draft' || e.status === 'rejected'),
    );
    if (targets.length === 0) return;
    for (const e of targets) {
      await updateEntry(e.id, {
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        approvedBy: null,
        approvedAt: null,
        rejectReason: null,
      });
    }
  };

  /** Copy LAST week's entries onto THIS week, day-by-day (status=submitted). */
  const copyLastWeek = async () => {
    const lastWeekStart = isoAddDays(weekStart, -7);
    const lastWeekDays = Array.from({ length: 7 }, (_, i) => ({
      from: isoAddDays(lastWeekStart, i),
      to: isoAddDays(weekStart, i),
    }));
    for (const { from, to } of lastWeekDays) {
      // Skip days that already have entries on the target — don't double-up
      const targetHas = allEntries.some((e) => e.employeeEmail.toLowerCase() === myEmail && e.workDate === to);
      if (targetHas) continue;
      await copyDay(from, to);
    }
  };

  /** Count of draft/rejected entries the user can re-submit this week. */
  const needsSubmitCount = useMemo(() => {
    let n = 0;
    for (const d of days) {
      for (const e of entriesByDay.get(d.iso) || []) {
        if (e.status === 'draft' || e.status === 'rejected') n++;
      }
    }
    return n;
  }, [days, entriesByDay]);

  // Calendar view data: hours per day for the visible month
  const calendarGrid = useMemo(() => {
    if (viewMode !== 'calendar') return [];
    const cells = isoMonthGrid(calendarAnchor);
    return cells.map((c) => {
      const total = allEntries
        .filter((e) => e.employeeEmail.toLowerCase() === myEmail && e.workDate === c.iso)
        .reduce((s, e) => s + e.hours, 0);
      return { ...c, hours: total };
    });
  }, [viewMode, calendarAnchor, allEntries, myEmail]);

  const calendarMonthLabel = parseIsoDate(calendarAnchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  if (!currentUser) {
    return (
      <div className="max-w-3xl mx-auto py-12 text-center text-slate-500">
        Sign in to enter time.
      </div>
    );
  }

  const niceWeek = `${parseIsoDate(days[0].iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${parseIsoDate(days[6].iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="max-w-3xl mx-auto pb-24">
      <PageHeader
        title="My Time"
        subtitle={`${currentUser.email} · ${viewMode === 'calendar' ? calendarMonthLabel : niceWeek}`}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {viewMode === 'calendar' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const d = startOfMonth(calendarAnchor);
                    d.setMonth(d.getMonth() - 1);
                    setCalendarAnchor(toIsoDate(d));
                  }}
                  className="text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50"
                  title="Previous month"
                >‹ Prev</button>
                <button
                  type="button"
                  onClick={() => setCalendarAnchor(toIsoDate(new Date()))}
                  className="text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50"
                  title="This month"
                >Today</button>
                <button
                  type="button"
                  onClick={() => {
                    const d = startOfMonth(calendarAnchor);
                    d.setMonth(d.getMonth() + 1);
                    setCalendarAnchor(toIsoDate(d));
                  }}
                  className="text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50"
                  title="Next month"
                >Next ›</button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setWeekStart(isoAddDays(weekStart, -7))}
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
                  onClick={() => setWeekStart(isoAddDays(weekStart, 7))}
                  className="text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50"
                  title="Next week"
                >Next ›</button>
              </>
            )}
          </div>
        }
      />

      {/* View toggle + Copy actions */}
      <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              viewMode === 'list' ? 'bg-primary text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <ListIcon size={12} /> Week list
          </button>
          <button
            type="button"
            onClick={() => setViewMode('calendar')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              viewMode === 'calendar' ? 'bg-primary text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CalendarDays size={12} /> Calendar
          </button>
        </div>
        {viewMode === 'list' && (
          <div className="flex items-center gap-2 flex-wrap">
            {needsSubmitCount > 0 && (
              <button
                type="button"
                onClick={submitWeek}
                className="text-xs font-semibold px-3 py-1.5 bg-primary text-white rounded-md hover:bg-primary/90 inline-flex items-center gap-1.5"
                title={`Re-submit ${needsSubmitCount} draft/rejected entr${needsSubmitCount === 1 ? 'y' : 'ies'} this week`}
              >
                <Save size={12} /> Submit week ({needsSubmitCount})
              </button>
            )}
            <button
              type="button"
              onClick={copyLastWeek}
              className="text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50 inline-flex items-center gap-1.5"
              title="Copy last week's entries forward (skips days that already have entries)"
            >
              <Copy size={12} /> Copy last week
            </button>
          </div>
        )}
      </div>

      {viewMode === 'calendar' ? (
        <CalendarGrid
          cells={calendarGrid}
          onPickDay={(iso) => {
            // Switch to list mode focused on the picked day
            setWeekStart(toIsoDate(startOfWeek(iso)));
            setOpenDay(iso);
            setViewMode('list');
          }}
        />
      ) : (
      /* Day cards */
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
                  {/* Quick-copy actions */}
                  {(() => {
                    const yesterdayIso = isoAddDays(d.iso, -1);
                    const yesterdayHas = allEntries.some(
                      (e) => e.employeeEmail.toLowerCase() === myEmail && e.workDate === yesterdayIso,
                    );
                    const lastWeekIso = isoAddDays(d.iso, -7);
                    const lastWeekHas = allEntries.some(
                      (e) => e.employeeEmail.toLowerCase() === myEmail && e.workDate === lastWeekIso,
                    );
                    if (!yesterdayHas && !lastWeekHas) return null;
                    return (
                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        {yesterdayHas && (
                          <button
                            type="button"
                            onClick={() => copyDay(yesterdayIso, d.iso)}
                            className="text-[11px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100"
                            title={`Copy entries from ${yesterdayIso}`}
                          >
                            <Copy size={11} /> Copy yesterday
                          </button>
                        )}
                        {lastWeekHas && (
                          <button
                            type="button"
                            onClick={() => copyDay(lastWeekIso, d.iso)}
                            className="text-[11px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100"
                            title={`Copy same day last week (${lastWeekIso})`}
                          >
                            <Copy size={11} /> Copy last {parseIsoDate(d.iso).toLocaleDateString(undefined, { weekday: 'long' })}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      )}

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
          {/* Shortfall vs the standard 40-hour week. Goes green at ≥40, amber
              below, hidden once you cross the target so it doesn't nag. */}
          {(() => {
            const TARGET = 40;
            const remaining = TARGET - weekStats.logged;
            if (remaining <= 0) {
              return (
                <div className="text-emerald-600 font-semibold tabular-nums">
                  ✓ {weekStats.logged.toFixed(2)} / {TARGET}h
                </div>
              );
            }
            return (
              <div className="tabular-nums">
                <span className="font-semibold text-amber-700">{remaining.toFixed(2)}h short</span>
                <span className="text-slate-400"> of {TARGET}h</span>
              </div>
            );
          })()}
        </div>
        <div className="text-slate-400 text-[10px]">{niceWeek}</div>
      </div>
    </div>
  );
}

/* ── Existing entry — inline editable ── */
const STATUS_BADGE: Record<TimeEntry['status'], { label: string; cls: string }> = {
  draft:     { label: 'Draft',     cls: 'bg-slate-100 text-slate-600' },
  submitted: { label: 'Submitted', cls: 'bg-sky-100 text-sky-800' },
  approved:  { label: 'Approved',  cls: 'bg-emerald-100 text-emerald-800' },
  rejected:  { label: 'Rejected',  cls: 'bg-red-100 text-red-800' },
};

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

  const statusBadge = STATUS_BADGE[entry.status];
  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-white">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${statusBadge.cls}`}>
          {statusBadge.label}
        </span>
        {entry.status === 'rejected' && entry.rejectReason && (
          <span className="text-[11px] text-red-700 italic truncate ml-2" title={entry.rejectReason}>
            {entry.rejectReason}
          </span>
        )}
        {entry.status === 'approved' && entry.approvedBy && (
          <span className="text-[10px] text-slate-400 truncate ml-2">
            ✓ {entry.approvedBy}
          </span>
        )}
      </div>
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

/* ── New entry row — quick add ──
 *
 * Rapid-entry mode: after saving with Enter, the row stays open and the
 * project value is kept so the user can log a series of entries against
 * the same project without re-picking each time. Escape closes the row.
 */
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
  const [flash, setFlash] = useState(false);
  const hoursRef = useRef<HTMLInputElement>(null);

  const closeRow = () => {
    setProjectName('');
    setHours(0);
    setBillable(true);
    setNotes('');
    setAdding(false);
  };

  /** Save the current entry. If `keepOpen`, leave the row open with the
   *  same project selected so the user can queue up more entries — used
   *  when they hit Enter. Otherwise close the row (button click). */
  const handleAdd = async (opts: { keepOpen?: boolean } = {}) => {
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
      if (opts.keepOpen) {
        // Rapid-entry: clear per-entry fields but keep the project sticky.
        setHours(0);
        setNotes('');
        setFlash(true);
        setTimeout(() => setFlash(false), 400);
        // Refocus hours so the next Enter cycle is just: type number → Enter.
        setTimeout(() => hoursRef.current?.focus(), 0);
      } else {
        closeRow();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter always saves + advances. Tab also saves — but only when there's a
    // valid entry AND the user isn't Shift+Tabbing back. This keeps the tab
    // flow spreadsheet-y: fill project → hours (→ notes) → Tab starts the
    // next line with the same project already selected.
    const canSave = !!projectName && hours > 0;
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey && canSave)) {
      e.preventDefault();
      void handleAdd({ keepOpen: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeRow();
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
    <div className={`border-2 border-primary/30 rounded-lg p-3 bg-primary/5 transition-colors ${flash ? 'bg-emerald-100/60 border-emerald-400' : ''}`}>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-center">
        <ProjectPicker
          value={projectName}
          onChange={setProjectName}
          options={projectOptions}
          autoFocus
          onEnter={() => hoursRef.current?.focus()}
        />
        <input
          ref={hoursRef}
          type="number" step={0.25} min={0} max={24}
          value={hours || ''}
          onChange={(e) => setHours(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
          onKeyDown={handleKey}
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
        onKeyDown={handleKey}
        placeholder="Notes (optional) — Enter or Tab to save & add another"
        className="mt-2 w-full text-xs text-slate-700 bg-white border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-500 italic">Enter or Tab = save &amp; add another · Esc = close</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={closeRow}
            className="text-[11px] text-slate-500 hover:text-slate-700 flex items-center gap-1"
          >
            <X size={11} /> Done
          </button>
          <button
            type="button"
            onClick={() => handleAdd({ keepOpen: false })}
            disabled={!projectName || hours <= 0 || saving}
            className="text-[11px] font-semibold bg-primary text-white px-3 py-1 rounded-md hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1"
          >
            <Save size={11} /> {saving ? 'Adding…' : 'Add & close'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Project picker (datalist for searchability) ── */
function ProjectPicker({ value, onChange, options, autoFocus = false, onEnter }: {
  value: string;
  onChange: (v: string) => void;
  options: { id: string | null; name: string; billable: boolean }[];
  autoFocus?: boolean;
  /** Called when the user presses Enter — used by NewEntryRow to jump focus to the hours field. */
  onEnter?: () => void;
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
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); }
        }}
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

/* ── Calendar grid view ── */
function CalendarGrid({ cells, onPickDay }: {
  cells: { iso: string; inMonth: boolean; hours: number }[];
  onPickDay: (iso: string) => void;
}) {
  const todayIso = toIsoDate(new Date());
  const dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /** Pick a background tone for each cell based on hours logged. */
  const cellTone = (hours: number, inMonth: boolean) => {
    if (!inMonth) return 'bg-slate-50 text-slate-300';
    if (hours === 0) return 'bg-white text-slate-700 hover:bg-slate-50';
    if (hours < 4) return 'bg-amber-50 text-amber-900 hover:bg-amber-100';
    if (hours < 8) return 'bg-emerald-50 text-emerald-900 hover:bg-emerald-100';
    return 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200';
  };

  return (
    <Card>
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 gap-1 mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-center">
        {dayHeaders.map((h) => <div key={h} className="py-1">{h}</div>)}
      </div>
      {/* Cells */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => {
          const dayNum = parseIsoDate(c.iso).getDate();
          const isToday = c.iso === todayIso;
          return (
            <button
              key={c.iso}
              type="button"
              onClick={() => onPickDay(c.iso)}
              className={`relative rounded-md border ${isToday ? 'border-primary ring-1 ring-primary/40' : 'border-slate-200'} px-2 py-3 text-left transition-colors ${cellTone(c.hours, c.inMonth)} min-h-[68px] flex flex-col justify-between`}
              title={`${c.iso} — ${c.hours.toFixed(2)}h logged`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold ${isToday ? 'text-primary' : ''}`}>{dayNum}</span>
                {isToday && <span className="text-[9px] uppercase tracking-wider text-primary font-bold">Today</span>}
              </div>
              {c.inMonth && c.hours > 0 && (
                <div className="text-sm font-bold tabular-nums">{c.hours.toFixed(2)}h</div>
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-white border border-slate-200" /> 0h</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-50 border border-amber-200" /> &lt; 4h</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-200" /> 4–8h</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-200" /> 8h+</span>
        <span className="ml-auto">Click a day to jump to the list view.</span>
      </div>
    </Card>
  );
}
