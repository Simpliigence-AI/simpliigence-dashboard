/**
 * Accounts — the first tab under the new "Account Management" section.
 *
 * What it shows:
 *   - Every client account with: name, sales owner, delivery owner, status,
 *     last sales connect, last delivery connect, # open action items, team size.
 *   - Accounts with NO sales OR delivery connect in the past 30 days flash red
 *     ("Stale" tag + left border).
 *
 * Click a row → expand with tabs:
 *   1. Overview — owners, industry, status, notes (inline editable)
 *   2. Sales connects — log of meetings (meeting_date, attendees, discussion,
 *      outcome). "+ Log sales connect" form. Sorted newest first.
 *   3. Delivery connects — same as sales but `connect_type='delivery'`.
 *   4. Actions — action-point registry filtered to this account. Owner, due
 *      date, status. Toggle status by clicking the chip.
 *   5. Team — roster members (india_roster ∪ us_roster) whose `project`
 *      matches this account's name (case-insensitive substring).
 *
 * Data flow: useAccountStore. Writes Supabase via db.upsert*; realtime
 * subscription keeps other tabs/browsers fresh.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Save, X, ChevronDown, ChevronRight, AlertTriangle, Users,
  Calendar, Briefcase, CheckCircle2, Circle, PauseCircle, XCircle, Clock,
  Sparkles, RefreshCw, Loader2, Mic, Square, Upload, Link as LinkIcon,
  DollarSign, Lock, Unlock, Flame, MessageSquare, Handshake,
} from 'lucide-react';
import { Card } from '../components/ui';
import { Sensitive } from '../components/Sensitive';
import { db } from '../lib/supabaseSync';
import { runAccountBriefing, type AccountBriefing } from '../lib/claudeQuery';
import { UserPicker } from '../components/UserPicker';
import { TaIdentity } from '../components/TaIdentity';
import { useAuthStore } from '../store/useAuthStore';
import { useAccountStore } from '../store/useAccountStore';
import { useIndiaRosterStore } from '../store/useIndiaRosterStore';
import { useUSRosterStore } from '../store/useUSRosterStore';
import { useSalesPlanStore, normalizeAccountName, type AccountInsight } from '../store/useSalesPlanStore';
import { STALE_CONNECT_DAYS } from '../types/accountMgmt';

// Sales-plan urgency thresholds — mirror India/US Demand pages.
const URGENT_UNSECURED = 250_000;
const URGENT_PCT_LOCKED = 0.4;

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toFixed(0)}`;
}
import { ClientContactsTab } from './accounts/ClientContactsTab';
import { AccountInfoTab } from './accounts/AccountInfoTab';
import { OpportunitiesTab } from './accounts/OpportunitiesTab';
import { ProjectsTab } from './accounts/ProjectsTab';
import { InnovationTab } from './accounts/InnovationTab';
import { CSATTab } from './accounts/CSATTab';
import type {
  Account, AccountConnect, AccountActionItem, ActionStatus, ConnectType, AccountStatus,
} from '../types/accountMgmt';

const STATUS_COLORS: Record<AccountStatus, string> = {
  active:   'bg-emerald-100 text-emerald-800',
  inactive: 'bg-slate-100 text-slate-600',
  churned:  'bg-red-100 text-red-800',
};

const ACTION_STATUS_META: Record<ActionStatus, { label: string; cls: string; Icon: typeof Circle }> = {
  open:        { label: 'Open',        cls: 'bg-sky-100 text-sky-800',           Icon: Circle },
  in_progress: { label: 'In progress', cls: 'bg-amber-100 text-amber-800',       Icon: PauseCircle },
  done:        { label: 'Done',        cls: 'bg-emerald-100 text-emerald-800',   Icon: CheckCircle2 },
  cancelled:   { label: 'Cancelled',   cls: 'bg-slate-100 text-slate-500',       Icon: XCircle },
};

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/** True if a roster member's `project` field matches an account's name OR any
 *  of its team_aliases (case-insensitive substring). Empty alias strings are
 *  ignored so a stray '' doesn't make every member match every account. */
function rosterMatchesAccount(projectField: string | null | undefined, account: { name: string; teamAliases?: string[] }): boolean {
  if (!projectField) return false;
  const p = projectField.toLowerCase();
  if (account.name && p.includes(account.name.toLowerCase())) return true;
  for (const alias of account.teamAliases ?? []) {
    const a = (alias || '').trim().toLowerCase();
    if (a && p.includes(a)) return true;
  }
  return false;
}

