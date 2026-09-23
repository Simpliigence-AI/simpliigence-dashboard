/**
 * Shared inline edit cell for the project-plan pages.
 */
import { useState } from 'react';
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

