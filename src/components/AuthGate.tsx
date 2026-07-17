/**
 * Wraps the entire app. Shows the SignInPage when there's no Supabase session,
 * otherwise renders children. Also:
 * - Loads the signed-in user's profile from `authorized_users` (used to gate
 *   the Admin section).
 * - Starts/ends an analytics session on sign-in / sign-out.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';
import SignInPage from '../pages/SignInPage';
import { useAuthStore } from '../store/useAuthStore';
import { startSession, endSession } from '../lib/analytics';

interface Props {
  children: ReactNode;
}

export function AuthGate({ children }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const loadCurrentUser = useAuthStore((s) => s.loadCurrentUser);
  const loadDirectory = useAuthStore((s) => s.loadDirectory);
  const clearAuth = useAuthStore((s) => s.clear);

  useEffect(() => {
    let mounted = true;

    async function applySession(newSession: Session | null) {
      if (!mounted) return;
      setSession(newSession);
      if (newSession?.user) {
        // Fire-and-forget — these shouldn't block app mount.
        void startSession(newSession.user.id, newSession.user.email ?? '');
        void loadCurrentUser();
        void loadDirectory();
      } else {
        void endSession();
        clearAuth();
      }
    }

    // Read initial session from localStorage (Supabase persists it).
    // A null session paired with an `error` is a *transient* failure — a
    // network blip, or a refresh-token rotation triggered by a second open
    // tab — not a real sign-out. Treating it as "logged out" is what caused
    // authorized users to hit the sign-in wall on reload. So on such an error
    // we stay in the loading state and retry once before giving up.
    async function loadInitialSession(attempt = 0) {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error && !data.session && attempt === 0) {
        // Transient: keep showing the loader and try again shortly.
        setTimeout(() => {
          void loadInitialSession(1);
        }, 1500);
        return;
      }

      void applySession(data.session);
      setLoading(false);
    }
    void loadInitialSession();

    // Subscribe to auth state changes — handles sign-in via OAuth callback,
    // sign-out, and token refresh.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_OUT') {
        // An explicit sign-out is the ONLY event that should tear down the
        // session and show the sign-in page.
        void applySession(null);
        return;
      }
      // SIGNED_IN / TOKEN_REFRESHED / INITIAL_SESSION / USER_UPDATED: adopt the
      // new session as-is. If a refresh momentarily reports no session, we keep
      // the current one rather than dropping the user to the sign-in wall.
      if (newSession) {
        void applySession(newSession);
      }
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadCurrentUser, loadDirectory, clearAuth]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 text-slate-300">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <SignInPage />;
  }

  return <>{children}</>;
}
