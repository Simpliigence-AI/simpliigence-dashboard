/**
 * FeatureCoverageMatrix — cross-account × per-cloud coverage grid.
 *
 * Replaces the old "Backlog" tab on ConciergePage. One row per account,
 * one column per Salesforce cloud, coloured cells show X/Y implemented
 * against the industry-relevant slice of the master catalog. Click any
 * cell to open the drill-down modal (same one used by the drawer's
 * scorecard) showing exactly what's missing.
 *
 * Also renders:
 *   - Overall coverage column (weighted across all clouds)
 *   - Sort by overall %, by account name, or by "biggest gap" (unimplemented count)
 *   - Industry filter (default = each account's own industry)
 *   - "Missing industry" warning per account with no industry set
 */
import { useMemo, useState } from 'react';
import { X, DollarSign, Sparkles, AlertCircle } from 'lucide-react';
import type { ConciergeAccount, ConciergeFeature, SFFeatureCatalogEntry } from '../../types/concierge';
import { isImplemented, computeCloudScores, coverageCellColor } from './featureCoverageUtils';

interface Props {
  accounts: ConciergeAccount[];
  featuresByAccount: Map<string, ConciergeFeature[]>;
  catalog: SFFeatureCatalogEntry[];
  onAccountClick?: (accountId: string) => void;
}

type SortMode = 'overall' | 'name' | 'gap';

