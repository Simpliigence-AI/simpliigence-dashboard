/**
 * Session-wide financial reveal state.
 *
 * Default: revealed = false. Every FinancialValue on the app shows a
 * masked placeholder (•••). Clicking any masked value, or the sidebar
 * reveal toggle, flips this to true and unmasks every FinancialValue
 * for the rest of the session (or until toggled back).
 *
 * The reveal only happens if the current user is *allowed* to reveal —
 * that check lives in useCanRevealFinancials. Non-permitted users see
 * mask and clicking is a no-op.
 *
 * State is intentionally NOT persisted. Refreshing the page returns to
 * masked-by-default, so a session left open on a shared screen doesn't
 * leak rates.
 */
import { create } from 'zustand';

interface FinancialsRevealState {
  revealed: boolean;
  reveal: () => void;
  hide: () => void;
  toggle: () => void;
}

export const useFinancialsRevealStore = create<FinancialsRevealState>((set) => ({
  revealed: false,
  reveal: () => set({ revealed: true }),
  hide: () => set({ revealed: false }),
  toggle: () => set((s) => ({ revealed: !s.revealed })),
}));
