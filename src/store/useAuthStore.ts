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
  /** 'female' | 'male'; NULL → no gendered leave types shown. */
  gender: string | null;
  /** Whether this user is allowed to reveal financial values (rates,
   *  margins, revenue) via the sidebar toggle. Owner is always allowed
   *  at the code layer; every other user needs this flag = true. */
  canViewFinancials: boolean;
}

/** Minimal user-profile shape used for directory lookups (avatars + names). */
export interface UserProfile {
  email: string;
  fullName: string | null;
  role: UserRole;
  /** Current manager (authorized_users.manager_email) — used by the Leave
   *  page to surface a manager's CURRENT reportees' requests even when the
   *  request's routing snapshot is stale or NULL. */
  managerEmail: string | null;
  avatarUrl: string | null;
  gender: string | null;
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

/**
 * Guard against overlapping profile loads.
 *
 * `supabase.auth.onAuthStateChange` fires far more often than the user's
 * identity actually changes — supabase-js re-emits on tab focus/visibility
 * and on every silent token refresh. Each of those used to run a fresh
 * `loadCurrentUser()`, and because `loading` gates `<Outlet />` in AppLayout
 * (and the RoleOnly / AdminOnly / EmployeeRedirect wrappers), every one of
 * them UNMOUNTED the page the user was working on: half-typed comments,
 * open drawers, filters and resume drafts all lost. That is the "page keeps
 * resetting / doesn't save" bug.
 *
 * Two rules keep it quiet:
 *   1. Never run two loads at once.
 *   2. `loading` is a COLD-START flag only. Once we have a profile, a
 *      refresh happens silently in the background and nothing unmounts.
 */
let profileLoadInFlight = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  currentUser: null,
  loading: false,
  directory: {},

  async loadCurrentUser() {
    if (profileLoadInFlight) return;
    profileLoadInFlight = true;
    // Cold start only — a warm refresh must not blank the page out.
    const warm = get().currentUser !== null;
    if (!warm) set({ loading: true });
    try {
      const { data: sess } = await supabase.auth.getUser();
      const user = sess.user;
      if (!user || !user.email) {
        set({ currentUser: null, loading: false });
        return;
      }
      const { data: row } = await supabase
        .from('authorized_users')
        .select('email, full_name, is_admin, role, employee_code, manager_email, avatar_url, gender, can_view_financials')
        .eq('email', user.email)
        .maybeSingle();
      const role: UserRole = (row?.role as UserRole | undefined) ?? (row?.is_admin ? 'admin' : 'employee');
      // Canonical admin flag: either the `is_admin` column OR role='admin'. This is
      // the single source of truth for every admin gate (sidebar + AdminOnly), so
      // they can never disagree over which field decides "is admin".
      const isAdmin = !!row?.is_admin || role === 'admin';
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
          gender: row?.gender ?? null,
          canViewFinancials: !!row?.can_view_financials,
        },
        loading: false,
      });
    } catch (e) {
      console.warn('[auth] loadCurrentUser failed:', (e as Error).message);
      set({ loading: false });
    } finally {
      profileLoadInFlight = false;
    }
  },

  async loadDirectory() {
    try {
      const { data, error } = await supabase
        .from('authorized_users')
        .select('email, full_name, role, manager_email, avatar_url, gender');
      if (error) {
        console.warn('[auth] loadDirectory failed:', error.message);
        return;
      }
      const dir: Record<string, UserProfile> = {};
      for (const row of (data ?? []) as Array<{ email: string; full_name: string | null; role: string | null; manager_email: string | null; avatar_url: string | null; gender: string | null }>) {
        const e = (row.email || '').toLowerCase();
        if (!e) continue;
        dir[e] = {
          email: e,
          fullName: row.full_name ?? null,
          role: ((row.role as UserRole | undefined) ?? 'employee'),
          managerEmail: row.manager_email ? row.manager_email.toLowerCase() : null,
          avatarUrl: row.avatar_url ?? null,
          gender: row.gender ?? null,
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
      managerEmail: patch.managerEmail ?? cur?.managerEmail ?? null,
      avatarUrl: patch.avatarUrl ?? cur?.avatarUrl ?? null,
      gender: patch.gender ?? cur?.gender ?? null,
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
    managerEmail: null,
    avatarUrl: null,
    gender: null,
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
