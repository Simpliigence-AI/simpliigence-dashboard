/**
 * Stale code-chunk recovery (AppDesk #2540, 17 Nov 2026).
 *
 * Every page is a React.lazy() route, so its code lives in a hashed file
 * such as /assets/ScreeningsPage-abc123.js. Each GitHub Pages deploy replaces
 * those files. A tab opened before a deploy still asks for the old file name,
 * the import fails, and React Router showed its default
 * "Unexpected Application Error! Importing a module script failed." screen.
 *
 * The cure is a page reload, which fetches the new index.html and the new
 * chunk names. We reload once automatically; a timestamp in sessionStorage
 * stops a reload loop if the chunk is missing for some other reason.
 */
const RELOAD_KEY = 'simpliigence-stale-chunk-reload-at';
const RELOAD_GUARD_MS = 30_000;

const STALE_CHUNK_PATTERNS = [
  'importing a module script failed', // Safari
  'failed to fetch dynamically imported module', // Chrome / Edge
  'error loading dynamically imported module', // Firefox
  'unable to preload css',
];

export function isStaleChunkError(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const lower = message.toLowerCase();
  return STALE_CHUNK_PATTERNS.some((p) => lower.includes(p));
}

function lastReloadAt(): number {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_KEY) || 0);
  } catch {
    return 0; // storage unavailable: allow one reload
  }
}

/** True when we have not auto-reloaded in the last 30 seconds. No side effects. */
export function canAutoReloadForStaleChunk(): boolean {
  return Date.now() - lastReloadAt() >= RELOAD_GUARD_MS;
}

/**
 * Reload the page unless we already did so in the last 30 seconds.
 * Returns true when a reload was started.
 */
export function reloadOnceForStaleChunk(): boolean {
  if (!canAutoReloadForStaleChunk()) return false;
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
  window.location.reload();
  return true;
}
