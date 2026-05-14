import { EyeOff } from 'lucide-react';
import { useDemoStore, useFinancialsMasked } from '../store/useDemoStore';

/** Top-of-page banner shown while financials are masked for a live demo.
 *  Quietly disappears when the masking period expires or is turned off. */
export function DemoBanner() {
  const masked = useFinancialsMasked();
  const effectiveUntil = useDemoStore((s) => s.effectiveUntil());
  const disableMasking = useDemoStore((s) => s.disableMasking);

  if (!masked || !effectiveUntil) return null;

  const until = new Date(effectiveUntil);
  const dayLabel = until.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-3 text-amber-900">
      <div className="flex items-center gap-2 text-xs">
        <EyeOff size={14} className="text-amber-600 shrink-0" />
        <span>
          <strong>Demo mode:</strong> financials are masked (revenue, cost, margin, rate). Auto-clears{' '}
          <strong className="font-semibold">{dayLabel}</strong>.
        </span>
      </div>
      <button
        onClick={disableMasking}
        className="text-[11px] font-semibold text-amber-900 hover:text-amber-700 underline underline-offset-2"
      >
        Disable now
      </button>
    </div>
  );
}
