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
import { useMemo, useState } from 'react';
import { Check, X, Filter, CheckCheck } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useAuthStore } from '../store/useAuthStore';
import { useTimeEntryStore } from '../store/useTimeEntryStore';
import type { TimeEntry } from '../types/timeEntry';

type TabKey = 'pending' | 'approved' | 'rejected' | 'all';

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
  const role = currentUser?.role;

  const { entries, approveEntry, rejectEntry } = useTimeEntryStore();

  const [tab, setTab] = useState<TabKey>('pending');
  const [filterEmployee, setFilterEmployee] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

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

  return (
    <div className="max-w-7xl mx-auto">
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
                    <td className="py-2 pr-3 align-top text-xs text-slate-900 font-medium">{e.employeeEmail}</td>
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
                          <div className="flex items-center gap-1 justify-end">
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
                          </div>
                        )
                      ) : e.status === 'approved' && isAdmin ? (
                        <button type="button"
                                onClick={() => rejectEntry(e.id, myEmail, 'Unapproved by admin')}
                                className="text-[11px] text-slate-400 hover:text-red-700">
                          Unapprove
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
