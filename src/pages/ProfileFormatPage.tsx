/**
 * Profile Format — upload a candidate resume (PDF / Word / RTF / .txt) OR
 * paste raw text, optionally upload a client-specific target-format sample,
 * add refinement instructions, and let Claude rewrite it into the
 * Simpliigence standard profile template (lib/profileTemplate.ts — modelled
 * on Vikas Rathod's profile: centered name / title / contact header, blue
 * section headings, Core Expertise bullets, "Category:" skill lines, and a
 * "Name | Title" footer on every page).
 *
 * Output: Word (.docx via lib/profileDocx.ts) or PDF (browser print with the
 * same styles and footer), plus Markdown copy/download.
 */
import { useMemo, useState } from 'react';
import { Upload, Sparkles, FileText, Copy, Download, RotateCcw, Loader2, AlertCircle, Check, FileEdit, Printer, Target } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { db } from '../lib/supabaseSync';
import { parseProfile, profileToHtml, PROFILE_CSS } from '../lib/profileTemplate';
import { buildProfileDocx } from '../lib/profileDocx';

type SourceMode = 'file' | 'text' | 'none';

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Accepted upload types. The edge function sniffs magic bytes, so a
 *  mislabelled file (e.g. a .docx renamed .doc) still reads correctly. */
const DOC_EXT = /\.(pdf|docx|doc|rtf)$/i;
const DOC_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/rtf',
  'text/rtf',
]);
const isDocFile = (f: File) => DOC_EXT.test(f.name) || DOC_MIME.has(f.type);
const DOC_ACCEPT = '.pdf,.docx,.doc,.rtf,' + [...DOC_MIME].join(',');
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const QUICK_INSTRUCTIONS = [
  'Emphasize Salesforce platform expertise',
  'Drop personal details (DOB, marital status, photo)',
  'Add quantified achievements where missing',
  'Drop phone and email (keep location only)',
  'Tighten to 2 pages (concise bullets)',
  'Rewrite for a senior IC / staff-level role',
];

