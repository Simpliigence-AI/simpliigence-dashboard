/**
 * Shared inline edit cell for the project-plan pages.
 */
import { useEffect, useState } from 'react';
import { useDeliveryStore } from '../../store/useDeliveryStore';
import { alertError } from '../../lib/planToast';

export const cellInput =
  'w-full bg-transparent rounded px-1.5 py-1 text-sm border border-transparent hover:border-line focus:border-primary/50 focus:bg-surface focus:outline-none disabled:hover:border-transparent disabled:cursor-default';

/** Text/date input that saves on blur only when the value changed. */
export function EditCell({ value, onSave, type = 'text', disabled, placeholder, className = '' }: {
  value: string | null; onSave: (v: string) => Promise<void>; type?: 'text' | 'date' | 'number';
  disabled?: boolean; placeholder?: string; className?: string;
}) {
  const [v, setV] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  // Resync when the saved value changes underneath (another save, a reload).
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setV(value ?? ''); }
  return (
    <input
      type={type}
      value={v}
      disabled={disabled || saving}
      placeholder={disabled ? '' : placeholder}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value ?? ''); (e.target as HTMLInputElement).blur(); } }}
      onBlur={async () => {
        if ((value ?? '') === v) return;
        setSaving(true);
        try { await onSave(v); } catch (err) { alertError(err); setV(value ?? ''); } finally { setSaving(false); }
      }}
      className={`${cellInput} ${className}`}
    />
  );
}


/** Datalist of Dashboard users for PM / lead / approver fields. */
export function PeopleDatalist({ id }: { id: string }) {
  const people = useDeliveryStore((s) => s.people);
  const loadPeople = useDeliveryStore((s) => s.loadPeople);
  useEffect(() => { void loadPeople(); }, [loadPeople]);
  return <datalist id={id}>{people.map((p) => <option key={p.email} value={p.fullName}>{p.email}</option>)}</datalist>;
}

/** EditCell that suggests Dashboard users as you type. */
export function PersonCell({ value, onSave, disabled, placeholder, className = '' }: {
  value: string | null; onSave: (v: string) => Promise<void>; disabled?: boolean; placeholder?: string; className?: string;
}) {
  const [v, setV] = useState(value ?? '');
  const [seen, setSeen] = useState(value);
  const [saving, setSaving] = useState(false);
  if (seen !== value) { setSeen(value); setV(value ?? ''); }
  return (
    <>
      <input
        value={v} list="plan-people" disabled={disabled || saving} placeholder={disabled ? '' : placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value ?? ''); (e.target as HTMLInputElement).blur(); } }}
        onBlur={async () => {
          if ((value ?? '') === v) return;
          setSaving(true);
          try { await onSave(v); } catch (err) { alertError(err); setV(value ?? ''); } finally { setSaving(false); }
        }}
        className={`${cellInput} ${className}`}
      />
      <PeopleDatalist id="plan-people" />
    </>
  );
}

/** Label + control stack used in plan dialogs. */
export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block text-xs font-semibold text-muted">
      {label}
      <div className="mt-1 font-normal text-ink">{children}</div>
      {hint && <div className="mt-1 font-normal text-[11px] text-muted">{hint}</div>}
    </label>
  );
}

export const inputClass = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30';
