/**
 * Access-matrix store.
 *
 * Holds every user_page_access row for the whole company so the owner's
 * admin matrix can render, and any user can look up their own level in
 * one hop without a per-page fetch. The rows are small (email + page key
 * + level) and there are ~30 pages × N users, so this scales fine.
 *
 * levelFor(email, pageKey) returns 'none' when there's no row. Owner
 * bypass happens at the hook layer, not here — the store just reflects
 * what's in the DB.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { db } from '../lib/supabaseSync';
import type { AccessLevel, UserPageAccess } from '../types/access';

interface AccessState {
  entries: UserPageAccess[];
  loaded: boolean;
  hydrate: (entries: UserPageAccess[]) => void;
  setLevel: (userEmail: string, pageKey: string, level: AccessLevel, grantedBy: string | null) => Promise<void>;
  levelFor: (userEmail: string | null | undefined, pageKey: string) => AccessLevel;
}

export const useAccessStore = create<AccessState>()(
  persist(
    (set, get) => ({
      entries: [],
      loaded: false,

      hydrate: (entries) => set({ entries, loaded: true }),

      setLevel: async (userEmail, pageKey, level, grantedBy) => {
        const email = userEmail.trim().toLowerCase();
        const key = pageKey.trim();
        const now = new Date().toISOString();
        const existing = get().entries.find((e) => e.userEmail === email && e.pageKey === key);
        const next: UserPageAccess = {
          userEmail: email,
          pageKey: key,
          level,
          grantedBy,
          grantedAt: existing?.grantedAt ?? now,
        };
        set((s) => ({
          entries: existing
            ? s.entries.map((e) => (e.userEmail === email && e.pageKey === key ? next : e))
            : [...s.entries, next],
        }));
        await db.upsertUserPageAccess(next);
      },

      levelFor: (userEmail, pageKey) => {
        if (!userEmail) return 'none';
        const email = userEmail.trim().toLowerCase();
        const row = get().entries.find((e) => e.userEmail === email && e.pageKey === pageKey);
        return row?.level ?? 'none';
      },
    }),
    { name: 'simpliigence-access', version: 1 },
  ),
);
