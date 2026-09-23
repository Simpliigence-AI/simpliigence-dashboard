/**
 * Feature heatmap: every feature in scope with its build state and whether
 * the client has seen it demoed. Click a state chip to cycle it.
 */
import { useState } from 'react';
import { Plus, Trash2, LayoutGrid } from 'lucide-react';
import { Card, Button, EmptyState } from '../../components/ui';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import { EditCell } from './planUi';
import { alertError } from '../../lib/planToast';
import type { DeliveryFeature, FeatureCompletion, FeatureDemo } from '../../types/delivery';

const COMPLETION: Record<FeatureCompletion, { label: string; cls: string; next: FeatureCompletion }> = {
  not_started: { label: 'Not started', cls: 'bg-surface-2 text-muted ring-line', next: 'partial' },
  partial: { label: 'In progress', cls: 'bg-gold/15 text-gold ring-gold/30', next: 'complete' },
  complete: { label: 'Built', cls: 'bg-green/15 text-green ring-green/30', next: 'not_started' },
};
const DEMO: Record<FeatureDemo, { label: string; cls: string; next: FeatureDemo }> = {
  not_demoed: { label: 'Not demoed', cls: 'bg-surface-2 text-muted ring-line', next: 'demoed' },
  demoed: { label: 'Demoed', cls: 'bg-brand/15 text-brand-dark ring-brand/30', next: 'not_demoed' },
};

export function HeatmapTab({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const all = useDeliveryStore((s) => s.features);
  const { addFeature, updateFeature, removeFeature } = useDeliveryStore.getState();
  const features = all.filter((f) => f.projectId === projectId);
  const [name, setName] = useState('');

  const built = features.filter((f) => f.completionState === 'complete').length;
  const partial = features.filter((f) => f.completionState === 'partial').length;
  const demoed = features.filter((f) => f.demoState === 'demoed').length;

  return (
    <div className="space-y-4">
      {features.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <Summary label="Built" n={built} of={features.length} bar="bg-green" />
          <Summary label="In progress" n={partial} of={features.length} bar="bg-gold" />
          <Summary label="Demoed to client" n={demoed} of={features.length} bar="bg-brand" />
        </div>
      )}

      <Card flush>
        {features.length === 0 ? (
          <EmptyState icon={<LayoutGrid size={32} />} title="No features yet" description="List the features or modules in scope so the team and client can see what’s built and what’s been shown." />
        ) : (
          <ul>
            {features.map((f) => <FeatureRow key={f.id} f={f} canEdit={canEdit} onUpdate={updateFeature} onRemove={removeFeature} />)}
          </ul>
        )}
        {canEdit && (
          <form
            className="flex gap-3 items-center px-5 py-3 border-t border-line/60"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim()) return;
              try { await addFeature(projectId, { name }); setName(''); } catch (err) { alertError(err); }
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a feature, e.g. Opportunity Management"
              className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink" />
            <Button type="submit" size="sm" disabled={!name.trim()}><Plus size={14} /> Add</Button>
          </form>
        )}
      </Card>
    </div>
  );
}

function Summary({ label, n, of, bar }: { label: string; n: number; of: number; bar: string }) {
  const pct = of ? Math.round((n / of) * 100) : 0;
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-4 py-3">
      <div className="flex justify-between text-[11px] font-semibold uppercase tracking-wide text-muted"><span>{label}</span><span className="tabular-nums">{n}/{of}</span></div>
      <div className="mt-2 h-1.5 bg-surface-2 rounded-full overflow-hidden"><div className={`h-full ${bar}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function FeatureRow({ f, canEdit, onUpdate, onRemove }: {
  f: DeliveryFeature; canEdit: boolean;
  onUpdate: (id: string, patch: Partial<Pick<DeliveryFeature, 'name' | 'description' | 'completionState' | 'demoState' | 'notes'>>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const c = COMPLETION[f.completionState] ?? COMPLETION.not_started;
  const d = DEMO[f.demoState] ?? DEMO.not_demoed;
  const chip = 'shrink-0 px-2.5 py-1 rounded-md text-xs font-bold ring-1 ring-inset disabled:cursor-default';
  return (
    <li className="flex flex-wrap md:flex-nowrap items-start gap-3 px-5 py-3 border-b border-line/40 last:border-0">
      <div className="flex-1 min-w-[14rem]">
        <EditCell value={f.name} disabled={!canEdit} className="font-semibold" onSave={(v) => (v.trim() ? onUpdate(f.id, { name: v }) : Promise.reject(new Error('Feature name can’t be empty')))} />
        <EditCell value={f.description} disabled={!canEdit} placeholder="Description" className="text-xs text-muted" onSave={(v) => onUpdate(f.id, { description: v })} />
      </div>
      <div className="w-full md:w-56"><EditCell value={f.notes} disabled={!canEdit} placeholder="Notes" className="text-xs" onSave={(v) => onUpdate(f.id, { notes: v })} /></div>
      <button disabled={!canEdit} title={canEdit ? 'Click to change' : undefined} className={`${chip} ${c.cls}`}
        onClick={() => onUpdate(f.id, { completionState: c.next }).catch(alertError)}>{c.label}</button>
      <button disabled={!canEdit} title={canEdit ? 'Click to change' : undefined} className={`${chip} ${d.cls}`}
        onClick={() => onUpdate(f.id, { demoState: d.next }).catch(alertError)}>{d.label}</button>
      {canEdit && (
        <button title="Delete feature" className="shrink-0 mt-1 text-muted/60 hover:text-rose"
          onClick={() => { if (window.confirm(`Delete “${f.name}”?`)) onRemove(f.id).catch(alertError); }}>
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}
