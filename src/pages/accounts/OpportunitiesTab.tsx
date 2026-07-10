/**
 * Cross-sell / Upsell Opportunities tab on an Account.
 *
 * Inline-edit table. Schema: account_opportunities(id, account_id, opp_type
 * (cross_sell|upsell), title, description, value_estimate, owner_email,
 * status (identified|pursuing|proposed|won|lost|paused), target_date, notes,
 * timestamps).
 */
import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Loader2, TrendingUp, Calendar } from 'lucide-react';
import { nanoid } from 'nanoid';
import { supabase, CLIENT_ID } from '../../lib/supabase';
import { SalesforceIntegrationBar } from './SalesforceIntegrationBar';

type OppType = 'cross_sell' | 'upsell';
type OppStatus = 'identified' | 'pursuing' | 'proposed' | 'won' | 'lost' | 'paused';

interface Opportunity {
  id: string;
  accountId: string;
  oppType: OppType;
  title: string;
  description: string;
  valueEstimate: string;
  ownerEmail: string | null;
  status: OppStatus;
  targetDate: string | null;
  notes: string;
  source: 'manual' | 'salesforce';
  salesforceId: string | null;
  stageName: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_STYLES: Record<OppStatus, string> = {
  identified: 'bg-slate-100 text-slate-700',
  pursuing:   'bg-sky-100 text-sky-700',
  proposed:   'bg-amber-100 text-amber-800',
  won:        'bg-emerald-100 text-emerald-800',
  lost:       'bg-red-100 text-red-700',
  paused:     'bg-slate-200 text-slate-500',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowTo(row: any): Opportunity {
  return {
    id: row.id,
    accountId: row.account_id,
    oppType: (row.opp_type === 'cross_sell' ? 'cross_sell' : 'upsell') as OppType,
    title: row.title ?? '',
    description: row.description ?? '',
    valueEstimate: row.value_estimate ?? '',
    ownerEmail: row.owner_email ?? null,
    status: (row.status ?? 'identified') as OppStatus,
    targetDate: row.target_date ?? null,
    notes: row.notes ?? '',
    source: (row.source === 'salesforce' ? 'salesforce' : 'manual'),
    salesforceId: row.salesforce_id ?? null,
    stageName: row.stage_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(o: Opportunity) {
  return {
    id: o.id,
    account_id: o.accountId,
    opp_type: o.oppType,
    title: o.title,
    description: o.description || '',
    value_estimate: o.valueEstimate || '',
    owner_email: o.ownerEmail || null,
    status: o.status,
    target_date: o.targetDate || null,
    notes: o.notes || '',
    updated_by: CLIENT_ID,
    updated_at: new Date().toISOString(),
  };
}

export function OpportunitiesTab({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [rows, setRows] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('account_opportunities')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true });
    if (e) { setError(e.message); setLoading(false); return; }
    setRows((data ?? []).map(rowTo));
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const ch = supabase
      .channel(`opps-${accountId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'account_opportunities', filter: `account_id=eq.${accountId}` },
        () => { void refresh(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [accountId, refresh]);

  const setSaving = (id: string, on: boolean) =>
    setSavingIds((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const save = async (o: Opportunity) => {
    setSaving(o.id, true);
    const { error: e } = await supabase.from('account_opportunities').upsert(toRow(o), { onConflict: 'id' });
    setSaving(o.id, false);
    if (e) setError(e.message);
  };
  const patch = (id: string, p: Partial<Opportunity>) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const addBlank = () => {
    const now = new Date().toISOString();
    setRows((r) => [...r, {
      id: nanoid(), accountId, oppType: 'upsell', title: '', description: '',
      valueEstimate: '', ownerEmail: null, status: 'identified', targetDate: null,
      notes: '', source: 'manual', salesforceId: null, stageName: null,
      createdAt: now, updatedAt: now,
    }]);
  };
  const remove = async (id: string) => {
    setRows((r) => r.filter((x) => x.id !== id));
    const { error: e } = await supabase.from('account_opportunities').delete().eq('id', id);
    if (e) setError(e.message);
  };

  if (loading) return (
    <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
      <Loader2 size={14} className="animate-spin" /> Loading opportunities…
    </div>
  );

  return (
    <div className="space-y-3">
      <SalesforceIntegrationBar accountId={accountId} accountName={accountName} onSynced={refresh} />
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-500">
          Cross-sell &amp; upsell opportunities we&apos;ve identified for this account. Track them from <em>identified</em> → <em>won</em> here.
        </div>
        <button type="button" onClick={addBlank}
                className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 inline-flex items-center gap-1">
          <Plus size={12} /> Add opportunity
        </button>
      </div>
      {error && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">{error}</div>}
      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
          No opportunities yet. Click <strong>+ Add opportunity</strong> to record one.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Title</th>
                <th className="px-3 py-2 font-semibold">Value</th>
                <th className="px-3 py-2 font-semibold">Owner</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Target</th>
                <th className="px-3 py-2 font-semibold w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((o) => {
                const saving = savingIds.has(o.id);
                const blur = () => { if (o.title.trim()) void save(o); };
                return (
                  <tr key={o.id} className="hover:bg-slate-50/60 align-top">
                    <td className="px-2 py-1.5">
                      <select value={o.oppType}
                              onChange={(e) => { const v = e.target.value as OppType; patch(o.id, { oppType: v }); if (o.title.trim()) void save({ ...o, oppType: v }); }}
                              className="text-[11px] px-1.5 py-1 border border-slate-200 rounded bg-white">
                        <option value="upsell">Upsell</option>
                        <option value="cross_sell">Cross-sell</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5 min-w-[200px]">
                      <div className="flex items-center gap-1.5">
                        {o.source === 'salesforce' && (
                          <span
                            className="flex-shrink-0 text-[8px] font-bold uppercase tracking-wider bg-sky-100 text-sky-700 px-1 py-0.5 rounded"
                            title={`Salesforce Opportunity${o.stageName ? ` · Stage: ${o.stageName}` : ''} · Edits will be overwritten on next sync`}
                          >
                            SF
                          </span>
                        )}
                        <input value={o.title}
                               onChange={(e) => patch(o.id, { title: e.target.value })}
                               onBlur={blur}
                               placeholder="Title *"
                               readOnly={o.source === 'salesforce'}
                               title={o.source === 'salesforce' ? 'Synced from Salesforce — edit in SF instead' : undefined}
                               className={`w-full h-7 px-2 text-xs leading-tight border border-transparent rounded ${
                                 o.source === 'salesforce'
                                   ? 'bg-sky-50/40 text-slate-700 cursor-not-allowed'
                                   : 'hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30'
                               }`} />
                      </div>
                      {(o.description || o.notes) && (
                        <textarea value={o.description}
                                  onChange={(e) => patch(o.id, { description: e.target.value })}
                                  onBlur={blur}
                                  placeholder="Description / notes"
                                  rows={2}
                                  className="w-full mt-1 text-[11px] text-slate-600 border border-slate-200 rounded px-2 py-1 resize-y" />
                      )}
                      {!o.description && (
                        <input value={o.description}
                               onChange={(e) => patch(o.id, { description: e.target.value })}
                               onBlur={blur}
                               placeholder="+ notes…"
                               className="w-full mt-1 text-[11px] text-slate-500 border border-transparent hover:border-slate-300 focus:border-primary focus:outline-none rounded px-2 py-1" />
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={o.valueEstimate}
                             onChange={(e) => patch(o.id, { valueEstimate: e.target.value })}
                             onBlur={blur}
                             placeholder="$50k / 6 mo"
                             className="w-[110px] h-7 px-2 text-xs border border-transparent hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rounded" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input value={o.ownerEmail ?? ''}
                             onChange={(e) => patch(o.id, { ownerEmail: e.target.value.toLowerCase() || null })}
                             onBlur={blur}
                             placeholder="owner@…"
                             className="w-[160px] h-7 px-2 text-xs border border-transparent hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rounded" />
                    </td>
                    <td className="px-2 py-1.5">
                      <select value={o.status}
                              onChange={(e) => { const s = e.target.value as OppStatus; patch(o.id, { status: s }); if (o.title.trim()) void save({ ...o, status: s }); }}
                              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full border-0 cursor-pointer ${STATUS_STYLES[o.status]}`}>
                        <option value="identified">Identified</option>
                        <option value="pursuing">Pursuing</option>
                        <option value="proposed">Proposed</option>
                        <option value="won">Won</option>
                        <option value="lost">Lost</option>
                        <option value="paused">Paused</option>
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="inline-flex items-center gap-1">
                        <Calendar size={10} className="text-slate-400" />
                        <input type="date"
                               value={o.targetDate ?? ''}
                               onChange={(e) => patch(o.id, { targetDate: e.target.value || null })}
                               onBlur={blur}
                               className="w-[130px] h-7 px-1.5 text-[11px] border border-slate-200 rounded bg-white" />
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {saving ? <Loader2 size={12} className="animate-spin text-slate-400 inline" /> : (
                        <button type="button"
                                onClick={() => { if (confirm(`Remove "${o.title || 'this opportunity'}"?`)) void remove(o.id); }}
                                className="text-slate-300 hover:text-red-600 p-1 rounded hover:bg-red-50">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="text-[10px] text-slate-400 italic flex items-center gap-1">
        <TrendingUp size={10} /> Rows commit on blur. Status + Type changes save immediately.
      </div>
    </div>
  );
}
