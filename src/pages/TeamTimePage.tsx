/**
 * Team Time — manager/admin approval queue for submitted time entries.
 *
 * Visible to role IN ('admin','manager').
 *
 *   - Admin sees ALL submitted/approved/rejected entries across the org.
 *   - Manager sees only their direct reports (authorized_users.manager_email
 *     pointing at them).
 *
 * Default tab = Pending (status='submitted'). Other tabs: Approved (last 30d),
 * Rejected (last 30d), All (last 30d).
 *
 * Inline Approve / Reject buttons. Reject opens a small reason prompt. Bulk
 * approve checkbox column at the left for blasting through a backlog.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check, X, Filter, CheckCheck, Download, Pencil, Paperclip, History, Loader2, Upload, Search } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { DocumentsPanel } from '../components/timesheet/DocumentsPanel';
import { useAuthStore } from '../store/useAuthStore';
import { useTimeEntryStore } from '../store/useTimeEntryStore';
import { db, formatDbError } from '../lib/supabaseSync';
import { TaIdentity } from '../components/TaIdentity';
import type { TimeEntry, TimeEntryAudit } from '../types/timeEntry';

/** Parse YYYY-MM-DD as LOCAL midnight (avoids UTC day-shift). */
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
/** Monday-based week bounds for a given work date (matches My Time). */
function weekBounds(workDate: string): { periodStart: string; periodEnd: string } {
  const d = parseIsoDate(workDate);
  const dow = d.getDay() || 7; // Sun=0 -> 7
  if (dow !== 1) d.setDate(d.getDate() - (dow - 1));
  const monday = new Date(d);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { periodStart: toIsoDate(monday), periodEnd: toIsoDate(sunday) };
}

/** Human labels for audit column names (snake_case from the DB snapshot). */
const AUDIT_FIELD_LABEL: Record<string, string> = {
  employee_email: 'employee',
  work_date: 'date',
  project_id: 'project id',
  project_name: 'project',
  hours: 'hours',
  billable: 'billable',
  notes: 'notes',
  source: 'source',
  status: 'status',
  submitted_at: 'submitted at',
  approved_by: 'approved by',
  approved_at: 'approved at',
  reject_reason: 'reject reason',
};

/** Render a raw JSONB snapshot value for display in the history modal. */
function formatAuditValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

type TabKey = 'pending' | 'approved' | 'rejected' | 'all';

type EditState = { id: string; hours: string; billable: boolean; projectName: string; notes: string };
type DocsTarget = { employeeEmail: string; periodStart: string; periodEnd: string };

