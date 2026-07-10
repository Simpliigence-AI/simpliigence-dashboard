/**
 * AccountDocsTab
 *
 * Renders the Documents OR Meetings pane inside AccountDrawer. Same layout,
 * different kinds:
 *   - kindFilter='document'          → generic uploads (SOWs, decks, PDFs)
 *   - kindFilter=['meeting_transcript','meeting_recording'] → meetings
 *
 * Upload path: file → Storage → concierge_account_documents row → auto
 * invoke process-account-document. Also supports pasting text (transcripts
 * only) via a "Paste transcript" flow.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { UploadCloud, FileText, Loader2, RefreshCw, Trash2, Sparkles, Download, AlertTriangle, ClipboardPaste, Calendar, Mic } from 'lucide-react';
import { Button } from '../../components/ui';
import type { AccountDocKind, AccountDocument } from '../../types/concierge';
import { useAccountDocsStore } from '../../store/useAccountDocsStore';
import { useAuthStore } from '../../store/useAuthStore';

interface Props {
  accountId: string;
  mode: 'documents' | 'meetings';
}

const MODE_KINDS: Record<Props['mode'], AccountDocKind[]> = {
  documents: ['document'],
  meetings: ['meeting_transcript', 'meeting_recording'],
};

function humanSize(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function AccountDocsTab({ accountId, mode }: Props) {
  const docs = useAccountDocsStore((s) => s.docsByAccount[accountId] ?? []);
  const loading = useAccountDocsStore((s) => s.loadingByAccount[accountId] ?? false);
  const loadForAccount = useAccountDocsStore((s) => s.loadForAccount);
  const uploadFile = useAccountDocsStore((s) => s.uploadFile);
  const addTranscript = useAccountDocsStore((s) => s.addTranscript);
  const process = useAccountDocsStore((s) => s.process);
  const remove = useAccountDocsStore((s) => s.remove);
  const signedUrl = useAccountDocsStore((s) => s.signedUrl);
  const currentUser = useAuthStore((s) => s.currentUser);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transTitle, setTransTitle] = useState('');
  const [transText, setTransText] = useState('');
  const [transDate, setTransDate] = useState<string>('');
  const [openDoc, setOpenDoc] = useState<AccountDocument | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadForAccount(accountId);
  }, [accountId, loadForAccount]);

  const filtered = useMemo(
    () => docs.filter((d) => (MODE_KINDS[mode] as string[]).includes(d.kind)),
    [docs, mode],
  );

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const kind: AccountDocKind = mode === 'meetings' ? 'meeting_recording' : 'document';
      for (const f of Array.from(files)) {
        await uploadFile({ accountId, kind, file: f, uploadedBy: currentUser?.email ?? null });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function submitTranscript() {
    if (!transTitle.trim() || !transText.trim()) return;
    setUploading(true);
    setError(null);
    try {
      await addTranscript({ accountId, title: transTitle.trim(), text: transText, meetingDate: transDate || null, uploadedBy: currentUser?.email ?? null });
      setTransTitle(''); setTransText(''); setTransDate(''); setShowTranscript(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function download(doc: AccountDocument) {
    if (!doc.storagePath) return;
    const url = await signedUrl(doc.storagePath);
    if (url) window.open(url, '_blank', 'noopener');
  }

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div className="border-2 border-dashed border-slate-200 rounded-lg p-4 bg-slate-50/50">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
            accept={mode === 'meetings' ? '.pdf,.txt,.md,.vtt,.srt,.mp3,.mp4,.m4a,.wav,application/*,text/*,audio/*,video/*' : '.pdf,.txt,.md,.docx,.doc,application/*,text/*'}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <UploadCloud className="w-3 h-3" />}
            <span className="ml-1">Upload {mode === 'meetings' ? 'recording / PDF / VTT' : 'document'}</span>
          </Button>
          {mode === 'meetings' && (
            <Button variant="secondary" size="sm" onClick={() => setShowTranscript((v) => !v)}>
              <ClipboardPaste className="w-3 h-3" /> <span className="ml-1">Paste transcript</span>
            </Button>
          )}
          <span className="text-[11px] text-slate-500 ml-auto">
            AI summarizes each file automatically. PDF and text supported today; audio stored raw.
          </span>
        </div>

        {showTranscript && (
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={transTitle}
                onChange={(e) => setTransTitle(e.target.value)}
                placeholder="Meeting title (e.g. Weekly sync — 2026-07-08)"
                className="flex-1 px-3 py-1.5 rounded border border-slate-300 text-sm"
              />
              <input
                type="date"
                value={transDate}
                onChange={(e) => setTransDate(e.target.value)}
                className="px-3 py-1.5 rounded border border-slate-300 text-sm"
              />
            </div>
            <textarea
              value={transText}
              onChange={(e) => setTransText(e.target.value)}
              placeholder="Paste the transcript here…"
              rows={8}
              className="w-full px-3 py-2 rounded border border-slate-300 text-sm font-mono"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowTranscript(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={submitTranscript} disabled={!transTitle.trim() || !transText.trim() || uploading}>
                {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                <span className="ml-1">Save + summarize</span>
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {/* Docs list */}
      {loading && filtered.length === 0 ? (
        <div className="text-center text-slate-500 py-6 text-sm"><Loader2 className="inline w-3 h-3 animate-spin mr-1" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-slate-400 py-6 text-sm italic">
          No {mode === 'meetings' ? 'meetings' : 'documents'} yet. Upload one above.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => (
            <DocRow
              key={d.id}
              doc={d}
              onProcess={() => process(d.id)}
              onDownload={() => download(d)}
              onRemove={() => { if (confirm(`Delete "${d.title}"?`)) void remove(d.id); }}
              onOpen={() => setOpenDoc(d)}
            />
          ))}
        </div>
      )}

      {openDoc && <DocDetailModal doc={openDoc} onClose={() => setOpenDoc(null)} />}
    </div>
  );
}

