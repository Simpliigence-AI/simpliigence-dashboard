/**
 * Shared helpers for Feature Coverage — used by both the per-account
 * FeatureCoverageScorecard (in the drawer) and the cross-account
 * FeatureCoverageMatrix (top-level tab).
 */
import type { ConciergeFeature, SFFeatureCatalogEntry } from '../../types/concierge';

/** Loose match: catalog name appears in feature name or vice-versa. */
export function isImplemented(catalog: SFFeatureCatalogEntry, features: ConciergeFeature[]): boolean {
  const cName = catalog.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const f of features) {
    if (f.status !== 'implemented' && f.status !== 'in_progress') continue;
    const fName = (f.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!fName) continue;
    if (fName === cName) return true;
    if (fName.includes(cName) || cName.includes(fName)) return true;
  }
  return false;
}

/** Filter catalog to features relevant to the given industry.
 *  Universal features (empty industriesRelevant) are always relevant. */
export function relevantForIndustry(
  catalog: SFFeatureCatalogEntry[],
  industry: string | null,
): SFFeatureCatalogEntry[] {
  if (!industry) return catalog;
  return catalog.filter((c) => c.industriesRelevant.length === 0 || c.industriesRelevant.includes(industry));
}

/** Compute per-cloud X/Y for one account. */
export function computeCloudScores(
  catalog: SFFeatureCatalogEntry[],
  features: ConciergeFeature[],
  industry: string | null,
): Array<{ cloud: string; implemented: number; total: number; pct: number; entries: SFFeatureCatalogEntry[] }> {
  const relevant = relevantForIndustry(catalog, industry);
  const byCloud = new Map<string, { total: number; implemented: number; entries: SFFeatureCatalogEntry[] }>();
  for (const c of relevant) {
    if (!byCloud.has(c.cloud)) byCloud.set(c.cloud, { total: 0, implemented: 0, entries: [] });
    const bucket = byCloud.get(c.cloud)!;
    bucket.total += 1;
    bucket.entries.push(c);
    if (isImplemented(c, features)) bucket.implemented += 1;
  }
  return Array.from(byCloud.entries())
    .map(([cloud, s]) => ({ cloud, ...s, pct: s.total > 0 ? Math.round((s.implemented / s.total) * 100) : 0 }))
    .sort((a, b) => a.cloud.localeCompare(b.cloud));
}

/** Colour class for a coverage cell — matches the scorecard's bar colours. */
export function coverageCellColor(pct: number): string {
  if (pct >= 70) return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (pct >= 40) return 'bg-sky-100 text-sky-800 border-sky-200';
  if (pct >= 15) return 'bg-amber-100 text-amber-800 border-amber-200';
  if (pct > 0)  return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-white text-slate-400 border-slate-200';
}
