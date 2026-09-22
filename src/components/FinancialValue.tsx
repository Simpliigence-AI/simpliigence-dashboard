/**
 * Universal financial value gate.
 *
 * Wrap any rate / margin / revenue / spend / cost display in this. Behaves
 * on a strict "masked by default, click to reveal" model:
 *
 *   - Users without permission to view financials always see the mask.
 *     Clicking does nothing except a title tooltip explaining why.
 *
 *   - Users with permission see:
 *       * masked (•••) when the session-wide reveal is OFF (default).
 *         Clicking the mask flips reveal to ON everywhere, for the rest
 *         of the session or until the sidebar hide button is pressed.
 *       * the actual value when reveal is ON.
 *
 * This replaces the older `Sensitive` (demo-mode-only) and `OwnerOnly`
 * (raghu-only, no reveal) patterns for most financial displays. Keep
 * OwnerOnly where the value should NEVER be shown to anyone else even
 * when they're allowed to view financials in general (rare).
 */
import type { ReactNode } from 'react';
import { useFinancialsRevealStore } from '../store/useFinancialsRevealStore';
import { useCanRevealFinancials } from '../hooks/usePageAccess';

export function FinancialValue({
  children,
  placeholder,
  className = '',
}: {
  children: ReactNode;
  placeholder?: ReactNode;
  className?: string;
}) {
  const revealed = useFinancialsRevealStore((s) => s.revealed);
  const reveal = useFinancialsRevealStore((s) => s.reveal);
  const canReveal = useCanRevealFinancials();

  if (canReveal && revealed) return <>{children}</>;

  const title = canReveal
    ? 'Financial value hidden — click to reveal for this session'
    : 'Financial value hidden — you do not have permission to view it';

  return (
    <span
      title={title}
      onClick={(e) => {
        if (!canReveal) return;
        e.stopPropagation();
        reveal();
      }}
      className={`inline-flex items-center text-muted/70 italic tracking-wider ${canReveal ? 'cursor-pointer hover:text-primary' : 'select-none'} ${className}`}
    >
      {placeholder ?? '•••'}
    </span>
  );
}
