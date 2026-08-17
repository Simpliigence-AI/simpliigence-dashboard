import { create } from 'zustand';

/**
 * Theme preference.
 *
 *  - `auto`  → follow the clock (light 06:00–18:00, dark otherwise)
 *  - `light` → force light
 *  - `dark`  → force dark
 *
 * The user's choice persists in localStorage. `mode` is the effective
 * result (never `auto`) that the CSS actually reads via `<html data-mode>`.
 */
export type ThemePreference = 'auto' | 'light' | 'dark';
export type Mode = 'light' | 'dark';

const STORAGE_KEY = 'theme-preference';

function readTimeMode(): Mode {
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? 'light' : 'dark';
}

function loadPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'auto') return v;
  } catch { /* localStorage unavailable — fall through to default */ }
  return 'auto';
}

function effectiveMode(pref: ThemePreference): Mode {
  return pref === 'auto' ? readTimeMode() : pref;
}

interface ThemeState {
  preference: ThemePreference;
  mode: Mode;
  setPreference: (p: ThemePreference) => void;
  /** Called by the interval in useTimeMode — advances the clock when in auto. */
  tick: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const initialPref = loadPreference();
  return {
    preference: initialPref,
    mode: effectiveMode(initialPref),
    setPreference: (p) => {
      try { localStorage.setItem(STORAGE_KEY, p); } catch { /* ignore */ }
      set({ preference: p, mode: effectiveMode(p) });
    },
    tick: () => {
      if (get().preference !== 'auto') return;
      const next = readTimeMode();
      if (next !== get().mode) set({ mode: next });
    },
  };
});
