/**
 * localStorage quota guard — imported first in main.tsx, before any store.
 *
 * Every persisted zustand store writes its whole state to localStorage on each
 * set(). Once the ~5 MB quota is full, setItem throws QuotaExceededError
 * synchronously inside set(), which during app init aborted the whole Supabase
 * hydration block. Everything hydrated after the failing store (pod
 * assignments, vendors, TNM accounts, ...) silently stayed empty. "Pod
 * allocation fell off" (14 Oct 2026) was exactly this, triggered by the
 * actual-hours cache outgrowing the quota.
 *
 * localStorage is only a cache — Supabase is the source of truth — so a failed
 * cache write must never break the app. This wraps setItem so a quota error is
 * logged and dropped instead of thrown, and clears the oversized actual-hours
 * cache left by older builds (those entries are re-fetched on every load).
 */
const ACTUAL_HOURS_KEY = 'simpliigence-actual-hours';

function dropLegacyActualHoursCache(): void {
  try {
    const raw = window.localStorage.getItem(ACTUAL_HOURS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.state && Array.isArray(parsed.state.entries) && parsed.state.entries.length > 0) {
      parsed.state.entries = [];
      window.localStorage.setItem(ACTUAL_HOURS_KEY, JSON.stringify(parsed));
    }
  } catch {
    try { window.localStorage.removeItem(ACTUAL_HOURS_KEY); } catch { /* ignore */ }
  }
}

function installStorageQuotaGuard(): void {
  try {
    const proto = Object.getPrototypeOf(window.localStorage) as Storage;
    const original = proto.setItem;
    if ((original as unknown as { quotaGuarded?: boolean }).quotaGuarded) return;
    const guarded = function (this: Storage, key: string, value: string) {
      try {
        original.call(this, key, value);
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
          console.warn(`[storage] localStorage full - skipped caching "${key}" (${value.length} chars). Supabase remains the source of truth.`);
          return;
        }
        throw err;
      }
    };
    (guarded as unknown as { quotaGuarded?: boolean }).quotaGuarded = true;
    proto.setItem = guarded;
  } catch {
    /* no localStorage (private mode) - nothing to guard */
  }
}

installStorageQuotaGuard();
dropLegacyActualHoursCache();
