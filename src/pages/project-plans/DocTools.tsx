/**
 * Document tools: AI generation (user stories, test cases, process flows,
 * status report), an in-app viewer with reviewer comments and "regenerate
 * with comments", and copying documents from another project.
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles, Check, Undo2, Trash2, ExternalLink } from 'lucide-react';
import { Drawer, Button } from '../../components/ui';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import { supabase } from '../../lib/supabase';
import { alertError, toast } from '../../lib/planToast';
import { fmtDate } from '../../lib/deliveryPlan';
import { markdownToHtml, proseClass } from '../../lib/markdown';
import { Field, inputClass } from './planUi';
import type { DocGenerator, DeliveryDocument } from '../../types/delivery';

const KINDS: { key: DocGenerator; label: string; hint: string }[] = [
  { key: 'user_stories', label: 'User stories', hint: 'Epics and stories with acceptance criteria for every in-scope requirement.' },
  { key: 'test_cases', label: 'Test cases', hint: 'UAT test cases per feature, including negative paths.' },
  { key: 'process_flows', label: 'Process flows', hint: 'To-be processes with steps, decisions and flowcharts.' },
  { key: 'status_report', label: 'Status report', hint: 'Client-facing weekly report from the plan, issues and this week’s changes.' },
];

const TYPE_ORDER = ['SOW', 'Requirements', 'Meeting', 'Design', 'Process Flows', 'User Stories', 'Test Cases', 'Status', 'Other'];
const SOURCE_BUDGET = 250_000; // must match delivery-ai

export function GenerateDialog({ projectId, open, onClose, onDone }: { projectId: string; open: boolean; onClose: () => void; onDone: (docId: string) => void }) {
  const generateDocument = useDeliveryStore((s) => s.generateDocument);
  const readPendingDocs = useDeliveryStore((s) => s.readPendingDocs);
  const project = useDeliveryStore((s) => s.projects.find((p) => p.id === projectId));
  const allDocs = useDeliveryStore((s) => s.documents);
  const [kind, setKind] = useState<DocGenerator>('user_stories');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = all readable
  const noScope = (project?.frozenRequirements.length ?? 0) === 0;

  const docs = useMemo(() => allDocs.filter((d) => d.projectId === projectId), [allDocs, projectId]);
  const superseded = useMemo(() => new Set(docs.map((d) => d.supersedesId).filter(Boolean)), [docs]);
  const readable = useMemo(() => docs
    .filter((d) => d.textStatus === 'ok' && !superseded.has(d.id) && d.generator !== kind)
    .sort((a, b) => (a.state === 'frozen' ? -1 : 0) - (b.state === 'frozen' ? -1 : 0)
      || TYPE_ORDER.indexOf(a.docType ?? 'Other') - TYPE_ORDER.indexOf(b.docType ?? 'Other')
      || (b.modifiedAt ?? b.createdAt).localeCompare(a.modifiedAt ?? a.createdAt)), [docs, superseded, kind]);
  const waiting = docs.filter((d) => d.textStatus === 'pending' || d.textStatus === 'reading').length;
  const unreadable = docs.filter((d) => (d.textStatus === 'none' || d.textStatus === 'error') && d.source !== 'link');
  const isOn = (id: string) => (picked ? picked.has(id) : true);
  const chosen = readable.filter((d) => isOn(d.id));
  const chars = chosen.reduce((t, d) => t + (d.textChars ?? 0), 0);
  const toggle = (id: string) => setPicked((cur) => {
    const next = new Set(cur ?? readable.map((d) => d.id));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <Drawer open={open} onClose={() => !busy && onClose()} title="Generate with AI" width="max-w-2xl">
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <label key={k.key} className={`flex gap-3 rounded-lg border p-3 cursor-pointer ${kind === k.key ? 'border-primary bg-primary/5' : 'border-line'}`}>
              <input type="radio" checked={kind === k.key} onChange={() => { setKind(k.key); setPicked(null); }} className="mt-1" />
              <span><span className="block text-sm font-semibold text-ink">{k.label}</span><span className="block text-xs text-muted">{k.hint}</span></span>
            </label>
          ))}
        </div>

        <div className="rounded-lg border border-line">
          <div className="flex flex-wrap items-center gap-2 border-b border-line/60 px-3 py-2">
            <span className="text-sm font-semibold text-ink">Sources the AI reads</span>
            <span className="text-xs text-muted">{chosen.length} of {readable.length} document{readable.length === 1 ? '' : 's'}{chars > SOURCE_BUDGET ? ' · long ones are shortened to fit' : ''}</span>
            {readable.length > 0 && (
              <span className="ml-auto flex gap-2 text-xs font-semibold">
                <button className="text-muted hover:text-ink" onClick={() => setPicked(null)}>All</button>
                <button className="text-muted hover:text-ink" onClick={() => setPicked(new Set())}>None</button>
              </span>
            )}
          </div>
          {readable.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted">No readable documents yet. Link the project’s SharePoint folder or upload the SOW, requirements and meeting transcripts on the Documents tab — without them the AI works from the scope list and plan only.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto divide-y divide-line/40">
              {readable.map((d) => (
                <li key={d.id}>
                  <label className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-surface-2/50">
                    <input type="checkbox" checked={isOn(d.id)} onChange={() => toggle(d.id)} />
                    <span className="truncate flex-1 text-ink" title={d.spPath ? `${d.spPath}/${d.name}` : d.name}>{d.name}</span>
                    {d.state === 'frozen' && <span className="text-[10px] font-bold text-green">FROZEN</span>}
                    <span className="shrink-0 text-[11px] text-muted w-24 truncate">{d.docType ?? 'Other'}</span>
                    <span className="shrink-0 text-[11px] text-muted tabular-nums w-12 text-right">{Math.max(1, Math.round((d.textChars ?? 0) / 1000))}k</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {(waiting > 0 || unreadable.length > 0) && (
            <div className="border-t border-line/60 px-3 py-2 space-y-1 text-xs text-muted">
              {waiting > 0 && (
                <p className="flex items-center gap-2">
                  {reading && <Loader2 size={12} className="animate-spin" />}
                  {waiting} file{waiting === 1 ? ' is' : 's are'} still being read.
                  {!reading && <button className="font-semibold text-primary hover:underline" onClick={async () => {
                    setReading(true);
                    try { let left = waiting; for (let i = 0; left > 0 && i < 15; i++) left = await readPendingDocs(projectId); }
                    catch (e) { alertError(e); } finally { setReading(false); }
                  }}>Read now</button>}
                </p>
              )}
              {unreadable.length > 0 && (
                <p title={unreadable.slice(0, 25).map((d) => `${d.name}: ${d.textError ?? 'no text'}`).join('\n')} className="cursor-help">
                  {unreadable.length} can’t be read (videos, images, scanned PDFs) — hover for the list. For recordings, save the Teams transcript into the folder.
                </p>
              )}
            </div>
          )}
        </div>

        {noScope && kind !== 'status_report' && readable.length === 0 && <p className="text-xs text-gold">This project has no scope list and no readable documents yet, so the document will be thin.</p>}
        <Field label="Extra instructions (optional)">
          <textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} className={inputClass} placeholder="e.g. Focus on the quoting process; no record types in this org" />
        </Field>
        <p className="text-xs text-muted">Takes one to two minutes. If a version exists, the new one revises it and applies any open reviewer comments.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy || reading} onClick={async () => {
            setBusy(true);
            try {
              const doc = await generateDocument(projectId, kind, instructions, picked ? chosen.map((d) => d.id) : null);
              toast(`${doc.name} saved to Documents`, 'ok');
              setInstructions(''); setPicked(null); onClose(); onDone(doc.id);
            } catch (e) { alertError(e); } finally { setBusy(false); }
          }}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {busy ? 'Writing…' : 'Generate'}</Button>
        </div>
      </div>
    </Drawer>
  );
}

export function DocDrawer({ docId, canEdit, onClose, onOpenDoc }: { docId: string | null; canEdit: boolean; onClose: () => void; onOpenDoc: (id: string) => void }) {
  const doc = useDeliveryStore((s) => s.documents.find((d) => d.id === docId) ?? null);
  const allDocs = useDeliveryStore((s) => s.documents);
  const allFeedback = useDeliveryStore((s) => s.feedback);
  const { documentText, addFeedback, setFeedbackState, removeFeedback, generateDocument, documentUrl } = useDeliveryStore.getState();
  const [text, setText] = useState<{ id: string; body: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const isText = !!doc && /\.(md|txt)$/i.test(doc.name) && !!doc.storagePath;
  const feedback = useMemo(() => allFeedback.filter((f) => f.documentId === docId), [allFeedback, docId]);
  const versions = useMemo(() => (doc?.generator ? allDocs.filter((d) => d.projectId === doc.projectId && d.generator === doc.generator)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []), [allDocs, doc]);
  const latest = versions[0]?.id === doc?.id;

  useEffect(() => {
    if (!doc || !isText || text?.id === doc.id) return;
    let live = true;
    documentText(doc).then((b) => { if (live) { setText({ id: doc.id, body: b }); setErr(null); } }).catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [doc, isText, text?.id, documentText]);

  if (!doc) return null;
  const body = text?.id === doc.id ? text.body : null;
  const openComments = feedback.filter((f) => f.state === 'open').length;

  return (
    <Drawer open={!!docId} onClose={onClose} title={doc.name} width="max-w-4xl">
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{doc.docType ?? 'Other'}</span>·<span>{doc.state}</span>·<span>{doc.version ?? 'v1'}</span>·<span>updated {fmtDate((doc.modifiedAt ?? doc.createdAt).slice(0, 10))}</span>
          {doc.addedBy && <>·<span>{doc.addedBy}</span></>}
          <button className="ml-auto inline-flex items-center gap-1 font-semibold hover:text-ink" onClick={async () => {
            const w = window.open('', '_blank');
            try { const u = await documentUrl(doc); if (w) { w.opener = null; w.location.href = u; } } catch (e) { w?.close(); alertError(e); }
          }}><ExternalLink size={12} /> Open file</button>
        </div>

        {versions.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {versions.map((v) => (
              <button key={v.id} onClick={() => onOpenDoc(v.id)} className={`px-2 py-0.5 rounded text-xs font-semibold ${v.id === doc.id ? 'bg-ink text-white' : 'bg-surface-2 text-muted hover:text-ink'}`}>{v.version}</button>
            ))}
          </div>
        )}

        {isText && (
          <div className="rounded-xl border border-line/70 p-5 max-h-[55vh] overflow-y-auto">
            {err ? <p className="text-sm text-rose">{err}</p> : body === null ? (
              <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            ) : doc.name.toLowerCase().endsWith('.md') ? (
              <div className={proseClass} dangerouslySetInnerHTML={{ __html: markdownToHtml(body) }} />
            ) : <pre className="whitespace-pre-wrap text-sm">{body}</pre>}
          </div>
        )}

        {!isText && <AiText doc={doc} canEdit={canEdit} />}

        <div>
          <div className="text-sm font-semibold text-ink mb-2">Review comments {openComments > 0 && <span className="text-gold">· {openComments} open</span>}</div>
          <ul className="space-y-2">
            {feedback.map((f) => (
              <li key={f.id} className={`rounded-lg border px-3 py-2 text-sm ${f.state === 'resolved' ? 'border-line/50 text-muted' : 'border-gold/40 bg-gold/5 text-ink'}`}>
                <div className="flex items-start gap-2">
                  <p className={`flex-1 whitespace-pre-line ${f.state === 'resolved' ? 'line-through decoration-muted/40' : ''}`}>{f.body}</p>
                  {canEdit && (
                    <div className="flex gap-1.5 text-muted">
                      <button title={f.state === 'open' ? 'Mark resolved' : 'Reopen'} className="hover:text-ink" onClick={() => setFeedbackState(f.id, f.state === 'open' ? 'resolved' : 'open').catch(alertError)}>
                        {f.state === 'open' ? <Check size={14} /> : <Undo2 size={14} />}
                      </button>
                      <button title="Delete" className="hover:text-rose" onClick={() => removeFeedback(f.id).catch(alertError)}><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-muted">{f.author ?? '—'} · {fmtDate(f.createdAt.slice(0, 10))}{f.state === 'resolved' && ' · resolved'}</div>
              </li>
            ))}
            {feedback.length === 0 && <li className="text-sm text-muted">No comments.</li>}
          </ul>
          {canEdit && (
            <form className="mt-2 flex gap-2" onSubmit={async (e) => { e.preventDefault(); try { await addFeedback(doc, comment); setComment(''); } catch (er) { alertError(er); } }}>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a review comment" className="flex-1 rounded-lg border border-line px-3 py-2 text-sm" />
              <Button type="submit" size="sm" disabled={!comment.trim()}>Add</Button>
            </form>
          )}
        </div>

        {canEdit && doc.generator && latest && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line/60 pt-4">
            <Button disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const next = await generateDocument(doc.projectId, doc.generator!);
                toast(`${next.version} written${openComments ? ` with ${openComments} comment${openComments === 1 ? '' : 's'} applied` : ''}`, 'ok');
                onOpenDoc(next.id);
              } catch (e) { alertError(e); } finally { setBusy(false); }
            }}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Regenerate{openComments ? ` with ${openComments} comment${openComments === 1 ? '' : 's'}` : ''}</Button>
            <span className="text-xs text-muted">Saves a new version; this one stays in the history.</span>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/** The text pulled out of a file for the AI, and a way to read it again. */
