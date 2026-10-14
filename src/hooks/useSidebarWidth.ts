/**
 * Desktop sidebar width — drag-to-resize with a remembered width.
 *
 *   - Default 320px. Min 288px (the old fixed width). Max 600px or 45% of the
 *     window, whichever is smaller, so the main panel keeps most of a laptop
 *     screen.
 *   - The chosen width is saved in localStorage. `null` means "use the
 *     default", so a reset (double-click the handle) also picks up any future
 *     change to the default.
 *   - The stored width is kept as chosen; only the rendered width is clamped
 *     to the current window, so a width picked on a big monitor comes back
 *     when you return to it.
 */
import { useCallback, useEffect, useState } from 'react';

export const SIDEBAR_DEFAULT_WIDTH = 320;
export const SIDEBAR_MIN_WIDTH = 288;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_MAX_VIEWPORT_FRACTION = 0.45;
const WIDTH_KEY = 'sidebar-width';

function readStored(): number | null {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function maxFor(viewport: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(viewport * SIDEBAR_MAX_VIEWPORT_FRACTION)));
}

export interface SidebarWidth {
  /** Rendered width in px, clamped to [min, max]. */
  width: number;
  min: number;
  max: number;
  /** True while the handle is being dragged (layout transitions are paused). */
  resizing: boolean;
  setResizing: (on: boolean) => void;
  setWidth: (px: number) => void;
  reset: () => void;
}

export function useSidebarWidth(): SidebarWidth {
  const [stored, setStored] = useState<number | null>(readStored);
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Persist once a drag ends (not on every pointer move).
  useEffect(() => {
    if (resizing) return;
    try {
      if (stored == null) localStorage.removeItem(WIDTH_KEY);
      else localStorage.setItem(WIDTH_KEY, String(stored));
    } catch { /* storage unavailable — width just isn't remembered */ }
  }, [stored, resizing]);

  const max = maxFor(viewport);
  const width = Math.min(max, Math.max(SIDEBAR_MIN_WIDTH, stored ?? SIDEBAR_DEFAULT_WIDTH));

  const setWidth = useCallback((px: number) => {
    setStored(Math.round(Math.min(maxFor(window.innerWidth), Math.max(SIDEBAR_MIN_WIDTH, px))));
  }, []);
  const reset = useCallback(() => setStored(null), []);

  return { width, min: SIDEBAR_MIN_WIDTH, max, resizing, setResizing, setWidth, reset };
}
