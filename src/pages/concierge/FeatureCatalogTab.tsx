/**
 * Feature Catalog top-level tab on the Concierge page.
 *
 * Browsable view of the master sf_feature_catalog: filter by cloud +
 * industry + text search. Shows the total count per cloud (scoped to the
 * industry filter) so a TA / delivery lead can quickly see "how many
 * Health Cloud features apply to Healthcare accounts?" or "what's in
 * OmniStudio for Insurance?".
 */
import { useMemo, useState } from 'react';
import { Search, Sparkles, DollarSign, Loader2, RefreshCw } from 'lucide-react';
import { CATALOG_INDUSTRIES } from '../../types/concierge';
import { useFeatureCatalogStore } from '../../store/useFeatureCatalogStore';

export function FeatureCatalogTab() {
  const { entries, loading, loadedAt, load } = useFeatureCatalogStore();
  const [q, setQ] = useState('');
  const [cloud, setCloud] = useState<string>('');
  const [industry, setIndustry] = useState<string>('');

  const clouds = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.cloud);
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((e) => {
      if (cloud && e.cloud !== cloud) return false;
      if (industry && e.industriesRelevant.length > 0 && !e.industriesRelevant.includes(industry)) return false;
      if (needle) {
        const hay = `${e.name} ${e.description || ''} ${e.cloud} ${e.category || ''} ${e.licenseTier || ''} ${e.industriesRelevant.join(' ')}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [entries, q, cloud, industry]);

  // Group filtered by cloud for display
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const e of filtered) {
      if (!map.has(e.cloud)) map.set(e.cloud, []);
      map.get(e.cloud)!.push(e);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  const totalUpsell = filtered.reduce((s, e) => s + e.upsellHint, 0);

  return (
    <div className="space-y-4">
      {/* Header + filters */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-slate-900">Salesforce Feature Catalog</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {entries.length} features across {clouds.length} clouds · showing {filtered.length}
            {industry && ` · ${industry} lens`}
            {loadedAt && <> · loaded {new Date(loadedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="text-xs font-semibold inline-flex items-center gap-1.5 bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-md hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search features…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <select
          value={cloud}
          onChange={(e) => setCloud(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">All clouds</option>
          {clouds.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={industry}
          onChange={(e) => setIndustry(e.target.value)}
          className="px-3 py-2 text-sm border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          title="Show only features relevant to this industry (universal features always included)"
        >
          <option value="">All industries</option>
          {CATALOG_INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>

      {/* Summary chip */}
      {totalUpsell > 0 && (
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-amber-50 border border-amber-200 text-amber-800 px-3 py-1.5 rounded-full">
          <DollarSign size={12} />
          Total upsell potential across shown features: ${totalUpsell.toLocaleString()}
        </div>
      )}

      {/* Grouped list */}
      {entries.length === 0 && loading && (
        <div className="text-sm text-slate-500 text-center py-12 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading catalog…
        </div>
      )}
      {entries.length === 0 && !loading && (
        <div className="text-sm text-slate-500 text-center py-12 border border-dashed border-slate-200 rounded-lg">
          <Sparkles size={20} className="mx-auto mb-2 text-slate-300" />
          Catalog is empty. Run <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">seed-feature-catalog</code> to populate it.
        </div>
      )}
      {entries.length > 0 && filtered.length === 0 && (
        <div className="text-sm text-slate-500 text-center py-8 border border-dashed border-slate-200 rounded-lg">
          No features match your filters.
        </div>
      )}

      <div className="space-y-4">
        {grouped.map(([cloudName, list]) => (
          <div key={cloudName} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
            <div className="bg-gradient-to-r from-sky-50 to-blue-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">{cloudName}</h3>
              <span className="text-[11px] font-semibold text-slate-600">{list.length} features</span>
            </div>
            <div className="divide-y divide-slate-100">
              {list.map((entry) => (
                <div key={entry.id} className="px-4 py-2.5 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-slate-900">{entry.name}</div>
                      {entry.description && (
                        <div className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">{entry.description}</div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1 items-center">
                        {entry.category && (
                          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{entry.category}</span>
                        )}
                        {entry.industriesRelevant.length === 0 ? (
                          <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Universal</span>
                        ) : (
                          entry.industriesRelevant.slice(0, 4).map((i) => (
                            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded ${i === industry ? 'bg-sky-200 text-sky-900 font-semibold' : 'bg-sky-50 text-sky-700'}`}>
                              {i}
                            </span>
                          ))
                        )}
                        {entry.industriesRelevant.length > 4 && (
                          <span className="text-[10px] text-slate-400">+{entry.industriesRelevant.length - 4}</span>
                        )}
                        {entry.licenseTier && (
                          <span className="text-[10px] font-semibold bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded">Req: {entry.licenseTier}</span>
                        )}
                      </div>
                    </div>
                    {entry.upsellHint > 0 && (
                      <span className="flex-shrink-0 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                        ~${entry.upsellHint.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
