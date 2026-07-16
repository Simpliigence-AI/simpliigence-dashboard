/**
 * GtmNotesEditor
 *
 * The Notes field for a GTM account, with two upgrades over a plain
 * textarea:
 *
 * 1. Voice input — same Web Speech API pattern used in the Concierge
 *    refinements and the Ask-AI bar. Tap mic → stream final chunks into
 *    the textarea, interim preview underneath. Works in Chrome/Edge/Safari.
 *
 * 2. Organize with AI — sends the raw notes to the structure-gtm-notes
 *    edge fn, which asks Claude to reshape them into Markdown sections
 *    (summary / discussion / decisions / concerns) and propose concrete
 *    action items. Result opens in a review modal:
 *      - Preview the structured Markdown
 *      - Toggle individual action items on/off
 *      - "Apply" replaces the notes with the structured version AND
 *        inserts the checked action items into gtm_actions.
 *
 * Kept as a self-contained component so it can be dropped into the
 * account drawer without touching the other GTM fields.
 */
import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Sparkles, Loader2, AlertTriangle, Check, X, ListChecks, MessageSquare } from 'lucide-react';
import { Button } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import { useGtmStore } from '../../store/useGtmStore';
import { useAuthStore } from '../../store/useAuthStore';
import type { GtmAccount, GtmAction } from '../../types/gtm';

interface StructuredResult {
  summary?: string;
  structured_notes?: string;
  action_items?: Array<{ title: string; description?: string; due_date_hint?: string | null }>;
  stakeholders_mentioned?: Array<{ name: string; role?: string }>;
  next_steps?: string[];
  open_questions?: string[];
}

interface Props {
  account: GtmAccount;
  existingActions: GtmAction[];
}

