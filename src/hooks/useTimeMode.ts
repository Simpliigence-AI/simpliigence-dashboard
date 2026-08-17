import { useEffect } from 'react';
import { useThemeStore } from '../store/useThemeStore';

/**
 * Theme mode used across the app.
 *
 * Delegates to `useThemeStore` (which owns the user preference and the
 * clock-derived mode) and takes care of the two DOM side-effects the store
 * shouldn't do itself:
 *
 *  - Writes `<html data-mode="…">` so CSS `:root[data-mode='…']` selectors
 *    in index.css can flip the whole palette without any per-component
 *    plumbing.
 *  - Runs a one-minute `tick` interval so the auto mode swap lands live
 *    when the clock crosses 06:00 or 18:00 — no page refresh required.
 *
 * The hook returns the *effective* mode (`'light' | 'dark'`, never `'auto'`).
 * Components that also need to read or set the user's preference should
 * import `useThemeStore` directly.
 */
export type { Mode as TimeMode } from '../store/useThemeStore';

export function useTimeMode(): 'light' | 'dark' {
  const mode = useThemeStore((s) => s.mode);
  const tick = useThemeStore((s) => s.tick);

  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  useEffect(() => {
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [tick]);

  return mode;
}
