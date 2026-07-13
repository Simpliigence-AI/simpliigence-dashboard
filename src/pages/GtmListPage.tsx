/**
 * GTM List — strategic accounts we're pursuing partnerships with.
 *
 * List of target accounts (each is a mini-account-plan) with:
 *   - assignee (internal owner)
 *   - status (prospecting → engaged → active_discussion → proposal → won/lost)
 *   - priority
 *   - next step + date
 *   - partnership type (Reseller / SI Partner / etc.)
 *   - est. annual value
 *
 * Click a row to open the drawer with:
 *   - editable header
 *   - contacts (their people — name, title, email, LinkedIn, relationship owner)
 *   - actions (title, assignee, due date, status)
 *   - rationale + free-text notes
 *
 * All fields editable inline; changes go straight to Supabase.
 */
import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { Plus, Trash2, Users, Calendar, User, Handshake, Loader2, AlertTriangle, ExternalLink, Mail, Phone, Link as LinkIcon, ClipboardCheck, Search, ChevronDown, DollarSign, TrendingUp, Target } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard, Badge, Button, Drawer } from '../components/ui';
import { useGtmStore } from '../store/useGtmStore';
import { useAuthStore, lookupProfile } from '../store/useAuthStore';
import type {
  GtmAccount,
  GtmAction,
  GtmActionStatus,
  GtmContact,
  GtmPriority,
  GtmStatus,
} from '../types/gtm';

// Stable module-level empties — a fresh `[]` from a selector triggers Zustand's
// Object.is compare on every store update and re-renders forever (React #185).
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

