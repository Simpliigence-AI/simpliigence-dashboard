/**
 * Issues the hourly extractor pulled out of email, Teams, Slack, status
 * reports or Concierge ticket mail. Nothing counts until a person accepts it;
 * accepting creates the real issue (and it then shows on the heat map).
 */
import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Check, X, Mail, MessageSquare, FileText, Hash, Ticket, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { Card, Button } from '../../components/ui';
import { alertError, toast } from '../../lib/planToast';
import { loadSuggestions, decideSuggestion, lastExtractionRun, runExtractionNow, SOURCE_LABEL } from '../../lib/deliveryRebuild';
import type { ExtractedIssue, IssueCriticality } from '../../types/delivery';

const ICON = { email: Mail, teams: MessageSquare, slack: Hash, status_report: FileText, ticket: Ticket } as const;
const CRIT: IssueCriticality[] = ['low', 'medium', 'high', 'critical'];
const CRIT_CLS: Record<IssueCriticality, string> = {
  low: 'text-muted', medium: 'text-amber-600', high: 'text-rose', critical: 'text-rose font-bold',
};

export function SuggestedIssues({ projectId, conciergeAccountId, canEdit, onDecided, compact }: {
  projectId?: string; conciergeAccountId?: string; canEdit: boolean; onDecided?: () => void; compact?: boolean;
}) {
  const [rows, setRows] = useState<ExtractedIssue[] | null>(null);
  const [run, setRun] = useState<{ at: string; ok: boolean; error: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([loadSuggestions({ projectId, conciergeAccountId }), lastExtractionRun()]);
      setRows(s); setRun(r);
    } catch (e) { alertError(e); setRows([]); }
  }, [projectId, conciergeAccountId]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (x: ExtractedIssue, accept: boolean, crit?: IssueCriticality) => {
    setBusy(x.id);
    try {
      await decideSuggestion(x.id, accept, crit);
      setRows((r) => (r ?? []).filter((y) => y.id !== x.id));
      toast(accept ? 'Added to the issue log' : 'Dismissed', 'ok');
      onDecided?.();
    } catch (e) { alertError(e); } finally { setBusy(null); }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const r = await runExtractionNow();
      toast(`Checked sources — ${r?.suggested ?? 0} new suggestion${r?.suggested === 1 ? '' : 's'}`, 'ok');
      await load();
    } catch (e) { alertError(e); } finally { setRunning(false); }
  };

  if (rows === null) return <Card><div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Checking for suggested issues…</div></Card>;
  if (compact && rows.length === 0) return null;

  return (
    <Card flush>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-line/60">
        <Sparkles size={16} className="text-violet-500" />
        <div className="font-bold text-ink">Suggested issues <span className="text-muted font-normal tabular-nums">{rows.length}</span></div>
        <div className="text-xs text-muted">
          Pulled from email, Teams, Slack{conciergeAccountId ? ', ticket mail' : ' and status reports'}. Accept to log it, dismiss if it isn’t one.
        </div>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted">
          {run && <span title={run.error ?? ''} className={run.ok ? '' : 'text-rose'}>Last checked {new Date(run.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{run.ok ? '' : ' · a source failed'}</span>}
          {canEdit && <Button size="sm" variant="ghost" onClick={runNow} disabled={running}>{running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Check now</Button>}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-4 text-sm text-muted">Nothing waiting. New suggestions appear here within the hour.</div>
      ) : (
        <ul className="divide-y divide-line/50">
          {rows.map((x) => {
            const Icon = ICON[x.source] ?? Mail;
            return (
              <li key={x.id} className="px-5 py-3">
                <div className="flex items-start gap-3">
                  <Icon size={15} className="mt-0.5 text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink">{x.description}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                      <span className={`uppercase font-semibold ${CRIT_CLS[x.criticality]}`}>{x.criticality}</span>
                      <span>{SOURCE_LABEL[x.source]}{x.sourceFrom ? ` · ${x.sourceFrom}` : ''}{x.sourceAt ? ` · ${new Date(x.sourceAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}</span>
                      {x.sourceTitle && <span className="truncate max-w-[22rem]" title={x.sourceTitle}>“{x.sourceTitle}”</span>}
                      {x.ownerHint && <span>Owner: {x.ownerHint}</span>}
                      {x.dueHint && <span>Due {x.dueHint}</span>}
                      {x.sourceExcerpt && <button className="underline hover:text-ink" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? 'Hide source' : 'Show source'}</button>}
                      {x.sourceUrl && <a href={x.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-ink">Open <ExternalLink size={10} /></a>}
                    </div>
                    {open === x.id && x.sourceExcerpt && <div className="mt-2 rounded-lg bg-surface-2/70 px-3 py-2 text-xs text-ink/80 whitespace-pre-wrap">{x.sourceExcerpt}</div>}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <select defaultValue={x.criticality} id={`crit-${x.id}`} disabled={busy === x.id}
                        className="text-xs rounded-md border border-line bg-surface px-1.5 py-1">
                        {CRIT.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <Button size="sm" disabled={busy === x.id}
                        onClick={() => decide(x, true, (document.getElementById(`crit-${x.id}`) as HTMLSelectElement | null)?.value as IssueCriticality)}>
                        <Check size={13} /> Accept
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === x.id} onClick={() => decide(x, false)}><X size={13} /> Dismiss</Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
