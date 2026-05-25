/**
 * Tracks the signed-in user's profile from `authorized_users` (joined with
 * auth.users). Used to gate the Admin section in the sidebar and to redirect
 * non-admins from /admin/* routes.
 */
import { create } from 'zustand';
import { supabase } from '../lib/supabase';

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string | null;
  isAdmin: boolean;
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
        .select('email, full_name, is_admin')
        .eq('email', user.email)
        .maybeSingle();
      set({
        currentUser: {
          id: user.id,
          email: user.email,
          fullName: row?.full_name ?? null,
          isAdmin: !!row?.is_admin,
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
