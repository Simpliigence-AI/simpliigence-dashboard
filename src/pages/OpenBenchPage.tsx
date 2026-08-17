// @ts-nocheck
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Users, Plus, Trash2, Pencil, UserCheck, DollarSign,
  Briefcase, Shield, Search, Filter, ChevronDown, ChevronRight, MessageSquarePlus, Send,
} from 'lucide-react';
import { useOpenBenchStore } from '../store/useOpenBenchStore';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard } from '../components/ui';
import type { VisaCategory, JobPriority, BenchUpdateType } from '../types/openBench';
import { BENCH_UPDATE_TYPES, BENCH_UPDATE_TYPE_COLORS } from '../types/openBench';

/* —— Editable Cell Component —— */
function EditableCell({ value, onSave, type = 'text', options, className = '', displayContent }: {
  value: string | number;
  onSave: (val: string | number) => void;
  type?: 'text' | 'number' | 'select' | 'textarea';
  options?: string[];
  className?: string;
  displayContent?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(null);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'textarea') commit();
    if (e.key === 'Escape') cancel();
  };

  if (!editing) {
    return (
      <div
        className={`group cursor-pointer rounded px-1 -mx-1 hover:bg-blue-50 hover:ring-1 hover:ring-blue-200 transition-all min-h-[24px] flex items-center ${className}`}
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit"
      >
        {displayContent || <span>{String(value) || '\u00A0'}</span>}
        <Pencil size={10} className="ml-1 opacity-0 group-hover:opacity-40 flex-shrink-0" />
      </div>
    );
  }

  if (type === 'select' && options) {
    return (
      <select ref={inputRef as any} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
        className="w-full px-1 py-0.5 text-xs border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  if (type === 'textarea') {
    return (
      <textarea ref={inputRef as any} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
        className="w-full px-1 py-0.5 text-xs border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400 min-h-[48px]" />
    );
  }

  return (
    <input ref={inputRef as any} type={type} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKeyDown}
      className="w-full px-1 py-0.5 text-xs border border-blue-300 rounded bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400" />
  );
}

/* —— Constants —— */
const VISA_CATEGORIES: VisaCategory[] = ['H1B','L1','L2 EAD','H4 EAD','GC','GC EAD','US Citizen','OPT','CPT','TN','Other'];
const JOB_PRIORITIES: JobPriority[] = ['Primary', 'Secondary'];

const VISA_COLORS: Record<string, string> = {
  'H1B': '#3b82f6', 'L1': '#8b5cf6', 'L2 EAD': '#a78bfa', 'H4 EAD': '#c084fc',
  'GC': '#10b981', 'GC EAD': '#34d399', 'US Citizen': '#059669',
  'OPT': '#f59e0b', 'CPT': '#fbbf24', 'TN': '#06b6d4', 'Other': '#94a3b8',
};

