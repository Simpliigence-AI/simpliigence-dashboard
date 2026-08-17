/**
 * Team Leave — manager/admin VIEW of every employee's leave requests.
 *
 * Visible to role IN ('admin','manager').
 *
 *   - Admin sees ALL leave requests across the org.
 *   - Manager sees every employee's requests too (the additive
 *     "admin/manager read all" SELECT policy in migration 022 grants this).
 *     Until that migration is applied, RLS limits a manager to their own +
 *     routed-to-them requests, and the page shows only those.
 *
 * This page is VIEW-ONLY — approve/reject actions live on the Leave page's
 * Approvals tab. Data is loaded via the keyset-paginated fetchAllLeaveRequests
 * (not the RLS-limited store hydrate) so it never truncates at 1000 rows.
 *
 * Modeled on TeamTimePage (tabs, filter box, table, Tailwind classes).
 */
import { useEffect, useMemo, useState } from 'react';
import { Filter, Download, Loader2, Search } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Badge } from '../components/ui';
import { useAuthStore } from '../store/useAuthStore';
import { useLeaveStore } from '../store/useLeaveStore';
import { fetchAllLeaveRequests } from '../lib/supabaseSync';
import { TaIdentity } from '../components/TaIdentity';
import { LEAVE_STATUS_META } from '../types/leave';
import type { LeaveRequest, LeaveStatus } from '../types/leave';

type TabKey = 'pending' | 'approved' | 'rejected' | 'all';

