import { MONTHS } from '../../types/forecast';
import type { Month } from '../../types/forecast';
import type { ConciergeConfig, RoleCategory } from '../../types/hiringForecast';
import { ROLE_CATEGORIES, ROLE_CATEGORY_LABELS } from '../../types/hiringForecast';

interface Props {
  config: ConciergeConfig;
  onChange: (role: RoleCategory, month: Month, hours: number) => void;
}

export function ConciergeConfigPanel({ config, onChange }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className="pb-2 pr-3 text-left font-semibold text-muted text-xs">Role</th>
            {MONTHS.map((m) => (
              <th key={m} className="pb-2 px-1 text-center font-semibold text-muted text-xs w-16">{m}</th>
            ))}
            <th className="pb-2 pl-2 text-right font-semibold text-muted text-xs">Total</th>
          </tr>
        </thead>
        <tbody>
          {ROLE_CATEGORIES.map((cat) => {
            const total = MONTHS.reduce((s, m) => s + (config.monthlyHours[cat][m] || 0), 0);
            return (
              <tr key={cat} className="border-b border-line/40">
                <td className="py-2 pr-3 text-xs font-medium text-ink/80 whitespace-nowrap">
                  {ROLE_CATEGORY_LABELS[cat]}
                </td>
                {MONTHS.map((m) => (
                  <td key={m} className="py-1 px-1">
                    <input
                      type="number"
                      min={0}
                      step={10}
                      className="w-14 rounded border border-line px-1.5 py-1 text-xs text-center tabular-nums focus:outline-none focus:ring-1 focus:ring-primary/50"
                      value={config.monthlyHours[cat][m] || 0}
                      onChange={(e) => onChange(cat, m, Math.max(0, Number(e.target.value) || 0))}
                    />
                  </td>
                ))}
                <td className="py-2 pl-2 text-right text-xs font-semibold tabular-nums text-muted">
                  {total}
                </td>
              </tr>
            );
          })}
          <tr className="border-t border-line font-semibold">
            <td className="py-2 pr-3 text-xs text-ink/80">Total</td>
            {MONTHS.map((m) => {
              const monthTotal = ROLE_CATEGORIES.reduce((s, c) => s + (config.monthlyHours[c][m] || 0), 0);
              return (
                <td key={m} className="py-2 px-1 text-center text-xs tabular-nums text-ink/80">{monthTotal}</td>
              );
            })}
            <td className="py-2 pl-2 text-right text-xs tabular-nums text-ink/80">
              {ROLE_CATEGORIES.reduce((s, c) => s + MONTHS.reduce((ms, m) => ms + (config.monthlyHours[c][m] || 0), 0), 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
