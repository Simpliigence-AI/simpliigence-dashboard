/**
 * Leave — request time off, see remaining balance, approve reports' requests.
 *
 * Two tabs:
 *   1. My Requests — balance cards per leave type + a list of the user's
 *      own requests. Primary action is "Request Leave".
 *   2. Approvals   — visible to anyone with at least one request routed to
 *      them (i.e. anyone marked as manager_email on another user's row).
 *      Pending decisions surface first with Approve / Reject actions.
 *
 * Balances are computed on the fly from `leave_types.annual_quota` minus
 * the sum of approved-request days in the current calendar year. Pending
 * days are also tracked so the balance card can show a hold.
 *
 * Manager routing pulls from `authorized_users.manager_email` at submit
 * time — the current value is snapshotted onto the request so a later
 * org-chart change doesn't retroactively re-route a pending request.
 */
import { useMemo, useState } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import {
  Calendar, CheckCircle2, XCircle, Clock, Plus, AlertCircle,
  ThumbsUp, ThumbsDown, User, Palmtree, Users as UsersIcon,
} from 'lucide-react';
import { useLeaveStore } from '../store/useLeaveStore';
import { useAuthStore } from '../store/useAuthStore';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard, Badge, Button, EmptyState } from '../components/ui';
import {
  LEAVE_STATUS_META, computeBalances, countDaysInclusive, isTypeVisibleTo,
  type LeaveRequest,
} from '../types/leave';

/* Tight native form controls — the shared Input/Select wrappers add labels
 * and margins that don't fit the dense dialog rows here. */
const INPUT_CLS = 'w-full px-3 py-2 rounded-lg border border-line text-sm text-ink placeholder:text-muted/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary';
const Input = ({ className = '', ...p }: InputHTMLAttributes<HTMLInputElement>) =>
  <input className={`${INPUT_CLS} ${className}`} {...p} />;
