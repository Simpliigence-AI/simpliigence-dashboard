import { useMemo, useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, FolderKanban, Clock, DollarSign, Search, Sparkles, X, Loader2,
  Globe, ArrowUpRight, History, ClipboardList, Handshake, UserCheck,
} from 'lucide-react';
import {
  useForecastStore, useHiringForecastStore, usePipelineStore,
  useStaffingStore, useUSStaffingStore,
} from '../store';
import { useIndiaRosterStore } from '../store/useIndiaRosterStore';
import { useUSRosterStore } from '../store/useUSRosterStore';
import { useOpenBenchStore } from '../store/useOpenBenchStore';
import { useVendorStore } from '../store/useVendorStore';
import { useAccountStore } from '../store/useAccountStore';
import { STALE_CONNECT_DAYS } from '../types/accountMgmt';
import { StatCard, Card } from '../components/ui';
import { PageHeader } from '../components/shared/PageHeader';
import { Sensitive } from '../components/Sensitive';
import { deriveEmployeeSummaries, deriveProjectSummaries } from '../lib/parseSpreadsheet';
import { runQuery, SUGGESTED_QUERIES } from '../lib/queryEngine';
import type { QueryResult } from '../lib/queryEngine';
import { runClaudeQuery, getClaudeApiKey } from '../lib/claudeQuery';
import type { HiringForecastInput, SmartQueryExtras } from '../lib/claudeQuery';
import { useTaLogStore } from '../store/useTaLogStore';
import { computeHiringForecast } from '../lib/hiringForecastCalc';
import { MONTHS } from '../types/forecast';
import type { ForecastAssignment, Month } from '../types/forecast';
import type { PipelineProject } from '../types/hiringForecast';
import { CHART_COLORS } from '../constants/brand';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899', '#14b8a6', '#a855f7'];

