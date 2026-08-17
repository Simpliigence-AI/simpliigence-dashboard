/**
 * IndiaStaffingSplitView — opt-in view mode for the India Demand page that
 * mirrors the split-view built for Global Demand.
 *
 * Left rail: compact per-account groups → per-requisition rows showing
 * Title · Status · Ageing · AI Prob. All the info you need to triage
 * without horizontal scrolling.
 *
 * Right pane: labeled form for the selected requisition — Title, Status,
 * Positions, Start/Close dates, Client SPOC, Department, Anticipation
 * notes, manual Probability. Every edit routes back through `onSave`
 * which maps to the parent's `updateRequisition`.
 */
import { useMemo, useState } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Building2, Trash2, ArrowRight, Filter } from 'lucide-react';
import type { StaffingRow, StaffingStatus } from '../../types/staffing';
import { Card } from '../../components/ui';

const STATUS_OPTIONS: StaffingStatus[] = ['Open', 'In Progress', 'On Hold', 'Closed Won', 'Closed Lost', 'Cancelled'];

const INPUT_CLS = 'w-full px-3 py-2 rounded-lg border border-line text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary';
const Input = ({ className = '', ...p }: InputHTMLAttributes<HTMLInputElement>) =>
  <input className={`${INPUT_CLS} ${className}`} {...p} />;
