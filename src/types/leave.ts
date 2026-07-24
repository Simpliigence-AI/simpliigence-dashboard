/**
 * Leave management — types shared between the store, sync layer, and UI.
 *
 * A `LeaveType` is a category (Casual, Sick, Earned…) with an annual quota.
 * A `LeaveRequest` is one employee's request for N days of a given type,
 * routed to their manager (looked up on `authorized_users.manager_email`
 * at submission time). Balances are derived — see `computeBalance()`.
 */

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export const LEAVE_STATUSES: LeaveStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

export const LEAVE_STATUS_META: Record<LeaveStatus, { label: string; cls: string }> = {
  pending:   { label: 'Pending',   cls: 'bg-amber-100 text-amber-800' },
  approved:  { label: 'Approved',  cls: 'bg-emerald-100 text-emerald-800' },
  rejected:  { label: 'Rejected',  cls: 'bg-rose-100 text-rose-800' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-500' },
};

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  annualQuota: number;
  color: string;
  active: boolean;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface LeaveRequest {
  id: string;
  employeeEmail: string;
  leaveTypeId: string;
  startDate: string;        // YYYY-MM-DD
  endDate: string;          // YYYY-MM-DD
  days: number;             // supports 0.5 (half-day)
  reason: string | null;
  status: LeaveStatus;
  managerEmail: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionComment: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Inclusive day-count between two ISO dates. Weekends still count — the UI
 *  can show a hint, but leave policy here treats every calendar day. */
export function countDaysInclusive(startISO: string, endISO: string): number {
  if (!startISO || !endISO) return 0;
  const a = new Date(startISO + 'T00:00:00Z').getTime();
  const b = new Date(endISO + 'T00:00:00Z').getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

/** Balance for one leave type in one year. Approved requests deduct fully;
 *  pending requests are tracked separately so the UI can show a hold. */
export interface LeaveBalance {
  typeId: string;
  quota: number;
  used: number;          // days deducted (status='approved')
  pending: number;       // days waiting on approval
  remaining: number;     // quota - used - pending
}

/** Compute per-type balances for an employee's requests in a given year. */
export function computeBalances(
  types: LeaveType[],
  requests: LeaveRequest[],
  year: number,
): LeaveBalance[] {
  return types.filter((t) => t.active).map((t) => {
    const inYear = requests.filter((r) => r.leaveTypeId === t.id && new Date(r.startDate).getUTCFullYear() === year);
    const used = inYear.filter((r) => r.status === 'approved').reduce((s, r) => s + r.days, 0);
    const pending = inYear.filter((r) => r.status === 'pending').reduce((s, r) => s + r.days, 0);
    return {
      typeId: t.id,
      quota: t.annualQuota,
      used,
      pending,
      remaining: Math.max(0, t.annualQuota - used - pending),
    };
  });
}
