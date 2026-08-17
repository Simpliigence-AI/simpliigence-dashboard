/**
 * Stub page used for routes that have a slot in the new navigation but
 * whose data source / filtering is still being clarified.
 *
 * Each placeholder explains what the tab WILL contain and lets the user
 * jump to the closest existing page so they're not stranded.
 */
import { Link } from 'react-router-dom';
import { Construction, ArrowRight } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';

interface PlaceholderProps {
  title: string;
  subtitle: string;
  /** What this tab will eventually contain — bullet points */
  willContain: string[];
  /** Optional related existing page the user can use in the meantime */
  meanwhile?: { label: string; to: string };
}

export function PlaceholderPage({ title, subtitle, willContain, meanwhile }: PlaceholderProps) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <div className="p-8 max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 mb-4">
            <Construction size={26} />
          </div>
          <h3 className="text-lg font-bold text-ink mb-2">Tab scaffolded — data source TBD</h3>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            This tab is part of the new navigation. The exact data shape is still being decided —
            confirm with Raghu what fields/filters this view should show, and I'll wire it up.
          </p>

          <div className="text-left bg-surface-2/70 rounded-lg p-5 mb-5 border border-line">
            <div className="text-[10px] font-bold text-muted/70 uppercase tracking-wider mb-2">
              Planned contents
            </div>
            <ul className="space-y-1.5 text-sm text-ink/80">
              {willContain.map((item, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-blue-400 flex-shrink-0">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {meanwhile && (
            <Link
              to={meanwhile.to}
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
            >
              In the meantime: open {meanwhile.label}
              <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </Card>
    </>
  );
}