export function FeatureCoverageMatrix({ accounts, featuresByAccount, catalog, onAccountClick }: Props) {
  const [sort, setSort] = useState<SortMode>('overall');
  const [drilldown, setDrilldown] = useState<{ accountId: string; cloud: string } | null>(null);

  // Union of all clouds present in the catalog — matrix columns
  const clouds = useMemo(() => {
    const s = new Set<string>();
    for (const c of catalog) s.add(c.cloud);
    return Array.from(s).sort();
  }, [catalog]);

  // Compute per-account per-cloud scores
  const rows = useMemo(() => {
    return accounts.map((a) => {
      const features = featuresByAccount.get(a.id) ?? [];
      const scores = computeCloudScores(catalog, features, a.industry);
      const totalImpl = scores.reduce((s, r) => s + r.implemented, 0);
      const totalRelevant = scores.reduce((s, r) => s + r.total, 0);
      const overallPct = totalRelevant > 0 ? Math.round((totalImpl / totalRelevant) * 100) : 0;
      const gap = totalRelevant - totalImpl;
      // upsell $ potential of the gap
      let upsell = 0;
      for (const r of scores) {
        for (const e of r.entries) if (!isImplemented(e, features)) upsell += e.upsellHint;
      }
      const scoreByCloud = new Map(scores.map((r) => [r.cloud, r]));
      return { account: a, features, scores, scoreByCloud, totalImpl, totalRelevant, overallPct, gap, upsell };
    }).sort((a, b) => {
      if (sort === 'name') return a.account.name.localeCompare(b.account.name);
      if (sort === 'gap') return b.gap - a.gap;
      return b.overallPct - a.overallPct;
    });
  }, [accounts, featuresByAccount, catalog, sort]);

  const totalGapUpsell = rows.reduce((s, r) => s + r.upsell, 0);
  const drilldownRow = drilldown ? rows.find((r) => r.account.id === drilldown.accountId) : null;
  const drilldownScore = drilldownRow && drilldown ? drilldownRow.scoreByCloud.get(drilldown.cloud) : null;
  const drilldownGap = drilldownScore ? drilldownScore.entries.filter((e) => !isImplemented(e, drilldownRow!.features)) : [];
  const drilldownGapUpsell = drilldownGap.reduce((s, e) => s + e.upsellHint, 0);

  if (catalog.length === 0) {
    return (
      <div className="text-sm text-slate-500 text-center py-12 border border-dashed border-slate-200 rounded-lg">
        Master catalog not loaded yet — head to the <strong>Feature Catalog</strong> tab and hit Refresh.
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="text-sm text-slate-500 text-center py-12 border border-dashed border-slate-200 rounded-lg">
        No concierge accounts yet — add one from the Overview tab.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header + controls */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-slate-900">Feature Coverage</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {rows.length} account{rows.length === 1 ? '' : 's'} · {clouds.length} clouds ·{' '}
            {totalGapUpsell > 0 && (
              <span className="inline-flex items-center gap-0.5 text-amber-700 font-medium">
                <DollarSign size={11} />{totalGapUpsell.toLocaleString()} total upsell potential
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500">Sort:</span>
          {(['overall', 'name', 'gap'] as SortMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setSort(m)}
              className={`px-2.5 py-1 rounded-md font-semibold transition-colors ${
                sort === m ? 'bg-primary text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {m === 'overall' ? 'Coverage %' : m === 'name' ? 'Name' : 'Biggest gap'}
            </button>
          ))}
        </div>
      </div>

      {/* Matrix */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-slate-700 sticky left-0 bg-slate-50 z-10 min-w-[180px]">
                Account
              </th>
              <th className="text-center px-2 py-2 font-semibold text-slate-700 min-w-[70px]">Overall</th>
              {clouds.map((c) => (
                <th key={c} className="text-center px-2 py-2 font-semibold text-slate-700 min-w-[80px] whitespace-nowrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.account.id} className="hover:bg-slate-50/60">
                <td className="px-3 py-2 sticky left-0 bg-white hover:bg-slate-50/60">
                  <button
                    type="button"
                    onClick={() => onAccountClick?.(r.account.id)}
                    className="text-left group"
                  >
                    <div className="text-sm font-semibold text-slate-900 group-hover:text-primary">
                      {r.account.name}
                    </div>
                    <div className="text-[10px] text-slate-500 flex items-center gap-1">
                      {r.account.industry ? (
                        <span className="bg-sky-50 text-sky-700 px-1.5 py-0.5 rounded font-medium">{r.account.industry}</span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-amber-600" title="No industry set — score uses universal features only">
                          <AlertCircle size={9} /> no industry
                        </span>
                      )}
                      {r.upsell > 0 && (
                        <span className="text-amber-700 font-medium">· ${r.upsell.toLocaleString()} upsell</span>
                      )}
                    </div>
                  </button>
                </td>
                {/* Overall cell */}
                <td className="text-center px-2 py-2">
                  <div className={`inline-flex flex-col items-center justify-center rounded border px-2 py-1 min-w-[60px] ${coverageCellColor(r.overallPct)}`}>
                    <span className="text-sm font-bold tabular-nums">{r.overallPct}%</span>
                    <span className="text-[9px] font-medium opacity-80">{r.totalImpl}/{r.totalRelevant}</span>
                  </div>
                </td>
                {/* Cloud cells */}
                {clouds.map((c) => {
                  const score = r.scoreByCloud.get(c);
                  if (!score || score.total === 0) {
                    return <td key={c} className="text-center px-2 py-2 text-[10px] text-slate-300">—</td>;
                  }
                  return (
                    <td key={c} className="text-center px-2 py-2">
                      <button
                        type="button"
                        onClick={() => setDrilldown({ accountId: r.account.id, cloud: c })}
                        className={`inline-flex flex-col items-center rounded border px-2 py-1 min-w-[60px] hover:opacity-80 transition-opacity ${coverageCellColor(score.pct)}`}
                        title={`Click to see the ${score.total - score.implemented} unimplemented ${c} features for ${r.account.name}`}
                      >
                        <span className="text-xs font-bold tabular-nums">{score.pct}%</span>
                        <span className="text-[9px] font-medium opacity-80">{score.implemented}/{score.total}</span>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Drill-down modal */}
      {drilldown && drilldownRow && drilldownScore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDrilldown(null)}>
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
              <div>
                <div className="text-sm font-bold text-slate-900">
                  {drilldown.cloud} — {drilldownRow.account.name}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {drilldownScore.implemented} of {drilldownScore.total} implemented ({drilldownScore.pct}%)
                  {drilldownRow.account.industry && ` · filtered to ${drilldownRow.account.industry}`}
                  {drilldownGapUpsell > 0 && (
                    <span className="ml-2 inline-flex items-center gap-0.5 text-amber-700 font-medium">
                      <DollarSign size={10} />{drilldownGapUpsell.toLocaleString()} potential upsell
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setDrilldown(null)} className="text-slate-400 hover:text-slate-700 p-1">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {drilldownGap.length === 0 ? (
                <div className="text-sm text-slate-500 text-center py-8 flex flex-col items-center gap-2">
                  <Sparkles size={20} className="text-emerald-500" />
                  All relevant {drilldown.cloud} features are implemented for {drilldownRow.account.name}.
                </div>
              ) : (
                <>
                  <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                    Not implemented — potential upsell
                  </div>
                  <div className="space-y-2">
                    {drilldownGap
                      .sort((a, b) => b.upsellHint - a.upsellHint)
                      .map((entry) => (
                        <div key={entry.id} className="rounded-md border border-slate-200 px-3 py-2 hover:border-sky-300 transition-colors">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900 truncate">{entry.name}</div>
                              {entry.category && (
                                <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-0.5">
                                  {entry.category}
                                </div>
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
                                <span
                                  key={i}
                                  className={`text-[9px] px-1.5 py-0.5 rounded ${
                                    i === drilldownRow.account.industry
                                      ? 'bg-sky-100 text-sky-800 font-semibold'
                                      : 'bg-slate-100 text-slate-600'
                                  }`}
                                >
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

              {drilldownScore.implemented > 0 && (
                <>
                  <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider pt-3 border-t border-slate-100">
                    Already implemented
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {drilldownScore.entries.filter((e) => isImplemented(e, drilldownRow.features)).map((entry) => (
                      <span
                        key={entry.id}
                        className="text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded"
                      >
                        ✓ {entry.name}
                      </span>
                    ))}
                  </div>
                </>
              )}

              {onAccountClick && (
                <div className="pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setDrilldown(null);
                      onAccountClick(drilldownRow.account.id);
                    }}
                    className="text-xs font-semibold text-primary hover:text-primary/80 underline underline-offset-2"
                  >
                    Open {drilldownRow.account.name}'s account drawer →
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
