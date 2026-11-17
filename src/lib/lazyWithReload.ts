import { lazy, type ComponentType } from 'react';

// After a deploy the hashed page files from the previous build no longer exist.
// A tab that was open across the deploy still asks for the old file names, so
// opening a page it has not loaded yet fails with "Importing a module script
// failed" (Safari) or "Failed to fetch dynamically imported module" (Chrome).
// Reloading picks up the new index.html, which points at the new files.

const RELOAD_KEY = 'stale-build-reloaded-at';
const RELOAD_COOLDOWN_MS = 60_000;

/** Reload once to pick up a new build. Returns false if we reloaded moments ago (so no reload loop). */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage unavailable — we cannot tell whether we already reloaded, so do not risk a loop.
    return false;
  }
  window.location.reload();
  return true;
}

export function isStaleBuildError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS/i.test(message);
}

/** React.lazy, except a page file missing after a deploy reloads the app instead of crashing it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same constraint React.lazy itself uses
export function lazyWithReload<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch (error) {
      if (isStaleBuildError(error) && reloadForNewBuild()) {
        // The page is reloading; keep the loading state up until it does.
        return new Promise<{ default: T }>(() => {});
      }
      throw error;
    }
  });
}
