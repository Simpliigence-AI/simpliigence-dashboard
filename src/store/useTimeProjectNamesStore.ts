/**
 * Server-side list of selectable time-entry project NAMES.
 *
 * Why this exists (AppDesk #2525, 16 Nov 2026): the My Time / Team Time
 * picker was built only from usePipelineStore and useIndiaRosterStore. Both
 * tables are behind tab permissions (`pipeline`, `india-roster`) that the
 * `employee` role does not hold, so for most of the team those stores load
 * empty and delivery projects such as "Diesel - SF Implementation" or
 * "Integrity Together - Org clone" never appear in the dropdown.
 *
 * `v_time_project_options` is the same list the time_entries project guard
 * checks. It exposes names only (no revenue, no resources) and is readable
 * by every signed-in user, so it is the safe source for people who cannot
 * read the underlying tables.
 *
 * Not persisted: a stale cached list is exactly what hid this bug for
 * long-standing users.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';

interface TimeProjectNamesState {
  names: string[];
  status: 'idle' | 'loading' | 'loaded' | 'error';
  /** Fetch once per page load; `force` refetches. */
  load: (force?: boolean) => Promise<void>;
}

export const useTimeProjectNamesStore = create<TimeProjectNamesState>()((set, get) => ({
  names: [],
  status: 'idle',
  load: async (force = false) => {
    const { status } = get();
    if (status === 'loading' || (status === 'loaded' && !force)) return;
    set({ status: 'loading' });
    const { data, error } = await supabase.from('v_time_project_options').select('name');
    if (error) {
      console.warn('[time] Could not load project options from v_time_project_options:', error.message);
      set({ status: 'error' });
      return;
    }
    const names = [...new Set((data || []).map((r) => String(r.name ?? '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    set({ names, status: 'loaded' });
  },
}));
