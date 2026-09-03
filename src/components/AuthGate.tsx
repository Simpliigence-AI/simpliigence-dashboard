/**
 * Wraps the entire app. Shows the SignInPage when there's no Supabase session,
 * otherwise renders children. Also:
 * - Loads the signed-in user's profile from `authorized_users` (used to gate
 *   the Admin section).
 * - Starts/ends an analytics session on sign-in / sign-out.
 *
 * ## Why this only reacts to identity changes
 *
 * `supabase.auth.onAuthStateChange` is not "the user signed in or out". It
 * re-fires on tab focus / visibility change and on every silent token
 * refresh (~hourly, plus retries), each time handing back a brand-new
 * Session object for the SAME person. Re-running the sign-in side effects on
 * those events restarted the analytics session and re-loaded the auth
 * profile, which — because the profile's `loading` flag gates `<Outlet />`
 * downstream — tore down and remounted whatever page the user was on.
 * Alt-tabbing away and back was enough to lose a half-typed comment.
 *
 * So: we track the signed-in user's id, and only do work when it actually
 * changes. Transient null sessions are ignored; only an explicit SIGNED_OUT
 * drops the user back to the sign-in screen.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import SignInPage from '../pages/SignInPage';
import { useAuthStore } from '../store/useAuthStore';
import { startSession, endSession } from '../lib/analytics';

interface Props {
  children: ReactNode;
}

export function AuthGate({ children }: Props) {
  // Only the *identity* lives in state — not the Session object. A refreshed
  // token produces a new Session but the same id, and re-rendering on that is
  // pure churn.
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const currentIdRef = useRef<string | null>(null);
  const loadCurrentUser = useAuthStore((s) => s.loadCurrentUser);
  const loadDirectory = useAuthStore((s) => s.loadDirectory);
  const clearAuth = useAuthStore((s) => s.clear);

  useEffect(() => {
    let mounted = true;

    /** Run the sign-in side effects — but only when the person changed. */
    function applyUser(id: string | null, email: string) {
      if (!mounted) return;
      if (currentIdRef.current === id) return; // same session, nothing to redo
      currentIdRef.current = id;
      setUserId(id);
      if (id) {
        // Fire-and-forget — these shouldn't block app mount.
        void startSession(id, email);
        void loadCurrentUser();
        void loadDirectory();
      } else {
        void endSession();
        clearAuth();
      }
    }

    // Read initial session from localStorage (Supabase persists it)
    supabase.auth.getSession().then(({ data }) => {
      applyUser(data.session?.user?.id ?? null, data.session?.user?.email ?? '');
      if (mounted) setLoading(false);
    });

    // Subscribe to auth state changes. SIGNED_OUT is the only event that may
    // take the user back to the sign-in screen; TOKEN_REFRESHED / repeated
    // SIGNED_IN for the same person are no-ops by way of applyUser's guard.
    const { data: subscription } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_OUT') {
        applyUser(null, '');
        return;
      }
      // A momentary null session (network blip mid-refresh) must not sign the
      // user out from under their work.
      if (!newSession?.user) return;
      applyUser(newSession.user.id, newSession.user.email ?? '');
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [loadCurrentUser, loadDirectory, clearAuth]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 text-muted/70">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  if (!userId) {
    return <SignInPage />;
  }

  return <>{children}</>;
}
