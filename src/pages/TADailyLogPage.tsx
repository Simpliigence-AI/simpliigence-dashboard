/**
 * TA Daily Log — "My Day" + "Team Activity" tabs.
 *
 * My Day (editable, current TA's own entries):
 *   - top-right date picker (defaults to today)
 *   - weekly KPI card (this-week totals vs last-week, per counter)
 *   - accordion list of requisitions
 *     · auto-populated from india_staffing_candidates.owning_ta_email
 *     · plus any req the TA already logged on (stickiness)
 *     · plus an "+ Add requisition" picker for ad-hoc reqs
 *
 * Team Activity (read-only, visible to every signed-in TA):
 *   - for the selected date, lists EVERY entry from EVERY TA grouped by
 *     requisition, with the logging TA's email + last-updated time visible.
 *   - lets the whole team see which reqs are getting worked on and by whom.
 *
 * Admins (`authorized_users.is_admin = TRUE`) additionally see:
 *   - "Team this week" table — every TA × counter totals + last activity
 *   - "View as" dropdown that swaps into any TA's day read-only on My Day
 *
 * One row = (taEmail × logDate × requisitionId). Counters + free-form notes.
 * Persists via useTaLogStore.upsertEntry → Supabase + realtime broadcast.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Save, Trash2, Eye, Users } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard } from '../components/ui';
import { useAuthStore } from '../store/useAuthStore';
import { useStaffingStore } from '../store/useStaffingStore';
import { useTaLogStore } from '../store/useTaLogStore';
import { TA_LOG_COUNTERS } from '../types/taLog';
import type { TADailyLogEntry, TALogCounterKey } from '../types/taLog';
import type { StaffingRequisition } from '../types/staffing';

/** YYYY-MM-DD for a given Date (local time). */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday-anchored week start for a YYYY-MM-DD string. */
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