/* ── Smart Query Panel ─────────────────────────────── */
function SmartQueryPanel({
  assignments,
  hiringForecast,
  extras,
}: {
  assignments: ForecastAssignment[];
  hiringForecast: HiringForecastInput;
  extras: SmartQueryExtras;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hasClaude = !!getClaudeApiKey();

  const handleSubmit = useCallback(async (q?: string) => {
    const text = q ?? query;
    if (!text.trim()) return;
    setQuery(text);

    if (getClaudeApiKey()) {
      setLoading(true);
      setResult(null);
      try {
        const res = await runClaudeQuery(text, assignments, hiringForecast, extras);
        setResult(res);
      } finally {
        setLoading(false);
      }
    } else {
      setResult(runQuery(text, assignments as any));
    }
  }, [query, assignments, hiringForecast, extras]);

  const handleClear = () => {
    setQuery('');
    setResult(null);
    setLoading(false);
    inputRef.current?.focus();
  };

  return (
    <div className="mb-6">
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={18} className="text-blue-600" />
          <span className="text-sm font-semibold text-blue-800">Smart Query</span>
          {hasClaude
            ? <span className="text-xs text-blue-500">Powered by Claude AI — ask anything about your data</span>
            : <span className="text-xs text-blue-500">Add your Claude API key in Settings for AI-powered answers</span>
          }
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Which BA has capacity in May?"
              className="w-full pl-9 pr-8 py-2.5 text-sm border border-blue-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
            />
            {query && (
              <button type="button" onClick={handleClear} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Ask
          </button>
        </form>

        {/* Suggested queries */}
        {!result && (
          <div className="flex flex-wrap gap-2 mt-3">
            {SUGGESTED_QUERIES.map((sq) => (
              <button
                key={sq}
                onClick={() => { setQuery(sq); handleSubmit(sq); }}
                className="text-xs px-3 py-1.5 bg-white border border-blue-200 rounded-full text-blue-700 hover:bg-blue-50 hover:border-blue-300 transition-colors"
              >
                {sq}
              </button>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="mt-4 bg-white rounded-lg border border-blue-100 p-6 flex items-center justify-center gap-3">
            <Loader2 size={18} className="text-blue-500 animate-spin" />
            <span className="text-sm text-slate-500">Claude is thinking...</span>
          </div>
        )}

        {/* Result */}
        {result && !loading && (
          <div className="mt-4 bg-white rounded-lg border border-blue-100 p-4">
            <div className="prose prose-sm max-w-none text-slate-700 [&_strong]:text-slate-900">
              {result.answer.split('\n').map((line, i) => (
                <p key={i} className={`${line.startsWith('-') ? 'ml-2' : ''} ${!line.trim() ? 'hidden' : ''} my-1`}>
                  {line.split(/(\*\*[^*]+\*\*)/).map((part, j) =>
                    part.startsWith('**') && part.endsWith('**')
                      ? <strong key={j}>{part.slice(2, -2)}</strong>
                      : part
                  )}
                </p>
              ))}
            </div>

            {/* Data table */}
            {result.data && result.columns && result.data.length > 0 && (
              <div className="mt-3 overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr className="border-b border-slate-200">
                      {result.columns.map((col) => (
                        <th key={col} className="py-2 px-3 text-left font-semibold text-slate-600 text-xs">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.map((row, i) => (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                        {result.columns!.map((col) => (
                          <td key={col} className="py-1.5 px-3 text-slate-700 tabular-nums">{row[col] ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Ask another */}
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
              <span className="text-xs text-slate-400">Try also:</span>
              {SUGGESTED_QUERIES.filter((sq) => sq !== query).slice(0, 4).map((sq) => (
                <button
                  key={sq}
                  onClick={() => { setQuery(sq); handleSubmit(sq); }}
                  className="text-xs px-2 py-1 bg-slate-50 border border-slate-200 rounded-full text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  {sq}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const assignments = useForecastStore((s) => s.assignments);
  const staffingRequests = useHiringForecastStore((s) => s.staffingRequests);
  const scenarioSettings = useHiringForecastStore((s) => s.scenarioSettings);
  const pipelineStoreProjects = usePipelineStore((s) => s.projects);

  // Cross-section data sources for the cockpit
  const indiaReqs = useStaffingStore((s) => s.requisitions);
  const indiaHistory = useStaffingStore((s) => s.history);
  const indiaAccounts = useStaffingStore((s) => s.accounts);
  const indiaRoster = useIndiaRosterStore((s) => s.members);
  const usReqs = useUSStaffingStore((s) => s.requisitions);
  const usAccounts = useUSStaffingStore((s) => s.accounts);
  const usRoster = useUSRosterStore((s) => s.members);
  const benchResources = useOpenBenchStore((s) => s.resources);
  const benchUpdates = useOpenBenchStore((s) => s.updates);
  // Account Management module — accounts, sales/delivery connects, action items
  const accounts = useAccountStore((s) => s.accounts);
  const accountConnects = useAccountStore((s) => s.connects);
  const accountActions = useAccountStore((s) => s.actions);
  // India staffing candidates pipeline
  const candidates = useStaffingStore((s) => s.candidates);
  // Vendor outreach + TA daily log — wired into the Smart Query data context
  const vendors = useVendorStore((s) => s.vendors);
  const vendorOutreach = useVendorStore((s) => s.outreach);
  const taLogEntries = useTaLogStore((s) => s.entries);

  const employees = useMemo(() => deriveEmployeeSummaries(assignments), [assignments]);
  const projects = useMemo(() => deriveProjectSummaries(assignments), [assignments]);

  // Same conversion as the Hiring Forecast tab — keep Smart Query in sync with what that tab computes.
  const pipelineProjects: PipelineProject[] = useMemo(() => {
    return pipelineStoreProjects
      .filter((p) => p.source === 'manual')
      .map((zp) => {
        const startMonth: Month = zp.startDate ? MONTHS[new Date(zp.startDate).getMonth()] : 'Jan';
        const endMonth: Month = zp.endDate ? MONTHS[new Date(zp.endDate).getMonth()] : 'Dec';
        const headcount = { BA: 0, JuniorDev: 0, SeniorDev: 0 } as Record<'BA' | 'JuniorDev' | 'SeniorDev', number>;
        let hoursPerPerson = 160;
        for (const r of zp.resources) {
          if (r.roleCategory === 'BA' || r.roleCategory === 'JuniorDev' || r.roleCategory === 'SeniorDev') {
            headcount[r.roleCategory] = r.count;
            hoursPerPerson = r.hoursPerMonth || 160;
          }
        }
        return {
          id: zp.id,
          projectName: zp.name,
          startMonth,
          endMonth,
          headcount,
          hoursPerPerson,
          source: 'manual' as const,
        };
      });
  }, [pipelineStoreProjects]);

  const hiringForecast: HiringForecastInput = useMemo(() => ({
    gapRows: computeHiringForecast(assignments, staffingRequests, pipelineProjects, scenarioSettings),
    scenario: scenarioSettings,
    staffingRequests,
  }), [assignments, staffingRequests, pipelineProjects, scenarioSettings]);

  const totalEmployees = employees.length;
  const totalProjects = projects.length;
  const totalHours = employees.reduce((s, e) => s + e.totalHours, 0);
  const totalCost = projects.reduce((s, p) => s + p.loadedCost, 0);

  // Monthly hours trend
  const monthlyTrend = useMemo(() =>
    MONTHS.map((m) => ({
      month: m,
      hours: employees.reduce((s, e) => s + e.monthlyHours[m], 0),
    })),
    [employees],
  );

  // Project allocation pie
  const projectPie = useMemo(() =>
    projects.map((p) => ({ name: p.name, value: p.totalHours })),
    [projects],
  );

  // Top employees by hours
  const topEmployees = useMemo(() =>
    employees.slice(0, 10).map((e) => ({
      name: e.name.split(' ')[0],
      q1: e.q1Hours,
      q2: e.q2Hours,
    })),
    [employees],
  );

  // Role distribution
  const roleDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of employees) {
      const role = e.role || 'Unspecified';
      map.set(role, (map.get(role) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [employees]);

  /* ── Cross-section KPIs ──────────────────────────────────── */

  const ARCHIVED = ['Closed', 'Lost', 'Cancelled'];

  // PROJECTS
  const activeZohoProjects = pipelineStoreProjects.filter(
    (p) => p.source === 'zoho' && !['Completed', 'On Hold'].includes(p.status),
  ).length;
  const totalRevenueUSD = pipelineStoreProjects.reduce((sum, p) => {
    if (!p.revenue) return sum;
    return sum + (p.revenueCurrency === 'CAD' ? p.revenue * 0.73 : p.revenue);
  }, 0);

  // INDIA T&M
  const indiaActiveReqs = indiaReqs.filter((r) => !ARCHIVED.includes(r.status_field)).length;
  const indiaOpenPositions = indiaReqs
    .filter((r) => !ARCHIVED.includes(r.status_field))
    .reduce((s, r) => s + (r.new_positions || 0), 0);
  const indiaRosterTotal = indiaRoster.length;
  const indiaBilling = indiaRoster.filter((m) => m.status === 'Billable').length;
  const indiaBench = indiaRoster.filter((m) => m.status === 'Bench').length;

  // US T&M
  const usActiveReqs = usReqs.filter(
    (r) => !['Closed/Selected', 'Onboarding', 'Cancelled'].includes(r.stage),
  ).length;
  const usRosterTotal = usRoster.length;
  const usBenchAvailable = benchResources.filter((b) => b.available).length;

  // ACCOUNT MANAGEMENT
  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.status === 'active'),
    [accounts],
  );
  const staleAccountCount = useMemo(() => {
    const cutoff = Date.now() - STALE_CONNECT_DAYS * 86_400_000;
    return activeAccounts.filter((a) => {
      const cs = accountConnects.filter((c) => c.accountId === a.id);
      const lastSales = cs.filter((c) => c.connectType === 'sales')
        .reduce((latest: string | null, c) => (!latest || c.meetingDate > latest ? c.meetingDate : latest), null);
      const lastDelivery = cs.filter((c) => c.connectType === 'delivery')
        .reduce((latest: string | null, c) => (!latest || c.meetingDate > latest ? c.meetingDate : latest), null);
      const staleS = !lastSales || Date.parse(lastSales) < cutoff;
      const staleD = !lastDelivery || Date.parse(lastDelivery) < cutoff;
      return staleS || staleD;
    }).length;
  }, [activeAccounts, accountConnects]);
  const openActionCount = useMemo(
    () => accountActions.filter((a) => a.status === 'open' || a.status === 'in_progress').length,
    [accountActions],
  );
  const overdueActionCount = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return accountActions.filter((a) =>
      (a.status === 'open' || a.status === 'in_progress') && a.dueDate && a.dueDate < today,
    ).length;
  }, [accountActions]);
  const recentConnectCount7d = useMemo(() => {
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    return accountConnects.filter((c) => c.meetingDate >= cutoff).length;
  }, [accountConnects]);

  // INDIA CANDIDATES PIPELINE
  const ACTIVE_CANDIDATE_STAGES = ['Submitted', 'Screening', 'Interview Scheduled', 'Interviewed', 'Shortlisted', 'Client Round', 'Selected', 'Offer Extended', 'Offer Accepted', 'Joined'];
  const activeCandidates = useMemo(
    () => candidates.filter((c) => ACTIVE_CANDIDATE_STAGES.includes(c.stage)),
    [candidates],
  );
  const parsedThisWeek = useMemo(() => {
    const cutoff = Date.now() - 7 * 86_400_000;
    return candidates.filter((c) => c.parsed_at && Date.parse(c.parsed_at) >= cutoff).length;
  }, [candidates]);
  const candidatesWithResume = useMemo(
    () => candidates.filter((c) => !!c.resume_url).length,
    [candidates],
  );

  /* ── Recent Activity feed (last 14 days, cross-source) ───── */
  const recentActivity = useMemo(() => {
    type Item = { at: string; source: string; href: string; label: string; detail: string };
    const items: Item[] = [];
    const cutoff = Date.now() - 14 * 86_400_000;

    // India staffing audit log
    const acctName = (id: string) => indiaAccounts.find((a) => a.id === id)?.name || 'Unknown';
    const fieldLabel: Record<string, string> = {
      title: 'Requisition', month: 'Month', new_positions: 'Positions',
      expected_closure: 'Expected Closure', start_date: 'Start Date', close_by_date: 'Close Date',
      status_field: 'Status', stage: 'Stage', anticipation: 'Anticipation',
      client_spoc: 'Client SPOC', department: 'Department',
      probability: 'Manual Prob', ai_probability: 'AI Prob',
    };
    for (const h of indiaHistory) {
      if (!h.changed_at || Date.parse(h.changed_at) < cutoff) continue;
      const req = indiaReqs.find((r) => r.id === h.requisition_id);
      if (!req) continue;
      items.push({
        at: h.changed_at,
        source: 'India',
        href: '/india-staffing',
        label: `${acctName(req.account_id)} — ${req.title}`,
        detail: `${fieldLabel[h.field] || h.field}: ${h.old_value || '∅'} → ${h.new_value || '∅'}`,
      });
    }

    // Open Bench updates (recruiter-logged submissions/interviews/feedback/notes)
    for (const u of benchUpdates) {
      if (!u.created_at || Date.parse(u.created_at) < cutoff) continue;
      const r = benchResources.find((x) => x.id === u.resource_id);
      items.push({
        at: u.created_at,
        source: 'Open Bench',
        href: '/open-bench',
        label: r ? `${r.resource_name}` : u.resource_id,
        detail: `${u.type}${u.client_or_role ? ` · ${u.client_or_role}` : ''} — ${u.update_text}`,
      });
    }

    // Sort newest first, take top 12
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  }, [indiaHistory, indiaReqs, indiaAccounts, benchUpdates, benchResources]);

  /* ── Cockpit section card helper data ────────────────────── */
  const sections = [
    {
      key: 'projects',
      label: 'Projects',
      accent: 'violet',
      icon: FolderKanban,
      stats: [
        { label: 'Active', value: activeZohoProjects, sub: 'live in Zoho' },
        { label: 'Team Size', value: totalEmployees, sub: 'on Project Team' },
        { label: 'Revenue', value: `$${(totalRevenueUSD / 1000).toFixed(0)}k`, sub: 'pipeline value', sensitive: true },
      ],
      links: [
        { to: '/team',           label: 'Project Team' },
        { to: '/projects',       label: 'Current Projects' },
        { to: '/pipeline',       label: 'Pipeline Projects' },
        { to: '/forecasting',    label: 'Utilization Forecast' },
        { to: '/hiring-forecast',label: 'Hiring Forecast' },
        { to: '/financials',     label: 'Financials' },
      ],
    },
    {
      key: 'india',
      label: 'India T&M',
      accent: 'amber',
      icon: ClipboardList,
      stats: [
        { label: 'Active Reqs', value: indiaActiveReqs, sub: `${indiaOpenPositions} positions` },
        { label: 'Roster',      value: indiaRosterTotal, sub: `${indiaBilling} billable · ${indiaBench} bench` },
        { label: 'Recent Audit', value: indiaHistory.length, sub: 'all-time changes' },
      ],
      links: [
        { to: '/india-staffing',        label: 'India Demand' },
        { to: '/india-roster',          label: 'Roster' },
        { to: '/india-hiring-forecast', label: 'Hiring Forecast' },
      ],
    },
    {
      key: 'us',
      label: 'US T&M',
      accent: 'emerald',
      icon: Globe,
      stats: [
        { label: 'Active Reqs', value: usActiveReqs, sub: `${usReqs.length} total · ${usAccounts.length} accounts` },
        { label: 'Roster',      value: usRosterTotal, sub: 'US team' },
        { label: 'Open Bench',  value: usBenchAvailable, sub: 'available now' },
      ],
      links: [
        { to: '/us-staffing', label: 'US Demand' },
        { to: '/us-roster',   label: 'US Roster' },
        { to: '/open-bench',  label: 'Open Bench' },
      ],
    },
    {
      key: 'accountMgmt',
      label: 'Account Mgmt',
      accent: 'sky',
      icon: Handshake,
      stats: [
        { label: 'Active',    value: activeAccounts.length, sub: `${accounts.length} total` },
        { label: 'Stale',     value: staleAccountCount, sub: `>${STALE_CONNECT_DAYS}d no connect` },
        { label: 'Open Actions', value: openActionCount, sub: overdueActionCount > 0 ? `${overdueActionCount} overdue` : 'none overdue' },
      ],
      links: [
        { to: '/accounts', label: 'Accounts' },
        { to: '/vendors',  label: 'Vendors' },
      ],
    },
  ] as const;

  const accentClasses: Record<string, { bar: string; text: string; bg: string }> = {
    violet:  { bar: 'bg-violet-500',  text: 'text-violet-700',  bg: 'bg-violet-50' },
    amber:   { bar: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50' },
    emerald: { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
    sky:     { bar: 'bg-sky-500',     text: 'text-sky-700',     bg: 'bg-sky-50' },
  };

  return (
    <>
      <PageHeader
        title="Operations Cockpit"
        subtitle={`Live cross-section view — ${MONTHS[0]} to ${MONTHS[MONTHS.length - 1]} ${new Date().getFullYear()}`}
      />

      <SmartQueryPanel
        assignments={assignments}
        hiringForecast={hiringForecast}
        extras={{
          accounts,
          accountConnects,
          accountActions,
          vendors,
          vendorOutreach,
          candidates,
          taDailyLog: taLogEntries,
        }}
      />

      {/* ── Section overview: Projects · India T&M · US T&M · Account Mgmt ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {sections.map((sec) => {
          const a = accentClasses[sec.accent];
          const Icon = sec.icon;
          return (
            <div
              key={sec.key}
              className={`relative rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow`}
            >
              {/* Accent bar */}
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${a.bar}`} />
              <div className="p-4 pl-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-7 h-7 rounded-lg ${a.bg} ${a.text} flex items-center justify-center`}>
                    <Icon size={15} />
                  </div>
                  <h3 className={`text-sm font-bold uppercase tracking-wider ${a.text}`}>{sec.label}</h3>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-3 gap-3 mb-3">
                  {sec.stats.map((s) => {
                    const isSensitive = 'sensitive' in s && s.sensitive;
                    return (
                      <div key={s.label}>
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{s.label}</div>
                        <div className="text-xl font-extrabold text-slate-800 tabular-nums">
                          {isSensitive ? <Sensitive>{s.value}</Sensitive> : s.value}
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">{s.sub}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Quick-link rail */}
                <div className="flex flex-wrap gap-1 pt-3 border-t border-slate-100">
                  {sec.links.map((l) => (
                    <Link
                      key={l.to}
                      to={l.to}
                      className={`text-[10px] font-semibold px-2 py-1 rounded ${a.bg} ${a.text} hover:opacity-80 inline-flex items-center gap-1`}
                    >
                      {l.label}
                      <ArrowUpRight size={10} />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Recent activity (last 14 days) ─────────────────────────── */}
      {recentActivity.length > 0 && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <History size={14} className="text-slate-500" />
              <h3 className="text-sm font-bold text-slate-800">Recent Activity</h3>
              <span className="text-[10px] text-slate-400">last 14 days · {recentActivity.length} events</span>
            </div>
          </div>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {recentActivity.map((item, i) => (
              <Link
                key={i}
                to={item.href}
                className="flex items-start gap-3 px-2 py-1.5 rounded-lg hover:bg-slate-50 group transition-colors"
              >
                <span className="text-[10px] text-slate-400 font-mono w-24 flex-shrink-0 mt-0.5">
                  {new Date(item.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                  {new Date(item.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false })}
                </span>
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0 mt-0.5 ${
                  item.source === 'India'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {item.source}
                </span>
                <span className="text-xs font-semibold text-slate-700 w-48 truncate flex-shrink-0">{item.label}</span>
                <span className="text-xs text-slate-500 flex-1 truncate">{item.detail}</span>
                <ArrowUpRight size={11} className="text-slate-300 group-hover:text-slate-600 flex-shrink-0 mt-0.5" />
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Users size={24} />} label="Team Size" value={totalEmployees} />
        <StatCard icon={<FolderKanban size={24} />} label="Active Projects" value={totalProjects} />
        <StatCard icon={<Clock size={24} />} label="Total Forecasted Hours" value={totalHours.toLocaleString()} />
        <StatCard icon={<DollarSign size={24} />} label="Loaded Cost (USD)" value={<Sensitive>{`$${Math.round(totalCost).toLocaleString()}`}</Sensitive>} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card title="Monthly Hours Trend">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthlyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="hours" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Hours" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Hours by Project">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={projectPie} cx="50%" cy="50%" outerRadius={100} innerRadius={50} paddingAngle={2} dataKey="value" label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                {projectPie.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => `${Number(v).toLocaleString()} hrs`} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card title="Top 10 Employees — Q1 vs Q2 Hours">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topEmployees} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="q1" fill="#3b82f6" name="Jan–Mar" radius={[0, 4, 4, 0]} />
              <Bar dataKey="q2" fill="#10b981" name="Apr–Jun" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Team by Role">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={roleDistribution} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" name="Count" radius={[0, 4, 4, 0]}>
                {roleDistribution.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <AutomationActivityWidget />

      {/* Account Management health + India candidates pipeline — added so
          the home dashboard reflects the modules built since the original
          forecast-only cockpit. */}
      <AccountHealthAndCandidatesWidget
        activeAccountCount={activeAccounts.length}
        totalAccountCount={accounts.length}
        staleAccountCount={staleAccountCount}
        openActionCount={openActionCount}
        overdueActionCount={overdueActionCount}
        recentConnectCount7d={recentConnectCount7d}
        candidatesTotal={candidates.length}
        activeCandidateCount={activeCandidates.length}
        parsedThisWeek={parsedThisWeek}
        candidatesWithResume={candidatesWithResume}
      />
    </>
  );
}

/* ── Account Health + Candidates Pipeline widget ──────────────────────
 * Renders two stat clusters side-by-side: account-mgmt health (active /
 * stale / open actions / connects-this-week) and India candidates
 * pipeline (total / in-funnel / parsed-by-Claude this week / with-resume).
 * Cheap derived stats — no fetches. */
function AccountHealthAndCandidatesWidget(props: {
  activeAccountCount: number;
  totalAccountCount: number;
  staleAccountCount: number;
  openActionCount: number;
  overdueActionCount: number;
  recentConnectCount7d: number;
  candidatesTotal: number;
  activeCandidateCount: number;
  parsedThisWeek: number;
  candidatesWithResume: number;
}) {
  if (props.totalAccountCount === 0 && props.candidatesTotal === 0) return null;
  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-sky-50 text-sky-700 flex items-center justify-center">
            <Handshake size={15} />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-sky-700">Account Mgmt Health</h3>
          <Link to="/accounts" className="ml-auto text-[10px] font-semibold text-sky-700 hover:underline inline-flex items-center gap-0.5">
            Accounts <ArrowUpRight size={10} />
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Active" value={props.activeAccountCount} sub={`${props.totalAccountCount} total`} />
          <Stat
            label="Stale"
            value={props.staleAccountCount}
            sub={`>${STALE_CONNECT_DAYS}d no connect`}
            tone={props.staleAccountCount > 0 ? 'red' : 'mute'}
          />
          <Stat
            label="Open Actions"
            value={props.openActionCount}
            sub={props.overdueActionCount > 0 ? `${props.overdueActionCount} overdue` : 'all on track'}
            tone={props.overdueActionCount > 0 ? 'amber' : 'mute'}
          />
          <Stat label="Connects (7d)" value={props.recentConnectCount7d} sub="sales + delivery" />
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center">
            <UserCheck size={15} />
          </div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-700">India Candidates</h3>
          <Link to="/candidates" className="ml-auto text-[10px] font-semibold text-indigo-700 hover:underline inline-flex items-center gap-0.5">
            Candidates <ArrowUpRight size={10} />
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <Stat label="Total" value={props.candidatesTotal} sub="all-time" />
          <Stat
            label="In Funnel"
            value={props.activeCandidateCount}
            sub="active stages"
            tone={props.activeCandidateCount > 0 ? 'sky' : 'mute'}
          />
          <Stat
            label="Parsed (7d)"
            value={props.parsedThisWeek}
            sub="by Claude"
            tone={props.parsedThisWeek > 0 ? 'emerald' : 'mute'}
          />
          <Stat label="With Resume" value={props.candidatesWithResume} sub="of total" />
        </div>
      </Card>
    </div>
  );
}

/** Small inline stat used inside Cards on the dashboard. */
function Stat({ label, value, sub, tone = 'mute' }: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: 'mute' | 'red' | 'amber' | 'emerald' | 'sky';
}) {
  const toneCls: Record<typeof tone, string> = {
    mute:    'text-slate-800',
    red:     'text-red-700',
    amber:   'text-amber-700',
    emerald: 'text-emerald-700',
    sky:     'text-sky-700',
  };
  return (
    <div>
      <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-extrabold tabular-nums ${toneCls[tone]}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/* ── Recent automation activity (Vendors outreach + JDs generated) ─────
 * Surfaces what the AI tooling has been doing this week so the home
 * dashboard doesn't only look backward at forecast. Cheap KPIs derived
 * from existing in-memory stores — no extra fetches. */
function AutomationActivityWidget() {
  const outreach = useVendorStore((s) => s.outreach);
  const vendors  = useVendorStore((s) => s.vendors);
  const indiaReqs = useStaffingStore((s) => s.requisitions);
  const usReqs    = useUSStaffingStore((s) => s.requisitions);
  const statuses  = useStaffingStore((s) => s.statuses);

  // 7-day window
  const sinceIso = (() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString(); })();
  const last7 = outreach.filter((o) => o.sentAt >= sinceIso);
  const sentCount    = last7.filter((o) => o.sendStatus === 'sent').length;
  const failedCount  = last7.filter((o) => o.sendStatus === 'bounced').length;
  const repliedCount = last7.filter((o) => o.sendStatus === 'replied').length;

  // JDs generated this week (India + US). job_description_at is the strongest signal.
  const sevenDaysAgo = Date.parse(sinceIso);
  const jdCountThisWeek = [...indiaReqs, ...usReqs].filter((r) => {
    const at = (r as { job_description_at?: string | null }).job_description_at;
    return at ? Date.parse(at) >= sevenDaysAgo : false;
  }).length;
  const totalReqsWithJD = [...indiaReqs, ...usReqs].filter((r) =>
    !!(r as { job_description?: string | null }).job_description,
  ).length;

  // Last 5 outreach events for a mini-feed
  const recent5 = [...outreach].sort((a, b) => b.sentAt.localeCompare(a.sentAt)).slice(0, 5);
  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.companyName ?? '—';

  // Stale active India requisitions — no status update in 7+ days
  const STALE_THRESHOLD_MS = 7 * 86_400_000;
  const now = Date.now();
  const staleReqs = indiaReqs.filter((r) => {
    if ((r as { stage?: string }).stage === 'closed') return false;
    const rs = statuses
      .filter((s) => s.requisition_id === r.id)
      .sort((a, b) => b.status_date.localeCompare(a.status_date));
    const latest = rs[0]?.status_date;
    if (!latest) return false;
    return now - new Date(latest).getTime() > STALE_THRESHOLD_MS;
  });
  const staleCount = staleReqs.length;

  if (outreach.length === 0 && jdCountThisWeek === 0 && totalReqsWithJD === 0 && staleCount === 0) return null;

  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-4 gap-4">
      <StatCard
        label="Vendor emails (7d)"
        value={last7.length}
        subtitle={`${sentCount} sent · ${failedCount} failed${repliedCount > 0 ? ` · ${repliedCount} replied` : ''}`}
      />
      <StatCard
        label="JDs generated (7d)"
        value={jdCountThisWeek}
        subtitle={`${totalReqsWithJD} requisitions have a saved JD total`}
      />
      <StatCard
        label="Stale reqs (India)"
        value={staleCount}
        subtitle={staleCount === 0 ? 'All active reqs updated in last 7 days' : 'No status update in 7+ days'}
      />
      <Card title="Latest vendor outreach">
        {recent5.length === 0 ? (
          <div className="text-xs text-slate-500 italic py-2">No outreach yet.</div>
        ) : (
          <ul className="space-y-1.5 text-xs">
            {recent5.map((o) => (
              <li key={o.id} className="flex items-baseline gap-2 truncate" title={`${o.subject} → ${o.sentBy ?? ''}`}>
                <span className="text-[10px] tabular-nums text-slate-400 flex-shrink-0">
                  {new Date(o.sentAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                <span className="font-medium text-slate-800 truncate">{vendorName(o.vendorId)}</span>
                <span className={`text-[9px] uppercase tracking-wider font-semibold flex-shrink-0 ${
                  o.sendStatus === 'sent'    ? 'text-emerald-700' :
                  o.sendStatus === 'replied' ? 'text-sky-700'     :
                  o.sendStatus === 'bounced' ? 'text-red-700'     : 'text-slate-500'
                }`}>{o.sendStatus}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
