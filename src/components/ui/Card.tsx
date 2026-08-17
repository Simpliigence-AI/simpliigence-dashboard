import type { ReactNode } from 'react';

/**
 * Card — the surface everything sits on.
 *
 * Warm white on the warm paper ground, with a long soft navy-tinted shadow.
 * The old card was pure white on cool grey with a tight grey shadow, which
 * made every card read as a box outline; here the lift comes from the shadow
 * and the warmth difference, so the border can stay quiet and the content
 * carries the contrast.
 */
interface CardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
  /** Drop the inner padding when the child manages its own (tables, grids). */
  flush?: boolean;
}

export function Card({ children, className = '', title, action, flush = false }: CardProps) {
  return (
    <div
      className={`bg-surface rounded-2xl border border-line/70 shadow-[0_16px_48px_#0f1b2d14] transition-shadow duration-200 hover:shadow-[0_20px_56px_#0f1b2d1f] ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-line/60">
          {title && <h3 className="text-[0.9375rem] font-bold text-ink tracking-[-0.015em]">{title}</h3>}
          {action}
        </div>
      )}
      <div className={flush ? '' : 'p-6'}>{children}</div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  subtitle?: string;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  icon?: ReactNode;
  /** Colour of the icon chip + value. Defaults to coral. */
  tone?: 'blue' | 'green' | 'gold' | 'violet' | 'teal' | 'rose' | 'navy';
}

const TONE: Record<NonNullable<StatCardProps['tone']>, { chip: string; icon: string }> = {
  blue: { chip: 'bg-brand/12', icon: 'text-brand' },
  green: { chip: 'bg-green/12', icon: 'text-green' },
  gold: { chip: 'bg-gold/12', icon: 'text-gold' },
  violet: { chip: 'bg-violet/12', icon: 'text-violet' },
  teal: { chip: 'bg-teal/12', icon: 'text-teal' },
  rose: { chip: 'bg-rose/12', icon: 'text-rose' },
  navy: { chip: 'bg-navy/10', icon: 'text-navy' },
};

/**
 * StatCard — one number, stated loudly.
 *
 * The number is the point, so it gets display weight and tight tracking while
 * the label drops to a small uppercase eyebrow. Previously both sat around the
 * same visual weight and the eye had nowhere to land first.
 */
export function StatCard({ label, value, subtitle, trend, trendValue, icon, tone = 'blue' }: StatCardProps) {
  const trendColors = {
    up: 'text-green',
    down: 'text-rose',
    flat: 'text-muted',
  };
  const trendArrows = { up: '↑', down: '↓', flat: '→' };
  const t = TONE[tone];

  return (
    <div className="bg-surface rounded-2xl border border-line/70 shadow-[0_16px_48px_#0f1b2d14] hover:shadow-[0_20px_56px_#0f1b2d1f] transition-shadow duration-200 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{label}</p>
          <p className="text-[2rem] font-bold text-ink mt-2 tabular-nums leading-none tracking-[-0.03em]">{value}</p>
          {subtitle && <p className="text-xs text-muted mt-2 truncate">{subtitle}</p>}
          {trend && trendValue && (
            <p className={`text-xs font-bold mt-2 ${trendColors[trend]}`}>
              {trendArrows[trend]} {trendValue}
            </p>
          )}
        </div>
        {icon && (
          <div className={`w-12 h-12 rounded-xl ${t.chip} flex items-center justify-center ${t.icon} flex-shrink-0`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
