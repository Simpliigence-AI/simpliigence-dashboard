/**
 * Supabase client — shared singleton used by all sync logic.
 *
 * The anon key is safe to embed in client-side code (it's a public key).
 * Row Level Security policies control what this key can access.
 */
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://mhmxlubithnidopmkwgt.supabase.co';
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1obXhsdWJpdGhuaWRvcG1rd2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTg0NzksImV4cCI6MjA5MDQ3NDQ3OX0.pL-EEzCpcWh8pjCYFRKx_jiSUvfe0JvB2sJD_QaOWwY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Persist the session in localStorage so users stay signed in across
    // tabs and reloads. (This is the Supabase default; we set it explicitly
    // so the resilience behavior is stable and obvious rather than implied.)
    persistSession: true,
    // Silently refresh the access token in the background before it expires,
    // instead of letting it lapse and forcing a re-auth.
    autoRefreshToken: true,
    // Complete the OAuth redirect by reading the session out of the callback URL.
    detectSessionInUrl: true,
    // Pin a stable storage key so the persisted session isn't accidentally
    // orphaned by a future default change or a second Supabase client.
    storageKey: 'simpliigence-dashboard-auth',
    // NOTE: flowType is intentionally left at the client default here. Switching
    // to PKCE changes the OAuth callback contract and can only be verified in the
    // live Pages environment, so it is deferred to a follow-up PR.
  },
});

/** Unique ID for this browser tab — used to skip echoed realtime events. */
export const CLIENT_ID = nanoid();