export default function ProfileFormatPage() {
  const [sourceMode, setSourceMode] = useState<SourceMode>('none');
  const [fileB64, setFileB64] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [resumeText, setResumeText] = useState<string>('');
  const [instructions, setInstructions] = useState<string>('');

  // Target-format sample (optional)
  const [targetB64, setTargetB64] = useState<string | null>(null);
  const [targetFilename, setTargetFilename] = useState<string>('');

  const [draft, setDraft] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ markdown: string; instructions: string; at: string }>>([]);
  const [copied, setCopied] = useState<'md' | 'txt' | null>(null);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    const isText = /\.(txt|md)$/i.test(file.name) || file.type === 'text/plain' || file.type === 'text/markdown';
    if (isText) {
      try {
        const txt = await file.text();
        setResumeText(txt);
        setSourceMode('text');
        setFileB64(null);
        setFileName('');
      } catch (e) {
        setError((e as Error).message);
      }
    } else if (isDocFile(file)) {
      if (file.size > MAX_FILE_BYTES) { setError(`${file.name} is over 10 MB.`); return; }
      try {
        const b64 = toBase64(await file.arrayBuffer());
        setFileB64(b64);
        setFileName(file.name);
        setSourceMode('file');
        setResumeText('');
      } catch (e) {
        setError((e as Error).message);
      }
    } else {
      setError(`Unsupported file type "${file.name}". Please upload PDF, Word (.docx/.doc), RTF or .txt.`);
    }
  };

  const handleTargetFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    if (!isDocFile(file)) {
      setError('Target format must be a PDF, Word (.docx/.doc) or RTF file.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) { setError(`${file.name} is over 10 MB.`); return; }
    try {
      const b64 = toBase64(await file.arrayBuffer());
      setTargetB64(b64);
      setTargetFilename(file.name);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reset = () => {
    setSourceMode('none');
    setFileB64(null);
    setFileName('');
    setResumeText('');
    setInstructions('');
    setTargetB64(null);
    setTargetFilename('');
    setDraft('');
    setHistory([]);
    setError(null);
  };

  const canFormat = !running && (sourceMode === 'file' || (sourceMode === 'text' && resumeText.trim().length > 50) || draft.length > 0);

  const handleFormat = async (mode: 'first' | 'refine') => {
    setError(null);
    setRunning(true);
    try {
      const params: Parameters<typeof db.formatResume>[0] = {
        instructions: instructions.trim() || undefined,
        targetFormatFileBase64: targetB64 ?? undefined,
        targetFormatFileName: targetFilename || undefined,
      };
      if (mode === 'refine' && draft) {
        params.priorDraft = draft;
      } else if (sourceMode === 'file' && fileB64) {
        params.fileBase64 = fileB64;
        params.fileName = fileName;
      } else if (sourceMode === 'text' && resumeText.trim()) {
        params.resumeText = resumeText.trim();
      } else {
        setError('Upload a resume file, paste resume text, or run an initial format first.');
        setRunning(false);
        return;
      }
      const res = await db.formatResume(params);
      if (!res.ok) {
        setError(res.error);
        return;
      }
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
    const plain = draft
      .replace(/^#+\s*/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/^>\s*/gm, '')
      .replace(/^[-*]\s+/gm, '• ')
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

  const [wordBusy, setWordBusy] = useState(false);
  const downloadWord = async () => {
    if (!draft) return;
    setWordBusy(true);
    try {
      const { blob, filename } = await buildProfileDocx(draft);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Word export failed: ${(e as Error).message}`);
    } finally {
      setWordBusy(false);
    }
  };

  const parsed = useMemo(() => parseProfile(draft), [draft]);
  const printHtml = useMemo(() => profileToHtml(parsed), [parsed]);
  const footerCss = parsed.footer.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  /** Trigger the browser print dialog — user picks "Save as PDF" to get a real PDF.
   *  Print-only CSS hides everything except the formatted output. */
  const savePdf = () => {
    if (!draft) return;
    window.print();
  };

  const sourceReady = sourceMode !== 'none';

  return (
    <div className="w-full">
      {/* Page chrome — hidden in print */}
      <div className="profile-format-chrome">
        <PageHeader
          title="Profile Format"
          subtitle="Upload a candidate resume, describe any tweaks, and Claude rewrites it into the Simpliigence standard profile template. Download as Word or PDF."
          action={
            (sourceReady || draft) ? (
              <button
                type="button"
                onClick={reset}
                className="text-xs font-semibold text-muted hover:text-ink border border-line px-3 py-1.5 rounded-md inline-flex items-center gap-1"
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
              {sourceMode === 'file' ? (
                <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <div className="flex items-center gap-2 text-sm text-emerald-900 min-w-0">
                    <FileText size={16} className="flex-shrink-0" />
                    <span className="font-medium truncate">{fileName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setFileB64(null); setFileName(''); setSourceMode('none'); }}
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
                    className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono resize-y"
                  />
                  <button
                    type="button"
                    onClick={() => { setResumeText(''); setSourceMode('none'); }}
                    className="mt-2 text-[11px] text-muted hover:text-ink hover:underline"
                  >
                    Clear / choose different source
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleFile(e.dataTransfer.files?.[0] ?? null); }}
                    className="block border-2 border-dashed border-line rounded-lg p-6 text-center cursor-pointer hover:bg-surface-2/70 hover:border-primary/50"
                  >
                    <Upload size={28} className="text-muted/70 mx-auto mb-2" />
                    <div className="text-sm font-medium text-ink/80">Drop a resume here — PDF, Word or RTF</div>
                    <div className="text-[11px] text-muted mt-1">.pdf · .docx · .doc · .rtf · .txt — or click to pick a file</div>
                    <input
                      type="file"
                      accept={`${DOC_ACCEPT},.txt,text/plain`}
                      className="hidden"
                      onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                    />
                  </label>
                  <div className="text-center text-[11px] text-muted/70">— OR —</div>
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

            {/* Target format — OPTIONAL */}
            <Card title="2 · Client-specific format (optional)">
              <p className="text-[11px] text-muted mb-3">
                Every profile uses the Simpliigence standard template by default — name, title and contact header; Professional Profile; Core Expertise; Simpliigence projects; Professional Experience; Technology &amp; Architecture; Education &amp; Certifications; and a name | title footer on every page. Only upload a sample (PDF, Word or RTF) if a client insists on its own section order.
              </p>
              {targetB64 ? (
                <div className="flex items-center justify-between p-3 bg-violet-50 border border-violet-200 rounded-lg">
                  <div className="flex items-center gap-2 text-sm text-violet-900 min-w-0">
                    <Target size={16} className="flex-shrink-0" />
                    <span className="font-medium truncate">Target: {targetFilename}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setTargetB64(null); setTargetFilename(''); }}
                    className="text-xs text-violet-700 hover:text-violet-900 hover:underline whitespace-nowrap ml-3"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleTargetFile(e.dataTransfer.files?.[0] ?? null); }}
                  className="block border-2 border-dashed border-line rounded-lg p-4 text-center cursor-pointer hover:bg-surface-2/70 hover:border-violet-300"
                >
                  <Target size={20} className="text-muted/70 mx-auto mb-1" />
                  <div className="text-[12px] font-medium text-ink/80">Drop a sample-format file here</div>
                  <div className="text-[10px] text-muted mt-0.5">Or click — Claude will mimic its layout</div>
                  <input
                    type="file"
                    accept={DOC_ACCEPT}
                    className="hidden"
                    onChange={(e) => handleTargetFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              )}
            </Card>

            {/* Instructions */}
            <Card title="3 · Refinement instructions (optional)">
              <textarea
                rows={4}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="e.g. Emphasize Salesforce platform experience. Drop personal details. Rewrite for a senior architect role. Cut the customer-service section."
                className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {QUICK_INSTRUCTIONS.map((qi) => (
                  <button
                    key={qi}
                    type="button"
                    onClick={() => setInstructions((cur) => (cur.trim() ? `${cur.trim()}\n${qi}` : qi))}
                    className="text-[10px] font-semibold text-muted bg-surface-2 hover:bg-line/60 rounded-full px-2 py-1"
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
            <Card title="4 · Formatted output" action={
              draft ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={downloadWord}
                    disabled={wordBusy}
                    className="text-[11px] font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-50 px-2.5 py-1 rounded inline-flex items-center gap-1"
                    title="Download as a Word document in the Simpliigence template"
                  >
                    {wordBusy ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />} Word
                  </button>
                  <button
                    type="button"
                    onClick={savePdf}
                    className="text-[11px] font-semibold text-primary border border-primary/40 hover:bg-primary/10 px-2.5 py-1 rounded inline-flex items-center gap-1"
                    title="Open the browser print dialog — choose 'Save as PDF'"
                  >
                    <Printer size={11} /> PDF
                  </button>
                  <button
                    type="button"
                    onClick={copyMarkdown}
                    className="text-[11px] font-semibold text-muted hover:text-ink border border-line px-2 py-1 rounded inline-flex items-center gap-1"
                    title="Copy as Markdown"
                  >
                    {copied === 'md' ? <Check size={11} /> : <Copy size={11} />}
                    {copied === 'md' ? 'Copied' : 'Markdown'}
                  </button>
                  <button
                    type="button"
                    onClick={copyPlainText}
                    className="text-[11px] font-semibold text-muted hover:text-ink border border-line px-2 py-1 rounded inline-flex items-center gap-1"
                    title="Copy as plain text (markdown stripped)"
                  >
                    {copied === 'txt' ? <Check size={11} /> : <Copy size={11} />}
                    {copied === 'txt' ? 'Copied' : 'Plain'}
                  </button>
                  <button
                    type="button"
                    onClick={downloadMd}
                    className="text-[11px] font-semibold text-muted hover:text-ink border border-line px-2 py-1 rounded inline-flex items-center gap-1"
                    title="Download as .md"
                  >
                    <Download size={11} /> .md
                  </button>
                </div>
              ) : null
            }>
              {!draft && !running && (
                <div className="text-sm text-muted/70 italic text-center py-12">
                  Click <strong className="text-muted not-italic">Format with Claude</strong> on the left to generate.
                </div>
              )}
              {running && !draft && (
                <div className="text-sm text-muted text-center py-12 inline-flex items-center justify-center gap-2 w-full">
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
                <ul className="divide-y divide-line/60">
                  {history.map((h, idx) => (
                    <li key={idx} className="py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-ink/80 truncate">
                          {h.instructions ? h.instructions.split('\n')[0].slice(0, 80) : 'Initial draft'}
                        </div>
                        <div className="text-[10px] text-muted/70">{h.at}</div>
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

      {/* Print-only area — only the rendered profile shows when saving as PDF. */}
      <div className="profile-format-print-only">
        <div className="simpliigence-profile" dangerouslySetInnerHTML={{ __html: printHtml }} />
      </div>

      {/* Styles — Simpliigence standard template (lib/profileTemplate.ts) + print-only overrides */}
      <style>{`
        ${PROFILE_CSS}
        .profile-format-page { background: #fff; color: #000; border: 1px solid #e5e7eb; border-radius: 6px; padding: 28px 34px; box-shadow: 0 1px 2px rgba(0,0,0,.04); }

        /* Hide the print-only area when on screen */
        .profile-format-print-only { display: none; }

        @media print {
          .profile-format-chrome { display: none !important; }
          .profile-format-print-only { display: block !important; }
          .profile-format-print-only .sp-footer { display: none; }
          @page {
            size: letter;
            margin: 0.55in 0.7in;
            @bottom-center { content: "${footerCss}"; font-family: Aptos, Calibri, Arial, sans-serif; font-size: 8pt; color: #000; }
          }
          body { background: white !important; }
          html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}

/** Renders Markdown with a tiny in-page parser. Click "Edit" to flip to a
 *  textarea so the TA can hand-tweak before printing. */
function FormattedPreview({ markdown, onEdit }: { markdown: string; onEdit: (next: string) => void }) {
  const [editing, setEditing] = useState(false);

  const html = useMemo(() => profileToHtml(parseProfile(markdown)), [markdown]);

  if (editing) {
    return (
      <div>
        <textarea
          rows={24}
          value={markdown}
          onChange={(e) => onEdit(e.target.value)}
          className="w-full border border-line rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
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
        className="float-right text-[11px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1"
      >
        <FileEdit size={11} /> Edit
      </button>
      <div className="profile-format-page clear-both mt-6">
        <div
          className="simpliigence-profile"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
