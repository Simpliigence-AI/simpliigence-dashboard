// @ts-nocheck
/**
 * US Roster — full US FTE list (billable + bench + on leave + notice).
 *
 * Distinct from Open Bench: Open Bench is a subset showing just the
 * available US resources. US Roster shows everyone with full allocation,
 * billing, margin, and visa context.
 */
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Users, UserCheck, Briefcase, TrendingUp, DollarSign, Plus, Search,
  Trash2, Pencil, Download, Shield, X, Check,
} from 'lucide-react';
import { useUSRosterStore } from '../store/useUSRosterStore';
import { usePipelineStore } from '../store/usePipelineStore';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard } from '../components/ui';
import { Sensitive } from '../components/Sensitive';
import { OwnerOnly, useIsOwner } from '../components/OwnerOnly';
import {
  US_ROSTER_STATUSES, US_ROSTER_STATUS_COLORS,
  blendConsultantTotals,
  type USRosterStatus,
} from '../types/usRoster';
import { ROSTER_ROLES } from '../types/indiaRoster';
import type { VisaCategory } from '../types/openBench';
import { USRosterCardGrid } from './us-roster/USRosterCardGrid';
import { LayoutGrid, Rows3, Building2, User as UserIcon } from 'lucide-react';
import { USRosterClientView } from './us-roster/USRosterClientView';
import { USRosterConsultantView } from './us-roster/USRosterConsultantView';

/* —— Multi-project helpers ——
 * `project` is stored as a single TEXT column (comma-separated). One US
 * resource can be allocated across multiple projects simultaneously
 * (typical for shared-services / part-time arrangements). We split on
 * commas for display, join with ", " on save. */
const parseProjects = (s: string | null | undefined): string[] =>
  String(s || '').split(/\s*,\s*/).map(x => x.trim()).filter(Boolean);
const joinProjects = (arr: string[]): string =>
  Array.from(new Set(arr.map(x => x.trim()).filter(Boolean))).join(', ');

/* —— Multi-select project picker ——
 * Click the chip area to open a popover. Shows known projects (current
 * roster + pipeline) as a checklist; supports free-text "Add new" for
 * projects not yet in the system. */
