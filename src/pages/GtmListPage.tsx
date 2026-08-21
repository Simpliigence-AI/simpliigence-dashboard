/**
 * GTM List — strategic accounts we're pursuing partnerships with.
 *
 * The page is an executive dashboard: coral "READ THIS FIRST" narrative on
 * a themed ground, big-number "articles" for the snapshot, and eyebrow-tagged
 * feed regions ("IN-FLIGHT", "PROSPECTING", "CLOSED") over feed-style cards.
 * Drawers stay in the app's light palette because they're editing surfaces.
 *
 * The theme mirrors the time of day: light 06:00–18:00, dark otherwise.
 * Mode swap is live (checked once a minute), no refresh needed.
 *
 * Data logic is unchanged from the previous list view — this file only
 * restyles.
 */
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  Plus, Trash2, Users, Calendar, User, Loader2, AlertTriangle,
  ExternalLink, Mail, Phone, Link as LinkIcon, ClipboardCheck, Search,
  ChevronDown, ArrowUpRight, Sparkles, Sun, Moon,
} from 'lucide-react';
import { Button, Drawer } from '../components/ui';
import { useGtmStore } from '../store/useGtmStore';
import { useAuthStore, lookupProfile } from '../store/useAuthStore';
import { useTimeMode } from '../hooks/useTimeMode';
import { GtmNotesEditor } from './gtm/GtmNotesEditor';
import type {
  GtmAccount,
  GtmAction,
  GtmActionStatus,
  GtmContact,
  GtmPriority,
  GtmStatus,
} from '../types/gtm';

const EMPTY_CONTACTS: readonly GtmContact[] = Object.freeze([]);
const EMPTY_ACTIONS: readonly GtmAction[] = Object.freeze([]);

import {
  GTM_STATUS_META,
  GTM_PRIORITY_META,
  GTM_ACTION_STATUS_META,
  GTM_PARTNERSHIP_TYPES,
  GTM_SEGMENTS,
} from '../types/gtm';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso).getTime();
  return Math.round((d - Date.now()) / (24 * 3600 * 1000));
}
function fmtUsdCompact(n: number | null): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

/** Status → CSS-var group name. Each var resolves per-mode from index.css. */
const STATUS_TONE_KEY: Record<GtmStatus, 'coral-weak' | 'coral-strong' | 'violet' | 'emerald' | 'rose' | 'amber' | 'neutral'> = {
  prospecting:       'neutral',
  engaged:           'coral-weak',
  active_discussion: 'coral-strong',
  proposal:          'violet',
  won:               'emerald',
  lost:              'rose',
  paused:            'amber',
};

function statusToneStyle(status: GtmStatus): { background: string; color: string } {
  const key = STATUS_TONE_KEY[status];
  switch (key) {
    case 'coral-weak':   return { background: 'var(--gtm-coral-tint-weak)',   color: 'var(--gtm-coral)' };
    case 'coral-strong': return { background: 'var(--gtm-coral-tint-strong)', color: 'var(--gtm-coral-soft)' };
    case 'violet':       return { background: 'var(--gtm-status-violet-bg)',  color: 'var(--gtm-status-violet-text)' };
    case 'emerald':      return { background: 'var(--gtm-status-emerald-bg)', color: 'var(--gtm-status-emerald-text)' };
    case 'rose':         return { background: 'var(--gtm-status-rose-bg)',    color: 'var(--gtm-status-rose-text)' };
    case 'amber':        return { background: 'var(--gtm-status-amber-bg)',   color: 'var(--gtm-status-amber-text)' };
    case 'neutral':      return { background: 'var(--gtm-status-neutral-bg)', color: 'var(--gtm-status-neutral-text)' };
  }
}
function statusDotStyle(status: GtmStatus): { background: string } {
  const key = STATUS_TONE_KEY[status];
  switch (key) {
    case 'coral-weak':   return { background: 'var(--gtm-coral)' };
    case 'coral-strong': return { background: 'var(--gtm-coral-soft)' };
    case 'violet':       return { background: 'var(--gtm-status-violet-dot)' };
    case 'emerald':      return { background: 'var(--gtm-status-emerald-dot)' };
    case 'rose':         return { background: 'var(--gtm-status-rose-dot)' };
    case 'amber':        return { background: 'var(--gtm-status-amber-dot)' };
    case 'neutral':      return { background: 'var(--gtm-status-neutral-dot)' };
  }
}
function priorityToneStyle(p: GtmPriority): { color: string; dot: string } {
  switch (p) {
    case 'high':   return { color: 'var(--gtm-coral)', dot: 'var(--gtm-coral)' };
    case 'medium': return { color: 'var(--gtm-status-amber-text)', dot: 'var(--gtm-status-amber-dot)' };
    case 'low':    return { color: 'var(--gtm-text-3)', dot: 'var(--gtm-text-4)' };
  }
}

const IN_FLIGHT_STATUSES: GtmStatus[] = ['engaged', 'active_discussion', 'proposal'];
const PROSPECTING_STATUSES: GtmStatus[] = ['prospecting', 'paused'];
const CLOSED_STATUSES: GtmStatus[] = ['won', 'lost'];

