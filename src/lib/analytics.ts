/**
 * Client-side session + page-view tracking.
 *
 * Writes to `user_sessions` and `user_page_views`. Robust to refreshes:
 * - Session id stored in sessionStorage so a refresh keeps the same row.
 * - Heartbeat updates `last_active` every 60s while the tab is visible.
 * - `beforeunload` makes a best-effort attempt to close the session.
 */
import { nanoid } from 'nanoid';
import { supabase } from './supabase';

const SESSION_KEY = 'simpliigence-session-id';
const LAST_PV_KEY = 'simpliigence-last-pv';
const HEARTBEAT_MS = 60_000;

interface SessionInfo {
  id: string;
  userId: string;
  email: string;
}

let current: SessionInfo | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: ((this: Document, ev: Event) => void) | null = null;
let beforeUnloadHandler: ((this: Window, ev: BeforeUnloadEvent) => void) | null = null;

function getStoredSessionId(): string | null {
  try { return window.sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}
function setStoredSessionId(id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(SESSION_KEY, id);
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}
function getStoredLastPv(): { id: number; enteredAt: string } | null {
  try {
    const raw = window.sessionStorage.getItem(LAST_PV_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setStoredLastPv(v: { id: number; enteredAt: string } | null) {
  try {
    if (v) window.sessionStorage.setItem(LAST_PV_KEY, JSON.stringify(v));
    else window.sessionStorage.removeItem(LAST_PV_KEY);
  } catch { /* ignore */ }
}

/** Start (or resume) a session for this signed-in user. Idempotent. */
export async function startSession(userId: string, email: string): Promise<void> {
  if (current && current.userId === userId) return;
  const existingId = getStoredSessionId();
  if (existingId) {
    current = { id: existingId, userId, email };
  } else {
    const id = nanoid();
    setStoredSessionId(id);
    current = { id, userId, email };
    try {
      const { error } = await supabase.from('user_sessions').insert({
        id, user_id: userId, email,
        started_at: new Date().toISOString(),
        last_active: new Date().toISOString(),
        user_agent: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 400) : null,
      });
      if (error) console.warn('[analytics] startSession insert failed:', error.message);
    } catch (e) {
      console.warn('[analytics] startSession threw:', (e as Error).message);
    }
  }
  attachListeners();
  startHeartbeat();
}

/** End the current session — sets ended_at + final last_active. */
export async function endSession(): Promise<void> {
  stopHeartbeat();
  detachListeners();
  if (!current) return;
  const sid = current.id;
  current = null;
  setStoredSessionId(null);
  const lastPv = getStoredLastPv();
  setStoredLastPv(null);
  try {
    const now = new Date().toISOString();
    if (lastPv) {
      const dwellMs = Date.now() - new Date(lastPv.enteredAt).getTime();
      await supabase.from('user_page_views').update({ exited_at: now, dwell_ms: dwellMs }).eq('id', lastPv.id);
    }
    await supabase.from('user_sessions').update({ ended_at: now, last_active: now }).eq('id', sid);
  } catch (e) {
    console.warn('[analytics] endSession failed:', (e as Error).message);
  }
}

async function heartbeat() {
  if (!current) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  try {
    await supabase.from('user_sessions').update({ last_active: new Date().toISOString() }).eq('id', current.id);
  } catch { /* ignore */ }
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS);
}
function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function attachListeners() {
  if (typeof document !== 'undefined' && !visibilityHandler) {
    visibilityHandler = () => {
      if (document.visibilityState === 'visible') heartbeat();
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }
  if (typeof window !== 'undefined' && !beforeUnloadHandler) {
    beforeUnloadHandler = () => {
      // Best-effort: close the current page-view with a sync-ish update.
      // beforeunload doesn't allow real awaits but supabase-js fires the
      // request immediately and the browser usually lets it complete.
      const lastPv = getStoredLastPv();
      if (lastPv && current) {
        const dwellMs = Date.now() - new Date(lastPv.enteredAt).getTime();
        supabase.from('user_page_views')
          .update({ exited_at: new Date().toISOString(), dwell_ms: dwellMs })
          .eq('id', lastPv.id)
          .then(() => {});
        setStoredLastPv(null);
      }
    };
    window.addEventListener('beforeunload', beforeUnloadHandler);
  }
}
function detachListeners() {
  if (visibilityHandler && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
  if (beforeUnloadHandler && typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
  }
}

/** Record that the user navigated to `path`. Closes the previous page view.
 *
 *  If a session hasn't been started yet (race on initial app load — RouteTracker
 *  fires before AuthGate's startSession resolves), lazy-start one from the
 *  current Supabase auth user. Without this guard we silently dropped the
 *  first page-view of every fresh session, which is why /admin/activity
 *  always showed zero page views.
 */
export async function recordPageView(path: string): Promise<void> {
  if (!current) {
    try {
      const { data } = await supabase.auth.getUser();
      const u = data?.user;
      if (!u || !u.email) return; // genuinely not signed in
      await startSession(u.id, u.email);
    } catch {
      return;
    }
    if (!current) return; // startSession failed silently
  }
  const now = new Date();
  const nowIso = now.toISOString();

  // Close previous
  const prev = getStoredLastPv();
  if (prev) {
    const dwellMs = now.getTime() - new Date(prev.enteredAt).getTime();
    try {
      await supabase.from('user_page_views')
        .update({ exited_at: nowIso, dwell_ms: dwellMs })
        .eq('id', prev.id);
    } catch { /* ignore */ }
  }

  // Insert new
  try {
    const { data, error } = await supabase.from('user_page_views').insert({
      session_id: current.id,
      user_id: current.userId,
      email: current.email,
      path,
      entered_at: nowIso,
    }).select('id, entered_at').single();
    if (error) {
      console.warn('[analytics] recordPageView insert failed:', error.message);
      setStoredLastPv(null);
      return;
    }
    if (data) setStoredLastPv({ id: data.id as number, enteredAt: data.entered_at as string });
  } catch (e) {
    console.warn('[analytics] recordPageView threw:', (e as Error).message);
  }
}
