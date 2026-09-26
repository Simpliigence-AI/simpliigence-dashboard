/**
 * New project: create the plan record, link it to its Current Projects entry
 * (so phases and dates flow to the pipeline view), set the team and dates.
 * The project page then offers SOW import or a starter template.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Drawer, Button } from '../../components/ui';
import { useDeliveryStore, NEW_CURRENT_PROJECT } from '../../store/useDeliveryStore';
import { alertError } from '../../lib/planToast';
import { Field, PeopleDatalist, inputClass } from './planUi';
import type { PipelineOption } from '../../types/delivery';

export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createProject, loadPipelineOptions } = useDeliveryStore.getState();
  const navigate = useNavigate();
  const [options, setOptions] = useState<PipelineOption[] | null>(null);
  const [optError, setOptError] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', client: '', pipelineProjectId: NEW_CURRENT_PROJECT, startDate: '', plannedEnd: '', pm: '', deliveryLead: '', architect: '', sponsor: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    loadPipelineOptions().then((o) => { if (live) setOptions(o); }).catch((e) => { if (live) { setOptions([]); setOptError((e as Error).message); } });
    return () => { live = false; };
  }, [open, loadPipelineOptions]);

  const free = useMemo(() => (options ?? []).filter((o) => !o.linkedTo), [options]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const pickPipeline = (id: string) => {
    const o = free.find((x) => x.id === id);
    setF((x) => ({
      ...x,
      pipelineProjectId: id,
      name: x.name || o?.name || '',
      startDate: x.startDate || (o?.startDate?.slice(0, 10) ?? ''),
      plannedEnd: x.plannedEnd || (o?.endDate?.slice(0, 10) ?? ''),
    }));
  };

  return (
    <Drawer open={open} onClose={onClose} title="New project" width="max-w-xl">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          try {
            const id = await createProject(f);
            onClose();
            navigate(`/project-plans/${id}?setup=1`);
          } catch (err) { alertError(err); } finally { setSaving(false); }
        }}
      >
        <Field label="Current Projects" hint="Phases, dates and completion flow to Current Projects automatically, and the project becomes available for allocation on the Team tab and in My Time. Choose “Plan only” to keep it off Current Projects.">
          {options === null ? (
            <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading…</div>
          ) : (
            <select value={f.pipelineProjectId} onChange={(e) => pickPipeline(e.target.value)} className={inputClass}>
              <option value={NEW_CURRENT_PROJECT}>+ Add as a new Current Project</option>
              <option value="">Plan only — not in Current Projects</option>
              {free.map((o) => <option key={o.id} value={o.id}>{o.name}{o.status ? ` · ${o.status}` : ''}</option>)}
            </select>
          )}
          {optError && <div className="mt-1 text-[11px] text-rose">{optError.includes('does not exist') ? 'Linking needs database update 036.' : optError}</div>}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project name *"><input required value={f.name} onChange={set('name')} className={inputClass} placeholder="e.g. Acme – Sales Cloud" /></Field>
          <Field label="Client"><input value={f.client} onChange={set('client')} className={inputClass} placeholder="e.g. Acme Corp" /></Field>
          <Field label="Start"><input type="date" value={f.startDate} onChange={set('startDate')} className={inputClass} /></Field>
          <Field label="Planned end (baseline)"><input type="date" value={f.plannedEnd} onChange={set('plannedEnd')} className={inputClass} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project manager"><input list="new-project-people" value={f.pm} onChange={set('pm')} className={inputClass} placeholder="Type a name" /></Field>
          <Field label="Delivery lead"><input list="new-project-people" value={f.deliveryLead} onChange={set('deliveryLead')} className={inputClass} /></Field>
          <Field label="Solution architect"><input list="new-project-people" value={f.architect} onChange={set('architect')} className={inputClass} /></Field>
          <Field label="Client sponsor" hint="Signs off change requests."><input value={f.sponsor} onChange={set('sponsor')} className={inputClass} placeholder="Name at the client" /></Field>
        </div>
        <PeopleDatalist id="new-project-people" />
        <div className="flex justify-end gap-2 border-t border-line/60 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving || !f.name.trim()}>{saving && <Loader2 size={14} className="animate-spin" />} Create and set up</Button>
        </div>
      </form>
    </Drawer>
  );
}
