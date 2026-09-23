/**
 * Project documents: SOWs, requirements, designs, status reports, meeting
 * recordings. Files live in the private 'delivery-documents' bucket and open
 * through a short-lived signed link. A linked SharePoint folder lists its files
 * here too (source 'sharepoint', opened in SharePoint). Every document's text
 * is pulled out for the AI (migration 037). Frozen SOW PDFs are what the
 * scope classifier reads.
 */
import { useMemo, useRef, useState } from 'react';
import { FileText, FileSpreadsheet, FileImage, FileVideo, Presentation, Link2, Download, Trash2, Upload, Loader2, Lock, Search, Sparkles, MessageSquare, Copy, FolderSync } from 'lucide-react';
import { DocDrawer, GenerateDialog, CopyDocsDialog } from './DocTools';
import { SharePointPanel } from './SharePointPanel';
import { Card, Button, EmptyState } from '../../components/ui';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import { alertError, toast } from '../../lib/planToast';
import { fmtDate } from '../../lib/deliveryPlan';
import type { DeliveryDocument, DocumentState } from '../../types/delivery';

const DOC_TYPES = ['SOW', 'Requirements', 'Design', 'User Stories', 'Process Flows', 'Test Cases', 'Meeting', 'Status', 'Other'];

const STATE: Record<DocumentState, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-surface-2 text-muted ring-line' },
  review: { label: 'In review', cls: 'bg-gold/15 text-gold ring-gold/30' },
  frozen: { label: 'Frozen', cls: 'bg-green/15 text-green ring-green/30' },
};

