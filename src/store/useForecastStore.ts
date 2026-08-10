import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type { ForecastAssignment, Month } from '../types/forecast';
import { MONTHS } from '../types/forecast';
import { db } from '../lib/supabaseSync';

/** Given a weeklyHours map, recompute monthlyTotals. */
function recalcMonthlyFromWeekly(weeklyHours: Record<string, number>): Record<Month, number> {
  const totals: Record<string, number> = {};
  for (const m of MONTHS) totals[m] = 0;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (const [dateStr, hrs] of Object.entries(weeklyHours)) {
    if (!hrs) continue;
    const d = new Date(dateStr + 'T00:00:00');
    const monthIdx = d.getMonth();
    totals[monthNames[monthIdx]] += hrs;
  }
  return totals as Record<Month, number>;
}

/** Ensure every assignment has a stable id. */
function ensureIds(assignments: ForecastAssignment[]): ForecastAssignment[] {
  return assignments.map((a) => (a.id ? a : { ...a, id: nanoid() }));
}

interface ForecastState {
  assignments: ForecastAssignment[];
  weekDates: string[];

  /** Bulk-set from spreadsheet import (one-time or re-import). */
  setData: (assignments: ForecastAssignment[], weekDates: string[]) => void;
  clear: () => void;

  /** Add a new assignment row (employee x project). */
  addAssignment: (a: ForecastAssignment) => void;

  /** Update fields on an existing assignment by index. */
  updateAssignment: (index: number, updates: Partial<ForecastAssignment>) => void;

  /** Remove an assignment by index. */
  removeAssignment: (index: number) => void;

  /** Batch-remove all assignments for a given employee name. */
  removeEmployee: (employeeName: string) => void;

  /** Update a specific month's hours for an employee x project pair. */
  updateMonthlyHours: (employeeName: string, project: string, month: Month, hours: number) => void;

  /** Update weekly hours for an employee x project and recalculate monthly totals. */
  updateWeeklyHours: (employeeName: string, project: string, weekDate: string, hours: number) => void;

  /** Rename an employee across all their assignment rows. */
  renameEmployee: (oldName: string, newName: string) => void;

  /** Update role for all assignments belonging to an employee. */
  updateEmployeeRole: (employeeName: string, role: string) => void;

  /** Update rate card for all assignments belonging to an employee. */
  updateEmployeeRate: (employeeName: string, rate: number | null) => void;

  /** Update SI/Contractor flags for all assignments belonging to an employee. */
  updateEmployeeType: (employeeName: string, isSI: boolean, isContractor: boolean) => void;
}

