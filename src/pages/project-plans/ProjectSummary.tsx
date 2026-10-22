/**
 * AI executive summary with a health flag. Written on demand from the plan,
 * issues, requests, change requests and the last week's change log, and
 * saved on the project so the list page and the Monday digest can show it.
 */
import { useState } from 'react';
import { Sparkles, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import { alertError } from '../../lib/planToast';
import { markdownToHtml, proseClass } from '../../lib/markdown';
import type { DeliveryProject } from '../../types/delivery';
import { HEALTH } from '../../lib/deliveryPlan';



export function ProjectSummary({ project, canEdit }: { project: DeliveryProject; canEdit: boolean }) {
  const refreshSummary = useDeliveryStore((s) => s.refreshSummary);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const h = project.health ? HEALTH[project.health] : null;

  if (!project.summary && !canEdit) return null;
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-2 text-sm font-semibold text-ink" disabled={!project.summary}>
          {project.summary ? (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}
          Summary
        </button>
        {h && <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${h.cls}`}><span className={`h-2 w-2 rounded-full ${h.dot}`} />{h.label}</span>}
        {project.summaryAt && <span className="text-xs text-muted">as of {new Date(project.summaryAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
        {!project.summary && <span className="text-xs text-muted">Get a one-paragraph read on where this project stands, for leadership or the client.</span>}
        {canEdit && (
          <button disabled={busy} onClick={async () => { setBusy(true); try { await refreshSummary(project.id); setOpen(true); } catch (e) { alertError(e); } finally { setBusy(false); } }}
            className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink disabled:opacity-60">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {project.summary ? 'Refresh' : 'Write summary'}
          </button>
        )}
      </div>
      {project.summary && open && (
        <div className={`mt-2 ${proseClass}`} dangerouslySetInnerHTML={{ __html: markdownToHtml(project.summary) }} />
      )}
    </div>
  );
}
