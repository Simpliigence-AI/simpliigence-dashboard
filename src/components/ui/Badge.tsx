import type { ReactNode } from 'react';

interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  children: ReactNode;
  className?: string;
}

/**
 * Badge palette.
 *
 * Tints of the categorical tokens rather than Tailwind's stock colours — on a
 * cream ground the stock 50-level greys and blues read as slightly dirty, and
 * a row of them looks like a different product to the rest of the page.
 */
const variants = {
  default: 'bg-surface-2 text-ink/80 ring-line',
  success: 'bg-green/10 text-green ring-green/25',
  warning: 'bg-gold/12 text-gold ring-gold/25',
  danger: 'bg-rose/10 text-rose ring-rose/25',
  info: 'bg-brand/10 text-brand-dark ring-brand/25',
  neutral: 'bg-surface-2/70 text-muted ring-line/70',
};

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[0.6875rem] font-bold tracking-[0.01em] ring-1 ring-inset ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { variant: BadgeProps['variant']; label: string }> = {
    deployed: { variant: 'info', label: 'Deployed' },
    bench: { variant: 'warning', label: 'Bench' },
    rolling_off: { variant: 'warning', label: 'Rolling Off' },
    notice_period: { variant: 'danger', label: 'Notice' },
    on_leave: { variant: 'neutral', label: 'On Leave' },
    pipeline: { variant: 'neutral', label: 'Pipeline' },
    confirmed: { variant: 'info', label: 'Confirmed' },
    active: { variant: 'success', label: 'Active' },
    completed: { variant: 'neutral', label: 'Completed' },
    on_hold: { variant: 'warning', label: 'On Hold' },
    cancelled: { variant: 'danger', label: 'Cancelled' },
    open: { variant: 'info', label: 'Open' },
    filled: { variant: 'success', label: 'Filled' },
    closed: { variant: 'neutral', label: 'Closed' },
  };
  const config = map[status] || { variant: 'default' as const, label: status };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
