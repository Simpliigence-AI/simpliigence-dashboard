/**
 * AccountOpportunitiesTab
 *
 * The account-drawer tab that owns the upsell / cross-sell backlog. Each
 * row is a one-liner action item with:
 *   - title
 *   - kind badge (upsell / cross-sell)
 *   - assignee (owner)
 *   - due date (when the follow-up should happen)
 *   - status (open / in_progress / won / lost / dropped)
 *
 * Populated two ways:
 *   1. Manually via "+ Add opportunity" — quick inline row.
 *   2. Promoted from AI-suggested opps in the current profile — a chip
 *      per suggestion with a one-click "Promote" button. Once promoted,
 *      the chip hides so we don't duplicate.
 *
 * Detail (rationale, cloud, $ estimate) still lives in the AI Profile
 * tab per user request — this tab is intentionally lean.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, User, Calendar, TrendingUp, ArrowUpRight, Sparkles, Loader2, AlertTriangle, ChevronDown } from 'lucide-react';
import { Button } from '../../components/ui';
import type { UpsellBacklogItem, UpsellKind, UpsellStatus } from '../../types/concierge';
import { UPSELL_STATUS_META } from '../../types/concierge';
import { useUpsellBacklogStore } from '../../store/useUpsellBacklogStore';
import { useAccountDocsStore } from '../../store/useAccountDocsStore';
import { useAuthStore } from '../../store/useAuthStore';

interface Props { accountId: string }

const KIND_META: Record<UpsellKind, { label: string; cls: string; Icon: typeof TrendingUp }> = {
  upsell:     { label: 'Upsell',     cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', Icon: TrendingUp },
  cross_sell: { label: 'Cross-sell', cls: 'bg-sky-50 text-sky-800 border-sky-200',           Icon: ArrowUpRight },
};

export function AccountOpportunitiesTab({ accountId }: Props) {
  const items = useUpsellBacklogStore((s) => s.itemsByAccount[accountId] ?? []);
  const loading = useUpsellBacklogStore((s) => s.loadingByAccount[accountId] ?? false);
  const load = useUpsellBacklogStore((s) => s.loadForAccount);
  const add = useUpsellBacklogStore((s) => s.add);
  const update = useUpsellBacklogStore((s) => s.update);
  const remove = useUpsellBacklogStore((s) => s.remove);
  const hasPromoted = useUpsellBacklogStore((s) => s.hasPromoted);
  const profile = useAccountDocsStore((s) => s.profileByAccount[accountId]);
  const loadDocs = useAccountDocsStore((s) => s.loadForAccount);
  const currentUser = useAuthStore((s) => s.currentUser);
  const directory = useAuthStore((s) => s.directory);

  useEffect(() => { void load(accountId); void loadDocs(accountId); }, [accountId, load, loadDocs]);

  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState('');
  const [addKind, setAddKind] = useState<UpsellKind>('upsell');
  const [addAssignee, setAddAssignee] = useState('');
  const [addDue, setAddDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<UpsellStatus | 'all'>('all');

  const filteredItems = useMemo(() => {
    if (statusFilter === 'all') return items;
    return items.filter((x) => x.status === statusFilter);
  }, [items, statusFilter]);

  const openCount = items.filter((x) => x.status === 'open' || x.status === 'in_progress').length;
  const wonCount = items.filter((x) => x.status === 'won').length;

  const aiOpps = useMemo(() => {
    if (!profile) return [];
    return [
      ...(profile.upsellOpportunities ?? []).map((o) => ({ ...o, kind: 'upsell' as UpsellKind })),
      ...(profile.crossSellOpportunities ?? []).map((o) => ({ ...o, kind: 'cross_sell' as UpsellKind })),
    ].filter((o) => o.title && !hasPromoted(accountId, o.title));
  }, [profile, accountId, hasPromoted]);

  async function submitAdd() {
    if (!addTitle.trim()) return;
    setBusy(true); setError(null);
    try {
      await add({
        accountId,
        title: addTitle.trim(),
        kind: addKind,
        source: 'manual',
        assigneeEmail: addAssignee.trim() || null,
        dueDate: addDue || null,
        createdBy: currentUser?.email ?? null,
      });
      setAddTitle(''); setAddAssignee(''); setAddDue(''); setShowAdd(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function promote(opp: { title: string; cloud?: string; rationale?: string; upsell_estimate_usd?: number; kind: UpsellKind }) {
    setBusy(true); setError(null);
    try {
      await add({
        accountId,
        title: opp.title,
        kind: opp.kind,
        source: 'ai_profile',
        sourceRef: opp.title,
        cloud: opp.cloud ?? null,
        rationale: opp.rationale ?? null,
        estimatedValueUsd: opp.upsell_estimate_usd ?? null,
        createdBy: currentUser?.email ?? null,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const directoryEmails = useMemo(() => Object.keys(directory).sort(), [directory]);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Active" value={openCount} cls="bg-sky-50 border-sky-200 text-sky-800" />
        <MiniStat label="Won" value={wonCount} cls="bg-emerald-50 border-emerald-200 text-emerald-800" />
        <MiniStat label="AI Suggestions" value={aiOpps.length} cls="bg-purple-50 border-purple-200 text-purple-800" />
      </div>

      {/* AI-suggested opportunities to promote */}
      {aiOpps.length > 0 && (
        <section className="rounded-lg border border-purple-200 bg-purple-50/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-bold text-purple-800 uppercase tracking-wider flex items-center gap-1">
              <Sparkles size={11} /> AI-suggested — click to promote
            </h4>
            <span className="text-[10px] text-slate-500">Details visible in AI Profile tab</span>
          </div>
          <ul className="space-y-1.5">
            {aiOpps.map((o, i) => {
              const M = KIND_META[o.kind];
              return (
                <li key={i} className="flex items-center gap-2 rounded bg-white border border-purple-100 px-2.5 py-1.5">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${M.cls}`}>
                    <M.Icon size={9} /> {M.label}
                  </span>
                  <span className="text-xs text-slate-800 flex-1 min-w-0 truncate" title={o.rationale}>{o.title}</span>
                  {o.upsell_estimate_usd ? (
                    <span className="text-[10px] text-amber-700 font-medium">${o.upsell_estimate_usd.toLocaleString()}/yr</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => promote(o)}
                    disabled={busy}
                    className="text-[11px] font-medium px-2 py-0.5 rounded bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex-shrink-0"
                    title="Add to backlog"
                  >
                    Promote
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="primary" size="sm" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="w-3 h-3" /><span className="ml-1">Add opportunity</span>
        </Button>
        <div className="ml-auto flex items-center gap-1 text-[11px]">
          <span className="text-slate-500 mr-1">Filter:</span>
          {(['all', 'open', 'in_progress', 'won', 'lost', 'dropped'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-1.5 py-0.5 rounded border text-[10px] font-medium transition-colors ${
                statusFilter === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-400'
              }`}
            >
              {s === 'all' ? 'All' : UPSELL_STATUS_META[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <input
            type="text"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            placeholder="Opportunity title (one line) — e.g. Roll out Sales Cloud forecasting for the West region"
            className="w-full px-3 py-1.5 rounded border border-slate-300 text-sm"
            autoFocus
          />
          <div className="grid grid-cols-3 gap-2">
            <select
              value={addKind}
              onChange={(e) => setAddKind(e.target.value as UpsellKind)}
              className="px-2 py-1.5 rounded border border-slate-300 text-xs bg-white"
            >
              <option value="upsell">Upsell</option>
              <option value="cross_sell">Cross-sell</option>
            </select>
            <input
              type="email"
              value={addAssignee}
              onChange={(e) => setAddAssignee(e.target.value)}
              placeholder="assignee@simpliigence.com"
              className="px-2 py-1.5 rounded border border-slate-300 text-xs"
              list="assignee-suggestions"
            />
            <input
              type="date"
              value={addDue}
              onChange={(e) => setAddDue(e.target.value)}
              className="px-2 py-1.5 rounded border border-slate-300 text-xs"
            />
          </div>
          <datalist id="assignee-suggestions">
            {directoryEmails.map((e) => <option key={e} value={e} />)}
          </datalist>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={submitAdd} disabled={!addTitle.trim() || busy}>
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              <span className="ml-1">Add</span>
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </div>
      )}

      {/* List */}
      {loading && filteredItems.length === 0 ? (
        <div className="text-center text-slate-500 py-6 text-sm"><Loader2 className="inline w-3 h-3 animate-spin mr-1" /> Loading…</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center text-slate-400 py-6 text-sm italic">
          {items.length === 0
            ? 'No opportunities in the backlog yet. Add one above or promote an AI suggestion.'
            : `No ${statusFilter === 'all' ? '' : UPSELL_STATUS_META[statusFilter as UpsellStatus].label + ' '}items.`}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {filteredItems.map((it) => (
            <OpportunityRow key={it.id} item={it} onChange={update} onRemove={remove} directoryEmails={directoryEmails} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MiniStat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`rounded-lg border p-2 ${cls}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{label}</div>
      <div className="text-lg font-bold tabular-nums">{value}</div>
    </div>
  );
}

function OpportunityRow({
  item, onChange, onRemove, directoryEmails,
}: {
  item: UpsellBacklogItem;
  onChange: (id: string, patch: Partial<UpsellBacklogItem>) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  directoryEmails: string[];
}) {
  const M = KIND_META[item.kind];
  const statusMeta = UPSELL_STATUS_META[item.status];
  const isOverdue = item.dueDate && item.status !== 'won' && item.status !== 'lost' && item.status !== 'dropped'
    ? new Date(item.dueDate).getTime() < Date.now() - 24 * 3600 * 1000
    : false;

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-2.5 hover:border-slate-300 transition-colors">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Kind */}
        <select
          value={item.kind}
          onChange={(e) => onChange(item.id, { kind: e.target.value as UpsellKind })}
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-pointer flex-shrink-0 ${M.cls}`}
        >
          <option value="upsell">Upsell</option>
          <option value="cross_sell">Cross-sell</option>
        </select>

        {/* Title */}
        <input
          type="text"
          value={item.title}
          onChange={(e) => onChange(item.id, { title: e.target.value })}
          className="text-sm font-semibold text-slate-900 flex-1 min-w-[200px] px-1 py-0.5 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50"
        />

        {/* AI badge */}
        {item.source === 'ai_profile' && (
          <span title="Promoted from AI profile" className="inline-flex items-center gap-0.5 text-[9px] font-semibold text-purple-800 bg-purple-50 border border-purple-200 px-1 py-0.5 rounded">
            <Sparkles size={9} /> AI
          </span>
        )}

        {/* Assignee */}
        <div className="relative flex items-center gap-1 text-[11px]">
          <User size={11} className="text-slate-400" />
          <input
            type="email"
            value={item.assigneeEmail ?? ''}
            onChange={(e) => onChange(item.id, { assigneeEmail: e.target.value || null })}
            list={`assignees-${item.id}`}
            placeholder="unassigned"
            className="px-1 py-0.5 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50 w-40"
          />
          <datalist id={`assignees-${item.id}`}>
            {directoryEmails.map((e) => <option key={e} value={e} />)}
          </datalist>
        </div>

        {/* Due date */}
        <div className={`flex items-center gap-1 text-[11px] ${isOverdue ? 'text-rose-700 font-semibold' : 'text-slate-600'}`}>
          <Calendar size={11} className={isOverdue ? 'text-rose-500' : 'text-slate-400'} />
          <input
            type="date"
            value={item.dueDate ?? ''}
            onChange={(e) => onChange(item.id, { dueDate: e.target.value || null })}
            className="px-1 py-0.5 rounded border-transparent hover:border-slate-200 focus:border-slate-300 focus:outline-none focus:bg-slate-50"
          />
        </div>

        {/* Status */}
        <select
          value={item.status}
          onChange={(e) => onChange(item.id, { status: e.target.value as UpsellStatus })}
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border cursor-pointer ${statusMeta.cls}`}
        >
          {Object.entries(UPSELL_STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>

        {/* Delete */}
        <button
          type="button"
          onClick={() => { if (confirm('Remove this opportunity?')) void onRemove(item.id); }}
          className="text-slate-400 hover:text-rose-600 p-1 flex-shrink-0"
          title="Remove"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Optional rationale line — hidden by default, expandable */}
      {(item.rationale || item.notes) && (
        <details className="mt-1 pl-1">
          <summary className="text-[10px] text-slate-400 cursor-pointer inline-flex items-center gap-0.5 select-none">
            <ChevronDown size={9} /> details
          </summary>
          {item.rationale && <div className="text-[11px] text-slate-600 mt-1 pl-3">{item.rationale}</div>}
          {item.notes && <div className="text-[11px] text-slate-500 italic mt-0.5 pl-3">{item.notes}</div>}
        </details>
      )}
    </li>
  );
}
