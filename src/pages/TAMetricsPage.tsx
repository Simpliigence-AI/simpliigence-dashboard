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
import { useMemo, useState } from 'react';
import {
  Users as UsersIcon, TrendingUp, TrendingDown, Minus, Filter, Download,
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
  const { candidates, requisitions } = useStaffingStore();
  // Filters for the daily-log explorer + by-requisition rollup at the bottom.
  // Default to current month + all recruiters.
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [filterMonth, setFilterMonth] = useState<string>(currentMonth);
  const [filterTa, setFilterTa] = useState<string>('all');

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

  // ── Daily Log Explorer + By-Requisition rollup ──
  // List of months that have any data (always include the current month)
  const availableMonths = useMemo(() => {
    const set = new Set<string>([currentMonth]);
    for (const e of logEntries) set.add(e.logDate.slice(0, 7));
    return Array.from(set).sort().reverse();
  }, [logEntries, currentMonth]);

  // List of TA emails who have logged anything
  const availableTas = useMemo(() => {
    const set = new Set<string>();
    for (const e of logEntries) set.add(e.taEmail);
    return Array.from(set).sort();
  }, [logEntries]);

  // Requisition title lookup
  const reqTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of requisitions) m.set(r.id, r.title);
    return m;
  }, [requisitions]);

  // Filtered log rows for the selected month + recruiter
  const filteredLog = useMemo(() => {
    return logEntries
      .filter((e) => e.logDate.slice(0, 7) === filterMonth)
      .filter((e) => filterTa === 'all' || e.taEmail === filterTa)
      .sort((a, b) => b.logDate.localeCompare(a.logDate) || a.taEmail.localeCompare(b.taEmail));
  }, [logEntries, filterMonth, filterTa]);

  // Per-requisition rollup over the filtered set
  const byRequisition = useMemo(() => {
    const m = new Map<string, {
      reqId: string; title: string; minutes: number; days: Set<string>;
      recruiters: Set<string>; sourced: number; screens: number; submits: number; entries: number;
    }>();
    for (const e of filteredLog) {
      // Skip pure activity entries (no requisition) for this view
      if (!e.requisitionId) continue;
      const cur = m.get(e.requisitionId) || {
        reqId: e.requisitionId,
        title: reqTitleById.get(e.requisitionId) || e.requisitionId,
        minutes: 0, days: new Set<string>(), recruiters: new Set<string>(),
        sourced: 0, screens: 0, submits: 0, entries: 0,
      };
      cur.minutes += e.minutesSpent || 0;
      cur.days.add(e.logDate);
      cur.recruiters.add(e.taEmail);
      cur.sourced += e.sourcedOutreach || 0;
      cur.screens += e.screensCompleted || 0;
      cur.submits += e.submissionsInterviews || 0;
      cur.entries += 1;
      m.set(e.requisitionId, cur);
    }
    return Array.from(m.values()).sort((a, b) => (b.minutes - a.minutes) || (b.days.size - a.days.size));
  }, [filteredLog, reqTitleById]);

  // Format minutes as "Xh Ym"
  const fmtHours = (m: number) => {
    if (!m) return '—';
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h && mm) return `${h}h ${mm}m`;
    if (h) return `${h}h`;
    return `${mm}m`;
  };

  // Build + download a CSV from the currently-filtered daily log
  const downloadDailyLogCsv = () => {
    const header = ['Date', 'Recruiter', 'Requisition / Activity', 'Customer / Activity Detail',
      'Minutes', 'Hours', 'Sourced', 'Screened', 'Submitted', 'Notes'];
    const esc = (v: string | number | null | undefined): string => {
      const s = (v ?? '').toString().replace(/\r?\n/g, ' ').replace(/"/g, '""');
      return /[",]/.test(s) ? `"${s}"` : s;
    };
    const lines: string[] = [header.map(esc).join(',')];
    for (const e of filteredLog) {
      const reqOrActivity = e.requisitionId ? (reqTitleById.get(e.requisitionId) || e.requisitionId) : (e.activityType || '');
      lines.push([
        e.logDate, e.taEmail, reqOrActivity, e.customerName || '',
        e.minutesSpent || 0, ((e.minutesSpent || 0) / 60).toFixed(2),
        e.sourcedOutreach || 0, e.screensCompleted || 0, e.submissionsInterviews || 0, e.notes || '',
      ].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TA-Daily-Log-${filterMonth}${filterTa !== 'all' ? '-' + filterTa.replace(/[^a-zA-Z0-9]+/g, '_') : ''}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadByReqCsv = () => {
    const header = ['Requisition', 'Days', 'Hours', 'Entries', 'Recruiters', 'Sourced', 'Screened', 'Submitted'];
    const esc = (v: string | number): string => {
      const s = v.toString().replace(/"/g, '""');
      return /[",]/.test(s) ? `"${s}"` : s;
    };
    const lines: string[] = [header.map(esc).join(',')];
    for (const r of byRequisition) {
      lines.push([
        r.title, r.days.size, (r.minutes / 60).toFixed(2), r.entries,
        Array.from(r.recruiters).join(' / '),
        r.sourced, r.screens, r.submits,
      ].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TA-Time-by-Requisition-${filterMonth}${filterTa !== 'all' ? '-' + filterTa.replace(/[^a-zA-Z0-9]+/g, '_') : ''}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

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

      {/* ── Daily Log Explorer ── filterable view + CSV export ── */}
      <Card
        title="Daily log explorer"
        className="mb-6"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
                    className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white">
              {availableMonths.map((m) => {
                const d = new Date(m + '-01T00:00:00');
                const label = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
                return <option key={m} value={m}>{label}</option>;
              })}
            </select>
            <select value={filterTa} onChange={(e) => setFilterTa(e.target.value)}
                    className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white">
              <option value="all">All recruiters</option>
              {availableTas.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button type="button" onClick={downloadDailyLogCsv}
                    disabled={filteredLog.length === 0}
                    className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1">
              <Download size={12} /> Export CSV
            </button>
          </div>
        }
      >
        {filteredLog.length === 0 ? (
          <div className="text-sm text-slate-500 text-center py-8">No log entries for this month / recruiter.</div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  <th className="py-2 pr-3 font-semibold">Recruiter</th>
                  <th className="py-2 pr-3 font-semibold">Requisition / activity</th>
                  <th className="py-2 pr-3 font-semibold text-right">Time</th>
                  <th className="py-2 pr-3 font-semibold text-right">Src</th>
                  <th className="py-2 pr-3 font-semibold text-right">Scr</th>
                  <th className="py-2 pr-3 font-semibold text-right">Sub</th>
                  <th className="py-2 pr-3 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLog.map((e) => {
                  const work = e.requisitionId
                    ? (reqTitleById.get(e.requisitionId) || e.requisitionId)
                    : (e.activityType ? `${e.activityType}${e.customerName ? ': ' + e.customerName : ''}` : '—');
                  return (
                    <tr key={e.id} className="hover:bg-slate-50/60 align-top">
                      <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{e.logDate}</td>
                      <td className="py-2 pr-3 text-slate-900 font-medium whitespace-nowrap">{e.taEmail}</td>
                      <td className="py-2 pr-3 text-slate-700">{work}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtHours(e.minutesSpent)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{e.sourcedOutreach || '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{e.screensCompleted || '—'}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{e.submissionsInterviews || '—'}</td>
                      <td className="py-2 pr-3 text-slate-600 max-w-md">{e.notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="text-[10px] text-slate-400 mt-2">
              {filteredLog.length} entries · {fmtHours(filteredLog.reduce((s, e) => s + (e.minutesSpent || 0), 0))} total time logged
            </div>
          </div>
        )}
      </Card>

      {/* ── Time by Requisition ── per-req rollup over the same filtered window ── */}
      <Card
        title="Time by requisition"
        className="mb-6"
        action={
          <button type="button" onClick={downloadByReqCsv}
                  disabled={byRequisition.length === 0}
                  className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1">
            <Download size={12} /> Export CSV
          </button>
        }
      >
        {byRequisition.length === 0 ? (
          <div className="text-sm text-slate-500 text-center py-8">No requisition-tagged log entries for this filter. (Pure activity entries are excluded from this view.)</div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-3 font-semibold">Requisition</th>
                  <th className="py-2 pr-3 font-semibold text-right">Days</th>
                  <th className="py-2 pr-3 font-semibold text-right">Hours</th>
                  <th className="py-2 pr-3 font-semibold text-right">Entries</th>
                  <th className="py-2 pr-3 font-semibold">Recruiters</th>
                  <th className="py-2 pr-3 font-semibold text-right">Sourced</th>
                  <th className="py-2 pr-3 font-semibold text-right">Screens</th>
                  <th className="py-2 pr-3 font-semibold text-right">Submits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {byRequisition.map((r) => (
                  <tr key={r.reqId} className="hover:bg-slate-50/60">
                    <td className="py-2 pr-3 text-slate-900 font-medium">{r.title}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-700">{r.days.size}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold text-emerald-700">{(r.minutes / 60).toFixed(1)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-slate-600">{r.entries}</td>
                    <td className="py-2 pr-3 text-slate-600">{Array.from(r.recruiters).join(' · ')}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.sourced}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.screens}</td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold text-indigo-700">{r.submits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-[10px] text-slate-400 mt-2">
              {byRequisition.length} requisitions worked · {fmtHours(byRequisition.reduce((s, r) => s + r.minutes, 0))} total time on requisitions
            </div>
          </div>
        )}
      </Card>

      <div className="text-[10px] text-slate-400 flex items-center gap-1">
        <Filter size={10} /> KPIs read from <code className="font-mono">ta_daily_log</code> + <code className="font-mono">india_staffing_candidates</code>. Realtime — updates without refresh.
      </div>
    </div>
  );
}
