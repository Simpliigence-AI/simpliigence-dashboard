/**
 * Pod assignments for the Project Team (`forecast_assignments.employee_name`
 * values). Distinct from `india_roster.pod` — that column is for the T&M
 * team, which is a different roster of people.
 *
 * Storage: `project_team_pods` (employee_name PK, pod text). Free-text pod
 * names so admins can call them "Pod 1", "Alpha", whatever.
 */
import { create } from 'zustand';
import { db, fetchPodAssignments } from '../lib/supabaseSync';

export interface PodAssignment {
  employeeName: string;
  pod: string;
  updatedAt?: string;
  updatedBy?: string | null;
}

interface State {
  assignments: PodAssignment[];
  /** name (lowercased+trimmed) → pod */
  byName: Map<string, string>;
  loaded: boolean;

  hydrate: (rows: PodAssignment[]) => void;

  /** Set/replace the pod for a given employee. Empty pod clears the
   *  assignment entirely (deletes the row). */
  setPod: (employeeName: string, pod: string) => Promise<void>;

  /** Rename an employee (keeps the pod, moves the row).
   *  Used when the free-text employeeName is renamed on the forecast. */
  renameEmployee: (oldName: string, newName: string) => Promise<void>;
}

function buildIndex(rows: PodAssignment[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const k = (r.employeeName || '').toLowerCase().trim();
    if (k) m.set(k, r.pod);
  }
  return m;
}

export const usePodAssignmentsStore = create<State>((set, get) => ({
  assignments: [],
  byName: new Map(),
  loaded: false,

  hydrate: (rows) => {
    set({ assignments: rows, byName: buildIndex(rows), loaded: true });
  },

  setPod: async (employeeName, pod) => {
    const name = (employeeName || '').trim();
    if (!name) return;
    const clean = (pod || '').trim();

    set((s) => {
      const rest = s.assignments.filter((a) => a.employeeName.toLowerCase().trim() !== name.toLowerCase());
      const next = clean
        ? [...rest, { employeeName: name, pod: clean, updatedAt: new Date().toISOString() }]
        : rest;
      return { assignments: next, byName: buildIndex(next) };
    });

    if (clean) {
      await db.upsertPodAssignment({ employeeName: name, pod: clean });
    } else {
      await db.deletePodAssignment(name);
    }
  },

  renameEmployee: async (oldName, newName) => {
    const oldKey = (oldName || '').toLowerCase().trim();
    const newTrim = (newName || '').trim();
    const cur = get().assignments.find((a) => a.employeeName.toLowerCase().trim() === oldKey);
    if (!cur || !newTrim) return;
    await get().setPod(oldName, '');       // delete the old row
    await get().setPod(newTrim, cur.pod);  // insert under the new name
  },
}));

/** Async loader used by App bootstrap to hydrate the store from Supabase. */
export async function loadPodAssignments(): Promise<void> {
  const rows = await fetchPodAssignments();
  if (rows) usePodAssignmentsStore.getState().hydrate(rows);
}