export default function TADailyLogPage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const myEmail = (currentUser?.email || '').toLowerCase();
  const isAdmin = currentUser?.isAdmin === true;

  const { accounts, requisitions, candidates } = useStaffingStore();
  const { entries, upsertEntry, deleteEntry } = useTaLogStore();

  const [selectedDate, setSelectedDate] = useState(toIsoDate(new Date()));
  const [openReqs, setOpenReqs] = useState<Set<string>>(new Set());
  const [showAddReq, setShowAddReq] = useState(false);
  /** Admin-only: when set, render this TA's day instead of self (read-only). */
  const [viewAsEmail, setViewAsEmail] = useState<string>('');
  /** Tab: "my-day" (editable, own only) | "team" (read-only, everyone). */
  const [activeView, setActiveView] = useState<'my-day' | 'team'>('my-day');

  // Effective TA whose day is being shown
  const taEmail = (viewAsEmail || myEmail).toLowerCase();
  const isViewingSelf = taEmail === myEmail;
  const readOnly = !isViewingSelf;

  // All distinct TA emails known to the system (for the View-As dropdown)
  const allTaEmails = useMemo(() => {
    const s = new Set<string>();
    if (myEmail) s.add(myEmail);
    candidates.forEach((c) => { if (c.owning_ta_email) s.add(c.owning_ta_email.toLowerCase()); });
    entries.forEach((e) => { if (e.taEmail) s.add(e.taEmail.toLowerCase()); });
    return Array.from(s).sort();
  }, [candidates, entries, myEmail]);

  // Derive the set of requisitions to show:
  //   1. reqs where any candidate has owning_ta_email = taEmail
  //   2. reqs taEmail has a log entry against (any date)
  const myReqIds = useMemo(() => {
    const ids = new Set<string>();
    candidates.forEach((c) => { if ((c.owning_ta_email || '').toLowerCase() === taEmail) ids.add(c.requisition_id); });
    entries.forEach((e) => { if (e.taEmail.toLowerCase() === taEmail) ids.add(e.requisitionId); });
    return ids;
  }, [candidates, entries, taEmail]);

  const myReqs = useMemo(
    () => requisitions.filter((r) => myReqIds.has(r.id)),
    [requisitions, myReqIds],
  );

  // Map requisition_id → existing entry for the selected day (if any)
  const entriesByReq = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getEntry>>();
    function getEntry(rid: string) {
      return entries.find(
        (e) => e.taEmail.toLowerCase() === taEmail && e.logDate === selectedDate && e.requisitionId === rid,
      );
    }
    myReqs.forEach((r) => map.set(r.id, getEntry(r.id)));
    return map;
  }, [entries, taEmail, selectedDate, myReqs]);

  // Weekly KPI: this week vs last week sums (across all of my reqs, by counter key)
  const weeklyTotals = useMemo(() => {
    const today = startOfWeek(selectedDate);
    const lastWeek = addDays(today, -7);
    const lastWeekEnd = addDays(today, -1);
    const thisWeekEnd = addDays(today, 6);
    const inRange = (d: string, a: Date, b: Date) => {
      const t = new Date(d);
      return t >= a && t <= b;
    };
    const acc = { thisWeek: { sourcedOutreach: 0, screensCompleted: 0, submissionsInterviews: 0 },
                  lastWeek: { sourcedOutreach: 0, screensCompleted: 0, submissionsInterviews: 0 } };
    for (const e of entries) {
      if (e.taEmail.toLowerCase() !== taEmail) continue;
      if (inRange(e.logDate, today, thisWeekEnd)) {
        acc.thisWeek.sourcedOutreach += e.sourcedOutreach;
        acc.thisWeek.screensCompleted += e.screensCompleted;
        acc.thisWeek.submissionsInterviews += e.submissionsInterviews;
      } else if (inRange(e.logDate, lastWeek, lastWeekEnd)) {
        acc.lastWeek.sourcedOutreach += e.sourcedOutreach;
        acc.lastWeek.screensCompleted += e.screensCompleted;
        acc.lastWeek.submissionsInterviews += e.submissionsInterviews;
      }
    }
    return acc;
  }, [entries, taEmail, selectedDate]);

  // Open the first req by default once data is in
  useEffect(() => {
    if (openReqs.size === 0 && myReqs.length > 0) {
      setOpenReqs(new Set([myReqs[0].id]));
    }
  }, [myReqs, openReqs.size]);

  if (!currentUser) {
    return (
      <div className="max-w-7xl mx-auto py-12 text-center text-slate-500">
        Sign in to view your TA Daily Log.
      </div>
    );
  }

  const niceDate = new Date(selectedDate).toLocaleDateString(undefined, {
    weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
  });

  // Reqs not yet in the list — for the "+ Add requisition" picker
  const eligibleToAdd = requisitions.filter((r) => !myReqIds.has(r.id));

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title={isViewingSelf ? 'My Day — TA Daily Log' : `${taEmail}'s Day — TA Daily Log`}
        subtitle={`${isViewingSelf ? currentUser.email : taEmail + ' (read-only)'} · ${niceDate}`}
        action={
          <div className="flex items-center gap-3 flex-wrap">
            {isAdmin && (
              <div className="flex items-center gap-2">
                <Eye size={14} className="text-slate-400" />
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">View as</label>
                <select
                  value={viewAsEmail}
                  onChange={(e) => setViewAsEmail(e.target.value)}
                  className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white max-w-[220px]"
                  title="Admin: inspect any TA's day (read-only)"
                >
                  <option value="">Myself ({myEmail})</option>
                  {allTaEmails.filter((e) => e !== myEmail).map((e) => (
                    <option key={e} value={e}>{e}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>
        }
      />

      {/* Tab strip */}
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 text-xs font-semibold">
        <button
          type="button"
          onClick={() => setActiveView('my-day')}
          className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
            activeView === 'my-day' ? 'bg-primary text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          My Day
        </button>
        <button
          type="button"
          onClick={() => setActiveView('team')}
          className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
            activeView === 'team' ? 'bg-primary text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Users size={12} /> Team Activity
        </button>
      </div>

      {activeView === 'team' ? (
        <TeamActivityView
          entries={entries}
          requisitions={requisitions}
          accounts={accounts}
          selectedDate={selectedDate}
        />
      ) : (
        <>
          {/* Read-only banner when viewing another TA */}
          {readOnly && (
            <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-900 flex items-center justify-between">
              <span>
                <strong>Read-only.</strong> You're viewing <span className="font-mono">{taEmail}</span>'s day as an admin. Switch back to "Myself" in the View as dropdown to log your own activity.
              </span>
              <button
                type="button"
                onClick={() => setViewAsEmail('')}
                className="text-amber-900 hover:text-amber-700 underline underline-offset-2"
              >
                Return to mine
              </button>
            </div>
          )}

          {/* Team overview (admins only, when viewing own day) */}
          {isAdmin && isViewingSelf && (
            <TeamOverview
              entries={entries}
              allTaEmails={allTaEmails}
              onViewAs={(email) => setViewAsEmail(email)}
            />
          )}

          {/* Weekly KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {TA_LOG_COUNTERS.map((c) => {
              const tw = weeklyTotals.thisWeek[c.key];
              const lw = weeklyTotals.lastWeek[c.key];
              const diff = tw - lw;
              const trend: 'up' | 'down' | 'flat' = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
              const trendValue = lw === 0 && tw === 0
                ? 'No activity'
                : `${diff >= 0 ? '+' : ''}${diff} vs last week`;
              return (
                <StatCard
                  key={c.key}
                  label={`This week · ${c.short}`}
                  value={tw}
                  subtitle={`Last week: ${lw}`}
                  trend={trend}
                  trendValue={trendValue}
                />
              );
            })}
          </div>

          {/* Requisition accordion list */}
          <Card title={`Requisitions for ${niceDate}`} action={readOnly ? null : (
            <button
              type="button"
              onClick={() => setShowAddReq(true)}
              disabled={eligibleToAdd.length === 0}
              className="text-xs font-semibold text-primary hover:text-primary/80 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              title={eligibleToAdd.length === 0 ? 'No more requisitions to add' : 'Add a requisition to log against'}
            >
              <Plus size={14} /> Add requisition
            </button>
          )}>
            {myReqs.length === 0 ? (
              <div className="text-sm text-slate-500 py-8 text-center">
                No requisitions are assigned to you yet. Open the Candidates page and set yourself as the owning TA on a candidate, or click <strong>+ Add requisition</strong> above.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {myReqs.map((req) => {
                  const acct = accounts.find((a) => a.id === req.account_id);
                  const isOpen = openReqs.has(req.id);
                  const entry = entriesByReq.get(req.id);
                  return (
                    <RequisitionRow
                      key={req.id}
                      req={req}
                      accountName={acct?.name ?? '—'}
                      isOpen={isOpen}
                      onToggle={() => {
                        const next = new Set(openReqs);
                        if (isOpen) next.delete(req.id); else next.add(req.id);
                        setOpenReqs(next);
                      }}
                      initialCounters={{
                        sourcedOutreach: entry?.sourcedOutreach ?? 0,
                        screensCompleted: entry?.screensCompleted ?? 0,
                        submissionsInterviews: entry?.submissionsInterviews ?? 0,
                      }}
                      initialNotes={entry?.notes ?? ''}
                      entryId={entry?.id ?? null}
                      readOnly={readOnly}
                      onSave={async (counters, notes) => {
                        await upsertEntry({
                          taEmail,
                          logDate: selectedDate,
                          requisitionId: req.id,
                          counters,
                          notes,
                        });
                      }}
                      onDelete={entry && !readOnly ? () => deleteEntry(entry.id) : undefined}
                    />
                  );
                })}
              </div>
            )}
          </Card>

          {showAddReq && (
            <AddRequisitionDialog
              requisitions={eligibleToAdd}
              accountName={(rid: string) => accounts.find((a) => a.id === rid)?.name ?? '—'}
              onClose={() => setShowAddReq(false)}
              onPick={async (rid) => {
                // Seed a zero-counter row to make the req appear in the list immediately
                await upsertEntry({
                  taEmail,
                  logDate: selectedDate,
                  requisitionId: rid,
                  counters: { sourcedOutreach: 0, screensCompleted: 0, submissionsInterviews: 0 },
                  notes: '',
                });
                setOpenReqs((s) => new Set(s).add(rid));
                setShowAddReq(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ── Single requisition row (header + expandable editor) ── */

interface RowProps {
  req: StaffingRequisition;
  accountName: string;
  isOpen: boolean;
  onToggle: () => void;
  initialCounters: Record<TALogCounterKey, number>;
  initialNotes: string;
  entryId: string | null;
  readOnly?: boolean;
  onSave: (counters: Record<TALogCounterKey, number>, notes: string) => Promise<void>;
  onDelete?: () => void | Promise<void>;
}

function RequisitionRow({ req, accountName, isOpen, onToggle, initialCounters, initialNotes, entryId, readOnly = false, onSave, onDelete }: RowProps) {
  const [counters, setCounters] = useState(initialCounters);
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Sync local state when the underlying entry changes (e.g. switched dates)
  useEffect(() => { setCounters(initialCounters); }, [initialCounters.sourcedOutreach, initialCounters.screensCompleted, initialCounters.submissionsInterviews]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setNotes(initialNotes); }, [initialNotes]);

  const total = counters.sourcedOutreach + counters.screensCompleted + counters.submissionsInterviews;
  const dirty =
    counters.sourcedOutreach !== initialCounters.sourcedOutreach ||
    counters.screensCompleted !== initialCounters.screensCompleted ||
    counters.submissionsInterviews !== initialCounters.submissionsInterviews ||
    notes !== initialNotes;

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(counters, notes);
      setSavedAt(new Date().toLocaleTimeString());
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="py-3">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-left hover:bg-slate-50 -mx-3 px-3 py-2 rounded-md transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {isOpen ? <ChevronDown size={16} className="text-slate-400 flex-shrink-0" /> : <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate">{req.title}</div>
            <div className="text-[11px] text-slate-500 truncate">{accountName} · {req.stage} · {req.status_field}</div>
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center gap-2 ml-3">
          {total > 0 && (
            <span className="text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              {total} today
            </span>
          )}
          {entryId && (
            <span className="text-[10px] text-emerald-600 font-medium">●</span>
          )}
        </div>
      </button>

      {isOpen && (
        <div className="mt-3 ml-7 mr-2 grid grid-cols-1 lg:grid-cols-4 gap-4">
          {TA_LOG_COUNTERS.map((c) => (
            <div key={c.key}>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                {c.label}
              </label>
              <input
                type="number"
                min={0}
                value={counters[c.key]}
                disabled={readOnly}
                onChange={(e) => setCounters({ ...counters, [c.key]: Math.max(0, Number(e.target.value) || 0) })}
                className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
          ))}
          <div className="lg:col-span-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              disabled={readOnly}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={readOnly ? '' : 'What did you do today on this req?'}
              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>
          {!readOnly && (
            <div className="lg:col-span-4 flex items-center justify-end gap-2">
              {savedAt && !dirty && (
                <span className="text-[11px] text-emerald-600">Saved {savedAt}</span>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  className="text-[11px] text-red-600 hover:text-red-800 flex items-center gap-1"
                >
                  <Trash2 size={12} /> Delete entry
                </button>
              )}
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving}
                className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <Save size={12} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Team overview (admins only) ──
 *  Shows each TA's this-week vs last-week counter totals + last activity date.
 *  Each row has a "View day" button that swaps the page into read-only view-as.
 */
function TeamOverview({ entries, allTaEmails, onViewAs }: {
  entries: TADailyLogEntry[];
  allTaEmails: string[];
  onViewAs: (email: string) => void;
}) {
  const summary = useMemo(() => {
    // Compute Monday-anchored week ranges
    const today = startOfWeek(toIsoDate(new Date()));
    const thisWeekEnd = addDays(today, 6);
    const lastWeek = addDays(today, -7);
    const lastWeekEnd = addDays(today, -1);

    return allTaEmails.map((email) => {
      let thisWeek = 0, lastWeekTotal = 0;
      let lastActivity: string | null = null;
      for (const e of entries) {
        if (e.taEmail.toLowerCase() !== email) continue;
        const total = e.sourcedOutreach + e.screensCompleted + e.submissionsInterviews;
        const t = new Date(e.logDate);
        if (t >= today && t <= thisWeekEnd) thisWeek += total;
        else if (t >= lastWeek && t <= lastWeekEnd) lastWeekTotal += total;
        if (total > 0 && (!lastActivity || e.logDate > lastActivity)) lastActivity = e.logDate;
      }
      return { email, thisWeek, lastWeek: lastWeekTotal, lastActivity };
    }).sort((a, b) => b.thisWeek - a.thisWeek);
  }, [entries, allTaEmails]);

  // Hide overview if there's only one TA in the system (just the admin themselves)
  if (summary.length <= 1) return null;

  return (
    <Card title="Team this week" className="mb-6">
      <div className="overflow-x-auto -mx-6 px-6">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
              <th className="py-2 pr-3 font-semibold">TA</th>
              <th className="py-2 pr-3 font-semibold text-right">This week</th>
              <th className="py-2 pr-3 font-semibold text-right">Last week</th>
              <th className="py-2 pr-3 font-semibold">Trend</th>
              <th className="py-2 pr-3 font-semibold">Last activity</th>
              <th className="py-2 pr-3 font-semibold w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {summary.map((s) => {
              const diff = s.thisWeek - s.lastWeek;
              const trendColor = diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-400';
              const trendArrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
              const stale = !s.lastActivity || (() => {
                const d = new Date(s.lastActivity!);
                const ageDays = (Date.now() - d.getTime()) / 86400000;
                return ageDays > 2;
              })();
              return (
                <tr key={s.email} className="hover:bg-slate-50/60">
                  <td className="py-2 pr-3 text-xs font-medium text-slate-900">{s.email}</td>
                  <td className="py-2 pr-3 text-right tabular-nums font-semibold">{s.thisWeek}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{s.lastWeek}</td>
                  <td className={`py-2 pr-3 text-xs font-semibold ${trendColor}`}>
                    {trendArrow} {diff >= 0 ? '+' : ''}{diff}
                  </td>
                  <td className={`py-2 pr-3 text-xs ${stale ? 'text-amber-700 font-medium' : 'text-slate-500'}`}>
                    {s.lastActivity ?? '—'}
                    {stale && s.lastActivity && <span className="ml-1 text-[10px]">(stale)</span>}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <button
                      type="button"
                      onClick={() => onViewAs(s.email)}
                      className="text-[11px] text-primary hover:text-primary/80 inline-flex items-center gap-1"
                    >
                      <Eye size={11} /> View day
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ── "Add requisition" picker dialog ── */

function AddRequisitionDialog({ requisitions, accountName, onPick, onClose }: {
  requisitions: StaffingRequisition[];
  accountName: (rid: string) => string;
  onPick: (rid: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState('');
  const filtered = requisitions.filter((r) => {
    const q = filter.toLowerCase();
    return !q || r.title.toLowerCase().includes(q) || accountName(r.account_id).toLowerCase().includes(q);
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-800">Add a requisition</div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        <div className="p-4 border-b border-slate-100">
          <input
            autoFocus
            placeholder="Search by title or account…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="p-6 text-sm text-slate-500 text-center">No requisitions match.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onPick(r.id)}
                    className="w-full text-left px-5 py-3 hover:bg-slate-50"
                  >
                    <div className="text-sm font-medium text-slate-900">{r.title}</div>
                    <div className="text-[11px] text-slate-500">{accountName(r.account_id)} · {r.stage} · {r.status_field}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Team Activity view ──
 *  Read-only snapshot of every TA's entries for the selected date, grouped by
 *  requisition. Lets the whole team see "what's being worked on today" with
 *  attribution (TA email shown on each entry).
 */
function TeamActivityView({ entries, requisitions, accounts, selectedDate }: {
  entries: TADailyLogEntry[];
  requisitions: StaffingRequisition[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  accounts: any[];
  selectedDate: string;
}) {
  const [filter, setFilter] = useState('');

  const accountName = (rid: string) => {
    const req = requisitions.find((r) => r.id === rid);
    if (!req) return '—';
    return accounts.find((a) => a.id === req.account_id)?.name ?? '—';
  };

  // Group entries for the selected date by requisition_id, only keeping rows
  // with non-zero activity OR a note (zero-counter empty rows are noise).
  const byReq = useMemo(() => {
    const map = new Map<string, TADailyLogEntry[]>();
    for (const e of entries) {
      if (e.logDate !== selectedDate) continue;
      const total = e.sourcedOutreach + e.screensCompleted + e.submissionsInterviews;
      if (total === 0 && !(e.notes && e.notes.trim())) continue;
      if (!map.has(e.requisitionId)) map.set(e.requisitionId, []);
      map.get(e.requisitionId)!.push(e);
    }
    return map;
  }, [entries, selectedDate]);

  // Build list of active reqs, sorted by total activity desc
  const activeReqs = useMemo(() => {
    return Array.from(byReq.entries())
      .map(([rid, list]) => {
        const req = requisitions.find((r) => r.id === rid);
        const total = list.reduce(
          (s, e) => s + e.sourcedOutreach + e.screensCompleted + e.submissionsInterviews,
          0,
        );
        return { rid, req, list, total };
      })
      .filter((x) => x.req !== undefined)
      .filter((x) => {
        if (!filter.trim()) return true;
        const q = filter.toLowerCase();
        return (
          x.req!.title.toLowerCase().includes(q) ||
          accountName(x.rid).toLowerCase().includes(q) ||
          x.list.some((e) => e.taEmail.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => b.total - a.total);
  }, [byReq, requisitions, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Distinct TAs active today (for the header chip)
  const activeTas = useMemo(() => {
    const s = new Set<string>();
    for (const list of byReq.values()) for (const e of list) s.add(e.taEmail.toLowerCase());
    return s.size;
  }, [byReq]);

  const totalAll = useMemo(() => {
    let t = 0;
    for (const list of byReq.values()) {
      for (const e of list) t += e.sourcedOutreach + e.screensCompleted + e.submissionsInterviews;
    }
    return t;
  }, [byReq]);

  return (
    <>
      {/* Header strip */}
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-xs text-slate-600">
          <span className="font-semibold text-slate-900 tabular-nums text-base">{activeReqs.length}</span>
          <span>active req{activeReqs.length === 1 ? '' : 's'}</span>
          <span className="text-slate-300">·</span>
          <span className="font-semibold text-slate-900 tabular-nums">{activeTas}</span>
          <span>TA{activeTas === 1 ? '' : 's'} active</span>
          <span className="text-slate-300">·</span>
          <span className="font-semibold text-slate-900 tabular-nums">{totalAll}</span>
          <span>total activity</span>
        </div>
        <input
          placeholder="Filter by req, account, or TA…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-slate-300 rounded-md px-3 py-1.5 text-xs w-full md:w-72 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {activeReqs.length === 0 ? (
        <Card>
          <div className="text-sm text-slate-500 text-center py-12">
            No team activity logged for this date{filter ? ' that matches your filter' : ''}.
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {activeReqs.map(({ rid, req, list, total }) => (
            <Card key={rid}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{req!.title}</div>
                  <div className="text-[11px] text-slate-500 truncate">{accountName(rid)} · {req!.stage} · {req!.status_field}</div>
                </div>
                <span className="flex-shrink-0 text-[11px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  {total} today · {list.length} TA{list.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="overflow-x-auto -mx-6 px-6">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                      <th className="py-1.5 pr-3 font-semibold">TA</th>
                      {TA_LOG_COUNTERS.map((c) => (
                        <th key={c.key} className="py-1.5 pr-3 font-semibold text-right whitespace-nowrap">{c.short}</th>
                      ))}
                      <th className="py-1.5 pr-3 font-semibold">Notes</th>
                      <th className="py-1.5 pr-3 font-semibold text-right">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {list
                      .slice()
                      .sort((a, b) =>
                        (b.sourcedOutreach + b.screensCompleted + b.submissionsInterviews) -
                        (a.sourcedOutreach + a.screensCompleted + a.submissionsInterviews))
                      .map((e) => (
                      <tr key={e.id}>
                        <td className="py-1.5 pr-3 font-medium text-slate-900 whitespace-nowrap">{e.taEmail}</td>
                        {TA_LOG_COUNTERS.map((c) => (
                          <td key={c.key} className="py-1.5 pr-3 text-right tabular-nums">
                            {(e as unknown as Record<string, number>)[c.key] || ''}
                          </td>
                        ))}
                        <td className="py-1.5 pr-3 text-slate-600 max-w-[280px]">
                          {e.notes ? <span className="line-clamp-2">{e.notes}</span> : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-right text-[10px] text-slate-400 whitespace-nowrap">
                          {new Date(e.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
