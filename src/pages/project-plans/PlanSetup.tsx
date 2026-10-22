/**
 * Getting a plan in place: read the signed SOW with AI (scope list, phased
 * plan and heatmap features, previewed before anything is saved) or start
 * from a template. Shown on an empty plan and from the Plan toolbar.
 */
import { useMemo, useRef, useState } from 'react';
import { FileSearch, LayoutTemplate, Loader2, Upload, Sparkles, Check } from 'lucide-react';
import { Card, Button, Drawer } from '../../components/ui';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import { PLAN_TEMPLATES, addDays } from '../../lib/planTemplates';
import { alertError, toast } from '../../lib/planToast';
import { todayIso, fmtDate } from '../../lib/deliveryPlan';
import { Field, inputClass } from './planUi';
import type { SowProposal } from '../../types/delivery';

/** Next Monday on or after a date — plans start on a Monday. */
function monday(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const add = (8 - d.getDay()) % 7;
  return addDays(iso, add);
}

export function PlanSetupCard({ projectId }: { projectId: string }) {
  const [sow, setSow] = useState(false);
  const [tpl, setTpl] = useState(false);
  return (
    <Card>
      <div className="text-base font-bold text-ink">Set up the plan</div>
      <p className="mt-1 text-sm text-muted">Start from the signed SOW or a template. You can edit everything afterwards.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <button onClick={() => setSow(true)} className="text-left rounded-xl border border-line hover:border-primary hover:bg-primary/5 p-4">
          <div className="flex items-center gap-2 font-semibold text-ink"><FileSearch size={16} className="text-primary" /> Read the SOW with AI</div>
          <p className="mt-1 text-xs text-muted">Upload the signed SOW (PDF). Claude drafts the scope list, a phased plan and heatmap features. You review before anything is saved.</p>
        </button>
        <button onClick={() => setTpl(true)} className="text-left rounded-xl border border-line hover:border-primary hover:bg-primary/5 p-4">
          <div className="flex items-center gap-2 font-semibold text-ink"><LayoutTemplate size={16} className="text-primary" /> Start from a template</div>
          <p className="mt-1 text-xs text-muted">Sales Cloud, Service Cloud, CPQ, AI agent pilot or managed services — dated from your start date.</p>
        </button>
      </div>
      <SowImportDialog projectId={projectId} open={sow} onClose={() => setSow(false)} />
      <TemplateDialog projectId={projectId} open={tpl} onClose={() => setTpl(false)} />
    </Card>
  );
}

export function TemplateDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const project = useDeliveryStore((s) => s.projects.find((p) => p.id === projectId));
  const { applyTemplate } = useDeliveryStore.getState();
  const [key, setKey] = useState(PLAN_TEMPLATES[0].key);
  const [start, setStart] = useState(project?.startDate ?? monday(todayIso()));
  const [busy, setBusy] = useState(false);
  const t = PLAN_TEMPLATES.find((x) => x.key === key)!;
  return (
    <Drawer open={open} onClose={onClose} title="Start from a template" width="max-w-xl">
      <div className="space-y-4">
        <Field label="Template">
          <select value={key} onChange={(e) => setKey(e.target.value)} className={inputClass}>
            {PLAN_TEMPLATES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </Field>
        <Field label="Plan starts" hint={`Ends about ${fmtDate(addDays(start || todayIso(), t.weeks * 7 - 3))}.`}>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
        </Field>
        <div className="rounded-lg border border-line/70 p-3 text-sm space-y-2 max-h-80 overflow-y-auto">
          {t.phases.map((ph) => (
            <div key={ph.name}>
              <div className="font-semibold text-ink">{ph.name}</div>
              <ul className="text-xs text-muted pl-4 list-disc">{ph.tasks.map((x) => <li key={x.name}>{x.name} · week {x.start_week + 1}, {x.duration_weeks} wk</li>)}</ul>
            </div>
          ))}
          <div className="text-xs text-muted">Heatmap: {t.features.join(', ')} (added only if the heatmap is empty).</div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || !start} onClick={async () => {
            setBusy(true);
            try { await applyTemplate(projectId, key, start); toast('Plan created', 'ok'); onClose(); } catch (e) { alertError(e); } finally { setBusy(false); }
          }}>{busy && <Loader2 size={14} className="animate-spin" />} Add these tasks</Button>
        </div>
      </div>
    </Drawer>
  );
}

