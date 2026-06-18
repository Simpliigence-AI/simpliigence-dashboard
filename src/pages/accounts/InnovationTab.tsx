/**
 * Innovation Highlights tab on an Account.
 *
 * Self-contained: direct supabase fetch + realtime + inline-edit.
 * Schema: account_innovations(id, account_id, title, description, impact,
 * dated_at, created_at, updated_at, updated_by).
 */
import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Loader2, Lightbulb, Calendar } from 'lucide-react';
import { nanoid } from 'nanoid';
import { supabase, CLIENT_ID } from '../../lib/supabase';

interface AccountInnovation {
  id: string;
  accountId: string;
  title: string;
  description: string;
  impact: string;
  datedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowTo(row: any): AccountInnovation {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title ?? '',
    description: row.description ?? '',
    impact: row.impact ?? '',
    datedAt: row.dated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(i: AccountInnovation) {
  return {
    id: i.id,
    account_id: i.accountId,
    title: i.title,
    description: i.description || '',
    impact: i.impact || '',
    dated_at: i.datedAt || null,
    updated_by: CLIENT_ID,
    updated_at: new Date().toISOString(),
  };
}

export function InnovationTab({ accountId }: { accountId: string }) {
  const [rows, setRows] = useState<AccountInnovation[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('account_innovations')
      .select('*')
      .eq('account_id', accountId)
      .order('dated_at', { ascending: false, nullsFirst: false });
    if (e) { setError(e.message); setLoading(false); return; }
    setRows((data ?? []).map(rowTo));
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const ch = supabase
      .channel(`innov-${accountId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'account_innovations', filter: `account_id=eq.${accountId}` },
        () => { void refresh(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [accountId, refresh]);

  const setSaving = (id: string, on: boolean) => {
    setSavingIds((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  };
  const save = async (i: AccountInnovation) => {
    setSaving(i.id, true);
    const { error: e } = await supabase.from('account_innovations').upsert(toRow(i), { onConflict: 'id' });
    setSaving(i.id, false);
    if (e) setError(e.message);
  };
  const patch = (id: string, p: Partial<AccountInnovation>) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const addBlank = () => {
    const now = new Date().toISOString();
    setRows((r) => [...r, {
      id: nanoid(), accountId, title: '', description: '', impact: '',
      datedAt: now.slice(0, 10), createdAt: now, updatedAt: now,
    }]);
  };
  const remove = async (id: string) => {
    setRows((r) => r.filter((x) => x.id !== id));
    const { error: e } = await supabase.from('account_innovations').delete().eq('id', id);
    if (e) setError(e.message);
  };

  if (loading) return (
    <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
      <Loader2 size={14} className="animate-spin" /> Loading innovations…
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-500">
          Innovative things we&apos;ve built, proposed, or delivered for this account. Use to remember wins worth talking about in QBRs and renewals.
        </div>
        <button type="button" onClick={addBlank}
                className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 inline-flex items-center gap-1">
          <Plus size={12} /> Add innovation
        </button>
      </div>
      {error && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">{error}</div>}
      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
          No innovation highlights yet. Click <strong>+ Add innovation</strong> to record one.
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((x) => {
            const saving = savingIds.has(x.id);
            const blur = () => { if (x.title.trim()) void save(x); };
            return (
              <li key={x.id} className="rounded-lg border border-slate-200 bg-white p-3 hover:border-amber-200 transition-colors">
                <div className="flex items-start gap-3">
                  <Lightbulb size={16} className="text-amber-500 flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0 space-y-2">
                    <input
                      value={x.title}
                      onChange={(e) => patch(x.id, { title: e.target.value })}
                      onBlur={blur}
                      placeholder="Title *"
                      className="w-full text-sm font-semibold text-slate-900 border border-transparent hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rounded px-2 py-1"
                    />
                    <textarea
                      value={x.description}
                      onChange={(e) => patch(x.id, { description: e.target.value })}
                      onBlur={blur}
                      placeholder="What was the innovation? (technical approach, novel solution, automation, etc.)"
                      rows={2}
                      className="w-full text-xs text-slate-700 border border-slate-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rounded px-2 py-1.5 resize-y"
                    />
                    <textarea
                      value={x.impact}
                      onChange={(e) => patch(x.id, { impact: e.target.value })}
                      onBlur={blur}
                      placeholder="Impact — savings, speed, NPS, story-worthy outcome…"
                      rows={2}
                      className="w-full text-xs text-slate-700 border border-slate-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rounded px-2 py-1.5 resize-y"
                    />
                    <div className="flex items-center gap-2">
                      <Calendar size={11} className="text-slate-400" />
                      <input type="date"
                             value={x.datedAt ?? ''}
                             onChange={(e) => patch(x.id, { datedAt: e.target.value || null })}
                             onBlur={blur}
                             className="text-[11px] px-2 py-1 border border-slate-200 rounded" />
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {saving ? <Loader2 size={12} className="animate-spin text-slate-400" /> : (
                      <button type="button"
                              onClick={() => { if (confirm(`Remove "${x.title || 'this innovation'}"?`)) void remove(x.id); }}
                              className="text-slate-300 hover:text-red-600 p-1 rounded hover:bg-red-50"
                              title="Remove">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
