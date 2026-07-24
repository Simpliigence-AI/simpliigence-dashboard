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
import type { LeaveRequest, LeaveType, LeaveStatus } from '../types/leave';
import { countDaysInclusive } from '../types/leave';

interface LeaveState {
  types: LeaveType[];
  requests: LeaveRequest[];

  hydrate: (types: LeaveType[], requests: LeaveRequest[]) => void;

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

  /** Admin utilities. */
  upsertType: (t: LeaveType) => Promise<void>;
  removeType: (id: string) => Promise<void>;
}

export const useLeaveStore = create<LeaveState>()(
  persist(
    (set, get) => ({
      types: [],
      requests: [],

      hydrate: (types, requests) => set({ types, requests }),

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
    }),
    { name: 'simpliigence-leave', version: 1 },
  ),
);
