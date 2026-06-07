/**
 * Profile Format — upload a candidate resume (PDF or .txt) OR paste raw
 * text, optionally add refinement instructions, and let Claude rewrite
 * it into the Simpliigence house format. The TA can iterate by editing
 * instructions and re-running; "Re-format" sends the previous draft
 * back to Claude with the new instructions so the model refines instead
 * of starting over.
 */
import { useMemo, useState } from 'react';
import { Upload, Sparkles, FileText, Copy, Download, RotateCcw, Loader2, AlertCircle, Check, FileEdit } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { db } from '../lib/supabaseSync';

type SourceMode = 'pdf' | 'text' | 'none';

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const QUICK_INSTRUCTIONS = [
  'Emphasize Salesforce platform expertise',
  'Drop personal details (DOB, marital status, photo)',
  'Add quantified achievements where missing',
  'Tighten to 1 page (concise bullets)',
  'Rewrite for a senior IC / staff-level role',
];

export default function ProfileFormatPage() {
  const [sourceMode, setSourceMode] = useState<SourceMode>('none');
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);
  const [pdfFilename, setPdfFilename] = useState<string>('');
  const [resumeText, setResumeText] = useState<string>('');
  const [instructions, setInstructions] = useState<string>('');

  const [draft, setDraft] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ markdown: string; instructions: string; at: string }>>([]);
  const [copied, setCopied] = useState<'md' | 'txt' | null>(null);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const isText = /\.(txt|md)$/i.test(file.name) || file.type.startsWith('text/');
    if (isPdf) {
      try {
        const b64 = toBase64(await file.arrayBuffer());
        setPdfBase64(b64);
        setPdfFilename(file.name);
        setSourceMode('pdf');
        setResumeText('');
      } catch (e) {
        setError((e as Error).message);
      }
    } else if (isText) {
      try {
        const txt = await file.text();
        setResumeText(txt);
        setSourceMode('text');
        setPdfBase64(null);
        setPdfFilename('');
      } catch (e) {
        setError((e as Error).message);
      }
    } else {
      setError(`Unsupported file type "${file.type || 'unknown'}". Please upload PDF or .txt.`);
    }
  };

  const reset = () => {
    setSourceMode('none');
    setPdfBase64(null);
    setPdfFilename('');
    setResumeText('');
    setInstructions('');
    setDraft('');
    setHistory([]);
    setError(null);
  };

  const canFormat = !running && (sourceMode === 'pdf' || (sourceMode === 'text' && resumeText.trim().length > 50) || draft.length > 0);

  const handleFormat = async (mode: 'first' | 'refine') => {
    setError(null);
    setRunning(true);
    try {
      const params: Parameters<typeof db.formatResume>[0] = {
        instructions: instructions.trim() || undefined,
      };
      if (mode === 'refine' && draft) {
        params.priorDraft = draft;
      } else if (sourceMode === 'pdf' && pdfBase64) {
        params.pdfBase64 = pdfBase64;
      } else if (sourceMode === 'text' && resumeText.trim()) {
        params.resumeText = resumeText.trim();
      } else {
        setError('Upload a PDF, paste resume text, or run an initial format first.');
        setRunning(false);
        return;
      }
      const res = await db.formatResume(params);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Push current draft to history before replacing
      if (draft) {
        setHistory((h) => [{ markdown: draft, instructions, at: new Date().toLocaleTimeString() }, ...h.slice(0, 4)]);
      }
      setDraft(res.markdown);
    } finally {
      setRunning(false);
    }
  };

  const copyMarkdown = async () => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopied('md');
      setTimeout(() => setCopied(null), 1500);
    } catch { /* ignore */ }
  };

  const copyPlainText = async () => {
    if (!draft) return;
    // Light Markdown → plain-text conversion
    const plain = draft
      .replace(/^#+\s*/gm, '')        // strip header hashes
      .replace(/\*\*(.*?)\*\*/g, '$1') // bold
      .replace(/\*(.*?)\*/g, '$1')     // italic
      .replace(/^[-*]\s+/gm, '• ')     // bullets
      .replace(/`(.*?)`/g, '$1')
      .replace(/^---$/gm, '');
    try {
      await navigator.clipboard.writeText(plain);
      setCopied('txt');
      setTimeout(() => setCopied(null), 1500);
    } catch { /* ignore */ }
  };

  const downloadMd = () => {
    if (!draft) return;
    const blob = new Blob([draft], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simpliigence-resume-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const sourceReady = sourceMode !== 'none';

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Profile Format"
        subtitle="Upload a resume, describe how you want it tweaked, and Claude rewrites it into the Simpliigence house format."
        action={
          (sourceReady || draft) ? (
            <button
              type="button"
              onClick={reset}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-300 px-3 py-1.5 rounded-md inline-flex items-center gap-1"
            >
              <RotateCcw size={12} /> Start over
            </button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left column — input */}
        <div className="space-y-4">
          {/* Source picker */}
          <Card title="1 · Source resume">
            {sourceMode === 'pdf' ? (
              <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-emerald-900 min-w-0">
                  <FileText size={16} className="flex-shrink-0" />
                  <span className="font-medium truncate">{pdfFilename}</span>
                </div>
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs text-emerald-700 hover:text-emerald-900 hover:underline whitespace-nowrap ml-3"
                >
                  Replace
                </button>
              </div>
            ) : sourceMode === 'text' ? (
              <div>
                <textarea
                  rows={10}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder="Paste resume text here…"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono resize-y"
                />
                <button
                  type="button"
                  onClick={reset}
                  className="mt-2 text-[11px] text-slate-500 hover:text-slate-800 hover:underline"
                >
                  Clear / choose different source
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <label
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleFile(e.dataTransfer.files?.[0] ?? null); }}
                  className="block border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:bg-slate-50 hover:border-primary/50"
                >
                  <Upload size={28} className="text-slate-400 mx-auto mb-2" />
                  <div className="text-sm font-medium text-slate-700">Drop a PDF or .txt resume here</div>
                  <div className="text-[11px] text-slate-500 mt-1">or click to pick a file</div>
                  <input
                    type="file"
                    accept=".pdf,.txt,application/pdf,text/plain"
                    className="hidden"
                    onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <div className="text-center text-[11px] text-slate-400">— OR —</div>
                <button
                  type="button"
                  onClick={() => setSourceMode('text')}
                  className="w-full text-xs text-primary hover:underline py-2 flex items-center justify-center gap-1"
                >
                  <FileEdit size={12} /> Paste resume text instead
                </button>
              </div>
            )}
          </Card>

          {/* Instructions */}
          <Card title="2 · Refinement instructions (optional)">
            <textarea
              rows={4}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Emphasize Salesforce platform experience. Drop personal details. Rewrite for a senior architect role. Cut the customer-service section."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {QUICK_INSTRUCTIONS.map((qi) => (
                <button
                  key={qi}
                  type="button"
                  onClick={() => setInstructions((cur) => (cur.trim() ? `${cur.trim()}\n${qi}` : qi))}
                  className="text-[10px] font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-full px-2 py-1"
                >
                  + {qi}
                </button>
              ))}
            </div>
          </Card>

          {/* Action */}
          <button
            type="button"
            onClick={() => handleFormat(draft ? 'refine' : 'first')}
            disabled={!canFormat}
            className="w-full bg-primary text-white py-3 rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 shadow-sm"
          >
            {running
              ? <><Loader2 size={16} className="animate-spin" /> Asking Claude…</>
              : draft
                ? <><Sparkles size={16} /> Re-format with new instructions</>
                : <><Sparkles size={16} /> Format with Claude</>}
          </button>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 flex items-start gap-2">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Right column — output */}
        <div className="space-y-4">
          <Card title="3 · Formatted output" action={
            draft ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={copyMarkdown}
                  className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 border border-slate-300 px-2 py-1 rounded inline-flex items-center gap-1"
                  title="Copy as Markdown"
                >
                  {copied === 'md' ? <Check size={11} /> : <Copy size={11} />}
                  {copied === 'md' ? 'Copied' : 'Markdown'}
                </button>
                <button
                  type="button"
                  onClick={copyPlainText}
                  className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 border border-slate-300 px-2 py-1 rounded inline-flex items-center gap-1"
                  title="Copy as plain text (markdown stripped)"
                >
                  {copied === 'txt' ? <Check size={11} /> : <Copy size={11} />}
                  {copied === 'txt' ? 'Copied' : 'Plain'}
                </button>
                <button
                  type="button"
                  onClick={downloadMd}
                  className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 border border-slate-300 px-2 py-1 rounded inline-flex items-center gap-1"
                  title="Download as .md"
                >
                  <Download size={11} /> .md
                </button>
              </div>
            ) : null
          }>
            {!draft && !running && (
              <div className="text-sm text-slate-400 italic text-center py-12">
                Click <strong className="text-slate-600 not-italic">Format with Claude</strong> on the left to generate.
              </div>
            )}
            {running && !draft && (
              <div className="text-sm text-slate-500 text-center py-12 inline-flex items-center justify-center gap-2 w-full">
                <Loader2 size={16} className="animate-spin" /> Claude is rewriting the resume…
              </div>
            )}
            {draft && (
              <FormattedPreview markdown={draft} onEdit={setDraft} />
            )}
          </Card>

          {/* History */}
          {history.length > 0 && (
            <Card title="Previous drafts">
              <ul className="divide-y divide-slate-100">
                {history.map((h, idx) => (
                  <li key={idx} className="py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-700 truncate">
                        {h.instructions ? h.instructions.split('\n')[0].slice(0, 80) : 'Initial draft'}
                      </div>
                      <div className="text-[10px] text-slate-400">{h.at}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setHistory((cur) => [{ markdown: draft, instructions, at: new Date().toLocaleTimeString() }, ...cur.filter((_, i) => i !== idx).slice(0, 4)]);
                        setDraft(h.markdown);
                      }}
                      className="text-[11px] font-semibold text-primary hover:underline whitespace-nowrap"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** Renders Markdown with a tiny in-page parser (avoid pulling in a Markdown
 *  lib — we only need the house-format subset). Click "Edit" to flip to a
 *  textarea so the TA can hand-tweak before copy/download. */
function FormattedPreview({ markdown, onEdit }: { markdown: string; onEdit: (next: string) => void }) {
  const [editing, setEditing] = useState(false);

  const html = useMemo(() => renderMarkdownLite(markdown), [markdown]);

  if (editing) {
    return (
      <div>
        <textarea
          rows={24}
          value={markdown}
          onChange={(e) => onEdit(e.target.value)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
        />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-2 text-xs font-semibold text-primary hover:underline"
        >
          ← Back to preview
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="float-right text-[11px] font-semibold text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
      >
        <FileEdit size={11} /> Edit
      </button>
      <div
        className="markdown-preview text-sm text-slate-700"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <style>{`
        .markdown-preview h1 { font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0 0 0.5rem; }
        .markdown-preview h2 { font-size: 1rem;    font-weight: 700; color: #0f172a; margin: 1.25rem 0 0.4rem; padding-top: 0.5rem; border-top: 1px solid #e2e8f0; }
        .markdown-preview h2:first-of-type { border-top: 0; padding-top: 0; }
        .markdown-preview h3 { font-size: 0.875rem; font-weight: 700; color: #1e293b; margin: 0.85rem 0 0.2rem; }
        .markdown-preview p  { margin: 0.35rem 0; line-height: 1.55; }
        .markdown-preview ul { list-style: disc; padding-left: 1.25rem; margin: 0.35rem 0; }
        .markdown-preview li { margin: 0.15rem 0; line-height: 1.5; }
        .markdown-preview strong { color: #0f172a; font-weight: 700; }
        .markdown-preview em { font-style: italic; color: #64748b; }
        .markdown-preview code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 0.78rem; }
      `}</style>
    </div>
  );
}

/** Tiny markdown-to-HTML converter for the subset Claude produces.
 *  Handles: # / ## / ### headings, **bold**, *italic*, `code`, - bullets,
 *  blank-line paragraphs. NOT a general parser — fine for our format. */
function renderMarkdownLite(md: string): string {
  // Escape HTML
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  const flushList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flushList(); continue; }

    let m: RegExpMatchArray | null;
    if ((m = line.match(/^# (.+)/))) { flushList(); out.push(`<h1>${inline(m[1])}</h1>`); continue; }
    if ((m = line.match(/^## (.+)/))) { flushList(); out.push(`<h2>${inline(m[1])}</h2>`); continue; }
    if ((m = line.match(/^### (.+)/))) { flushList(); out.push(`<h3>${inline(m[1])}</h3>`); continue; }
    if ((m = line.match(/^[-*]\s+(.+)/))) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    flushList();
    out.push(`<p>${inline(line)}</p>`);
  }
  flushList();

  function inline(s: string): string {
    let t = escape(s);
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    t = t.replace(/`([^`]+?)`/g, '<code class="bg-slate-100 px-1 py-0.5 rounded text-[11px]">$1</code>');
    return t;
  }

  return out.join('\n');
}
