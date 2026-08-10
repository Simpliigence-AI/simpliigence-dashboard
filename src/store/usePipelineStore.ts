import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ZohoPipelineProject, PipelineResource } from '../types/forecast';
import { db } from '../lib/supabaseSync';
import { supabase } from '../lib/supabase';

export interface ZohoSyncResult {
  ok: boolean;
  /** Count of active projects received (on success) */
  count?: number;
  /** User-facing error message (on failure) */
  error?: string;
  /** Source of the data: 'live' = edge function, 'fallback' = static seed */
  source: 'live' | 'fallback';
}

interface PipelineState {
  projects: ZohoPipelineProject[];
  lastZohoSync: string | null;

  /** Replace all Zoho-sourced projects (preserves manual ones). */
  setZohoProjects: (projects: ZohoPipelineProject[]) => void;

  /**
   * Invoke the `zoho-projects-sync` Supabase Edge Function.
   * Falls back to the static seed list if the function isn't deployed or errors.
   */
  syncFromZoho: (fallback?: ZohoPipelineProject[]) => Promise<ZohoSyncResult>;

  /** Add a manually-created pipeline project. */
  addProject: (project: ZohoPipelineProject) => void;

  /** Update an existing project. */
  updateProject: (id: string, updates: Partial<ZohoPipelineProject>) => void;

  /** Remove a project. */
  removeProject: (id: string) => void;

  /** Update resource estimates for a project. */
  setResources: (projectId: string, resources: PipelineResource[]) => void;
}

export const usePipelineStore = create<PipelineState>()(
  persist(
    (set, get) => ({
      projects: [],
      lastZohoSync: null,

      setZohoProjects: (zohoProjects) => {
        set((s) => {
          const manual = s.projects.filter((p) => p.source === 'manual');
          const existingZoho = new Map(
            s.projects.filter((p) => p.source === 'zoho').map((p) => [p.zohoId, p]),
          );
          // Preserve user-set fields across syncs — the Zoho API doesn't know about
          // these, so a naive replace would wipe them every time someone clicks Sync.
          // Precedence: user value > incoming default > undefined.
          const merged = zohoProjects.map((zp) => {
            const existing = existingZoho.get(zp.zohoId);
            if (!existing) return zp;
            return {
              ...zp,
              forecastName: existing.forecastName ?? zp.forecastName,
              resources: existing.resources && existing.resources.length > 0 ? existing.resources : zp.resources,
              goLiveDate: existing.goLiveDate ?? zp.goLiveDate,
              revenue: existing.revenue ?? zp.revenue,
              revenueCurrency: existing.revenueCurrency ?? zp.revenueCurrency,
            };
          });
          return {
            projects: [...manual, ...merged],
            lastZohoSync: new Date().toISOString(),
          };
        });
        db.replacePipelineProjects(get().projects);
      },

      syncFromZoho: async (fallback) => {
        try {
          const { data, error } = await supabase.functions.invoke<{
            projects: ZohoPipelineProject[];
            syncedAt: string;
            counts?: { total: number; active: number; skipped: number };
          }>('zoho-projects-sync');

          if (error) throw error;
          if (!data?.projects) throw new Error('Edge function returned no projects');

          get().setZohoProjects(data.projects);
          return { ok: true, count: data.projects.length, source: 'live' };
        } catch (e) {
          const msg = (e as Error).message || String(e);
          // Fall back to static seed so the UI still populates something useful
          if (fallback && fallback.length > 0) {
            get().setZohoProjects(fallback);
            return { ok: false, error: msg, count: fallback.length, source: 'fallback' };
          }
          return { ok: false, error: msg, source: 'fallback' };
        }
      },

      addProject: (project) => {
        set((s) => ({ projects: [...s.projects, project] }));
        db.upsertPipelineProject(project);
      },

      updateProject: (id, updates) => {
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, ...updates } : p)),
        }));
        const updated = get().projects.find((p) => p.id === id);
        if (updated) db.upsertPipelineProject(updated);
      },

      removeProject: (id) => {
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
        }));
        db.deletePipelineProject(id);
      },

      setResources: (projectId, resources) => {
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId ? { ...p, resources } : p,
          ),
        }));
        const updated = get().projects.find((p) => p.id === projectId);
        if (updated) db.upsertPipelineProject(updated);
      },
    }),
    {
      name: 'simpliigence-pipeline',
      version: 3,
      migrate: (persisted: unknown, version: number) => {
        const old = persisted as Record<string, unknown> | null;
        const projects = (old?.projects as ZohoPipelineProject[]) ?? [];

        // v3: adopt the canonical project names agreed 2026-08-10 so Current
        // Projects, Pipeline Projects and the Projects tab all say the same
        // thing as the Delivery Governance tool. These names came from Zoho
        // originally — one of them misspelled ("Llyods") — and the matching
        // rows in Postgres were renamed in the same change. This catches the
        // copy already persisted in a browser's localStorage, which is what
        // the page actually renders; without it the old names stay on screen
        // indefinitely, because the Zoho Projects sync that used to refresh
        // them has been removed.
        if (version < 3) {
          const canonical: Record<string, string> = {
            'cool air': 'Cool Air Rentals',
            'coolair': 'Cool Air Rentals',
            'qudata centres': 'Qu Data - Phase 1',
            'qudata': 'Qu Data - Phase 1',
            'llyods list intelligence': 'Lloyds List Intelligence',
            'lli': 'Lloyds List Intelligence',
            'dtr salesforce': 'DTR - SF Implementation',
          };
          for (const p of projects) {
            const target = canonical[p.name?.toLowerCase().trim()];
            if (target && p.name !== target) {
              p.name = target;
              // forecastName is the cost-calculation join key — it has to move
              // with the name or `hours × rate card` silently computes zero.
              p.forecastName = target;
            }
          }
        }

        return {
          projects,
          lastZohoSync: (old?.lastZohoSync as string) ?? null,
        };
      },
    },
  ),
);
