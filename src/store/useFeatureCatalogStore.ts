/**
 * Master Salesforce feature catalog store.
 *
 * Hydrated from Supabase's sf_feature_catalog table (seeded by the
 * seed-feature-catalog edge function). Referenced by:
 *   - ConciergePage's new "Catalog" tab (browse the master catalog)
 *   - FeatureCoverageScorecard component (per-account per-cloud progress)
 *   - Backlog tab (surface gaps ranked by upsell_hint)
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { supabase } from '../lib/supabase';
import type { SFFeatureCatalogEntry } from '../types/concierge';

interface State {
  entries: SFFeatureCatalogEntry[];
  loading: boolean;
  loadedAt: string | null;
  load: () => Promise<void>;
  /** Return catalog entries relevant to the given industry (null = show all).
   *  A feature is "relevant" iff industriesRelevant is empty (universal) or
   *  contains the target industry. */
  relevantFor: (industry: string | null) => SFFeatureCatalogEntry[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntry(row: any): SFFeatureCatalogEntry {
  return {
    id: row.id,
    cloud: row.cloud,
    name: row.name,
    description: row.description ?? null,
    category: row.category ?? null,
    industriesRelevant: Array.isArray(row.industries_relevant) ? row.industries_relevant : [],
    upsellHint: Number(row.upsell_hint) || 0,
    licenseTier: row.license_tier ?? null,
    isActive: row.is_active !== false,
    isSeed: !!row.is_seed,
  };
}

export const useFeatureCatalogStore = create<State>()(
  persist(
    (set, get) => ({
      entries: [],
      loading: false,
      loadedAt: null,

      load: async () => {
        set({ loading: true });
        try {
          const { data, error } = await supabase
            .from('sf_feature_catalog')
            .select('*')
            .eq('is_active', true)
            .order('cloud')
            .order('name');
          if (error) throw error;
          set({
            entries: (data ?? []).map(rowToEntry),
            loading: false,
            loadedAt: new Date().toISOString(),
          });
        } catch (e) {
          console.warn('[feature-catalog] load failed:', (e as Error).message);
          set({ loading: false });
        }
      },

      relevantFor: (industry) => {
        const all = get().entries;
        if (!industry) return all;
        return all.filter((e) => e.industriesRelevant.length === 0 || e.industriesRelevant.includes(industry));
      },
    }),
    { name: 'simpliigence-feature-catalog', version: 1 },
  ),
);
