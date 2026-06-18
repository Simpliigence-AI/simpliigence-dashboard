/**
 * CSAT tab on an Account.
 *
 * Single row per account. Tracks: survey done?, QBR done?, testimonial,
 * CSAT rating (1-5), notes. Schema: account_csat (account_id PK).
 */
import { useEffect, useState, useCallback } from 'react';
import { Loader2, Smile, ClipboardCheck, MessageSquareQuote, Star, Calendar } from 'lucide-react';
import { supabase, CLIENT_ID } from '../../lib/supabase';

interface CSAT {
  accountId: string;
  surveyDone: boolean;
  surveyAt: string | null;
  surveyScore: string;
  qbrDone: boolean;
  qbrAt: string | null;
  qbrNotes: string;
  testimonialText: string;
  testimonialAt: string | null;
  csatRating: number | null;
  notes: string;
}

const EMPTY = (accountId: string): CSAT => ({
  accountId,
  surveyDone: false,
  surveyAt: null,
  surveyScore: '',
  qbrDone: false,
  qbrAt: null,
  qbrNotes: '',
  testimonialText: '',
  testimonialAt: null,
  csatRating: null,
  notes: '',
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowTo(row: any, accountId: string): CSAT {
  if (!row) return EMPTY(accountId);
  return {
    accountId: row.account_id,
    surveyDone: !!row.survey_done,
    surveyAt: row.survey_at ?? null,
    surveyScore: row.survey_score == null ? '' : String(row.survey_score),
    qbrDone: !!row.qbr_done,
    qbrAt: row.qbr_at ?? null,
    qbrNotes: row.qbr_notes ?? '',
    testimonialText: row.testimonial_text ?? '',
    testimonialAt: row.testimonial_at ?? null,
    csatRating: row.csat_rating ?? null,
    notes: row.notes ?? '',
  };
}

function toRow(c: CSAT) {
  const scoreNum = c.surveyScore.trim() === '' ? null : Number(c.surveyScore);
  return {
    account_id: c.accountId,
    survey_done: c.surveyDone,
    survey_at: c.surveyAt || null,
    survey_score: Number.isFinite(scoreNum as number) ? scoreNum : null,
    qbr_done: c.qbrDone,
    qbr_at: c.qbrAt || null,
    qbr_notes: c.qbrNotes || '',
    testimonial_text: c.testimonialText || '',
    testimonial_at: c.testimonialAt || null,
    csat_rating: c.csatRating == null ? null : c.csatRating,
    notes: c.notes || '',
    updated_by: CLIENT_ID,
    updated_at: new Date().toISOString(),
  };
}

export function CSATTab({ accountId }: { accountId: string }) {
  const [state, setState] = useState<CSAT>(EMPTY(accountId));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('account_csat')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    if (e && e.code !== 'PGRST116') { setError(e.message); setLoading(false); return; }
    setState(rowTo(data, accountId));
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const ch = supabase
      .channel(`csat-${accountId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'account_csat', filter: `account_id=eq.${accountId}` },
        () => { void refresh(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [accountId, refresh]);

  const save = async (next: CSAT) => {
    setSaving(true);
    const { error: e } = await supabase.from('account_csat').upsert(toRow(next), { onConflict: 'account_id' });
    setSaving(false);
    if (e) setError(e.message);
  };
  const patch = (p: Partial<CSAT>) => setState((prev) => ({ ...prev, ...p }));
  const blur = () => { void save(state); };

  if (loading) return (
    <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
      <Loader2 size={14} className="animate-spin" /> Loading CSAT…
    </div>
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-500">
          Customer-satisfaction signals — survey, QBR, testimonial, rating.
        </div>
        {saving && <div className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Saving</div>}
      </div>
      {error && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">{error}</div>}

      {/* CSAT rating — emoji stars */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider inline-flex items-center gap-1 mb-2">
          <Smile size={11} className="text-emerald-500" /> CSAT rating (overall)
        </label>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = (state.csatRating ?? 0) >= n;
            return (
              <button key={n} type="button"
                      onClick={() => { const next = state.csatRating === n ? null : n; patch({ csatRating: next }); void save({ ...state, csatRating: next }); }}
                      className={`p-1 rounded transition-colors ${filled ? 'text-amber-400' : 'text-slate-300 hover:text-amber-300'}`}
                      title={`${n} of 5`}>
                <Star size={22} fill={filled ? 'currentColor' : 'none'} strokeWidth={1.5} />
              </button>
            );
          })}
          <span className="ml-2 text-xs text-slate-500">
            {state.csatRating ? `${state.csatRating}/5` : 'Not rated'}
          </span>
        </div>
      </div>

      {/* Survey */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-3">
          <ClipboardCheck size={14} className="text-sky-500" />
          <input type="checkbox" checked={state.surveyDone}
                 onChange={(e) => { const v = e.target.checked; patch({ surveyDone: v }); void save({ ...state, surveyDone: v }); }}
                 className="w-4 h-4" />
          Survey conducted
        </label>
        {state.surveyDone && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-6">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider inline-flex items-center gap-1 mb-1">
                <Calendar size={10} /> Date
              </label>
              <input type="date" value={state.surveyAt ?? ''} onChange={(e) => patch({ surveyAt: e.target.value || null })} onBlur={blur}
                     className="w-[160px] px-2 py-1 text-xs border border-slate-200 rounded" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Score / NPS</label>
              <input value={state.surveyScore} onChange={(e) => patch({ surveyScore: e.target.value })} onBlur={blur}
                     placeholder="e.g. 8.5 / 70 (NPS)"
                     className="w-[160px] px-2 py-1 text-xs border border-slate-200 rounded" />
            </div>
          </div>
        )}
      </div>

      {/* QBR */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-3">
          <ClipboardCheck size={14} className="text-violet-500" />
          <input type="checkbox" checked={state.qbrDone}
                 onChange={(e) => { const v = e.target.checked; patch({ qbrDone: v }); void save({ ...state, qbrDone: v }); }}
                 className="w-4 h-4" />
          QBR conducted
        </label>
        {state.qbrDone && (
          <div className="ml-6 space-y-2">
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider inline-flex items-center gap-1 mb-1">
                <Calendar size={10} /> Last QBR date
              </label>
              <input type="date" value={state.qbrAt ?? ''} onChange={(e) => patch({ qbrAt: e.target.value || null })} onBlur={blur}
                     className="w-[160px] px-2 py-1 text-xs border border-slate-200 rounded" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">QBR notes</label>
              <textarea value={state.qbrNotes} onChange={(e) => patch({ qbrNotes: e.target.value })} onBlur={blur}
                        rows={3}
                        placeholder="Key topics, asks from the customer, follow-ups…"
                        className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded resize-y" />
            </div>
          </div>
        )}
      </div>

      {/* Testimonial */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-900 mb-3">
          <MessageSquareQuote size={14} className="text-emerald-500" />
          Testimonial
        </label>
        <div className="space-y-2 ml-6">
          <textarea value={state.testimonialText} onChange={(e) => patch({ testimonialText: e.target.value })} onBlur={blur}
                    rows={4}
                    placeholder="Quote from the customer. Empty = no testimonial yet."
                    className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded resize-y" />
          <div>
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider inline-flex items-center gap-1 mb-1">
              <Calendar size={10} /> Received on
            </label>
            <input type="date" value={state.testimonialAt ?? ''} onChange={(e) => patch({ testimonialAt: e.target.value || null })} onBlur={blur}
                   className="w-[160px] px-2 py-1 text-xs border border-slate-200 rounded" />
          </div>
        </div>
      </div>

      {/* Free notes */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Free-form notes</label>
        <textarea value={state.notes} onChange={(e) => patch({ notes: e.target.value })} onBlur={blur}
                  rows={3}
                  placeholder="Anything else worth remembering for the relationship — internal-only."
                  className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded resize-y" />
      </div>
    </div>
  );
}
