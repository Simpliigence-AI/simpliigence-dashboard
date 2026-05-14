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
import {
  US_ROSTER_STATUSES, US_ROSTER_STATUS_COLORS,
  calcUSMarginPercent, calcUSMarginAbsolute,
  type USRosterStatus,
} from '../types/usRoster';
import { ROSTER_ROLES } from '../types/indiaRoster';
import type { VisaCategory } from '../types/openBench';

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
          <span className="text-slate-400 italic text-[11px]">— Unallocated —</span>
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
        <div className="absolute z-30 mt-1 left-0 w-72 max-h-80 overflow-hidden bg-white border border-slate-200 rounded-lg shadow-xl flex flex-col">
          <div className="p-2 border-b border-slate-100">
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search or add a project..."
              className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
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
                  <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-blue-500 border-blue-500' : 'border-slate-300'}`}>
                    {checked && <Check size={10} className="text-white" />}
                  </span>
                  <span className="text-slate-700 truncate">{opt}</span>
                </button>
              );
            })}
            {filter.trim() && !allOptions.some(o => o.toLowerCase() === filter.trim().toLowerCase()) && (
              <button
                type="button"
                onClick={addNew}
                className="w-full px-2 py-1.5 text-left text-xs flex items-center gap-2 text-blue-600 hover:bg-blue-50 border-t border-slate-100"
              >
                <Plus size={11} /> Add &ldquo;{filter.trim()}&rdquo; as new project
              </button>
            )}
            {filteredOpts.length === 0 && !filter.trim() && (
              <div className="px-3 py-3 text-[11px] text-slate-400 italic text-center">
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
  const pipelineProjects = usePipelineStore((s) => s.projects);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [visaFilter, setVisaFilter] = useState<string>('All');
  const [showAdd, setShowAdd] = useState(false);
  const [sortField, setSortField] = useState<string>('name');
  const [sortAsc, setSortAsc] = useState(true);

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

    data.sort((a, b) => {
      const av = (a as any)[sortField];
      const bv = (b as any)[sortField];
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return data;
  }, [members, search, statusFilter, roleFilter, visaFilter, sortField, sortAsc]);

  /* —— Stats —— */
  const total = members.length;
  const billable = members.filter(m => m.status === 'Billable').length;
  const bench = members.filter(m => m.status === 'Bench').length;
  const avgMargin = useMemo(() => {
    const billableMembers = members.filter(m => m.status === 'Billable' && m.bill_rate > 0);
    if (billableMembers.length === 0) return 0;
    const sum = billableMembers.reduce((s, m) => s + calcUSMarginPercent(m), 0);
    return Math.round(sum / billableMembers.length);
  }, [members]);
  const monthlyRevenue = useMemo(() =>
    members.filter(m => m.status === 'Billable').reduce((s, m) => s + m.bill_rate * 160, 0),
    [members]);

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
    const header = 'Name,Role,Project,Status,Visa,Cost/hr,Bill Rate/hr,Margin %,Margin $/hr,Start Date,Location,Skills,Email,Notes';
    const rows = filtered.map(m => [
      m.name, m.role, m.project, m.status, m.visa_category,
      m.cost_per_hour, m.bill_rate,
      calcUSMarginPercent(m), calcUSMarginAbsolute(m),
      m.start_date, m.location, m.skills, m.email, m.notes,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `us_roster_${todayStr()}.csv`;
    a.click();
  };

  const SortHeader = ({ field, label, align = 'left' }: { field: string; label: string; align?: 'left' | 'right' | 'center' }) => (
    <th
      className={`px-3 py-2 text-${align} font-semibold cursor-pointer hover:text-slate-700 select-none uppercase tracking-wide text-[10px]`}
      onClick={() => handleSort(field)}
    >
      {label} {sortField === field && (sortAsc ? '↑' : '↓')}
    </th>
  );

  return (
    <>
      <PageHeader
        title="US Roster"
        subtitle="Full US FTE roster — billable allocations, bench, visa, location, margin"
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard label="Total Team" value={total} icon={<Users size={20} />} subtitle={`${members.length} members`} />
        <StatCard label="Billable" value={billable} icon={<UserCheck size={20} />} subtitle={`${total > 0 ? Math.round(billable/total*100) : 0}% of team`} />
        <StatCard label="On Bench" value={bench} icon={<Briefcase size={20} />} subtitle={`${total > 0 ? Math.round(bench/total*100) : 0}% of team`} />
        <StatCard label="Avg Margin" value={<Sensitive>{`${avgMargin}%`}</Sensitive>} icon={<TrendingUp size={20} />} subtitle="Billable members" />
        <StatCard label="Monthly Revenue" value={<Sensitive>{`$${(monthlyRevenue/1000).toFixed(0)}k`}</Sensitive>} icon={<DollarSign size={20} />} subtitle="@ 160 hrs/mo" />
      </div>

      {/* Visa distribution */}
      {Object.keys(visaDist).length > 0 && (
        <Card className="mb-6">
          <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
            <Shield size={14} /> Visa Distribution
          </h3>
          <div className="flex gap-1 items-end h-20">
            {Object.entries(visaDist).map(([visa, count]) => {
              const maxCount = Math.max(...Object.values(visaDist), 1);
              const height = Math.max((count / maxCount) * 100, 8);
              return (
                <div key={visa} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-slate-600">{count}</span>
                  <div className="w-full rounded-t" style={{ height: `${height}%`, background: VISA_COLORS[visa] || '#94a3b8' }} />
                  <span className="text-[9px] text-slate-400 text-center leading-tight">{visa}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Filters + Add */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, skill, project, location..."
            className="text-xs border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 bg-white w-64" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          <option value="All">All Statuses</option>
          {US_ROSTER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          <option value="All">All Roles</option>
          {ROSTER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={visaFilter} onChange={(e) => setVisaFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          <option value="All">All Visas</option>
          {VISA_CATEGORIES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={exportCSV} className="flex items-center gap-1 text-xs border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50">
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
            <h4 className="text-sm font-bold text-slate-700">New US Roster Member</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Name *</label>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Full name"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" autoFocus />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Role</label>
                <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  {ROSTER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Project(s)</label>
                <div className="mt-0.5 border rounded px-2 py-1 bg-white">
                  <MultiProjectPicker
                    value={draft.project}
                    options={projectOptions}
                    onSave={(next) => setDraft({ ...draft, project: next })}
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Status</label>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as USRosterStatus })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  {US_ROSTER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Visa</label>
                <select value={draft.visa_category} onChange={(e) => setDraft({ ...draft, visa_category: e.target.value as VisaCategory })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  {VISA_CATEGORIES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Cost / hr</label>
                <input type="number" value={draft.cost_per_hour} onChange={(e) => setDraft({ ...draft, cost_per_hour: Number(e.target.value) })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Bill Rate / hr</label>
                <input type="number" value={draft.bill_rate} onChange={(e) => setDraft({ ...draft, bill_rate: Number(e.target.value) })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Start Date</label>
                <input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Location</label>
                <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="e.g. Dallas, TX"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Skills</label>
                <input value={draft.skills} onChange={(e) => setDraft({ ...draft, skills: e.target.value })} placeholder="e.g. Salesforce, LWC"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
            </div>
            {draft.bill_rate > 0 && (
              <div className="text-[11px] text-slate-500">
                Margin preview:&nbsp;
                <strong className="text-slate-700">{calcUSMarginPercent(draft as any)}%</strong>&nbsp;
                (${calcUSMarginAbsolute(draft as any).toFixed(2)}/hr)
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <button onClick={handleAdd} disabled={!draft.name.trim()} className="text-xs bg-primary text-white px-4 py-1.5 rounded-lg hover:bg-primary/90 disabled:opacity-50">
                Save
              </button>
              <button onClick={() => setShowAdd(false)} className="text-xs text-slate-500 px-4 py-1.5 rounded-lg hover:bg-slate-100">
                Cancel
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Roster Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                <SortHeader field="name" label="Name" />
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
              {filtered.map((m) => {
                const marginPct = calcUSMarginPercent(m);
                const marginAbs = calcUSMarginAbsolute(m);
                const marginColor = marginPct >= 50 ? '#10b981' : marginPct >= 30 ? '#f59e0b' : marginPct > 0 ? '#ef4444' : '#94a3b8';
                return (
                  <tr key={m.id} className="border-t border-slate-100 hover:bg-blue-50/30">
                    <td className="px-3 py-2 font-medium text-slate-800">
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
                    <td className="px-3 py-2 text-slate-600">
                      <EditableCell value={m.location} onSave={(v) => handleCellSave(m.id, 'location', v)} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Sensitive>
                        <EditableCell value={m.cost_per_hour} type="number" onSave={(v) => handleCellSave(m.id, 'cost_per_hour', v)} />
                      </Sensitive>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Sensitive>
                        <EditableCell value={m.bill_rate} type="number" onSave={(v) => handleCellSave(m.id, 'bill_rate', v)}
                          displayContent={<span className="font-semibold text-green-700">${m.bill_rate}/hr</span>}
                        />
                      </Sensitive>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="font-bold" style={{ color: marginColor }} title={`$${marginAbs}/hr profit`}>
                        {m.bill_rate > 0 ? <Sensitive>{`${marginPct}%`}</Sensitive> : '—'}
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
                  <td colSpan={12} className="px-3 py-8 text-center text-slate-400">
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
    </>
  );
}