const TAB_LABELS: { key: TabKey; label: string; statuses: LeaveStatus[] }[] = [
  { key: 'pending',  label: 'Pending',  statuses: ['pending'] },
  { key: 'approved', label: 'Approved', statuses: ['approved'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
  { key: 'all',      label: 'All',      statuses: ['pending', 'approved', 'rejected', 'cancelled'] },
];

export default function TeamLeavePage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const loading = useAuthStore((s) => s.loading);
  const role = currentUser?.role;

  // Leave-type catalog is a public catalog (readable by everyone) so it comes
  // from the store; we only need it to resolve leave_type_id → name.
  const types = useLeaveStore((s) => s.types);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('pending');
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterType, setFilterType] = useState('');

  const myEmail = (currentUser?.email || '').toLowerCase();
  const isAdmin = role === 'admin';

  // Load ALL requests via the paginated fetch (not the RLS-limited hydrate).
  // `dataLoading` initialises to true, so we don't set it synchronously here.
  useEffect(() => {
    let cancelled = false;
    fetchAllLeaveRequests()
      .then((rows) => { if (!cancelled) setRequests(rows); })
      .finally(() => { if (!cancelled) setDataLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const visibleRequests = useMemo(() => {
    const tabConf = TAB_LABELS.find((t) => t.key === tab)!;
    const empQ = filterEmployee.trim().toLowerCase();
    return requests.filter((r) => {
      if (!tabConf.statuses.includes(r.status)) return false;
      if (empQ && !r.employeeEmail.toLowerCase().includes(empQ)) return false;
      if (filterType && r.leaveTypeId !== filterType) return false;
      // Managers (non-admin) view their team, not their own requests — those
      // live on the Leave page. RLS server-side is the real gate; this just
      // keeps the manager's own rows out of the team view.
      if (!isAdmin && r.employeeEmail.toLowerCase() === myEmail) return false;
      return true;
    }).sort((a, b) => {
      // newest start date first, then employee
      if (a.startDate !== b.startDate) return a.startDate < b.startDate ? 1 : -1;
      return a.employeeEmail.localeCompare(b.employeeEmail);
    });
  }, [requests, tab, filterEmployee, filterType, isAdmin, myEmail]);

  const pendingCount = useMemo(() =>
    requests.filter((r) => r.status === 'pending' && (isAdmin || r.employeeEmail.toLowerCase() !== myEmail)).length,
    [requests, isAdmin, myEmail],
  );

  // Role gate — after all hooks so hook order is stable across renders.
  if (loading) {
    return <div className="py-12 text-center text-sm text-muted/70">Checking permissions…</div>;
  }
  if (role !== 'admin' && role !== 'manager') {
    return <Navigate to="/" replace />;
  }

  /** Build a CSV from the currently-visible requests and download it.
   *  Reflects exactly what the table shows — tab + filters both apply. */
  const exportCsv = () => {
    const cols: { label: string; value: (r: LeaveRequest) => string }[] = [
      { label: 'Employee',   value: (r) => r.employeeEmail },
      { label: 'Leave type', value: (r) => typeById.get(r.leaveTypeId)?.name || r.leaveTypeId },
      { label: 'Start',      value: (r) => r.startDate },
      { label: 'End',        value: (r) => r.endDate },
      { label: 'Days',       value: (r) => String(r.days) },
      { label: 'Status',     value: (r) => r.status },
      { label: 'Manager',    value: (r) => r.managerEmail ?? '' },
      { label: 'Reason',     value: (r) => r.reason ?? '' },
      { label: 'Decided by', value: (r) => r.decidedBy ?? '' },
      { label: 'Decided at', value: (r) => r.decidedAt ?? '' },
      { label: 'Comment',    value: (r) => r.decisionComment ?? '' },
    ];
    const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const header = cols.map((c) => c.label).join(',');
    const rows = visibleRequests.map((r) => cols.map((c) => esc(c.value(r))).join(','));
    const csv = [header, ...rows].join('\r\n');
    const today = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `team-leave-${tab}-${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full">
      <PageHeader
        title="Team Leave"
        subtitle={`${isAdmin ? 'All teams' : 'Your team'} · ${pendingCount} pending`}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={14} className="text-muted/70" />
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted/70" />
              <input
                placeholder="Filter by employee email…"
                value={filterEmployee}
                onChange={(e) => setFilterEmployee(e.target.value)}
                className="border border-line rounded-md pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 w-56"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="border border-line rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">All leave types</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={exportCsv}
              disabled={visibleRequests.length === 0}
              className="text-xs font-semibold bg-surface border border-line text-ink/80 px-3 py-1.5 rounded-md hover:bg-surface-2/70 disabled:opacity-40 inline-flex items-center gap-1.5"
              title={`Download ${visibleRequests.length} requests as CSV`}
            >
              <Download size={12} /> Export CSV
            </button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-line">
        {TAB_LABELS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`text-xs font-semibold px-3 py-2 border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
            {t.key === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-800 rounded-full px-1.5 py-0.5">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <Card title={`${visibleRequests.length} request${visibleRequests.length === 1 ? '' : 's'}`}>
        {dataLoading ? (
          <div className="py-12 text-center text-sm text-muted/70 inline-flex items-center gap-2 justify-center w-full">
            <Loader2 size={14} className="animate-spin" /> Loading leave requests…
          </div>
        ) : visibleRequests.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted">
            {tab === 'pending' ? 'No pending leave requests. ✓' : 'No requests match.'}
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted border-b border-line/60">
                  <th className="py-2 pr-3 font-semibold">Employee</th>
                  <th className="py-2 pr-3 font-semibold">Leave type</th>
                  <th className="py-2 pr-3 font-semibold">Dates</th>
                  <th className="py-2 pr-3 font-semibold text-right">Days</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Manager</th>
                  <th className="py-2 pr-3 font-semibold">Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {visibleRequests.map((r) => {
                  const t = typeById.get(r.leaveTypeId);
                  return (
                    <tr key={r.id} className="hover:bg-surface-2/60">
                      <td className="py-2 pr-3 align-top">
                        <TaIdentity email={r.employeeEmail} avatarSize={26} nameSize="text-xs" />
                      </td>
                      <td className="py-2 pr-3 align-top text-xs">
                        <span className="inline-flex items-center gap-1.5">
                          {t?.color && (
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                          )}
                          {t?.name || r.leaveTypeId}
                        </span>
                        {r.reason && (
                          <div className="text-[10px] text-muted italic mt-0.5 max-w-[200px] truncate" title={r.reason}>
                            {r.reason}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 align-top text-xs tabular-nums text-ink/80 whitespace-nowrap">
                        {r.startDate === r.endDate ? r.startDate : `${r.startDate} → ${r.endDate}`}
                      </td>
                      <td className="py-2 pr-3 align-top text-xs tabular-nums text-right font-semibold">
                        {r.days}
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <Badge className={LEAVE_STATUS_META[r.status].cls}>{LEAVE_STATUS_META[r.status].label}</Badge>
                      </td>
                      <td className="py-2 pr-3 align-top text-xs text-muted">
                        {r.managerEmail || '—'}
                      </td>
                      <td className="py-2 pr-3 align-top text-xs text-muted">
                        {r.decidedBy ? (
                          <div>
                            <div>
                              <span className="text-muted">by </span>
                              <span className="font-medium text-ink">{r.decidedBy}</span>
                            </div>
                            {r.decidedAt && (
                              <div className="text-[10px] text-muted/70 tabular-nums">
                                {new Date(r.decidedAt).toLocaleDateString()}
                              </div>
                            )}
                            {r.decisionComment && (
                              <div className="text-[10px] italic text-muted max-w-[200px] truncate" title={r.decisionComment}>
                                {r.decisionComment}
                              </div>
                            )}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
