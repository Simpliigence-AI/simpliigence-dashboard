/**
 * India Hiring Forecast — AI-driven proactive hiring recommendations.
 *
 * Two layers:
 *   1. Deterministic metrics (always shown): roster growth, demand trends,
 *      time-to-close, top skills, per-account heat
 *   2. AI predictions (Claude API key required): ranked proactive-hire
 *      recommendations with rationale tied to the metrics above
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LineChart, Line, Legend,
} from 'recharts';
import {
  Users, TrendingUp, Clock, Target, Sparkles, RefreshCw, Loader2,
  AlertOctagon, ChevronDown, ChevronRight,
} from 'lucide-react';
import { useStaffingStore } from '../store/useStaffingStore';
import { useIndiaRosterStore } from '../store/useIndiaRosterStore';
import { computeIndiaHiringMetrics, skillParent } from '../lib/indiaHiringMetrics';
import { runIndiaHiringForecast, type IndiaHiringPrediction } from '../lib/claudeQuery';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard } from '../components/ui';

const URGENCY_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  now:               { label: 'Hire now',         color: '#991b1b', bg: '#fee2e2' },
  within_30_days:    { label: 'Within 30 days',   color: '#92400e', bg: '#fef3c7' },
  within_60_days:    { label: 'Within 60 days',   color: '#1e40af', bg: '#dbeafe' },
  watchlist:         { label: 'Watchlist',        color: '#475569', bg: '#f1f5f9' },
};

export default function IndiaHiringForecastPage() {
  const { requisitions, statuses, history, accounts } = useStaffingStore();
  const { members: roster } = useIndiaRosterStore();

  const [prediction, setPrediction] = useState<IndiaHiringPrediction | null>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [showRoleMix, setShowRoleMix] = useState(false);

  const accountNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of accounts) m[a.id] = a.name;
    return m;
  }, [accounts]);

  /** Deterministic metrics — recomputed locally, no API needed */
  const metrics = useMemo(
    () => computeIndiaHiringMetrics({ roster, requisitions, statuses, history }),
    [roster, requisitions, statuses, history],
  );

  /** Translate account IDs to names for display + AI input */
  const metricsForAI = useMemo(() => ({
    ...metrics,
    demand: {
      ...metrics.demand,
      byAccount: metrics.demand.byAccount.map((a) => ({
        ...a,
        account: accountNameById[a.account] || a.account,
      })),
    },
  }), [metrics, accountNameById]);

  /** Auto-fetch on mount; cache by day in localStorage */
  useEffect(() => {
    let cancelled = false;
    async function load(force = false) {
      setLoadingAI(true);
      try {
        const p = await runIndiaHiringForecast(metricsForAI, { forceRefresh: force });
        if (!cancelled) setPrediction(p);
      } finally {
        if (!cancelled) setLoadingAI(false);
      }
    }
    load(false);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster.length, requisitions.length, history.length]);

  const regenerate = useCallback(async () => {
    setLoadingAI(true);
    try {
      const p = await runIndiaHiringForecast(metricsForAI, { forceRefresh: true });
      setPrediction(p);
    } finally {
      setLoadingAI(false);
    }
  }, [metricsForAI]);

  const monthlyGrowthChart = metrics.roster.monthlyGrowth.map((m) => ({
    month: new Date(m.monthStart).toLocaleDateString('en-US', { month: 'short' }),
    headcount: m.headcount,
    joined: m.joined,
  }));

  const closureChart = metrics.demand.closureTimeline.map((w) => ({
    week: w.weekStart.slice(5),
    closures: w.closures,
    losses: w.losses,
  }));

  return (
    <>
      <PageHeader
        title="India Hiring Forecast"
        subtitle="AI-driven proactive-hire recommendations from roster growth + demand trends"
      />

      {/* AI prediction banner */}
      <div className="mb-6 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-blue-50 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-violet-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-violet-600" />
            <span className="text-sm font-bold text-slate-800">AI Hiring Forecast</span>
            <span className="bg-gradient-to-r from-violet-500 to-blue-500 text-white text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">CLAUDE</span>
            {prediction?.generatedAt && (
              <span className="text-[10px] text-slate-400">
                · updated {new Date(prediction.generatedAt).toLocaleDateString()} {new Date(prediction.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <button
            onClick={regenerate}
            disabled={loadingAI}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors"
          >
            {loadingAI ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
            {loadingAI ? 'Analyzing' : 'Regenerate'}
          </button>
        </div>

        <div className="px-4 py-4">
          {loadingAI && !prediction && (
            <div className="text-xs text-slate-400 italic flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" /> Claude is analyzing your roster + demand trends...
            </div>
          )}
          {prediction && (
            <>
              <div className="text-[12.5px] leading-relaxed text-slate-700 [&_strong]:text-slate-900 mb-4">
                {prediction.summary.split('\n').map((line, i) => {
                  const trimmed = line.trim();
                  if (!trimmed) return null;
                  const parts = trimmed.split(/(\*\*[^*]+\*\*|_[^_]+_)/).filter(Boolean);
                  return (
                    <p key={i} className="my-1">
                      {parts.map((part, j) => {
                        if (part.startsWith('**') && part.endsWith('**')) return <strong key={j}>{part.slice(2, -2)}</strong>;
                        if (part.startsWith('_') && part.endsWith('_')) return <em key={j}>{part.slice(1, -1)}</em>;
                        return <span key={j}>{part}</span>;
                      })}
                    </p>
                  );
                })}
              </div>

              {prediction.recommendations.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    Recommended hires
                  </div>
                  {prediction.recommendations.map((rec, i) => {
                    const u = URGENCY_LABEL[rec.urgency] || URGENCY_LABEL.watchlist;
                    return (
                      <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 flex items-start gap-3">
                        <span
                          className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded flex-shrink-0 whitespace-nowrap"
                          style={{ background: u.bg, color: u.color }}
                        >
                          {u.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-slate-800">
                            <strong>{rec.count}×</strong> {rec.role}
                            {rec.skill && <span className="text-slate-500 font-normal"> · {rec.skill}</span>}
                          </div>
                          <div className="text-[12px] text-slate-600 mt-0.5">{rec.rationale}</div>
                          {rec.drivenBy.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {rec.drivenBy.map((acct, j) => (
                                <span key={j} className="text-[10px] text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                                  {acct}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {prediction.recommendations.length === 0 && !loadingAI && (
                <p className="text-xs text-slate-400 italic">
                  Claude found no actionable signals. Either demand is balanced with current capacity, or there's not enough historical data yet.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Headline metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="India Roster"
          value={metrics.roster.total}
          icon={<Users size={20} />}
          subtitle={`${metrics.roster.billable} billable · ${metrics.roster.bench} bench`}
        />
        <StatCard
          label="Open Demand"
          value={metrics.demand.activePositions}
          icon={<Target size={20} />}
          subtitle={`${metrics.demand.activeReqs} reqs · ${metrics.demand.closingSoon} closing soon`}
        />
        <StatCard
          label="Median Time to Close"
          value={metrics.demand.medianTimeToCloseDays != null ? `${metrics.demand.medianTimeToCloseDays}d` : '—'}
          icon={<Clock size={20} />}
          subtitle={metrics.demand.medianFirstAdvanceDays != null ? `${metrics.demand.medianFirstAdvanceDays}d to first move` : 'Not enough data'}
        />
        <StatCard
          label="Net Adds (90d)"
          value={metrics.roster.netAdd90d}
          icon={<TrendingUp size={20} />}
          subtitle={`${metrics.roster.avgTenureDays}d avg tenure`}
        />
      </div>

      {/* Charts: roster growth + closures */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <h3 className="text-sm font-bold text-slate-700 mb-3">Roster Growth (last 6 months)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyGrowthChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="headcount" fill="#3b82f6" name="Headcount" />
              <Bar dataKey="joined" fill="#10b981" name="Joined this month" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="text-sm font-bold text-slate-700 mb-3">Closures vs Losses (last 12 weeks)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={closureChart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="closures" stroke="#10b981" strokeWidth={2} name="Closures" dot={{ r: 3 }} />
              <Line type="monotone" dataKey="losses" stroke="#ef4444" strokeWidth={2} name="Losses" dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Skill demand + per-account demand */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <h3 className="text-sm font-bold text-slate-700 mb-3">Top Skills in Demand</h3>
          {metrics.demand.topSkills.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No skill signals from active reqs.</p>
          ) : (() => {
              // Group Salesforce sub-clouds under a single parent header so a TA
              // Manager planning the bench can see "Salesforce: 52 open" with
              // the specialty breakdown indented underneath.
              type Row = (typeof metrics.demand.topSkills)[number];
              const salesforce: Row[] = [];
              const others: Row[] = [];
              for (const s of metrics.demand.topSkills) {
                (skillParent(s.skill) === 'Salesforce' ? salesforce : others).push(s);
              }
              salesforce.sort((a, b) => b.positions - a.positions);
              others.sort((a, b) => b.positions - a.positions);
              const sfTotal = salesforce.reduce((sum, s) => sum + s.positions, 0);
              const sfReqs = salesforce.reduce((sum, s) => sum + s.reqCount, 0);
              const max = Math.max(...metrics.demand.topSkills.map((x) => x.positions), 1, sfTotal);

              return (
                <div className="space-y-2">
                  {salesforce.length > 0 && (
                    <>
                      {/* Salesforce parent header */}
                      <div className="flex items-center gap-2 text-xs">
                        <span className="w-32 text-sky-700 font-bold flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-sky-500" /> Salesforce
                        </span>
                        <div className="flex-1 bg-sky-50 rounded-full h-5 overflow-hidden relative border border-sky-100">
                          <div className="bg-gradient-to-r from-sky-400 to-blue-500 h-full rounded-full flex items-center justify-end pr-2" style={{ width: `${(sfTotal / max) * 100}%` }}>
                            <span className="text-[10px] font-bold text-white">{sfTotal} pos · {sfReqs} reqs</span>
                          </div>
                        </div>
                      </div>
                      {/* Salesforce sub-cloud breakdown */}
                      {salesforce.map((s) => (
                        <div key={s.skill} className="flex items-center gap-2 text-xs">
                          <span className="w-32 text-slate-700 text-[11px] font-medium truncate pl-3" title={s.skill}>
                            <span className="text-slate-300 mr-1">└</span>
                            {s.skill.replace(/^Salesforce — /, '')}
                          </span>
                          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden relative">
                            <div className="bg-sky-500/70 h-full rounded-full flex items-center justify-end pr-2" style={{ width: `${Math.max(6, (s.positions / max) * 100)}%` }}>
                              <span className="text-[10px] font-bold text-white">{s.positions} pos</span>
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-500 w-20 text-right">
                            {s.reqCount} {s.reqCount === 1 ? 'req' : 'reqs'} · {s.accountCount} acct
                          </span>
                        </div>
                      ))}
                    </>
                  )}

                  {others.length > 0 && (
                    <>
                      {salesforce.length > 0 && <div className="h-1" />}
                      {others.map((s) => (
                        <div key={s.skill} className="flex items-center gap-2 text-xs">
                          <span className="w-32 text-slate-700 font-medium truncate" title={s.skill}>{s.skill}</span>
                          <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden relative">
                            <div className="bg-blue-500/70 h-full rounded-full flex items-center justify-end pr-2" style={{ width: `${(s.positions / max) * 100}%` }}>
                              <span className="text-[10px] font-bold text-white">{s.positions} pos</span>
                            </div>
                          </div>
                          <span className="text-[10px] text-slate-500 w-20 text-right">
                            {s.reqCount} {s.reqCount === 1 ? 'req' : 'reqs'} · {s.accountCount} acct
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                  {/* Bench planning hint */}
                  {sfTotal > 0 && (
                    <p className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500 leading-relaxed">
                      <strong className="text-slate-700">Bench mix recommendation:</strong> based on current open demand,
                      a 10-person Salesforce bench should over-index on{' '}
                      {salesforce.slice(0, 3).map((s, i) => (
                        <span key={s.skill}>
                          {i > 0 && (i === salesforce.slice(0, 3).length - 1 ? ' and ' : ', ')}
                          <strong className="text-sky-700">{s.skill.replace(/^Salesforce — /, '')}</strong>
                          {' ('}{Math.max(1, Math.round((s.positions / sfTotal) * 10))}{')'}
                        </span>
                      ))}
                      .
                    </p>
                  )}
                </div>
              );
            })()}
        </Card>

        <Card>
          <h3 className="text-sm font-bold text-slate-700 mb-3">Demand by Client</h3>
          {metrics.demand.byAccount.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No active demand right now.</p>
          ) : (
            <div className="overflow-y-auto max-h-72">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500 uppercase tracking-wide text-[10px]">
                    <th className="text-left pb-1.5 font-semibold">Account</th>
                    <th className="text-right pb-1.5 font-semibold">Active Reqs</th>
                    <th className="text-right pb-1.5 font-semibold">Open Pos</th>
                    <th className="text-right pb-1.5 font-semibold" title="Closures in last 90 days">Closures (90d)</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.demand.byAccount.map((a) => (
                    <tr key={a.account} className="border-b border-slate-50">
                      <td className="py-1 text-slate-700 font-medium">{accountNameById[a.account] || a.account}</td>
                      <td className="py-1 text-right tabular-nums">{a.activeReqs}</td>
                      <td className="py-1 text-right tabular-nums font-bold text-slate-700">{a.positions}</td>
                      <td className="py-1 text-right tabular-nums text-emerald-700">{a.recentClosures || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Role mix — collapsible */}
      <Card>
        <button onClick={() => setShowRoleMix((v) => !v)} className="w-full flex items-center justify-between text-left">
          <h3 className="text-sm font-bold text-slate-700">Current Role Mix</h3>
          {showRoleMix ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {showRoleMix && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            {metrics.roster.roleMix.map((r) => (
              <div key={r.role} className="flex items-center justify-between text-xs px-3 py-2 rounded bg-slate-50">
                <span className="text-slate-700 truncate" title={r.role}>{r.role}</span>
                <span className="font-bold text-slate-900 tabular-nums">{r.count}</span>
              </div>
            ))}
            {metrics.roster.roleMix.length === 0 && (
              <p className="text-xs text-slate-400 italic col-span-full">
                No roster members yet — add team members on the India Roster tab to enable this view.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Empty-state hint */}
      {metrics.roster.total === 0 && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertOctagon size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-900">
            <strong>India Roster is empty.</strong> Hiring forecast quality scales with roster data — add your India FTEs on the <em>India Roster</em> tab to unlock growth-trend signals.
          </div>
        </div>
      )}
    </>
  );
}