function DocRow({ doc, onProcess, onDownload, onRemove, onOpen }: {
  doc: AccountDocument;
  onProcess: () => void;
  onDownload: () => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const isMeeting = doc.kind !== 'document';
  const Icon = isMeeting ? Mic : FileText;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 hover:border-sky-300 transition-colors">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-slate-400"><Icon size={18} /></div>
        <div className="flex-1 min-w-0">
          <button type="button" onClick={onOpen} className="text-sm font-semibold text-slate-900 hover:text-sky-700 text-left truncate block w-full">
            {doc.title}
          </button>
          <div className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {doc.meetingDate && <span className="inline-flex items-center gap-0.5"><Calendar size={9} /> {doc.meetingDate}</span>}
            {doc.filename && <span className="truncate">{doc.filename}</span>}
            {doc.sizeBytes && <span>{humanSize(doc.sizeBytes)}</span>}
            <span>uploaded {fmtDate(doc.uploadedAt)}</span>
            {doc.uploadedBy && <span>by {doc.uploadedBy}</span>}
          </div>
          <StatusPill doc={doc} />
          {doc.aiSummary && (
            <div className="text-xs text-slate-700 mt-1.5 leading-relaxed line-clamp-2">{doc.aiSummary}</div>
          )}
          {doc.aiError && (
            <div className="text-[11px] text-rose-700 mt-1.5 flex items-center gap-1"><AlertTriangle size={10} /> {doc.aiError}</div>
          )}
        </div>
        <div className="flex flex-col gap-1 items-end flex-shrink-0">
          <div className="flex gap-1">
            {doc.storagePath && (
              <button type="button" onClick={onDownload} title="Download" className="p-1 text-slate-400 hover:text-slate-700">
                <Download size={14} />
              </button>
            )}
            <button type="button" onClick={onProcess} title="Re-summarize" className="p-1 text-slate-400 hover:text-slate-700" disabled={doc.aiStatus === 'processing'}>
              <RefreshCw size={14} className={doc.aiStatus === 'processing' ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={onRemove} title="Delete" className="p-1 text-slate-400 hover:text-rose-600">
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ doc }: { doc: AccountDocument }) {
  const map: Record<AccountDocument['aiStatus'], { label: string; cls: string; icon: JSX.Element | null }> = {
    pending: { label: 'Queued', cls: 'bg-slate-100 text-slate-600', icon: null },
    processing: { label: 'Summarizing…', cls: 'bg-sky-50 text-sky-700', icon: <Loader2 size={9} className="animate-spin" /> },
    done: { label: 'Summarized', cls: 'bg-emerald-50 text-emerald-700', icon: <Sparkles size={9} /> },
    failed: { label: 'Failed', cls: 'bg-rose-50 text-rose-700', icon: <AlertTriangle size={9} /> },
  };
  const m = map[doc.aiStatus];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${m.cls} mt-1`}>
      {m.icon} {m.label}
    </span>
  );
}

function DocDetailModal({ doc, onClose }: { doc: AccountDocument; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between">
          <div>
            <div className="text-sm font-bold text-slate-900">{doc.title}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {doc.kind.replace('_', ' ')} · uploaded {fmtDate(doc.uploadedAt)} {doc.uploadedBy && `· by ${doc.uploadedBy}`}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {doc.aiSummary && (
            <section>
              <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">AI Summary</h4>
              <p className="text-sm text-slate-800 leading-relaxed">{doc.aiSummary}</p>
            </section>
          )}
          {doc.aiTopics && (
            <TopicsView topics={doc.aiTopics} />
          )}
          {doc.rawText && (
            <section>
              <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">Full text</h4>
              <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap font-mono max-h-96 overflow-y-auto">{doc.rawText}</pre>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function TopicsView({ topics }: { topics: Record<string, unknown> }) {
  const sections: Array<{ key: string; label: string; render: () => JSX.Element | null }> = [
    { key: 'stakeholders', label: 'Stakeholders', render: () => renderKV(topics.stakeholders, ['name','role','notes']) },
    { key: 'technologies', label: 'Technologies', render: () => renderChips(topics.technologies) },
    { key: 'initiatives', label: 'Initiatives', render: () => renderKV(topics.initiatives, ['title','description']) },
    { key: 'risks', label: 'Risks', render: () => renderKV(topics.risks, ['title','severity','notes']) },
    { key: 'opportunities', label: 'Opportunities', render: () => renderKV(topics.opportunities, ['title','cloud','rationale','upsell_estimate_usd']) },
  ];
  return (
    <div className="space-y-3">
      {sections.map((s) => {
        const el = s.render();
        if (!el) return null;
        return (
          <section key={s.key}>
            <h4 className="text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">{s.label}</h4>
            {el}
          </section>
        );
      })}
    </div>
  );
}
function renderChips(v: unknown): JSX.Element | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {v.map((t, i) => <span key={i} className="text-[11px] bg-sky-50 text-sky-800 border border-sky-200 px-2 py-0.5 rounded-full">{String(t)}</span>)}
    </div>
  );
}
function renderKV(v: unknown, keys: string[]): JSX.Element | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {v.map((item, i) => {
        const o = (item ?? {}) as Record<string, unknown>;
        return (
          <li key={i} className="text-xs text-slate-800 border border-slate-100 rounded px-2 py-1.5">
            {keys.map((k) => {
              const val = o[k];
              if (val == null || val === '') return null;
              return <div key={k}><span className="text-slate-500 font-medium">{k}: </span>{String(val)}</div>;
            })}
          </li>
        );
      })}
    </ul>
  );
}
