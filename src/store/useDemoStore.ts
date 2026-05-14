/**
 * Demo-mode store.
 *
 * Provides a "mask financials" mode that hides revenue, cost, margin, and rate
 * displays across the app for live demos. Time-bounded so it auto-clears.
 *
 * Default policy: masking is ON until DEFAULT_MASK_UNTIL (set at build time).
 * The user can flip it off manually in Settings; that choice persists until the
 * expiry, after which masking turns off naturally.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** ISO datetime after which masking is no longer the default.
 *  Demo runs 2026-05-14 → 2026-05-16; clear on 2026-05-17. */
const DEFAULT_MASK_UNTIL = '2026-05-17T00:00:00Z';

interface DemoState {
  /** ISO timestamp at which the current "mask financials" period ends.
   *  null  = no period set (use DEFAULT_MASK_UNTIL on first run).
   *  past  = expired, masking off.
   *  future = masking on until then. */
  maskUntil: string | null;
  /** True if user explicitly disabled masking — overrides the default. */
  userDisabled: boolean;

  enableMasking: (days: number) => void;
  disableMasking: () => void;
  /** True if financials should currently be hidden. */
  isMasked: () => boolean;
  /** ISO timestamp the masking period ends (null when not masked). */
  effectiveUntil: () => string | null;
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set, get) => ({
      maskUntil: null,
      userDisabled: false,

      enableMasking: (days: number) => {
        const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
        set({ maskUntil: until, userDisabled: false });
      },

      disableMasking: () => {
        set({ userDisabled: true });
      },

      effectiveUntil: () => {
        const { maskUntil, userDisabled } = get();
        if (userDisabled) return null;
        const candidate = maskUntil ?? DEFAULT_MASK_UNTIL;
        return new Date(candidate).getTime() > Date.now() ? candidate : null;
      },

      isMasked: () => get().effectiveUntil() !== null,
    }),
    {
      name: 'simpliigence-demo',
      version: 1,
    },
  ),
);

/** React hook: returns true while financials should be masked.
 *  Re-renders when the store changes; on its own does NOT re-render
 *  when the expiry simply ticks past — that's fine because the next
 *  user action will re-evaluate, and a banner shows the deadline. */
export function useFinancialsMasked(): boolean {
  return useDemoStore((s) => {
    if (s.userDisabled) return false;
    const candidate = s.maskUntil ?? DEFAULT_MASK_UNTIL;
    return new Date(candidate).getTime() > Date.now();
  });
}
