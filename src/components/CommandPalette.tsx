/**
 * ⌘K / Ctrl+K page finder. Lists every page the viewer can see (same data as
 * the sidebar), filters as you type, arrow keys + Enter to go.
 */
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, ExternalLink } from 'lucide-react';
import { NAV_ACCENT, type NavGroup, type NavItem } from '../lib/navConfig';

interface Row { group: NavGroup; item: NavItem }

export function CommandPalette({ groups, onClose }: { groups: NavGroup[]; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const rows: Row[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = groups.flatMap((group) => group.items.map((item) => ({ group, item })));
    // One row per destination (Project Plans can sit in two groups).
    const seen = new Set<string>();
    const unique = all.filter((r) => {
      const k = r.item.to ?? r.item.href ?? r.item.label;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!q) return unique;
    const words = q.split(/\s+/);
    return unique
      .map((r) => {
        const hay = `${r.item.label} ${r.group.label} ${r.item.desc ?? ''} ${r.item.keywords ?? ''}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        const label = r.item.label.toLowerCase();
        const score = label.startsWith(q) ? 0 : label.includes(q) ? 1 : 2;
        return { r, score };
      })
      .filter((x): x is { r: Row; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .map((x) => x.r);
  }, [groups, query]);

  const active = Math.min(cursor, Math.max(rows.length - 1, 0));

  const go = (row: Row | undefined) => {
    if (!row) return;
    if (row.item.href) window.open(row.item.href, '_blank', 'noopener,noreferrer');
    else if (row.item.to) navigate(row.item.to);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(Math.min(active + 1, rows.length - 1)); scrollTo(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(Math.max(active - 1, 0)); scrollTo(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); go(rows[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };
  const scrollTo = (i: number) => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-row="${i}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 backdrop-blur-[2px] px-4 pt-[12vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Go to page"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-surface shadow-[0_24px_64px_rgba(0,0,0,0.35)] overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-line">
          <Search size={18} className="text-muted flex-shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={onKeyDown}
            placeholder="Go to page…"
            className="flex-1 bg-transparent py-4 text-[0.9375rem] text-ink placeholder:text-muted !outline-none !border-0 !shadow-none !ring-0"
          />
          <kbd className="text-[10px] font-semibold text-muted border border-line rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {rows.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted">No page matches “{query}”.</div>
          )}
          {rows.map((row, i) => {
            const Icon = row.item.icon;
            const a = NAV_ACCENT[row.group.accent];
            const isActive = i === active;
            return (
              <button
                key={`${row.group.key}-${row.item.to ?? row.item.href}`}
                type="button"
                data-row={i}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(row)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${isActive ? 'bg-surface-2' : ''}`}
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${a.chip}`}>
                  <Icon size={16} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-ink truncate">{row.item.label}</span>
                  <span className="block text-xs text-muted truncate">{row.group.label}{row.item.desc ? ` · ${row.item.desc}` : ''}</span>
                </span>
                {row.item.href
                  ? <ExternalLink size={14} className="text-muted flex-shrink-0" />
                  : isActive && <CornerDownLeft size={14} className="text-muted flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