export function GtmNotesEditor({ account, existingActions }: Props) {
  const updateAccount = useGtmStore((s) => s.updateAccount);
  const addAction = useGtmStore((s) => s.addAction);
  const currentUser = useAuthStore((s) => s.currentUser);

  const [notes, setNotes] = useState(account.notes ?? '');
  useEffect(() => { setNotes(account.notes ?? ''); }, [account.notes]);

  const [organizing, setOrganizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StructuredResult | null>(null);

  // Voice input
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceInterim, setVoiceInterim] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const voiceSupported = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => () => { try { recognitionRef.current?.stop(); } catch { /* ignore */ } }, []);

  function startVoice() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (evt: any) => {
      let finals = '';
      let interim = '';
      for (let i = evt.resultIndex; i < evt.results.length; i++) {
        const r = evt.results[i];
        if (r.isFinal) finals += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      if (finals) setNotes((prev) => (prev ? prev.replace(/\s+$/, '') + (prev.endsWith('.') || prev.endsWith('?') || prev.endsWith('!') ? ' ' : ' ') : '') + finals.trim());
      setVoiceInterim(interim);
    };
    rec.onerror = () => setVoiceActive(false);
    rec.onend = () => { setVoiceActive(false); setVoiceInterim(''); };
    try { rec.start(); recognitionRef.current = rec; setVoiceActive(true); } catch { /* ignore */ }
  }
  function stopVoice() { try { recognitionRef.current?.stop(); } catch { /* ignore */ } }

  async function saveNotes() {
    await updateAccount(account.id, { notes });
  }

  async function organizeWithAi() {
    if (!notes.trim()) return;
    stopVoice();
    setOrganizing(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: e } = await supabase.functions.invoke<{ ok: boolean; error?: string; structured?: StructuredResult }>(
        'structure-gtm-notes',
        {
          body: {
            notes,
            accountName: account.name,
            currentNextStep: account.nextStep ?? '',
            existingActionTitles: existingActions.map((a) => a.title),
          },
        },
      );
      if (e) throw new Error(e.message);
      if (!data || data.ok === false) throw new Error(data?.error || 'AI structuring failed');
      setResult(data.structured ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOrganizing(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Notes</span>
        <div className="flex items-center gap-1.5">
          {voiceSupported && (
            <button
              type="button"
              onClick={voiceActive ? stopVoice : startVoice}
              title={voiceActive ? 'Stop listening' : 'Dictate notes'}
              className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border transition-colors ${
                voiceActive
                  ? 'bg-rose-600 text-white border-rose-600 animate-pulse'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400'
              }`}
            >
              {voiceActive ? <MicOff size={11} /> : <Mic size={11} />}
              {voiceActive ? 'Stop' : 'Dictate'}
            </button>
          )}
          <button
            type="button"
            onClick={organizeWithAi}
            disabled={!notes.trim() || organizing}
            className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-gradient-to-br from-purple-600 to-sky-600 text-white hover:opacity-90 disabled:opacity-50"
            title="Reshape rough notes into structured sections + action items"
          >
            {organizing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            Organize with AI
          </button>
        </div>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={saveNotes}
        rows={6}
        placeholder="Type or dictate notes about this account. Tap Organize with AI to structure them + get suggested action items."
        className={`w-full px-3 py-2 rounded border text-sm resize-y ${voiceActive ? 'border-rose-300 bg-rose-50/40' : 'border-slate-300'}`}
      />
      {voiceInterim && (
        <div className="text-[11px] text-slate-500 italic px-1 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
          {voiceInterim}
        </div>
      )}
      {error && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 flex items-center gap-1">
          <AlertTriangle size={11} /> {error}
        </div>
      )}

      {result && (
        <StructuredReviewModal
          result={result}
          onClose={() => setResult(null)}
          onApply={async (structuredMarkdown, selectedActions) => {
            // Save structured notes back onto the account.
            await updateAccount(account.id, { notes: structuredMarkdown });
            setNotes(structuredMarkdown);
            // Insert selected action items into gtm_actions.
            for (const a of selectedActions) {
              const due = normalizeDue(a.due_date_hint);
              await addAction({
                gtmAccountId: account.id,
                title: a.title,
                description: a.description ?? null,
                assigneeEmail: currentUser?.email ?? null,
                dueDate: due,
                createdBy: currentUser?.email ?? null,
              });
            }
            setResult(null);
          }}
        />
      )}
    </div>
  );
}

/** Convert Claude's freeform date hint into an ISO date if we can, else null.
 *  Accepts already-ISO ("2026-08-15"), "this week" → next Friday, "next week"
 *  → 7 days out. Anything else stays null so the user picks a date manually. */
function normalizeDue(hint: string | null | undefined): string | null {
  if (!hint) return null;
  const h = hint.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(h)) return h;
  const d = new Date();
  if (h === 'today') return d.toISOString().slice(0, 10);
  if (h === 'tomorrow') { d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
  if (h === 'this week' || h === 'end of week' || h === 'eow') {
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
    return d.toISOString().slice(0, 10);
  }
  if (h === 'next week' || h === 'in a week') { d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); }
  if (h === 'this month' || h === 'end of month' || h === 'eom') {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  }
  return null;
}

function StructuredReviewModal({
  result,
  onClose,
  onApply,
}: {
  result: StructuredResult;
  onClose: () => void;
  onApply: (structuredNotes: string, actions: NonNullable<StructuredResult['action_items']>) => Promise<void>;
}) {
  const actionItems = result.action_items ?? [];
  const [checked, setChecked] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    actionItems.forEach((_, i) => { init[i] = true; });
    return init;
  });
  const [applying, setApplying] = useState(false);
  const selectedActions = actionItems.filter((_, i) => checked[i]);

  async function submit() {
    setApplying(true);
    try {
      await onApply(result.structured_notes ?? '', selectedActions);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
              <Sparkles size={14} className="text-purple-600" /> Organized notes
            </div>
            {result.summary && <div className="text-[11px] text-slate-600 mt-0.5">{result.summary}</div>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Structured notes preview */}
          {result.structured_notes && (
            <section>
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                <MessageSquare size={11} /> Notes rewrite (will replace current notes on apply)
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 whitespace-pre-wrap font-mono max-h-64 overflow-y-auto">
                {result.structured_notes}
              </div>
            </section>
          )}

          {/* Action items */}
          {actionItems.length > 0 && (
            <section>
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                <ListChecks size={11} /> Suggested action items ({selectedActions.length}/{actionItems.length} selected)
              </div>
              <ul className="space-y-1.5">
                {actionItems.map((a, i) => (
                  <li key={i} className="rounded border border-slate-200 bg-white px-2.5 py-1.5 flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={!!checked[i]}
                      onChange={(e) => setChecked((c) => ({ ...c, [i]: e.target.checked }))}
                      className="mt-1 accent-purple-600"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900">{a.title}</div>
                      {a.description && <div className="text-[11px] text-slate-600 mt-0.5">{a.description}</div>}
                      {a.due_date_hint && <div className="text-[10px] text-slate-500 mt-0.5">due hint: {a.due_date_hint}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Other extracted bits */}
          {(result.next_steps?.length || 0) > 0 && (
            <section>
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">Next steps</div>
              <ul className="list-disc pl-5 space-y-0.5 text-xs text-slate-800">
                {result.next_steps!.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </section>
          )}
          {(result.open_questions?.length || 0) > 0 && (
            <section>
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">Open questions</div>
              <ul className="list-disc pl-5 space-y-0.5 text-xs text-slate-800">
                {result.open_questions!.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </section>
          )}
          {(result.stakeholders_mentioned?.length || 0) > 0 && (
            <section>
              <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">People mentioned</div>
              <div className="flex flex-wrap gap-1">
                {result.stakeholders_mentioned!.map((s, i) => (
                  <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                    {s.name}{s.role ? ` · ${s.role}` : ''}
                  </span>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={applying}>
            {applying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            <span className="ml-1">
              Apply {selectedActions.length > 0 ? `+ add ${selectedActions.length} action${selectedActions.length === 1 ? '' : 's'}` : ''}
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
}