export default function GtmListPage() {
  const accounts = useGtmStore((s) => s.accounts);
  const loading = useGtmStore((s) => s.loading);
  const loadAll = useGtmStore((s) => s.loadAll);
  const addAccount = useGtmStore((s) => s.addAccount);
  const currentUser = useAuthStore((s) => s.currentUser);

  // Time-of-day mode. The hook keeps `<html data-mode='…'>` in sync so
  // both the app-wide token flip AND this page's richer coral palette resolve
  // from the same signal. We only need `mode` locally for the small
  // sun/moon indicator top-right.
  const mode = useTimeMode();

  const [openId, setOpenId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<GtmStatus | 'all' | 'active'>('active');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [priorityFilter, setPriorityFilter] = useState<GtmPriority | 'all'>('all');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addAssignee, setAddAssignee] = useState(currentUser?.email ?? '');
  const [addPriority, setAddPriority] = useState<GtmPriority>('medium');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const assigneeOptions = useMemo(() => {
    const s = new Set<string>();
    accounts.forEach((a) => { if (a.assigneeEmail) s.add(a.assigneeEmail); });
    return Array.from(s).sort();
  }, [accounts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (statusFilter === 'active' && (a.status === 'won' || a.status === 'lost')) return false;
      if (statusFilter !== 'all' && statusFilter !== 'active' && a.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && a.priority !== priorityFilter) return false;
      if (assigneeFilter && (a.assigneeEmail ?? '') !== assigneeFilter) return false;
      if (q && !`${a.name} ${a.industry ?? ''} ${a.geo ?? ''} ${a.partnershipType ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [accounts, statusFilter, priorityFilter, assigneeFilter, search]);

  const stats = useMemo(() => {
    const active = accounts.filter((a) => a.status !== 'won' && a.status !== 'lost');
    const highPri = active.filter((a) => a.priority === 'high').length;
    const inFlight = accounts.filter((a) => IN_FLIGHT_STATUSES.includes(a.status)).length;
    const prospecting = accounts.filter((a) => a.status === 'prospecting').length;
    const won = accounts.filter((a) => a.status === 'won').length;
    const pipelineValue = active.reduce((s, a) => s + (a.estimatedAnnualValueUsd ?? 0), 0);
    const overdue = active.filter((a) => {
      const d = daysUntil(a.nextStepDate);
      return d != null && d < 0;
    }).length;
    return { total: accounts.length, active: active.length, highPri, inFlight, prospecting, won, pipelineValue, overdue };
  }, [accounts]);

  const inFlightCards = useMemo(() => filtered.filter((a) => IN_FLIGHT_STATUSES.includes(a.status)), [filtered]);
  const prospectingCards = useMemo(() => filtered.filter((a) => PROSPECTING_STATUSES.includes(a.status)), [filtered]);
  const closedCards = useMemo(() => filtered.filter((a) => CLOSED_STATUSES.includes(a.status)), [filtered]);

  async function submitAdd() {
    if (!addName.trim()) return;
    setBusy(true); setErr(null);
    try {
      const created = await addAccount({
        name: addName,
        assigneeEmail: addAssignee || null,
        priority: addPriority,
        createdBy: currentUser?.email ?? null,
      });
      setAddOpen(false); setAddName('');
      setOpenId(created.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  const openAccount = openId ? accounts.find((a) => a.id === openId) : null;
  const asOfLabel = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    // Break out of the app-layout's bg-surface wrapper so the ground goes edge-to-edge.
    <div
      className="gtm-page -mx-4 -my-4 md:-mx-6 md:-my-6 lg:-mx-8 lg:-my-8 -mt-16 md:-mt-6 min-h-screen"
      style={{ background: 'var(--gtm-bg)', color: 'var(--gtm-text-1)' }}
    >
      {/* Hero band */}
      <section className="px-6 pt-8 pb-6 md:px-10 md:pt-10 md:pb-8 lg:px-14 lg:pt-14 lg:pb-10 max-w-[1400px] mx-auto">
        <div className="flex items-center justify-between gap-4 mb-8 md:mb-12">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 md:w-9 md:h-9 rounded-lg grid place-items-center text-white text-sm font-bold"
              style={{ background: 'var(--gtm-coral)', letterSpacing: '-0.02em' }}
            >
              S
            </div>
            <span className="gtm-t1 font-semibold text-sm md:text-base tracking-tight uppercase">
              Simpliigence
            </span>
          </div>
          <div className="gtm-t3 flex items-center gap-3 text-[10.5px] md:text-[11px] uppercase tracking-[0.14em]">
            <span className="inline-flex items-center gap-1.5">
              {mode === 'light' ? <Sun size={12} /> : <Moon size={12} />}
              {mode} mode · auto
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: 'var(--gtm-coral)' }}
              />
              Live Supabase
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_260px] gap-6 md:gap-10 items-start">
          <div>
            <div className="gtm-coral text-[10.5px] font-bold uppercase tracking-[0.16em] mb-4">
              GTM · Partnership Pipeline
            </div>
            <h1 className="display-xl gtm-t1" style={{ letterSpacing: '-0.045em' }}>
              Strategic
              <br />
              <span className="gtm-coral">accounts</span>
            </h1>
            <p className="mt-4 md:mt-6 gtm-t2 text-sm md:text-base max-w-xl leading-relaxed">
              The partnerships we're pursuing, with owners, next steps, and pipeline value.
              This is the executive read — everything editable is one click into the drawer.
            </p>
          </div>

          <div className="flex flex-wrap md:flex-col md:items-end gap-2">
            <Chip label="As of" value={asOfLabel} />
            <Chip label="Owner view" value={currentUser?.email?.split('@')[0] ?? 'all'} />
            <Chip label="Active" value={String(stats.active)} accent />
            <div className="hidden md:block mt-3">
              <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
                <Plus size={14} /> Add strategic account
              </Button>
            </div>
          </div>
        </div>

        {/* "Read this first" callout — coral, works in both modes */}
        <div
          className="mt-8 md:mt-12 rounded-2xl p-5 md:p-6 flex flex-col md:flex-row gap-4 md:gap-6 md:items-center"
          style={{ background: 'var(--gtm-callout-bg)', color: 'var(--gtm-callout-ink)' }}
        >
          <div
            className="text-[10.5px] font-bold uppercase tracking-[0.16em] shrink-0"
            style={{ color: 'var(--gtm-callout-eyebrow)' }}
          >
            Read this first
          </div>
          <p className="text-sm md:text-[15px] leading-relaxed">
            You're actively pursuing <strong>{stats.active} partnerships</strong>{' '}
            {stats.highPri > 0 && <>({stats.highPri} high-priority)</>}. {stats.inFlight > 0 && (
              <><strong>{stats.inFlight}</strong> are in-flight (engaged, in active discussion, or proposal-out). </>
            )}
            Projected pipeline value: <strong>{fmtUsdCompact(stats.pipelineValue)}</strong>.
            {stats.overdue > 0 && (
              <> <strong>{stats.overdue}</strong> {stats.overdue === 1 ? 'has' : 'have'} an overdue next step and need attention today.</>
            )}
          </p>
        </div>

        {/* Snapshot articles */}
        <div className="mt-8 md:mt-10">
          <div className="eyebrow mb-4 md:mb-5 gtm-coral">Snapshot</div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
            <Article label="Total pursued" value={String(stats.total)} foot={`${stats.active} active`} />
            <Article label="In flight" value={String(stats.inFlight)} foot="Engaged → Proposal" />
            <Article label="Prospecting" value={String(stats.prospecting)} foot="Not yet engaged" />
            <Article label="High priority" value={String(stats.highPri)} foot="Active only" tone="coral" />
            <Article label="Overdue" value={String(stats.overdue)} foot="Past next-step date" tone={stats.overdue > 0 ? 'coral' : 'default'} />
            <Article label="Pipeline value" value={fmtUsdCompact(stats.pipelineValue)} foot="Est. annual, active" />
          </div>
        </div>
      </section>

      {/* Filter + feed */}
      <section className="px-6 pb-16 md:px-10 lg:px-14 max-w-[1400px] mx-auto">
        <div className="gtm-panel rounded-xl p-3 md:p-4 flex flex-wrap items-center gap-2 mb-6 md:mb-8">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 gtm-t4" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, industry, geo, partnership type…"
              className="gtm-input w-full pl-8 pr-2 py-2 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-black/10"
            />
          </div>
          <ThemedSelect
            label="Status"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as typeof statusFilter)}
            options={[
              { value: 'active', label: 'Active (excl. won/lost)' },
              { value: 'all', label: 'All' },
              ...Object.entries(GTM_STATUS_META).map(([k, v]) => ({ value: k, label: v.label })),
            ]}
          />
          <ThemedSelect
            label="Priority"
            value={priorityFilter}
            onChange={(v) => setPriorityFilter(v as typeof priorityFilter)}
            options={[
              { value: 'all', label: 'All' },
              ...Object.entries(GTM_PRIORITY_META).map(([k, v]) => ({ value: k, label: v.label })),
            ]}
          />
          <ThemedSelect
            label="Assignee"
            value={assigneeFilter}
            onChange={setAssigneeFilter}
            options={[{ value: '', label: 'All' }, ...assigneeOptions.map((e) => ({ value: e, label: e }))]}
          />
          <span className="ml-auto text-[11px] gtm-t3 tabular-nums">{filtered.length} of {accounts.length}</span>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="md:hidden inline-flex items-center gap-1 text-[12px] font-semibold px-2.5 py-1.5 rounded-md"
            style={{ background: 'var(--gtm-coral)', color: '#12131a' }}
          >
            <Plus size={13} /> Add
          </button>
        </div>

        {loading && accounts.length === 0 ? (
          <div className="text-center gtm-t3 py-16 text-sm">
            <Loader2 className="inline w-4 h-4 animate-spin mr-1.5" /> Loading strategic accounts…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center gtm-t4 py-16 text-sm italic">
            {accounts.length === 0
              ? 'No strategic accounts yet. Click "Add strategic account" to start.'
              : 'No accounts match the current filters.'}
          </div>
        ) : (
          <>
            <FeedRegion
              eyebrow="In flight"
              title="Partnerships already moving"
              subtitle="Engaged, in active discussion, or with a proposal out."
              cards={inFlightCards}
              onOpen={setOpenId}
            />
            <FeedRegion
              eyebrow="Prospecting pipeline"
              title="Accounts we still need to break into"
              subtitle="Not yet engaged, plus anything on pause."
              cards={prospectingCards}
              onOpen={setOpenId}
            />
            <FeedRegion
              eyebrow="Closed"
              title="Won and lost, this year"
              subtitle="For the record."
              cards={closedCards}
              onOpen={setOpenId}
            />
          </>
        )}

        {/* Placeholder for Phase 2 signals — visible affordance, not wired. */}
        <div
          className="mt-12 rounded-xl p-5 md:p-6 flex items-start gap-4"
          style={{
            background: 'var(--gtm-panel)',
            border: '1px dashed var(--gtm-chip-border)',
          }}
        >
          <div
            className="w-10 h-10 rounded-lg grid place-items-center shrink-0"
            style={{ background: 'var(--gtm-coral-tint-weak)', color: 'var(--gtm-coral)' }}
          >
            <Sparkles size={18} />
          </div>
          <div>
            <div className="eyebrow mb-1 gtm-coral">Coming next</div>
            <h3 className="display-md gtm-t1">LinkedIn hiring signals</h3>
            <p className="mt-2 gtm-t2 text-sm max-w-2xl leading-relaxed">
              Per-account tab in the drawer showing posts by that company's employees
              matching intent keywords (hiring, opening, join our team) and skill
              keywords (Salesforce, AI engineer, data engineer, RPA).
              Pilot on <strong className="gtm-t1">Persistent</strong> and{' '}
              <strong className="gtm-t1">Equity</strong> first; keyword config
              per-list. Powered by Apify, refreshed nightly.
            </p>
          </div>
        </div>

        <footer
          className="mt-14 pt-6 text-[11px] gtm-t4 flex flex-wrap justify-between gap-2"
          style={{ borderTop: '1px solid var(--gtm-line-soft)' }}
        >
          <span>Simpliigence · GTM partnership pipeline</span>
          <span>Live Supabase · executive view</span>
        </footer>
      </section>

      {/* Drawers (kept in the app's light palette — editing surface) */}
      {addOpen && (
        <Drawer open onClose={() => setAddOpen(false)} title="Add strategic account" width="max-w-md">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted uppercase tracking-wider">Account name</label>
              <input
                type="text" value={addName} onChange={(e) => setAddName(e.target.value)}
                autoFocus placeholder="e.g. Slalom, Deloitte Digital, Publicis Sapient"
                className="mt-1 w-full px-3 py-2 rounded border border-line text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted uppercase tracking-wider">Assignee (owner)</label>
              <input
                type="email" value={addAssignee} onChange={(e) => setAddAssignee(e.target.value)}
                placeholder="owner@simpliigence.com"
                className="mt-1 w-full px-3 py-2 rounded border border-line text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted uppercase tracking-wider">Priority</label>
              <select
                value={addPriority} onChange={(e) => setAddPriority(e.target.value as GtmPriority)}
                className="mt-1 w-full px-3 py-2 rounded border border-line text-sm bg-surface"
              >
                {Object.entries(GTM_PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            {err && (
              <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5 flex items-center gap-1">
                <AlertTriangle size={11} /> {err}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <Button variant="ghost" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={submitAdd} disabled={!addName.trim() || busy}>
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                <span className="ml-1">Create</span>
              </Button>
            </div>
          </div>
        </Drawer>
      )}

      {openAccount && <GtmAccountDrawer account={openAccount} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/* Hero building blocks — theme-aware */
function Chip({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="inline-flex items-baseline gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium"
      style={{
        background: accent ? 'var(--gtm-coral-tint-weak)' : 'var(--gtm-chip-bg)',
        color: accent ? 'var(--gtm-coral)' : 'var(--gtm-text-2)',
        border: `1px solid ${accent ? 'var(--gtm-coral-tint-strong)' : 'var(--gtm-chip-border)'}`,
      }}
    >
      <span className="uppercase tracking-[0.12em] text-[9.5px] opacity-70">{label}</span>
      <span className="tabular-nums font-semibold">{value}</span>
    </div>
  );
}

function Article({
  label, value, foot, tone = 'default',
}: { label: string; value: string; foot?: string; tone?: 'default' | 'coral' }) {
  const isCoral = tone === 'coral';
  return (
    <div className="gtm-panel rounded-xl p-4 md:p-5">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] gtm-t3 mb-1.5">{label}</div>
      <div
        className="text-[26px] md:text-[30px] font-bold tabular-nums leading-none"
        style={{
          color: isCoral ? 'var(--gtm-coral)' : 'var(--gtm-text-1)',
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </div>
      {foot && <div className="text-[11px] gtm-t3 mt-1.5">{foot}</div>}
    </div>
  );
}

function ThemedSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] gtm-t3">
      <span className="uppercase tracking-[0.1em] text-[10px]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="gtm-input px-2 py-1.5 rounded-md text-[12px] focus:outline-none focus:ring-1 focus:ring-black/10"
      >
        {options.map((o) => (
          // Note: <option> can't be themed easily across browsers; native styling
          // wins on the popup. That's acceptable — the trigger button is themed.
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/* Feed region + card */
function FeedRegion({
  eyebrow, title, subtitle, cards, onOpen,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  cards: GtmAccount[];
  onOpen: (id: string) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <div className="mb-10 md:mb-12">
      <div className="flex items-end justify-between gap-4 mb-4 md:mb-5">
        <div>
          <div className="eyebrow mb-1.5 gtm-coral">{eyebrow}</div>
          <h2 className="display-md gtm-t1" style={{ letterSpacing: '-0.02em' }}>{title}</h2>
          <p className="text-[12.5px] gtm-t3 mt-1">{subtitle}</p>
        </div>
        <span className="text-[11px] gtm-t4 tabular-nums whitespace-nowrap">
          {cards.length} {cards.length === 1 ? 'account' : 'accounts'}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
        {cards.map((a) => <FeedCard key={a.id} account={a} onOpen={() => onOpen(a.id)} />)}
      </div>
    </div>
  );
}

function FeedCard({ account, onOpen }: { account: GtmAccount; onOpen: () => void }) {
  const statusLabel = GTM_STATUS_META[account.status].label;
  const chipStyle = statusToneStyle(account.status);
  const dotStyle = statusDotStyle(account.status);
  const pr = priorityToneStyle(account.priority);
  const prLabel = GTM_PRIORITY_META[account.priority].label;
  const dU = daysUntil(account.nextStepDate);
  const overdue = dU != null && dU < 0 && account.status !== 'won' && account.status !== 'lost';
  const soon = dU != null && dU >= 0 && dU <= 3;
  const meta = [account.industry, account.geo, account.segment].filter(Boolean).join(' · ');

  return (
    <button
      type="button"
      onClick={onOpen}
      className="gtm-panel text-left rounded-xl p-4 md:p-5 group hover:-translate-y-0.5 transition-transform"
    >
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 gtm-t1 font-bold text-[15px] leading-tight tracking-tight truncate">
            {account.name}
            <ArrowUpRight
              size={12}
              className="shrink-0 transition-colors"
              style={{ color: 'var(--gtm-text-4)' }}
            />
          </div>
          {meta && <div className="text-[11px] gtm-t3 mt-0.5 truncate">{meta}</div>}
        </div>
        <span
          className="inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={chipStyle}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={dotStyle} />
          {statusLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 pt-3 gtm-line-t">
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] gtm-t3 mb-0.5">Est. annual</div>
          <div className="gtm-t1 text-[15px] font-bold tabular-nums" style={{ letterSpacing: '-0.01em' }}>
            {fmtUsdCompact(account.estimatedAnnualValueUsd)}
          </div>
        </div>
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] gtm-t3 mb-0.5">Priority</div>
          <div className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: pr.color }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: pr.dot }} />
            {prLabel}
          </div>
        </div>
      </div>

      <div className="mt-3 pt-3 gtm-line-t">
        <div className="text-[9.5px] font-bold uppercase tracking-[0.12em] gtm-t3 mb-0.5">Next step</div>
        {account.nextStep ? (
          <>
            <div className="text-[12.5px] gtm-t2 line-clamp-2 leading-snug">{account.nextStep}</div>
            {account.nextStepDate && (
              <div
                className="text-[11px] mt-1 tabular-nums"
                style={{
                  color: overdue
                    ? 'var(--gtm-coral)'
                    : soon ? 'var(--gtm-status-amber-text)' : 'var(--gtm-text-4)',
                }}
              >
                {fmtDate(account.nextStepDate)}
                {overdue && ' · overdue'}
                {soon && !overdue && ' · due soon'}
              </div>
            )}
          </>
        ) : (
          <div className="text-[12.5px] italic gtm-t4">No next step set</div>
        )}
      </div>

      <div className="mt-3 pt-3 gtm-line-t flex items-center justify-between text-[11px]">
        <span className="gtm-t3 truncate">
          {account.assigneeEmail || <span className="italic gtm-t4">unassigned</span>}
        </span>
        {account.partnershipType && (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
            style={{ background: 'var(--gtm-chip-bg)', color: 'var(--gtm-text-2)' }}
          >
            {account.partnershipType}
          </span>
        )}
      </div>
    </button>
  );
}

/* Drawer (kept in app's light palette — editing surface) */
function GtmAccountDrawer({ account, onClose }: { account: GtmAccount; onClose: () => void }) {
  const update = useGtmStore((s) => s.updateAccount);
  const remove = useGtmStore((s) => s.removeAccount);
  const loadDetail = useGtmStore((s) => s.loadDetail);
  const contactsRaw = useGtmStore((s) => s.contactsByAccount[account.id]);
  const contacts = contactsRaw ?? (EMPTY_CONTACTS as GtmContact[]);
  const actionsRaw = useGtmStore((s) => s.actionsByAccount[account.id]);
  const actions = actionsRaw ?? (EMPTY_ACTIONS as GtmAction[]);
  const directory = useAuthStore((s) => s.directory);

  const [tab, setTab] = useState<'plan' | 'contacts' | 'actions'>('plan');

  useEffect(() => { void loadDetail(account.id); }, [account.id, loadDetail]);

  const directoryEmails = useMemo(() => Object.keys(directory).sort(), [directory]);

  return (
    <Drawer open onClose={onClose} title={account.name} width="max-w-3xl">
      <div className="flex items-center gap-1 border-b border-line mb-4 -mt-2 overflow-x-auto">
        {([
          { key: 'plan', label: 'Account plan' },
          { key: 'contacts', label: `Contacts (${contacts.length})` },
          { key: 'actions', label: `Actions (${actions.length})` },
        ] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-sky-600 text-sky-700' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => { if (confirm(`Delete "${account.name}" and all its contacts + actions?`)) { void remove(account.id); onClose(); } }}
          className="ml-auto text-[11px] text-rose-600 hover:text-rose-800 px-2 flex items-center gap-1"
        >
          <Trash2 size={11} /> Delete
        </button>
      </div>

      {tab === 'plan' && <PlanEditor account={account} update={update} directoryEmails={directoryEmails} actions={actions} />}
      {tab === 'contacts' && <ContactsEditor accountId={account.id} contacts={contacts} directoryEmails={directoryEmails} />}
      {tab === 'actions' && <ActionsEditor accountId={account.id} actions={actions} directoryEmails={directoryEmails} />}
    </Drawer>
  );
}

/* Plan tab */
function PlanEditor({ account, update, directoryEmails, actions }: { account: GtmAccount; update: (id: string, patch: Partial<GtmAccount>) => Promise<void>; directoryEmails: string[]; actions: GtmAction[] }) {
  const setField = <K extends keyof GtmAccount>(k: K, v: GtmAccount[K]) => void update(account.id, { [k]: v } as Partial<GtmAccount>);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <FieldText label="Account name" value={account.name} onCommit={(v) => setField('name', v)} />
        <FieldText label="Website" value={account.website ?? ''} placeholder="acme.com" onCommit={(v) => setField('website', v || null)} />
        <FieldText label="Industry" value={account.industry ?? ''} placeholder="e.g. Financial Services" onCommit={(v) => setField('industry', v || null)} />
        <FieldSelect label="Segment" value={account.segment ?? ''} options={['', ...GTM_SEGMENTS]} onCommit={(v) => setField('segment', v || null)} />
        <FieldText label="Geo" value={account.geo ?? ''} placeholder="e.g. US, EMEA, India" onCommit={(v) => setField('geo', v || null)} />
        <FieldSelect label="Partnership type" value={account.partnershipType ?? ''} options={['', ...GTM_PARTNERSHIP_TYPES]} onCommit={(v) => setField('partnershipType', v || null)} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <FieldSelect
          label="Status" value={account.status}
          options={Object.keys(GTM_STATUS_META) as GtmStatus[]}
          renderOption={(v) => GTM_STATUS_META[v as GtmStatus].label}
          onCommit={(v) => setField('status', v as GtmStatus)}
        />
        <FieldSelect
          label="Priority" value={account.priority}
          options={Object.keys(GTM_PRIORITY_META) as GtmPriority[]}
          renderOption={(v) => GTM_PRIORITY_META[v as GtmPriority].label}
          onCommit={(v) => setField('priority', v as GtmPriority)}
        />
        <FieldEmail label="Assignee" value={account.assigneeEmail ?? ''} suggestions={directoryEmails} onCommit={(v) => setField('assigneeEmail', v || null)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FieldText label="Next step" value={account.nextStep ?? ''} placeholder="e.g. Follow-up meeting on partnership scope" onCommit={(v) => setField('nextStep', v || null)} />
        <FieldDate label="Next step date" value={account.nextStepDate ?? ''} onCommit={(v) => setField('nextStepDate', v || null)} />
        <FieldNumber label="Est. annual value (USD)" value={account.estimatedAnnualValueUsd} onCommit={(v) => setField('estimatedAnnualValueUsd', v)} />
      </div>

      <FieldTextarea label="Rationale (why this account, why now)" value={account.rationale ?? ''} rows={3} onCommit={(v) => setField('rationale', v || null)} />
      <GtmNotesEditor account={account} existingActions={actions} />
    </div>
  );
}

/* Contacts tab */
function ContactsEditor({ accountId, contacts, directoryEmails }: { accountId: string; contacts: GtmContact[]; directoryEmails: string[] }) {
  const add = useGtmStore((s) => s.addContact);
  const update = useGtmStore((s) => s.updateContact);
  const remove = useGtmStore((s) => s.removeContact);
  const currentUser = useAuthStore((s) => s.currentUser);
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    setBusy(true); setErr(null);
    try {
      await add({
        gtmAccountId: accountId,
        name,
        title: title || null,
        email: email || null,
        relationshipOwner: currentUser?.email ?? null,
      });
      setName(''); setTitle(''); setEmail('');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-surface-2 p-3 space-y-2">
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wider flex items-center gap-1"><Users size={11} /> Add contact</div>
        <div className="grid grid-cols-3 gap-2">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *" className="px-2 py-1.5 rounded border border-line text-sm" />
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. VP Alliances)" className="px-2 py-1.5 rounded border border-line text-sm" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@company.com" className="px-2 py-1.5 rounded border border-line text-sm" />
        </div>
        {err && <div className="text-[11px] text-rose-700 flex items-center gap-1"><AlertTriangle size={10} /> {err}</div>}
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={submit} disabled={!name.trim() || busy}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            <span className="ml-1">Add contact</span>
          </Button>
        </div>
      </div>

      {contacts.length === 0 ? (
        <div className="text-center text-muted italic text-sm py-6">No contacts yet.</div>
      ) : (
        <ul className="space-y-2">
          {contacts.map((c) => <ContactRow key={c.id} contact={c} onChange={update} onRemove={remove} directoryEmails={directoryEmails} />)}
        </ul>
      )}
    </div>
  );
}

function ContactRow({ contact, onChange, onRemove, directoryEmails }: {
  contact: GtmContact;
  onChange: (id: string, patch: Partial<GtmContact>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  directoryEmails: string[];
}) {
  const ownerProfile = contact.relationshipOwner ? lookupProfile(contact.relationshipOwner, useAuthStore.getState().directory) : null;
  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-start">
        <input type="text" value={contact.name} onChange={(e) => onChange(contact.id, { name: e.target.value })} className="md:col-span-2 text-sm font-semibold text-ink px-1 py-1 rounded border-transparent hover:border-line focus:border-line focus:outline-none focus:bg-surface-2" />
        <input type="text" value={contact.title ?? ''} onChange={(e) => onChange(contact.id, { title: e.target.value || null })} placeholder="Title" className="md:col-span-2 text-xs text-ink/80 px-1 py-1 rounded border-transparent hover:border-line focus:border-line focus:outline-none focus:bg-surface-2" />
        <input type="date" value={contact.lastTouched ?? ''} onChange={(e) => onChange(contact.id, { lastTouched: e.target.value || null })} title="Last touched" className="text-xs text-muted px-1 py-1 rounded border-transparent hover:border-line focus:border-line focus:outline-none focus:bg-surface-2" />
        <button type="button" onClick={() => { if (confirm(`Remove ${contact.name}?`)) void onRemove(contact.id); }} className="text-muted hover:text-rose-600 justify-self-end p-1" title="Remove"><Trash2 size={13} /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1.5">
        <label className="flex items-center gap-1 text-[11px] text-muted">
          <Mail size={10} className="text-muted" />
          <input type="email" value={contact.email ?? ''} onChange={(e) => onChange(contact.id, { email: e.target.value || null })} placeholder="email@…" className="flex-1 px-1 py-0.5 rounded border-transparent hover:border-line focus:border-line focus:outline-none focus:bg-surface-2" />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted">
          <Phone size={10} className="text-muted" />
          <input type="tel" value={contact.phone ?? ''} onChange={(e) => onChange(contact.id, { phone: e.target.value || null })} placeholder="+1…" className="flex-1 px-1 py-0.5 rounded border-transparent hover:border-line focus:border-line focus:outline-none focus:bg-surface-2" />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-muted">
          <LinkIcon size={10} className="text-muted" />
          <input type="url" value={contact.linkedinUrl ?? ''} onChange={(e) => onChange(contact.id, { linkedinUrl: e.target.value || null })} placeholder="linkedin.com/in/…" className="flex-1 px-1 py-0.5 rounded border-transparent hover:border-line focus:border-line focus:outline-none focus:bg-surface-2" />
          {contact.linkedinUrl && <a href={contact.linkedinUrl} target="_blank" rel="noopener" className="text-muted hover:text-sky-600"><ExternalLink size={10} /></a>}
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1.5">
        <label className="flex items-center gap-1 text-[11px] text-muted md:col-span-1">
          <User size={10} className="text-muted" />
          <input type="email" value={contact.relationshipOwner ?? ''} onChange={(e) => onChange(contact.id, { relationshipOwner: e.target.value || null })} placeholder="owner@simpliigence.com" list={`owners-${contact.id}`} className="flex-1 px-1 py-0.5 rounded border-transparent hover:border-line focus:border-line focus:outline-none focus:bg-surface-2" />
          <datalist id={`owners-${contact.id}`}>{directoryEmails.map((e) => <option key={e} value={e} />)}</datalist>
        </label>
        <input type="text" value={contact.notes ?? ''} onChange={(e) => onChange(contact.id, { notes: e.target.value || null })} placeholder="Notes / relationship context" className="md:col-span-2 text-[11px] text-muted px-1 py-0.5 rounded border border-line focus:border-line focus:outline-none" />
      </div>
      {ownerProfile?.fullName && <div className="text-[10px] text-muted mt-1">Owned internally by {ownerProfile.fullName}</div>}
    </li>
  );
}

/* Actions tab */
function ActionsEditor({ accountId, actions, directoryEmails }: { accountId: string; actions: GtmAction[]; directoryEmails: string[] }) {
  const add = useGtmStore((s) => s.addAction);
  const update = useGtmStore((s) => s.updateAction);
  const remove = useGtmStore((s) => s.removeAction);
  const currentUser = useAuthStore((s) => s.currentUser);
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState(currentUser?.email ?? '');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) return;
    setBusy(true); setErr(null);
    try {
      await add({ gtmAccountId: accountId, title, assigneeEmail: assignee || null, dueDate: due || null, createdBy: currentUser?.email ?? null });
      setTitle(''); setDue('');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-surface-2 p-3 space-y-2">
        <div className="text-[11px] font-semibold text-muted uppercase tracking-wider flex items-center gap-1"><ClipboardCheck size={11} /> Add action</div>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Action title (e.g. Reach out to VP Alliances at Slalom)" className="w-full px-3 py-1.5 rounded border border-line text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <input type="email" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="assignee@simpliigence.com" list="assignees-add" className="px-2 py-1.5 rounded border border-line text-xs" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="px-2 py-1.5 rounded border border-line text-xs" />
          <datalist id="assignees-add">{directoryEmails.map((e) => <option key={e} value={e} />)}</datalist>
        </div>
        {err && <div className="text-[11px] text-rose-700 flex items-center gap-1"><AlertTriangle size={10} /> {err}</div>}
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={submit} disabled={!title.trim() || busy}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            <span className="ml-1">Add action</span>
          </Button>
        </div>
      </div>

      {actions.length === 0 ? (
        <div className="text-center text-muted italic text-sm py-6">No actions yet.</div>
      ) : (
        <ul className="space-y-1.5">
          {actions.map((a) => <ActionRow key={a.id} action={a} onChange={update} onRemove={remove} directoryEmails={directoryEmails} />)}
        </ul>
      )}
    </div>
  );
}

function ActionRow({ action, onChange, onRemove, directoryEmails }: {
  action: GtmAction;
  onChange: (id: string, patch: Partial<GtmAction>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  directoryEmails: string[];
}) {
  const meta = GTM_ACTION_STATUS_META[action.status];
  const dU = daysUntil(action.dueDate);
  const isOverdue = dU != null && dU < 0 && action.status !== 'done' && action.status !== 'cancelled';
  return (
    <li className="rounded-lg border border-line bg-surface p-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={action.status} onChange={(e) => onChange(action.id, { status: e.target.value as GtmActionStatus })} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-pointer ${meta.cls}`}>
          {Object.entries(GTM_ACTION_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input type="text" value={action.title} onChange={(e) => onChange(action.id, { title: e.target.value })} className={`text-sm font-semibold text-ink flex-1 min-w-[200px] px-1 py-0.5 rounded border-transparent hover:border-line focus:border-line focus:outline-none focus:bg-surface-2 ${action.status === 'done' ? 'line-through text-muted' : ''}`} />
        <div className="flex items-center gap-1 text-[11px] text-muted">
          <User size={11} className="text-muted" />
          <input type="email" value={action.assigneeEmail ?? ''} onChange={(e) => onChange(action.id, { assigneeEmail: e.target.value || null })} placeholder="unassigned" list={`aa-${action.id}`} className="px-1 py-0.5 rounded border-transparent hover:border-line focus:border-line focus:outline-none focus:bg-surface-2 w-40" />
          <datalist id={`aa-${action.id}`}>{directoryEmails.map((e) => <option key={e} value={e} />)}</datalist>
        </div>
        <div className={`flex items-center gap-1 text-[11px] ${isOverdue ? 'text-rose-700 font-semibold' : 'text-muted'}`}>
          <Calendar size={11} className={isOverdue ? 'text-rose-500' : 'text-muted'} />
          <input type="date" value={action.dueDate ?? ''} onChange={(e) => onChange(action.id, { dueDate: e.target.value || null })} className="px-1 py-0.5 rounded border-transparent hover:border-line focus:border-line focus:outline-none focus:bg-surface-2" />
        </div>
        <button type="button" onClick={() => { if (confirm(`Delete "${action.title}"?`)) void onRemove(action.id); }} className="text-muted hover:text-rose-600 p-1" title="Remove"><Trash2 size={13} /></button>
      </div>
      {(action.description || action.completedAt) && (
        <details className="mt-1 pl-1">
          <summary className="text-[10px] text-muted cursor-pointer inline-flex items-center gap-0.5 select-none"><ChevronDown size={9} /> details</summary>
          {action.description && <div className="text-[11px] text-muted mt-1 pl-3 whitespace-pre-wrap">{action.description}</div>}
          {action.completedAt && <div className="text-[10px] text-emerald-600 mt-0.5 pl-3">Completed {fmtDate(action.completedAt)}</div>}
        </details>
      )}
    </li>
  );
}

/* Field primitives (commit-on-blur) */
function FieldText({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-muted uppercase tracking-wider">{label}</span>
      <input type="text" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} placeholder={placeholder} className="mt-0.5 w-full px-2 py-1.5 rounded border border-line text-sm" />
    </label>
  );
}
function FieldTextarea({ label, value, onCommit, rows = 3, placeholder }: { label: string; value: string; onCommit: (v: string) => void; rows?: number; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-muted uppercase tracking-wider">{label}</span>
      <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} rows={rows} placeholder={placeholder} className="mt-0.5 w-full px-2 py-1.5 rounded border border-line text-sm" />
    </label>
  );
}
function FieldNumber({ label, value, onCommit }: { label: string; value: number | null; onCommit: (v: number | null) => void }) {
  const [v, setV] = useState<string>(value == null ? '' : String(value));
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-muted uppercase tracking-wider">{label}</span>
      <input type="number" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => {
        const parsed = v === '' ? null : Number(v);
        if (parsed !== value) onCommit(parsed);
      }} className="mt-0.5 w-full px-2 py-1.5 rounded border border-line text-sm" />
    </label>
  );
}
function FieldDate({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-muted uppercase tracking-wider">{label}</span>
      <input type="date" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} className="mt-0.5 w-full px-2 py-1.5 rounded border border-line text-sm" />
    </label>
  );
}
function FieldEmail({ label, value, onCommit, suggestions }: { label: string; value: string; onCommit: (v: string) => void; suggestions: string[] }) {
  const [v, setV] = useState(value);
  const id = `dl-${label.toLowerCase().replace(/\s+/g, '-')}`;
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-muted uppercase tracking-wider">{label}</span>
      <input type="email" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} list={id} className="mt-0.5 w-full px-2 py-1.5 rounded border border-line text-sm" />
      <datalist id={id}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
    </label>
  );
}
function FieldSelect<T extends string>({ label, value, options, renderOption, onCommit }: { label: string; value: T | ''; options: readonly (T | '')[]; renderOption?: (v: T) => string; onCommit: (v: string) => void }): JSX.Element {
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-muted uppercase tracking-wider">{label}</span>
      <select value={value} onChange={(e) => onCommit(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 rounded border border-line text-sm bg-surface">
        {options.map((o) => <option key={o} value={o}>{o === '' ? '—' : (renderOption ? renderOption(o as T) : o)}</option>)}
      </select>
    </label>
  );
}
