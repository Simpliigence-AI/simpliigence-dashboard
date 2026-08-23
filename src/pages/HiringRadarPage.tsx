/**
 * HiringRadarPage
 *
 * Embeds the externally-maintained Salesforce hiring radar
 * (raghu-simplii.github.io/salesforce-hiring-radar/) so it lives inside
 * the dashboard shell while Grok bot continues to publish updates to the
 * source repo on its own cadence. No copying, no sync — iframe reflects
 * whatever GitHub Pages serves at request time.
 *
 * Cache handling:
 *   - GitHub Pages sets `cache-control: max-age=600` on the HTML and sits
 *     behind Fastly, so both the browser and the CDN edge can hold a stale
 *     copy for up to 10 minutes after Grok pushes.
 *   - To keep the dashboard from surfacing stale data:
 *       1. cache-bust: iframe src carries a `?t=<mount-timestamp>` param,
 *          re-generated every time the route mounts, so the request path
 *          is unique per visit and skips both caches.
 *       2. manual reload: a "Refresh" button lets the user force a fresh
 *          fetch without leaving the page (bumps the same nonce).
 *   - The header shows "loaded X ago" so the current view's freshness is
 *     visible at a glance.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';

const RADAR_URL = 'https://raghu-simplii.github.io/salesforce-hiring-radar/';

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function HiringRadarPage() {
  const [nonce, setNonce] = useState(() => Date.now());
  const [, forceTick] = useState(0);

  // Update the "loaded X ago" chip once a minute so freshness stays honest.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const iframeSrc = useMemo(() => `${RADAR_URL}?t=${nonce}`, [nonce]);
  const reload = useCallback(() => setNonce(Date.now()), []);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <PageHeader
        title="Salesforce Hiring Radar"
        subtitle={`Persistent + Acuity Analytics, 7d / 15d windows · loaded ${timeAgo(nonce)}`}
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:border-slate-400"
              title="Fetch the latest version from GitHub Pages (bypasses browser + CDN cache)"
            >
              <RefreshCw size={12} /> Refresh
            </button>
            <a
              href={RADAR_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 bg-white text-slate-700 hover:border-slate-400"
              title="Open the radar in its own tab"
            >
              <ExternalLink size={12} /> Open in new tab
            </a>
          </div>
        }
      />
      <div className="flex-1 rounded-lg border border-slate-200 bg-white overflow-hidden">
        <iframe
          key={nonce}
          src={iframeSrc}
          title="Salesforce Hiring Radar"
          loading="lazy"
          className="w-full h-full border-0"
          referrerPolicy="no-referrer"
        />
      </div>
    </div>
  );
}
