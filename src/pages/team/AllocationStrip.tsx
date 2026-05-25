import { useRef, useState } from 'react';
import { MONTHS } from '../../types/forecast';
import type { Month } from '../../types/forecast';
import { MonthEditPopover } from './MonthEditPopover';

interface AllocationStripProps {
  employeeName: string;
  project: string;
  monthlyTotals: Record<Month, number>;
  weeklyHours: Record<string, number>;
  year: number;
  capacity?: number;
  compact?: boolean;
  /** When true, click does nothing (no edit popover) and the strip is purely visual. */
  readOnly?: boolean;
  onChangeMonthly?: (months: Month[], hours: number) => void;
  onChangeWeekly?: (weekDate: string, hours: number) => void;
}

function barColor(hours: number, capacity: number): string {
  if (hours <= 0) return 'bg-slate-100';
  const util = hours / capacity;
  if (util >= 0.8) return 'bg-emerald-500';
  if (util >= 0.5) return 'bg-sky-500';
  return 'bg-amber-400';
}

function barTextColor(hours: number, capacity: number): string {
  if (hours <= 0) return 'text-slate-300';
  const util = hours / capacity;
  if (util >= 0.5) return 'text-white';
  return 'text-amber-900';
}

export function AllocationStrip({
  monthlyTotals,
  weeklyHours,
  year,
  capacity = 160,
  compact = false,
  readOnly = false,
  onChangeMonthly,
  onChangeWeekly,
}: AllocationStripProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [openMonth, setOpenMonth] = useState<{ month: Month; rect: DOMRect } | null>(null);

  const cellH = compact ? 28 : 44;
  const interactive = !readOnly;

  return (
    <>
      <div ref={stripRef} className="flex gap-0.5 w-full select-none">
        {MONTHS.map((m) => {
          const hours = monthlyTotals[m] ?? 0;
          const pct = Math.min(hours / capacity, 1.2);
          const fillH = Math.max(2, pct * cellH);
          return (
            <button
              key={m}
              type="button"
              onClick={(e) => {
                if (!interactive) return;
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setOpenMonth({ month: m, rect });
              }}
              className={`group relative flex-1 rounded bg-slate-50 transition-shadow overflow-hidden ${
                interactive ? 'hover:ring-2 hover:ring-primary/40 cursor-pointer' : 'cursor-default'
              }`}
              style={{ height: cellH }}
              title={`${m}: ${hours} hrs (${Math.round((hours / capacity) * 100)}%)`}
              aria-label={`${m} ${year} hours, currently ${hours}`}
            >
              <div
                className={`absolute bottom-0 left-0 right-0 ${barColor(hours, capacity)} transition-all`}
                style={{ height: fillH }}
              />
              <div className="absolute inset-x-0 top-0 text-[9px] text-slate-400 leading-none pt-0.5">
                {m.slice(0, compact ? 1 : 3)}
              </div>
              <div
                className={`absolute inset-x-0 bottom-0 text-center font-bold tabular-nums ${barTextColor(hours, capacity)} ${compact ? 'text-[10px] leading-tight pb-0.5' : 'text-xs pb-0.5'}`}
              >
                {hours > 0 ? hours : ''}
              </div>
            </button>
          );
        })}
      </div>

      {openMonth && interactive && onChangeMonthly && onChangeWeekly && (
        <MonthEditPopover
          anchor={openMonth.rect}
          month={openMonth.month}
          year={year}
          hours={monthlyTotals[openMonth.month] ?? 0}
          weeklyHours={weeklyHours}
          onApply={(months, hours) => onChangeMonthly(months, hours)}
          onApplyWeekly={(weekDate, hours) => onChangeWeekly(weekDate, hours)}
          onClose={() => setOpenMonth(null)}
        />
      )}
    </>
  );
}

/* Project chip with strip — used in PeopleView's per-person detail and
 * ProjectsView's per-person rows. */
export function AllocationStripRow({
  label,
  sublabel,
  hue,
  trailing,
  children,
}: {
  label: string;
  sublabel?: string;
  hue?: number;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  const chipStyle = hue !== undefined
    ? { backgroundColor: `hsl(${hue} 70% 92%)`, color: `hsl(${hue} 50% 30%)` }
    : undefined;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-40 shrink-0 flex items-center gap-2">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold truncate max-w-full"
          style={chipStyle}
          title={label}
        >
          {label}
        </span>
        {sublabel && <span className="text-[10px] text-slate-400 truncate">{sublabel}</span>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