/* —— Main Component —— */
export default function OpenBenchPage() {
  const { resources, updates, addResource, updateResource, removeResource, addUpdate, removeUpdate, updatesFor } = useOpenBenchStore();
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const todayStr = new Date().toISOString().slice(0, 10);

  // Inline "Add update" draft state, keyed by resource id so each row keeps
  // its own in-flight values without leaking across rows.
  const [draftUpdate, setDraftUpdate] = useState<Record<string, {
    update_date: string;
    type: BenchUpdateType;
    update_text: string;
    client_or_role: string;
    recruiter: string;
  }>>({});

  const getDraft = (resId: string) => draftUpdate[resId] || {
    update_date: todayStr,
    type: 'Submission' as BenchUpdateType,
    update_text: '',
    client_or_role: '',
    recruiter: '',
  };

  const setDraftField = (resId: string, field: string, val: string) => {
    setDraftUpdate((prev) => ({
      ...prev,
      [resId]: { ...getDraft(resId), [field]: val },
    }));
  };

  const submitDraft = (resId: string) => {
    const draft = getDraft(resId);
    if (!draft.update_text.trim()) return;
    addUpdate({
      resource_id: resId,
      update_date: draft.update_date || todayStr,
      type: draft.type,
      update_text: draft.update_text.trim(),
      client_or_role: draft.client_or_role.trim(),
      recruiter: draft.recruiter.trim(),
    });
    // Reset draft for this row but keep recruiter name (rare to switch mid-session)
    setDraftUpdate((prev) => ({
      ...prev,
      [resId]: { ...getDraft(resId), update_text: '', client_or_role: '', update_date: todayStr },
    }));
  };

  const toggleRow = (id: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [showAddForm, setShowAddForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVisa, setFilterVisa] = useState<string>('All');
  const [filterPriority, setFilterPriority] = useState<string>('All');
  const [sortField, setSortField] = useState<string>('resource_name');
  const [sortAsc, setSortAsc] = useState(true);

  // New resource form
  const [newName, setNewName] = useState('');
  const [newYOE, setNewYOE] = useState<number>(0);
  const [newVisa, setNewVisa] = useState<VisaCategory>('H1B');
  const [newSkill, setNewSkill] = useState('');
  const [newRoles, setNewRoles] = useState('');
  const [newPriority, setNewPriority] = useState<JobPriority>('Primary');
  const [newRate, setNewRate] = useState<number>(0);
  const [newNotes, setNewNotes] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [newKeyOpps, setNewKeyOpps] = useState('');

  /* —— Derived data —— */
  const filteredResources = useMemo(() => {
    let data = resources.filter(r => r.available);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      data = data.filter(r =>
        r.resource_name.toLowerCase().includes(q) ||
        r.primary_skill.toLowerCase().includes(q) ||
        r.roles.toLowerCase().includes(q) ||
        (r.location || '').toLowerCase().includes(q)
      );
    }
    if (filterVisa !== 'All') data = data.filter(r => r.visa_category === filterVisa);
    if (filterPriority !== 'All') data = data.filter(r => r.job_priority === filterPriority);

    data.sort((a, b) => {
      const av = a[sortField as keyof typeof a];
      const bv = b[sortField as keyof typeof b];
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return data;
  }, [resources, searchTerm, filterVisa, filterPriority, sortField, sortAsc]);

  // Stats
  const totalBench = resources.filter(r => r.available).length;
  const avgYOE = totalBench > 0 ? (resources.filter(r => r.available).reduce((s, r) => s + r.years_of_experience, 0) / totalBench).toFixed(1) : '0';
  const avgRate = totalBench > 0 ? Math.round(resources.filter(r => r.available).reduce((s, r) => s + r.target_rate, 0) / totalBench) : 0;
  const primaryCount = resources.filter(r => r.available && r.job_priority === 'Primary').length;

  // Visa distribution
  const visaDist = useMemo(() => {
    const counts: Record<string, number> = {};
    resources.filter(r => r.available).forEach(r => { counts[r.visa_category] = (counts[r.visa_category] || 0) + 1; });
    return counts;
  }, [resources]);

  // Skill distribution
  const skillDist = useMemo(() => {
    const counts: Record<string, number> = {};
    resources.filter(r => r.available).forEach(r => { counts[r.primary_skill] = (counts[r.primary_skill] || 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [resources]);

  const handleAdd = () => {
    if (!newName || !newSkill) return;
    addResource({
      resource_name: newName,
      years_of_experience: newYOE,
      visa_category: newVisa,
      primary_skill: newSkill,
      roles: newRoles,
      job_priority: newPriority,
      target_rate: newRate,
      location: newLocation,
      key_opportunities: newKeyOpps,
      notes: newNotes,
      available: true,
    });
    setNewName(''); setNewYOE(0); setNewVisa('H1B'); setNewSkill(''); setNewRoles('');
    setNewPriority('Primary'); setNewRate(0); setNewNotes(''); setNewLocation(''); setNewKeyOpps('');
    setShowAddForm(false);
  };

  const handleCellSave = useCallback((id: string, field: string, val: string | number) => {
    updateResource(id, { [field]: val });
  }, [updateResource]);

  const handleSort = (field: string) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const SortHeader = ({ field, label }: { field: string; label: string }) => (
    <th className="px-3 py-2 text-left font-semibold cursor-pointer hover:text-ink/80 select-none" onClick={() => handleSort(field)}>
      {label} {sortField === field && (sortAsc ? '↑' : '↓')}
    </th>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Open Bench Resources"
        subtitle="Resources available for assignment"
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="On Bench" value={totalBench} icon={<Users size={20} />} subtitle="Available resources" />
        <StatCard label="Avg Experience" value={`${avgYOE} yrs`} icon={<Briefcase size={20} />} subtitle="Years" />
        <StatCard label="Avg Target Rate" value={`$${avgRate}/hr`} icon={<DollarSign size={20} />} subtitle="Hourly" />
        <StatCard label="Primary Jobs" value={primaryCount} icon={<UserCheck size={20} />} subtitle={`of ${totalBench} total`} />
      </div>

      {/* Distribution Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <div className="p-4">
            <h3 className="text-sm font-bold text-ink/80 mb-3 flex items-center gap-2">
              <Shield size={16} /> Visa Distribution
            </h3>
            <div className="flex gap-1 items-end h-24">
              {Object.entries(visaDist).map(([visa, count]) => {
                const maxCount = Math.max(...Object.values(visaDist), 1);
                const height = Math.max((count / maxCount) * 100, 8);
                return (
                  <div key={visa} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[10px] font-bold text-muted">{count}</span>
                    <div className="w-full rounded-t" style={{ height: `${height}%`, background: VISA_COLORS[visa] || '#94a3b8' }} />
                    <span className="text-[8px] text-muted/70 text-center leading-tight">{visa}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
        <Card>
          <div className="p-4">
            <h3 className="text-sm font-bold text-ink/80 mb-3 flex items-center gap-2">
              <Briefcase size={16} /> Skill Distribution
            </h3>
            <div className="space-y-1.5">
              {skillDist.map(([skill, count]) => (
                <div key={skill} className="flex items-center gap-2">
                  <span className="text-xs text-muted w-28 truncate">{skill}</span>
                  <div className="flex-1 bg-surface-2 rounded-full h-4 overflow-hidden">
                    <div className="bg-primary/70 h-full rounded-full" style={{ width: `${(count / totalBench) * 100}%` }} />
                  </div>
                  <span className="text-xs font-semibold text-muted w-6 text-right">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted/70" />
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search name, skill, role..."
            className="text-xs border border-line rounded-lg pl-8 pr-3 py-1.5 bg-surface w-56" />
        </div>
        <select value={filterVisa} onChange={e => setFilterVisa(e.target.value)}
          className="text-xs border border-line rounded-lg px-3 py-1.5 bg-surface">
          <option value="All">All Visas</option>
          {VISA_CATEGORIES.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className="text-xs border border-line rounded-lg px-3 py-1.5 bg-surface">
          <option value="All">All Priority</option>
          {JOB_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={() => setShowAddForm(true)} className="flex items-center gap-1 text-xs bg-primary text-white px-3 py-1.5 rounded-lg hover:bg-primary/90">
          <Plus size={14} /> Add Resource
        </button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <Card className="border-2 border-blue-200 bg-blue-50/30">
          <div className="p-4 space-y-3">
            <h4 className="text-sm font-bold text-ink/80">New Bench Resource</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Resource Name</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Years of Experience</label>
                <input type="number" value={newYOE} onChange={e => setNewYOE(Number(e.target.value))}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Visa Category</label>
                <select value={newVisa} onChange={e => setNewVisa(e.target.value as VisaCategory)}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  {VISA_CATEGORIES.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Primary Skill</label>
                <input value={newSkill} onChange={e => setNewSkill(e.target.value)} placeholder="e.g. Salesforce"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Roles</label>
                <input value={newRoles} onChange={e => setNewRoles(e.target.value)} placeholder="e.g. SF Developer / Architect"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Primary / Secondary</label>
                <select value={newPriority} onChange={e => setNewPriority(e.target.value as JobPriority)}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  {JOB_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Target Rate ($/hr)</label>
                <input type="number" value={newRate} onChange={e => setNewRate(Number(e.target.value))}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Location</label>
                <input value={newLocation} onChange={e => setNewLocation(e.target.value)} placeholder="e.g. Dallas, TX"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Key Opportunities</label>
                <input value={newKeyOpps} onChange={e => setNewKeyOpps(e.target.value)} placeholder="e.g. TEKsystems Java role"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted font-semibold">Notes</label>
                <input value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Optional"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button onClick={handleAdd} className="text-xs bg-primary text-white px-4 py-1.5 rounded-lg hover:bg-primary/90">Save</button>
              <button onClick={() => setShowAddForm(false)} className="text-xs text-muted px-4 py-1.5 rounded-lg hover:bg-surface-2">Cancel</button>
            </div>
          </div>
        </Card>
      )}

      {/* Resources Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-2/70 text-muted uppercase tracking-wider">
                <th className="w-6 px-1 py-2"></th>
                <SortHeader field="resource_name" label="Resource Name" />
                <SortHeader field="years_of_experience" label="YOE" />
                <SortHeader field="visa_category" label="Visa" />
                <SortHeader field="primary_skill" label="Primary Skill" />
                <th className="px-3 py-2 text-left font-semibold">Roles</th>
                <SortHeader field="job_priority" label="Priority" />
                <SortHeader field="target_rate" label="Target Rate" />
                <SortHeader field="location" label="Location" />
                <th className="px-3 py-2 text-left font-semibold">Key Opportunities</th>
                <th className="px-3 py-2 text-left font-semibold">Notes</th>
                <th className="px-3 py-2 text-left font-semibold min-w-[200px]" title="Most recent recruiter update / submission. Click row arrow to expand the full log.">
                  Latest Update
                </th>
                <th className="px-3 py-2 text-center font-semibold w-16">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredResources.map(r => {
                const isExpanded = expandedRows.has(r.id);
                const resourceUpdates = updatesFor(r.id);
                const latest = resourceUpdates[0];
                const draft = getDraft(r.id);
                return (
                <React.Fragment key={r.id}>
                <tr className="border-t border-line/60 hover:bg-blue-50/30">
                  <td className="px-1 py-2 text-center">
                    <button
                      onClick={() => toggleRow(r.id)}
                      className="p-0.5 rounded hover:bg-surface-2 text-muted/70 hover:text-muted"
                      title={`${resourceUpdates.length} update${resourceUpdates.length === 1 ? '' : 's'}. Click to ${isExpanded ? 'collapse' : 'expand'}.`}
                    >
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                  </td>
                  <td className="px-3 py-2 font-medium text-ink">
                    <EditableCell value={r.resource_name} onSave={v => handleCellSave(r.id, 'resource_name', v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableCell value={r.years_of_experience} type="number" onSave={v => handleCellSave(r.id, 'years_of_experience', v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableCell value={r.visa_category} type="select" options={VISA_CATEGORIES}
                      onSave={v => handleCellSave(r.id, 'visa_category', v)}
                      displayContent={
                        <span className="inline-flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full" style={{ background: VISA_COLORS[r.visa_category] || '#94a3b8' }} />
                          {r.visa_category}
                        </span>
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <EditableCell value={r.primary_skill} onSave={v => handleCellSave(r.id, 'primary_skill', v)} />
                  </td>
                  <td className="px-3 py-2 max-w-[160px]">
                    <EditableCell value={r.roles} onSave={v => handleCellSave(r.id, 'roles', v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableCell value={r.job_priority} type="select" options={JOB_PRIORITIES}
                      onSave={v => handleCellSave(r.id, 'job_priority', v)}
                      displayContent={
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                          r.job_priority === 'Primary' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {r.job_priority}
                        </span>
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <EditableCell value={r.target_rate} type="number" onSave={v => handleCellSave(r.id, 'target_rate', v)}
                      displayContent={<span className="font-semibold text-green-700">${r.target_rate}/hr</span>}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <EditableCell value={r.location || ''} onSave={v => handleCellSave(r.id, 'location', v)} />
                  </td>
                  <td className="px-3 py-2 max-w-[180px]">
                    <EditableCell value={r.key_opportunities || ''} onSave={v => handleCellSave(r.id, 'key_opportunities', v)} />
                  </td>
                  <td className="px-3 py-2 max-w-[160px]">
                    <EditableCell value={r.notes} type="textarea" onSave={v => handleCellSave(r.id, 'notes', v)} />
                  </td>
                  {/* Latest Update preview cell — clicking expands the row */}
                  <td className="px-3 py-2 max-w-[220px]">
                    {latest ? (
                      <button
                        onClick={() => toggleRow(r.id)}
                        className="text-left w-full group"
                        title={latest.update_text}
                      >
                        <div className="flex items-center gap-1 mb-0.5">
                          <span
                            className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded uppercase tracking-wide"
                            style={{ background: BENCH_UPDATE_TYPE_COLORS[latest.type] || '#94a3b8' }}
                          >
                            {latest.type}
                          </span>
                          <span className="text-[10px] text-muted/70">{latest.update_date}</span>
                          {resourceUpdates.length > 1 && (
                            <span className="text-[9px] text-muted/70">+{resourceUpdates.length - 1}</span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted truncate group-hover:text-ink">
                          {latest.client_or_role && (
                            <span className="font-semibold">{latest.client_or_role}: </span>
                          )}
                          {latest.update_text}
                        </div>
                      </button>
                    ) : (
                      <button
                        onClick={() => toggleRow(r.id)}
                        className="text-[10px] text-blue-500 hover:text-blue-700 italic flex items-center gap-1"
                      >
                        <MessageSquarePlus size={11} /> Add first update
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => removeResource(r.id)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded" title="Remove from bench">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>

                {/* Expanded — full update log + add form */}
                {isExpanded && (
                  <tr key={`${r.id}-exp`}>
                    <td colSpan={13} className="bg-blue-50/30 p-0">
                      <div className="px-8 py-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <MessageSquarePlus size={12} className="text-blue-500" />
                          <span className="text-[10px] font-bold text-muted uppercase tracking-wide">
                            Daily Updates &amp; Submissions ({resourceUpdates.length})
                          </span>
                        </div>

                        {/* Existing updates — newest first */}
                        {resourceUpdates.length === 0 && (
                          <p className="text-xs text-muted/70 italic">
                            No updates yet. Use the form below to log a submission, interview, feedback, or note.
                          </p>
                        )}
                        <div className="space-y-1.5 max-h-72 overflow-y-auto">
                          {resourceUpdates.map((u) => (
                            <div key={u.id} className="flex items-start gap-2 group bg-surface border border-line rounded-lg px-2.5 py-1.5 hover:border-blue-300 transition-colors">
                              <span
                                className="text-[9px] font-bold text-white px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0 mt-0.5"
                                style={{ background: BENCH_UPDATE_TYPE_COLORS[u.type] || '#94a3b8' }}
                              >
                                {u.type}
                              </span>
                              <span className="text-muted/70 font-mono text-[10px] flex-shrink-0 mt-0.5 w-20">
                                {u.update_date}
                              </span>
                              <div className="flex-1 min-w-0">
                                {u.client_or_role && (
                                  <div className="text-[10px] font-semibold text-ink/80">
                                    {u.client_or_role}
                                  </div>
                                )}
                                <div className="text-[11px] text-ink/80">{u.update_text}</div>
                              </div>
                              {u.recruiter && (
                                <span className="text-[10px] text-muted/70 italic flex-shrink-0 mt-0.5">
                                  — {u.recruiter}
                                </span>
                              )}
                              <button
                                onClick={() => { if (confirm('Delete this update?')) removeUpdate(u.id); }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 text-line hover:text-red-500 transition-all flex-shrink-0"
                                title="Delete update"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Add form */}
                        <div className="bg-surface border border-line rounded-lg p-2.5">
                          <div className="grid grid-cols-12 gap-2 mb-2">
                            <div className="col-span-2">
                              <label className="block text-[9px] uppercase text-muted/70 font-semibold mb-0.5">Type</label>
                              <select
                                value={draft.type}
                                onChange={(e) => setDraftField(r.id, 'type', e.target.value)}
                                className="w-full text-[11px] border border-line rounded px-1.5 py-1 bg-surface"
                              >
                                {BENCH_UPDATE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                            <div className="col-span-2">
                              <label className="block text-[9px] uppercase text-muted/70 font-semibold mb-0.5">Date</label>
                              <input
                                type="date"
                                value={draft.update_date}
                                onChange={(e) => setDraftField(r.id, 'update_date', e.target.value)}
                                className="w-full text-[11px] border border-line rounded px-1.5 py-1 bg-surface"
                              />
                            </div>
                            <div className="col-span-3">
                              <label className="block text-[9px] uppercase text-muted/70 font-semibold mb-0.5">Client / Role <span className="text-line normal-case">optional</span></label>
                              <input
                                value={draft.client_or_role}
                                onChange={(e) => setDraftField(r.id, 'client_or_role', e.target.value)}
                                placeholder="e.g. TEKsystems Java"
                                className="w-full text-[11px] border border-line rounded px-1.5 py-1 bg-surface"
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-[9px] uppercase text-muted/70 font-semibold mb-0.5">Recruiter <span className="text-line normal-case">optional</span></label>
                              <input
                                value={draft.recruiter}
                                onChange={(e) => setDraftField(r.id, 'recruiter', e.target.value)}
                                placeholder="Name"
                                className="w-full text-[11px] border border-line rounded px-1.5 py-1 bg-surface"
                              />
                            </div>
                          </div>
                          <div className="flex items-end gap-2">
                            <div className="flex-1">
                              <label className="block text-[9px] uppercase text-muted/70 font-semibold mb-0.5">Update / Note</label>
                              <input
                                value={draft.update_text}
                                onChange={(e) => setDraftField(r.id, 'update_text', e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') submitDraft(r.id); }}
                                placeholder="e.g. Submitted to TEKsystems for SF Architect role at $80/hr"
                                className="w-full text-[11px] border border-line rounded px-2 py-1.5 bg-surface focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
                              />
                            </div>
                            <button
                              onClick={() => submitDraft(r.id)}
                              disabled={!draft.update_text.trim()}
                              className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-40"
                            >
                              <Send size={11} /> Log
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
              {filteredResources.length === 0 && (
                <tr><td colSpan={13} className="px-3 py-8 text-center text-muted/70">No resources found matching filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
