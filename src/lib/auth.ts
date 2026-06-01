/**
 * Authentication helpers backed by Supabase Auth.
 *
 * Design choices:
 * - **Magic link primary** — no passwords to leak or remember. The user types
 *   their email, gets a one-click sign-in link.
 * - **Google OAuth optional** — works only if the Supabase project has the
 *   Google provider enabled. UI gracefully falls back if the call errors.
 * - **Session persists in localStorage** (Supabase default), so the user
 *   stays signed in across tabs and reloads.
 * - **Email allowlist** is enforced server-side via the `is_authorized_user`
 *   table + RLS — see supabase/migrations/008_*. The client only checks for
 *   "do you have a session"; whether that session is *allowed* to read data
 *   is the database's job.
 */
import { supabase } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

/** Where Supabase should redirect the user after they click the magic link.
 *  Must exactly match an entry in Supabase Auth → URL Configuration → Redirect URLs. */
function getRedirectTo(): string {
  // Use the current origin + path so it works on both localhost and GitHub Pages.
  // window.location.href would include a hash/query and confuse Supabase, so
  // we construct the cleanest possible "back to where I started" URL.
  const { origin, pathname } = window.location;
  // Strip trailing index.html if any so the redirect lands on a clean URL.
  return origin + pathname.replace(/index\.html$/, '');
}

export interface AuthState {
  session: Session | null;
  user: User | null;
  loading: boolean;
}

/** Send a magic-link email to the given address. */
export async function signInWithMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: getRedirectTo(),
      // shouldCreateUser: true (default) lets first-time users sign in. Combined
      // with the is_authorized_user RLS check, unauthorized emails can sign in
      // but won't be able to read any data — they'll see the access-denied UI.
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Sign in with a Google account. Requires Google provider enabled in Supabase. */
export async function signInWithGoogle(): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: getRedirectTo(),
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