export function SowImportDialog({ projectId, open, onClose }: { projectId: string; open: boolean; onClose: () => void }) {
  const project = useDeliveryStore((s) => s.projects.find((p) => p.id === projectId));
  const docs = useDeliveryStore((s) => s.documents);
  const tasks = useDeliveryStore((s) => s.tasks);
  const { ai, uploadDocument, applySowProposal, readPendingDocs } = useDeliveryStore.getState();
  const readable = useMemo(() => docs.filter((d) => d.projectId === projectId && ((d.storagePath && /\.(pdf|md|txt)$/i.test(d.name)) || d.textStatus === 'ok'))
    .sort((a, b) => Number(b.state === 'frozen') - Number(a.state === 'frozen') || Number((b.docType ?? '').startsWith('SOW')) - Number((a.docType ?? '').startsWith('SOW'))), [docs, projectId]);
  const [docId, setDocId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [prop, setProp] = useState<SowProposal | null>(null);
  const [opts, setOpts] = useState({ scope: true, plan: true, features: true, replaceScope: false });
  const [start, setStart] = useState(project?.startDate ?? monday(todayIso()));
  const file = useRef<HTMLInputElement>(null);
  const hasPlan = tasks.some((t) => t.projectId === projectId);
  const selected = docId || readable[0]?.id || '';

  const run = async (id: string) => {
    setBusy('Reading the SOW… this takes about a minute.');
    try {
      const out = await ai<{ proposal: SowProposal }>('sow-parse', { projectId, documentId: id });
      setProp(out.proposal);
      setOpts((o) => ({ ...o, plan: !hasPlan, replaceScope: (project?.frozenRequirements.length ?? 0) === 0 }));
    } catch (e) { alertError(e); } finally { setBusy(null); }
  };

  const reset = () => { setProp(null); setBusy(null); onClose(); };

  return (
    <Drawer open={open} onClose={reset} title="Read the SOW with AI" width="max-w-2xl">
      {!prop ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">Pick the signed SOW — PDF or Word, uploaded here or in the project’s SharePoint folder.</p>
          {readable.length > 0 && (
            <Field label="From this project’s documents">
              <select value={selected} onChange={(e) => setDocId(e.target.value)} className={inputClass}>
                {readable.map((d) => <option key={d.id} value={d.id}>{d.name}{d.state === 'frozen' ? ' (frozen)' : ''}</option>)}
              </select>
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {readable.length > 0 && (
              <Button disabled={!!busy || !selected} onClick={() => run(selected)}><Sparkles size={14} /> Read this SOW</Button>
            )}
            <Button variant="secondary" disabled={!!busy} onClick={() => file.current?.click()}><Upload size={14} /> Upload a SOW</Button>
            <input ref={file} type="file" accept=".pdf,.docx,.md,.txt" className="hidden" onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setBusy(`Uploading ${f.name}…`);
              try {
                await uploadDocument(projectId, f, { docType: 'SOW', state: 'frozen' });
                const d = useDeliveryStore.getState().documents.find((x) => x.projectId === projectId && x.name === f.name);
                if (d && !/\.(pdf|md|txt)$/i.test(f.name)) {
                  setBusy('Reading the Word file…');
                  for (let i = 0; i < 5; i++) {
                    await readPendingDocs(projectId);
                    const st = useDeliveryStore.getState().documents.find((x) => x.id === d.id)?.textStatus;
                    if (st !== 'pending' && st !== 'reading') break;
                  }
                }
                if (d) await run(d.id); else setBusy(null);
              } catch (err) { alertError(err); setBusy(null); }
              if (file.current) file.current.value = '';
            }} />
          </div>
          {busy && <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> {busy}</div>}
        </div>
      ) : (
        <div className="space-y-5">
          <Section
            checked={opts.scope} onCheck={(v) => setOpts({ ...opts, scope: v })}
            title={`Scope list — ${prop.requirements.length} in scope, ${prop.exclusions.length} excluded`}
            extra={opts.scope && (project?.frozenRequirements.length ?? 0) > 0 && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={opts.replaceScope} onChange={(e) => setOpts({ ...opts, replaceScope: e.target.checked })} />
                Replace the current list ({project?.frozenRequirements.length} items) instead of adding to it
              </label>
            )}
          >
            <div className="grid gap-3 md:grid-cols-2 text-xs">
              <ol className="list-decimal pl-4 space-y-0.5">{prop.requirements.map((r, i) => <li key={i}>{r}</li>)}</ol>
              <ol className="list-decimal pl-4 space-y-0.5 text-rose">{prop.exclusions.map((r, i) => <li key={i}>{r}</li>)}</ol>
            </div>
          </Section>
          <Section
            checked={opts.plan} onCheck={(v) => setOpts({ ...opts, plan: v })}
            title={`Plan — ${prop.phases.length} phases, ${prop.phases.reduce((n, p) => n + p.tasks.length, 0)} tasks${prop.total_weeks ? `, ~${prop.total_weeks} weeks` : ''}`}
            extra={opts.plan && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs text-muted flex items-center gap-2">Starts <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded border border-line px-2 py-1 text-xs" /></label>
                {hasPlan && <span className="text-xs text-gold">This project already has tasks — these are added after them.</span>}
              </div>
            )}
          >
            <div className="text-xs space-y-2">
              {prop.phases.map((ph) => (
                <div key={ph.name}><div className="font-semibold">{ph.name}</div>
                  <ul className="list-disc pl-4 text-muted">{ph.tasks.map((t, i) => <li key={i}>{t.name} · wk {t.start_week + 1}{t.duration_weeks > 1 ? `–${t.start_week + t.duration_weeks}` : ''}</li>)}</ul>
                </div>
              ))}
              {prop.milestones?.length ? <div className="text-muted">Milestones in the SOW: {prop.milestones.join('; ')}</div> : null}
            </div>
          </Section>
          <Section checked={opts.features} onCheck={(v) => setOpts({ ...opts, features: v })} title={`Heatmap — ${prop.features.length} features`}>
            <div className="flex flex-wrap gap-1.5">{prop.features.map((f, i) => <span key={i} title={f.description} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs">{f.name}</span>)}</div>
          </Section>
          <div className="flex justify-end gap-2 border-t border-line/60 pt-4">
            <Button variant="ghost" onClick={() => setProp(null)}>Back</Button>
            <Button disabled={!!busy || (!opts.scope && !opts.plan && !opts.features)} onClick={async () => {
              setBusy('Saving…');
              try {
                await applySowProposal(projectId, prop, { ...opts, startDate: start });
                toast('Added from the SOW', 'ok');
                reset();
              } catch (e) { alertError(e); setBusy(null); }
            }}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Add the ticked sections</Button>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Section({ title, checked, onCheck, children, extra }: { title: string; checked: boolean; onCheck: (v: boolean) => void; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-4 ${checked ? 'border-primary/40 bg-primary/5' : 'border-line opacity-70'}`}>
      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} /> {title}
      </label>
      {extra && <div className="mt-2">{extra}</div>}
      <div className="mt-3 max-h-64 overflow-y-auto">{children}</div>
    </div>
  );
}
