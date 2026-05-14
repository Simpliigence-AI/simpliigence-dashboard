import type { ReactNode } from 'react';
import { useFinancialsMasked } from '../store/useDemoStore';

/**
 * Renders its children unless demo-mode masking is on, in which case it
 * renders a small placeholder ("•••" by default). Use anywhere we display
 * revenue, cost, margin, billing rate, or any other financial figure.
 */
export function Sensitive({
  children,
  placeholder,
  className = '',
}: {
  children: ReactNode;
  placeholder?: ReactNode;
  className?: string;
}) {
  const masked = useFinancialsMasked();
  if (!masked) return <>{children}</>;
  return (
    <span
      title="Hidden during demo (Settings → Demo mode to disable)"
      className={`text-slate-400 italic font-medium tracking-wider select-none ${className}`}
    >
      {placeholder ?? '•••'}
    </span>
  );
}

/**
 * Hook variant for places where JSX wrapping isn't possible — e.g. recharts
 * tickFormatter / Tooltip formatter callbacks, table cell text, alt attrs.
 * Pass any pre-formatted financial string; returns "•••" when masking.
 */
export function useMaskFinancial() {
  const masked = useFinancialsMasked();
  return (value: string | number): string => {
    if (!masked) return typeof value === 'number' ? value.toLocaleString() : value;
    return '•••';
  };
}

/** Tooltip/legend hint to show when a chart's data values are hidden. */
export function FinancialMaskedNote({ what = 'values' }: { what?: string }) {
  const masked = useFinancialsMasked();
  if (!masked) return null;
  return (
    <p className="text-[11px] text-slate-400 italic mt-1">
      Financial {what} hidden during demo. Disable in Settings → Demo mode.
    </p>
  );
}
