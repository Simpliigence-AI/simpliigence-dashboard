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
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Save, Trash2, X, Copy, CalendarDays, List as ListIcon, LayoutGrid, UploadCloud, Download, Loader2, FileText, AlertTriangle, Paperclip } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useAuthStore } from '../store/useAuthStore';
import { useForecastStore } from '../store/useForecastStore';
import { usePipelineStore } from '../store/usePipelineStore';
import { useTimeEntryStore } from '../store/useTimeEntryStore';
import { useTimesheetDocsStore, timesheetDocsKey } from '../store/useTimesheetDocsStore';
import { INTERNAL_PROJECTS } from '../types/timeEntry';
import type { TimeEntry, TimeEntryStatus, TimesheetDocument } from '../types/timeEntry';

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
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'grid'>('list');
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

  // Flat list of this user's entries in the visible week (grid view + docs).
  const weekEntries = useMemo(() => {
    const out: TimeEntry[] = [];
    for (const d of days) out.push(...(entriesByDay.get(d.iso) || []));
    return out;
  }, [days, entriesByDay]);

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
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              viewMode === 'grid' ? 'bg-primary text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutGrid size={12} /> Grid
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
      ) : viewMode === 'grid' ? (
        <GridView
          key={weekStart}
          days={days}
          projectOptions={myProjects}
          entries={weekEntries}
          myEmail={myEmail}
          addEntry={addEntry}
          updateEntry={updateEntry}
          deleteEntry={deleteEntry}
          submitWeek={submitWeek}
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
                      status: params.status,
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

      {/* Per-week client-approved timesheet documents (all view modes) */}
      <div className="mt-5">
        <DocumentsPanel
          employeeEmail={myEmail}
          periodStart={days[0].iso}
          periodEnd={days[6].iso}
          uploadedBy={myEmail}
        />
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
  onAdd: (params: { projectId: string | null; projectName: string; hours: number; billable: boolean; notes: string; status?: TimeEntryStatus }) => Promise<unknown>;
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
  const handleAdd = async (opts: { keepOpen?: boolean; asDraft?: boolean } = {}) => {
    if (!projectName || hours <= 0) return;
    setSaving(true);
    try {
      await onAdd({
        projectId: projectOptions.find((p) => p.name === projectName)?.id ?? null,
        projectName,
        hours,
        billable,
        notes,
        status: opts.asDraft ? 'draft' : 'submitted',
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
            onClick={() => handleAdd({ keepOpen: false, asDraft: true })}
            disabled={!projectName || hours <= 0 || saving}
            className="text-[11px] font-semibold border border-slate-300 text-slate-700 bg-white px-3 py-1 rounded-md hover:bg-slate-50 disabled:opacity-40 flex items-center gap-1"
            title="Save without submitting for approval"
          >
            <Save size={11} /> Save as draft
          </button>
          <button
            type="button"
            onClick={() => handleAdd({ keepOpen: false })}
            disabled={!projectName || hours <= 0 || saving}
            className="text-[11px] font-semibold bg-primary text-white px-3 py-1 rounded-md hover:bg-primary/90 disabled:opacity-40 flex items-center gap-1"
          >
            <Save size={11} /> {saving ? 'Adding…' : 'Add & submit'}
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

/* ── Weekly grid entry view ──
 *
 * Rows = projects, columns = the 7 days of the week, each cell a numeric hours
 * input. Rows are seeded from the projects already logged this week; the user
 * adds more via the ProjectPicker (which draws on the full myProjects list).
 *
 * Cell semantics (dirty-only writes to avoid clobbering untouched data):
 *   - dirty cell, 0 matching entries + hours>0  → create
 *   - dirty cell, 1 matching entry              → update its hours
 *   - dirty cell cleared to 0/empty             → delete matching entry
 *   - cell mapping to >1 entries                → LOCKED (read-only): the grid
 *       can't faithfully represent the billable split / per-entry notes, so it
 *       shows the summed hours but refuses edits (edit in list view instead).
 * Untouched cells are never written. The component is remounted per-week
 * (key={weekStart}) so edit state resets on navigation.
 */
const CELL_SEP = '\u0000';  // NUL — never present in a project name or ISO date
function clampHours(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(24, n));
}

function GridView({ days, projectOptions, entries, myEmail, addEntry, updateEntry, deleteEntry, submitWeek }: {
  days: { iso: string; label: string; isToday: boolean }[];
  projectOptions: { id: string | null; name: string; billable: boolean }[];
  entries: TimeEntry[];
  myEmail: string;
  addEntry: (input: {
    employeeEmail: string; workDate: string; projectId?: string | null; projectName: string;
    hours: number; billable: boolean; notes?: string; status?: TimeEntryStatus;
  }) => Promise<TimeEntry>;
  updateEntry: (id: string, patch: Partial<TimeEntry>) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  /** Promote every draft/rejected entry in the visible week to 'submitted'. */
  submitWeek: () => Promise<void>;
}) {
  // Only dirty cells live here (key = `${projectName}\u0000${dayIso}` → raw string).
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [extraRows, setExtraRows] = useState<string[]>([]);
  const [newRow, setNewRow] = useState('');
  const [saving, setSaving] = useState<'draft' | 'submit' | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const internalSet = new Set<string>(INTERNAL_PROJECTS);

  const rowNames = useMemo(() => {
    const s = new Set<string>();
    for (const e of entries) s.add(e.projectName);
    for (const r of extraRows) s.add(r);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [entries, extraRows]);

  const matchesFor = (name: string, iso: string) =>
    entries.filter((e) => e.projectName === name && e.workDate === iso);
  const baseHours = (name: string, iso: string) =>
    matchesFor(name, iso).reduce((s, e) => s + e.hours, 0);
  // A cell backed by >1 entries can't be faithfully edited as a single number
  // (it would collapse the billable split / notes), so it's rendered read-only.
  const isLocked = (name: string, iso: string) => matchesFor(name, iso).length > 1;

  const cellValue = (name: string, iso: string): string => {
    const key = `${name}${CELL_SEP}${iso}`;
    if (key in edits) return edits[key];
    const base = baseHours(name, iso);
    return base > 0 ? String(base) : '';
  };
  const cellNumber = (name: string, iso: string): number => {
    const key = `${name}${CELL_SEP}${iso}`;
    if (key in edits) return clampHours(Number(edits[key]) || 0);
    return baseHours(name, iso);
  };

  const setCell = (name: string, iso: string, v: string) => {
    setEdits((prev) => ({ ...prev, [`${name}${CELL_SEP}${iso}`]: v }));
  };

  const billableFor = (name: string): boolean => {
    if (internalSet.has(name)) return false;
    return projectOptions.find((p) => p.name === name)?.billable ?? true;
  };
  const projectIdFor = (name: string): string | null =>
    projectOptions.find((p) => p.name === name)?.id ?? null;

  const dirtyCount = Object.keys(edits).length;
  // Existing draft/rejected entries in the week that "Submit week" can promote.
  const promotableCount = useMemo(
    () => entries.filter((e) => e.status === 'draft' || e.status === 'rejected').length,
    [entries],
  );
  const canSubmit = dirtyCount > 0 || promotableCount > 0;

  const dayTotals = days.map((d) => rowNames.reduce((s, n) => s + cellNumber(n, d.iso), 0));
  const rowTotals = rowNames.map((n) => days.reduce((s, d) => s + cellNumber(n, d.iso), 0));
  const grandTotal = dayTotals.reduce((s, x) => s + x, 0);

  const addRow = () => {
    const name = newRow.trim();
    if (!name || rowNames.includes(name)) { setNewRow(''); return; }
    setExtraRows((prev) => [...prev, name]);
    setNewRow('');
  };

  /** Persist every dirty cell with the given status. Locked (>1 match) cells
   *  are read-only and never dirty, so each cell maps to 0 or 1 entry. */
  const persistDirty = async (status: TimeEntryStatus, submittedAt: string | null) => {
    for (const key of Object.keys(edits)) {
      const sep = key.indexOf(CELL_SEP);
      const name = key.slice(0, sep);
      const iso = key.slice(sep + 1);
      const hours = clampHours(Number(edits[key]) || 0);
      const matches = matchesFor(name, iso);
      if (hours > 0) {
        if (matches.length === 0) {
          await addEntry({
            employeeEmail: myEmail,
            workDate: iso,
            projectId: projectIdFor(name),
            projectName: name,
            hours,
            billable: billableFor(name),
            notes: '',
            status,
          });
        } else {
          // Clear any stale approval/rejection metadata on resubmit (mirrors submitWeek).
          await updateEntry(matches[0].id, { hours, status, submittedAt, approvedBy: null, approvedAt: null, rejectReason: null });
          for (const extra of matches.slice(1)) await deleteEntry(extra.id);
        }
      } else {
        // Cleared cell: delete any entries that existed.
        for (const m of matches) await deleteEntry(m.id);
      }
    }
  };

  const saveDraft = async () => {
    if (dirtyCount === 0 || saving) return;
    setSaving('draft');
    setSavedMsg(null);
    try {
      await persistDirty('draft', null);
      setEdits({});
      setSavedMsg('Draft saved');
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      setSavedMsg(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(null);
    }
  };

  /** Submit the whole week (like the list view): persist edited cells as
   *  submitted, then promote every remaining draft/rejected entry via submitWeek. */
  const submitWeekAll = async () => {
    if (!canSubmit || saving) return;
    setSaving('submit');
    setSavedMsg(null);
    try {
      await persistDirty('submitted', new Date().toISOString());
      await submitWeek();
      setEdits({});
      setSavedMsg('Week submitted');
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      setSavedMsg(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-400">
              <th className="text-left font-bold py-2 pr-3 min-w-[10rem] sticky left-0 bg-white">Project</th>
              {days.map((d) => {
                const dt = parseIsoDate(d.iso);
                return (
                  <th key={d.iso} className={`text-center font-bold px-1 py-2 min-w-[3.75rem] ${d.isToday ? 'text-primary' : ''}`}>
                    <div>{dt.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                    <div className="text-slate-500 font-semibold">{dt.getDate()}</div>
                  </th>
                );
              })}
              <th className="text-center font-bold px-2 py-2 min-w-[3.5rem]">Total</th>
            </tr>
          </thead>
          <tbody>
            {rowNames.length === 0 && (
              <tr>
                <td colSpan={days.length + 2} className="text-center text-slate-400 italic py-6 text-xs">
                  No projects yet. Add a project row below to start filling in hours.
                </td>
              </tr>
            )}
            {rowNames.map((name, ri) => (
              <tr key={name} className="border-t border-slate-100">
                <td className="py-1.5 pr-3 text-slate-800 font-medium sticky left-0 bg-white">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate max-w-[12rem]" title={name}>{name}</span>
                    {!billableFor(name) && <span className="text-[9px] uppercase tracking-wide text-slate-400">non-bill</span>}
                  </div>
                </td>
                {days.map((d) => {
                  if (isLocked(name, d.iso)) {
                    return (
                      <td key={d.iso} className="px-1 py-1 text-center">
                        <input
                          type="text"
                          value={baseHours(name, d.iso).toFixed(2)}
                          readOnly
                          tabIndex={-1}
                          title="Multiple entries this day — edit in list view"
                          className="w-14 border border-slate-200 rounded-md px-1 py-1 text-sm tabular-nums text-right bg-slate-100 text-slate-400 cursor-not-allowed"
                        />
                      </td>
                    );
                  }
                  return (
                    <td key={d.iso} className="px-1 py-1 text-center">
                      <input
                        type="number" step={0.25} min={0} max={24}
                        value={cellValue(name, d.iso)}
                        onChange={(e) => setCell(name, d.iso, e.target.value)}
                        placeholder="0"
                        className={`w-14 border rounded-md px-1 py-1 text-sm tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                          `${name}${CELL_SEP}${d.iso}` in edits ? 'border-primary/60 bg-primary/5' : 'border-slate-300'
                        }`}
                      />
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-center font-bold tabular-nums text-slate-900">
                  {rowTotals[ri].toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-200 text-slate-900">
              <td className="py-2 pr-3 text-[11px] uppercase tracking-wider font-bold text-slate-500 sticky left-0 bg-white">Day total</td>
              {dayTotals.map((t, i) => (
                <td key={days[i].iso} className={`px-1 py-2 text-center font-bold tabular-nums ${t >= 8 ? 'text-emerald-600' : t === 0 ? 'text-slate-300' : ''}`}>
                  {t.toFixed(2)}
                </td>
              ))}
              <td className="px-2 py-2 text-center font-extrabold tabular-nums">{grandTotal.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Add a project row */}
      <div className="mt-4 flex items-center gap-2 flex-wrap border-t border-slate-100 pt-3">
        <span className="text-[11px] text-slate-500">Add project row:</span>
        <ProjectPicker value={newRow} onChange={setNewRow} options={projectOptions} onEnter={addRow} />
        <button
          type="button"
          onClick={addRow}
          disabled={!newRow.trim()}
          className="text-[11px] font-semibold px-2.5 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1"
        >
          <Plus size={11} /> Add row
        </button>
      </div>

      {/* Save actions */}
      <div className="mt-4 flex items-center justify-between gap-2 flex-wrap border-t border-slate-100 pt-3">
        <span className="text-[11px] text-slate-500">
          {dirtyCount > 0 ? `${dirtyCount} unsaved cell${dirtyCount === 1 ? '' : 's'}` : 'All changes saved'}
          {savedMsg && <span className="ml-2 text-emerald-600 font-semibold">{savedMsg}</span>}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={saveDraft}
            disabled={dirtyCount === 0 || saving !== null}
            className="text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            {saving === 'draft' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save draft
          </button>
          <button
            type="button"
            onClick={submitWeekAll}
            disabled={!canSubmit || saving !== null}
            className="text-xs font-semibold px-3 py-1.5 bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1.5"
            title="Submit edited cells and promote all draft/rejected entries this week"
          >
            {saving === 'submit' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Submit week
          </button>
        </div>
      </div>
    </Card>
  );
}

/* ── Per-week client-approved timesheet documents ── */
function humanFileSize(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const DOC_ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.csv';

function DocumentsPanel({ employeeEmail, periodStart, periodEnd, uploadedBy }: {
  employeeEmail: string;
  periodStart: string;
  periodEnd: string;
  uploadedBy: string | null;
}) {
  const cacheKey = timesheetDocsKey(employeeEmail, periodStart);
  const docs = useTimesheetDocsStore((s) => s.docsByWeek[cacheKey]) ?? [];
  const loading = useTimesheetDocsStore((s) => s.loadingByWeek[cacheKey]) ?? false;
  const loadForWeek = useTimesheetDocsStore((s) => s.loadForWeek);
  const upload = useTimesheetDocsStore((s) => s.upload);
  const remove = useTimesheetDocsStore((s) => s.remove);
  const signedUrl = useTimesheetDocsStore((s) => s.signedUrl);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Refresh whenever the week (or user) changes.
  useEffect(() => {
    if (employeeEmail) void loadForWeek(employeeEmail, periodStart);
  }, [employeeEmail, periodStart, loadForWeek]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const f of Array.from(files)) {
        await upload({ employeeEmail, periodStart, periodEnd, file: f, uploadedBy });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function download(doc: TimesheetDocument) {
    const url = await signedUrl(doc.storagePath);
    if (url) window.open(url, '_blank', 'noopener');
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Paperclip size={15} className="text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-900">Documents for this week</h3>
        <span className="text-[11px] text-slate-400">Attach the client-approved timesheet (PDF, image, Word, Excel)</span>
      </div>

      <div className="border-2 border-dashed border-slate-200 rounded-lg p-3 bg-slate-50/50 flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          accept={DOC_ACCEPT}
          onChange={(e) => onFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="text-xs font-semibold px-3 py-1.5 bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
          {uploading ? 'Uploading…' : 'Upload document'}
        </button>
        <span className="text-[11px] text-slate-500">PDF, PNG/JPG/GIF/WebP, DOC/DOCX, XLS/XLSX/CSV · max 15 MB</span>
      </div>

      {error && (
        <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {loading && docs.length === 0 ? (
        <div className="text-center text-slate-500 py-4 text-sm"><Loader2 className="inline w-3 h-3 animate-spin mr-1" /> Loading…</div>
      ) : docs.length === 0 ? (
        <div className="text-center text-slate-400 py-4 text-sm italic">No documents uploaded for this week yet.</div>
      ) : (
        <div className="mt-3 space-y-2">
          {docs.map((d) => (
            <div key={d.id} className="rounded-lg border border-slate-200 bg-white p-2.5 flex items-center gap-3">
              <FileText size={16} className="text-slate-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-900 truncate" title={d.filename}>{d.filename}</div>
                <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-2">
                  {d.sizeBytes && <span>{humanFileSize(d.sizeBytes)}</span>}
                  <span>uploaded {new Date(d.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  {d.uploadedBy && <span>by {d.uploadedBy}</span>}
                </div>
              </div>
              <button type="button" onClick={() => download(d)} title="Download" className="p-1.5 text-slate-400 hover:text-slate-700">
                <Download size={15} />
              </button>
              <button
                type="button"
                onClick={() => { if (confirm(`Delete "${d.filename}"?`)) void remove(employeeEmail, periodStart, d); }}
                title="Delete"
                className="p-1.5 text-slate-400 hover:text-rose-600"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
