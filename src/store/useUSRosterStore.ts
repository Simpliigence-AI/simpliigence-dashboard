import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type { USRosterMember, USRosterAssignment } from '../types/usRoster';
import { db } from '../lib/supabaseSync';

interface USRosterState {
  members: USRosterMember[];
  /** All contracts for all consultants. One consultant → many assignments. */
  assignments: USRosterAssignment[];

  addMember: (m: Omit<USRosterMember, 'id' | 'created_at' | 'updated_at'>) => USRosterMember;
  updateMember: (id: string, patch: Partial<USRosterMember>) => void;
  removeMember: (id: string) => void;

  addAssignment: (a: Omit<USRosterAssignment, 'id' | 'created_at' | 'updated_at'>) => USRosterAssignment;
  updateAssignment: (id: string, patch: Partial<USRosterAssignment>) => void;
  removeAssignment: (id: string) => void;

  _setFromSupabase: (members: USRosterMember[]) => void;
  _setAssignmentsFromSupabase: (assignments: USRosterAssignment[]) => void;
}

export const useUSRosterStore = create<USRosterState>()(
  persist(
    (set, get) => ({
      members: [],
      assignments: [],

      addMember: (input) => {
        const now = new Date().toISOString();
        const m: USRosterMember = { ...input, id: nanoid(), created_at: now, updated_at: now };
        set((s) => ({ members: [...s.members, m] }));
        db.upsertUSRosterMember(m);
        return m;
      },
      updateMember: (id, patch) => {
        set((s) => ({
          members: s.members.map((m) =>
            m.id === id ? { ...m, ...patch, updated_at: new Date().toISOString() } : m,
          ),
        }));
        const updated = get().members.find((m) => m.id === id);
        if (updated) db.upsertUSRosterMember(updated);
      },
      removeMember: (id) => {
        // Cascade in Supabase (FK ON DELETE CASCADE) removes assignments,
        // but we still need to drop them from local state.
        set((s) => ({
          members: s.members.filter((m) => m.id !== id),
          assignments: s.assignments.filter((a) => a.roster_id !== id),
        }));
        db.deleteUSRosterMember(id);
      },

      addAssignment: (input) => {
        const now = new Date().toISOString();
        const a: USRosterAssignment = { ...input, id: nanoid(), created_at: now, updated_at: now };
        set((s) => ({ assignments: [...s.assignments, a] }));
        db.upsertUSRosterAssignment(a);
        return a;
      },
      updateAssignment: (id, patch) => {
        set((s) => ({
          assignments: s.assignments.map((a) =>
            a.id === id ? { ...a, ...patch, updated_at: new Date().toISOString() } : a,
          ),
        }));
        const updated = get().assignments.find((a) => a.id === id);
        if (updated) db.upsertUSRosterAssignment(updated);
      },
      removeAssignment: (id) => {
        set((s) => ({ assignments: s.assignments.filter((a) => a.id !== id) }));
        db.deleteUSRosterAssignment(id);
      },

      _setFromSupabase: (members) => set({ members }),
      _setAssignmentsFromSupabase: (assignments) => set({ assignments }),
    }),
    { name: 'simpliigence-us-roster', version: 2 },
  ),
);
