/**
 * ConciergeAskAI
 *
 * A natural-language query bar that sits at the top of the Concierge page.
 * The user types (or dictates) a question — "which clients still have
 * Marketing Cloud in backlog?", "who's overdue on upsell items?", "what
 * did we bill Ciklum last quarter?" — and Claude answers by scanning the
 * whole Concierge dataset in one shot via the concierge-ai-query edge fn.
 *
 * UX intent:
 * - Zero-friction: single input, big Ask button, response renders inline.
 * - Suggested prompts as chips on empty state so people can just click.
 * - Voice input reuses the browser Web Speech API — same pattern as the
 *   AI Profile refinements.
 * - Small history of the last few asks so people can flick back through
 *   what they just looked at.
 */
import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Loader2, Mic, MicOff, RefreshCw, AlertTriangle, X, MessageSquare, Copy, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface QAEntry {
  id: string;
  question: string;
  answer: string;
  error: string | null;
  at: string;
}

const SUGGESTED_PROMPTS = [
  'Which clients have Marketing Cloud implemented, and which have it in the backlog?',
  'Who has the highest upsell potential from AI Profile suggestions?',
  'List every account with open tickets over 3, ranked by count.',
  'Which accounts billed under $2k last month? Are any at risk of churn?',
  'What service areas do we have the most cross-sell opportunities in right now?',
  'Which clients are dormant and what did we last do for them?',
];

