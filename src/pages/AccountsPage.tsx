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
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Trash2, Save, X, ChevronDown, ChevronRight, AlertTriangle, Users,
  Calendar, Briefcase, CheckCircle2, Circle, PauseCircle, XCircle, Clock,
  Sparkles, RefreshCw, Loader2,
} from 'lucide-react';
import { Card } from '../components/ui';
import { runAccountBriefing, type AccountBriefing } from '../lib/claudeQuery';
import { UserPicker } from '../components/UserPicker';
import { TaIdentity } from '../components/TaIdentity';
import { useAuthStore } from '../store/useAuthStore';
import { useAccountStore } from '../store/useAccountStore';
import { useIndiaRosterStore } from '../store/useIndiaRosterStore';
import { useUSRosterStore } from '../store/useUSRosterStore';
import { STALE_CONNECT_DAYS } from '../types/accountMgmt';
import { ClientContactsTab } from './accounts/ClientContactsTab';
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<Record<string, AccountTab>>({});
  const [adding, setAdding] = useState(false);

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
      result.set(acc.id, { lastSales, lastDelivery, openActions, teamCount: team.length, isStale });
    }
    return result;
  }, [accounts, connects, actions, indiaRoster, usRoster]);

  // ── Filter ──
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return accounts.filter((a) => {
      const d = derivedByAccount.get(a.id);
      if (filterStale && !d?.isStale) return false;
      if (needle) {
        const hay = `${a.name} ${a.salesOwnerEmail ?? ''} ${a.deliveryOwnerEmail ?? ''} ${a.industry ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    }).sort((a, b) => {
      // Stale accounts to the top, then alphabetical
      const sa = derivedByAccount.get(a.id)?.isStale ? 0 : 1;
      const sb = derivedByAccount.get(b.id)?.isStale ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return a.name.localeCompare(b.name);
    });
  }, [accounts, q, filterStale, derivedByAccount]);

  const staleCount = useMemo(
    () => accounts.filter((a) => derivedByAccount.get(a.id)?.isStale).length,
    [accounts, derivedByAccount],
  );

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
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
        <div className="relative grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <HeroStat label="Total" value={accounts.length} />
          <HeroStat label="Active" value={activeCount} />
          <HeroStat label="Open actions" value={totalOpenActions} tone={totalOpenActions > 0 ? 'amber' : 'mute'} />
          <HeroStat label="Stale" value={staleCount} tone={staleCount > 0 ? 'red' : 'mute'} subtitle={`>${STALE_CONNECT_DAYS}d`} />
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
            onClick={() => setFilterStale((v) => !v)}
            className={`text-xs font-semibold px-3 py-2 rounded-md border inline-flex items-center gap-1.5 transition-colors ${
              filterStale
                ? 'bg-red-50 border-red-300 text-red-800'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle size={12} /> {filterStale ? 'Showing stale only' : `Show stale only (${staleCount})`}
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
                  />
                  {isOpen && (
                    <AccountDetail
                      account={acc}
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

function AccountRow({ serialNo, account, derived, isOpen, onToggle }: {
  serialNo: number;
  account: Account;
  derived: { lastSales: AccountConnect | null; lastDelivery: AccountConnect | null; openActions: number; teamCount: number; isStale: boolean };
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { lastSales, lastDelivery, openActions, teamCount, isStale } = derived;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full text-left px-6 py-4 flex items-start gap-3 border-l-4 transition-all duration-150 ${
        isStale
          ? 'border-red-500 bg-gradient-to-r from-red-50/60 to-transparent hover:from-red-50'
          : 'border-transparent hover:bg-slate-50/80 hover:border-primary/30'
      }`}
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
        {/* Top line: name + status + stale + industry */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-bold text-slate-900 tracking-tight">{account.name}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${STATUS_COLORS[account.status]}`}>
            {account.status}
          </span>
          {isStale && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-red-100 text-red-800 inline-flex items-center gap-1 ring-1 ring-red-200">
              <AlertTriangle size={10} /> Stale
            </span>
          )}
          {account.industry && (
            <span className="text-[10px] text-slate-500 inline-flex items-center gap-1">
              <Briefcase size={10} /> {account.industry}
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

type AccountTab = 'overview' | 'sales' | 'delivery' | 'contacts' | 'actions' | 'team';

interface TeamMemberLite { name: string; role: string; project: string; status: string; email: string; location: string | null; }

function AccountDetail(props: {
  account: Account;
  connects: AccountConnect[];
  actions: AccountActionItem[];
  team: TeamMemberLite[];
  activeTab: AccountTab;
  onTab: (t: AccountTab) => void;
  myEmail: string;
  onPatchAccount: (patch: Partial<Account>) => void | Promise<void>;
  onRemoveAccount: () => void | Promise<void>;
  onAddConnect: (p: { connectType: ConnectType; meetingDate: string; attendees?: string; discussion?: string; outcome?: string; createdBy?: string }) => Promise<unknown>;
  onRemoveConnect: (id: string) => Promise<unknown>;
  onAddAction: (p: { connectId?: string; title: string; description?: string; ownerEmail?: string; dueDate?: string }) => Promise<unknown>;
  onUpdateAction: (id: string, patch: Partial<AccountActionItem>) => Promise<unknown>;
  onRemoveAction: (id: string) => Promise<unknown>;
  onSetActionStatus: (id: string, status: ActionStatus) => Promise<unknown>;
}) {
  const { account, connects, actions, team, activeTab, onTab, myEmail } = props;
  const sales = connects.filter((c) => c.connectType === 'sales').sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
  const delivery = connects.filter((c) => c.connectType === 'delivery').sort((a, b) => b.meetingDate.localeCompare(a.meetingDate));
  const tabs: { key: AccountTab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'sales', label: 'Sales connects', count: sales.length },
    { key: 'delivery', label: 'Delivery connects', count: delivery.length },
    { key: 'contacts', label: 'Client contacts' },
    { key: 'actions', label: 'Actions', count: actions.filter((a) => a.status === 'open' || a.status === 'in_progress').length },
    { key: 'team', label: 'Team', count: team.length },
  ];

  return (
    <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100">
      <div className="flex items-center gap-1 mb-4 border-b border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onTab(t.key)}
            className={`text-xs font-semibold px-3 py-2 border-b-2 -mb-px transition-colors ${
              activeTab === t.key ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="ml-1.5 text-[10px] bg-slate-200 text-slate-700 rounded-full px-1.5 py-0.5">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <OverviewTab account={account} onPatch={props.onPatchAccount} onRemove={props.onRemoveAccount} />
      )}
      {activeTab === 'sales' && (
        <ConnectsTab
          connects={sales}
          connectType="sales"
          onAdd={(p) => props.onAddConnect({ ...p, connectType: 'sales', createdBy: myEmail })}
          onRemove={props.onRemoveConnect}
        />
      )}
      {activeTab === 'delivery' && (
        <ConnectsTab
          connects={delivery}
          connectType="delivery"
          onAdd={(p) => props.onAddConnect({ ...p, connectType: 'delivery', createdBy: myEmail })}
          onRemove={props.onRemoveConnect}
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

function ConnectsTab({ connects, connectType, onAdd, onRemove }: {
  connects: AccountConnect[];
  connectType: ConnectType;
  onAdd: (p: { meetingDate: string; attendees?: string; discussion?: string; outcome?: string }) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [d, setD] = useState({ meetingDate: today, attendees: '', discussion: '', outcome: '' });

  const submit = async () => {
    if (!d.meetingDate || (!d.discussion && !d.outcome && !d.attendees)) return;
    await onAdd(d);
    setD({ meetingDate: today, attendees: '', discussion: '', outcome: '' });
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
        <div className="border border-slate-200 rounded-lg p-3 bg-white">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
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
          <Field label="What was discussed">
            <textarea value={d.discussion} onChange={(e) => setD({ ...d, discussion: e.target.value })}
                      rows={2}
                      className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs resize-y" />
          </Field>
          <div className="mt-2">
            <Field label="Outcome / what happened">
              <textarea value={d.outcome} onChange={(e) => setD({ ...d, outcome: e.target.value })}
                        rows={2}
                        placeholder="Decisions made, deliverables agreed, next steps."
                        className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs resize-y" />
            </Field>
          </div>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={() => { setAdding(false); }}
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
function HeroStat({ label, value, subtitle, tone = 'mute' }: {
  label: string;
  value: number;
  subtitle?: string;
  tone?: 'mute' | 'amber' | 'red';
}) {
  const valueTone =
    tone === 'amber' ? 'text-amber-200' :
    tone === 'red' ? 'text-red-200' :
    'text-white';
  return (
    <div className="bg-white/15 backdrop-blur-sm rounded-lg px-4 py-2.5 ring-1 ring-white/20">
      <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-100/90">
        {label}
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`text-2xl font-extrabold tabular-nums ${valueTone}`}>{value}</span>
        {subtitle && <span className="text-[10px] text-indigo-100/80">{subtitle}</span>}
      </div>
    </div>
  );
}
