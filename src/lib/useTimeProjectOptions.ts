/**
 * Canonical dropdown source for time-entry project pickers on My Time and
 * Team Time. Free-text project names are no longer allowed — every entry
 * must match one of these values.
 *
 * The list is composed, in this priority order:
 *   1. Current (delivery) projects — Zoho-sourced rows in the pipeline
 *      store (source='zoho') that aren't Completed. e.g. "DTR Salesforce".
 *   2. Concierge active accounts — non-dormant rows from concierge_accounts,
 *      suffixed with " Concierge" so timesheet reviewers can distinguish
 *      concierge managed-services time from delivery time.
 *      e.g. "Balkan Plumbing" → "Balkan Plumbing Concierge".
 *   3. T&M projects — distinct non-empty `project` values from the India
 *      Roster (india_roster.project). These are the client engagements
 *      T&M team members are allocated to but which aren't yet in the
 *      delivery pipeline (e.g. bench overflows, short-turnaround work).
 *   4. INTERNAL_PROJECTS — Leave, Holiday, Internal Admin, etc.
 *
 * `extra` lets callers pass values already present on existing time entries
 * so a person editing a historic row whose project name no longer appears
 * anywhere can still see it (grandfathered, sorted at the bottom).
 */
import { useMemo } from 'react';
import { usePipelineStore } from '../store/usePipelineStore';
import { useConciergeAccountsStore } from '../store/useConciergeAccountsStore';
import { useIndiaRosterStore } from '../store/useIndiaRosterStore';
import { INTERNAL_PROJECTS } from '../types/timeEntry';

export interface TimeProjectOption {
  id: string | null;
  name: string;
  billable: boolean;
  /** Which source bucket the option came from. Used by the UI to group. */
  source: 'current' | 'concierge' | 'roster' | 'internal' | 'other';
}

/** Historic entries may reference project names that no longer exist as
 *  either a Current project or a Concierge active account. Pass those in
 *  so they still render in the dropdown for the row being edited. */
export function useTimeProjectOptions(extra: string[] = []): TimeProjectOption[] {
  const pipelineProjects = usePipelineStore((s) => s.projects);
  const conciergeAccounts = useConciergeAccountsStore((s) => s.accounts);
  const rosterMembers = useIndiaRosterStore((s) => s.members);

  return useMemo(() => {
    const seen = new Set<string>();
    const options: TimeProjectOption[] = [];

    // 1. Current (delivery) projects — Zoho-sourced, not completed
    for (const p of pipelineProjects) {
      if (p.source !== 'zoho') continue;
      if ((p.status || '').toLowerCase() === 'completed') continue;
      const key = p.name;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ id: p.id, name: key, billable: true, source: 'current' });
    }

    // 2. Concierge active accounts, with " Concierge" suffix
    for (const a of conciergeAccounts) {
      if (a.isDormant) continue;
      const key = `${a.name} Concierge`;
      if (seen.has(key)) continue;
      seen.add(key);
      options.push({ id: a.id, name: key, billable: true, source: 'concierge' });
    }

    // 3. T&M projects — distinct non-empty `project` values from India roster.
    //    Sorted alphabetically for a stable dropdown order.
    const rosterProjectSet = new Set<string>();
    for (const m of rosterMembers) {
      const p = (m.project || '').trim();
      if (p) rosterProjectSet.add(p);
    }
    const rosterProjects = [...rosterProjectSet].sort((a, b) => a.localeCompare(b));
    for (const name of rosterProjects) {
      if (seen.has(name)) continue;
      seen.add(name);
      options.push({ id: null, name, billable: true, source: 'roster' });
    }

    // 4. Internal categories
    for (const name of INTERNAL_PROJECTS) {
      if (seen.has(name)) continue;
      seen.add(name);
      options.push({ id: null, name, billable: false, source: 'internal' });
    }

    // 5. Grandfathered (already-present values not in any of the above)
    for (const name of extra) {
      const trimmed = (name || '').trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      options.push({ id: null, name: trimmed, billable: false, source: 'other' });
    }

    return options;
  }, [pipelineProjects, conciergeAccounts, rosterMembers, extra]);
}
