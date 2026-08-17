/**
 * DocumentsPanel — per-week client-approved timesheet attachments.
 *
 * Shared between My Time (employee's own week) and Team Time (a manager/admin
 * managing an employee's week). All data access is parameterised by
 * `employeeEmail` + `periodStart`; RLS is the real gate on who may write.
 */
import { useEffect, useRef, useState } from 'react';
import { UploadCloud, Download, Loader2, FileText, AlertTriangle, Paperclip, Trash2 } from 'lucide-react';
import { Card } from '../ui';
import { useTimesheetDocsStore, timesheetDocsKey } from '../../store/useTimesheetDocsStore';
import type { TimesheetDocument } from '../../types/timeEntry';

function humanFileSize(n: number | null): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const DOC_ACCEPT = '.pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.csv';

export function DocumentsPanel({ employeeEmail, periodStart, periodEnd, uploadedBy }: {
  employeeEmail: string;
  periodStart: string;
  periodEnd: string;
  uploadedBy: string | null;
}) {
  const cacheKey = timesheetDocsKey(employeeEmail, periodStart);
  const docs = useTimesheetDocsStore((s) => s.docsByWeek[cacheKey]) ?? [];
  const loading = useTimesheetDocsStore((s) => s.loadingByWeek[cacheKey]) ?? false;
  const loadForWeek = useTimesheetDocsStore((s) => s.loadForWeek);
  const upload = useTimesheetDocsStore((s) => s.upload);
  const remove = useTimesheetDocsStore((s) => s.remove);
  const signedUrl = useTimesheetDocsStore((s) => s.signedUrl);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Refresh whenever the week (or employee) changes.
  useEffect(() => {
    if (employeeEmail) void loadForWeek(employeeEmail, periodStart);
  }, [employeeEmail, periodStart, loadForWeek]);

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const f of Array.from(files)) {
        await upload({ employeeEmail, periodStart, periodEnd, file: f, uploadedBy });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function download(doc: TimesheetDocument) {
    const url = await signedUrl(doc.storagePath);
    if (url) window.open(url, '_blank', 'noopener');
  }

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Paperclip size={15} className="text-muted/70" />
        <h3 className="text-sm font-semibold text-ink">Documents for this week</h3>
        <span className="text-[11px] text-muted/70">Attach the client-approved timesheet (PDF, image, Word, Excel)</span>
      </div>

      <div className="border-2 border-dashed border-line rounded-lg p-3 bg-surface-2/50 flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          accept={DOC_ACCEPT}
          onChange={(e) => onFiles(e.target.files)}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={uploading}
          className="text-xs font-semibold px-3 py-1.5 bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <UploadCloud size={12} />}
          {uploading ? 'Uploading…' : 'Upload document'}
        </button>
        <span className="text-[11px] text-muted">PDF, PNG/JPG/GIF/WebP, DOC/DOCX, XLS/XLSX/CSV · max 15 MB</span>
      </div>

      {error && (
        <div className="mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {loading && docs.length === 0 ? (
        <div className="text-center text-muted py-4 text-sm"><Loader2 className="inline w-3 h-3 animate-spin mr-1" /> Loading…</div>
      ) : docs.length === 0 ? (
        <div className="text-center text-muted/70 py-4 text-sm italic">No documents uploaded for this week yet.</div>
      ) : (
        <div className="mt-3 space-y-2">
          {docs.map((d) => (
            <div key={d.id} className="rounded-lg border border-line bg-white p-2.5 flex items-center gap-3">
              <FileText size={16} className="text-muted/70 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink truncate" title={d.filename}>{d.filename}</div>
                <div className="text-[11px] text-muted flex flex-wrap gap-x-2">
                  {d.sizeBytes && <span>{humanFileSize(d.sizeBytes)}</span>}
                  <span>uploaded {new Date(d.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                  {d.uploadedBy && <span>by {d.uploadedBy}</span>}
                </div>
              </div>
              <button type="button" onClick={() => download(d)} title="Download" className="p-1.5 text-muted/70 hover:text-ink/80">
                <Download size={15} />
              </button>
              <button
                type="button"
                onClick={() => { if (confirm(`Delete "${d.filename}"?`)) void remove(employeeEmail, periodStart, d); }}
                title="Delete"
                className="p-1.5 text-muted/70 hover:text-rose-600"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
