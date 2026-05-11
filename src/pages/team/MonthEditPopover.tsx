import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, X } from 'lucide-react';
import type { Month } from '../../types/forecast';
import { MONTHS } from '../../types/forecast';
import { WeeklyDrilldown } from './WeeklyDrilldown';

const PRESETS: Array<{ label: string; value: number }> = [
  { label: 'Full', value: 160 },
  { label: '3/4', value: 120 },
  { label: 'Half', value: 80 },
  { label: 'Quarter', value: 40 },
  { label: 'Off', value: 0 },
];

type ApplyScope = 'this' | 'next3' | 'rest';

interface MonthEditPopoverProps {
  anchor: DOMRect;
  month: Month;
  year: number;
  hours: number;
  weeklyHours: Record<string, number>;
  onApply: (months: Month[], hours: number) => void;
  onApplyWeekly: (weekDate: string, hours: number) => void;
  onClose: () => void;
}

export function MonthEditPopover({
  anchor,
  month,
  year,
  hours,
  weeklyHours,
  onApply,
  onApplyWeekly,
  onClose,
}: MonthEditPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<number>(hours);
  const [scope, setScope] = useState<ApplyScope>('this');
  const [showWeekly, setShowWeekly] = useState(false);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const scopeMonths = (s: ApplyScope): Month[] => {
    const idx = MONTHS.indexOf(month);
    if (s === 'this') return [month];
    if (s === 'next3') return MONTHS.slice(idx, Math.min(idx + 3, 12)) as Month[];
    return MONTHS.slice(idx) as Month[];
  };

  const apply = (value: number, s: ApplyScope = scope) => {
    onApply(scopeMonths(s), value);
    onClose();
  };

  const POPOVER_W = 340;
  const POPOVER_H = showWeekly ? 380 : 280;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  let left = anchor.left + anchor.width / 2 - POPOVER_W / 2;
  if (left < 8) left = 8;
  if (left + POPOVER_W > vw - 8) left = vw - POPOVER_W - 8;
  let top = anchor.bottom + 8;
  if (top + POPOVER_H > vh - 8) top = anchor.top - POPOVER_H - 8;
  if (top < 8) top = 8;

  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 bg-white rounded-xl border border-slate-200 shadow-2xl"
      style={{ left, top, width: POPOVER_W }}
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
        <div className="text-sm font-semibold text-slate-700">
          {month} {year} <span className="text-slate-400 font-normal">— hours</span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      </div>

      {showWeekly ? (
        <div className="p-4">
          <WeeklyDrilldown
            month={month}
            year={year}
            weeklyHours={weeklyHours}
            onChangeWeekly={onApplyWeekly}
            onBack={() => setShowWeekly(false)}
          />
        </div>
      ) : (
        <div className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setDraft(Math.max(0, draft - 8))}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500"
              title="−8 hrs"
            >
              <Minus size={14} />
            </button>
            <input
              type="number"
              min={0}
              max={400}
              value={draft}
              onChange={(e) => setDraft(parseFloat(e.target.value) || 0)}
              className="flex-1 text-center text-2xl font-bold tabular-nums rounded-lg border border-slate-200 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <button
              onClick={() => setDraft(draft + 8)}
              className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500"
              title="+8 hrs"
            >
              <Plus size={14} />
            </button>
            <span className="text-xs text-slate-400">hrs</span>
          </div>

          <div className="flex gap-1.5 mb-3">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => setDraft(p.value)}
                className={`flex-1 py-1.5 text-[11px] rounded-lg border transition-colors ${
                  draft === p.value
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="font-semibold">{p.label}</div>
                <div className="text-[10px] opacity-70">{p.value}</div>
              </button>
            ))}
          </div>

          <div className="mb-3">
            <label className="block text-[10px] text-slate-400 uppercase tracking-wider mb-1">Apply to</label>
            <div className="flex gap-1">
              {([
                { v: 'this', label: 'This month' },
                { v: 'next3', label: 'Next 3 months' },
                { v: 'rest', label: 'Rest of year' },
              ] as { v: ApplyScope; label: string }[]).map((s) => (
                <button
                  key={s.v}
                  onClick={() => setScope(s.v)}
                  className={`flex-1 py-1 text-[11px] rounded-md border transition-colors ${
                    scope === s.v
                      ? 'bg-primary/10 text-primary border-primary/40 font-semibold'
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => setShowWeekly(true)}
              className="text-xs text-primary/80 hover:text-primary font-medium"
            >
              Edit by week →
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => apply(draft)}
                className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary/90 font-semibold"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
