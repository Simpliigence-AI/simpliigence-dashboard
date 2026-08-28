/**
 * Financial masking gate.
 *
 * Historically this component was a demo-mode toggle (mask on for a
 * presentation, off for daily use). Under the current policy — rates,
 * margins, revenue, cost are hidden by default from EVERYONE, and only
 * users with can_view_financials can reveal them — it now delegates to
 * the session-wide reveal store.
 *
 * Behaviour:
 *   - User without permission → always masked, click is a no-op with a
 *     tooltip explaining why.
 *   - User with permission, reveal OFF (session default) → masked, click
 *     flips reveal ON for the whole session.
 *   - User with permission, reveal ON → shows the real value.
 *   - Demo-mode still stacks on top: if the owner has demo-mode enabled,
 *     the value is masked EVEN IF reveal is on. That preserves the
 *     "hide before screen-sharing" workflow.
 *
 * Every callsite kept the same import path and the same JSX so this
 * change hits every page that had a Sensitive wrapper — no per-file
 * churn required. `useMaskFinancial` and `FinancialMaskedNote` were
 * kept API-compatible for the same reason.
 */
import type { ReactNode } from 'react';
import { useFinancialsMasked } from '../store/useDemoStore';
import { useFinancialsRevealStore } from '../store/useFinancialsRevealStore';
import { useCanRevealFinancials } from '../hooks/usePageAccess';

function useShouldMask() {
  const demo = useFinancialsMasked();
  const revealed = useFinancialsRevealStore((s) => s.revealed);
  const canReveal = useCanRevealFinancials();
  // Order matters: demo mode overrides everything (so an owner sharing
  // their screen can hide everything with one flip). Otherwise: no
  // permission = always masked; permission + reveal off = masked;
  // permission + reveal on = show.
  const masked = demo || !canReveal || !revealed;
  return { masked, canReveal, demo };
}

export function Sensitive({
  children,
  placeholder,
  className = '',
}: {
  children: ReactNode;
  placeholder?: ReactNode;
  className?: string;
}) {
  const { masked, canReveal, demo } = useShouldMask();
  const reveal = useFinancialsRevealStore((s) => s.reveal);
  if (!masked) return <>{children}</>;

  const title = demo
    ? 'Hidden during demo mode (Settings → Demo mode to disable)'
    : !canReveal
      ? 'Financial value hidden — you do not have permission to view it'
      : 'Financial value hidden — click to reveal for this session';

  const clickable = !demo && canReveal;

  return (
    <span
      title={title}
      onClick={(e) => { if (clickable) { e.stopPropagation(); reveal(); } }}
      className={`text-muted/70 italic font-medium tracking-wider ${clickable ? 'cursor-pointer hover:text-primary' : 'select-none'} ${className}`}
    >
      {placeholder ?? '•••'}
    </span>
  );
}

/**
 * Hook variant for tickFormatter / Tooltip callbacks / table cell text
 * where JSX wrapping isn't possible. Same rules as <Sensitive>: masked
 * unless the current user has permission AND the session is revealed.
 */
export function useMaskFinancial() {
  const { masked } = useShouldMask();
  return (value: string | number): string => {
    if (!masked) return typeof value === 'number' ? value.toLocaleString() : value;
    return '•••';
  };
}

/** Tooltip/legend hint to show when a chart's data values are hidden. */
export function FinancialMaskedNote({ what = 'values' }: { what?: string }) {
  const { masked, canReveal, demo } = useShouldMask();
  if (!masked) return null;
  const msg = demo
    ? `Financial ${what} hidden during demo. Disable in Settings → Demo mode.`
    : canReveal
      ? `Financial ${what} hidden — click any masked value to reveal for this session.`
      : `Financial ${what} hidden — you do not have permission to view them.`;
  return (
    <p className="text-[11px] text-muted/70 italic mt-1">{msg}</p>
  );
}
