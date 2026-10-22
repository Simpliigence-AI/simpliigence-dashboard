/**
 * The project's SharePoint / OneDrive folder. Linking it lists every file in
 * the folder and its subfolders under Documents (files stay in SharePoint and
 * open there), re-synced nightly and on "Sync now". The text of each file is
 * pulled out so "Generate with AI" can read the SOW, notes and transcripts.
 */
import { useMemo, useState } from 'react';
import { FolderSync, Loader2, RefreshCw, Unlink, ExternalLink, Sparkles } from 'lucide-react';
import { Button } from '../../components/ui';
import { useDeliveryStore, type SpResult } from '../../store/useDeliveryStore';
import { alertError, toast } from '../../lib/planToast';

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function summary(r: SpResult): string {
  const bits = [r.added && `${r.added} new`, r.updated && `${r.updated} changed`, r.removed && `${r.removed} removed`].filter(Boolean);
  return `${r.total ?? 0} file${r.total === 1 ? '' : 's'} in the folder${bits.length ? ` — ${bits.join(', ')}` : ' — no changes'}`;
}

export function SharePointPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const project = useDeliveryStore((s) => s.projects.find((p) => p.id === projectId));
  const all = useDeliveryStore((s) => s.documents);
  const { linkSharePoint, syncSharePoint, unlinkSharePoint, readPendingDocs } = useDeliveryStore.getState();
  const docs = useMemo(() => all.filter((d) => d.projectId === projectId), [all, projectId]);
  const [url, setUrl] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const sp = docs.filter((d) => d.source === 'sharepoint');
  const readable = docs.filter((d) => d.textStatus === 'ok').length;
  const waiting = docs.filter((d) => d.textStatus === 'pending' || d.textStatus === 'reading').length;
  const legacy = project?.sharepointFolder && /^https:\/\//i.test(project.sharepointFolder) ? project.sharepointFolder : null;
  if (!project) return null;
  const linked = !!project.spFolderUrl;
  if (!linked && !canEdit) return null;

  /** Keep reading until nothing is waiting (each call reads a batch). */
  const readAll = async (first: number) => {
    let left = first;
    for (let i = 0; left > 0 && i < 15; i++) {
      setBusy(`Reading files for the AI… ${left} left`);
      left = await readPendingDocs(projectId);
    }
  };

  const link = async (target: string) => {
    setBusy('Linking and listing the folder…');
    try {
      const r = await linkSharePoint(projectId, target);
      toast(summary(r), 'ok');
      setUrl(''); setEditing(false);
      if (r.pending) await readAll(r.pending);
    } catch (e) { alertError(e); } finally { setBusy(null); }
  };

  if (!linked || editing) {
    return (
      <div className="rounded-xl border border-line bg-surface px-5 py-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink"><FolderSync size={16} className="text-primary" /> Link the project’s SharePoint folder</div>
        <p className="text-sm text-muted">
          Paste the folder where the team keeps this project’s files — SOW, requirements, designs, meeting recordings and transcripts. Every file in it (and its subfolders) shows up below and stays in step every night. Files stay in SharePoint; the AI reads their text when it writes user stories, test cases and process flows.
        </p>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void link(url); }}>
          <input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!!busy}
            placeholder="https://simpliigence.sharepoint.com/… (folder → Copy link)"
            className="flex-1 min-w-[20rem] rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          <Button type="submit" size="sm" disabled={!url.trim() || !!busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <FolderSync size={14} />} Link folder</Button>
          {editing && <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => setEditing(false)}>Cancel</Button>}
        </form>
        {legacy && !editing && (
          <p className="text-xs text-muted">
            Governance had this folder on the project: <a href={legacy} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{decodeURIComponent(legacy)}</a>{' '}
            <button disabled={!!busy} onClick={() => void link(legacy)} className="font-semibold text-primary hover:underline">Use it</button>
          </p>
        )}
        <p className="text-xs text-muted">In SharePoint or OneDrive: open the folder, click <strong>Copy link</strong> (or copy the address bar), paste it here. Recordings: open each one in Teams → <strong>Transcript</strong> → <strong>Download</strong>, and save the file into the same folder — the AI reads transcripts, not video.</p>
        {busy && <p className="text-xs text-muted flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> {busy}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-surface px-5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 min-w-0">
          <FolderSync size={16} className="shrink-0 text-primary" />
          <span className="text-sm text-muted">SharePoint folder</span>
          <a href={project.spFolderUrl!} target="_blank" rel="noreferrer" className="text-sm font-semibold text-ink hover:text-primary hover:underline truncate max-w-[22rem]" title={decodeURIComponent(project.spFolderUrl!)}>
            {project.spFolderName ?? 'Open'}
          </a>
          <ExternalLink size={12} className="text-muted" />
        </div>
        <span className="text-xs text-muted">{sp.length} file{sp.length === 1 ? '' : 's'} · synced {ago(project.spSyncedAt)}</span>
        <span className="inline-flex items-center gap-1 text-xs text-muted" title="Documents whose text the AI can read — SharePoint files and uploads">
          <Sparkles size={12} className="text-primary" /> {readable} readable by AI{waiting ? ` · ${waiting} being read` : ''}
        </span>
        {canEdit && (
          <div className="ml-auto flex items-center gap-1">
            {waiting > 0 && !busy && (
              <Button size="sm" variant="ghost" onClick={async () => { try { await readAll(waiting); } catch (e) { alertError(e); } finally { setBusy(null); } }}>Read now</Button>
            )}
            <Button size="sm" variant="secondary" disabled={!!busy} onClick={async () => {
              setBusy('Syncing…');
              try { const r = await syncSharePoint(projectId); toast(summary(r), 'ok'); if (r.pending) await readAll(r.pending); }
              catch (e) { alertError(e); } finally { setBusy(null); }
            }}>{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync now</Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => { setUrl(''); setEditing(true); }}>Change</Button>
            <button title="Unlink the folder" disabled={!!busy} className="p-1.5 text-muted/70 hover:text-rose"
              onClick={async () => {
                if (!window.confirm('Unlink this folder? Its files disappear from this list (nothing is deleted in SharePoint).')) return;
                try { await unlinkSharePoint(projectId); } catch (e) { alertError(e); }
              }}><Unlink size={14} /></button>
          </div>
        )}
      </div>
      {busy && <p className="mt-1.5 text-xs text-muted flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> {busy}</p>}
      {project.spSyncError && !busy && <p className="mt-1.5 text-xs text-rose">{project.spSyncError}</p>}
    </div>
  );
}
