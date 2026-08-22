import { useEffect, useState } from 'react';
import { Trash2, Save, Plus, Check } from 'lucide-react';
import type { USRosterAssignment } from '../../types/usRoster';
import {
  calcAssignmentMarginPercent,
  calcAssignmentMarginAbsolute,
} from '../../types/usRoster';
import { Sensitive } from '../../components/Sensitive';
import { OwnerOnly, useIsOwner } from '../../components/OwnerOnly';

/**
 * Inline row editor for one assignment (SI, end client, project, cost, bill).
 * Commit-on-blur/enter, delete-with-confirm, autocomplete on SI + end client
 * via the passed-in suggestion lists.
 */
export function AssignmentEditorRow({
  assignment,
  onChange,
  onDelete,
  siSuggestions,
  endClientSuggestions,
  projectSuggestions,
  compact = false,
}: {
  assignment: USRosterAssignment;
  onChange: (patch: Partial<USRosterAssignment>) => void;
  onDelete: () => void;
  siSuggestions: string[];
  endClientSuggestions: string[];
  projectSuggestions: string[];
  compact?: boolean;
}) {
  const isOwner = useIsOwner();
  return (
    <div
      className={`grid grid-cols-12 gap-2 items-center py-2 ${compact ? '' : 'px-2'} rounded-md hover:bg-surface-2/40`}
    >
      <ComboInput
        className="col-span-3"
        value={assignment.si ?? ''}
        placeholder="SI (e.g. Ciklum)"
        suggestions={siSuggestions}
        onCommit={(v) => onChange({ si: v || null })}
      />
      <ComboInput
        className="col-span-3"
        value={assignment.end_client ?? ''}
        placeholder="End client (e.g. Pay.UK)"
        suggestions={endClientSuggestions}
        onCommit={(v) => onChange({ end_client: v || null })}
      />
      <ComboInput
        className="col-span-2"
        value={assignment.project ?? ''}
        placeholder="Project"
        suggestions={projectSuggestions}
        onCommit={(v) => onChange({ project: v || null })}
      />
      {isOwner ? (
        <NumberInput
          className="col-span-1"
          value={assignment.cost_per_hour}
          prefix="$"
          title="Cost / hr"
          onCommit={(n) => onChange({ cost_per_hour: n })}
        />
      ) : (
        <div className="col-span-1 text-right text-[11px] tabular-nums" title="Cost — owner only"><OwnerOnly>—</OwnerOnly></div>
      )}
      {isOwner ? (
        <NumberInput
          className="col-span-1"
          value={assignment.bill_rate}
          prefix="$"
          title="Bill / hr"
          onCommit={(n) => onChange({ bill_rate: n })}
        />
      ) : (
        <div className="col-span-1 text-right text-[11px] tabular-nums" title="Bill — owner only"><OwnerOnly>—</OwnerOnly></div>
      )}
      <div className="col-span-1 text-right text-[11px] tabular-nums" title="Margin">
        <OwnerOnly><Sensitive>{`${calcAssignmentMarginPercent(assignment)}%`}</Sensitive></OwnerOnly>
        <div className="text-[10px] text-muted">
          <OwnerOnly><Sensitive>{`$${calcAssignmentMarginAbsolute(assignment)}`}</Sensitive></OwnerOnly>
        </div>
      </div>
      <button
        type="button"
        onClick={() => { if (confirm('Remove this assignment?')) onDelete(); }}
        className="col-span-1 justify-self-end text-muted hover:text-rose-600 p-1"
        title="Remove assignment"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/**
 * "Add assignment" form — same shape as an editor row, but the row is
 * detached from any assignment and calls a single onCreate when the user
 * commits.
 */
export function AddAssignmentRow({
  rosterId,
  onCreate,
  siSuggestions,
  endClientSuggestions,
  projectSuggestions,
}: {
  rosterId: string;
  onCreate: (a: Omit<USRosterAssignment, 'id' | 'created_at' | 'updated_at'>) => void;
  siSuggestions: string[];
  endClientSuggestions: string[];
  projectSuggestions: string[];
}) {
  const isOwner = useIsOwner();
  const [si, setSi] = useState('');
  const [endClient, setEndClient] = useState('');
  const [project, setProject] = useState('');
  const [cost, setCost] = useState(0);
  const [bill, setBill] = useState(0);

  const canSubmit = si.trim() || endClient.trim() || project.trim();

  const submit = () => {
    if (!canSubmit) return;
    onCreate({
      roster_id: rosterId,
      si: si.trim() || null,
      end_client: endClient.trim() || null,
      project: project.trim() || null,
      cost_per_hour: Number(cost) || 0,
      bill_rate: Number(bill) || 0,
      start_date: null,
      end_date: null,
      allocation_pct: null,
      notes: null,
    });
    setSi(''); setEndClient(''); setProject(''); setCost(0); setBill(0);
  };

  return (
    <div className="grid grid-cols-12 gap-2 items-center py-2 px-2 rounded-md border border-dashed border-line/60 hover:border-line bg-surface-2/40">
      <ComboInput
        className="col-span-3"
        value={si}
        placeholder="SI"
        suggestions={siSuggestions}
        onCommit={setSi}
      />
      <ComboInput
        className="col-span-3"
        value={endClient}
        placeholder="End client"
        suggestions={endClientSuggestions}
        onCommit={setEndClient}
      />
      <ComboInput
        className="col-span-2"
        value={project}
        placeholder="Project"
        suggestions={projectSuggestions}
        onCommit={setProject}
      />
      {isOwner ? (
        <NumberInput
          className="col-span-1"
          value={cost}
          prefix="$"
          title="Cost / hr"
          onCommit={setCost}
        />
      ) : (
        <div className="col-span-1 text-right text-[11px] tabular-nums" title="Cost — owner only"><OwnerOnly>—</OwnerOnly></div>
      )}
      {isOwner ? (
        <NumberInput
          className="col-span-1"
          value={bill}
          prefix="$"
          title="Bill / hr"
          onCommit={setBill}
        />
      ) : (
        <div className="col-span-1 text-right text-[11px] tabular-nums" title="Bill — owner only"><OwnerOnly>—</OwnerOnly></div>
      )}
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="col-span-2 justify-self-end inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary-dark disabled:opacity-40 disabled:cursor-not-allowed px-2 py-1 rounded"
      >
        <Plus size={12} /> Add contract
      </button>
    </div>
  );
}

/** Text input with datalist autocomplete, commit-on-blur. */
function ComboInput({
  value, placeholder, suggestions, onCommit, className,
}: {
  value: string; placeholder: string; suggestions: string[];
  onCommit: (v: string) => void; className?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const id = `dl-${placeholder.toLowerCase().replace(/[^a-z]/g, '')}-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <>
      <input
        list={id}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onCommit(v)}
        onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
        placeholder={placeholder}
        className={`bg-surface border border-line rounded px-2 py-1 text-xs w-full focus:outline-none focus:border-primary ${className ?? ''}`}
      />
      <datalist id={id}>
        {suggestions.filter(Boolean).map((s) => <option key={s} value={s} />)}
      </datalist>
    </>
  );
}

/** Numeric input with prefix + commit-on-blur. */
function NumberInput({
  value, prefix, onCommit, className, title,
}: {
  value: number; prefix?: string; onCommit: (n: number) => void; className?: string; title?: string;
}) {
  const [v, setV] = useState(String(value ?? 0));
  useEffect(() => setV(String(value ?? 0)), [value]);
  return (
    <div className={`relative ${className ?? ''}`} title={title}>
      {prefix && <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-muted">{prefix}</span>}
      <input
        type="number"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Number(v) || 0;
          if (n !== value) onCommit(n);
        }}
        className={`bg-surface border border-line rounded ${prefix ? 'pl-4' : 'pl-2'} pr-1 py-1 text-xs w-full text-right tabular-nums focus:outline-none focus:border-primary`}
      />
    </div>
  );
}

/** Save-badge (kept in the file so pages can render it inline elsewhere). */
export function SavedBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600">
      <Check size={10} /> Saved
    </span>
  );
}
export function SaveIcon() { return <Save size={10} />; }