function MultiProjectPicker({
  value, options, onSave,
}: {
  value: string;
  options: string[];
  onSave: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => parseProjects(value), [value]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const allOptions = useMemo(() => {
    const set = new Set<string>([...options, ...selected]);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [options, selected]);

  const filteredOpts = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return allOptions;
    return allOptions.filter(o => o.toLowerCase().includes(q));
  }, [allOptions, filter]);

  const toggle = (proj: string) => {
    const next = selected.includes(proj)
      ? selected.filter(p => p !== proj)
      : [...selected, proj];
    onSave(joinProjects(next));
  };

  const addNew = () => {
    const v = filter.trim();
    if (!v || selected.includes(v)) return;
    onSave(joinProjects([...selected, v]));
    setFilter('');
  };

  const removeChip = (proj: string) => {
    onSave(joinProjects(selected.filter(p => p !== proj)));
  };

  return (
    <div className="relative" ref={wrapRef}>
      <div
        className="group cursor-pointer rounded px-1 -mx-1 hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 transition-all min-h-[24px] flex items-center flex-wrap gap-1"
        onClick={() => setOpen(o => !o)}
        title="Click to manage project allocations"
      >
        {selected.length === 0 && (
          <span className="text-muted/70 italic text-[11px]">— Unallocated —</span>
        )}
        {selected.map(p => (
          <span
            key={p}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800"
          >
            {p}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeChip(p); }}
              className="hover:bg-blue-200 rounded-full p-0.5"
              title={`Remove ${p}`}
            >
              <X size={9} />
            </button>
          </span>
        ))}
        <Pencil size={10} className="ml-auto opacity-0 group-hover:opacity-40 flex-shrink-0" />
      </div>

      {open && (
        <div className="absolute z-30 mt-1 left-0 w-72 max-h-80 overflow-hidden bg-surface border border-line rounded-lg shadow-xl flex flex-col">
          <div className="p-2 border-b border-line/60">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search or add a project..."
              className="w-full text-xs border border-line rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (filteredOpts.length === 1) toggle(filteredOpts[0]);
                  else if (filter.trim() && !allOptions.includes(filter.trim())) addNew();
                }
                if (e.key === 'Escape') setOpen(false);
              }}
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {filteredOpts.map(opt => {
              const checked = selected.includes(opt);
              return (
                <button
                  type="button"
                  key={opt}
                  onClick={() => toggle(opt)}
                  className={`w-full px-2 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-blue-50 ${checked ? 'bg-blue-50/60' : ''}`}
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-blue-500 border-blue-500' : 'border-line'}`}>
                    {checked && <Check size={10} className="text-white" />}
                  </span>
                  <span className="text-ink/80 truncate">{opt}</span>
                </button>
              );
            })}
            {filter.trim() && !allOptions.some(o => o.toLowerCase() === filter.trim().toLowerCase()) && (
              <button
                type="button"
                onClick={addNew}
                className="w-full px-2 py-1.5 text-left text-xs flex items-center gap-2 text-blue-600 hover:bg-blue-50 border-t border-line/60"
              >
                <Plus size={11} /> Add &ldquo;{filter.trim()}&rdquo; as new project
              </button>
            )}
            {filteredOpts.length === 0 && !filter.trim() && (
              <div className="px-3 py-3 text-[11px] text-muted/70 italic text-center">
                No projects yet — type to add the first one.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const VISA_CATEGORIES: VisaCategory[] = ['H1B','L1','L2 EAD','H4 EAD','GC','GC EAD','US Citizen','OPT','CPT','TN','Other'];
const VISA_COLORS: Record<string, string> = {
  'H1B': '#3b82f6', 'L1': '#8b5cf6', 'L2 EAD': '#a78bfa', 'H4 EAD': '#c084fc',
  'GC': '#10b981', 'GC EAD': '#34d399', 'US Citizen': '#059669',
  'OPT': '#f59e0b', 'CPT': '#fbbf24', 'TN': '#06b6d4', 'Other': '#94a3b8',
};

/* —— Editable Cell —— */
function EditableCell({ value, onSave, type = 'text', options, className = '', displayContent }: {
  value: string | number;
  onSave: (val: string | number) => void;
  type?: 'text' | 'number' | 'select' | 'date';
  options?: string[];
  className?: string;
  displayContent?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<any>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ('select' in inputRef.current && type !== 'select') inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const final = type === 'number' ? Number(draft) : draft;
    if (final !== value) onSave(final);
    setEditing(false);
  };
  const cancel = () => { setDraft(value); setEditing(false); };
  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') cancel();
  };

  if (!editing) {
    return (
      <div
        className={`group cursor-pointer rounded px-1 -mx-1 hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 transition-all min-h-[24px] flex items-center ${className}`}
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit"
      >
        {displayContent || <span>{String(value) || ' '}</span>}
        <Pencil size={10} className="ml-1 opacity-0 group-hover:opacity-40 flex-shrink-0" />
      </div>
    );
  }

  if (type === 'select' && options) {
    return (
      <select ref={inputRef} value={draft as string} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKey}
        className="w-full px-1 py-0.5 text-xs border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <input ref={inputRef} type={type} value={draft as any} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKey}
      className={`w-full px-1 py-0.5 text-xs border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400 ${type === 'number' ? 'w-20 text-center' : ''}`} />
  );
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function USRosterPage() {
  const { members, addMember, updateMember, removeMember } = useUSRosterStore();
  const assignments = useUSRosterStore((s) => s.assignments);
  const pipelineProjects = usePipelineStore((s) => s.projects);
  const isOwner = useIsOwner();

  /**
   * All economics — StatCards, table cost/bill/margin cells, CSV export —
   * derive from the per-contract `assignments` table, NOT the legacy flat
   * `us_roster.cost_per_hour` / `bill_rate` fields. See blendConsultantTotals
   * comment for background.
   */
  const totalsByRoster = useMemo(() => {
    const map = new Map<string, ReturnType<typeof blendConsultantTotals>>();
    const grouped = new Map<string, typeof assignments>();
    for (const a of assignments) {
      if (!grouped.has(a.roster_id)) grouped.set(a.roster_id, []);
      grouped.get(a.roster_id)!.push(a);
    }
    for (const [id, list] of grouped) map.set(id, blendConsultantTotals(list));
    return map;
  }, [assignments]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [visaFilter, setVisaFilter] = useState<string>('All');
  const [showAdd, setShowAdd] = useState(false);
  const [sortField, setSortField] = useState<string>('name');
  const [sortAsc, setSortAsc] = useState(true);
  // View mode. `client` is the new default (assignments grouped by end
  // client). `consultant` shows one row per person with a per-contract
  // editor. `cards` and `table` are the previous views, kept for continuity.
  const [viewMode, setViewMode] = useState<'client' | 'consultant' | 'cards' | 'table'>(() => {
    try {
      const stored = localStorage.getItem('us-roster-view-mode');
      if (stored === 'client' || stored === 'consultant' || stored === 'cards' || stored === 'table') return stored;
    } catch { /* private mode */ }
    return 'client';
  });
  useEffect(() => {
    try { localStorage.setItem('us-roster-view-mode', viewMode); } catch { /* private mode */ }
  }, [viewMode]);


  const [draft, setDraft] = useState({
    name: '',
    role: 'Developer',
    project: '',
    status: 'Billable' as USRosterStatus,
    visa_category: 'H1B' as VisaCategory,
    cost_per_hour: 0,
    bill_rate: 0,
    start_date: todayStr(),
    skills: '',
    location: '',
    email: '',
    notes: '',
  });

  /* —— Filter + sort —— */
  const filtered = useMemo(() => {
    let data = [...members];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(m =>
        m.name.toLowerCase().includes(q) ||
        (m.skills || '').toLowerCase().includes(q) ||
        (m.project || '').toLowerCase().includes(q) ||
        (m.role || '').toLowerCase().includes(q) ||
        (m.location || '').toLowerCase().includes(q),
      );
    }
    if (statusFilter !== 'All') data = data.filter(m => m.status === statusFilter);
    if (roleFilter !== 'All') data = data.filter(m => m.role === roleFilter);
    if (visaFilter !== 'All') data = data.filter(m => m.visa_category === visaFilter);

    // Cost/bill/margin sorts read from the blended per-contract totals so
    // sort order matches what the row is actually showing. Anything else
    // falls back to the member's own field.
    const numFromTotals = (id: string, field: string): number => {
      const t = totalsByRoster.get(id);
      if (!t) return 0;
      if (field === 'cost_per_hour') return t.weightedCostRate;
      if (field === 'bill_rate') return t.weightedBillRate;
      if (field === 'margin_pct') return t.marginPct;
      return 0;
    };
    data.sort((a, b) => {
      if (sortField === 'cost_per_hour' || sortField === 'bill_rate' || sortField === 'margin_pct') {
        const av = numFromTotals(a.id, sortField);
        const bv = numFromTotals(b.id, sortField);
        return sortAsc ? av - bv : bv - av;
      }
      const av = (a as any)[sortField];
      const bv = (b as any)[sortField];
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return data;
  }, [members, search, statusFilter, roleFilter, visaFilter, sortField, sortAsc, totalsByRoster]);

  /* —— Stats —— */
  const total = members.length;
  const billable = members.filter(m => m.status === 'Billable').length;
  const bench = members.filter(m => m.status === 'Bench').length;
  /**
   * Aggregate across billable consultants — sum of every one of their
   * contracts. avg margin is revenue-weighted (not a plain average of
   * per-consultant percentages), so a $10k contract at 40% doesn't get
   * the same weight as a $200k contract at 20%.
   */
  const { avgMargin, monthlyRevenue } = useMemo(() => {
    let rev = 0;
    let cost = 0;
    for (const m of members) {
      if (m.status !== 'Billable') continue;
      const t = totalsByRoster.get(m.id);
      if (!t) continue;
      rev += t.monthlyRevenue;
      cost += t.monthlyCost;
    }
    return {
      monthlyRevenue: rev,
      avgMargin: rev > 0 ? Math.round(((rev - cost) / rev) * 100) : 0,
    };
  }, [members, totalsByRoster]);

  /* —— Project picklist options ——
   * Combine: (a) projects already on roster members (legacy + manual entries),
   * (b) live Zoho-synced pipeline projects. Dedup, sort. */
  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    members.forEach(m => parseProjects(m.project).forEach(p => set.add(p)));
    pipelineProjects.forEach(p => {
      if (p.name) set.add(p.name);
      if ((p as any).forecastName) set.add((p as any).forecastName);
    });
    return Array.from(set).filter(Boolean).sort((a, b) => a.localeCompare(b));
  }, [members, pipelineProjects]);

  /* —— Visa distribution —— */
  const visaDist = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of members) counts[m.visa_category] = (counts[m.visa_category] || 0) + 1;
    return counts;
  }, [members]);

  /* —— Cell save —— */
  const handleCellSave = useCallback((id: string, field: string, val: string | number) => {
    updateMember(id, { [field]: val });
  }, [updateMember]);

  const handleAdd = () => {
    if (!draft.name.trim()) return;
    addMember({
      name: draft.name.trim(),
      role: draft.role,
      project: draft.project.trim(),
      status: draft.status,
      visa_category: draft.visa_category,
      cost_per_hour: Number(draft.cost_per_hour) || 0,
      bill_rate: Number(draft.bill_rate) || 0,
      start_date: draft.start_date || todayStr(),
      skills: draft.skills.trim(),
      location: draft.location.trim(),
      email: draft.email.trim(),
      notes: draft.notes.trim(),
    });
    setDraft({ ...draft, name: '', project: '', skills: '', email: '', notes: '', location: '', cost_per_hour: 0, bill_rate: 0 });
    setShowAdd(false);
  };

  const handleSort = (field: string) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const exportCSV = () => {
    // Cost / bill / margin columns are owner-only, so strip them for
    // everyone else — same rule as the on-screen masking.
    const header = isOwner
      ? 'Name,Role,Project,Status,Visa,Cost/hr,Bill Rate/hr,Margin %,Margin $/hr,Start Date,Location,Skills,Email,Notes'
      : 'Name,Role,Project,Status,Visa,Start Date,Location,Skills,Email,Notes';
    const rows = filtered.map(m => {
      const t = totalsByRoster.get(m.id);
      const cost = t?.weightedCostRate ?? 0;
      const bill = t?.weightedBillRate ?? 0;
      const marginPct = t?.marginPct ?? 0;
      const marginAbs = t ? Math.round(t.monthlyMargin / 160) : 0;
      return (isOwner
        ? [
            m.name, m.role, m.project, m.status, m.visa_category,
            cost, bill, marginPct, marginAbs,
            m.start_date, m.location, m.skills, m.email, m.notes,
          ]
        : [
            m.name, m.role, m.project, m.status, m.visa_category,
            m.start_date, m.location, m.skills, m.email, m.notes,
          ]
      ).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `us_roster_${todayStr()}.csv`;
    a.click();
  };

  const SortHeader = ({ field, label, align = 'left', sticky = false, leftOffset = 0 }: { field: string; label: string; align?: 'left' | 'right' | 'center'; sticky?: boolean; leftOffset?: number }) => (
    <th
      className={`px-3 py-2 text-${align} font-semibold cursor-pointer hover:text-ink/80 select-none uppercase tracking-wide text-[10px] ${
        sticky ? 'sticky bg-surface-2/70 z-10 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]' : ''
      }`}
      style={sticky ? { left: leftOffset } : undefined}
      onClick={() => handleSort(field)}
    >
      {label} {sortField === field && (sortAsc ? '↑' : '↓')}
    </th>
  );

  return (
    <>
      <PageHeader
        eyebrow="Global T&M"
        tone="teal"
        title="Global Roster"
        subtitle="Full FTE roster — billable allocations, bench, visa, location, margin"
        action={
          <div className="flex flex-wrap gap-1 bg-surface-2 rounded-xl p-1 w-fit" title="Switch views: client / consultant / cards / table">
            <button
              type="button"
              onClick={() => setViewMode('client')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
                viewMode === 'client' ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-ink/80'
              }`}
              title="Group by end client — who's on which client, at what margin"
            >
              <Building2 size={12} /> By Client
            </button>
            <button
              type="button"
              onClick={() => setViewMode('consultant')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
                viewMode === 'consultant' ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-ink/80'
              }`}
              title="One row per consultant; expand to edit their contracts (SI, end client, cost, bill)"
            >
              <UserIcon size={12} /> By Consultant
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
                viewMode === 'cards' ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-ink/80'
              }`}
            >
              <LayoutGrid size={12} /> Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all ${
                viewMode === 'table' ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-ink/80'
              }`}
            >
              <Rows3 size={12} /> Table
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Total Team" value={total} icon={<Users size={20} />} subtitle={`${members.length} members`} />
        <StatCard label="Billable" value={billable} icon={<UserCheck size={20} />} subtitle={`${total > 0 ? Math.round(billable/total*100) : 0}% of team`} />
        <StatCard label="On Bench" value={bench} icon={<Briefcase size={20} />} subtitle={`${total > 0 ? Math.round(bench/total*100) : 0}% of team`} />
        <StatCard label="Avg Margin" value={<OwnerOnly><Sensitive>{`${avgMargin}%`}</Sensitive></OwnerOnly>} icon={<TrendingUp size={20} />} subtitle="Billable members" />
        <StatCard label="Monthly Revenue" value={<OwnerOnly><Sensitive>{`$${(monthlyRevenue/1000).toFixed(0)}k`}</Sensitive></OwnerOnly>} icon={<DollarSign size={20} />} subtitle="@ 160 hrs/mo" />
      </div>

      {/* Visa distribution */}
      {Object.keys(visaDist).length > 0 && (
        <Card className="mb-6">
          <h3 className="text-sm font-bold text-ink/80 mb-3 flex items-center gap-2">
            <Shield size={14} /> Visa Distribution
          </h3>
          <div className="flex gap-1 items-end h-20">
            {Object.entries(visaDist).map(([visa, count]) => {
              const maxCount = Math.max(...Object.values(visaDist), 1);
              const height = Math.max((count / maxCount) * 100, 8);
              return (
                <div key={visa} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-muted">{count}</span>
                  <div className="w-full rounded-t" style={{ height: `${height}%`, background: VISA_COLORS[visa] || '#94a3b8' }} />
                  <span className="text-[9px] text-muted/70 text-center leading-tight">{visa}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Status count chips — click to filter, click active chip to clear.
       *  Counts key off the FULL member list, not the filtered view, so the
       *  chip row is a stable overview of the team. */}
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {(() => {
          const total = members.length;
          const counts: Record<string, number> = {};
          for (const s of US_ROSTER_STATUSES) counts[s] = 0;
          for (const m of members) counts[m.status] = (counts[m.status] || 0) + 1;
          return (
            <>
              <button
                type="button"
                onClick={() => setStatusFilter('All')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${
                  statusFilter === 'All'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-surface text-ink/80 border-line hover:border-line'
                }`}
              >
                All <span className={statusFilter === 'All' ? 'text-white/70' : 'text-muted/70'}>· {total}</span>
              </button>
              {US_ROSTER_STATUSES.map((s) => {
                const active = statusFilter === s;
                const color = US_ROSTER_STATUS_COLORS[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(active ? 'All' : s)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-colors ${
                      active
                        ? 'text-white border-transparent shadow-sm'
                        : 'bg-surface text-ink/80 border-line hover:border-line'
                    }`}
                    style={active ? { background: color } : undefined}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                    {s} <span className={active ? 'text-white/80' : 'text-muted/70'}>· {counts[s]}</span>
                  </button>
                );
              })}
            </>
          );
        })()}
      </div>

      {/* Filters + Add */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted/70" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, skill, project, location..."
            className="text-xs border border-line rounded-lg pl-8 pr-3 py-1.5 bg-surface w-64" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs border border-line rounded-lg px-3 py-1.5 bg-surface">
          <option value="All">All Statuses</option>
          {US_ROSTER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="text-xs border border-line rounded-lg px-3 py-1.5 bg-surface">
          <option value="All">All Roles</option>
          {ROSTER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={visaFilter} onChange={(e) => setVisaFilter(e.target.value)}
          className="text-xs border border-line rounded-lg px-3 py-1.5 bg-surface">
          <option value="All">All Visas</option>
          {VISA_CATEGORIES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={exportCSV} className="flex items-center gap-1 text-xs border border-line px-3 py-1.5 rounded-lg hover:bg-surface-2/70">
          <Download size={13} /> Export CSV
        </button>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1 text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Add Member
        </button>
      </div>

      {/* Add Form */}
      {showAdd && (
        <Card className="border-2 border-blue-200 bg-blue-50/30 mb-4">
          <div className="p-4 space-y-3">
            <h4 className="text-sm font-bold text-ink/80">New Global Roster Member</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Name *</label>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Full name"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" autoFocus />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Role</label>
                <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  {ROSTER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Project(s)</label>
                <div className="mt-0.5 border rounded px-2 py-1 bg-surface">
                  <MultiProjectPicker
                    value={draft.project}
                    options={projectOptions}
                    onSave={(next) => setDraft({ ...draft, project: next })}
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Status</label>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as USRosterStatus })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  {US_ROSTER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Visa</label>
                <select value={draft.visa_category} onChange={(e) => setDraft({ ...draft, visa_category: e.target.value as VisaCategory })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  {VISA_CATEGORIES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              {isOwner && (
                <div className="col-span-2 rounded-lg border border-line/60 bg-surface-2/50 px-3 py-2 text-[11px] text-muted">
                  Cost and bill are set per-contract now. After saving, open <strong className="text-ink">By Consultant</strong> and add this person's contracts there.
                </div>
              )}
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Start Date</label>
                <input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] uppercase text-muted font-semibold">Location</label>
                <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="e.g. Dallas, TX"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] uppercase text-muted font-semibold">Skills</label>
                <input value={draft.skills} onChange={(e) => setDraft({ ...draft, skills: e.target.value })} placeholder="e.g. Salesforce, LWC"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleAdd} disabled={!draft.name.trim()} className="text-xs bg-primary text-white px-4 py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50">
                Save
              </button>
              <button onClick={() => setShowAdd(false)} className="text-xs text-muted px-4 py-1.5 rounded-lg hover:bg-surface-2">
                Cancel
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Roster — client (default) / consultant / cards / table */}
      {viewMode === 'client' && (
        <USRosterClientView members={filtered} />
      )}
      {viewMode === 'consultant' && (
        <USRosterConsultantView members={filtered} />
      )}
      {viewMode === 'cards' && (
        <USRosterCardGrid
          members={filtered}
          onSave={(id, field, val) => handleCellSave(id, field as string, val)}
          onDelete={(id) => removeMember(id)}
        />
      )}
      {viewMode === 'table' && (
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-2/70 text-muted">
                <th
                  className="px-2 py-2 text-left font-semibold uppercase tracking-wide text-[10px] w-8 sticky left-0 bg-surface-2/70 z-10"
                  title="Serial number within the current filter"
                >#</th>
                <SortHeader field="name" label="Name" sticky leftOffset={32} />
                <SortHeader field="role" label="Role" />
                <SortHeader field="project" label="Project" />
                <SortHeader field="status" label="Status" />
                <SortHeader field="visa_category" label="Visa" />
                <SortHeader field="location" label="Location" />
                <SortHeader field="cost_per_hour" label="Cost/hr" align="right" />
                <SortHeader field="bill_rate" label="Bill Rate" align="right" />
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-[10px]" title="Auto-computed: (bill - cost) / bill × 100">Margin</th>
                <SortHeader field="start_date" label="Start Date" />
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-[10px]">Skills</th>
                <th className="px-3 py-2 text-center font-semibold uppercase tracking-wide text-[10px] w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, idx) => {
                // Cost, bill, margin all come from the per-contract
                // assignments table (blended across all of this consultant's
                // contracts). The legacy m.cost_per_hour / m.bill_rate are
                // stale and not read here.
                const totals = totalsByRoster.get(m.id);
                const marginPct = totals?.marginPct ?? 0;
                const marginAbs = totals ? Math.round(totals.monthlyMargin / 160) : 0;
                const blendedCost = totals?.weightedCostRate ?? 0;
                const blendedBill = totals?.weightedBillRate ?? 0;
                const monthlyRev  = totals?.monthlyRevenue ?? 0;
                const contractCount = totals?.contractCount ?? 0;
                const marginColor = marginPct >= 50 ? '#10b981' : marginPct >= 30 ? '#f59e0b' : marginPct > 0 ? '#ef4444' : '#94a3b8';
                return (
                  <tr key={m.id} className="border-t border-line/60 hover:bg-blue-50/30 group">
                    <td className="px-2 py-2 text-muted/70 tabular-nums text-right pr-3 sticky left-0 bg-surface group-hover:bg-blue-50/60 w-8">{idx + 1}</td>
                    <td className="px-3 py-2 font-medium text-ink sticky bg-surface group-hover:bg-blue-50/60 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]" style={{ left: 32 }}>
                      <EditableCell value={m.name} onSave={(v) => handleCellSave(m.id, 'name', v)} />
                    </td>
                    <td className="px-3 py-2">
                      <EditableCell value={m.role} type="select" options={[...ROSTER_ROLES]} onSave={(v) => handleCellSave(m.id, 'role', v)} />
                    </td>
                    <td className="px-3 py-2 min-w-[180px]">
                      <MultiProjectPicker
                        value={m.project}
                        options={projectOptions}
                        onSave={(next) => handleCellSave(m.id, 'project', next)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <EditableCell value={m.status} type="select" options={US_ROSTER_STATUSES}
                        onSave={(v) => handleCellSave(m.id, 'status', v)}
                        displayContent={
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: US_ROSTER_STATUS_COLORS[m.status] || '#94a3b8' }}>
                            {m.status}
                          </span>
                        }
                      />
                    </td>
                    <td className="px-3 py-2">
                      <EditableCell value={m.visa_category} type="select" options={VISA_CATEGORIES}
                        onSave={(v) => handleCellSave(m.id, 'visa_category', v)}
                        displayContent={
                          <span className="inline-flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full" style={{ background: VISA_COLORS[m.visa_category] || '#94a3b8' }} />
                            {m.visa_category}
                          </span>
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-muted">
                      <EditableCell value={m.location} onSave={(v) => handleCellSave(m.id, 'location', v)} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" title={contractCount > 1 ? `Blended across ${contractCount} contracts — edit per-contract in Consultant view` : 'From assignments — edit in Consultant view'}>
                      <OwnerOnly>
                        <Sensitive>
                          <span className="text-ink/80">{blendedCost > 0 ? `$${blendedCost}` : '—'}</span>
                        </Sensitive>
                      </OwnerOnly>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums" title={contractCount > 1 ? `Blended across ${contractCount} contracts — edit per-contract in Consultant view` : 'From assignments — edit in Consultant view'}>
                      <OwnerOnly>
                        <Sensitive>
                          <span className="font-semibold text-green-700">{blendedBill > 0 ? `$${blendedBill}/hr` : '—'}</span>
                        </Sensitive>
                      </OwnerOnly>
                      {contractCount > 1 && (
                        <div className="text-[9px] text-muted mt-0.5">{contractCount} contracts · <OwnerOnly><Sensitive>{`$${(monthlyRev/1000).toFixed(1)}k/mo`}</Sensitive></OwnerOnly></div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="font-bold" style={{ color: marginColor }} title={`$${marginAbs}/hr blended profit`}>
                        {monthlyRev > 0 ? <OwnerOnly><Sensitive>{`${marginPct}%`}</Sensitive></OwnerOnly> : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <EditableCell value={m.start_date} type="date" onSave={(v) => handleCellSave(m.id, 'start_date', v)} />
                    </td>
                    <td className="px-3 py-2 max-w-[260px]">
                      <EditableCell value={m.skills} onSave={(v) => handleCellSave(m.id, 'skills', v)} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => { if (confirm(`Remove ${m.name} from the US roster?`)) removeMember(m.id); }}
                        className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-muted/70">
                    {members.length === 0
                      ? 'No US roster members yet. Click "Add Member" to start populating the US team.'
                      : 'No matches for the current filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      )}
    </>
  );
}
