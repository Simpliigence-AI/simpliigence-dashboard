import { useEffect, useState } from 'react';

/**
 * Time-of-day theme: light 06:00–18:00, dark otherwise.
 *
 * The hook writes the current mode onto `<html data-mode="light|dark">` so
 * CSS `:root[data-mode='…']` overrides in `index.css` can flip the whole
 * app's palette without any component-level plumbing.
 *
 * Re-checks once a minute so the swap lands live when the clock crosses
 * 06:00 or 18:00 — no page refresh required.
 */
export type TimeMode = 'light' | 'dark';

export function getTimeMode(): TimeMode {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? 'light' : 'dark';
}

export function useTimeMode(): TimeMode {
  const [mode, setMode] = useState<TimeMode>(getTimeMode);

  // Push the current mode to <html> whenever it changes. CSS reads it
  // via `:root[data-mode='…']` selectors.
  useEffect(() => {
    document.documentElement.dataset.mode = mode;
  }, [mode]);

  // Poll for boundary crossings. One-minute cadence is plenty — the two
  // boundaries are twelve hours apart.
  useEffect(() => {
    const id = setInterval(() => setMode(getTimeMode()), 60_000);
    return () => clearInterval(id);
  }, []);

  return mode;
}
