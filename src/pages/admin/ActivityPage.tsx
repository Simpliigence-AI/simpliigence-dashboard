/**
 * Admin → Activity. Login + page-view analytics from `user_sessions` and
 * `user_page_views`. Last 30 days by default.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Eye, Users as UsersIcon, Activity } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Card, StatCard, Drawer } from '../../components/ui';
import { supabase } from '../../lib/supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

interface SessionRow {
  id: string;
  user_id: string;
  email: string;
  started_at: string;
  last_active: string;
  ended_at: string | null;
  user_agent: string | null;
}

interface PageViewRow {
  id: number;
  session_id: string;
  user_id: string;
  email: string;
  path: string;
  entered_at: string;
  exited_at: string | null;
  dwell_ms: number | null;
}

const RANGE_OPTIONS = [
  { key: '7', label: 'Last 7 days', days: 7 },
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
] as const;

function ymdLocal(d: Date): string {
  return d.toLocaleDateString('en-CA'); // → YYYY-MM-DD
}

export default function ActivityPage() {
  const [rangeDays, setRangeDays] = useState<number>(30);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [pageViews, setPageViews] = useState<PageViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<string | null>(null);   // email

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000).toISOString();
    try {
      const [sRes, pRes] = await Promise.all([
        supabase.from('user_sessions').select('*').gte('started_at', since).order('started_at', { ascending: false }).limit(5000),
        supabase.from('user_page_views').select('*').gte('entered_at', since).order('entered_at', { ascending: false }).limit(20000),
      ]);
      if (sRes.error) {
        console.error('[activity] user_sessions fetch error:', sRes.error);
        setError(`Couldn't load sessions: ${sRes.error.message}`);
      }
      if (pRes.error) {
        console.error('[activity] user_page_views fetch error:', pRes.error);
        // Don't override the sessions error if it's already set
        setError((prev) => prev ?? `Couldn't load page views: ${pRes.error!.message}`);
      }
      setSessions((sRes.data as SessionRow[]) ?? []);
      setPageViews((pRes.data as PageViewRow[]) ?? []);
    } catch (e) {
      console.error('[activity] refresh threw:', e);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

  useEffect(() => { void refresh(); }, [refresh]);

  // KPIs
  const distinctUsers = useMemo(() => new Set(sessions.map((s) => s.email)).size, [sessions]);
  const totalSessions = sessions.length;
  const totalPageViews = pageViews.length;
  const avgSessionMins = useMemo(() => {
    if (sessions.length === 0) return 0;
    const sum = sessions.reduce((s, x) => {
      const end = x.ended_at ? new Date(x.ended_at).getTime() : new Date(x.last_active).getTime();
      const start = new Date(x.started_at).getTime();
      return s + Math.max(0, end - start);
    }, 0);
    return Math.round((sum / sessions.length) / 60000);
  }, [sessions]);

  // Daily sessions chart (last N days)
  const daily = useMemo(() => {
    const buckets: Record<string, number> = {};
    const now = new Date();
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      buckets[ymdLocal(d)] = 0;
    }
    for (const s of sessions) {
      const day = ymdLocal(new Date(s.started_at));
      if (day in buckets) buckets[day] += 1;
    }
    return Object.entries(buckets).map(([day, count]) => ({
      day: day.slice(5),     // MM-DD
      sessions: count,
    }));
  }, [sessions, rangeDays]);

  // Per-user summary
  const perUser = useMemo(() => {
    const map = new Map<string, {
      email: string;
      sessions: number;
      pageViews: number;
      totalMs: number;
      lastSeen: string;
      topPaths: Record<string, number>;
    }>();
    for (const s of sessions) {
      let row = map.get(s.email);
      if (!row) {
        row = { email: s.email, sessions: 0, pageViews: 0, totalMs: 0, lastSeen: s.started_at, topPaths: {} };
        map.set(s.email, row);
      }
      row.sessions += 1;
      const end = s.ended_at ? new Date(s.ended_at).getTime() : new Date(s.last_active).getTime();
      row.totalMs += Math.max(0, end - new Date(s.started_at).getTime());
      if (s.started_at > row.lastSeen) row.lastSeen = s.started_at;
    }
    for (const pv of pageViews) {
      const row = map.get(pv.email);
      if (!row) continue;
      row.pageViews += 1;
      row.topPaths[pv.path] = (row.topPaths[pv.path] ?? 0) + 1;
    }
    return [...map.values()]
      .map((r) => ({
        ...r,
        topPaths: Object.entries(r.topPaths).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p),
        totalMins: Math.round(r.totalMs / 60000),
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [sessions, pageViews]);

  const drilldownSessions = useMemo(
    () => sessions.filter((s) => s.email === drilldown).sort((a, b) => b.started_at.localeCompare(a.started_at)),
    [sessions, drilldown],
  );
  const drilldownPageViews = useMemo(
    () => pageViews.filter((p) => p.email === drilldown).sort((a, b) => b.entered_at.localeCompare(a.entered_at)),
    [pageViews, drilldown],
  );

  return (
    <>
      <PageHeader title="Activity" subtitle="Who's logging in and what they're doing." />

      <div className="flex items-center gap-2 mb-4 text-sm">
        <span className="text-slate-500">Range:</span>
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setRangeDays(opt.days)}
            className={`px-3 py-1 rounded-lg border transition-colors ${
              rangeDays === opt.days
                ? 'bg-primary/10 border-primary/40 text-primary font-semibold'
                : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
        {loading && <span className="ml-2 text-xs text-slate-400">Loading…</span>}
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          <strong>Error:</strong> {error}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard icon={<UsersIcon size={22} />} label="Distinct users" value={distinctUsers} />
        <StatCard icon={<Activity size={22} />} label="Sessions" value={totalSessions} />
        <StatCard icon={<Eye size={22} />} label="Page views" value={totalPageViews} />
        <StatCard icon={<Clock size={22} />} label="Avg session" value={`${avgSessionMins} min`} />
      </div>

      <Card title="Sessions per day" className="mb-6">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={daily}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="day" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="sessions" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="By user">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="pb-3 pr-3 font-semibold text-slate-600">User</th>
              <th className="pb-3 pr-3 font-semibold text-slate-600 text-right">Sessions</th>
              <th className="pb-3 pr-3 font-semibold text-slate-600 text-right">Page views</th>
              <th className="pb-3 pr-3 font-semibold text-slate-600 text-right">Time active</th>
              <th className="pb-3 pr-3 font-semibold text-slate-600">Last seen</th>
              <th className="pb-3 pr-3 font-semibold text-slate-600">Top pages</th>
            </tr>
          </thead>
          <tbody>
            {perUser.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-sm text-slate-400">No sessions in this range.</td></tr>
            )}
            {perUser.map((r) => (
              <tr
                key={r.email}
                onClick={() => setDrilldown(r.email)}
                className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
              >
                <td className="py-2.5 pr-3 font-medium text-slate-800">{r.email}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{r.sessions}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{r.pageViews}</td>
                <td className="py-2.5 pr-3 text-right tabular-nums text-slate-700 font-semibold">
                  {r.totalMins >= 60 ? `${Math.floor(r.totalMins / 60)}h ${r.totalMins % 60}m` : `${r.totalMins}m`}
                </td>
                <td className="py-2.5 pr-3 text-xs text-slate-500">{new Date(r.lastSeen).toLocaleString()}</td>
                <td className="py-2.5 pr-3 text-xs text-slate-500 truncate max-w-[280px]">
                  {r.topPaths.length > 0 ? r.topPaths.join(', ') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Drawer
        open={!!drilldown}
        onClose={() => setDrilldown(null)}
        title={drilldown ? `Activity — ${drilldown}` : ''}
        width="max-w-2xl"
      >
        <div className="space-y-5">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Sessions</h3>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="py-2 pr-2 font-semibold text-slate-500">Started</th>
                  <th className="py-2 pr-2 font-semibold text-slate-500">Duration</th>
                  <th className="py-2 pr-2 font-semibold text-slate-500">Ended</th>
                </tr>
              </thead>
              <tbody>
                {drilldownSessions.map((s) => {
                  const start = new Date(s.started_at);
                  const endTs = s.ended_at ? new Date(s.ended_at) : new Date(s.last_active);
                  const mins = Math.round((endTs.getTime() - start.getTime()) / 60000);
                  return (
                    <tr key={s.id} className="border-b border-slate-50">
                      <td className="py-1.5 pr-2 text-slate-700">{start.toLocaleString()}</td>
                      <td className="py-1.5 pr-2 tabular-nums text-slate-700">
                        {mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}
                      </td>
                      <td className="py-1.5 pr-2 text-xs text-slate-500">
                        {s.ended_at ? new Date(s.ended_at).toLocaleTimeString() : <em>open · last active {endTs.toLocaleTimeString()}</em>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Page-view timeline ({drilldownPageViews.length})</h3>
            <div className="max-h-[460px] overflow-y-auto space-y-1 pr-1">
              {drilldownPageViews.map((p) => {
                const dwellS = p.dwell_ms ? Math.round(p.dwell_ms / 1000) : null;
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 text-xs border-b border-slate-50 py-1">
                    <span className="text-slate-700 font-mono truncate flex-1">{p.path}</span>
                    <span className="text-slate-500 shrink-0">{new Date(p.entered_at).toLocaleString()}</span>
                    <span className="text-slate-400 shrink-0 w-14 text-right">
                      {dwellS == null ? '—' : dwellS >= 60 ? `${Math.floor(dwellS / 60)}m ${dwellS % 60}s` : `${dwellS}s`}
                    </span>
                  </div>
                );
              })}
              {drilldownPageViews.length === 0 && <div className="text-slate-400 text-xs italic">No page views in this range.</div>}
            </div>
          </div>
        </div>
      </Drawer>
    </>
  );
}
