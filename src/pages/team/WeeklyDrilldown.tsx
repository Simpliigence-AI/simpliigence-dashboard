import { useState } from 'react';
import { getWeeksInMonth, formatWeekLabel } from './shared';
import type { Month } from '../../types/forecast';
import { MONTHS } from '../../types/forecast';

interface WeeklyDrilldownProps {
  month: Month;
  year: number;
  weeklyHours: Record<string, number>;
  onChangeWeekly: (weekDate: string, hours: number) => void;
  onBack: () => void;
}

export function WeeklyDrilldown({
  month,
  year,
  weeklyHours,
  onChangeWeekly,
  onBack,
}: WeeklyDrilldownProps) {
  const monthIdx = MONTHS.indexOf(month);
  const weeks = getWeeksInMonth(year, monthIdx);
  const monthTotal = weeks.reduce((s, w) => s + (weeklyHours[w] ?? 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onBack}
          className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
        >
          ← Back to month
        </button>
        <span className="text-xs text-slate-400">{month} total: <strong className="text-slate-700">{monthTotal} hrs</strong></span>
      </div>

      <div className="space-y-2">
        {weeks.map((w) => (
          <WeekRow
            key={w}
            label={formatWeekLabel(w)}
            value={weeklyHours[w] ?? 0}
            onChange={(v) => onChangeWeekly(w, v)}
          />
        ))}
      </div>

      <p className="mt-3 text-[10px] text-slate-400">
        Adjust slider or type exact hours. Sum is the {month} monthly total.
      </p>
    </div>
  );
}

function WeekRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-xs text-slate-500">{label}</span>
      <input
        type="range"
        min={0}
        max={60}
        step={1}
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          setDraft(String(v));
          onChange(v);
        }}
        className="flex-1 accent-primary"
      />
      <input
        type="number"
        min={0}
        max={168}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = parseFloat(draft);
          onChange(Number.isFinite(v) && v >= 0 ? v : 0);
        }}
        className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-xs text-right tabular-nums"
      />
      <span className="text-[10px] text-slate-400 w-6">hrs</span>
    </div>
  );
}
