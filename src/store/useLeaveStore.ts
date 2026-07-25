/**
 * Leave management store — leave types + leave requests, plus mutation
 * helpers that write through to Supabase and notify the manager on submit.
 *
 * Hydrated from Supabase on app init. RLS on `leave_requests` restricts a
 * non-admin fetch to (own requests | requests I'm the manager on), so the
 * same fetch does double duty as "My Requests" + "Approvals" input.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import { leaveDb, notifyLeaveRequest } from '../lib/supabaseSync';
import type { LeaveRequest, LeaveType, LeaveStatus, LeaveAllocation, AllocationSource } from '../types/leave';
import { countDaysInclusive } from '../types/leave';

interface LeaveState {
  types: LeaveType[];
  requests: LeaveRequest[];
  allocations: LeaveAllocation[];

  hydrate: (types: LeaveType[], requests: LeaveRequest[], allocations: LeaveAllocation[]) => void;

  /** Submit a new leave request. Manager email is passed in (looked up from
   *  authorized_users by the caller — the store doesn't know the directory).
   *  Returns the newly-created request. */
  submitRequest: (params: {
    employeeEmail: string;
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    days?: number;         // optional override; defaults to inclusive day-count
    reason?: string;
    managerEmail: string | null;
  }) => Promise<LeaveRequest>;

  /** Approve or reject a pending request. Emits the decision email. */
  decideRequest: (id: string, decision: 'approved' | 'rejected', deciderEmail: string, comment?: string) => Promise<void>;

  /** Employee cancels their own request (before or after decision — mostly
   *  used pre-approval, but useful post-approval too if plans change). */
  cancelRequest: (id: string, deciderEmail: string) => Promise<void>;

  /** Admin: leave types. */
  upsertType: (t: LeaveType) => Promise<void>;
  removeType: (id: string) => Promise<void>;

  /** Admin: per-employee allocations. */
  upsertAllocation: (a: LeaveAllocation, actorEmail: string) => Promise<void>;
  removeAllocation: (id: string) => Promise<void>;
  bulkUpsertAllocations: (
    rows: Omit<LeaveAllocation, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>[],
    actorEmail: string,
    source?: AllocationSource,
  ) => Promise<{ ok: number; failed: number; error?: string }>;
}

export const useLeaveStore = create<LeaveState>()(
  persist(
    (set, get) => ({
      types: [],
      requests: [],
      allocations: [],

      hydrate: (types, requests, allocations) => set({ types, requests, allocations }),

      submitRequest: async ({ employeeEmail, leaveTypeId, startDate, endDate, days, reason, managerEmail }) => {
        const now = new Date().toISOString();
        const computedDays = days ?? countDaysInclusive(startDate, endDate);
        const req: LeaveRequest = {
          id: nanoid(),
          employeeEmail: employeeEmail.toLowerCase(),
          leaveTypeId,
          startDate,
          endDate,
          days: computedDays,
          reason: reason?.trim() || null,
          status: 'pending',
          managerEmail: managerEmail ? managerEmail.toLowerCase() : null,
          decidedAt: null,
          decidedBy: null,
          decisionComment: null,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ requests: [req, ...s.requests] }));
        await leaveDb.upsertRequest(req);
        // Fire-and-forget email to manager — don't block the UI on it.
        void notifyLeaveRequest(req.id, 'submitted');
        return req;
      },

      decideRequest: async (id, decision, deciderEmail, comment) => {
        const current = get().requests.find((r) => r.id === id);
        if (!current) return;
        const updated: LeaveRequest = {
          ...current,
          status: decision as LeaveStatus,
          decidedAt: new Date().toISOString(),
          decidedBy: deciderEmail.toLowerCase(),
          decisionComment: comment?.trim() || null,
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ requests: s.requests.map((r) => (r.id === id ? updated : r)) }));
        await leaveDb.upsertRequest(updated);
        void notifyLeaveRequest(id, decision);
      },

      cancelRequest: async (id, deciderEmail) => {
        const current = get().requests.find((r) => r.id === id);
        if (!current) return;
        const updated: LeaveRequest = {
          ...current,
          status: 'cancelled',
          decidedAt: new Date().toISOString(),
          decidedBy: deciderEmail.toLowerCase(),
          updatedAt: new Date().toISOString(),
        };
        set((s) => ({ requests: s.requests.map((r) => (r.id === id ? updated : r)) }));
        await leaveDb.upsertRequest(updated);
      },

      upsertType: async (t) => {
        set((s) => {
          const has = s.types.some((x) => x.id === t.id);
          return { types: has ? s.types.map((x) => (x.id === t.id ? t : x)) : [...s.types, t] };
        });
        await leaveDb.upsertType(t);
      },

      removeType: async (id) => {
        set((s) => ({ types: s.types.filter((t) => t.id !== id) }));
        await leaveDb.deleteType(id);
      },

      upsertAllocation: async (a, actorEmail) => {
        const now = new Date().toISOString();
        const stamped: LeaveAllocation = {
          ...a,
          updatedBy: actorEmail.toLowerCase(),
          createdBy: a.createdBy ?? actorEmail.toLowerCase(),
          updatedAt: now,
          createdAt: a.createdAt ?? now,
        };
        set((s) => {
          const has = s.allocations.some((x) => x.id === stamped.id);
          return {
            allocations: has
              ? s.allocations.map((x) => (x.id === stamped.id ? stamped : x))
              : [...s.allocations, stamped],
          };
        });
        await leaveDb.upsertAllocation(stamped);
      },

      removeAllocation: async (id) => {
        set((s) => ({ allocations: s.allocations.filter((x) => x.id !== id) }));
        await leaveDb.deleteAllocation(id);
      },

      bulkUpsertAllocations: async (rows, actorEmail, source = 'admin') => {
        const now = new Date().toISOString();
        const stamped: LeaveAllocation[] = rows.map((r) => ({
          ...r,
          id: nanoid(),
          source: r.source ?? source,
          createdBy: actorEmail.toLowerCase(),
          updatedBy: actorEmail.toLowerCase(),
          createdAt: now,
          updatedAt: now,
        }));
        const res = await leaveDb.bulkUpsertAllocations(stamped);
        if (res.failed === 0) {
          // On success, refetch to pick up server-assigned timestamps + the
          // DB-side merge that happened when (employee, type, year) already
          // existed. We do this lazily — the App-level hydrate loop refreshes
          // via realtime, but nudge the local store optimistically.
          set((s) => {
            const byKey = new Map<string, LeaveAllocation>();
            for (const a of s.allocations) byKey.set(`${a.employeeEmail}|${a.leaveTypeId}|${a.year}`, a);
            for (const a of stamped) byKey.set(`${a.employeeEmail}|${a.leaveTypeId}|${a.year}`, a);
            return { allocations: Array.from(byKey.values()) };
          });
        }
        return res;
      },
    }),
    { name: 'simpliigence-leave', version: 1 },
  ),
);
