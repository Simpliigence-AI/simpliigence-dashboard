/**
 * Stage Funnel & Drop-off Analysis — visual of how reqs flow through the
 * pipeline, where they get stuck, and where they die.
 *
 * Left side: horizontal funnel bars — each stage's bar width is proportional
 * to the count of reqs that ever reached that stage. Drop-off % is shown
 * BETWEEN bars, so the user can spot bottlenecks at a glance.
 *
 * Right side: a compact KPI column with the headline metric (overall close
 * rate) and the biggest drop-off step called out as a narrative.
 */
import { TrendingDown, Target, AlertOctagon } from 'lucide-react';
import { STAGE_COLORS } from '../../types/staffing';
import type { FunnelSummary } from '../../lib/staffingFunnel';

interface Props {
  summary: FunnelSummary;
}

export function StageFunnel({ summary }: Props) {
  const { rows, totalReqs, successful, terminallyLost, biggestDrop } = summary;
  const startCount = rows[0]?.everReached || 1; // guard for divide-by-zero
  const closeRate = totalReqs > 0 ? Math.round((successful / totalReqs) * 100) : 0;
  const lossRate = totalReqs > 0 ? Math.round((terminallyLost / totalReqs) * 100) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-6">
      {/* ── Funnel bars ─────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-bold text-sm text-ink">Pipeline Funnel</h4>
          <span className="text-[10px] text-muted/70">Counts include archived reqs · drop-off is between adjacent stages</span>
        </div>
        <div className="space-y-1">
          {rows.map((row, i) => {
            const widthPct = startCount > 0 ? Math.max(8, Math.round((row.everReached / startCount) * 100)) : 0;
            const isTop = i === 0;
            const color = STAGE_COLORS[row.stage];
            return (
              <div key={row.stage}>
                {/* Drop-off connector — only between stages */}
                {!isTop && row.dropOffFromPrev > 0 && (
                  <div className="flex items-center justify-end gap-1 pr-2 py-0.5 text-[10px] text-red-500 font-semibold">
                    <TrendingDown size={10} />
                    <span>-{row.dropOffFromPrev}% drop</span>
                  </div>
                )}
                {/* Bar */}
                <div className="flex items-center gap-3">
                  <div
                    className="h-9 rounded-lg flex items-center px-3 text-white text-xs font-semibold shadow-sm transition-all"
                    style={{
                      width: `${widthPct}%`,
                      background: `linear-gradient(90deg, ${color}, ${color}dd)`,
                      minWidth: '120px',
                    }}
                    title={`${row.stage} — ${row.everReached} reqs reached, ${row.currentlyHere} currently here, ${row.stalledLost} stalled & lost`}
                  >
                    <span className="truncate">{row.stage}</span>
                    <span className="ml-auto bg-white/20 px-1.5 py-0.5 rounded text-[10px] font-bold">
                      {row.everReached}
                    </span>
                  </div>
                  <div className="flex-shrink-0 text-[10px] text-muted w-40 flex flex-wrap gap-x-2">
                    <span>
                      <span className="font-bold text-ink/80">{row.currentlyHere}</span> now
                      {row.currentPositions > 0 && ` (${row.currentPositions} pos)`}
                    </span>
                    {row.stalledLost > 0 && (
                      <span className="text-red-600">
                        <span className="font-bold">{row.stalledLost}</span> lost here
                      </span>
                    )}
                    <span className="text-muted/70">
                      {row.conversionFromStart}% of start
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── KPI column ──────────────────────────── */}
      <div className="space-y-3">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
            <Target size={11} /> Close rate
          </div>
          <div className="text-2xl font-extrabold text-emerald-700 mt-1">{closeRate}%</div>
          <div className="text-[10px] text-emerald-600/70">
            {successful} of {totalReqs} reqs reached Closed/Onboarding
          </div>
        </div>

        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
            <AlertOctagon size={11} /> Loss rate
          </div>
          <div className="text-2xl font-extrabold text-red-700 mt-1">{lossRate}%</div>
          <div className="text-[10px] text-red-600/70">
            {terminallyLost} reqs ended Lost or Cancelled
          </div>
        </div>

        {biggestDrop && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
              <TrendingDown size={11} /> Biggest bottleneck
            </div>
            <div className="text-sm font-bold text-amber-800 mt-1 leading-tight">
              {biggestDrop.from} → {biggestDrop.to}
            </div>
            <div className="text-[10px] text-amber-700/80 mt-0.5">
              <span className="font-bold">{biggestDrop.percent}%</span> of reqs don't make it past {biggestDrop.from}.
              {biggestDrop.from === 'Client Round' && ' Likely a client-feedback bottleneck — chase SPOCs.'}
              {biggestDrop.from === 'Sourcing' && ' Too few profiles reaching the client — boost sourcing.'}
              {biggestDrop.from === 'Interview' && ' Candidates dropping at interview — check role fit & quality.'}
              {biggestDrop.from === 'Shortlisted' && ' Reqs stall after shortlist — schedule client rounds faster.'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
