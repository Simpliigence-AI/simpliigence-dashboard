/**
 * Account Info tab on an Account.
 *
 * Renders ZoomInfo-sourced data for the account: company URL, profile,
 * recent scoops, recent news, key C-suite + contacts.
 *
 * Data is cached in Supabase (account_research table) so opens are
 * instant after first fetch. The Refresh button triggers the
 * `account-research` edge function which calls the ZoomInfo REST API
 * and updates the cached row.
 *
 * Until ZoomInfo API credentials are configured on the edge function,
 * the cached data may be seeded manually (or via Claude MCP) and the
 * refresh button will return a friendly "credentials not set" message.
 */
import { useEffect, useState, useCallback } from 'react';
import {
  Loader2, RefreshCw, ExternalLink, Newspaper, Sparkles, Users,
  MapPin, Briefcase, AlertTriangle, Linkedin, Mail,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { Account } from '../../types/accountMgmt';

interface KeyPerson {
  name?: string;
  title?: string;
  email?: string;
  linkedin?: string;
  seniority?: string;
}
interface ScoopItem {
  topic?: string;
  date?: string;
  summary?: string;
  source?: string;
}
interface NewsItem {
  title?: string;
  date?: string;
  url?: string;
  summary?: string;
  source?: string;
}
interface ZIData {
  legal_name?: string;
  description?: string;
  industry?: string;
  hq_location?: string;
  employee_count?: number | string;
  revenue?: string;
  founded?: number | string;
  // anything else ZoomInfo returns — render generically below
  [key: string]: unknown;
}
interface ResearchRow {
  accountId: string;
  source: string;
  websiteUrl: string | null;
  ziData: ZIData;
  scoops: ScoopItem[];
  news: NewsItem[];
  keyPeople: KeyPerson[];
  fetchedAt: string | null;
  refreshedAt: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowTo(row: any): ResearchRow | null {
  if (!row) return null;
  return {
    accountId: row.account_id,
    source: row.source ?? 'zoominfo',
    websiteUrl: row.website_url ?? null,
    ziData: (row.zi_data && typeof row.zi_data === 'object' ? row.zi_data : {}) as ZIData,
    scoops: Array.isArray(row.scoops) ? row.scoops : [],
    news: Array.isArray(row.news) ? row.news : [],
    keyPeople: Array.isArray(row.key_people) ? row.key_people : [],
    fetchedAt: row.fetched_at ?? null,
    refreshedAt: row.refreshed_at ?? null,
  };
}

export function AccountInfoTab({ account }: { account: Account }) {
  const [data, setData] = useState<ResearchRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: row, error: e } = await supabase
      .from('account_research')
      .select('*')
      .eq('account_id', account.id)
      .maybeSingle();
    if (e && e.code !== 'PGRST116') { setError(e.message); setLoading(false); return; }
    setData(rowTo(row));
    setLoading(false);
  }, [account.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const ch = supabase
      .channel(`research-${account.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'account_research', filter: `account_id=eq.${account.id}` },
        () => { void refresh(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [account.id, refresh]);

  const triggerRefresh = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const { data: res, error: e } = await supabase.functions.invoke<{
        ok?: boolean; error?: string; message?: string;
      }>('account-research', {
        body: { accountId: account.id, accountName: account.name },
      });
      if (e) {
        setRefreshMsg(`Refresh failed: ${e.message}`);
      } else if (res?.ok === false) {
        setRefreshMsg(res.error || res.message || 'Refresh returned no data');
      } else {
        setRefreshMsg('Refresh requested. Data will appear once Claude / ZoomInfo finishes.');
        await refresh();
      }
    } catch (err) {
      setRefreshMsg(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return (
    <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
      <Loader2 size={14} className="animate-spin" /> Loading account info…
    </div>
  );

  // ── Empty state ────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center">
          <Sparkles size={20} className="text-violet-400 mx-auto mb-2" />
          <div className="text-sm font-semibold text-slate-800 mb-1">No research cached yet</div>
          <div className="text-xs text-slate-500 mb-3">
            Click <strong>Refresh from ZoomInfo</strong> to pull company profile, scoops, news, and key contacts.
          </div>
          <button type="button" onClick={triggerRefresh} disabled={refreshing}
                  className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 inline-flex items-center gap-1 disabled:opacity-50">
            {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {refreshing ? 'Fetching…' : 'Refresh from ZoomInfo'}
          </button>
          {refreshMsg && (
            <div className="mt-3 text-[11px] text-amber-700 inline-flex items-center gap-1">
              <AlertTriangle size={11} /> {refreshMsg}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header — name, link, refresh */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Briefcase size={15} className="text-slate-500 flex-shrink-0" />
          <h3 className="text-sm font-bold text-slate-900">{data.ziData.legal_name || account.name}</h3>
          {data.websiteUrl && (
            <a href={data.websiteUrl} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-xs text-sky-700 hover:underline">
              {data.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')} <ExternalLink size={11} />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {data.refreshedAt && (
            <span className="text-[10px] text-slate-400">
              Updated {new Date(data.refreshedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
          <button type="button" onClick={triggerRefresh} disabled={refreshing}
                  className="text-[11px] font-semibold text-slate-700 hover:bg-slate-100 px-2 py-1 rounded inline-flex items-center gap-1 disabled:opacity-50">
            {refreshing ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {refreshMsg && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-800 inline-flex items-center gap-1">
          <AlertTriangle size={11} /> {refreshMsg}
        </div>
      )}
      {error && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">{error}</div>}

      {/* Profile facts */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Company profile</div>
        {data.ziData.description && (
          <p className="text-xs text-slate-700 mb-3 leading-relaxed">{String(data.ziData.description)}</p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
          {data.ziData.industry && <Fact label="Industry" value={String(data.ziData.industry)} icon={<Briefcase size={11} />} />}
          {data.ziData.hq_location && <Fact label="HQ" value={String(data.ziData.hq_location)} icon={<MapPin size={11} />} />}
          {data.ziData.employee_count && <Fact label="Employees" value={String(data.ziData.employee_count)} icon={<Users size={11} />} />}
          {data.ziData.revenue && <Fact label="Revenue" value={String(data.ziData.revenue)} />}
          {data.ziData.founded && <Fact label="Founded" value={String(data.ziData.founded)} />}
        </div>
      </div>

      {/* Key people */}
      {data.keyPeople.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 inline-flex items-center gap-1">
            <Users size={11} /> Key people ({data.keyPeople.length})
          </div>
          <ul className="space-y-2">
            {data.keyPeople.map((p, i) => (
              <li key={i} className="text-xs flex items-baseline gap-2 flex-wrap">
                <span className="font-semibold text-slate-900">{p.name || '—'}</span>
                {p.title && <span className="text-slate-500">{p.title}</span>}
                {p.seniority && <span className="text-[10px] uppercase tracking-wider text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">{p.seniority}</span>}
                {p.email && (
                  <a href={`mailto:${p.email}`} className="text-sky-600 hover:underline inline-flex items-center gap-0.5">
                    <Mail size={10} /> {p.email}
                  </a>
                )}
                {p.linkedin && (
                  <a href={p.linkedin} target="_blank" rel="noopener noreferrer"
                     className="text-sky-700 hover:underline inline-flex items-center gap-0.5">
                    <Linkedin size={10} /> LinkedIn
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Scoops */}
      {data.scoops.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 inline-flex items-center gap-1">
            <Sparkles size={11} className="text-amber-500" /> Recent scoops ({data.scoops.length})
          </div>
          <ul className="space-y-2">
            {data.scoops.map((s, i) => (
              <li key={i} className="text-xs flex items-baseline gap-2 flex-wrap">
                {s.date && <span className="text-[10px] tabular-nums text-slate-400 flex-shrink-0">{s.date}</span>}
                {s.topic && <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">{s.topic}</span>}
                <span className="text-slate-700 flex-1 min-w-0">{s.summary || '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* News */}
      {data.news.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 inline-flex items-center gap-1">
            <Newspaper size={11} className="text-sky-500" /> Recent news ({data.news.length})
          </div>
          <ul className="space-y-2">
            {data.news.map((n, i) => (
              <li key={i} className="text-xs flex items-baseline gap-2 flex-wrap">
                {n.date && <span className="text-[10px] tabular-nums text-slate-400 flex-shrink-0">{n.date}</span>}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900">
                    {n.url ? (
                      <a href={n.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {n.title || n.url} <ExternalLink size={10} className="inline -mt-0.5" />
                      </a>
                    ) : (
                      n.title || '—'
                    )}
                  </div>
                  {n.summary && <div className="text-[11px] text-slate-600 mt-0.5">{n.summary}</div>}
                  {n.source && <div className="text-[10px] text-slate-400 mt-0.5">{n.source}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider inline-flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="text-xs text-slate-800 mt-0.5">{value}</div>
    </div>
  );
}