export const useForecastStore = create<ForecastState>()(
  persist(
    (set, get) => ({
      assignments: [],
      weekDates: [],

      setData: (incoming, weekDates) => {
        // Preserve manually-edited and manually-added assignments during sync.
        const s = get();
        const manualAdded = s.assignments.filter((a) => a._manuallyAdded);
        const manualEdited = new Map<string, ForecastAssignment>();
        for (const a of s.assignments) {
          if (a._manuallyEdited) {
            const key = a._originalKey || `${a.employeeName}|||${a.project}`;
            manualEdited.set(key.toLowerCase(), a);
          }
        }

        const merged = incoming.map((row) => {
          const key = `${row.employeeName}|||${row.project}`.toLowerCase();
          const override = manualEdited.get(key);
          if (override) {
            manualEdited.delete(key);
            return override;
          }
          return row;
        });

        const leftoverEdits = Array.from(manualEdited.values());
        const finalAssignments = ensureIds([...merged, ...leftoverEdits, ...manualAdded]);

        set({ assignments: finalAssignments, weekDates });
        db.replaceAllAssignments(finalAssignments, weekDates);
      },

      clear: () => {
        set({ assignments: [], weekDates: [] });
        db.deleteAllAssignments();
        db.saveWeekDates([]);
      },

      addAssignment: (a) => {
        const withId: ForecastAssignment = { ...a, id: a.id || nanoid(), _manuallyAdded: true };
        set((s) => ({ assignments: [...s.assignments, withId] }));
        db.upsertAssignment(withId);
      },

      updateAssignment: (index, updates) => {
        set((s) => ({
          assignments: s.assignments.map((a, i) =>
            i === index
              ? { ...a, ...updates, _manuallyEdited: true, _originalKey: a._originalKey || `${a.employeeName}|||${a.project}` }
              : a,
          ),
        }));
        const updated = get().assignments[index];
        if (updated) db.upsertAssignment(updated);
      },

      removeAssignment: (index) => {
        const toDelete = get().assignments[index];
        set((s) => ({ assignments: s.assignments.filter((_, i) => i !== index) }));
        if (toDelete?.id) db.deleteAssignment(toDelete.id);
      },

      removeEmployee: (employeeName) => {
        set((s) => ({
          assignments: s.assignments.filter(
            (a) => a.employeeName.toLowerCase() !== employeeName.toLowerCase(),
          ),
        }));
        db.deleteAssignmentsByEmployee(employeeName);
      },

      updateMonthlyHours: (employeeName, project, month, hours) => {
        set((s) => ({
          assignments: s.assignments.map((a) => {
            if (a.employeeName === employeeName && a.project === project) {
              return {
                ...a,
                monthlyTotals: { ...a.monthlyTotals, [month]: hours },
                _manuallyEdited: true,
                _originalKey: a._originalKey || `${a.employeeName}|||${a.project}`,
              };
            }
            return a;
          }),
        }));
        const updated = get().assignments.find(
          (a) => a.employeeName === employeeName && a.project === project,
        );
        if (updated) db.upsertAssignment(updated);
      },

      updateWeeklyHours: (employeeName, project, weekDate, hours) => {
        set((s) => ({
          assignments: s.assignments.map((a) => {
            if (a.employeeName === employeeName && a.project === project) {
              const newWeekly = { ...a.weeklyHours, [weekDate]: hours };
              return {
                ...a,
                weeklyHours: newWeekly,
                monthlyTotals: recalcMonthlyFromWeekly(newWeekly),
                _manuallyEdited: true,
                _originalKey: a._originalKey || `${a.employeeName}|||${a.project}`,
              };
            }
            return a;
          }),
        }));
        const updated = get().assignments.find(
          (a) => a.employeeName === employeeName && a.project === project,
        );
        if (updated) db.upsertAssignment(updated);
      },

      renameEmployee: (oldName, newName) => {
        set((s) => ({
          assignments: s.assignments.map((a) =>
            a.employeeName === oldName
              ? { ...a, employeeName: newName, _manuallyEdited: true, _originalKey: a._originalKey || `${oldName}|||${a.project}` }
              : a,
          ),
        }));
        const affected = get().assignments.filter((a) => a.employeeName === newName);
        db.upsertAssignments(affected);
      },

      updateEmployeeRole: (employeeName, role) => {
        set((s) => ({
          assignments: s.assignments.map((a) =>
            a.employeeName === employeeName
              ? { ...a, role, _manuallyEdited: true, _originalKey: a._originalKey || `${a.employeeName}|||${a.project}` }
              : a,
          ),
        }));
        const affected = get().assignments.filter((a) => a.employeeName === employeeName);
        db.upsertAssignments(affected);
      },

      updateEmployeeRate: (employeeName, rate) => {
        set((s) => ({
          assignments: s.assignments.map((a) =>
            a.employeeName === employeeName
              ? { ...a, rateCard: rate, _manuallyEdited: true, _originalKey: a._originalKey || `${a.employeeName}|||${a.project}` }
              : a,
          ),
        }));
        const affected = get().assignments.filter((a) => a.employeeName === employeeName);
        db.upsertAssignments(affected);
      },

      updateEmployeeType: (employeeName, isSI, isContractor) => {
        set((s) => ({
          assignments: s.assignments.map((a) =>
            a.employeeName === employeeName
              ? { ...a, isSI, isContractor, _manuallyEdited: true, _originalKey: a._originalKey || `${a.employeeName}|||${a.project}` }
              : a,
          ),
        }));
        const affected = get().assignments.filter((a) => a.employeeName === employeeName);
        db.upsertAssignments(affected);
      },
    }),
    {
      name: 'simpliigence-forecast',
      version: 6,
      migrate: (persisted: unknown, version: number) => {
        const old = persisted as Record<string, unknown> | null;
        const assignments = (old?.assignments as ForecastAssignment[]) ?? [];
        const weekDates = (old?.weekDates as string[]) ?? [];
        if (version < 3) {
          for (const a of assignments) {
            if (a.rateCard != null) {
              a.rateCard = Math.round((a.rateCard / 2) * 100) / 100;
            }
          }
        }
        // v4: ensure all assignments have stable ids
        for (const a of assignments) {
          if (!a.id) a.id = nanoid();
        }
        // v5: rename project strings on existing assignments to the short
        // forecastName aliases so they join to their Current Projects card
        // for cost calculation. Case-insensitive match on the source name;
        // preserves the _originalKey for spreadsheet re-sync.
        if (version < 5) {
          const renames: Record<string, string> = {
            'qudata centres': 'QUData',
            'matheson constructors': 'Matheson',
            'cool air': 'CoolAir',
            'llyods list intelligence': 'LLI',
          };
          for (const a of assignments) {
            const target = renames[a.project?.toLowerCase().trim()];
            if (target && a.project !== target) {
              a.project = target;
              a._manuallyEdited = true;
            }
          }
        }
        // v6: adopt the canonical project names agreed 2026-08-10, so the
        // Projects tab, the timesheets and the Delivery Governance tool all
        // say the same thing. v5 had shortened these to spreadsheet aliases
        // (CoolAir, QUData, LLI); we now go the other way, to the full
        // client-facing name. The matching rows in Postgres were renamed in
        // the same change — this only catches copies already persisted in a
        // browser's localStorage.
        if (version < 6) {
          const canonical: Record<string, string> = {
            'coolair': 'Cool Air Rentals',
            'cool air': 'Cool Air Rentals',
            'qudata': 'Qu Data - Phase 1',
            'qudata centres': 'Qu Data - Phase 1',
            'lli': 'Lloyds List Intelligence',
            'llyods list intelligence': 'Lloyds List Intelligence',
            'copeland': 'Copeland Support',
            'dtr salesforce': 'DTR - SF Implementation',
          };
          for (const a of assignments) {
            const target = canonical[a.project?.toLowerCase().trim()];
            if (target && a.project !== target) {
              a.project = target;
              a._manuallyEdited = true;
            }
          }
        }
        return { assignments, weekDates };
      },
    },
  ),
);
