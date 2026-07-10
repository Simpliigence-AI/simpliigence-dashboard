/**
 * FeatureCoverageScorecard
 *
 * For one Concierge account, renders per-cloud "X of Y-relevant implemented"
 * progress bars using the master sf_feature_catalog. Y-relevant honors the
 * account's industry: features tagged industries_relevant = [Healthcare] only
 * count for a Healthcare account; universal features (empty array) count for
 * everyone.
 *
 * Click a cloud row → drill-down modal showing the gap (what's not yet
 * implemented for this account, ranked by upsell hint).
 *
 * Match strategy: an existing ConciergeFeature with status='implemented' or
 * 'in_progress' counts as "implemented" if its name matches a catalog entry
 * (case-insensitive contains, or explicit catalog_id link). This lights up
 * historical data without needing a data migration.
 */
import { useMemo, useState } from 'react';
import { X, ChevronRight, Sparkles, DollarSign } from 'lucide-react';
import type { ConciergeAccount, ConciergeFeature, SFFeatureCatalogEntry } from '../../types/concierge';

interface Props {
  account: ConciergeAccount;
  features: ConciergeFeature[];
  catalog: SFFeatureCatalogEntry[];
  /** Optional: render inline in a small card, or block-level. */
  compact?: boolean;
}

/** Loose match: catalog entry name appears in feature name or vice-versa
 *  (case-insensitive, word-boundary trimmed). */
