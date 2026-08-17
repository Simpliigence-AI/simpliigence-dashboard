/**
 * USStaffingSplitView — opt-in view mode for the Global Demand page that
 * kills the horizontal scroll:
 *
 *   ┌──────────────────────────┬──────────────────────────┐
 *   │ Left: 4-col compact list │ Right: full detail form  │
 *   │  Account · Role · Stage  │  For the selected req    │
 *   │  · AI Prob               │  (all 6 fields, labeled) │
 *   └──────────────────────────┴──────────────────────────┘
 *
 * Left rail groups reqs under their account with a colored badge banner
 * (MSP / SI). Rows sorted by AI probability desc within each account.
 * Click a row to select it — the right pane swaps to show that req's
 * editable form. Empty state on the right when nothing is selected.
 *
 * All edits go through `onSave(field, value)` so the parent decides how
 * to persist (in USStaffingPage today, it maps straight to
 * updateRequisition). No new store logic here.
 */
import { useMemo, useState } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Building2, Trash2, ArrowRight, Filter } from 'lucide-react';
import type { USStaffingAccount, USStaffingRequisition, USStaffingStage } from '../../types/usStaffing';
import { US_STAGE_COLORS } from '../../types/usStaffing';
import { Card } from '../../components/ui';

const INPUT_CLS = 'w-full px-3 py-2 rounded-lg border border-line text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary';
const Input = ({ className = '', ...p }: InputHTMLAttributes<HTMLInputElement>) =>
  <input className={`${INPUT_CLS} ${className}`} {...p} />;
