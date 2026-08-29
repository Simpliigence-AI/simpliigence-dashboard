/**
 * ScreeningsPage — history of recruiter screenings across India + Global
 * demand. Each row is a card with the recommendation pill, the account /
 * requisition context, and buttons to re-open the evaluation modal.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, Trash2, Sparkles, ClipboardCheck } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard } from '../components/ui';
import { useScreeningStore } from '../store/useScreeningStore';
import { RECOMMENDATION_META } from '../types/screening';
import type { Screening } from '../types/screening';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ScreeningsPage() {
  const screenings = useScreeningStore((s) => s.screenings);
  const loading = useScreeningStore((s) => s.loading);
  const loadAll = useScreeningStore((s) => s.loadAll);
  const remove = useScreeningStore((s) => s.remove);
  useEffect(() => { void loadAll(); }, [loadAll]);

  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return screenings;
    return screenings.filter((x) => `${x.requisitionTitle ?? ''} ${x.accountName ?? ''} ${x.candidateName ?? ''}`.toLowerCase().includes(s));
  }, [screenings, q]);

  const evaluated = screenings.filter((x) => x.status === 'evaluated');
  const inProgress = screenings.filter((x) => x.status !== 'evaluated');
  const strongYes = evaluated.filter((x) => x.evaluation?.overall_recommendation === 'strong_yes').length;

  const open = openId ? screenings.find((s) => s.id === openId) ?? null : null;

  return (
    <div>
      <PageHeader
        title="Screenings"
        subtitle="Every recruiter screen with JD, criteria, AI-generated questions, and post-screen scoring"
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label="Total" value={screenings.length} />
        <StatCard label="Evaluated" value={evaluated.length} />
        <StatCard label="In Progress" value={inProgress.length} subtitle="Prep / questions" />
        <StatCard label="Strong Yes" value={strongYes} subtitle="Ready to move forward" />
      </div>

      <Card className="mb-5">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search requisition, account, or candidate…"
            className="w-full pl-7 pr-2 py-1.5 rounded border border-slate-300 text-sm"
          />
        </div>
      </Card>

      {loading && screenings.length === 0 ? (
        <div className="text-center text-slate-500 py-8 text-sm"><Loader2 className="inline w-3 h-3 animate-spin mr-1" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-slate-400 italic text-sm py-8">
          No screenings yet. Start one from India Demand or Global Demand.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((s) => <ScreeningRow key={s.id} screening={s} onOpen={() => setOpenId(s.id)} onRemove={() => { if (confirm('Delete this screening?')) void remove(s.id); }} />)}
        </ul>
      )}

      {open && open.status === 'evaluated' && open.evaluation && (
        <EvaluationViewModal screening={open} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}

function ScreeningRow({ screening, onOpen, onRemove }: { screening: Screening; onOpen: () => void; onRemove: () => void }) {
  const rec = screening.evaluation ? RECOMMENDATION_META[screening.evaluation.overall_recommendation] : null;
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 truncate">
            {screening.candidateName || '(unnamed candidate)'}
            <span className="text-slate-500 font-normal"> · {screening.requisitionTitle || 'unknown requisition'}</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {(screening.accountName || '—')} · {screening.requisitionSource === 'india' ? 'India Demand' : 'Global Demand'} · created {fmtDate(screening.createdAt)}
            {screening.createdBy ? ` · by ${screening.createdBy}` : ''}
          </div>
        </div>
        {rec ? (
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded border ${rec.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${rec.dot}`} /> {rec.label} · {Math.round(screening.evaluation!.overall_score)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border bg-slate-100 text-slate-600 border-slate-200">
            {screening.status === 'draft' ? 'Draft' : 'Questions generated'}
          </span>
        )}
        <div className="flex items-center gap-1">
          {screening.status === 'evaluated' && (
            <button type="button" onClick={onOpen} className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded border border-slate-200 hover:border-slate-400">
              <ClipboardCheck size={11} /> View
            </button>
          )}
          <button type="button" onClick={onRemove} className="text-slate-400 hover:text-rose-600 p-1" title="Delete"><Trash2 size={12} /></button>
        </div>
      </div>
    </li>
  );
}

function EvaluationViewModal({ screening, onClose }: { screening: Screening; onClose: () => void }) {
  const evalu = screening.evaluation!;
  const rec = RECOMMENDATION_META[evalu.overall_recommendation];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Sparkles size={14} className="text-purple-600" /> Screening evaluation</div>
            <div className="text-[11px] text-slate-500">{screening.candidateName || 'candidate'} · {screening.requisitionTitle}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div className={`rounded-lg border-2 p-4 ${rec.cls}`}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Recommendation</div>
                <div className="text-lg font-bold">{rec.label}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">Overall</div>
                <div className="text-2xl font-bold tabular-nums">{Math.round(evalu.overall_score)}</div>
              </div>
            </div>
            <div className="text-sm mt-2 leading-relaxed">{evalu.summary}</div>
          </div>
          {evalu.delivery_assessment && (
            <div className="rounded-lg border border-purple-200 bg-purple-50/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-bold text-purple-800 uppercase tracking-wider">Delivery (recruiter observations)</div>
                <div className="text-sm font-bold tabular-nums text-purple-800">{Math.round(evalu.delivery_assessment.avg_score)}</div>
              </div>
              <div className="text-xs text-slate-700 mt-1">{evalu.delivery_assessment.summary}</div>
            </div>
          )}
          <ul className="space-y-2">
            {evalu.per_criterion.map((c, i) => (
              <li key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900">{c.name}</div>
                  <div className={`text-sm font-bold tabular-nums ${c.score >= 80 ? 'text-emerald-700' : c.score >= 60 ? 'text-sky-700' : c.score >= 40 ? 'text-amber-700' : 'text-rose-700'}`}>{Math.round(c.score)}</div>
                </div>
                <div className="text-[11px] text-slate-600 mt-1">{c.summary}</div>
                {c.evidence.length > 0 && <div className="mt-2 text-[11px] text-slate-700">Evidence: <span className="italic">"{c.evidence.join('” · “')}"</span></div>}
                {c.gaps.length > 0 && <div className="mt-1 text-[11px] text-rose-700">Gaps: {c.gaps.join(' · ')}</div>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
