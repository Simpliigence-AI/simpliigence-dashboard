/**
 * USRosterCardGrid — the "team page" view of Global Roster.
 *
 * Replaces the wide 12-column spreadsheet with a scannable card grid:
 *
 *   ┌────────────────────────────┐   ┌────────────────────────────┐
 *   │ [JD]  Jane Doe             │   │ [MS]  Mike Smith           │
 *   │       Sr. Developer  ● B   │   │       QA             ● PB  │
 *   │ ─────────────────────────  │   │ ─────────────────────────  │
 *   │ margin 42%  ·  $115/hr     │   │ margin —    ·  bench       │
 *   │ Dallas, TX  ·  H1B         │   │ Atlanta, GA · GC           │
 *   │ [React] [Node] [+3]        │   │ [Selenium] [Cypress]       │
 *   └────────────────────────────┘   └────────────────────────────┘
 *
 * Grouped by project (or Bench for unallocated). Each project header
 * shows headcount + monthly revenue + avg margin. Groups collapse-by-
 * default via the shared useCollapsedGroups hook.
 *
 * Click any card to open a full-detail drawer where every field is a
 * labeled form control — the same underlying handleCellSave the table
 * view uses.
 *
 * Filter + search + status chips remain at the top so the existing
 * "Proactive Bench count" story keeps working.
 */
