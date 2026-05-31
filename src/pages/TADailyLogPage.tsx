/**
 * TA Daily Log — "My Day" page.
 *
 * Each signed-in user sees their own day:
 *   - top-right date picker (defaults to today)
 *   - weekly KPI card (this-week totals vs last-week, per counter)
 *   - accordion list of requisitions
 *     · auto-populated from india_staffing_candidates.owning_ta_email
 *     · plus any req the TA already logged on (stickiness)
 *     · plus an "+ Add requisition" picker for ad-hoc reqs
 *
 * One row = (taEmail × logDate × requisitionId). Counters + free-form notes.
 * Persists via useTaLogStore.upsertEntry → Supabase + realtime broadcast.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Save, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard } from '../components/ui';
import { useAuthStore } from '../store/useAuthStore';
import { useStaffingStore } from '../store/useStaffingStore';
import { useTaLogStore } from '../store/useTaLogStore';
import { TA_LOG_COUNTERS } from '../types/taLog';
import type { TALogCounterKey } from '../types/taLog';
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
  const taEmail = (currentUser?.email || '').toLowerCase();

  const { accounts, requisitions, candidates } = useStaffingStore();
  const { entries, upsertEntry, deleteEntry } = useTaLogStore();

  const [selectedDate, setSelectedDate] = useState(toIsoDate(new Date()));
  const [openReqs, setOpenReqs] = useState<Set<string>>(new Set());
  const [showAddReq, setShowAddReq] = useState(false);

  // Derive the set of requisitions to show:
  //   1. reqs where any candidate has owning_ta_email = me
  //   2. reqs I have a log entry against (any date)
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
        title="My Day — TA Daily Log"
        subtitle={`${currentUser.email} · ${niceDate}`}
        action={
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        }
      />

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
      <Card title={`Requisitions for ${niceDate}`} action={
        <button
          type="button"
          onClick={() => setShowAddReq(true)}
          disabled={eligibleToAdd.length === 0}
          className="text-xs font-semibold text-primary hover:text-primary/80 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          title={eligibleToAdd.length === 0 ? 'No more requisitions to add' : 'Add a requisition to log against'}
        >
          <Plus size={14} /> Add requisition
        </button>
      }>
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
                  onSave={async (counters, notes) => {
                    await upsertEntry({
                      taEmail,
                      logDate: selectedDate,
                      requisitionId: req.id,
                      counters,
                      notes,
                    });
                  }}
                  onDelete={entry ? () => deleteEntry(entry.id) : undefined}
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
  onSave: (counters: Record<TALogCounterKey, number>, notes: string) => Promise<void>;
  onDelete?: () => void | Promise<void>;
}

function RequisitionRow({ req, accountName, isOpen, onToggle, initialCounters, initialNotes, entryId, onSave, onDelete }: RowProps) {
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
                onChange={(e) => setCounters({ ...counters, [c.key]: Math.max(0, Number(e.target.value) || 0) })}
                className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
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
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What did you do today on this req?"
              className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
            />
          </div>
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
        </div>
      )}
    </div>
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
