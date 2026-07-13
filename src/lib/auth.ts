/**
 * Authentication helpers backed by Supabase Auth.
 *
 * Design choices:
 * - **Microsoft 365 / Entra ID SSO is the ONLY sign-in path.** Simpliigence
 *   is an Office shop; every authorized user has a Microsoft account, so
 *   there is no reason to expose alternate paths. The magic-link fallback
 *   was removed after Supabase's built-in SMTP rate-limit (~3 emails/hr)
 *   kept blocking legitimate users mid-timesheet-entry.
 * - **Session persists in localStorage** (Supabase default), so the user
 *   stays signed in across tabs and reloads.
 * - **Email allowlist** is enforced server-side via the `is_authorized_user`
 *   table + RLS — see supabase/migrations/008_*. The client only checks for
 *   "do you have a session"; whether that session is *allowed* to read data
 *   is the database's job.
 */
import { supabase } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

function getRedirectTo(): string {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/index\.html$/, '');
}

export interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

/** Sign in with a Microsoft 365 / Entra ID account. Requires Azure provider
 *  enabled in Supabase Dashboard → Authentication → Providers → Azure. */
export async function signInWithMicrosoft(): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      redirectTo: getRedirectTo(),
      scopes: 'email openid profile',
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Sign the user out, clearing the local session. */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/** Read the current session synchronously from the in-memory client cache. */
export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
