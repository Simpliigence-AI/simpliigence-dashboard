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
      } else {
        void endSession();
        clearAuth();
      }
    }

    // Read initial session from localStorage (Supabase persists it)
    supabase.auth.getSession().then(({ data }) => {
      void applySession(data.session);
      if (mounted) setLoading(false);
    });

    // Subscribe to auth state changes — handles sign-in via magic link, sign-out, token refresh
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      void applySession(newSession);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadCurrentUser, clearAuth]);

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