function isImplemented(catalog: SFFeatureCatalogEntry, features: ConciergeFeature[]): boolean {
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

export function FeatureCoverageScorecard({ account, features, catalog, compact = false }: Props) {
  const [openCloud, setOpenCloud] = useState<string | null>(null);

  const scorecard = useMemo(() => {
    // Restrict catalog to industry-relevant features
    const industry = account.industry;
    const relevant = catalog.filter((c) => !industry || c.industriesRelevant.length === 0 || c.industriesRelevant.includes(industry));

    // Group by cloud
    const byCloud = new Map<string, { total: number; implemented: number; entries: SFFeatureCatalogEntry[] }>();
    for (const c of relevant) {
      if (!byCloud.has(c.cloud)) byCloud.set(c.cloud, { total: 0, implemented: 0, entries: [] });
      const bucket = byCloud.get(c.cloud)!;
      bucket.total += 1;
      bucket.entries.push(c);
      if (isImplemented(c, features)) bucket.implemented += 1;
    }

    // Sort clouds by implementation ratio DESC, then by total DESC
    return Array.from(byCloud.entries())
      .map(([cloud, s]) => ({ cloud, ...s, pct: s.total > 0 ? Math.round((s.implemented / s.total) * 100) : 0 }))
      .sort((a, b) => (b.pct - a.pct) || (b.total - a.total));
  }, [account.industry, features, catalog]);

  const totalRelevant = scorecard.reduce((s, r) => s + r.total, 0);
  const totalImplemented = scorecard.reduce((s, r) => s + r.implemented, 0);
  const overallPct = totalRelevant > 0 ? Math.round((totalImplemented / totalRelevant) * 100) : 0;

  const openDetail = openCloud ? scorecard.find((s) => s.cloud === openCloud) : null;
  const openGap = openDetail ? openDetail.entries.filter((c) => !isImplemented(c, features)) : [];
  const gapUpsell = openGap.reduce((s, e) => s + e.upsellHint, 0);

  if (catalog.length === 0) {
    return (
      <div className="text-[11px] text-slate-400 italic">
        Master catalog not loaded yet — refresh to populate.
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {/* Overall header */}
      <div className="flex items-center justify-between text-[11px] font-semibold">
        <span className="text-slate-700">
          Feature Coverage
          {account.industry && <span className="ml-1.5 text-[10px] font-normal text-slate-500">· {account.industry} lens</span>}
          {!account.industry && <span className="ml-1.5 text-[10px] font-normal text-amber-600">· set industry for accurate score</span>}
        </span>
        <span className={`tabular-nums ${overallPct >= 60 ? 'text-emerald-700' : overallPct >= 30 ? 'text-amber-700' : 'text-slate-500'}`}>
          {totalImplemented} / {totalRelevant} · {overallPct}%
        </span>
      </div>

      {/* Per-cloud rows */}
      <div className="space-y-1">
        {scorecard.map((row) => {
          const barColor = row.pct >= 70 ? 'bg-emerald-500' : row.pct >= 40 ? 'bg-sky-500' : row.pct >= 15 ? 'bg-amber-500' : 'bg-slate-300';
          return (
            <button
              key={row.cloud}
              type="button"
              onClick={() => setOpenCloud(row.cloud)}
              className="w-full text-left group hover:bg-slate-50 rounded px-1.5 py-1 transition-colors"
              title={`Click to see the ${row.total - row.implemented} unimplemented features for ${row.cloud}`}
            >
              <div className="flex items-center gap-2 text-[11px]">
                <span className="text-slate-700 font-medium w-32 truncate">{row.cloud}</span>
                <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`${barColor} h-full rounded-full transition-all`} style={{ width: `${row.pct}%` }} />
                </div>
                <span className="text-slate-600 tabular-nums w-16 text-right">
                  {row.implemented}<span className="text-slate-400">/{row.total}</span>
                </span>
                <ChevronRight size={11} className="text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Drill-down modal */}
      {openDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenCloud(null)}>
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">{openDetail.cloud} — gaps for {account.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {openDetail.implemented} implemented · {openGap.length} unimplemented
                  {account.industry && ` · filtered to ${account.industry} industry`}
                  {gapUpsell > 0 && (
                    <span className="ml-2 inline-flex items-center gap-0.5 text-amber-700 font-medium">
                      <DollarSign size={10} />{gapUpsell.toLocaleString()} potential upsell
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setOpenCloud(null)} className="text-slate-400 hover:text-slate-700 p-1" title="Close">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {openGap.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-8 flex flex-col items-center gap-2">
                  <Sparkles size={20} className="text-emerald-500" />
                  All relevant {openDetail.cloud} features are implemented for {account.name}.
                </div>
              ) : (
                <>
                  <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">Not implemented — potential upsell</div>
                  <div className="space-y-2">
                    {openGap
                      .sort((a, b) => b.upsellHint - a.upsellHint)
                      .map((entry) => (
                        <div key={entry.id} className="rounded-md border border-slate-200 px-3 py-2 hover:border-sky-300 transition-colors">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900 truncate">{entry.name}</div>
                              {entry.category && (
                                <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-0.5">{entry.category}</div>
                              )}
                            </div>
                            {entry.upsellHint > 0 && (
                              <span className="flex-shrink-0 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                ~${entry.upsellHint.toLocaleString()}
                              </span>
                            )}
                          </div>
                          {entry.description && (
                            <div className="text-[11px] text-slate-600 mt-1 leading-relaxed">{entry.description}</div>
                          )}
                          {entry.industriesRelevant.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {entry.industriesRelevant.map((i) => (
                                <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded ${i === account.industry ? 'bg-sky-100 text-sky-800 font-semibold' : 'bg-slate-100 text-slate-600'}`}>
                                  {i}
                                </span>
                              ))}
                            </div>
                          )}
                          {entry.licenseTier && (
                            <div className="text-[10px] text-slate-400 mt-1">Requires: {entry.licenseTier}</div>
                          )}
                        </div>
                      ))}
                  </div>
                </>
              )}
              {openDetail.implemented > 0 && (
                <>
                  <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider pt-3 border-t border-slate-100">Already implemented</div>
                  <div className="flex flex-wrap gap-1.5">
                    {openDetail.entries.filter((e) => isImplemented(e, features)).map((entry) => (
                      <span key={entry.id} className="text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded">
                        ✓ {entry.name}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
