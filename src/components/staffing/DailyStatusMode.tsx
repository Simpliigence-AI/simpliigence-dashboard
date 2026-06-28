/**
 * Daily Status mode — focused overlay to bulk-log today's statuses on active
 * requisitions that don't yet have a status entry dated today.
 *
 * UX: Each pending req renders as a row with the req title + account on the
 * left, and a single text input on the right. Tab key advances to the next
 * row's input — the whole list can be typed through in one pass.
 *
 * Save semantics: each row's status saves when the input is blurred OR the
 * user presses Tab/Enter. "Skip" marks the row as deferred to tomorrow (no
 * write). "Done" closes the overlay.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, X, Loader2, Check, SkipForward, ArrowDown } from 'lucide-react';
import type { StaffingRequisition, DailyStatus, StaffingAccount } from '../../types/staffing';

interface Props {
  requisitions: StaffingRequisition[];
  statuses: DailyStatus[];
  accounts: StaffingAccount[];
  onAddStatus: (p: { requisition_id: string; status_date: string; status_text: string; anticipation: string }) => Promise<void> | void;
  onClose: () => void;
}

const ARCHIVED = ['Closed', 'Lost', 'Cancelled'];

export function DailyStatusMode({ requisitions, statuses, accounts, onAddStatus, onClose }: Props) {
  const today = new Date().toISOString().slice(0, 10);

  // Active reqs that don't have a status entry from today yet.
  const pendingReqs = useMemo(() => {
    const haveTodayStatus = new Set<string>();
    for (const s of statuses) {
      if (s.status_date === today) haveTodayStatus.add(s.requisition_id);
    }
    return requisitions
      .filter((r) => !ARCHIVED.includes(r.status_field))
      .filter((r) => !haveTodayStatus.has(r.id))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [requisitions, statuses, today]);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name || 'Unknown';

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);

  // Input refs for Tab navigation
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Focus the first unsaved input on mount
  useEffect(() => {
    const first = pendingReqs.find((r) => !saved.has(r.id) && !skipped.has(r.id));
    if (first) inputRefs.current[first.id]?.focus();
  }, [pendingReqs, saved, skipped]);

  const saveOne = async (reqId: string) => {
    const text = (drafts[reqId] || '').trim();
    if (!text) return false;
    setSavingId(reqId);
    try {
      await onAddStatus({ requisition_id: reqId, status_date: today, status_text: text, anticipation: '' });
      setSaved((prev) => new Set(prev).add(reqId));
      return true;
    } finally {
      setSavingId(null);
    }
  };

  const advanceTo = (nextIdx: number) => {
    // skip past saved/skipped rows
    for (let i = nextIdx; i < pendingReqs.length; i++) {
      const r = pendingReqs[i];
      if (!saved.has(r.id) && !skipped.has(r.id)) {
        inputRefs.current[r.id]?.focus();
        return;
      }
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>, reqId: string, idx: number) => {
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      (async () => {
        const ok = await saveOne(reqId);
        if (ok) advanceTo(idx + 1);
        else advanceTo(idx + 1); // empty input = skip past
      })();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const skipOne = (reqId: string, idx: number) => {
    setSkipped((prev) => new Set(prev).add(reqId));
    advanceTo(idx + 1);
  };

  const totalDone = saved.size + skipped.size;
  const total = pendingReqs.length;
  const progressPct = total === 0 ? 100 : Math.round((totalDone / total) * 100);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-start justify-center pt-12 pb-8 px-4 overflow-y-auto"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[88vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-blue-50">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardList size={16} className="text-violet-600" />
                <h2 className="text-base font-bold text-slate-900">Daily status update</h2>
                <span className="text-[10px] font-bold text-violet-700 bg-white border border-violet-200 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  {today}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {total === 0
                  ? 'All active requisitions already have a status entry for today. Nothing to do — nice work.'
                  : <>Type a status update for each active requisition. <kbd className="text-[10px] bg-slate-100 border border-slate-300 px-1 rounded">Tab</kbd> or <kbd className="text-[10px] bg-slate-100 border border-slate-300 px-1 rounded">Enter</kbd> saves + advances. <kbd className="text-[10px] bg-slate-100 border border-slate-300 px-1 rounded">Esc</kbd> closes.</>
                }
              </p>
            </div>
            <button onClick={onClose}
                    className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-white/60">
              <X size={18} />
            </button>
          </div>
          {total > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-white/60 rounded-full overflow-hidden">
                <div className="h-full bg-violet-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="text-[11px] font-semibold text-violet-700 tabular-nums">
                {totalDone} / {total}
              </span>
            </div>
          )}
        </div>

        {/* Body — list of pending reqs */}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {pendingReqs.length === 0 ? (
            <div className="py-16 text-center text-sm text-slate-500">
              <Check size={28} className="mx-auto text-emerald-400 mb-2" />
              You&apos;re all caught up for today.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pendingReqs.map((r, idx) => {
                const isSaved = saved.has(r.id);
                const isSkipped = skipped.has(r.id);
                const isSaving = savingId === r.id;
                return (
                  <li key={r.id} className={`px-4 py-3 flex items-center gap-3 ${isSaved ? 'bg-emerald-50/40' : isSkipped ? 'opacity-50' : ''}`}>
                    <div className="flex-shrink-0 w-6 text-center">
                      {isSaved
                        ? <Check size={14} className="text-emerald-600 inline" />
                        : isSkipped
                          ? <SkipForward size={12} className="text-slate-400 inline" />
                          : <span className="text-[10px] text-slate-400 tabular-nums">{idx + 1}</span>}
                    </div>
                    <div className="min-w-0 w-[280px] flex-shrink-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">{r.title}</div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {accountName(r.account_id)} · {r.stage} · {r.new_positions} pos
                      </div>
                    </div>
                    <input
                      ref={(el) => { inputRefs.current[r.id] = el; }}
                      type="text"
                      value={drafts[r.id] || ''}
                      onChange={(e) => setDrafts({ ...drafts, [r.id]: e.target.value })}
                      onKeyDown={(e) => handleKey(e, r.id, idx)}
                      onBlur={() => { if ((drafts[r.id] || '').trim()) void saveOne(r.id); }}
                      disabled={isSaved || isSkipped}
                      placeholder={isSaved ? '— saved —' : isSkipped ? '— skipped —' : "What happened today?"}
                      className="flex-1 h-8 px-3 text-xs border border-slate-200 rounded-md focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-200 disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    {!isSaved && !isSkipped && (
                      <button type="button"
                              onClick={() => skipOne(r.id, idx)}
                              className="text-[11px] text-slate-400 hover:text-slate-700 hover:bg-slate-100 px-2 py-1 rounded inline-flex items-center gap-1"
                              title="Skip — don't log a status for this req today">
                        <SkipForward size={11} /> Skip
                      </button>
                    )}
                    {isSaving && <Loader2 size={12} className="animate-spin text-slate-400" />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between">
          <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
            <ArrowDown size={11} className="-rotate-90" /> use <kbd className="text-[10px] bg-white border border-slate-300 px-1 rounded">Tab</kbd> to fly through the list
          </span>
          <button onClick={onClose}
                  className="text-xs font-semibold bg-violet-600 text-white px-4 py-1.5 rounded-md hover:bg-violet-700">
            {totalDone === total && total > 0 ? 'All done — close' : 'Done for now'}
          </button>
        </div>
      </div>
    </div>
  );
}