function AiText({ doc, canEdit }: { doc: DeliveryDocument; canEdit: boolean }) {
  const readPendingDocs = useDeliveryStore((s) => s.readPendingDocs);
  const [text, setText] = useState<{ id: string; body: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = doc.textStatus;
  if (!s || (s === 'none' && doc.source === 'link')) return null;
  const load = async () => {
    setOpen((v) => !v);
    if (text?.id === doc.id) return;
    const { data, error } = await supabase.from('delivery_document_text').select('body').eq('document_id', doc.id).maybeSingle();
    if (error) { alertError(new Error(error.message)); return; }
    setText({ id: doc.id, body: data?.body ?? '' });
  };
  const again = canEdit && (
    <button disabled={busy} className="font-semibold text-primary hover:underline disabled:opacity-60" onClick={async () => {
      setBusy(true); setText(null);
      try { await readPendingDocs(doc.projectId, doc.id); } catch (e) { alertError(e); } finally { setBusy(false); }
    }}>{busy ? 'Reading…' : 'Read again'}</button>
  );
  return (
    <div className="rounded-lg border border-line/70 px-4 py-3 text-sm">
      {s === 'ok' ? (
        <>
          <div className="flex items-center gap-3">
            <button onClick={() => void load()} className="inline-flex items-center gap-1.5 font-semibold text-ink"><Sparkles size={13} className="text-primary" /> Text the AI reads</button>
            <span className="text-xs text-muted">{Math.round((doc.textChars ?? 0) / 1000)}k characters</span>
            <span className="ml-auto text-xs">{again}</span>
          </div>
          {open && (
            <pre className="mt-2 max-h-72 overflow-y-auto whitespace-pre-wrap text-xs text-muted">
              {text?.id === doc.id ? `${text.body.slice(0, 20000)}${text.body.length > 20000 ? '\n…' : ''}` : 'Loading…'}
            </pre>
          )}
        </>
      ) : s === 'pending' || s === 'reading' ? (
        <p className="text-xs text-muted flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Pulling out the text for the AI…</p>
      ) : (
        <p className="text-xs text-muted">The AI can’t read this file: {doc.textError ?? 'no text found'}. <span className="ml-1">{again}</span></p>
      )}
    </div>
  );
}

export function CopyDocsDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const projects = useDeliveryStore((s) => s.projects);
  const copyDocuments = useDeliveryStore((s) => s.copyDocuments);
  const [from, setFrom] = useState('');
  const [list, setList] = useState<{ id: string; name: string; doc_type: string | null; storage_path: string | null; web_url: string | null }[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!from) return;
    let live = true;
    void supabase.from('delivery_documents').select('id, name, doc_type, storage_path, web_url').eq('project_id', from).order('name')
      .then(({ data }) => { if (live) { setList(data ?? []); setPicked({}); } });
    return () => { live = false; };
  }, [from]);

  const n = Object.values(picked).filter(Boolean).length;
  return (
    <Drawer open={open} onClose={onClose} title="Copy documents from another project" width="max-w-xl">
      <div className="space-y-4">
        <Field label="From project">
          <select value={from} onChange={(e) => { setList(null); setFrom(e.target.value); }} className={inputClass}>
            <option value="">— Pick a project —</option>
            {projects.filter((p) => p.id !== projectId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        {from && list === null && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>}
        {list && (list.length === 0 ? <p className="text-sm text-muted">That project has no documents.</p> : (
          <ul className="max-h-80 overflow-y-auto rounded-lg border border-line divide-y divide-line/50">
            {list.map((d) => {
              const ready = !!(d.storage_path || d.web_url);
              return (
                <li key={d.id} className="px-3 py-2">
                  <label className={`flex items-center gap-2 text-sm ${ready ? '' : 'opacity-50'}`}>
                    <input type="checkbox" disabled={!ready} checked={!!picked[d.id]} onChange={(e) => setPicked({ ...picked, [d.id]: e.target.checked })} />
                    <span className="flex-1 truncate">{d.name}</span><span className="text-xs text-muted">{ready ? d.doc_type : 'still copying'}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!n || busy} onClick={async () => {
            setBusy(true);
            try { const c = await copyDocuments(from, Object.keys(picked).filter((k) => picked[k]), projectId); toast(`Copied ${c} document${c === 1 ? '' : 's'}`, 'ok'); onClose(); }
            catch (e) { alertError(e); } finally { setBusy(false); }
          }}>{busy && <Loader2 size={14} className="animate-spin" />} Copy {n || ''}</Button>
        </div>
      </div>
    </Drawer>
  );
}
