/**
 * useCollapsedGroups — persist per-page group collapse state to localStorage.
 *
 * Rosters and Demand pages group rows under an account/project header and the
 * user's biggest scroll-pain is scanning through irrelevant groups. This hook
 * gives every page a consistent "collapsed by default; click header to expand"
 * behaviour, remembered across page reloads.
 *
 * Usage:
 *   const { isCollapsed, toggle, expandAll, collapseAll } =
 *     useCollapsedGroups('india-roster-project', { defaultCollapsed: true });
 *
 *   // Inside the group loop:
 *   const collapsed = isCollapsed(groupKey);
 *   // Render header always; render rows only when !collapsed.
 *
 * `defaultCollapsed` is the state for groups the user has NOT explicitly
 * toggled yet. Explicit toggles are stored as a { [key]: boolean } map in
 * localStorage under a per-page key so different pages don't collide.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

interface Options {
  /** Behaviour for groups the user hasn't clicked yet. Default: true. */
  defaultCollapsed?: boolean;
}

interface Api {
  /** Is this specific group currently collapsed? */
  isCollapsed: (key: string) => boolean;
  /** Flip one group. */
  toggle: (key: string) => void;
  /** Force-collapse one group. */
  collapse: (key: string) => void;
  /** Force-expand one group. */
  expand: (key: string) => void;
  /** Wipe all overrides — everything reverts to the default. */
  reset: () => void;
  /** Force every provided key to expanded. */
  expandAll: (keys: string[]) => void;
  /** Force every provided key to collapsed. */
  collapseAll: (keys: string[]) => void;
}

export function useCollapsedGroups(
  storageKey: string,
  { defaultCollapsed = true }: Options = {},
): Api {
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(`collapsed:${storageKey}`);
      return raw ? JSON.parse(raw) as Record<string, boolean> : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(`collapsed:${storageKey}`, JSON.stringify(overrides));
    } catch { /* private-mode / quota — best effort */ }
  }, [overrides, storageKey]);

  const isCollapsed = useCallback((key: string) => {
    const explicit = overrides[key];
    return explicit === undefined ? defaultCollapsed : explicit;
  }, [overrides, defaultCollapsed]);

  const toggle = useCallback((key: string) => {
    setOverrides((prev) => {
      const current = prev[key] === undefined ? defaultCollapsed : prev[key];
      return { ...prev, [key]: !current };
    });
  }, [defaultCollapsed]);

  const collapse = useCallback((key: string) => {
    setOverrides((prev) => ({ ...prev, [key]: true }));
  }, []);

  const expand = useCallback((key: string) => {
    setOverrides((prev) => ({ ...prev, [key]: false }));
  }, []);

  const reset = useCallback(() => setOverrides({}), []);

  const expandAll = useCallback((keys: string[]) => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = false;
      return next;
    });
  }, []);

  const collapseAll = useCallback((keys: string[]) => {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = true;
      return next;
    });
  }, []);

  return useMemo(
    () => ({ isCollapsed, toggle, collapse, expand, reset, expandAll, collapseAll }),
    [isCollapsed, toggle, collapse, expand, reset, expandAll, collapseAll],
  );
}