import { useMemo, useState } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import {
  Building2, MapPin, X, Trash2, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { USRosterMember } from '../../types/usRoster';
import { US_ROSTER_STATUSES, US_ROSTER_STATUS_COLORS, calcUSMarginPercent as calcMarginPercent } from '../../types/usRoster';
import { ROSTER_ROLES } from '../../types/indiaRoster';
import type { VisaCategory } from '../../types/openBench';
import { Card } from '../../components/ui';
import { Sensitive } from '../../components/Sensitive';
import { useCollapsedGroups } from '../../lib/useCollapsedGroups';

const VISA_CATEGORIES: VisaCategory[] = ['H1B', 'L1', 'L2 EAD', 'H4 EAD', 'GC', 'GC EAD', 'US Citizen', 'OPT', 'CPT', 'TN', 'Other'];
const VISA_COLORS: Record<string, string> = {
  'H1B': '#3b82f6', 'L1': '#8b5cf6', 'L2 EAD': '#a78bfa', 'H4 EAD': '#c084fc',
  'GC': '#10b981', 'GC EAD': '#34d399', 'US Citizen': '#059669',
  'OPT': '#f59e0b', 'CPT': '#fbbf24', 'TN': '#06b6d4', 'Other': '#94a3b8',
};

const INPUT_CLS = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary';
const Input = ({ className = '', ...p }: InputHTMLAttributes<HTMLInputElement>) =>
  <input className={`${INPUT_CLS} ${className}`} {...p} />;
const Select = ({ className = '', children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) =>
  <select className={`${INPUT_CLS} bg-white ${className}`} {...p}>{children}</select>;
const Textarea = ({ className = '', ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
  <textarea className={`${INPUT_CLS} ${className}`} {...p} />;

interface Props {
  members: USRosterMember[];
  onSave: (id: string, field: keyof USRosterMember, val: string | number) => void;
  onDelete: (id: string) => void;
}

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function marginTone(pct: number): { fg: string; bg: string; label: string } {
  if (pct >= 50) return { fg: 'text-emerald-700', bg: 'bg-emerald-100', label: 'Healthy' };
  if (pct >= 30) return { fg: 'text-amber-700',   bg: 'bg-amber-100',   label: 'Watch' };
  if (pct > 0)   return { fg: 'text-rose-700',    bg: 'bg-rose-100',    label: 'Thin' };
  return { fg: 'text-slate-500', bg: 'bg-slate-100', label: '—' };
}

function parseProjects(raw: string): string[] {
  if (!raw) return [];
  return raw.split(/[,|;\n]/).map((s) => s.trim()).filter(Boolean);
}

function parseSkills(raw: string): string[] {
  if (!raw) return [];
  return raw.split(/[,|;]/).map((s) => s.trim()).filter(Boolean);
}

/** Category used to bucket cards on the grid. Multi-project members can end
 *  up in more than one project bucket, but we keep it simple: primary group
 *  is the first project listed, or the status if unallocated. */
function primaryGroup(m: USRosterMember): string {
  const projects = parseProjects(m.project);
  if (projects.length > 0) return projects[0];
  if (m.status === 'Bench') return '— Bench —';
  if (m.status === 'Proactive Bench') return '— Proactive Bench —';
  if (m.status === 'On Leave') return '— On Leave —';
  if (m.status === 'Notice') return '— Notice —';
  return '— Unassigned —';
}

export function USRosterCardGrid({ members, onSave, onDelete }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const groupState = useCollapsedGroups('us-roster-project', { defaultCollapsed: false });

  const grouped = useMemo(() => {
    const byGroup = new Map<string, USRosterMember[]>();
    for (const m of members) {
      const key = primaryGroup(m);
      const list = byGroup.get(key) || [];
      list.push(m);
      byGroup.set(key, list);
    }
    const groups = Array.from(byGroup.entries()).map(([name, ms]) => {
      const withRate = ms.filter((m) => m.bill_rate > 0);
      const avgMargin = withRate.length
        ? Math.round(withRate.reduce((s, m) => s + calcMarginPercent(m), 0) / withRate.length)
        : 0;
      const revenue = ms.reduce((s, m) => s + (Number(m.bill_rate) || 0) * 160, 0);
      const billable = ms.filter((m) => m.status === 'Billable').length;
      return { name, members: ms, avgMargin, revenue, billable };
    });
    // Real project groups first, sorted by revenue desc; special "— ... —"
    // groups (Bench, On Leave, etc) go to the bottom in a stable order.
    const isSpecial = (g: { name: string }) => g.name.startsWith('—');
    return groups.sort((a, b) => {
      if (isSpecial(a) !== isSpecial(b)) return isSpecial(a) ? 1 : -1;
      if (isSpecial(a) && isSpecial(b)) return a.name.localeCompare(b.name);
      return b.revenue - a.revenue;
    });
  }, [members]);

  const openMember = openId ? members.find((m) => m.id === openId) || null : null;

  return (
    <div>
      {/* Grouped card grid */}
      {grouped.length === 0 ? (
        <Card>
          <p className="text-center text-slate-400 text-sm py-8">No members match your filter.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => {
            const collapsed = groupState.isCollapsed(g.name);
            const isSpecial = g.name.startsWith('—');
            return (
              <section key={g.name}>
                <button
                  type="button"
                  onClick={() => groupState.toggle(g.name)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-t-lg text-left transition-colors ${
                    isSpecial
                      ? 'bg-slate-50 hover:bg-slate-100 border border-slate-200'
                      : 'bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50 hover:from-blue-100 hover:via-indigo-100 hover:to-violet-100 border border-blue-100'
                  }`}
                >
                  <span className="text-slate-500 flex-shrink-0">
                    {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  </span>
                  <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 ${
                    isSpecial ? 'bg-slate-200 text-slate-600' : 'bg-primary/15 text-primary'
                  }`}>
                    <Building2 size={14} />
                  </span>
                  <span className="text-base font-extrabold text-slate-900 tracking-tight">
                    {g.name.startsWith('—') ? g.name.replace(/—/g, '').trim() : g.name}
                  </span>
                  <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">
                    {g.members.length} {g.members.length === 1 ? 'person' : 'people'}
                    {g.billable > 0 && (
                      <>
                        <span className="text-slate-300 mx-1">·</span>
                        <span className="text-emerald-700">{g.billable}</span> billable
                      </>
                    )}
                    {g.revenue > 0 && (
                      <>
                        <span className="text-slate-300 mx-1">·</span>
                        <span className="text-slate-700"><Sensitive>{`$${(g.revenue / 1000).toFixed(0)}k`}</Sensitive></span> /mo
                      </>
                    )}
                    {g.avgMargin > 0 && (
                      <>
                        <span className="text-slate-300 mx-1">·</span>
                        avg margin <span className="text-slate-700"><Sensitive>{`${g.avgMargin}%`}</Sensitive></span>
                      </>
                    )}
                  </span>
                </button>
                {!collapsed && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mt-3">
                    {g.members
                      .slice()
                      .sort((a, b) => a.name.localeCompare(b.name))
                      .map((m) => (
                        <MemberCard key={m.id} member={m} onOpen={() => setOpenId(m.id)} />
                      ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Detail drawer */}
      {openMember && (
        <MemberDrawer
          member={openMember}
          onClose={() => setOpenId(null)}
          onSave={onSave}
          onDelete={(id) => {
            onDelete(id);
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}

/* ── Card ────────────────────────────────────────── */

function MemberCard({ member: m, onOpen }: { member: USRosterMember; onOpen: () => void }) {
  const statusColor = US_ROSTER_STATUS_COLORS[m.status] || '#94a3b8';
  const pct = calcMarginPercent(m);
  const tone = marginTone(pct);
  const skills = parseSkills(m.skills).slice(0, 3);
  const extraSkills = Math.max(0, parseSkills(m.skills).length - 3);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left bg-white border border-slate-200 rounded-xl p-3.5 hover:shadow-md hover:border-primary/30 transition-all group"
    >
      {/* Header row: avatar + name/role + status pill */}
      <div className="flex items-start gap-3">
        <div
          className="w-11 h-11 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0 shadow-sm"
          style={{ background: statusColor }}
        >
          {initials(m.name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-slate-900 truncate">{m.name || <span className="italic text-slate-400">Unnamed</span>}</div>
          <div className="text-[11px] text-slate-500 truncate">{m.role || '—'}</div>
          <div
            className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-white"
            style={{ background: statusColor }}
          >
            {m.status}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-slate-100 my-3" />

      {/* Row 2: margin + rate */}
      <div className="flex items-center justify-between mb-2">
        <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${tone.bg} ${tone.fg} text-[11px] font-bold`}>
          {pct > 0 ? <Sensitive>{`${pct}%`}</Sensitive> : '—'}
          <span className="text-[9px] uppercase tracking-wider opacity-70">margin</span>
        </div>
        <div className="text-[11px] text-slate-500">
          {m.bill_rate > 0 ? <><Sensitive>{`$${m.bill_rate}`}</Sensitive><span className="text-slate-400">/hr</span></> : <span className="italic">no rate</span>}
        </div>
      </div>

      {/* Row 3: location + visa */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 mb-2">
        <div className="inline-flex items-center gap-1 truncate">
          <MapPin size={11} className="flex-shrink-0" />
          <span className="truncate">{m.location || 'Unknown'}</span>
        </div>
        <div className="inline-flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: VISA_COLORS[m.visa_category] || '#94a3b8' }} />
          <span className="font-semibold">{m.visa_category}</span>
        </div>
      </div>

      {/* Skills chips */}
      {skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skills.map((s) => (
            <span key={s} className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
              {s}
            </span>
          ))}
          {extraSkills > 0 && (
            <span className="text-[10px] text-slate-500 px-1.5 py-0.5">+{extraSkills}</span>
          )}
        </div>
      )}
    </button>
  );
}

/* ── Drawer ───────────────────────────────────────── */

function MemberDrawer({
  member: m, onClose, onSave, onDelete,
}: {
  member: USRosterMember;
  onClose: () => void;
  onSave: (id: string, field: keyof USRosterMember, val: string | number) => void;
  onDelete: (id: string) => void;
}) {
  const statusColor = US_ROSTER_STATUS_COLORS[m.status] || '#94a3b8';
  const pct = calcMarginPercent(m);
  const tone = marginTone(pct);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[1px]" onClick={onClose}>
      <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-4 flex items-start gap-3">
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-base flex-shrink-0 shadow-sm"
            style={{ background: statusColor }}
          >
            {initials(m.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-base font-extrabold text-slate-900 tracking-tight truncate">{m.name || 'Unnamed'}</div>
            <div className="text-xs text-slate-500 truncate">{m.role} · <Sensitive>{m.bill_rate > 0 ? `$${m.bill_rate}/hr` : 'no rate'}</Sensitive></div>
            <div className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-white" style={{ background: statusColor }}>
              {m.status}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 p-1 hover:bg-slate-100 rounded"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Name</label>
              <Input value={m.name} onChange={(e) => onSave(m.id, 'name', e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Role</label>
              <Select value={m.role} onChange={(e) => onSave(m.id, 'role', e.target.value)} className="mt-1">
                {ROSTER_ROLES.map((r: string) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Project(s)</label>
              <Input value={m.project} onChange={(e) => onSave(m.id, 'project', e.target.value)} placeholder="Comma-separate for multiple" className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</label>
              <Select value={m.status} onChange={(e) => onSave(m.id, 'status', e.target.value)} className="mt-1">
                {US_ROSTER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Visa</label>
              <Select value={m.visa_category} onChange={(e) => onSave(m.id, 'visa_category', e.target.value)} className="mt-1">
                {VISA_CATEGORIES.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cost/hr ($)</label>
              <Input type="number" value={m.cost_per_hour} onChange={(e) => onSave(m.id, 'cost_per_hour', Number(e.target.value))} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Bill Rate ($/hr)</label>
              <Input type="number" value={m.bill_rate} onChange={(e) => onSave(m.id, 'bill_rate', Number(e.target.value))} className="mt-1" />
            </div>
            <div className="col-span-2 flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${tone.bg} ${tone.fg} font-bold`}>
                {pct > 0 ? <Sensitive>{`${pct}%`}</Sensitive> : '—'} margin
              </span>
              <span className="text-slate-500">
                Monthly @160h: <strong className="text-slate-800"><Sensitive>{`$${((m.bill_rate || 0) * 160).toLocaleString()}`}</Sensitive></strong>
              </span>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Start Date</label>
              <Input type="date" value={m.start_date || ''} onChange={(e) => onSave(m.id, 'start_date', e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Location</label>
              <Input value={m.location} onChange={(e) => onSave(m.id, 'location', e.target.value)} placeholder="City, ST" className="mt-1" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Email</label>
              <Input type="email" value={m.email} onChange={(e) => onSave(m.id, 'email', e.target.value)} className="mt-1" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Skills</label>
              <Input value={m.skills} onChange={(e) => onSave(m.id, 'skills', e.target.value)} placeholder="Comma-separated" className="mt-1" />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</label>
              <Textarea rows={4} value={m.notes} onChange={(e) => onSave(m.id, 'notes', e.target.value)} placeholder="Anything worth knowing…" className="mt-1" />
            </div>
          </div>

          {/* Danger row */}
          <div className="pt-4 border-t border-slate-100 flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (confirm(`Remove ${m.name || 'this member'} from the roster?`)) {
                  onDelete(m.id);
                }
              }}
              className="inline-flex items-center gap-1.5 text-xs text-rose-600 hover:text-white hover:bg-rose-600 px-3 py-1.5 rounded border border-rose-200 hover:border-rose-600 transition-colors"
            >
              <Trash2 size={12} /> Delete member
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