const TAB_LABELS: { key: TabKey; label: string; statuses: TimeEntry['status'][] }[] = [
  { key: 'pending',  label: 'Pending',  statuses: ['submitted'] },
  { key: 'approved', label: 'Approved', statuses: ['approved'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
  { key: 'all',      label: 'All',      statuses: ['submitted', 'approved', 'rejected', 'draft'] },
];

const STATUS_PILL: Record<TimeEntry['status'], string> = {
  draft:     'bg-slate-100 text-slate-600',
  submitted: 'bg-sky-100 text-sky-800',
  approved:  'bg-emerald-100 text-emerald-800',
  rejected:  'bg-red-100 text-red-800',
};

export default function TeamTimePage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const loading = useAuthStore((s) => s.loading);
  const directory = useAuthStore((s) => s.directory);
  const role = currentUser?.role;

  const { entries, approveEntry, rejectEntry, updateEntryFields } = useTimeEntryStore();

  const [tab, setTab] = useState<TabKey>('pending');
  const [filterEmployee, setFilterEmployee] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [editing, setEditing] = useState<EditState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [docsTarget, setDocsTarget] = useState<DocsTarget | null>(null);
  const [historyTarget, setHistoryTarget] = useState<TimeEntry | null>(null);
  const [historyRows, setHistoryRows] = useState<TimeEntryAudit[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Standalone "Upload documents for any resource" modal — lets a manager/admin
  // attach a week's timesheet docs to ANY resource, including contractors who
  // have never submitted a time entry (so they have no row + no per-row Docs button).
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerEmail, setPickerEmail] = useState('');
  // Any day inside the target week; weekBounds() snaps it to Monday–Sunday.
  const [pickerWeekDay, setPickerWeekDay] = useState(() => toIsoDate(new Date()));

  // Load the audit trail whenever a History modal opens.
  useEffect(() => {
    if (!historyTarget) return;
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryRows([]);
    db.getTimeEntryAudit(historyTarget.id)
      .then((rows) => { if (!cancelled) setHistoryRows(rows); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [historyTarget]);

  if (loading) {
    return <div className="py-12 text-center text-sm text-slate-400">Checking permissions…</div>;
  }
  if (role !== 'admin' && role !== 'manager') {
    return <Navigate to="/" replace />;
  }

  const myEmail = (currentUser?.email || '').toLowerCase();
  const isAdmin = role === 'admin';

  // 30-day window for non-pending tabs
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const visibleEntries = useMemo(() => {
    const tabConf = TAB_LABELS.find((t) => t.key === tab)!;
    return entries.filter((e) => {
      if (!tabConf.statuses.includes(e.status)) return false;
      if (tab !== 'pending' && e.workDate < cutoffIso) return false;
      if (filterEmployee && !e.employeeEmail.toLowerCase().includes(filterEmployee.toLowerCase())) return false;
      // Managers (non-admin) see only their direct reports.
      // We can't check manager_email here without re-fetching authorized_users —
      // RLS server-side is the real gate. Show whatever the server returned.
      if (!isAdmin && e.employeeEmail.toLowerCase() === myEmail) return false;
      return true;
    }).sort((a, b) => {
      // newest first
      if (a.workDate !== b.workDate) return a.workDate < b.workDate ? 1 : -1;
      return a.employeeEmail.localeCompare(b.employeeEmail);
    });
  }, [entries, tab, filterEmployee, cutoffIso, isAdmin, myEmail]);

  const pendingCount = useMemo(() =>
    entries.filter((e) => e.status === 'submitted' && (isAdmin || e.employeeEmail.toLowerCase() !== myEmail)).length,
    [entries, isAdmin, myEmail],
  );

  // Full resource directory (all authorized_users, loaded at app start and
  // readable by managers + admins via RLS). Includes contractors with zero
  // time entries — that's the whole point of the standalone uploader. Computed
  // as plain derived values (not hooks) so they sit cleanly after the early
  // returns above; the directory is small enough that memoising isn't needed.
  const resources = Object.values(directory)
    .map((p) => ({ email: p.email, name: p.fullName || p.email }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const pickerQuery = pickerSearch.trim().toLowerCase();
  const filteredResources = pickerQuery
    ? resources.filter((r) => r.email.toLowerCase().includes(pickerQuery) || r.name.toLowerCase().includes(pickerQuery))
    : resources;

  const pickerWeek = weekBounds(pickerWeekDay);

  const allSelected = visibleEntries.length > 0 && visibleEntries.every((e) => selected.has(e.id));
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(visibleEntries.map((e) => e.id)));
  };

  const handleBulkApprove = async () => {
    setBulkBusy(true);
    try {
      const ids = visibleEntries.filter((e) => selected.has(e.id) && e.status === 'submitted').map((e) => e.id);
      for (const id of ids) {
        // eslint-disable-next-line no-await-in-loop
        await approveEntry(id, myEmail);
      }
      setSelected(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) return;
    await rejectEntry(id, myEmail, rejectReason.trim());
    setRejecting(null);
    setRejectReason('');
  };

  const openEdit = (e: TimeEntry) => {
    setEditError(null);
    setEditing({ id: e.id, hours: String(e.hours), billable: e.billable, projectName: e.projectName, notes: e.notes ?? '' });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const hours = Number(editing.hours);
    // Match the DB CHECK (hours > 0 AND hours <= 24) with a visible message.
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      setEditError('Hours must be between 0 and 24.');
      return;
    }
    setEditError(null);
    setSavingEdit(true);
    try {
      await updateEntryFields(editing.id, {
        hours,
        billable: editing.billable,
        projectName: editing.projectName.trim(),
        notes: editing.notes,
      });
      setEditing(null);
    } catch (err) {
      // Save failed server-side — keep the modal open and show why. Surface
      // the underlying Supabase/PostgREST error (message + code + details +
      // hint); fall back to generic text only when all of those are empty.
      const detail = formatDbError(err);
      setEditError(detail ? `Save failed: ${detail}` : 'Failed to save changes.');
    } finally {
      setSavingEdit(false);
    }
  };

  const openDocs = (e: TimeEntry) => {
    const { periodStart, periodEnd } = weekBounds(e.workDate);
    setDocsTarget({ employeeEmail: e.employeeEmail.toLowerCase(), periodStart, periodEnd });
  };

  /** Build a CSV string from the currently-visible entries and download it.
   *  Reflects exactly what the table shows — tab + filter both apply.
   *  Filename includes the tab + ISO date so accounting can identify the run. */
  const exportCsv = () => {
    const cols: { label: string; value: (e: TimeEntry) => string }[] = [
      { label: 'Date',        value: (e) => e.workDate },
      { label: 'Employee',    value: (e) => e.employeeEmail },
      { label: 'Project',     value: (e) => e.projectName },
      { label: 'Hours',       value: (e) => e.hours.toFixed(2) },
      { label: 'Billable',    value: (e) => (e.billable ? 'Yes' : 'No') },
      { label: 'Status',      value: (e) => e.status },
      { label: 'Submitted',   value: (e) => e.submittedAt ?? '' },
      { label: 'Approved by', value: (e) => e.approvedBy ?? '' },
      { label: 'Approved at', value: (e) => e.approvedAt ?? '' },
      { label: 'Reject reason', value: (e) => e.rejectReason ?? '' },
      { label: 'Notes',       value: (e) => e.notes ?? '' },
    ];
    const esc = (s: string) => {
      // RFC 4180: quote fields containing comma, quote, or newline; double internal quotes.
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = cols.map((c) => c.label).join(',');
    const rows = visibleEntries.map((e) => cols.map((c) => esc(c.value(e))).join(','));
    const csv = [header, ...rows].join('\r\n');

    const today = new Date().toISOString().slice(0, 10);
    const filename = `time-entries-${tab}-${today}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full">
      <PageHeader
        title="Team Time"
        subtitle={`${isAdmin ? 'All teams' : 'Your direct reports'} · ${pendingCount} pending approval`}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} className="text-slate-400" />
            <input
              placeholder="Filter by employee email…"
              value={filterEmployee}
              onChange={(e) => setFilterEmployee(e.target.value)}
              className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 w-56"
            />
            <button
              type="button"
              onClick={exportCsv}
              disabled={visibleEntries.length === 0}
              className="text-xs font-semibold bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-md hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1.5"
              title={`Download ${visibleEntries.length} entries as CSV`}
            >
              <Download size={12} /> Export CSV
            </button>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 inline-flex items-center gap-1.5"
              title="Upload timesheet documents for any resource — including those with no time entries"
            >
              <Upload size={12} /> Upload documents
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-slate-200">
        {TAB_LABELS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setTab(t.key); setSelected(new Set()); }}
            className={`text-xs font-semibold px-3 py-2 border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {t.label}
            {t.key === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 text-[10px] bg-sky-100 text-sky-800 rounded-full px-1.5 py-0.5">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Bulk bar */}
      {tab === 'pending' && someSelected && (
        <div className="mb-3 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 flex items-center justify-between">
          <span className="text-xs text-emerald-900 font-medium">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={handleBulkApprove}
            disabled={bulkBusy}
            className="text-xs font-semibold bg-emerald-600 text-white px-3 py-1.5 rounded-md hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
          >
            <CheckCheck size={12} /> {bulkBusy ? 'Approving…' : `Approve ${selected.size}`}
          </button>
        </div>
      )}

      {/* Table */}
      <Card title={`${visibleEntries.length} entr${visibleEntries.length === 1 ? 'y' : 'ies'}`}>
        {visibleEntries.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            {tab === 'pending' ? 'No entries waiting for approval. ✓' : 'No entries match.'}
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  {tab === 'pending' && (
                    <th className="py-2 pr-2 font-semibold w-6">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                    </th>
                  )}
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  <th className="py-2 pr-3 font-semibold">Employee</th>
                  <th className="py-2 pr-3 font-semibold">Project</th>
                  <th className="py-2 pr-3 font-semibold text-right">Hours</th>
                  <th className="py-2 pr-3 font-semibold">Billable</th>
                  <th className="py-2 pr-3 font-semibold">Notes</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold text-right w-40">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleEntries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50/60">
                    {tab === 'pending' && (
                      <td className="py-2 pr-2 align-top">
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          onChange={() => {
                            const next = new Set(selected);
                            if (next.has(e.id)) next.delete(e.id); else next.add(e.id);
                            setSelected(next);
                          }}
                        />
                      </td>
                    )}
                    <td className="py-2 pr-3 align-top text-xs tabular-nums text-slate-700">{e.workDate}</td>
                    <td className="py-2 pr-3 align-top"><TaIdentity email={e.employeeEmail} avatarSize={26} nameSize="text-xs" /></td>
                    <td className="py-2 pr-3 align-top text-xs">{e.projectName}</td>
                    <td className="py-2 pr-3 align-top text-xs tabular-nums text-right font-semibold">{e.hours.toFixed(2)}</td>
                    <td className="py-2 pr-3 align-top">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${e.billable ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                        {e.billable ? 'Billable' : 'Non'}
                      </span>
                    </td>
                    <td className="py-2 pr-3 align-top text-xs text-slate-600 max-w-xs truncate" title={e.notes}>
                      {e.notes || '—'}
                    </td>
                    <td className="py-2 pr-3 align-top">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${STATUS_PILL[e.status]}`}>
                        {e.status}
                      </span>
                      {e.status === 'rejected' && e.rejectReason && (
                        <div className="text-[10px] text-red-700 italic mt-0.5 max-w-[180px] truncate" title={e.rejectReason}>{e.rejectReason}</div>
                      )}
                    </td>
                    <td className="py-2 pr-3 align-top text-right">
                      <div className="flex items-center gap-1 justify-end flex-wrap">
                        {e.status === 'submitted' ? (
                          rejecting === e.id ? (
                            <div className="flex items-center gap-1 justify-end">
                              <input
                                autoFocus
                                value={rejectReason}
                                onChange={(ev) => setRejectReason(ev.target.value)}
                                placeholder="Reason…"
                                onKeyDown={(ev) => { if (ev.key === 'Enter') handleReject(e.id); }}
                                className="text-xs border border-slate-300 rounded px-2 py-1 w-32"
                              />
                              <button type="button" onClick={() => handleReject(e.id)}
                                      className="text-xs bg-red-600 text-white px-2 py-1 rounded hover:bg-red-700">
                                OK
                              </button>
                              <button type="button" onClick={() => { setRejecting(null); setRejectReason(''); }}
                                      className="text-xs text-slate-400 hover:text-slate-700">
                                <X size={12} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <button type="button"
                                      onClick={() => approveEntry(e.id, myEmail)}
                                      className="text-xs bg-emerald-600 text-white px-2 py-1 rounded hover:bg-emerald-700 inline-flex items-center gap-1"
                                      title="Approve">
                                <Check size={12} /> Approve
                              </button>
                              <button type="button"
                                      onClick={() => setRejecting(e.id)}
                                      className="text-xs bg-white border border-red-300 text-red-700 px-2 py-1 rounded hover:bg-red-50 inline-flex items-center gap-1"
                                      title="Reject">
                                <X size={12} /> Reject
                              </button>
                            </>
                          )
                        ) : e.status === 'approved' && isAdmin ? (
                          <button type="button"
                                  onClick={() => rejectEntry(e.id, myEmail, 'Unapproved by admin')}
                                  className="text-[11px] text-slate-400 hover:text-red-700">
                            Unapprove
                          </button>
                        ) : null}
                        {/* Manager/admin: edit any existing entry + manage that week's documents */}
                        {rejecting !== e.id && (
                          <>
                            <button type="button"
                                    onClick={() => openEdit(e)}
                                    className="text-xs bg-white border border-slate-300 text-slate-700 px-2 py-1 rounded hover:bg-slate-50 inline-flex items-center gap-1"
                                    title="Edit entry">
                              <Pencil size={12} /> Edit
                            </button>
                            <button type="button"
                                    onClick={() => openDocs(e)}
                                    className="text-xs bg-white border border-slate-300 text-slate-700 px-2 py-1 rounded hover:bg-slate-50 inline-flex items-center gap-1"
                                    title="Manage this week's documents">
                              <Paperclip size={12} /> Docs
                            </button>
                            <button type="button"
                                    onClick={() => setHistoryTarget(e)}
                                    className="text-xs bg-white border border-slate-300 text-slate-700 px-2 py-1 rounded hover:bg-slate-50 inline-flex items-center gap-1"
                                    title="View change history">
                              <History size={12} /> History
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Edit-entry modal (manager/admin edits an existing employee entry) */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !savingEdit && setEditing(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Edit time entry</h3>
              <button type="button" onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Project</label>
                <input
                  value={editing.projectName}
                  onChange={(ev) => setEditing({ ...editing, projectName: ev.target.value })}
                  className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Hours</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    value={editing.hours}
                    onChange={(ev) => setEditing({ ...editing, hours: ev.target.value })}
                    className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700 mt-5">
                  <input
                    type="checkbox"
                    checked={editing.billable}
                    onChange={(ev) => setEditing({ ...editing, billable: ev.target.checked })}
                  />
                  Billable
                </label>
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Notes</label>
                <textarea
                  rows={3}
                  value={editing.notes}
                  onChange={(ev) => setEditing({ ...editing, notes: ev.target.value })}
                  className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <p className="text-[11px] text-slate-400">Editing hours, billable, or project on an approved entry re-opens it for approval.</p>
              {editError && (
                <p className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{editError}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button type="button" onClick={() => setEditing(null)} disabled={savingEdit}
                      className="text-xs font-semibold px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40">
                Cancel
              </button>
              <button type="button" onClick={saveEdit} disabled={savingEdit}
                      className="text-xs font-semibold px-3 py-1.5 bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1.5">
                {savingEdit ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Documents modal (manager/admin manages an employee's weekly timesheet docs) */}
      {docsTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setDocsTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 truncate">Documents · {docsTarget.employeeEmail}</h3>
                <p className="text-[11px] text-slate-500">Week of {docsTarget.periodStart} – {docsTarget.periodEnd}</p>
              </div>
              <button type="button" onClick={() => setDocsTarget(null)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
            </div>
            <DocumentsPanel
              employeeEmail={docsTarget.employeeEmail}
              periodStart={docsTarget.periodStart}
              periodEnd={docsTarget.periodEnd}
              uploadedBy={myEmail}
            />
          </div>
        </div>
      )}

      {/* Standalone upload modal — pick ANY resource + week, then manage its docs.
          Covers contractors with no time entries (no row → no per-row Docs button). */}
      {uploadOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setUploadOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">Upload timesheet documents</h3>
                <p className="text-[11px] text-slate-500">Pick any resource and a week — works even for resources with no time entries.</p>
              </div>
              <button type="button" onClick={() => setUploadOpen(false)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
            </div>

            <div className="space-y-4">
              {/* Resource picker */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Resource</label>
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={pickerSearch}
                    onChange={(ev) => setPickerSearch(ev.target.value)}
                    placeholder="Search by name or email…"
                    className="w-full border border-slate-300 rounded-md pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <div className="mt-2 border border-slate-200 rounded-md max-h-52 overflow-y-auto divide-y divide-slate-100">
                  {filteredResources.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-400">No resources match.</div>
                  ) : (
                    filteredResources.map((r) => (
                      <button
                        key={r.email}
                        type="button"
                        onClick={() => setPickerEmail(r.email)}
                        className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50 ${
                          pickerEmail === r.email ? 'bg-primary/5' : ''
                        }`}
                      >
                        <TaIdentity email={r.email} avatarSize={26} nameSize="text-xs" />
                        {pickerEmail === r.email && <Check size={14} className="text-primary flex-shrink-0" />}
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Week picker */}
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Week</label>
                <div className="flex items-center gap-3 flex-wrap">
                  <input
                    type="date"
                    value={pickerWeekDay}
                    onChange={(ev) => ev.target.value && setPickerWeekDay(ev.target.value)}
                    className="border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <span className="text-[11px] text-slate-500">Week of {pickerWeek.periodStart} – {pickerWeek.periodEnd} (Mon–Sun)</span>
                </div>
              </div>

              {/* Documents for the chosen resource + week */}
              {pickerEmail ? (
                <DocumentsPanel
                  employeeEmail={pickerEmail}
                  periodStart={pickerWeek.periodStart}
                  periodEnd={pickerWeek.periodEnd}
                  uploadedBy={myEmail}
                />
              ) : (
                <div className="border border-dashed border-slate-200 rounded-lg py-8 text-center text-sm text-slate-400">
                  Select a resource above to manage its documents for this week.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History modal (audit trail for one entry — who changed what, when) */}
      {historyTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setHistoryTarget(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-5 max-h-[85vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900 truncate">Change history</h3>
                <p className="text-[11px] text-slate-500 truncate">
                  {historyTarget.employeeEmail} · {historyTarget.workDate} · {historyTarget.projectName}
                </p>
              </div>
              <button type="button" onClick={() => setHistoryTarget(null)} className="text-slate-400 hover:text-slate-700"><X size={16} /></button>
            </div>

            {historyLoading ? (
              <div className="py-10 text-center text-sm text-slate-400 inline-flex items-center gap-2 justify-center w-full">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : historyRows.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">No changes recorded yet.</div>
            ) : (
              <ol className="space-y-3">
                {historyRows.map((a) => (
                  <li key={a.id} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                        a.operation === 'INSERT' ? 'bg-emerald-100 text-emerald-800'
                        : a.operation === 'DELETE' ? 'bg-red-100 text-red-800'
                        : 'bg-sky-100 text-sky-800'
                      }`}>
                        {a.operation === 'INSERT' ? 'Created' : a.operation === 'DELETE' ? 'Deleted' : 'Edited'}
                      </span>
                      <span className="text-[11px] tabular-nums text-slate-400">
                        {new Date(a.changedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      by <span className="font-medium text-slate-800">{a.changedByEmail || 'unknown'}</span>
                      {a.changedByRole && <span className="text-slate-400"> ({a.changedByRole})</span>}
                    </div>
                    {/* Field-level diff for edits */}
                    {a.operation === 'UPDATE' && a.changedFields.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {a.changedFields.map((f) => (
                          <li key={f} className="text-xs text-slate-700">
                            <span className="text-slate-500">{AUDIT_FIELD_LABEL[f] ?? f}:</span>{' '}
                            <span className="line-through text-slate-400">{formatAuditValue(a.oldData?.[f])}</span>
                            {' → '}
                            <span className="font-medium">{formatAuditValue(a.newData?.[f])}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {a.operation === 'UPDATE' && a.changedFields.length === 0 && (
                      <div className="text-[11px] text-slate-400 italic mt-1">No tracked fields changed.</div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
