/**
 * Tracks the signed-in user's profile from `authorized_users` (joined with
 * auth.users). Used to gate the Admin section in the sidebar, redirect
 * non-admins from /admin/* routes, and gate the employee-only "My Time"
 * surface from non-employees.
 *
 * Also caches a directory of ALL authorized users (loaded once on init,
 * refreshed on edits) so we can render display names + avatars wherever
 * an email appears in the UI — see <TaIdentity>.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export type UserRole = 'admin' | 'manager' | 'employee';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string | null;
  isAdmin: boolean;
  role: UserRole;
  /** Optional code that maps to Zoho EmployeeID. NULL → Simpliigence is the SoR for this person's time. */
  employeeCode: string | null;
  managerEmail: string | null;
  avatarUrl: string | null;
}

/** Minimal user-profile shape used for directory lookups (avatars + names). */
export interface UserProfile {
  email: string;
  fullName: string | null;
  role: UserRole;
  avatarUrl: string | null;
}

interface AuthState {
  currentUser: CurrentUser | null;
  loading: boolean;
  /** Email (lowercased) → profile. Drives <TaIdentity> lookups. */
  directory: Record<string, UserProfile>;
  loadCurrentUser: () => Promise<void>;
  loadDirectory: () => Promise<void>;
  /** Optimistic local patch for one user (called after edits). */
  patchDirectory: (email: string, patch: Partial<UserProfile>) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: null,
  loading: false,
  directory: {},

  async loadCurrentUser() {
    set({ loading: true });
    try {
      const { data: sess } = await supabase.auth.getUser();
      const user = sess.user;
      if (!user || !user.email) {
        set({ currentUser: null, loading: false });
        return;
      }
      const { data: row } = await supabase
        .from('authorized_users')
        .select('email, full_name, is_admin, role, employee_code, manager_email, avatar_url')
        .eq('email', user.email)
        .maybeSingle();
      const isAdmin = !!row?.is_admin;
      const role: UserRole = (row?.role as UserRole | undefined) ?? (isAdmin ? 'admin' : 'employee');
      set({
        currentUser: {
          id: user.id,
          email: user.email,
          fullName: row?.full_name ?? null,
          isAdmin,
          role,
          employeeCode: row?.employee_code ?? null,
          managerEmail: row?.manager_email ?? null,
          avatarUrl: row?.avatar_url ?? null,
        },
        loading: false,
      });
    } catch (e) {
      console.warn('[auth] loadCurrentUser failed:', (e as Error).message);
      set({ loading: false });
    }
  },

  async loadDirectory() {
    try {
      const { data, error } = await supabase
        .from('authorized_users')
        .select('email, full_name, role, avatar_url');
      if (error) {
        console.warn('[auth] loadDirectory failed:', error.message);
        return;
      }
      const dir: Record<string, UserProfile> = {};
      for (const row of (data ?? []) as Array<{ email: string; full_name: string | null; role: string | null; avatar_url: string | null }>) {
        const e = (row.email || '').toLowerCase();
        if (!e) continue;
        dir[e] = {
          email: e,
          fullName: row.full_name ?? null,
          role: ((row.role as UserRole | undefined) ?? 'employee'),
          avatarUrl: row.avatar_url ?? null,
        };
      }
      set({ directory: dir });
    } catch (e) {
      console.warn('[auth] loadDirectory threw:', (e as Error).message);
    }
  },

  patchDirectory(email, patch) {
    const k = email.toLowerCase();
    const cur = get().directory[k];
    const next: UserProfile = {
      email: k,
      fullName: patch.fullName ?? cur?.fullName ?? null,
      role: (patch.role ?? cur?.role ?? 'employee') as UserRole,
      avatarUrl: patch.avatarUrl ?? cur?.avatarUrl ?? null,
    };
    set({ directory: { ...get().directory, [k]: next } });
  },

  clear() { set({ currentUser: null }); },
}));

/** Lookup a profile by email. Falls back to a synthetic one based on the email
 *  (first-name from the local part, no avatar) when the directory is cold or
 *  the user isn't in `authorized_users` yet. */
export function lookupProfile(email: string | null | undefined, directory: Record<string, UserProfile>): UserProfile {
  const e = (email || '').toLowerCase();
  if (e && directory[e]) return directory[e];
  return {
    email: e,
    fullName: e ? prettyFromEmail(e) : null,
    role: 'employee',
    avatarUrl: null,
  };
}

/** Pretty-print a name from an email's local part: "raghu.seetharam" → "Raghu Seetharam". */
function prettyFromEmail(email: string): string {
  const local = email.split('@')[0] || email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