const Select = ({ className = '', children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) =>
  <select className={`${INPUT_CLS} bg-surface ${className}`} {...p}>{children}</select>;
const Textarea = ({ className = '', ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea className={`${INPUT_CLS} ${className}`} {...p} />;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtRange(a: string, b: string): string {
  if (a === b) return fmtDate(a);
  const start = new Date(a + 'T00:00:00');
  const end = new Date(b + 'T00:00:00');
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}–${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${fmtDate(a)} → ${fmtDate(b)}`;
}

export default function LeavePage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const directory = useAuthStore((s) => s.directory);
  const { types, requests, allocations, submitRequest, decideRequest, cancelRequest } = useLeaveStore();

  const [tab, setTab] = useState<'mine' | 'approvals'>('mine');
  const [showNewRequest, setShowNewRequest] = useState(false);
  const [decideOn, setDecideOn] = useState<{ req: LeaveRequest; decision: 'approved' | 'rejected' } | null>(null);

  const email = (currentUser?.email || '').toLowerCase();
  const year = new Date().getFullYear();

  const myRequests = useMemo(
    () => requests.filter((r) => r.employeeEmail.toLowerCase() === email),
    [requests, email],
  );

  const toApprove = useMemo(
    () => requests.filter((r) => (r.managerEmail || '').toLowerCase() === email),
    [requests, email],
  );

  const pendingApprovals = toApprove.filter((r) => r.status === 'pending');
  const isManager = toApprove.length > 0;

  const balances = useMemo(
    () => computeBalances(types, myRequests, allocations, email, year, currentUser?.gender),
    [types, myRequests, allocations, email, year, currentUser?.gender],
  );
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const managerProfile = currentUser?.managerEmail ? directory[currentUser.managerEmail.toLowerCase()] : null;

  return (
    <div>
      <PageHeader
        title="Leave"
        subtitle="Request time off, see remaining balance, and approve requests routed to you."
        action={
          <Button onClick={() => setShowNewRequest(true)}>
            <Plus size={14} /> Request Leave
          </Button>
        }
      />

      {/* Tab bar */}
      <div className="flex gap-1 bg-surface border border-line rounded-lg p-1 mb-6 w-fit">
        <button
          type="button"
          onClick={() => setTab('mine')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 ${
            tab === 'mine' ? 'bg-primary text-white' : 'text-muted hover:bg-surface-2'
          }`}
        >
          <User size={14} /> My Requests
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tab === 'mine' ? 'bg-surface/25 text-white' : 'bg-surface-2 text-muted'}`}>
            {myRequests.length}
          </span>
        </button>
        {isManager && (
          <button
            type="button"
            onClick={() => setTab('approvals')}
            className={`px-3 py-1.5 rounded-md text-sm font-medium inline-flex items-center gap-1.5 ${
              tab === 'approvals' ? 'bg-primary text-white' : 'text-muted hover:bg-surface-2'
            }`}
          >
            <UsersIcon size={14} /> Approvals
            {pendingApprovals.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-500 text-white font-bold">
                {pendingApprovals.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── MY REQUESTS ─────────────────────────── */}
      {tab === 'mine' && (
        <>
          {/* Balance cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {balances.map((b) => {
              const t = typeById.get(b.typeId);
              if (!t) return null;
              return (
                <StatCard
                  key={b.typeId}
                  label={t.name}
                  value={`${b.remaining} d`}
                  subtitle={
                    b.pending > 0
                      ? `${b.used} used · ${b.pending} pending · ${b.quota} total`
                      : `${b.used} of ${b.quota} used`
                  }
                  icon={
                    <span
                      className="w-5 h-5 rounded-md flex items-center justify-center"
                      style={{ background: t.color, color: 'white' }}
                    >
                      <Palmtree size={12} />
                    </span>
                  }
                />
              );
            })}
          </div>

          {/* Manager info */}
          {currentUser?.managerEmail ? (
            <div className="mb-4 flex items-center gap-2 text-xs text-muted bg-surface-2/70 border border-line rounded-lg px-3 py-2 w-fit">
              <UsersIcon size={13} className="text-muted/70" />
              Requests route to your manager <strong>{managerProfile?.fullName || currentUser.managerEmail}</strong>
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 w-fit">
              <AlertCircle size={13} />
              No manager set on your profile — requests will need an admin to approve. Ask your admin to set your manager on the Users page.
            </div>
          )}

          {/* My requests list */}
          {myRequests.length === 0 ? (
            <EmptyState
              icon={<Palmtree size={32} />}
              title="No leave requests yet"
              description="Click Request Leave to submit your first one. Once approved, the days deduct from the matching balance above."
            />
          ) : (
            <Card>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line/60 text-left">
                    <th className="py-2 pr-3 text-xs font-semibold text-muted uppercase tracking-wide">Type</th>
                    <th className="py-2 pr-3 text-xs font-semibold text-muted uppercase tracking-wide">Dates</th>
                    <th className="py-2 pr-3 text-xs font-semibold text-muted uppercase tracking-wide">Days</th>
                    <th className="py-2 pr-3 text-xs font-semibold text-muted uppercase tracking-wide">Reason</th>
                    <th className="py-2 pr-3 text-xs font-semibold text-muted uppercase tracking-wide">Status</th>
                    <th className="py-2 text-xs font-semibold text-muted uppercase tracking-wide w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {myRequests.map((r) => {
                    const t = typeById.get(r.leaveTypeId);
                    return (
                      <tr key={r.id} className="border-b border-line/40 last:border-0">
                        <td className="py-2 pr-3">
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold text-white"
                            style={{ background: t?.color || '#64748b' }}
                          >
                            {t?.name || '—'}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-ink/80 whitespace-nowrap">{fmtRange(r.startDate, r.endDate)}</td>
                        <td className="py-2 pr-3 text-ink/80 font-medium">{r.days}</td>
                        <td className="py-2 pr-3 text-muted max-w-xs truncate" title={r.reason ?? ''}>{r.reason || '—'}</td>
                        <td className="py-2 pr-3">
                          <Badge className={LEAVE_STATUS_META[r.status].cls}>{LEAVE_STATUS_META[r.status].label}</Badge>
                        </td>
                        <td className="py-2 text-right">
                          {(r.status === 'pending' || r.status === 'approved') && (
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Cancel this ${r.status} request?`)) {
                                  cancelRequest(r.id, email);
                                }
                              }}
                              className="text-xs text-muted hover:text-rose-600 underline-offset-2 hover:underline"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {/* ── APPROVALS ───────────────────────────── */}
      {tab === 'approvals' && (
        <Card
          title={`Requests routed to you (${toApprove.length})`}
          action={pendingApprovals.length > 0
            ? <span className="text-xs font-semibold text-rose-600">{pendingApprovals.length} awaiting decision</span>
            : <span className="text-xs text-muted">All caught up</span>}
        >
          {toApprove.length === 0 ? (
            <p className="text-center text-muted py-8">No one has you set as their manager yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line/60 text-left">
                  <th className="py-2 pr-3 text-xs font-semibold text-muted uppercase tracking-wide">Employee</th>
                  <th className="py-2 pr-3 text-xs font-semibold text-muted uppercase tracking-wide">Type</th>
                  <th className="py-2 pr-3 text-xs font-semibold text-muted uppercase tracking-wide">Dates</th>
                  <th className="py-2 pr-3 text-xs font-semibold text-muted uppercase tracking-wide">Days</th>
                  <th className="py-2 pr-3 text-xs font-semibold text-muted uppercase tracking-wide">Reason</th>
                  <th className="py-2 pr-3 text-xs font-semibold text-muted uppercase tracking-wide">Status</th>
                  <th className="py-2 text-xs font-semibold text-muted uppercase tracking-wide w-44"></th>
                </tr>
              </thead>
              <tbody>
                {[...toApprove]
                  .sort((a, b) => {
                    // pending first, then most recent
                    const pa = a.status === 'pending' ? 0 : 1;
                    const pb = b.status === 'pending' ? 0 : 1;
                    if (pa !== pb) return pa - pb;
                    return (b.createdAt || '').localeCompare(a.createdAt || '');
                  })
                  .map((r) => {
                    const t = typeById.get(r.leaveTypeId);
                    const emp = directory[r.employeeEmail.toLowerCase()];
                    return (
                      <tr key={r.id} className="border-b border-line/40 last:border-0">
                        <td className="py-2 pr-3 text-ink font-medium">{emp?.fullName || r.employeeEmail}</td>
                        <td className="py-2 pr-3">
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold text-white"
                            style={{ background: t?.color || '#64748b' }}
                          >
                            {t?.name || '—'}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-ink/80 whitespace-nowrap">{fmtRange(r.startDate, r.endDate)}</td>
                        <td className="py-2 pr-3 text-ink/80 font-medium">{r.days}</td>
                        <td className="py-2 pr-3 text-muted max-w-xs truncate" title={r.reason ?? ''}>{r.reason || '—'}</td>
                        <td className="py-2 pr-3">
                          <Badge className={LEAVE_STATUS_META[r.status].cls}>{LEAVE_STATUS_META[r.status].label}</Badge>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          {r.status === 'pending' ? (
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setDecideOn({ req: r, decision: 'approved' })}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500"
                              >
                                <ThumbsUp size={11} /> Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => setDecideOn({ req: r, decision: 'rejected' })}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500"
                              >
                                <ThumbsDown size={11} /> Reject
                              </button>
                            </div>
                          ) : r.decidedAt ? (
                            <span className="text-[11px] text-muted">
                              {r.status === 'approved' ? <CheckCircle2 size={11} className="inline mr-1 text-emerald-500" /> :
                                r.status === 'rejected' ? <XCircle size={11} className="inline mr-1 text-rose-500" /> :
                                <Clock size={11} className="inline mr-1 text-muted/70" />}
                              {fmtDate(r.decidedAt)}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* ── New request dialog ──────────────────── */}
      {showNewRequest && currentUser && (
        <NewRequestDialog
          onClose={() => setShowNewRequest(false)}
          onSubmit={async ({ leaveTypeId, startDate, endDate, reason }) => {
            await submitRequest({
              employeeEmail: currentUser.email,
              leaveTypeId,
              startDate,
              endDate,
              reason,
              managerEmail: currentUser.managerEmail,
            });
            setShowNewRequest(false);
          }}
        />
      )}

      {/* ── Decision dialog ─────────────────────── */}
      {decideOn && (
        <DecisionDialog
          request={decideOn.req}
          decision={decideOn.decision}
          typeName={typeById.get(decideOn.req.leaveTypeId)?.name || '—'}
          employeeName={directory[decideOn.req.employeeEmail.toLowerCase()]?.fullName || decideOn.req.employeeEmail}
          onCancel={() => setDecideOn(null)}
          onConfirm={async (comment) => {
            await decideRequest(decideOn.req.id, decideOn.decision, email, comment);
            setDecideOn(null);
          }}
        />
      )}
    </div>
  );
}

/* ── New request dialog ─────────────────────────── */

function NewRequestDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (params: { leaveTypeId: string; startDate: string; endDate: string; reason: string }) => Promise<void>;
}) {
  const { types, requests, allocations } = useLeaveStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  const [leaveTypeId, setLeaveTypeId] = useState<string>(types[0]?.id ?? '');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = countDaysInclusive(startDate, endDate);
  // Gate hidden (gendered) types out of the dropdown so they can't be selected.
  const activeTypes = types.filter((t) => t.active && isTypeVisibleTo(t, currentUser?.gender));

  const balances = useMemo(() => {
    const email = (currentUser?.email || '').toLowerCase();
    const mine = requests.filter((r) => r.employeeEmail.toLowerCase() === email);
    return computeBalances(activeTypes, mine, allocations, email, new Date().getFullYear(), currentUser?.gender);
  }, [activeTypes, requests, allocations, currentUser?.email, currentUser?.gender]);
  const currentBalance = balances.find((b) => b.typeId === leaveTypeId);

  const submit = async () => {
    setError(null);
    if (!leaveTypeId) { setError('Pick a leave type.'); return; }
    if (!startDate || !endDate) { setError('Set both start and end dates.'); return; }
    if (new Date(endDate) < new Date(startDate)) { setError('End date must be on or after start date.'); return; }
    if (days <= 0) { setError('Must be at least one day.'); return; }
    setSubmitting(true);
    try {
      await onSubmit({ leaveTypeId, startDate, endDate, reason });
    } catch (e) {
      setError((e as Error).message || 'Submit failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={18} className="text-primary" />
          <h3 className="text-base font-bold text-ink">Request Leave</h3>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted uppercase tracking-wider">Type</label>
            <Select value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} className="mt-1">
              {activeTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
              ))}
            </Select>
            {currentBalance && (
              <p className="text-[11px] text-muted mt-1">
                {currentBalance.remaining} of {currentBalance.quota} days remaining this year
                {currentBalance.pending > 0 && ` (${currentBalance.pending} pending)`}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted uppercase tracking-wider">Start</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted uppercase tracking-wider">End</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
                className="mt-1"
              />
            </div>
          </div>
          {days > 0 && (
            <div className="text-xs text-muted bg-surface-2/70 border border-line rounded-md px-2 py-1.5 flex items-center gap-1.5">
              <Clock size={12} /> {days} day{days === 1 ? '' : 's'}
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-muted uppercase tracking-wider">Reason (optional)</label>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Family function, planned trip, etc."
              className="mt-1"
            />
          </div>
          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md p-2 flex items-start gap-1.5">
              <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit request'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Decision dialog ────────────────────────────── */

function DecisionDialog({
  request, decision, typeName, employeeName, onCancel, onConfirm,
}: {
  request: LeaveRequest;
  decision: 'approved' | 'rejected';
  typeName: string;
  employeeName: string;
  onCancel: () => void;
  onConfirm: (comment: string) => Promise<void>;
}) {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const isApprove = decision === 'approved';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="bg-surface rounded-xl shadow-2xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-2">
          {isApprove
            ? <CheckCircle2 size={18} className="text-emerald-600" />
            : <XCircle size={18} className="text-rose-600" />}
          <h3 className="text-base font-bold text-ink">
            {isApprove ? 'Approve' : 'Reject'} leave request
          </h3>
        </div>
        <p className="text-sm text-muted mb-4">
          <strong>{employeeName}</strong> · {typeName} · {fmtRange(request.startDate, request.endDate)} ({request.days} d)
          {request.reason && <div className="text-muted mt-1 italic">"{request.reason}"</div>}
        </p>
        <label className="text-xs font-semibold text-muted uppercase tracking-wider">
          Comment {isApprove ? '(optional)' : '(recommended)'}
        </label>
        <Textarea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={isApprove ? 'Enjoy your time off…' : 'Reason for rejection…'}
          className="mt-1"
        />
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>Cancel</Button>
          <Button
            onClick={async () => { setSubmitting(true); try { await onConfirm(comment); } finally { setSubmitting(false); } }}
            disabled={submitting}
            className={isApprove ? '' : 'bg-rose-600 hover:bg-rose-500'}
          >
            {submitting ? 'Saving…' : (isApprove ? 'Approve' : 'Reject')}
          </Button>
        </div>
      </div>
    </div>
  );
}
