/**
 * UserPicker — a dropdown for selecting a user from the directory of
 * authorized_users. Source of truth is useAuthStore.directory, which is
 * loaded on init and refreshed on edits.
 *
 *   <UserPicker value={emailOrNull} onChange={(email|null) => …} />
 *
 * Renders a styled button that opens a popover with searchable name
 * entries. Each entry shows an avatar + full name + email. Optional
 * "— Unassigned —" lets the user clear the selection.
 *
 * Used wherever we used to ask for a raw email — e.g. account sales/
 * delivery owners, action-item owner, manager hierarchy.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X, Search } from 'lucide-react';
import { useAuthStore, lookupProfile } from '../store/useAuthStore';
import type { UserRole } from '../store/useAuthStore';
import { UserAvatar } from './UserAvatar';

interface Props {
  /** Selected email (lowercased) or null when unassigned. */
  value: string | null | undefined;
  /** Fires when the user picks a different person or clears the selection. */
  onChange: (email: string | null) => void;
  /** Optional: restrict to users with one of these roles. e.g. ['admin','manager']. */
  rolesAllowed?: UserRole[];
  /** Optional: text to show when nothing is picked. Default "— Unassigned —". */
  placeholder?: string;
  /** Allow clearing the selection. Default true. */
  allowClear?: boolean;
  /** Tailwind size class for the trigger. Default text-sm. */
  size?: 'sm' | 'md';
  /** Disabled state. */
  disabled?: boolean;
  className?: string;
}

export function UserPicker({
  value,
  onChange,
  rolesAllowed,
  placeholder = '— Unassigned —',
  allowClear = true,
  size = 'sm',
  disabled = false,
  className = '',
}: Props) {
  const directory = useAuthStore((s) => s.directory);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const options = useMemo(() => {
    const arr = Object.values(directory)
      .filter((p) => !rolesAllowed || rolesAllowed.includes(p.role))
      .sort((a, b) => {
        const an = (a.fullName || a.email).toLowerCase();
        const bn = (b.fullName || b.email).toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
      });
    const needle = q.trim().toLowerCase();
    if (!needle) return arr;
    return arr.filter((p) => {
      const hay = `${p.fullName ?? ''} ${p.email}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [directory, q, rolesAllowed]);

  const selected = value ? lookupProfile(value, directory) : null;
  const triggerSize = size === 'md' ? 'text-sm py-2' : 'text-sm py-1.5';

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`w-full inline-flex items-center justify-between gap-2 border border-slate-300 rounded-md px-3 ${triggerSize} bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 disabled:cursor-not-allowed`}
      >
        {selected ? (
          <span className="inline-flex items-center gap-2 min-w-0">
            <UserAvatar
              email={selected.email}
              name={selected.fullName}
              avatarUrl={selected.avatarUrl}
              size={20}
            />
            <span className="truncate text-slate-900">
              {selected.fullName || selected.email}
            </span>
          </span>
        ) : (
          <span className="text-slate-400 italic">{placeholder}</span>
        )}
        <span className="flex-shrink-0 inline-flex items-center gap-1">
          {selected && allowClear && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange(null); } }}
              className="text-slate-400 hover:text-red-600"
              title="Clear"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown size={14} className="text-slate-400" />
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[280px] bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name or email…"
                className="w-full border border-slate-200 rounded-md pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>
          <ul className="max-h-72 overflow-y-auto">
            {allowClear && !q && (
              <li>
                <button
                  type="button"
                  onClick={() => { onChange(null); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-500 italic hover:bg-slate-50 inline-flex items-center gap-2"
                >
                  {placeholder}
                </button>
              </li>
            )}
            {options.length === 0 ? (
              <li className="px-3 py-4 text-xs text-slate-500 text-center">
                {q ? 'No users match.' : 'Directory is empty — add users on /admin/users.'}
              </li>
            ) : (
              options.map((p) => {
                const isSelected = p.email === (value ?? '').toLowerCase();
                return (
                  <li key={p.email}>
                    <button
                      type="button"
                      onClick={() => { onChange(p.email); setOpen(false); setQ(''); }}
                      className={`w-full text-left px-3 py-2 hover:bg-slate-50 inline-flex items-center gap-2 ${
                        isSelected ? 'bg-primary/5' : ''
                      }`}
                    >
                      <UserAvatar email={p.email} name={p.fullName} avatarUrl={p.avatarUrl} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-medium text-slate-900 truncate">
                          {p.fullName || p.email}
                        </span>
                        <span className="block text-[10px] text-slate-500 truncate">{p.email}</span>
                      </span>
                      {p.role !== 'employee' && (
                        <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-400">
                          {p.role}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