export default function AccountsPage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const myEmail = (currentUser?.email || '').toLowerCase();

  const { accounts, connects, actions, addAccount, updateAccount, removeAccount,
          addConnect, removeConnect, addAction, setActionStatus, updateAction, removeAction } = useAccountStore();
  const { members: indiaRoster } = useIndiaRosterStore();
  const { members: usRoster } = useUSRosterStore();

  const [q, setQ] = useState('');
  const [filterStale, setFilterStale] = useState(false);
  const [filterUrgent, setFilterUrgent] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<Record<string, AccountTab>>({});
  // Per-account: if set, ConnectsTab opens its "Add" form immediately. Cleared
  // after the row uses it so a subsequent re-expand doesn't auto-open.
  const [autoLog, setAutoLog] = useState<Record<string, ConnectType | null>>({});
  const [adding, setAdding] = useState(false);

  // Sales-plan integration — load once on mount.
  const salesPlanLoad = useSalesPlanStore((s) => s.load);
  const salesPlanByName = useSalesPlanStore((s) => s.byName);
  useEffect(() => { void salesPlanLoad(); }, [salesPlanLoad]);

  // AI briefing state — Claude reads accounts + connects + actions + client
  // contacts and produces a daily operator briefing. Cached for the day.
  const [briefing, setBriefing] = useState<AccountBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingExpanded, setBriefingExpanded] = useState(true);

  // ── Precompute per-account derived data (last connects, open actions, team) ──
  type Derived = {
    lastSales: AccountConnect | null;
    lastDelivery: AccountConnect | null;
    openActions: number;
    teamCount: number;
    isStale: boolean;
    insight: AccountInsight | undefined;
    forecast: number;
    secured: number;
    unsecured: number;
    pctLocked: number;
    isUrgent: boolean;
  };
  const derivedByAccount = useMemo(() => {
    const result = new Map<string, Derived>();
    for (const acc of accounts) {
      const accConnects = connects.filter((c) => c.accountId === acc.id);
      const sales = accConnects.filter((c) => c.connectType === 'sales')
        .sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
      const delivery = accConnects.filter((c) => c.connectType === 'delivery')
        .sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
      const openActions = actions.filter((a) => a.accountId === acc.id && a.status !== 'done' && a.status !== 'cancelled').length;
      const team = [...indiaRoster, ...usRoster].filter((m) => rosterMatchesAccount(m.project, acc));
      const lastSales = sales[0] ?? null;
      const lastDelivery = delivery[0] ?? null;
      const staleS = !lastSales || daysSince(lastSales.meetingDate) > STALE_CONNECT_DAYS;
      const staleD = !lastDelivery || daysSince(lastDelivery.meetingDate) > STALE_CONNECT_DAYS;
      const isStale = acc.status === 'active' && (staleS || staleD);
      // Match this account into the 2026 sales plan by name (with alias fallback)
      let insight: AccountInsight | undefined = salesPlanByName[normalizeAccountName(acc.name)];
      if (!insight) {
        for (const alias of acc.teamAliases ?? []) {
          const ai = salesPlanByName[normalizeAccountName(alias)];
          if (ai) { insight = ai; break; }
        }
      }
      const forecast = insight?.forecast ?? 0;
      const secured = insight?.secured ?? 0;
      const unsecured = insight?.unsecured ?? 0;
      const pctLocked = insight?.pctLocked ?? 0;
      const isUrgent = forecast > 0 && unsecured >= URGENT_UNSECURED && pctLocked < URGENT_PCT_LOCKED;
      result.set(acc.id, { lastSales, lastDelivery, openActions, teamCount: team.length, isStale, insight, forecast, secured, unsecured, pctLocked, isUrgent });
    }
    return result;
  }, [accounts, connects, actions, indiaRoster, usRoster, salesPlanByName]);

  // ── Filter ──
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts.filter((a) => {
      const d = derivedByAccount.get(a.id);
      if (filterStale && !d?.isStale) return false;
      if (filterUrgent && !d?.isUrgent) return false;
      if (needle) {
        const hay = `${a.name} ${a.salesOwnerEmail ?? ''} ${a.deliveryOwnerEmail ?? ''} ${a.industry ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    }).sort((a, b) => {
      // Order: urgent first, then stale, then by forecast desc, then alphabetical.
      const da = derivedByAccount.get(a.id);
      const db = derivedByAccount.get(b.id);
      const ua = da?.isUrgent ? 0 : 1;
      const ub = db?.isUrgent ? 0 : 1;
      if (ua !== ub) return ua - ub;
      const sa = da?.isStale ? 0 : 1;
      const sb = db?.isStale ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const fa = da?.forecast ?? 0;
      const fb = db?.forecast ?? 0;
      if (fb !== fa) return fb - fa;
      return a.name.localeCompare(b.name);
    });
  }, [accounts, q, filterStale, filterUrgent, derivedByAccount]);

  const staleCount = useMemo(
    () => accounts.filter((a) => derivedByAccount.get(a.id)?.isStale).length,
    [accounts, derivedByAccount],
  );
  const urgentCount = useMemo(
    () => accounts.filter((a) => derivedByAccount.get(a.id)?.isUrgent).length,
    [accounts, derivedByAccount],
  );
  const totalForecast = useMemo(
    () => accounts.reduce((s, a) => s + (derivedByAccount.get(a.id)?.forecast ?? 0), 0),
    [accounts, derivedByAccount],
  );
  const totalUnsecured = useMemo(
    () => accounts.reduce((s, a) => s + (derivedByAccount.get(a.id)?.unsecured ?? 0), 0),
    [accounts, derivedByAccount],
  );

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  /** Open the row, switch to the requested connect tab, and tell the
   *  ConnectsTab to open its "Add" form immediately. */
  const quickLogConnect = (accId: string, type: ConnectType) => {
    setExpanded((prev) => new Set(prev).add(accId));
    setActiveTab((prev) => ({ ...prev, [accId]: type === 'sales' ? 'sales' : 'delivery' }));
    setAutoLog((prev) => ({ ...prev, [accId]: type }));
  };

  // Quick KPIs for the hero strip
  const activeCount = accounts.filter((a) => a.status === 'active').length;
  const totalOpenActions = useMemo(
    () => actions.filter((a) => a.status === 'open' || a.status === 'in_progress').length,
    [actions],
  );

  // Fast lookup map: account id → name (used by the briefing alert pills)
  const accountNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of accounts) m[a.id] = a.name;
    return m;
  }, [accounts]);

  // Briefing fetch on mount; cached for the calendar day, so subsequent
  // page loads are free. Re-runs when the underlying data meaningfully
  // changes (count changes => add/remove of accounts/connects/actions).
  useEffect(() => {
    let cancelled = false;
    async function load(force = false) {
      if (accounts.length === 0) return;
      setBriefingLoading(true);
      try {
        const b = await runAccountBriefing({ accounts, connects, actions }, { forceRefresh: force });
        if (!cancelled) setBriefing(b);
      } finally {
        if (!cancelled) setBriefingLoading(false);
      }
    }
    load(false);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length, connects.length, actions.length]);

  const regenerateBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      const b = await runAccountBriefing({ accounts, connects, actions }, { forceRefresh: true });
      setBriefing(b);
    } finally {
      setBriefingLoading(false);
    }
  }, [accounts, connects, actions]);

  return (
    <div className="max-w-7xl mx-auto">
      {/* Hero header — gradient banner with stat strip */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 py-5 mb-6 text-white shadow-md">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(255,255,255,0.18),_transparent_60%)] pointer-events-none" />
        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight">Accounts</h1>
            <p className="text-sm text-indigo-100 mt-1">
              Client relationships at a glance — owners, last connects, action items, team size.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-sm font-semibold bg-white text-indigo-700 px-4 py-2 rounded-lg hover:bg-indigo-50 shadow-sm inline-flex items-center gap-1.5"
          >
            <Plus size={14} /> Add account
          </button>
        </div>
        <div className="relative grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-5">
          <HeroStat label="Total" value={accounts.length} />
          <HeroStat label="Active" value={activeCount} />
          <HeroStat label="Open actions" value={totalOpenActions} tone={totalOpenActions > 0 ? 'amber' : 'mute'} />
          <HeroStat label="Stale" value={staleCount} tone={staleCount > 0 ? 'red' : 'mute'} subtitle={`>${STALE_CONNECT_DAYS}d`} />
          <HeroStat label="Forecast '26" valueStr={fmtMoney(totalForecast)} sensitive subtitle="2026 sales plan" />
          <HeroStat label="Unsecured" valueStr={fmtMoney(totalUnsecured)} sensitive tone={urgentCount > 0 ? 'red' : 'mute'} subtitle={urgentCount > 0 ? `${urgentCount} urgent` : 'no urgent'} />
        </div>
      </div>

      {/* AI Account Management Briefing — Claude looks at stale accounts,
          overdue actions, and hot/warm contacts and gives the team a
          prioritized "what to act on" summary. Cached for the day. */}
      <div className="mb-5 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-blue-50 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-violet-100">
          <div className="flex items-center gap-2 min-w-0">
            <Sparkles size={15} className="text-violet-600 flex-shrink-0" />
            <span className="text-sm font-bold text-slate-800">Account Management Briefing</span>
            <span className="bg-gradient-to-r from-violet-500 to-blue-500 text-white text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">AI</span>
            {briefing?.generatedAt && (
              <span className="text-[10px] text-slate-400 truncate">
                · updated {new Date(briefing.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={regenerateBriefing}
              disabled={briefingLoading}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-50 transition-colors"
              title="Regenerate briefing with the latest data"
            >
              {briefingLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
              {briefingLoading ? 'Generating' : 'Regenerate'}
            </button>
            <button
              onClick={() => setBriefingExpanded((v) => !v)}
              className="p-1 rounded text-slate-400 hover:bg-slate-100"
              title={briefingExpanded ? 'Collapse' : 'Expand'}
            >
              {briefingExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          </div>
        </div>
        {briefingExpanded && (
          <div className="px-4 py-3">
            {briefingLoading && !briefing && (
              <div className="text-xs text-slate-400 italic flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Claude is reviewing your accounts...
              </div>
            )}
            {briefing && (
              <div className="text-[12px] leading-relaxed text-slate-700 [&_strong]:text-slate-900 [&_em]:text-slate-500">
                {briefing.markdown.split('\n').map((line, i) => {
                  const trimmed = line.trim();
                  if (!trimmed) return null;
                  const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ');
                  const content = isBullet ? trimmed.slice(2) : trimmed;
                  const parts = content.split(/(\*\*[^*]+\*\*|_[^_]+_)/).filter(Boolean);
                  return (
                    <p key={i} className={`${isBullet ? 'ml-4 before:content-["•"] before:mr-2 before:text-violet-400' : ''} my-1`}>
                      {parts.map((part, j) => {
                        if (part.startsWith('**') && part.endsWith('**')) return <strong key={j}>{part.slice(2, -2)}</strong>;
                        if (part.startsWith('_') && part.endsWith('_')) return <em key={j}>{part.slice(1, -1)}</em>;
                        return <span key={j}>{part}</span>;
                      })}
                    </p>
                  );
                })}
              </div>
            )}
            {briefing?.alerts && briefing.alerts.length > 0 && (
              <div className="mt-3 pt-3 border-t border-violet-100 flex flex-wrap gap-1.5">
                {briefing.alerts.map((a, i) => {
                  const name = accountNameById[a.accountId];
                  if (!name) return null;
                  const bg = a.severity === 'high' ? 'bg-red-100 text-red-800' : a.severity === 'medium' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800';
                  return (
                    <span key={i} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${bg}`} title={`${name} — ${a.message}`}>
                      <AlertTriangle size={10} /> {name}: {a.message}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <input
            placeholder="Search by name / owner / industry…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 min-w-[200px] border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <button
            type="button"
            onClick={() => setFilterUrgent((v) => !v)}
            className={`text-xs font-semibold px-3 py-2 rounded-md border inline-flex items-center gap-1.5 transition-colors ${
              filterUrgent
                ? 'bg-rose-600 border-rose-600 text-white'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Flame size={12} /> {filterUrgent ? 'Showing urgent only' : `Urgent only (${urgentCount})`}
          </button>
          <button
            type="button"
            onClick={() => setFilterStale((v) => !v)}
            className={`text-xs font-semibold px-3 py-2 rounded-md border inline-flex items-center gap-1.5 transition-colors ${
              filterStale
                ? 'bg-red-50 border-red-300 text-red-800'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle size={12} /> {filterStale ? 'Showing stale only' : `Stale only (${staleCount})`}
          </button>
        </div>
      </Card>

      {adding && (
        <AddAccountForm
          onCancel={() => setAdding(false)}
          onAdd={async (p) => {
            await addAccount(p);
            setAdding(false);
          }}
        />
      )}

      <Card title={`${filtered.length} account${filtered.length === 1 ? '' : 's'}`}>
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            {accounts.length === 0
              ? <>No accounts yet. Click <strong>+ Add account</strong> to create one.</>
              : <>No accounts match.</>}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 -mx-6">
            {filtered.map((acc, idx) => {
              const d = derivedByAccount.get(acc.id)!;
              const isOpen = expanded.has(acc.id);
              return (
                <div key={acc.id}>
                  <AccountRow
                    serialNo={idx + 1}
                    account={acc}
                    derived={d}
                    isOpen={isOpen}
                    onToggle={() => toggleExpand(acc.id)}
                    onQuickLog={(type) => quickLogConnect(acc.id, type)}
                  />
                  {isOpen && (
                    <AccountDetail
                      account={acc}
                      derived={d}
                      connects={connects.filter((c) => c.accountId === acc.id)}
                      actions={actions.filter((a) => a.accountId === acc.id)}
                      team={[...indiaRoster, ...usRoster]
                        .filter((m) => rosterMatchesAccount(m.project, acc))
                        .map((m) => ({
                        name: m.name,
                        role: m.role,
                        project: m.project,
                        status: m.status,
                        email: m.email,
                        // location only exists on US roster — TS narrows via cast
                        location: 'location' in m ? (m as { location?: string }).location ?? null : null,
                      }))}
                      activeTab={activeTab[acc.id] ?? 'overview'}
                      onTab={(t) => setActiveTab((s) => ({ ...s, [acc.id]: t }))}
                      autoLog={autoLog[acc.id] ?? null}
                      onAutoLogConsumed={() => setAutoLog((p) => ({ ...p, [acc.id]: null }))}
                      myEmail={myEmail}
                      onPatchAccount={(patch) => updateAccount(acc.id, patch)}
                      onRemoveAccount={() => removeAccount(acc.id)}
                      onAddConnect={(p) => addConnect({ accountId: acc.id, ...p })}
                      onRemoveConnect={(id) => removeConnect(id)}
                      onAddAction={(p) => addAction({ accountId: acc.id, ...p })}
                      onUpdateAction={(id, patch) => updateAction(id, patch)}
                      onRemoveAction={(id) => removeAction(id)}
                      onSetActionStatus={(id, status) => setActionStatus(id, status)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Top-of-row summary (name, owners, last-connect dates, KPIs) ── */

function AccountRow({ serialNo, account, derived, isOpen, onToggle, onQuickLog }: {
  serialNo: number;
  account: Account;
  derived: { lastSales: AccountConnect | null; lastDelivery: AccountConnect | null; openActions: number; teamCount: number; isStale: boolean; insight: AccountInsight | undefined; forecast: number; secured: number; unsecured: number; pctLocked: number; isUrgent: boolean };
  isOpen: boolean;
  onToggle: () => void;
  onQuickLog: (type: ConnectType) => void;
}) {
  const { lastSales, lastDelivery, openActions, teamCount, isStale, insight, forecast, secured, unsecured, pctLocked, isUrgent } = derived;
  const lockedPct = Math.round(pctLocked * 100);

  return (
    <div
      className={`w-full text-left transition-all duration-150 border-l-4 relative ${
        isUrgent
          ? 'border-rose-500 bg-gradient-to-r from-rose-50/70 via-rose-50/30 to-transparent'
          : isStale
            ? 'border-red-500 bg-gradient-to-r from-red-50/60 to-transparent'
            : 'border-transparent hover:bg-slate-50/80 hover:border-primary/30'
      }`}
    >
      {isUrgent && (
        <div className="absolute top-0 left-0 right-0 bg-rose-600 text-white text-[9px] font-bold uppercase tracking-wider px-3 py-0.5 flex items-center gap-1">
          <Flame size={10} /> Urgent: <Sensitive>{fmtMoney(unsecured)}</Sensitive> unsecured · {lockedPct}% locked · sales + delivery sync needed
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        className={`w-full text-left px-6 py-4 flex items-start gap-3 ${isUrgent ? 'pt-6' : ''}`}
      >
        {/* S. No. — zero-padded 2-digit serial number, monospace + slate so it doesn't fight the name */}
        <span
          className="mt-0.5 flex-shrink-0 inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 rounded-md bg-slate-100 text-slate-500 font-mono text-[11px] font-semibold tabular-nums"
          aria-label={`Serial number ${serialNo}`}
        >
          {String(serialNo).padStart(2, '0')}
        </span>
        {isOpen ? <ChevronDown size={16} className="text-slate-500 mt-1 flex-shrink-0" /> : <ChevronRight size={16} className="text-slate-400 mt-1 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          {/* Top line: name + status + stale + industry + forecast */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base font-bold text-slate-900 tracking-tight">{account.name}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_COLORS[account.status]}`}>
              {account.status}
            </span>
            {isStale && !isUrgent && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-800 inline-flex items-center gap-1 ring-1 ring-red-200">
                <AlertTriangle size={10} /> Stale
              </span>
            )}
            {account.industry && (
              <span className="text-[10px] text-slate-500 inline-flex items-center gap-1">
                <Briefcase size={10} /> {account.industry}
              </span>
            )}
            {forecast > 0 && (
              <span
                className="text-[10px] font-semibold inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 ring-1 ring-indigo-100"
                title={`Forecast ${fmtMoney(forecast)} · Secured ${fmtMoney(secured)} · Unsecured ${fmtMoney(unsecured)}`}
              >
                <DollarSign size={10} />
                <Sensitive>{fmtMoney(forecast)}</Sensitive>
                <span className="text-indigo-400">·</span>
                <span className="text-indigo-700">{lockedPct}% locked</span>
              </span>
            )}
          </div>

          {/* Owners + last-connect — clean 4-column grid with consistent label widths */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-2 mt-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 w-16 flex-shrink-0">Sales</span>
              {account.salesOwnerEmail
                ? <TaIdentity email={account.salesOwnerEmail} avatarSize={22} nameSize="text-xs" />
                : <span className="text-xs text-slate-300 italic">— unassigned —</span>}
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 w-16 flex-shrink-0">Delivery</span>
              {account.deliveryOwnerEmail
                ? <TaIdentity email={account.deliveryOwnerEmail} avatarSize={22} nameSize="text-xs" />
                : <span className="text-xs text-slate-300 italic">— unassigned —</span>}
            </div>
            <ConnectChip label="Last sales" connect={lastSales} />
            <ConnectChip label="Last delivery" connect={lastDelivery} />
          </div>

          {/* Secured / unsecured split bar — only when there's a plan */}
          {forecast > 0 && (
            <div className="mt-2.5 flex items-center gap-2 max-w-md">
              <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-slate-100 flex" title={`${lockedPct}% locked`}>
                <div className="bg-emerald-500 h-full" style={{ width: `${Math.min(100, lockedPct)}%` }} />
                <div className={`${isUrgent ? 'bg-rose-400' : 'bg-amber-400'} h-full`} style={{ width: `${100 - Math.min(100, lockedPct)}%` }} />
              </div>
              <span className="text-[10px] text-emerald-700 font-semibold inline-flex items-center gap-0.5"><Lock size={9} /><Sensitive>{fmtMoney(secured)}</Sensitive></span>
              <span className={`text-[10px] font-semibold inline-flex items-center gap-0.5 ${isUrgent ? 'text-rose-700' : 'text-amber-700'}`}><Unlock size={9} /><Sensitive>{fmtMoney(unsecured)}</Sensitive></span>
              {insight && insight.signalCount > 0 && (
                <span className="text-[10px] text-violet-600 inline-flex items-center gap-0.5 ml-1">
                  <MessageSquare size={9} /> {insight.signalCount}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right-side KPI chips */}
        <div className="flex items-center gap-2 flex-shrink-0 mt-1">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-slate-100 text-slate-700 px-2 py-1 rounded-md" title="Team members from roster">
            <Users size={11} /> {teamCount}
          </span>
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md ${
            openActions > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'
          }`} title="Open action items">
            <Clock size={11} /> {openActions}
          </span>
        </div>
      </button>

      {/* Quick-log row — buttons sit OUTSIDE the toggle button so they don't expand the row by accident. */}
      <div className="px-6 pb-3 -mt-2 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onQuickLog('sales'); }}
          className="text-[11px] font-semibold inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-50 transition-colors"
          title="Log a sales connect for this account"
        >
          <Handshake size={11} /> Log sales connect
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onQuickLog('delivery'); }}
          className="text-[11px] font-semibold inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-sky-300 text-sky-700 hover:bg-sky-50 transition-colors"
          title="Log a delivery connect for this account"
        >
          <MessageSquare size={11} /> Log delivery connect
        </button>
        {forecast === 0 && (
          <a
            href="https://simpliigence-sales-planning-2026.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] font-semibold inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-dashed border-slate-300 text-slate-500 hover:text-primary hover:border-primary/40 transition-colors"
            title="Open 2026 Sales Plan to add a forecast for this account"
          >
            <DollarSign size={11} /> Add to sales plan ↗
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Inline-aligned "last-connect" chip ── */
function ConnectChip({ label, connect }: { label: string; connect: AccountConnect | null }) {
  if (!connect) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 w-20 flex-shrink-0">{label}</span>
        <span className="text-[11px] text-red-700 font-medium">never</span>
      </div>
    );
  }
  const days = daysSince(connect.meetingDate);
  const isOver = days > STALE_CONNECT_DAYS;
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 w-20 flex-shrink-0">{label}</span>
      <span className={`text-[11px] ${isOver ? 'text-red-700 font-semibold' : 'text-slate-600'}`}>
        {connect.meetingDate}
        <span className={`ml-1 text-[10px] ${isOver ? 'text-red-700' : 'text-slate-400'}`}>· {days}d ago</span>
      </span>
    </div>
  );
}

/* ── Expanded detail: tabs (Overview / Sales / Delivery / Actions / Team) ── */

type AccountTab =
  | 'overview' | 'sales' | 'delivery' | 'contacts' | 'actions' | 'team'
  | 'info'         // Account Info — ZoomInfo data
  | 'opportunities'// Cross-sell / Upsell opportunities
  | 'projects'     // Current projects + risks + blockers
  | 'innovation'   // Innovation highlights
  | 'csat';        // CSAT — surveys, QBRs, testimonials

interface TeamMemberLite { name: string; role: string; project: string; status: string; email: string; location: string | null; }

function AccountDetail(props: {
  account: Account;
  derived: { lastSales: AccountConnect | null; lastDelivery: AccountConnect | null; openActions: number; teamCount: number; isStale: boolean; insight: AccountInsight | undefined; forecast: number; secured: number; unsecured: number; pctLocked: number; isUrgent: boolean };
  connects: AccountConnect[];
  actions: AccountActionItem[];
  team: TeamMemberLite[];
  activeTab: AccountTab;
  onTab: (t: AccountTab) => void;
  autoLog: ConnectType | null;
  onAutoLogConsumed: () => void;
  myEmail: string;
  onPatchAccount: (patch: Partial<Account>) => void | Promise<void>;
  onRemoveAccount: () => void | Promise<void>;
  onAddConnect: (p: { connectType: ConnectType; meetingDate: string; attendees?: string; discussion?: string; outcome?: string; recordingUrl?: string | null; recordingPath?: string | null; createdBy?: string }) => Promise<unknown>;
  onRemoveConnect: (id: string) => Promise<unknown>;
  onAddAction: (p: { connectId?: string; title: string; description?: string; ownerEmail?: string; dueDate?: string }) => Promise<unknown>;
  onUpdateAction: (id: string, patch: Partial<AccountActionItem>) => Promise<unknown>;
  onRemoveAction: (id: string) => Promise<unknown>;
  onSetActionStatus: (id: string, status: ActionStatus) => Promise<unknown>;
}) {
  const { account, derived, connects, actions, team, activeTab, onTab, autoLog, onAutoLogConsumed, myEmail } = props;
  const sales = connects.filter((c) => c.connectType === 'sales').sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
  const delivery = connects.filter((c) => c.connectType === 'delivery').sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
  // Primary tabs — the daily-use ones. Always visible on one row.
  const primaryTabs: { key: AccountTab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'sales', label: 'Sales connects', count: sales.length },
    { key: 'delivery', label: 'Delivery connects', count: delivery.length },
    { key: 'actions', label: 'Actions', count: actions.filter((a) => a.status === 'open' || a.status === 'in_progress').length },
    { key: 'team', label: 'Team', count: team.length },
  ];
  // Secondary tabs — supporting / contextual info. Below the primary row.
  const secondaryTabs: { key: AccountTab; label: string; count?: number }[] = [
    { key: 'info', label: 'Account info' },
    { key: 'contacts', label: 'Client contacts' },
    { key: 'opportunities', label: 'Opportunities' },
    { key: 'projects', label: 'Projects' },
    { key: 'innovation', label: 'Innovation' },
    { key: 'csat', label: 'CSAT' },
  ];

  return (
    <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100">
      {/* Forecast / connects summary header — quick context above the tabs */}
      {derived.forecast > 0 && (
        <div className={`mb-3 rounded-lg p-2.5 border ${derived.isUrgent ? 'bg-rose-50/60 border-rose-200' : 'bg-white border-slate-200'} grid grid-cols-2 md:grid-cols-4 gap-3 text-xs`}>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-slate-400 font-bold mb-0.5 flex items-center gap-1"><DollarSign size={10} /> Forecast '26</div>
            <div className="font-bold text-slate-800"><Sensitive>{fmtMoney(derived.forecast)}</Sensitive></div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-emerald-700 font-bold mb-0.5 flex items-center gap-1"><Lock size={10} /> Secured</div>
            <div className="font-bold text-emerald-700"><Sensitive>{fmtMoney(derived.secured)}</Sensitive> <span className="font-normal text-emerald-600/80">({Math.round(derived.pctLocked * 100)}%)</span></div>
          </div>
          <div>
            <div className={`text-[9px] uppercase tracking-wider font-bold mb-0.5 flex items-center gap-1 ${derived.isUrgent ? 'text-rose-700' : 'text-amber-700'}`}><Unlock size={10} /> Unsecured</div>
            <div className={`font-bold ${derived.isUrgent ? 'text-rose-700' : 'text-amber-700'}`}><Sensitive>{fmtMoney(derived.unsecured)}</Sensitive></div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-violet-700 font-bold mb-0.5 flex items-center gap-1"><Sparkles size={10} /> Sales-plan signals</div>
            <div className="font-bold text-violet-700">{derived.insight?.signalCount ?? 0}{derived.insight && derived.insight.openPipeline > 0 ? <span className="font-normal text-violet-600/80"> · <Sensitive>{fmtMoney(derived.insight.openPipeline)}</Sensitive> pipeline</span> : null}</div>
          </div>
        </div>
      )}

      {/* Tab nav — primary row */}
      <div className="flex items-center gap-1 border-b border-slate-200 flex-wrap">
        {primaryTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onTab(t.key)}
            className={`text-xs font-semibold px-3 py-2 border-b-2 -mb-px transition-colors ${
              activeTab === t.key ? 'border-primary text-primary' : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 text-[10px] bg-slate-200 text-slate-700 rounded-full px-1.5 py-0.5">{t.count}</span>
            )}
          </button>
        ))}
      </div>
      {/* Tab nav — secondary row (account context / cross-sell / projects) */}
      <div className="flex items-center gap-1 mb-4 mt-1 flex-wrap">
        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mr-1">More:</span>
        {secondaryTabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onTab(t.key)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
              activeTab === t.key
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-slate-200 text-slate-500 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1 text-[9px] bg-slate-200 text-slate-700 rounded-full px-1 py-0.5">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <OverviewTab account={account} onPatch={props.onPatchAccount} onRemove={props.onRemoveAccount} />
      )}
      {activeTab === 'sales' && (
        <ConnectsTab
          accountId={account.id}
          accountName={account.name}
          connects={sales}
          connectType="sales"
          autoOpen={autoLog === 'sales'}
          onAutoOpenConsumed={onAutoLogConsumed}
          onAdd={(p) => props.onAddConnect({ ...p, connectType: 'sales', createdBy: myEmail })}
          onRemove={props.onRemoveConnect}
          onAddAction={props.onAddAction}
        />
      )}
      {activeTab === 'delivery' && (
        <ConnectsTab
          accountId={account.id}
          accountName={account.name}
          connects={delivery}
          connectType="delivery"
          autoOpen={autoLog === 'delivery'}
          onAutoOpenConsumed={onAutoLogConsumed}
          onAdd={(p) => props.onAddConnect({ ...p, connectType: 'delivery', createdBy: myEmail })}
          onRemove={props.onRemoveConnect}
          onAddAction={props.onAddAction}
        />
      )}
      {activeTab === 'actions' && (
        <ActionsTab
          actions={actions}
          connects={connects}
          onAdd={props.onAddAction}
          onUpdate={props.onUpdateAction}
          onRemove={props.onRemoveAction}
          onSetStatus={props.onSetActionStatus}
        />
      )}
      {activeTab === 'contacts' && (
        <ClientContactsTab accountId={account.id} />
      )}
      {activeTab === 'team' && (
        <TeamTab account={account} team={team} />
      )}
      {activeTab === 'info' && <AccountInfoTab account={account} />}
      {activeTab === 'opportunities' && <OpportunitiesTab accountId={account.id} />}
      {activeTab === 'projects' && <ProjectsTab accountId={account.id} accountName={account.name} suggestedTeam={team} />}
      {activeTab === 'innovation' && <InnovationTab accountId={account.id} />}
      {activeTab === 'csat' && <CSATTab accountId={account.id} />}
    </div>
  );
}

/* ── Tab: Overview ── */

function OverviewTab({ account, onPatch, onRemove }: {
  account: Account;
  onPatch: (patch: Partial<Account>) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState(account);
  const [aliasInput, setAliasInput] = useState((account.teamAliases ?? []).join(', '));
  // Parse the comma-separated input back into a clean array
  const parsedAliases = aliasInput.split(',').map((s) => s.trim()).filter(Boolean);
  const aliasesChanged =
    parsedAliases.length !== (account.teamAliases ?? []).length ||
    parsedAliases.some((a, i) => a !== (account.teamAliases ?? [])[i]);
  const dirty =
    draft.name !== account.name ||
    draft.salesOwnerEmail !== account.salesOwnerEmail ||
    draft.deliveryOwnerEmail !== account.deliveryOwnerEmail ||
    draft.industry !== account.industry ||
    draft.status !== account.status ||
    draft.notes !== account.notes ||
    aliasesChanged;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-3">
        <Field label="Name">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                 className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm" />
        </Field>
        <Field label="Sales owner">
          <UserPicker
            value={draft.salesOwnerEmail}
            onChange={(email) => setDraft({ ...draft, salesOwnerEmail: email })}
            placeholder="— Pick a user —"
          />
        </Field>
        <Field label="Delivery owner">
          <UserPicker
            value={draft.deliveryOwnerEmail}
            onChange={(email) => setDraft({ ...draft, deliveryOwnerEmail: email })}
            placeholder="— Pick a user —"
          />
        </Field>
      </div>
      <div className="space-y-3">
        <Field label="Status">
          <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as AccountStatus })}
                  className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm bg-white">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="churned">Churned</option>
          </select>
        </Field>
        <Field label="Industry">
          <input value={draft.industry ?? ''} onChange={(e) => setDraft({ ...draft, industry: e.target.value || null })}
                 placeholder="—"
                 className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm" />
        </Field>
        <Field label="Notes">
          <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    rows={3}
                    className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm resize-y" />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field label="Team aliases (comma-separated)">
          <input
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            placeholder="e.g. Prometteur, SA Technologies"
            className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm"
          />
          <div className="text-[10px] text-slate-500 mt-1">
            Match roster members whose <strong>project</strong> contains any of these tokens (case-insensitive). The account name is always matched too — only add aliases for cases where the roster uses a different name.
          </div>
        </Field>
      </div>
      <div className="md:col-span-2 flex items-center justify-end gap-2">
        <button type="button"
                onClick={() => { if (confirm(`Delete account "${account.name}"? This also removes all connects and actions.`)) onRemove(); }}
                className="text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1">
          <Trash2 size={12} /> Delete account
        </button>
        <button type="button" onClick={() => onPatch({ ...draft, teamAliases: parsedAliases })} disabled={!dirty}
                className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1">
          <Save size={12} /> Save changes
        </button>
      </div>
    </div>
  );
}

/* ── Tab: Connects (sales | delivery) ── */

function ConnectsTab({ accountId, accountName, connects, connectType, autoOpen, onAutoOpenConsumed, onAdd, onRemove, onAddAction }: {
  accountId: string;
  accountName: string;
  connects: AccountConnect[];
  connectType: ConnectType;
  autoOpen?: boolean;
  onAutoOpenConsumed?: () => void;
  onAdd: (p: { meetingDate: string; attendees?: string; discussion?: string; outcome?: string; recordingUrl?: string | null; recordingPath?: string | null }) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  onAddAction: (p: { connectId?: string; title: string; description?: string; ownerEmail?: string; dueDate?: string }) => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (autoOpen && !adding) {
      setAdding(true);
      onAutoOpenConsumed?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);
  const today = new Date().toISOString().slice(0, 10);
  type SuggestedAction = { title: string; description: string; owner_email: string | null; due_date: string | null; selected: boolean };
  const initial = {
    meetingDate: today, attendees: '', discussion: '', outcome: '',
    recordingUrl: '', recordingPath: null as string | null, rawNotes: '',
  };
  const [d, setD] = useState(initial);
  const [suggestedActions, setSuggestedActions] = useState<SuggestedAction[]>([]);
  const [organizing, setOrganizing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [structureError, setStructureError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const reset = () => { setD(initial); setSuggestedActions([]); setStructureError(null); };

  const uploadAudio = async (file: File) => {
    setUploading(true);
    setStructureError(null);
    const path = await db.uploadAccountRecording(accountId, file);
    setUploading(false);
    if (!path) { setStructureError('Upload failed. See console for detail.'); return; }
    setD((cur) => ({ ...cur, recordingPath: path }));
  };

  const startRecording = async () => {
    setStructureError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        await uploadAudio(file);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch (e) {
      setStructureError(`Mic access denied: ${(e as Error).message}`);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  };

  const organize = async () => {
    if (!d.rawNotes.trim() && !d.recordingPath) {
      setStructureError('Type some notes, or record/upload a recording first.');
      return;
    }
    setOrganizing(true);
    setStructureError(null);
    const result = await db.structureConnectNotes({
      accountName, connectType,
      text: d.rawNotes || undefined,
      audioPath: d.recordingPath || undefined,
    });
    setOrganizing(false);
    if (!result.ok) {
      setStructureError(result.error);
      return;
    }
    setD((cur) => ({ ...cur, discussion: result.discussion, outcome: result.outcome }));
    setSuggestedActions(result.actionItems.map((a) => ({ ...a, selected: true })));
  };

  const submit = async () => {
    if (!d.meetingDate || (!d.discussion && !d.outcome && !d.attendees)) return;
    const created = await onAdd({
      meetingDate: d.meetingDate, attendees: d.attendees,
      discussion: d.discussion, outcome: d.outcome,
      recordingUrl: d.recordingUrl || null,
      recordingPath: d.recordingPath,
    }) as { id?: string } | undefined;
    const newConnectId = created?.id;
    // Auto-add the suggested action items the user kept selected
    for (const a of suggestedActions) {
      if (!a.selected || !a.title.trim()) continue;
      await onAddAction({
        connectId: newConnectId,
        title: a.title,
        description: a.description || '',
        ownerEmail: a.owner_email || undefined,
        dueDate: a.due_date || undefined,
      });
    }
    reset();
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {!adding && (
        <button type="button" onClick={() => setAdding(true)}
                className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 inline-flex items-center gap-1">
          <Plus size={12} /> Log {connectType} connect
        </button>
      )}
      {adding && (
        <div className="border border-slate-200 rounded-lg p-3 bg-white space-y-3">
          {/* Row 1: date + attendees */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Field label="Date">
              <input type="date" value={d.meetingDate} onChange={(e) => setD({ ...d, meetingDate: e.target.value })}
                     className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
            </Field>
            <div className="md:col-span-3">
              <Field label="Attendees">
                <input value={d.attendees} onChange={(e) => setD({ ...d, attendees: e.target.value })}
                       placeholder="e.g. Raghu, Scott · Client: John, Jane"
                       className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
              </Field>
            </div>
          </div>

          {/* Recording inputs */}
          <div className="border border-dashed border-slate-300 rounded-md p-2 bg-slate-50/60">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Recording (optional)</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 flex items-center gap-1">
                  <LinkIcon size={11} /> Read.ai or other link
                </label>
                <input value={d.recordingUrl} onChange={(e) => setD({ ...d, recordingUrl: e.target.value })}
                       placeholder="https://app.read.ai/…"
                       className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1 flex items-center gap-1">
                  <Upload size={11} /> Upload audio file
                </label>
                <input type="file" accept="audio/*"
                       onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAudio(f); }}
                       className="w-full text-xs" />
                {uploading && <div className="text-[11px] text-slate-500 mt-1 flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> Uploading…</div>}
                {d.recordingPath && !uploading && <div className="text-[11px] text-emerald-700 mt-1">✓ Stored: {d.recordingPath.split('/').pop()}</div>}
              </div>
            </div>
          </div>

          {/* Voice / raw notes + AI Organize */}
          <div className="border border-dashed border-indigo-200 rounded-md p-2 bg-indigo-50/40">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">
                Voice / raw notes → AI organize
              </div>
              <div className="flex items-center gap-1.5">
                {!recording ? (
                  <button type="button" onClick={startRecording}
                          className="text-[11px] font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2 py-1 rounded inline-flex items-center gap-1">
                    <Mic size={11} /> Start recording
                  </button>
                ) : (
                  <button type="button" onClick={stopRecording}
                          className="text-[11px] font-semibold text-white bg-red-600 hover:bg-red-700 px-2 py-1 rounded inline-flex items-center gap-1 animate-pulse">
                    <Square size={11} /> Stop
                  </button>
                )}
                <button type="button" onClick={organize} disabled={organizing}
                        className="text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-2 py-1 rounded inline-flex items-center gap-1">
                  {organizing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {organizing ? 'Organizing…' : 'AI organize'}
                </button>
              </div>
            </div>
            <textarea value={d.rawNotes} onChange={(e) => setD({ ...d, rawNotes: e.target.value })}
                      rows={3}
                      placeholder="Dictate or type messy notes here. Click 'AI organize' to turn them into a clean discussion + outcome + action items."
                      className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs resize-y" />
            {structureError && <div className="text-[11px] text-red-700 mt-1.5">{structureError}</div>}
          </div>

          {/* Structured fields (editable after AI organize, or fill manually) */}
          <Field label="What was discussed">
            <textarea value={d.discussion} onChange={(e) => setD({ ...d, discussion: e.target.value })}
                      rows={2}
                      className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs resize-y" />
          </Field>
          <Field label="Outcome / what happened">
            <textarea value={d.outcome} onChange={(e) => setD({ ...d, outcome: e.target.value })}
                      rows={2}
                      placeholder="Decisions made, deliverables agreed, next steps."
                      className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs resize-y" />
          </Field>

          {/* Suggested action items */}
          {suggestedActions.length > 0 && (
            <div className="border border-emerald-200 bg-emerald-50/40 rounded-md p-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 mb-1.5">
                Suggested action items ({suggestedActions.filter((a) => a.selected).length} selected · will be auto-added on Save)
              </div>
              <ul className="space-y-1.5">
                {suggestedActions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <input type="checkbox" checked={a.selected}
                           onChange={(e) => setSuggestedActions((cur) => cur.map((x, j) => j === i ? { ...x, selected: e.target.checked } : x))}
                           className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <input value={a.title}
                             onChange={(e) => setSuggestedActions((cur) => cur.map((x, j) => j === i ? { ...x, title: e.target.value } : x))}
                             className="w-full border border-slate-200 rounded px-1.5 py-0.5 text-xs font-medium" />
                      <div className="flex items-center gap-2 mt-1">
                        <input value={a.owner_email || ''}
                               onChange={(e) => setSuggestedActions((cur) => cur.map((x, j) => j === i ? { ...x, owner_email: e.target.value || null } : x))}
                               placeholder="owner@…"
                               className="flex-1 border border-slate-200 rounded px-1.5 py-0.5 text-[11px]" />
                        <input type="date" value={a.due_date || ''}
                               onChange={(e) => setSuggestedActions((cur) => cur.map((x, j) => j === i ? { ...x, due_date: e.target.value || null } : x))}
                               className="border border-slate-200 rounded px-1.5 py-0.5 text-[11px]" />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => { reset(); setAdding(false); }}
                    className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
              <X size={12} /> Cancel
            </button>
            <button type="button" onClick={submit}
                    className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 inline-flex items-center gap-1">
              <Save size={12} /> Save connect
            </button>
          </div>
        </div>
      )}
      {connects.length === 0 ? (
        <div className="text-sm text-slate-500 text-center py-6">No {connectType} connects logged yet.</div>
      ) : (
        <ul className="space-y-2">
          {connects.map((c) => (
            <li key={c.id} className="border border-slate-200 rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-xs">
                  <Calendar size={12} className="text-slate-400" />
                  <span className="font-semibold text-slate-900">{c.meetingDate}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-500">{daysSince(c.meetingDate)}d ago</span>
                  {c.attendees && <><span className="text-slate-400">·</span><span className="text-slate-600 truncate max-w-md">{c.attendees}</span></>}
                </div>
                <button type="button" onClick={() => { if (confirm('Delete this connect?')) onRemove(c.id); }}
                        className="text-red-400 hover:text-red-700" title="Delete">
                  <Trash2 size={12} />
                </button>
              </div>
              {c.discussion && (
                <div className="text-xs text-slate-700 mt-1">
                  <span className="font-semibold text-slate-500">Discussed:</span> {c.discussion}
                </div>
              )}
              {c.outcome && (
                <div className="text-xs text-slate-700 mt-1">
                  <span className="font-semibold text-slate-500">Outcome:</span> {c.outcome}
                </div>
              )}
              {(c.recordingUrl || c.recordingPath) && (
                <div className="text-[11px] mt-1.5 flex items-center gap-2 flex-wrap">
                  {c.recordingUrl && (
                    <a href={c.recordingUrl} target="_blank" rel="noreferrer"
                       className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700 hover:bg-sky-100">
                      <LinkIcon size={10} /> Recording link
                    </a>
                  )}
                  {c.recordingPath && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600">
                      <Upload size={10} /> {c.recordingPath.split('/').pop()}
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Tab: Actions ── */

function ActionsTab({ actions, connects: _connects, onAdd, onUpdate, onRemove, onSetStatus }: {
  actions: AccountActionItem[];
  connects: AccountConnect[];
  onAdd: (p: { title: string; description?: string; ownerEmail?: string; dueDate?: string }) => Promise<unknown>;
  onUpdate: (id: string, patch: Partial<AccountActionItem>) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  onSetStatus: (id: string, status: ActionStatus) => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  const [d, setD] = useState({ title: '', description: '', ownerEmail: '', dueDate: '' });
  void _connects;

  const submit = async () => {
    if (!d.title.trim()) return;
    await onAdd({
      title: d.title.trim(),
      description: d.description || undefined,
      ownerEmail: d.ownerEmail || undefined,
      dueDate: d.dueDate || undefined,
    });
    setD({ title: '', description: '', ownerEmail: '', dueDate: '' });
    setAdding(false);
  };

  const ordered = useMemo(() => {
    return [...actions].sort((a, b) => {
      // Open first, then in_progress, then done, then cancelled
      const rank = (s: ActionStatus) => s === 'open' ? 0 : s === 'in_progress' ? 1 : s === 'done' ? 2 : 3;
      if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
      const ad = a.dueDate ?? '9999-12-31';
      const bd = b.dueDate ?? '9999-12-31';
      return ad.localeCompare(bd);
    });
  }, [actions]);

  return (
    <div className="space-y-3">
      {!adding && (
        <button type="button" onClick={() => setAdding(true)}
                className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 inline-flex items-center gap-1">
          <Plus size={12} /> Add action item
        </button>
      )}
      {adding && (
        <div className="border border-slate-200 rounded-lg p-3 bg-white">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
            <Field label="Title">
              <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })}
                     placeholder="e.g. Send updated SOW to client"
                     className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
            </Field>
            <Field label="Owner">
              <UserPicker
                value={d.ownerEmail || null}
                onChange={(email) => setD({ ...d, ownerEmail: email ?? '' })}
                placeholder="— Pick a user —"
              />
            </Field>
            <Field label="Due date">
              <input type="date" value={d.dueDate} onChange={(e) => setD({ ...d, dueDate: e.target.value })}
                     className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
            </Field>
            <Field label="Description">
              <input value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })}
                     placeholder="Optional"
                     className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)}
                    className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
              <X size={12} /> Cancel
            </button>
            <button type="button" onClick={submit} disabled={!d.title.trim()}
                    className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1">
              <Save size={12} /> Add action
            </button>
          </div>
        </div>
      )}
      {ordered.length === 0 ? (
        <div className="text-sm text-slate-500 text-center py-6">No action items yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {ordered.map((a) => {
            const meta = ACTION_STATUS_META[a.status];
            const overdue = a.dueDate && a.status !== 'done' && a.status !== 'cancelled' && a.dueDate < new Date().toISOString().slice(0, 10);
            return (
              <li key={a.id} className="border border-slate-200 rounded-lg p-2.5 bg-white flex items-start gap-3">
                <button type="button"
                        onClick={() => onSetStatus(a.id, a.status === 'done' ? 'open' : 'done')}
                        className="mt-0.5 flex-shrink-0"
                        title={a.status === 'done' ? 'Mark as open' : 'Mark as done'}>
                  <meta.Icon size={16} className={a.status === 'done' ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-700'} />
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      value={a.title}
                      onChange={(e) => onUpdate(a.id, { title: e.target.value })}
                      className={`text-xs font-medium bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 flex-1 min-w-[200px] ${
                        a.status === 'done' ? 'line-through text-slate-400' : 'text-slate-900'
                      }`}
                    />
                    <select
                      value={a.status}
                      onChange={(e) => onSetStatus(a.id, e.target.value as ActionStatus)}
                      className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${meta.cls} border-0`}
                    >
                      {(Object.keys(ACTION_STATUS_META) as ActionStatus[]).map((s) => (
                        <option key={s} value={s}>{ACTION_STATUS_META[s].label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-slate-500 mt-1 flex-wrap">
                    <div className="w-52">
                      <UserPicker
                        value={a.ownerEmail}
                        onChange={(email) => onUpdate(a.id, { ownerEmail: email })}
                        placeholder="— Owner —"
                      />
                    </div>
                    <input
                      type="date"
                      value={a.dueDate ?? ''}
                      onChange={(e) => onUpdate(a.id, { dueDate: e.target.value || null })}
                      className={`text-[11px] bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 ${overdue ? 'text-red-700 font-semibold' : ''}`}
                    />
                    {overdue && <span className="text-[10px] text-red-700 font-semibold">overdue</span>}
                  </div>
                  {a.description && (
                    <div className="text-[11px] text-slate-600 mt-1">{a.description}</div>
                  )}
                </div>
                <button type="button" onClick={() => { if (confirm('Delete this action?')) onRemove(a.id); }}
                        className="text-red-400 hover:text-red-700 flex-shrink-0" title="Delete">
                  <Trash2 size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── Tab: Team — roster matching this account ── */

function TeamTab({ account, team }: { account: Account; team: TeamMemberLite[] }) {
  if (team.length === 0) {
    return (
      <div className="text-sm text-slate-500 text-center py-6">
        No one on the roster has <strong>{account.name}</strong> as their current project.<br />
        <span className="text-[11px] text-slate-400">Update <em>project</em> on a roster member to "{account.name}" to surface them here.</span>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-3 font-semibold">Name</th>
            <th className="py-2 pr-3 font-semibold">Role</th>
            <th className="py-2 pr-3 font-semibold">Project (roster)</th>
            <th className="py-2 pr-3 font-semibold">Status</th>
            <th className="py-2 pr-3 font-semibold">Email</th>
            <th className="py-2 pr-3 font-semibold">Location</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {team.map((m, idx) => (
            <tr key={`${m.name}-${idx}`} className="hover:bg-white">
              <td className="py-1.5 pr-3 font-medium text-slate-900">{m.name}</td>
              <td className="py-1.5 pr-3 text-slate-600">{m.role}</td>
              <td className="py-1.5 pr-3 text-slate-600">{m.project}</td>
              <td className="py-1.5 pr-3 text-slate-600">{m.status}</td>
              <td className="py-1.5 pr-3 text-slate-500">{m.email || '—'}</td>
              <td className="py-1.5 pr-3 text-slate-500">{m.location || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Add-account inline form ── */

function AddAccountForm({ onCancel, onAdd }: {
  onCancel: () => void;
  onAdd: (p: { name: string; salesOwnerEmail?: string; deliveryOwnerEmail?: string; industry?: string; notes?: string }) => Promise<unknown>;
}) {
  const [d, setD] = useState({ name: '', salesOwnerEmail: '', deliveryOwnerEmail: '', industry: '', notes: '' });
  const submit = async () => {
    if (!d.name.trim()) return;
    await onAdd({
      name: d.name.trim(),
      salesOwnerEmail: d.salesOwnerEmail || undefined,
      deliveryOwnerEmail: d.deliveryOwnerEmail || undefined,
      industry: d.industry || undefined,
      notes: d.notes || undefined,
    });
  };
  return (
    <Card className="mb-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Account name *">
          <input autoFocus value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })}
                 placeholder="e.g. Equity"
                 className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm" />
        </Field>
        <Field label="Sales owner">
          <UserPicker
            value={d.salesOwnerEmail || null}
            onChange={(email) => setD({ ...d, salesOwnerEmail: email ?? '' })}
            placeholder="— Pick a user —"
          />
        </Field>
        <Field label="Delivery owner">
          <UserPicker
            value={d.deliveryOwnerEmail || null}
            onChange={(email) => setD({ ...d, deliveryOwnerEmail: email ?? '' })}
            placeholder="— Pick a user —"
          />
        </Field>
        <Field label="Industry">
          <input value={d.industry} onChange={(e) => setD({ ...d, industry: e.target.value })}
                 placeholder="Optional"
                 className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm" />
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel}
                className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
          <X size={12} /> Cancel
        </button>
        <button type="button" onClick={submit} disabled={!d.name.trim()}
                className="text-xs font-semibold bg-primary text-white px-3 py-2 rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1">
          <Save size={12} /> Add account
        </button>
      </div>
    </Card>
  );
}

/* ── Small reusable field wrapper ── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

/* ── Hero stat tile (used in the gradient header strip) ── */
function HeroStat({ label, value, valueStr, sensitive, subtitle, tone = 'mute' }: {
  label: string;
  value?: number;
  valueStr?: string;
  sensitive?: boolean;
  subtitle?: string;
  tone?: 'mute' | 'amber' | 'red';
}) {
  const valueTone =
    tone === 'amber' ? 'text-amber-200' :
    tone === 'red' ? 'text-red-200' :
    'text-white';
  const display = valueStr ?? (value != null ? String(value) : '');
  return (
    <div className="bg-white/15 backdrop-blur-sm rounded-lg px-4 py-2.5 ring-1 ring-white/20">
      <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-100/90">
        {label}
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`text-2xl font-extrabold tabular-nums ${valueTone}`}>
          {sensitive ? <Sensitive>{display}</Sensitive> : display}
        </span>
        {subtitle && <span className="text-[10px] text-indigo-100/80">{subtitle}</span>}
      </div>
    </div>
  );
}
