/**
 * Salesforce integration control bar.
 *
 * Rendered at the top of both ClientContactsTab and OpportunitiesTab. Shows
 * one of three states:
 *   1. Not linked → "Match to Salesforce" button (invokes AI matcher)
 *   2. Linked   → "SF: [Name] · confidence · last synced · Refresh · Unlink"
 *   3. Working  → matching or syncing spinner
 *
 * On successful match, immediately auto-fires a sync so the tab populates
 * without an extra click.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Link2, Link2Off, Sparkles, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface SalesforceLink {
  dashboard_account_id: string;
  sf_account_id: string;
  sf_account_name: string;
  confidence: number;
  match_method: 'exact' | 'fuzzy_name' | 'ai_signals' | 'manual_override';
  match_reasoning: string | null;
  last_synced_at: string | null;
  last_sync_status: string;
  last_sync_error: string | null;
}

interface Props {
  accountId: string;
  accountName: string;
  /** Called after a successful sync so the parent can refetch its rows. */
  onSynced?: () => void;
}

export function SalesforceIntegrationBar({ accountId, accountName, onSynced }: Props) {
  const [link, setLink] = useState<SalesforceLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchPreview, setMatchPreview] = useState<{
    sfAccountId: string | null;
    sfAccountName: string | null;
    confidence: number;
    reasoning: string;
    alternatives: Array<{ id: string; name: string; confidence: number; note: string }>;
  } | null>(null);

  // Fetch the link on mount + whenever accountId changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('salesforce_account_link')
        .select('*')
        .eq('dashboard_account_id', accountId)
        .maybeSingle();
      if (!cancelled) {
        setLink(data as SalesforceLink | null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  const refreshLink = useCallback(async () => {
    const { data } = await supabase
      .from('salesforce_account_link')
      .select('*')
      .eq('dashboard_account_id', accountId)
      .maybeSingle();
    setLink(data as SalesforceLink | null);
  }, [accountId]);

  const doMatch = useCallback(async () => {
    setMatching(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke<{
        ok?: boolean;
        sfAccountId?: string | null;
        sfAccountName?: string | null;
        confidence?: number;
        reasoning?: string;
        alternatives?: Array<{ id: string; name: string; confidence: number; note: string }>;
        error?: string;
        hint?: string;
      }>('salesforce-match-account', {
        body: { dashboardAccountId: accountId, dashboardAccountName: accountName },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(`${data.error}${data.hint ? ` — ${data.hint}` : ''}`);
      if (!data?.sfAccountId || (data.confidence ?? 0) < 0.4) {
        setMatchPreview({
          sfAccountId: null,
          sfAccountName: null,
          confidence: data?.confidence ?? 0,
          reasoning: data?.reasoning || 'No confident match found in Salesforce.',
          alternatives: data?.alternatives || [],
        });
        return;
      }
      // Confident match — link was already saved server-side, refresh + auto-sync
      await refreshLink();
      await doSync();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setMatching(false);
    }
  }, [accountId, accountName, refreshLink]);

  const doSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke<{
        ok?: boolean;
        contacts?: { upserted: number; pruned: number; total: number };
        opportunities?: { upserted: number; pruned: number; total: number };
        error?: string;
      }>('salesforce-sync-account', {
        body: { dashboardAccountId: accountId },
      });
      if (fnErr) throw fnErr;
      if (data?.error) throw new Error(data.error);
      onSynced?.();
      await refreshLink();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }, [accountId, onSynced, refreshLink]);

  const doUnlink = useCallback(async () => {
    if (!confirm(`Disconnect this account from Salesforce?\n\nExisting SF-sourced contacts and opportunities will remain but will not update. Your manually-added rows are unaffected.`)) return;
    await supabase.from('salesforce_account_link').delete().eq('dashboard_account_id', accountId);
    setLink(null);
  }, [accountId]);

  if (loading) {
    return <div className="text-[11px] text-slate-400 py-1">Checking Salesforce link…</div>;
  }

  // ── State: not linked → offer to match ──
  if (!link) {
    return (
      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Link2Off size={14} className="text-slate-400" />
            <span>Not linked to Salesforce</span>
          </div>
          <button
            type="button"
            onClick={doMatch}
            disabled={matching}
            className="text-xs font-semibold inline-flex items-center gap-1.5 bg-gradient-to-r from-sky-500 to-blue-600 text-white px-3 py-1.5 rounded-md hover:from-sky-600 hover:to-blue-700 disabled:opacity-50"
          >
            {matching ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {matching ? 'Matching…' : 'Match to Salesforce'}
          </button>
        </div>
        {matchPreview && matchPreview.sfAccountId === null && (
          <div className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            <div className="flex items-start gap-1.5">
              <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold">No confident match ({Math.round(matchPreview.confidence * 100)}%).</div>
                <div className="text-amber-700 mt-0.5">{matchPreview.reasoning}</div>
                {matchPreview.alternatives.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    <div className="font-semibold text-slate-600">Possible candidates (click to force-link):</div>
                    {matchPreview.alternatives.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={async () => {
                          await supabase.from('salesforce_account_link').upsert({
                            dashboard_account_id: accountId,
                            sf_account_id: a.id,
                            sf_account_name: a.name,
                            confidence: a.confidence,
                            match_method: 'manual_override',
                            match_reasoning: a.note,
                            linked_at: new Date().toISOString(),
                          });
                          await refreshLink();
                          await doSync();
                          setMatchPreview(null);
                        }}
                        className="block w-full text-left text-[11px] px-1.5 py-0.5 rounded hover:bg-amber-100"
                      >
                        <strong>{a.name}</strong> ({Math.round(a.confidence * 100)}%) — {a.note}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="mt-2 text-[11px] text-red-700 flex items-start gap-1">
            <AlertCircle size={12} className="mt-0.5" /> {error}
          </div>
        )}
      </div>
    );
  }

  // ── State: linked → show status + refresh/unlink ──
  const confidencePct = Math.round(link.confidence * 100);
  const confidenceColor = confidencePct >= 90 ? 'text-emerald-700 bg-emerald-100'
                       : confidencePct >= 70 ? 'text-sky-700 bg-sky-100'
                       : 'text-amber-700 bg-amber-100';
  const lastSynced = link.last_synced_at
    ? new Date(link.last_synced_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'never';

  return (
    <div className="mb-3 rounded-lg border border-sky-200 bg-gradient-to-r from-sky-50 to-blue-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-slate-700 min-w-0">
          <Link2 size={14} className="text-sky-600 flex-shrink-0" />
          <span className="font-semibold truncate">
            SF: {link.sf_account_name}
          </span>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${confidenceColor}`}>
            {confidencePct}% {link.match_method === 'manual_override' ? 'manual' : link.match_method === 'exact' ? 'exact' : 'ai match'}
          </span>
          <span className="text-slate-500 hidden sm:inline">·</span>
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            last synced {lastSynced}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={doSync}
            disabled={syncing}
            className="text-xs font-semibold inline-flex items-center gap-1.5 bg-white border border-sky-300 text-sky-700 px-2.5 py-1 rounded-md hover:bg-sky-100 disabled:opacity-50"
          >
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {syncing ? 'Syncing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={doUnlink}
            className="text-xs text-slate-500 hover:text-red-600 inline-flex items-center gap-1"
            title="Disconnect from Salesforce"
          >
            <Link2Off size={12} /> Unlink
          </button>
        </div>
      </div>
      {link.match_reasoning && link.match_method !== 'manual_override' && (
        <div className="mt-1 text-[10px] text-slate-500 italic pl-6">
          <CheckCircle2 size={9} className="inline mr-1 text-emerald-500" />
          {link.match_reasoning}
        </div>
      )}
      {link.last_sync_status === 'error' && link.last_sync_error && (
        <div className="mt-1 text-[11px] text-red-700 flex items-start gap-1 pl-6">
          <AlertCircle size={12} className="mt-0.5" /> Last sync failed: {link.last_sync_error}
        </div>
      )}
      {error && (
        <div className="mt-1 text-[11px] text-red-700 flex items-start gap-1 pl-6">
          <AlertCircle size={12} className="mt-0.5" /> {error}
        </div>
      )}
    </div>
  );
}