export function ConciergeAskAI() {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<QAEntry[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Voice input via Web Speech API (same pattern as the refinements textarea)
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
      if (finals) setQuestion((prev) => (prev ? prev.replace(/\s+$/, '') + ' ' : '') + finals.trim());
      setVoiceInterim(interim);
    };
    rec.onerror = () => setVoiceActive(false);
    rec.onend = () => { setVoiceActive(false); setVoiceInterim(''); };
    try { rec.start(); recognitionRef.current = rec; setVoiceActive(true); } catch { /* ignore */ }
  }
  function stopVoice() { try { recognitionRef.current?.stop(); } catch { /* ignore */ } }

  async function ask(prompt?: string) {
    const q = (prompt ?? question).trim();
    if (!q || busy) return;
    stopVoice();
    setBusy(true);
    const id = `qa-${Date.now()}`;
    // Optimistically add a placeholder so the user sees their question up top
    setHistory((h) => [{ id, question: q, answer: '', error: null, at: new Date().toISOString() }, ...h].slice(0, 8));
    setQuestion('');
    try {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean; answer?: string; error?: string }>(
        'concierge-ai-query',
        { body: { question: q } },
      );
      if (error) throw new Error(error.message);
      if (!data || data.ok === false) throw new Error(data?.error || 'Query failed');
      setHistory((h) => h.map((x) => (x.id === id ? { ...x, answer: data.answer ?? '' } : x)));
    } catch (e) {
      setHistory((h) => h.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
    } finally {
      setBusy(false);
    }
  }

  async function copyAnswer(entry: QAEntry) {
    try {
      await navigator.clipboard.writeText(`Q: ${entry.question}\n\n${entry.answer}`);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId((cur) => (cur === entry.id ? null : cur)), 1500);
    } catch { /* ignore */ }
  }

  const latest = history[0];

  return (
    <section className="mb-6 rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50/60 via-white to-sky-50/50 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-sky-500 text-white flex items-center justify-center shadow-sm">
            <Sparkles size={14} />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900">Ask the Concierge AI</div>
            <div className="text-[11px] text-slate-500">Query across accounts, features, billing, tickets, AI profiles, and upsell backlog.</div>
          </div>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setHistory([])}
            className="text-[11px] text-slate-500 hover:text-rose-600 flex items-center gap-1"
            title="Clear history"
          >
            <X size={11} /> clear
          </button>
        )}
      </div>

      {/* Input row */}
      <div className="flex gap-2 items-start">
        <div className="flex-1 relative">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={voiceActive ? 'Listening…' : 'Ask anything — e.g. "Which accounts have Sales Cloud but not Marketing Cloud?"'}
            rows={2}
            disabled={busy}
            className={`w-full px-3 py-2 pr-10 rounded-lg border text-sm resize-y bg-white ${voiceActive ? 'border-rose-300 bg-rose-50/40' : 'border-slate-300'} disabled:opacity-70`}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); void ask(); } }}
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={voiceActive ? stopVoice : startVoice}
              disabled={busy}
              title={voiceActive ? 'Stop listening' : 'Dictate question'}
              className={`absolute top-1.5 right-1.5 p-1.5 rounded-full transition-colors ${
                voiceActive ? 'bg-rose-600 text-white animate-pulse' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {voiceActive ? <MicOff size={14} /> : <Mic size={14} />}
            </button>
          )}
          {voiceInterim && (
            <div className="text-[11px] text-slate-500 italic mt-1 px-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              {voiceInterim}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => ask()}
          disabled={!question.trim() || busy}
          className="px-4 py-2 rounded-lg bg-gradient-to-br from-purple-600 to-sky-600 hover:from-purple-700 hover:to-sky-700 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Ask
        </button>
      </div>

      {/* Suggested prompts — only when empty */}
      {history.length === 0 && !busy && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => ask(p)}
              className="text-[11px] px-2 py-1 rounded-full border border-slate-200 bg-white text-slate-700 hover:border-purple-300 hover:text-purple-700 transition-colors"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Answers */}
      {history.length > 0 && (
        <div className="mt-3 space-y-2">
          {history.map((entry, idx) => (
            <div
              key={entry.id}
              className={`rounded-lg border ${idx === 0 ? 'border-purple-200 bg-white shadow-sm' : 'border-slate-200 bg-slate-50/50'} p-3`}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-start gap-2 min-w-0">
                  <MessageSquare size={12} className="text-slate-400 mt-1 flex-shrink-0" />
                  <div className="text-xs font-semibold text-slate-700 break-words">{entry.question}</div>
                </div>
                {entry.answer && (
                  <button
                    type="button"
                    onClick={() => copyAnswer(entry)}
                    title="Copy Q&A"
                    className="text-slate-400 hover:text-slate-700 p-0.5 flex-shrink-0"
                  >
                    {copiedId === entry.id ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                  </button>
                )}
              </div>
              {entry === latest && busy && !entry.answer && !entry.error && (
                <div className="text-xs text-slate-500 flex items-center gap-1.5 mt-2">
                  <Loader2 size={12} className="animate-spin" /> Scanning accounts + features + billing + profiles…
                </div>
              )}
              {entry.error && (
                <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5 flex items-start gap-1.5 mt-1">
                  <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-medium">Query failed</div>
                    <div className="opacity-80">{entry.error}</div>
                    <button
                      type="button"
                      onClick={() => ask(entry.question)}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-rose-800 hover:underline"
                    >
                      <RefreshCw size={10} /> retry
                    </button>
                  </div>
                </div>
              )}
              {entry.answer && (
                <MarkdownAnswer text={entry.answer} />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Minimal Markdown renderer for the AI answer — headings, bullets, bold,
 *  and inline code. Enough for Claude's typical structured responses
 *  without pulling in a full parser. */
function MarkdownAnswer({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={key} className="list-disc pl-5 space-y-0.5 text-sm text-slate-800">
        {listItems.map((it, i) => <li key={i} dangerouslySetInnerHTML={{ __html: inlineFmt(it) }} />)}
      </ul>,
    );
    listItems = [];
  };
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (/^\s*[-*]\s+/.test(line)) {
      listItems.push(line.replace(/^\s*[-*]\s+/, ''));
      return;
    }
    flushList(`ul-${i}`);
    if (!line.trim()) { blocks.push(<div key={`sp-${i}`} className="h-1" />); return; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const size = level <= 2 ? 'text-sm font-bold text-slate-900' : 'text-[13px] font-semibold text-slate-800';
      blocks.push(<div key={`h-${i}`} className={`${size} mt-1`}>{h[2]}</div>);
      return;
    }
    blocks.push(<p key={`p-${i}`} className="text-sm text-slate-800 leading-relaxed" dangerouslySetInnerHTML={{ __html: inlineFmt(line) }} />);
  });
  flushList('ul-end');
  return <div className="space-y-1">{blocks}</div>;
}

/** Bold + inline code, escaped. */
function inlineFmt(s: string): string {
  const esc = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-slate-900">$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="text-[12px] bg-slate-100 border border-slate-200 rounded px-1 py-0.5">$1</code>');
}