const Select = ({ className = '', children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) =>
  <select className={`${INPUT_CLS} bg-white ${className}`} {...p}>{children}</select>;
const Textarea = ({ className = '', ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea className={`${INPUT_CLS} ${className}`} {...p} />;

const ALL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STATUS_COLORS: Record<string, string> = {
  Open: '#10b981', 'In Progress': '#3b82f6', 'On Hold': '#f97316',
  'Closed Won': '#22c55e', 'Closed Lost': '#ef4444', Cancelled: '#94a3b8',
};

interface Props {
  /** All active (non-archived) rows to render on the left rail. */
  rows: StaffingRow[];
  /** Called when any field on a requisition is edited. */
  onSave: (id: string, field: string, val: string | number) => void;
  onDelete: (id: string) => void;
}

export function IndiaStaffingSplitView({ rows, onSave, onDelete }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | StaffingStatus>('All');

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'All' && r.statusField !== statusFilter) return false;
      if (!q) return true;
      return (
        r.requisition.toLowerCase().includes(q)
        || r.account.toLowerCase().includes(q)
        || (r.anticipation || '').toLowerCase().includes(q)
        || (r.clientSpoc || '').toLowerCase().includes(q)
      );
    });
  }, [rows, filter, statusFilter]);

  const grouped = useMemo(() => {
    const byAcct = new Map<string, StaffingRow[]>();
    for (const r of filtered) {
      const list = byAcct.get(r.account) || [];
      list.push(r);
      byAcct.set(r.account, list);
    }
    return Array.from(byAcct.entries())
      .map(([account, group]) => ({
        account,
        rows: [...group].sort((a, b) => b.aiProbability - a.aiProbability),
      }))
      .sort((a, b) => a.account.localeCompare(b.account));
  }, [filtered]);

  const selected = rows.find((r) => r.id === selectedId) || null;

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
              placeholder="Filter title, account, SPOC…"
              className="pl-8 py-1.5 text-xs"
            />
          </div>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'All' | StaffingStatus)}
            className="py-1.5 text-xs w-32"
          >
            <option value="All">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
        <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
          {grouped.length === 0 ? (
            <p className="text-center text-muted/70 text-xs py-8">No requisitions match your filter.</p>
          ) : grouped.map(({ account, rows: acctRows }) => (
            <div key={account} className="border-b border-line/60 last:border-0">
              <div className="sticky top-0 z-10 bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50 border-b border-blue-100 px-3 py-1.5 flex items-center gap-2">
                <Building2 size={12} className="text-primary flex-shrink-0" />
                <span className="text-xs font-bold text-ink flex-1 truncate">{account}</span>
                <span className="text-[9px] text-muted font-semibold">{acctRows.length} · {acctRows.reduce((s, r) => s + r.openPositions, 0)} open</span>
              </div>
              {acctRows.map((r) => {
                const active = r.id === selectedId;
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
                        {r.requisition || <span className="italic text-muted/70">Untitled req</span>}
                      </span>
                      <span
                        className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded-full whitespace-nowrap"
                        style={{ background: STATUS_COLORS[r.statusField] || '#94a3b8' }}
                      >
                        {r.statusField}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-muted">
                      <span>{r.openPositions} open</span>
                      {r.ageing > 0 && (
                        <>
                          <span className="text-line">·</span>
                          <span className={r.ageing >= 45 ? 'text-rose-600' : r.ageing >= 21 ? 'text-amber-600' : 'text-muted'}>
                            {r.ageing}d
                          </span>
                        </>
                      )}
                      {r.aiProbability > 0 && (
                        <>
                          <span className="text-line">·</span>
                          <span className={r.aiProbability >= 65 ? 'text-emerald-600 font-semibold' : r.aiProbability >= 40 ? 'text-amber-600' : 'text-muted'}>
                            {r.aiProbability}% AI
                          </span>
                        </>
                      )}
                      {r.month && (
                        <>
                          <span className="text-line">·</span>
                          <span>{r.month}</span>
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
        {!selected ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ArrowRight size={28} className="text-line -rotate-180 mb-3" />
            <h3 className="text-sm font-semibold text-ink/80">Pick a requisition</h3>
            <p className="text-xs text-muted mt-1 max-w-xs">
              Select a role on the left to see and edit its full detail here. No more horizontal scrolling.
            </p>
          </div>
        ) : (
          <>
            <header className="pb-3 mb-4 border-b border-line/60 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center flex-shrink-0">
                <Building2 size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-extrabold text-ink tracking-tight truncate">{selected.account}</div>
                <div className="text-xs text-muted truncate">
                  {selected.requisition || <span className="italic">Untitled req</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete "${selected.requisition}"?`)) {
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
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Requisition Title</label>
                <Input value={selected.requisition} onChange={(e) => onSave(selected.id, 'title', e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Status</label>
                <Select value={selected.statusField} onChange={(e) => onSave(selected.id, 'status_field', e.target.value)} className="mt-1">
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Month</label>
                <Select value={selected.month} onChange={(e) => onSave(selected.id, 'month', e.target.value)} className="mt-1">
                  {ALL_MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Positions</label>
                <Input type="number" min={1} value={selected.newPositions} onChange={(e) => onSave(selected.id, 'new_positions', Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Prob % (manual, blank = AI)</label>
                <Input type="number" min={0} max={100} value={selected.probability || ''} onChange={(e) => onSave(selected.id, 'probability', e.target.value === '' ? 0 : Number(e.target.value))} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Start Date</label>
                <Input type="date" value={selected.startDate || ''} onChange={(e) => onSave(selected.id, 'start_date', e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Close-by Date</label>
                <Input type="date" value={selected.closeByDate || ''} onChange={(e) => onSave(selected.id, 'close_by_date', e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Client SPOC</label>
                <Input value={selected.clientSpoc} onChange={(e) => onSave(selected.id, 'client_spoc', e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Department</label>
                <Input value={selected.department} onChange={(e) => onSave(selected.id, 'department', e.target.value)} className="mt-1" />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Anticipation / Notes</label>
                <Textarea rows={5} value={selected.anticipation || ''} onChange={(e) => onSave(selected.id, 'anticipation', e.target.value)} placeholder="Latest status, client feedback, blockers…" className="mt-1" />
              </div>
              <div className="md:col-span-2 flex items-center gap-3 pt-2 border-t border-line/60 text-[11px] text-muted flex-wrap">
                <span>Open: <strong className="text-ink/80">{selected.openPositions}</strong> of {selected.newPositions}</span>
                <span className="text-line">·</span>
                <span>Ageing: <strong className="text-ink/80">{selected.ageing} d</strong></span>
                <span className="text-line">·</span>
                <span>AI Prob: <strong className="text-ink/80">{selected.aiProbability}%</strong></span>
                <span className="text-line">·</span>
                <span>Risk: <strong className="text-ink/80 capitalize">{selected.risk}</strong></span>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
