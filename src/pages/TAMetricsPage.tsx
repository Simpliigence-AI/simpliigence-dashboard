/**
 * TA Metrics — dashboard for the Talent Acquisition team.
 *
 * KPIs and views:
 *  - This-week vs last-week activity (sourced+outreach, screens, submits+
 *    interviews) — derived from ta_daily_log.
 *  - Per-TA leaderboard (this-week totals, last-activity, candidates owned).
 *  - Funnel of candidate stages currently in flight.
 *  - 30-day trend line of total activity per day.
 *  - Per-source candidate breakdown (LinkedIn / Naukri / etc.).
 *
 * Pure read-only. Anyone signed in can see this page; non-admins are still
 * useful viewers (a TA can see how they stack against peers).
 */
import { useMemo } from 'react';
import {
  Users as UsersIcon, TrendingUp, TrendingDown, Minus, Filter,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid, Cell,
} from 'recharts';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard } from '../components/ui';
import { useTaLogStore } from '../store/useTaLogStore';
import { useStaffingStore } from '../store/useStaffingStore';
import { TA_LOG_COUNTERS } from '../types/taLog';
import {
  CANDIDATE_STAGES,
  CANDIDATE_STAGE_COLORS,
  ACTIVE_CANDIDATE_STAGES,
  type CandidateStage,
} from '../types/staffing';

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function startOfWeek(iso: string): Date {
  const d = parseIsoDate(iso);
  const day = d.getDay() || 7;
  if (day !== 1) d.setDate(d.getDate() - (day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}
function addDays(d: Date, n: number): Date {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + n);
  return nd;
}

export default function TAMetricsPage() {
  const { entries: logEntries } = useTaLogStore();
  const { candidates } = useStaffingStore();

  const todayIso = toIsoDate(new Date());
  const thisWeekStart = startOfWeek(todayIso);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const lastWeekEnd = addDays(thisWeekStart, -1);
  const thisWeekEnd = addDays(thisWeekStart, 6);

  // ── This-week vs last-week totals per counter ──
  const weekTotals = useMemo(() => {
    const acc = {
      thisWeek: { sourcedOutreach: 0, screensCompleted: 0, submissionsInterviews: 0 },
      lastWeek: { sourcedOutreach: 0, screensCompleted: 0, submissionsInterviews: 0 },
    };
    for (const e of logEntries) {
      const d = parseIsoDate(e.logDate);
      if (d >= thisWeekStart && d <= thisWeekEnd) {
        acc.thisWeek.sourcedOutreach += e.sourcedOutreach;
        acc.thisWeek.screensCompleted += e.screensCompleted;
        acc.thisWeek.submissionsInterviews += e.submissionsInterviews;
      } else if (d >= lastWeekStart && d <= lastWeekEnd) {
        acc.lastWeek.sourcedOutreach += e.sourcedOutreach;
        acc.lastWeek.screensCompleted += e.screensCompleted;
        acc.lastWeek.submissionsInterviews += e.submissionsInterviews;
      }
    }
    return acc;
  }, [logEntries, thisWeekStart, thisWeekEnd, lastWeekStart, lastWeekEnd]);

  // ── Per-TA leaderboard ──
  const taLeaderboard = useMemo(() => {
    const allTas = new Set<string>();
    candidates.forEach((c) => { if (c.owning_ta_email) allTas.add(c.owning_ta_email.toLowerCase()); });
    logEntries.forEach((e) => { if (e.taEmail) allTas.add(e.taEmail.toLowerCase()); });

    return Array.from(allTas).map((email) => {
      let thisWeek = 0, lastWeek = 0;
      let lastActivity: string | null = null;
      for (const e of logEntries) {
        if (e.taEmail.toLowerCase() !== email) continue;
        const total = e.sourcedOutreach + e.screensCompleted + e.submissionsInterviews;
        const d = parseIsoDate(e.logDate);
        if (d >= thisWeekStart && d <= thisWeekEnd) thisWeek += total;
        else if (d >= lastWeekStart && d <= lastWeekEnd) lastWeek += total;
        if (total > 0 && (!lastActivity || e.logDate > lastActivity)) lastActivity = e.logDate;
      }
      const ownedCandidates = candidates.filter((c) => (c.owning_ta_email || '').toLowerCase() === email);
      const activeOwned = ownedCandidates.filter((c) => ACTIVE_CANDIDATE_STAGES.includes(c.stage)).length;
      const submitsThisWeek = logEntries
        .filter((e) => e.taEmail.toLowerCase() === email
          && parseIsoDate(e.logDate) >= thisWeekStart && parseIsoDate(e.logDate) <= thisWeekEnd)
        .reduce((s, e) => s + e.submissionsInterviews, 0);
      return {
        email,
        thisWeek,
        lastWeek,
        diff: thisWeek - lastWeek,
        lastActivity,
        ownedTotal: ownedCandidates.length,
        ownedActive: activeOwned,
        submitsThisWeek,
      };
    }).sort((a, b) => b.thisWeek - a.thisWeek);
  }, [logEntries, candidates, thisWeekStart, thisWeekEnd, lastWeekStart, lastWeekEnd]);

  // ── Candidate stage funnel ──
  const stageFunnel = useMemo(() => {
    const counts: Record<CandidateStage, number> = Object.fromEntries(
      CANDIDATE_STAGES.map((s) => [s, 0]),
    ) as Record<CandidateStage, number>;
    for (const c of candidates) counts[c.stage] = (counts[c.stage] ?? 0) + 1;
    // Surface the canonical pipeline order
    const order: CandidateStage[] = [
      'Submitted', 'Screening', 'Interview Scheduled', 'Interviewed', 'Shortlisted',
      'Client Round', 'Selected', 'Offer Extended', 'Offer Accepted', 'Joined',
    ];
    return order.map((s) => ({ stage: s, count: counts[s] ?? 0, fill: CANDIDATE_STAGE_COLORS[s] }));
  }, [candidates]);

  // ── 30-day trend ──
  const trend30 = useMemo(() => {
    const days: { iso: string; label: string; total: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = addDays(new Date(), -i);
      const iso = toIsoDate(d);
      const total = logEntries
        .filter((e) => e.logDate === iso)
        .reduce((s, e) => s + e.sourcedOutreach + e.screensCompleted + e.submissionsInterviews, 0);
      days.push({
        iso,
        label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        total,
      });
    }
    return days;
  }, [logEntries]);

  // ── Source breakdown ──
  const sourceBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of candidates) {
      const src = c.source?.trim() || 'Unknown';
      m.set(src, (m.get(src) || 0) + 1);
    }
    return Array.from(m.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);
  }, [candidates]);

  const trendIcon = (diff: number) => diff > 0 ? <TrendingUp size={11} /> : diff < 0 ? <TrendingDown size={11} /> : <Minus size={11} />;
  const trendCls = (diff: number) => diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-400';

  const totalActiveCandidates = candidates.filter((c) => ACTIVE_CANDIDATE_STAGES.includes(c.stage)).length;
  const joinedThisMonth = candidates.filter((c) => {
    if (c.stage !== 'Joined') return false;
    if (!c.submit_date) return false;
    const d = parseIsoDate(c.submit_date);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="TA Metrics"
        subtitle="How the Talent Acquisition team is performing — KPIs, leaderboard, funnel, trend"
      />

      {/* This-week KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {TA_LOG_COUNTERS.map((c) => {
          const tw = weekTotals.thisWeek[c.key];
          const lw = weekTotals.lastWeek[c.key];
          const diff = tw - lw;
          return (
            <StatCard
              key={c.key}
              label={`This week · ${c.short}`}
              value={tw}
              subtitle={`Last week: ${lw}`}
              trend={diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'}
              trendValue={`${diff >= 0 ? '+' : ''}${diff} vs last week`}
            />
          );
        })}
        <StatCard
          label="Active candidates"
          value={totalActiveCandidates}
          subtitle={`${candidates.length} total · ${joinedThisMonth} joined this month`}
          icon={<UsersIcon size={18} />}
        />
      </div>

      {/* Per-TA leaderboard */}
      <Card title={`Team leaderboard · ${taLeaderboard.length} TAs`} className="mb-6">
        {taLeaderboard.length === 0 ? (
          <div className="text-sm text-slate-500 text-center py-8">
            No TA activity logged yet. Open <strong>TA Daily Log</strong> and log a few entries.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-3 font-semibold">TA</th>
                  <th className="py-2 pr-3 font-semibold text-right">This week</th>
                  <th className="py-2 pr-3 font-semibold text-right">Last week</th>
                  <th className="py-2 pr-3 font-semibold">Trend</th>
                  <th className="py-2 pr-3 font-semibold text-right">Submits (wk)</th>
                  <th className="py-2 pr-3 font-semibold text-right">Active candidates</th>
                  <th className="py-2 pr-3 font-semibold text-right">Owned total</th>
                  <th className="py-2 pr-3 font-semibold">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {taLeaderboard.map((r) => (
                  <tr key={r.email} className="hover:bg-slate-50/60">
                    <td className="py-2 pr-3 text-xs font-medium text-slate-900">{r.email}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold">{r.thisWeek}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{r.lastWeek}</td>
                    <td className={`py-2 pr-3 text-xs font-semibold ${trendCls(r.diff)}`}>
                      <span className="inline-flex items-center gap-0.5">
                        {trendIcon(r.diff)} {r.diff >= 0 ? '+' : ''}{r.diff}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-700">{r.submitsThisWeek}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold text-emerald-700">{r.ownedActive}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{r.ownedTotal}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{r.lastActivity ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Stage funnel */}
        <Card title="Candidate funnel (current snapshot)">
          {stageFunnel.every((s) => s.count === 0) ? (
            <div className="text-sm text-slate-500 text-center py-8">
              No candidates yet. Add some from the <strong>Candidates</strong> page.
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stageFunnel} layout="vertical" margin={{ top: 10, right: 20, bottom: 10, left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="stage" tick={{ fontSize: 11 }} width={130} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {stageFunnel.map((s) => (
                      <Cell key={s.stage} fill={s.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Source breakdown */}
        <Card title="Where candidates come from">
          {sourceBreakdown.length === 0 ? (
            <div className="text-sm text-slate-500 text-center py-8">No source data yet.</div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sourceBreakdown} margin={{ top: 10, right: 20, bottom: 40, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="source" tick={{ fontSize: 11 }} angle={-25} textAnchor="end" interval={0} height={50} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* 30-day trend */}
      <Card title="Last 30 days · total activity per day" className="mb-6">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend30} margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={Math.ceil(trend30.length / 12)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="total" stroke="#0ea5e9" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="text-[10px] text-slate-400 flex items-center gap-1">
        <Filter size={10} /> KPIs read from <code className="font-mono">ta_daily_log</code> + <code className="font-mono">india_staffing_candidates</code>. Realtime — updates without refresh.
      </div>
    </div>
  );
}
