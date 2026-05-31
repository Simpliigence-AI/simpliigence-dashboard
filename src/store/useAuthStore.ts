/**
 * Tracks the signed-in user's profile from `authorized_users` (joined with
 * auth.users). Used to gate the Admin section in the sidebar, redirect
 * non-admins from /admin/* routes, and gate the employee-only "My Time"
 * surface from non-employees (well, in v1 all current users are admins so
 * they see everything; new role='employee' users see only /my-time).
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
}

interface AuthState {
  currentUser: CurrentUser | null;
  loading: boolean;
  loadCurrentUser: () => Promise<void>;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  loading: false,

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
        .select('email, full_name, is_admin, role, employee_code, manager_email')
        .eq('email', user.email)
        .maybeSingle();
      const isAdmin = !!row?.is_admin;
      // Derive role: prefer the role column; fall back to is_admin for back-compat.
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
        },
        loading: false,
      });
    } catch (e) {
      console.warn('[auth] loadCurrentUser failed:', (e as Error).message);
      set({ loading: false });
    }
  },

  clear() { set({ currentUser: null }); },
}));