const Select = ({ className = '', children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) =>
  <select className={`${INPUT_CLS} bg-white ${className}`} {...p}>{children}</select>;
const Textarea = ({ className = '', ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea className={`${INPUT_CLS} ${className}`} {...p} />;

const ALL_STAGES: USStaffingStage[] = [
  'New', 'Sourcing', 'Profiles Shared', 'Interview', 'Shortlisted',
  'Client Round', 'Closed/Selected', 'Onboarding', 'On Hold', 'Cancelled',
];

interface Props {
  reqs: (USStaffingRequisition & { _score?: number })[];
  accounts: USStaffingAccount[];
  /** Called when any field on a requisition is edited in the right pane. */
  onSave: (id: string, field: keyof USStaffingRequisition, val: string | number) => void;
  onDelete: (id: string) => void;
}

/** Ageing in days from initiation_date to today. Empty init date → 0. */
function ageingDays(initISO: string): number {
  if (!initISO) return 0;
  const t = new Date(initISO + 'T00:00:00').getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 86400000));
}

function ageingColor(days: number): string {
  if (days >= 45) return '#ef4444';
  if (days >= 21) return '#f59e0b';
  return '#94a3b8';
}

export function USStaffingSplitView({ reqs, accounts, onSave, onDelete }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(reqs[0]?.id ?? null);
  const [filter, setFilter] = useState('');
  const [stageFilter, setStageFilter] = useState<'All' | USStaffingStage>('All');

  const acctById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a] as const)),
    [accounts],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return reqs.filter((r) => {
      if (stageFilter !== 'All' && r.stage !== stageFilter) return false;
      if (!q) return true;
      const acct = acctById.get(r.account_id);
      return (
        r.role.toLowerCase().includes(q)
        || (acct?.name || '').toLowerCase().includes(q)
        || (r.notes || '').toLowerCase().includes(q)
      );
    });
  }, [reqs, filter, stageFilter, acctById]);

  const grouped = useMemo(() => {
    const byAccount = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const list = byAccount.get(r.account_id) || [];
      list.push(r);
      byAccount.set(r.account_id, list);
    }
    return Array.from(byAccount.entries())
      .map(([accountId, group]) => ({
        account: acctById.get(accountId)!,
        reqs: [...group].sort((a, b) => (b._score ?? 0) - (a._score ?? 0)),
      }))
      .filter((g) => g.account)
      .sort((a, b) => a.account.name.localeCompare(b.account.name));
  }, [filtered, acctById]);

  const selected = reqs.find((r) => r.id === selectedId) || null;
  const selectedAcct = selected ? acctById.get(selected.account_id) : null;

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* LEFT RAIL */}
      <Card className="col-span-12 lg:col-span-5 xl:col-span-4 p-0 overflow-hidden">
        <div className="p-3 border-b border-line/60 flex items-center gap-2">
          <div className="relative flex-1">
            <Filter size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted/70" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by role, account, notes…"
              className="pl-8 py-1.5 text-xs"
            />
          </div>
          <Select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value as 'All' | USStaffingStage)}
            className="py-1.5 text-xs w-32"
          >
            <option value="All">All stages</option>
            {ALL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
          {grouped.length === 0 ? (
            <p className="text-center text-muted/70 text-xs py-8">No requisitions match your filter.</p>
          ) : grouped.map(({ account, reqs: acctReqs }) => (
            <div key={account.id} className="border-b border-line/60 last:border-0">
              <div className="sticky top-0 z-10 bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50 border-b border-blue-100 px-3 py-1.5 flex items-center gap-2">
                <Building2 size={12} className="text-primary flex-shrink-0" />
                <span className="text-xs font-bold text-ink flex-1 truncate">{account.name}</span>
                <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                  account.category === 'MSP' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                }`}>
                  {account.category}
                </span>
                <span className="text-[9px] text-muted font-semibold">{acctReqs.length}</span>
              </div>
              {acctReqs.map((r) => {
                const active = r.id === selectedId;
                const age = ageingDays(r.initiation_date);
                const score = r._score ?? 0;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className={`w-full text-left px-3 py-2 border-b border-line/40 last:border-0 transition-colors ${
                      active ? 'bg-primary/10 border-l-[3px] border-l-primary' : 'hover:bg-surface-2/70'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 min-w-0 truncate text-xs font-semibold text-ink">
                        {r.role || <span className="italic text-muted/70">Untitled role</span>}
                      </span>
                      <span
                        className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full whitespace-nowrap"
                        style={{ background: US_STAGE_COLORS[r.stage as USStaffingStage] || '#94a3b8' }}
                      >
                        {r.stage}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: ageingColor(age) }} />
                        {age}d old
                      </span>
                      {score > 0 && (
                        <>
                          <span className="text-line">·</span>
                          <span className={score >= 65 ? 'text-emerald-600 font-semibold' : score >= 40 ? 'text-amber-600' : 'text-muted'}>
                            {score}% AI
                          </span>
                        </>
                      )}
                      {r.closure_date && (
                        <>
                          <span className="text-line">·</span>
                          <span>close {r.closure_date}</span>
                        </>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </Card>

      {/* RIGHT PANE */}
      <Card className="col-span-12 lg:col-span-7 xl:col-span-8">
        {!selected || !selectedAcct ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ArrowRight size={28} className="text-line -rotate-180 mb-3" />
            <h3 className="text-sm font-semibold text-ink/80">Pick a requisition</h3>
            <p className="text-xs text-muted mt-1 max-w-xs">
              Select a role on the left to see and edit its full detail here.
              No more horizontal scrolling.
            </p>
          </div>
        ) : (
          <>
            <header className="pb-3 mb-4 border-b border-line/60 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
                <Building2 size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-extrabold text-ink tracking-tight truncate">{selectedAcct.name}</div>
                <div className="text-xs text-muted">
                  {selected.role || <span className="italic">Untitled role</span>}
                  {' · '}
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                    selectedAcct.category === 'MSP' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                  }`}>
                    {selectedAcct.category}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${selected.role}"?`)) {
                    onDelete(selected.id);
                    setSelectedId(null);
                  }
                }}
                className="text-muted/70 hover:text-rose-600 p-1.5 hover:bg-rose-50 rounded"
                title="Delete requisition"
              >
                <Trash2 size={14} />
              </button>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Role</label>
                <Input
                  value={selected.role}
                  onChange={(e) => onSave(selected.id, 'role', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Stage</label>
                <Select
                  value={selected.stage}
                  onChange={(e) => onSave(selected.id, 'stage', e.target.value)}
                  className="mt-1"
                >
                  {ALL_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Initiation Date</label>
                <Input
                  type="date"
                  value={selected.initiation_date || ''}
                  onChange={(e) => onSave(selected.id, 'initiation_date', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Closure Date</label>
                <Input
                  type="date"
                  value={selected.closure_date || ''}
                  onChange={(e) => onSave(selected.id, 'closure_date', e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Notes</label>
                <Textarea
                  rows={5}
                  value={selected.notes || ''}
                  onChange={(e) => onSave(selected.id, 'notes', e.target.value)}
                  placeholder="Latest client feedback, submitted candidates, blockers…"
                  className="mt-1"
                />
              </div>
              <div className="md:col-span-2 flex items-center gap-3 pt-2 border-t border-line/60 text-[11px] text-muted">
                <span>Ageing: <strong className="text-ink/80">{ageingDays(selected.initiation_date)} d</strong></span>
                {selected._score != null && (
                  <>
                    <span className="text-line">·</span>
                    <span>AI Probability: <strong className="text-ink/80">{selected._score}%</strong></span>
                  </>
                )}
                <span className="text-line">·</span>
                <span>Updated {new Date(selected.updated_at).toLocaleDateString()}</span>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
