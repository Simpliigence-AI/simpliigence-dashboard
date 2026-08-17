import type { ReactNode } from 'react';

/**
 * PageHeader — the top of every page.
 *
 * Used by 32 pages, so it's the single biggest lever on how the app reads.
 * The title moves to display scale with tight tracking, and an optional
 * uppercase eyebrow above it carries the section context — which is what lets
 * each tab feel like its own place without every page inventing its own
 * header markup.
 *
 * The old version set the title at text-2xl next to a same-weight subtitle,
 * so the page opened with nothing to anchor on. Scale does that work now.
 */
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /**
   * Small uppercase kicker above the title — the section this page belongs to
   * ("India T&M", "Delivery"). Optional; pages that don't set one just get the
   * title.
   */
  eyebrow?: string;
  /**
   * Accent for the eyebrow, matching the hub colours on Home so a page feels
   * like part of the same section you clicked in from.
   */
  tone?: 'muted' | 'brand' | 'green' | 'gold' | 'violet' | 'teal' | 'rose';
}

const TONE: Record<NonNullable<PageHeaderProps['tone']>, string> = {
  muted: 'text-muted',
  brand: 'text-brand',
  green: 'text-green',
  gold: 'text-gold',
  violet: 'text-violet',
  teal: 'text-teal',
  rose: 'text-rose',
};

export function PageHeader({ title, subtitle, action, eyebrow, tone = 'muted' }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-6 mb-7">
      <div className="min-w-0">
        {eyebrow && <p className={`eyebrow !${TONE[tone]} mb-1.5`}>{eyebrow}</p>}
        <h1 className="display-lg text-ink">{title}</h1>
        {subtitle && (
          <p className="text-[0.9375rem] text-muted mt-2 leading-relaxed max-w-2xl">{subtitle}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}
