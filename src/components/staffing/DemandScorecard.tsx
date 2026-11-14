/**
 * Closure scorecards for the top of India Demand.
 *
 *  - External: positions closed this month against the monthly target. Internal
 *    roles are never counted here.
 *  - Internal: a smaller card for internal roles closed this month, with how many
 *    internal positions are still open.
 *  - Ticker: external positions closed in each month of the year, plus the year total.
 *
 * "Closed" means Closed Won, credited to the month the status changed. Numbers come
 * from buildClosureScorecard in src/lib/reqHealth.ts.
 */
import { Trophy, Building } from 'lucide-react';
import type { ClosureScorecard } from '../../lib/reqHealth';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1] || key;

export function DemandScorecards({ card }: { card: ClosureScorecard }) {
  const { external: ext, internal: int } = card;
  const pct = Math.min(100, Math.round((ext.closedThisMonth / Math.max(1, ext.target)) * 100));
  const hit = ext.closedThisMonth >= ext.target;
  return (
    <div className="flex flex-col gap-2 w-64">
      <div className="rounded-xl border border-line bg-surface shadow-sm px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Closed in {monthName(card.month)}</span>
          <Trophy size={14} className={hit ? 'text-emerald-600' : 'text-muted/60'} aria-hidden="true" />
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className={`text-3xl font-extrabold tabular-nums tracking-tight ${hit ? 'text-emerald-700' : 'text-ink'}`}>{ext.closedThisMonth}</span>
          <span className="text-sm font-semibold text-muted">of {ext.target} positions</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-surface-2 overflow-hidden" role="progressbar"
          aria-valuemin={0} aria-valuemax={ext.target} aria-valuenow={Math.min(ext.closedThisMonth, ext.target)}
          aria-label={`${ext.closedThisMonth} of ${ext.target} external positions closed this month`}>
          <div className={`h-full rounded-full ${hit ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 text-[11px] text-muted">External only · {ext.openPositions} still open</div>
      </div>
      <div className="rounded-lg border border-line bg-surface-2/50 px-3 py-2 flex items-center gap-2">
        <Building size={13} className="text-muted flex-shrink-0" aria-hidden="true" />
        <span className="text-xs text-ink/80">
          Internal: <strong className="tabular-nums text-ink">{int.closedThisMonth}</strong> closed in {monthName(card.month)}
          <span className="text-muted"> · {int.openPositions} open</span>
        </span>
      </div>
    </div>
  );
}

export function ClosureTicker({ card }: { card: ClosureScorecard }) {
  const peak = Math.max(1, ...card.externalByMonth.map((m) => m.closed));
  return (
    <div className="mb-4 rounded-xl border border-line bg-surface px-4 py-2.5 flex items-center gap-4 overflow-x-auto"
      role="group" aria-label={`External positions closed per month in ${card.year}`}>
      <div className="flex-shrink-0">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">External closed {card.year}</div>
        <div className="text-lg font-extrabold tabular-nums text-ink leading-tight">
          {card.external.closedThisYear} <span className="text-xs font-semibold text-muted">positions this year</span>
        </div>
      </div>
      <div className="h-9 w-px bg-line flex-shrink-0" />
      <ol className="flex items-end gap-3">
        {card.externalByMonth.map((m) => {
          const current = m.month === card.month;
          return (
            <li key={m.month} className="flex flex-col items-center gap-0.5 min-w-[2.25rem]" title={`${monthName(m.month)} ${card.year}: ${m.closed} external positions closed`}>
              <span className={`text-sm font-bold tabular-nums ${current ? 'text-primary' : m.closed ? 'text-ink' : 'text-muted/60'}`}>{m.closed}</span>
              <span className="w-full h-1 rounded-full bg-surface-2 overflow-hidden" aria-hidden="true">
                <span className={`block h-full rounded-full ${current ? 'bg-primary' : 'bg-emerald-500'}`} style={{ width: `${Math.round((m.closed / peak) * 100)}%` }} />
              </span>
              <span className={`text-[11px] ${current ? 'font-bold text-primary' : 'text-muted'}`}>{monthName(m.month)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