function fmtSize(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function DocIcon({ d }: { d: DeliveryDocument }) {
  const ext = d.name.split('.').pop()?.toLowerCase() ?? '';
  const cls = 'shrink-0 text-muted';
  if (d.source === 'link') return <Link2 size={16} className={cls} />;
  if (['xlsx', 'xls', 'csv'].includes(ext)) return <FileSpreadsheet size={16} className={cls} />;
  if (['pptx', 'ppt'].includes(ext)) return <Presentation size={16} className={cls} />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return <FileImage size={16} className={cls} />;
  if (['mp4', 'mov', 'webm', 'm4v', 'mkv', 'avi', 'mp3', 'm4a', 'wav'].includes(ext)) return <FileVideo size={16} className={cls} />;
  return <FileText size={16} className={cls} />;
}

export function DocumentsTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const all = useDeliveryStore((s) => s.documents);
  const docs = useMemo(() => all.filter((d) => d.projectId === projectId), [all, projectId]);
  const [type, setType] = useState('all');
  const [src, setSrc] = useState<'all' | 'sharepoint' | 'files' | 'generated'>('all');
  const [q, setQ] = useState('');

  const types = useMemo(() => {
    const seen = new Set(docs.map((d) => d.docType ?? 'Other'));
    return DOC_TYPES.filter((t) => seen.has(t)).concat([...seen].filter((t) => !DOC_TYPES.includes(t)));
  }, [docs]);
  const hasSp = docs.some((d) => d.source === 'sharepoint');
  const shown = docs.filter((d) =>
    (type === 'all' || (d.docType ?? 'Other') === type) &&
    (src === 'all' || (src === 'sharepoint' ? d.source === 'sharepoint' : src === 'generated' ? d.source === 'generated' : d.source === 'upload' || d.source === 'link')) &&
    (!q.trim() || `${d.spPath ?? ''}/${d.name}`.toLowerCase().includes(q.trim().toLowerCase())));
  const moving = docs.filter((d) => d.legacyId && !d.storagePath && !d.importError).length;
  const [viewing, setViewing] = useState<string | null>(null);
  const [gen, setGen] = useState(false);
  const [copy, setCopy] = useState(false);
  const feedback = useDeliveryStore((s) => s.feedback);
  const openComments = (id: string) => feedback.filter((f) => f.documentId === id && f.state === 'open').length;

  return (
    <div className="space-y-4">
      <SharePointPanel projectId={projectId} canEdit={canEdit} />
      {canEdit && <AddDocuments projectId={projectId} />}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setGen(true)}><Sparkles size={14} /> Generate with AI</Button>
          <Button size="sm" variant="ghost" onClick={() => setCopy(true)}><Copy size={14} /> Copy from another project</Button>
        </div>
      )}
      <GenerateDialog projectId={projectId} open={gen} onClose={() => setGen(false)} onDone={(id) => setViewing(id)} />
      <CopyDocsDialog projectId={projectId} open={copy} onClose={() => setCopy(false)} />
      <DocDrawer docId={viewing} canEdit={canEdit} onClose={() => setViewing(null)} onOpenDoc={setViewing} />

      {moving > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-4 py-2.5 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" />
          {moving} file{moving === 1 ? ' is' : 's are'} still being copied over from Governance. They’ll open once the copy finishes.
        </div>
      )}

      <Card flush>
        {docs.length === 0 ? (
          <EmptyState icon={<FileText size={32} />} title="No documents yet" description="Link the project’s SharePoint folder above, or upload the signed SOW, requirements, designs and status reports, so the whole team — and the AI — works from the same files." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-line/60">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents"
                  className="w-56 rounded-lg border border-line bg-surface pl-8 pr-3 py-1.5 text-sm" />
              </div>
              {hasSp && (
                <select value={src} onChange={(e) => setSrc(e.target.value as typeof src)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm">
                  <option value="all">All sources</option>
                  <option value="sharepoint">SharePoint folder</option>
                  <option value="files">Uploaded here</option>
                  <option value="generated">AI-generated</option>
                </select>
              )}
              <div className="flex flex-wrap gap-1">
                {['all', ...types].map((t) => (
                  <button key={t} onClick={() => setType(t)}
                    className={`px-2.5 py-1 rounded-md text-xs font-semibold ${type === t ? 'bg-ink text-white' : 'text-muted hover:text-ink hover:bg-surface-2'}`}>
                    {t === 'all' ? `All ${docs.length}` : `${t} ${docs.filter((d) => (d.docType ?? 'Other') === t).length}`}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted border-b border-line/60">
                    <th className="px-5 py-2">Name</th>
                    <th className="px-3 py-2 w-40">Type</th>
                    <th className="px-3 py-2 w-32">State</th>
                    <th className="px-3 py-2 w-20 text-right">Size</th>
                    <th className="px-3 py-2 w-28">Updated</th>
                    <th className="px-3 py-2 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((d) => <DocRow key={d.id} d={d} canEdit={canEdit} comments={openComments(d.id)} onView={() => setViewing(d.id)} />)}
                  {shown.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-6 text-center text-sm text-muted">No documents match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
      <p className="text-xs text-muted">Mark the signed SOW <strong>Frozen</strong> (as a PDF) — the scope check on the Requests tab reads it when judging client requests. <Sparkles size={11} className="inline text-primary/70" /> marks files the AI reads when it generates documents.</p>
    </div>
  );
}

/** Whether the AI can read this document (its text is pulled out after upload / sync). */
function AiBadge({ d }: { d: DeliveryDocument }) {
  const s = d.textStatus;
  if (!s || (s === 'none' && d.source === 'link')) return null;
  if (s === 'ok') {
    return <span title={`The AI reads this (${Math.round((d.textChars ?? 0) / 1000)}k characters)`} className="shrink-0 text-primary/70"><Sparkles size={12} /></span>;
  }
  if (s === 'pending' || s === 'reading') return <span className="shrink-0 text-[11px] text-muted" title="Pulling out the text for the AI">reading…</span>;
  return <span className="shrink-0 text-[11px] text-muted/80 underline decoration-dotted cursor-help" title={d.textError ?? 'The AI can’t read this file.'}>AI can’t read</span>;
}

function DocRow({ d, canEdit, comments, onView }: { d: DeliveryDocument; canEdit: boolean; comments: number; onView: () => void }) {
  const { updateDocument, removeDocument, documentUrl } = useDeliveryStore.getState();
  const pending = !d.webUrl && !d.storagePath;
  const st = STATE[d.state] ?? STATE.review;

  const open = async (download = false) => {
    // Open the tab synchronously so the popup blocker allows it, then point it at the signed link.
    const w = download ? null : window.open('', '_blank');
    try {
      const url = await documentUrl(d, download);
      if (w) { w.opener = null; w.location.href = url; } else window.location.assign(url);
    } catch (err) {
      w?.close();
      alertError(err);
    }
  };

  return (
    <tr className="border-b border-line/40 last:border-0 hover:bg-surface-2/40">
      <td className="px-5 py-2">
        <div className="flex items-center gap-2 min-w-[16rem]">
          <DocIcon d={d} />
          <button disabled={pending} onClick={() => (/\.(md|txt)$/i.test(d.name) && d.storagePath ? onView() : open())} title={pending ? (d.importError ? `Copy failed: ${d.importError}` : 'Still being copied from Governance') : 'Open'}
            className="text-left font-medium text-ink hover:text-primary hover:underline disabled:text-muted disabled:no-underline disabled:cursor-default truncate max-w-[32rem]">
            {d.name}
          </button>
          {d.version && d.version !== 'v1' && <span className="text-[11px] text-muted">{d.version}</span>}
          {pending && <span className={`text-[11px] ${d.importError ? 'text-rose' : 'text-muted'}`}>{d.importError ? 'copy failed' : 'copying…'}</span>}
          <AiBadge d={d} />
        </div>
        {d.source === 'sharepoint' && (
          <div className="ml-6 mt-0.5 flex items-center gap-1 text-[11px] text-muted truncate max-w-[32rem]" title="In the linked SharePoint folder">
            <FolderSync size={11} className="shrink-0" /> {d.spPath ? d.spPath : 'SharePoint folder'}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <select value={d.docType ?? 'Other'} disabled={!canEdit}
          onChange={(e) => updateDocument(d.id, { docType: e.target.value }).catch(alertError)}
          className="w-full bg-transparent rounded px-1 py-1 text-sm border border-transparent hover:border-line disabled:hover:border-transparent">
          {[...new Set([...DOC_TYPES, d.docType ?? 'Other'])].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="px-3 py-2">
        {canEdit ? (
          <select value={d.state} onChange={(e) => updateDocument(d.id, { state: e.target.value as DocumentState }).catch(alertError)}
            className={`rounded-md px-2 py-1 text-xs font-bold ring-1 ring-inset border-0 ${st.cls}`}>
            <option value="draft">Draft</option>
            <option value="review">In review</option>
            <option value="frozen">Frozen</option>
          </select>
        ) : (
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold ring-1 ring-inset ${st.cls}`}>
            {d.state === 'frozen' && <Lock size={11} />}{st.label}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-muted">{d.source === 'link' ? 'link' : fmtSize(d.sizeBytes)}</td>
      <td className="px-3 py-2 text-muted whitespace-nowrap">{fmtDate((d.modifiedAt ?? d.createdAt).slice(0, 10))}</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-2">
          <button title="Comments and details" className={`inline-flex items-center gap-0.5 ${comments ? 'text-gold' : 'text-muted hover:text-ink'}`} onClick={onView}>
            <MessageSquare size={14} />{comments > 0 && <span className="text-[10px] font-bold">{comments}</span>}
          </button>
          {d.storagePath && (
            <button title="Download" className="text-muted hover:text-ink" onClick={() => open(true)}><Download size={14} /></button>
          )}
          {canEdit && d.source !== 'sharepoint' && (
            <button title="Delete" className="text-muted/60 hover:text-rose"
              onClick={() => { if (window.confirm(`Delete “${d.name}”? This removes the file for everyone.`)) removeDocument(d.id).catch(alertError); }}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function AddDocuments({ projectId }: { projectId: string }) {
  const { uploadDocument, addDocumentLink } = useDeliveryStore.getState();
  const input = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState('Status');
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState({ name: '', url: '' });

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    let ok = 0;
    for (const [n, f] of list.entries()) {
      setBusy(list.length > 1 ? `Uploading ${n + 1} of ${list.length}…` : `Uploading ${f.name}…`);
      try { await uploadDocument(projectId, f, { docType }); ok += 1; } catch (err) { alertError(err); }
    }
    setBusy(null);
    if (ok) toast(ok === 1 ? 'Uploaded' : `Uploaded ${ok} files`, 'ok');
    if (input.current) input.current.value = '';
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void upload(e.dataTransfer.files); }}
      className={`rounded-xl border-2 border-dashed px-5 py-4 transition-colors ${drag ? 'border-primary bg-primary/5' : 'border-line bg-surface'}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Upload size={18} className="text-muted" />
        <span className="text-sm text-muted">Drop files here, or</span>
        <Button size="sm" disabled={!!busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Choose files
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted">
          as
          <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink">
            {DOC_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <button onClick={() => setLinkOpen((v) => !v)} className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink">
          <Link2 size={14} /> Add a link to one file
        </button>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => e.target.files && void upload(e.target.files)} />
      </div>
      {busy && <div className="mt-2 text-xs text-muted">{busy}</div>}
      {linkOpen && (
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await addDocumentLink(projectId, { ...link, docType });
              setLink({ name: '', url: '' }); setLinkOpen(false);
            } catch (err) { alertError(err); }
          }}
        >
          <input value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://simpliigence.sharepoint.com/…"
            className="flex-1 min-w-[18rem] rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" />
          <input value={link.name} onChange={(e) => setLink({ ...link, name: e.target.value })} placeholder="Name (optional)"
            className="w-56 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" />
          <Button type="submit" size="sm" disabled={!link.url.trim()}>Add link</Button>
        </form>
      )}
    </div>
  );
}