export default function GtmListPage() {
  const accounts = useGtmStore((s) => s.accounts);
  const loading = useGtmStore((s) => s.loading);
  const loadAll = useGtmStore((s) => s.loadAll);
  const addAccount = useGtmStore((s) => s.addAccount);
  const currentUser = useAuthStore((s) => s.currentUser);

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
    const inFlight = accounts.filter((a) => ['engaged', 'active_discussion', 'proposal'].includes(a.status)).length;
    const won = accounts.filter((a) => a.status === 'won').length;
    const pipelineValue = active.reduce((s, a) => s + (a.estimatedAnnualValueUsd ?? 0), 0);
    return { total: accounts.length, active: active.length, highPri, inFlight, won, pipelineValue };
  }, [accounts]);

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

  return (
    <div>
      <PageHeader
        title="GTM List"
        subtitle="Strategic accounts we're pursuing partnerships with — assignees, contacts, action items"
        action={
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add strategic account
          </Button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        <StatCard label="Total" value={stats.total} icon={<Handshake size={20} />} subtitle={`${stats.active} active`} />
        <StatCard label="High Priority" value={stats.highPri} icon={<Target size={20} />} subtitle="Active only" />
        <StatCard label="In Flight" value={stats.inFlight} icon={<TrendingUp size={20} />} subtitle="Engaged → Proposal" />
        <StatCard label="Won" value={stats.won} icon={<ClipboardCheck size={20} />} subtitle="Partnerships closed" />
        <StatCard label="Pipeline Value" value={fmtUsdCompact(stats.pipelineValue)} icon={<DollarSign size={20} />} subtitle="Est. annual" />
      </div>

      {/* Filters */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, industry, geo, partnership type…"
              className="w-full pl-7 pr-2 py-1.5 rounded border border-slate-300 text-sm"
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="px-2 py-1.5 rounded border border-slate-300 text-xs bg-white">
              <option value="active">Active (excl. won/lost)</option>
              <option value="all">All</option>
              {Object.entries(GTM_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Priority</span>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)} className="px-2 py-1.5 rounded border border-slate-300 text-xs bg-white">
              <option value="all">All</option>
              {Object.entries(GTM_PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Assignee</span>
            <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className="px-2 py-1.5 rounded border border-slate-300 text-xs bg-white">
              <option value="">All</option>
              {assigneeOptions.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
          <span className="ml-auto text-slate-500">{filtered.length} of {accounts.length}</span>
        </div>
      </Card>

      {/* List */}
      {loading && accounts.length === 0 ? (
        <div className="text-center text-slate-500 py-10 text-sm"><Loader2 className="inline w-3 h-3 animate-spin mr-1" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center text-slate-400 py-10 text-sm italic">
          {accounts.length === 0 ? 'No strategic accounts yet. Click "Add strategic account" to start.' : 'No accounts match the current filters.'}
        </div>
      ) : (
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Account</th>
                  <th className="text-left px-3 py-2">Assignee</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Priority</th>
                  <th className="text-left px-3 py-2">Next step</th>
                  <th className="text-right px-3 py-2">Est. Value</th>
                  <th className="text-left px-3 py-2">Partnership</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => <GtmRow key={a.id} account={a} onOpen={() => setOpenId(a.id)} />)}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Add drawer */}
      {addOpen && (
        <Drawer open onClose={() => setAddOpen(false)} title="Add strategic account" width="max-w-md">
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Account name</label>
              <input type="text" value={addName} onChange={(e) => setAddName(e.target.value)} autoFocus placeholder="e.g. Slalom, Deloitte Digital, Publicis Sapient" className="mt-1 w-full px-3 py-2 rounded border border-slate-300 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Assignee (owner)</label>
              <input type="email" value={addAssignee} onChange={(e) => setAddAssignee(e.target.value)} placeholder="owner@simpliigence.com" className="mt-1 w-full px-3 py-2 rounded border border-slate-300 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">Priority</label>
              <select value={addPriority} onChange={(e) => setAddPriority(e.target.value as GtmPriority)} className="mt-1 w-full px-3 py-2 rounded border border-slate-300 text-sm bg-white">
                {Object.entries(GTM_PRIORITY_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5 flex items-center gap-1"><AlertTriangle size={11} /> {err}</div>}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
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

/* ── Row ── */
function GtmRow({ account, onOpen }: { account: GtmAccount; onOpen: () => void }) {
  const statusMeta = GTM_STATUS_META[account.status];
  const prMeta = GTM_PRIORITY_META[account.priority];
  const dU = daysUntil(account.nextStepDate);
  const dueCls = dU == null ? 'text-slate-500' : dU < 0 ? 'text-rose-700 font-semibold' : dU <= 3 ? 'text-amber-700' : 'text-slate-600';
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={onOpen}>
      <td className="px-3 py-2">
        <div className="font-semibold text-slate-900">{account.name}</div>
        <div className="text-[11px] text-slate-500 truncate max-w-xs">{[account.industry, account.geo, account.segment].filter(Boolean).join(' · ') || '—'}</div>
      </td>
      <td className="px-3 py-2 text-xs text-slate-700">{account.assigneeEmail || <span className="text-slate-400 italic">unassigned</span>}</td>
      <td className="px-3 py-2"><Badge className={statusMeta.cls}>{statusMeta.label}</Badge></td>
      <td className="px-3 py-2"><span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded border ${prMeta.cls}`}><span className={`w-1.5 h-1.5 rounded-full ${prMeta.dot}`} /> {prMeta.label}</span></td>
      <td className="px-3 py-2">
        <div className={`text-xs ${dueCls}`}>{account.nextStepDate ? fmtDate(account.nextStepDate) : '—'}</div>
        <div className="text-[11px] text-slate-600 truncate max-w-xs">{account.nextStep || <span className="text-slate-400 italic">no next step</span>}</div>
      </td>
      <td className="px-3 py-2 text-right text-xs font-semibold text-slate-800 tabular-nums">{fmtUsdCompact(account.estimatedAnnualValueUsd)}</td>
      <td className="px-3 py-2 text-xs text-slate-700">{account.partnershipType || <span className="text-slate-400 italic">—</span>}</td>
    </tr>
  );
}

/* ── Drawer ── */
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
      <div className="flex items-center gap-1 border-b border-slate-200 mb-4 -mt-2 overflow-x-auto">
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
              tab === t.key ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'
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

      {tab === 'plan' && <PlanEditor account={account} update={update} directoryEmails={directoryEmails} />}
      {tab === 'contacts' && <ContactsEditor accountId={account.id} contacts={contacts} directoryEmails={directoryEmails} />}
      {tab === 'actions' && <ActionsEditor accountId={account.id} actions={actions} directoryEmails={directoryEmails} />}
    </Drawer>
  );
}

/* ── Plan tab ── */
function PlanEditor({ account, update, directoryEmails }: { account: GtmAccount; update: (id: string, patch: Partial<GtmAccount>) => Promise<void>; directoryEmails: string[] }) {
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
      <FieldTextarea label="Notes" value={account.notes ?? ''} rows={4} onCommit={(v) => setField('notes', v || null)} />
    </div>
  );
}

/* ── Contacts tab ── */
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
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
        <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1"><Users size={11} /> Add contact</div>
        <div className="grid grid-cols-3 gap-2">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name *" className="px-2 py-1.5 rounded border border-slate-300 text-sm" />
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (e.g. VP Alliances)" className="px-2 py-1.5 rounded border border-slate-300 text-sm" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@company.com" className="px-2 py-1.5 rounded border border-slate-300 text-sm" />
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
        <div className="text-center text-slate-400 italic text-sm py-6">No contacts yet.</div>
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
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2 items-start">
        <input type="text" value={contact.name} onChange={(e) => onChange(contact.id, { name: e.target.value })} className="md:col-span-2 text-sm font-semibold text-slate-900 px-1 py-1 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50" />
        <input type="text" value={contact.title ?? ''} onChange={(e) => onChange(contact.id, { title: e.target.value || null })} placeholder="Title" className="md:col-span-2 text-xs text-slate-700 px-1 py-1 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50" />
        <input type="date" value={contact.lastTouched ?? ''} onChange={(e) => onChange(contact.id, { lastTouched: e.target.value || null })} title="Last touched" className="text-xs text-slate-600 px-1 py-1 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50" />
        <button type="button" onClick={() => { if (confirm(`Remove ${contact.name}?`)) void onRemove(contact.id); }} className="text-slate-400 hover:text-rose-600 justify-self-end p-1" title="Remove"><Trash2 size={13} /></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1.5">
        <label className="flex items-center gap-1 text-[11px] text-slate-600">
          <Mail size={10} className="text-slate-400" />
          <input type="email" value={contact.email ?? ''} onChange={(e) => onChange(contact.id, { email: e.target.value || null })} placeholder="email@…" className="flex-1 px-1 py-0.5 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50" />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-slate-600">
          <Phone size={10} className="text-slate-400" />
          <input type="tel" value={contact.phone ?? ''} onChange={(e) => onChange(contact.id, { phone: e.target.value || null })} placeholder="+1…" className="flex-1 px-1 py-0.5 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50" />
        </label>
        <label className="flex items-center gap-1 text-[11px] text-slate-600">
          <LinkIcon size={10} className="text-slate-400" />
          <input type="url" value={contact.linkedinUrl ?? ''} onChange={(e) => onChange(contact.id, { linkedinUrl: e.target.value || null })} placeholder="linkedin.com/in/…" className="flex-1 px-1 py-0.5 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50" />
          {contact.linkedinUrl && <a href={contact.linkedinUrl} target="_blank" rel="noopener" className="text-slate-400 hover:text-sky-600"><ExternalLink size={10} /></a>}
        </label>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1.5">
        <label className="flex items-center gap-1 text-[11px] text-slate-600 md:col-span-1">
          <User size={10} className="text-slate-400" />
          <input type="email" value={contact.relationshipOwner ?? ''} onChange={(e) => onChange(contact.id, { relationshipOwner: e.target.value || null })} placeholder="owner@simpliigence.com" list={`owners-${contact.id}`} className="flex-1 px-1 py-0.5 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50" />
          <datalist id={`owners-${contact.id}`}>{directoryEmails.map((e) => <option key={e} value={e} />)}</datalist>
        </label>
        <input type="text" value={contact.notes ?? ''} onChange={(e) => onChange(contact.id, { notes: e.target.value || null })} placeholder="Notes / relationship context" className="md:col-span-2 text-[11px] text-slate-600 px-1 py-0.5 rounded border border-slate-200 focus:border-slate-300 focus:outline-none" />
      </div>
      {ownerProfile?.fullName && <div className="text-[10px] text-slate-400 mt-1">Owned internally by {ownerProfile.fullName}</div>}
    </li>
  );
}

/* ── Actions tab ── */
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
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
        <div className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider flex items-center gap-1"><ClipboardCheck size={11} /> Add action</div>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Action title (e.g. Reach out to VP Alliances at Slalom)" className="w-full px-3 py-1.5 rounded border border-slate-300 text-sm" />
        <div className="grid grid-cols-2 gap-2">
          <input type="email" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="assignee@simpliigence.com" list="assignees-add" className="px-2 py-1.5 rounded border border-slate-300 text-xs" />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="px-2 py-1.5 rounded border border-slate-300 text-xs" />
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
        <div className="text-center text-slate-400 italic text-sm py-6">No actions yet.</div>
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
    <li className="rounded-lg border border-slate-200 bg-white p-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={action.status} onChange={(e) => onChange(action.id, { status: e.target.value as GtmActionStatus })} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-pointer ${meta.cls}`}>
          {Object.entries(GTM_ACTION_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input type="text" value={action.title} onChange={(e) => onChange(action.id, { title: e.target.value })} className={`text-sm font-semibold text-slate-900 flex-1 min-w-[200px] px-1 py-0.5 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50 ${action.status === 'done' ? 'line-through text-slate-400' : ''}`} />
        <div className="flex items-center gap-1 text-[11px] text-slate-600">
          <User size={11} className="text-slate-400" />
          <input type="email" value={action.assigneeEmail ?? ''} onChange={(e) => onChange(action.id, { assigneeEmail: e.target.value || null })} placeholder="unassigned" list={`aa-${action.id}`} className="px-1 py-0.5 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50 w-40" />
          <datalist id={`aa-${action.id}`}>{directoryEmails.map((e) => <option key={e} value={e} />)}</datalist>
        </div>
        <div className={`flex items-center gap-1 text-[11px] ${isOverdue ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>
          <Calendar size={11} className={isOverdue ? 'text-rose-500' : 'text-slate-400'} />
          <input type="date" value={action.dueDate ?? ''} onChange={(e) => onChange(action.id, { dueDate: e.target.value || null })} className="px-1 py-0.5 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50" />
        </div>
        <button type="button" onClick={() => { if (confirm(`Delete "${action.title}"?`)) void onRemove(action.id); }} className="text-slate-400 hover:text-rose-600 p-1" title="Remove"><Trash2 size={13} /></button>
      </div>
      {(action.description || action.completedAt) && (
        <details className="mt-1 pl-1">
          <summary className="text-[10px] text-slate-400 cursor-pointer inline-flex items-center gap-0.5 select-none"><ChevronDown size={9} /> details</summary>
          {action.description && <div className="text-[11px] text-slate-600 mt-1 pl-3 whitespace-pre-wrap">{action.description}</div>}
          {action.completedAt && <div className="text-[10px] text-emerald-600 mt-0.5 pl-3">Completed {fmtDate(action.completedAt)}</div>}
        </details>
      )}
    </li>
  );
}

/* ── Small field primitives (commit-on-blur) ── */
function FieldText({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</span>
      <input type="text" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} placeholder={placeholder} className="mt-0.5 w-full px-2 py-1.5 rounded border border-slate-300 text-sm" />
    </label>
  );
}
function FieldTextarea({ label, value, onCommit, rows = 3, placeholder }: { label: string; value: string; onCommit: (v: string) => void; rows?: number; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</span>
      <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} rows={rows} placeholder={placeholder} className="mt-0.5 w-full px-2 py-1.5 rounded border border-slate-300 text-sm" />
    </label>
  );
}
function FieldNumber({ label, value, onCommit }: { label: string; value: number | null; onCommit: (v: number | null) => void }) {
  const [v, setV] = useState<string>(value == null ? '' : String(value));
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</span>
      <input type="number" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => {
        const parsed = v === '' ? null : Number(v);
        if (parsed !== value) onCommit(parsed);
      }} className="mt-0.5 w-full px-2 py-1.5 rounded border border-slate-300 text-sm" />
    </label>
  );
}
function FieldDate({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</span>
      <input type="date" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} className="mt-0.5 w-full px-2 py-1.5 rounded border border-slate-300 text-sm" />
    </label>
  );
}
function FieldEmail({ label, value, onCommit, suggestions }: { label: string; value: string; onCommit: (v: string) => void; suggestions: string[] }) {
  const [v, setV] = useState(value);
  const id = `dl-${label.toLowerCase().replace(/\s+/g, '-')}`;
  useEffect(() => { setV(value); }, [value]);
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</span>
      <input type="email" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} list={id} className="mt-0.5 w-full px-2 py-1.5 rounded border border-slate-300 text-sm" />
      <datalist id={id}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
    </label>
  );
}
function FieldSelect<T extends string>({ label, value, options, renderOption, onCommit }: { label: string; value: T | ''; options: readonly (T | '')[]; renderOption?: (v: T) => string; onCommit: (v: string) => void }): JSX.Element {
  return (
    <label className="block">
      <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{label}</span>
      <select value={value} onChange={(e) => onCommit(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 rounded border border-slate-300 text-sm bg-white">
        {options.map((o) => <option key={o} value={o}>{o === '' ? '—' : (renderOption ? renderOption(o as T) : o)}</option>)}
      </select>
    </label>
  );
}
