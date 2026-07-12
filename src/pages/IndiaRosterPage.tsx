// @ts-nocheck
/**
 * India Roster — full India FTE list (billable + bench).
 *
 * Each row tracks: name, role, project, status, cost, bill rate, margin
 * (auto-calculated), start date, skills. Billable members earn revenue;
 * bench members are available for new allocations.
 *
 * Stats at top: total team size, billable / bench split, average margin,
 * total monthly revenue at 160 hrs/month per billable member.
 */
import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import {
  Users, UserCheck, Briefcase, TrendingUp, DollarSign, Plus, Search,
  Trash2, Pencil, Filter, Download, ChevronDown, ChevronRight, Building2,
} from 'lucide-react';
import { useIndiaRosterStore } from '../store/useIndiaRosterStore';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard } from '../components/ui';
import { Sensitive } from '../components/Sensitive';
import {
  INDIA_ROSTER_STATUSES, INDIA_ROSTER_STATUS_COLORS, ROSTER_ROLES,
  calcMarginPercent, calcMarginAbsolute,
  type IndiaRosterStatus,
} from '../types/indiaRoster';

/* —— Editable Cell —— */
function EditableCell({ value, onSave, type = 'text', options, className = '', displayContent, prefix }: {
  value: string | number;
  onSave: (val: string | number) => void;
  type?: 'text' | 'number' | 'select' | 'date';
  options?: string[];
  className?: string;
  displayContent?: React.ReactNode;
  prefix?: string;
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
        {displayContent || <span>{prefix}{String(value) || ' '}</span>}
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

export default function IndiaRosterPage() {
  const { members, addMember, updateMember, removeMember } = useIndiaRosterStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [roleFilter, setRoleFilter] = useState<string>('All');
  const [showAdd, setShowAdd] = useState(false);
  const [sortField, setSortField] = useState<string>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [groupByAccount, setGroupByAccount] = useState(true);

  // New-member draft
  const [draft, setDraft] = useState({
    name: '',
    role: 'Developer',
    project: '',
    status: 'Billable' as IndiaRosterStatus,
    cost_per_hour: 0,
    bill_rate: 0,
    start_date: todayStr(),
    skills: '',
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
        (m.role || '').toLowerCase().includes(q),
      );
    }
    if (statusFilter !== 'All') data = data.filter(m => m.status === statusFilter);
    if (roleFilter !== 'All') data = data.filter(m => m.role === roleFilter);

    data.sort((a, b) => {
      const av = (a as any)[sortField];
      const bv = (b as any)[sortField];
      if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return data;
  }, [members, search, statusFilter, roleFilter, sortField, sortAsc]);

  /* —— Active vs Inactive split ——
   * Active  = Billable (currently earning revenue this month)
   * Inactive = Bench / On Leave / Notice (no current allocation or leaving)
   *
   * When groupByAccount is on, we override the user's sort field with a
   * (project, sortField) ordering so account banners group correctly.
   */
  const sortByProjectThen = useCallback((a: any, b: any) => {
    const pcmp = String(a.project || '').localeCompare(String(b.project || ''));
    if (pcmp !== 0) return pcmp;
    const av = (a as any)[sortField];
    const bv = (b as any)[sortField];
    if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av;
    return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  }, [sortField, sortAsc]);

  const activeRows = useMemo(() => {
    const rows = filtered.filter(m => m.status === 'Billable');
    return groupByAccount ? [...rows].sort(sortByProjectThen) : rows;
  }, [filtered, groupByAccount, sortByProjectThen]);

  const inactiveRows = useMemo(() => {
    const rows = filtered.filter(m => m.status !== 'Billable');
    return groupByAccount ? [...rows].sort(sortByProjectThen) : rows;
  }, [filtered, groupByAccount, sortByProjectThen]);

  /* —— Stats ——
   *  "Active team" excludes Inactive alumni / ex-contractors so headcount and
   *  bench percentages reflect who's actually on the team today. Inactive
   *  members stay on the roster page for history but never inflate stats. */
  const activeMembers = useMemo(() => members.filter(m => m.status !== 'Inactive'), [members]);
  const total = activeMembers.length;
  const billable = activeMembers.filter(m => m.status === 'Billable').length;
  const bench = activeMembers.filter(m => m.status === 'Bench').length;
  const inactive = members.length - activeMembers.length;
  const avgMargin = useMemo(() => {
    const billableMembers = activeMembers.filter(m => m.status === 'Billable' && m.bill_rate > 0);
    if (billableMembers.length === 0) return 0;
    const sum = billableMembers.reduce((s, m) => s + calcMarginPercent(m), 0);
    return Math.round(sum / billableMembers.length);
  }, [activeMembers]);
  const monthlyRevenue = useMemo(() => {
    return activeMembers
      .filter(m => m.status === 'Billable')
      .reduce((s, m) => s + m.bill_rate * 160, 0); // 160 hrs/mo standard
  }, [activeMembers]);

  /* —— Distribution by role —— */
  const roleDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const m of members) {
      const r = m.role || 'Unspecified';
      counts[r] = (counts[r] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
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
      cost_per_hour: Number(draft.cost_per_hour) || 0,
      bill_rate: Number(draft.bill_rate) || 0,
      start_date: draft.start_date || todayStr(),
      skills: draft.skills.trim(),
      email: draft.email.trim(),
      notes: draft.notes.trim(),
    });
    setDraft({ ...draft, name: '', project: '', skills: '', email: '', notes: '', cost_per_hour: 0, bill_rate: 0 });
    setShowAdd(false);
  };

  const handleSort = (field: string) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const exportCSV = () => {
    const header = 'Name,Role,Project,Status,Cost/hr,Bill Rate/hr,Margin %,Margin $/hr,Start Date,Skills,Email,Notes';
    const rows = filtered.map(m => [
      m.name, m.role, m.project, m.status,
      m.cost_per_hour, m.bill_rate,
      calcMarginPercent(m), calcMarginAbsolute(m),
      m.start_date, m.skills, m.email, m.notes,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `india_roster_${todayStr()}.csv`;
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
        title="India Roster"
        subtitle="Full India FTE roster — billable allocations, bench, and margin"
      />

      {/* SharePoint sync banner */}
      <SharePointSyncBanner members={members} />


      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard
          label="Total Team"
          value={total}
          icon={<Users size={20} />}
          subtitle={inactive > 0 ? `${inactive} inactive/alumni not counted` : `${total} active members`}
        />
        <StatCard label="Billable" value={billable} icon={<UserCheck size={20} />} subtitle={`${total > 0 ? Math.round(billable/total*100) : 0}% of team`} />
        <StatCard
          label="On Bench"
          value={bench}
          icon={<Briefcase size={20} />}
          subtitle={`${total > 0 ? Math.round(bench/total*100) : 0}% of team${inactive > 0 ? ` · ${inactive} inactive tracked separately` : ''}`}
        />
        <StatCard label="Avg Margin" value={<Sensitive>{`${avgMargin}%`}</Sensitive>} icon={<TrendingUp size={20} />} subtitle="Billable members" />
        <StatCard label="Monthly Revenue" value={<Sensitive>{`$${(monthlyRevenue/1000).toFixed(0)}k`}</Sensitive>} icon={<DollarSign size={20} />} subtitle="@ 160 hrs/mo" />
      </div>

      {/* Role distribution */}
      {roleDistribution.length > 0 && (
        <Card className="mb-6">
          <h3 className="text-sm font-bold text-slate-700 mb-3">Role Distribution</h3>
          <div className="space-y-1.5">
            {roleDistribution.map(([role, count]) => (
              <div key={role} className="flex items-center gap-2">
                <span className="text-xs text-slate-600 w-40 truncate">{role}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div className="bg-blue-500/70 h-full rounded-full" style={{ width: `${(count / total) * 100}%` }} />
                </div>
                <span className="text-xs font-semibold text-slate-500 w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Filters + Add */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, skill, project, role..."
            className="text-xs border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 bg-white w-64" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          <option value="All">All Statuses</option>
          {INDIA_ROSTER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white">
          <option value="All">All Roles</option>
          {ROSTER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button
          onClick={() => setGroupByAccount(v => !v)}
          className={`text-xs border rounded-lg px-3 py-1.5 transition-colors ${
            groupByAccount
              ? 'border-blue-300 bg-blue-50 text-blue-700 font-semibold'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
          title="Group rows under bold account-name banners"
        >
          {groupByAccount ? '✓ Grouped by account' : 'Group by account'}
        </button>
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
            <h4 className="text-sm font-bold text-slate-700">New India Roster Member</h4>
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
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Project</label>
                <input value={draft.project} onChange={(e) => setDraft({ ...draft, project: e.target.value })} placeholder="e.g. QUData"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Status</label>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as IndiaRosterStatus })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5">
                  {INDIA_ROSTER_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Cost / hr (USD)</label>
                <input type="number" value={draft.cost_per_hour} onChange={(e) => setDraft({ ...draft, cost_per_hour: Number(e.target.value) })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Bill Rate / hr (USD)</label>
                <input type="number" value={draft.bill_rate} onChange={(e) => setDraft({ ...draft, bill_rate: Number(e.target.value) })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Start Date</label>
                <input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })}
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div className="col-span-2 md:col-span-3">
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Skills</label>
                <input value={draft.skills} onChange={(e) => setDraft({ ...draft, skills: e.target.value })} placeholder="e.g. Salesforce, LWC, Apex"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500 font-semibold">Email</label>
                <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="optional"
                  className="w-full text-xs border rounded px-2 py-1.5 mt-0.5" />
              </div>
            </div>
            {/* Live margin preview */}
            {draft.bill_rate > 0 && (
              <div className="text-[11px] text-slate-500">
                Margin preview:&nbsp;
                <strong className="text-slate-700">{calcMarginPercent(draft as any)}%</strong>&nbsp;
                (${calcMarginAbsolute(draft as any).toFixed(2)}/hr)
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

      {/* —— Reusable row + table —— */}
      {(() => null)()}

      {/* Active Roster */}
      <Card className="mb-4">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <h3 className="text-sm font-bold text-slate-700">Active Roster</h3>
            <span className="text-[11px] text-slate-500">
              {activeRows.length} billable {activeRows.length === 1 ? 'resource' : 'resources'} this month
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500">
                <SortHeader field="name" label="Name" />
                <SortHeader field="role" label="Role" />
                <SortHeader field="project" label="Project" />
                <SortHeader field="status" label="Status" />
                <SortHeader field="cost_per_hour" label="Cost/hr" align="right" />
                <SortHeader field="bill_rate" label="Bill Rate" align="right" />
                <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-[10px]" title="Auto-computed: (bill - cost) / bill × 100">Margin</th>
                <SortHeader field="start_date" label="Start Date" />
                <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-[10px]">Skills</th>
                <th className="px-3 py-2 text-center font-semibold uppercase tracking-wide text-[10px] w-10"></th>
              </tr>
            </thead>
            <tbody>
              {renderRowsGrouped(activeRows, groupByAccount, handleCellSave, removeMember, 10)}
              {activeRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                    {members.length === 0
                      ? 'No roster members yet. Click "Add Member" to start populating the India team.'
                      : 'No active (billable) resources match the current filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Inactive Positions — collapsed by default */}
      <Card>
        <button
          type="button"
          onClick={() => setShowInactive((v) => !v)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-50 rounded-lg transition-colors"
        >
          <div className="flex items-center gap-2">
            {showInactive ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <h3 className="text-sm font-bold text-slate-700">Inactive Positions</h3>
            <span className="text-[11px] text-slate-500">
              {inactiveRows.length} on bench / leave / notice
            </span>
          </div>
          <span className="text-[10px] text-slate-400 uppercase tracking-wide">
            {showInactive ? 'Click to collapse' : 'Click to expand'}
          </span>
        </button>
        {showInactive && (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-500">
                  <SortHeader field="name" label="Name" />
                  <SortHeader field="role" label="Role" />
                  <SortHeader field="project" label="Last Project" />
                  <SortHeader field="status" label="Status" />
                  <SortHeader field="cost_per_hour" label="Cost/hr" align="right" />
                  <SortHeader field="bill_rate" label="Bill Rate" align="right" />
                  <th className="px-3 py-2 text-right font-semibold uppercase tracking-wide text-[10px]">Margin</th>
                  <SortHeader field="start_date" label="Start Date" />
                  <th className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-[10px]">Skills</th>
                  <th className="px-3 py-2 text-center font-semibold uppercase tracking-wide text-[10px] w-10"></th>
                </tr>
              </thead>
              <tbody>
                {renderRowsGrouped(inactiveRows, groupByAccount, handleCellSave, removeMember, 10)}
                {inactiveRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-slate-400">
                      No inactive positions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* —— SharePoint sync banner ——
 * Shows when the india_roster was last touched by the scheduled SharePoint
 * sync (updated_by='sharepoint-sync' or 'sharepoint-sync-cron'). Surfaces the
 * source filename so it's obvious the table is auto-populated, not manually
 * entered.
 */
function SharePointSyncBanner({ members }: { members: any[] }) {
  // Use the most recent updated_at across all rows as the sync timestamp.
  // The scheduled sync touches every row each run.
  const lastSync = members
    .map(m => m.updated_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  if (!lastSync || members.length === 0) return null;

  const date = new Date(lastSync);
  const fmt = isNaN(date.getTime())
    ? lastSync
    : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-lg border border-blue-200 bg-blue-50/40 text-xs">
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/10 text-blue-600 font-bold text-[10px]">SP</span>
      <div className="flex-1">
        <div className="font-semibold text-slate-700">
          Synced from <span className="font-mono">Staffing Report India.xlsx</span> (Rupesh's OneDrive · /Finance/KPIs and Project Reports/Staffing report/)
        </div>
        <div className="text-slate-500">
          Last sync: <span className="font-medium text-slate-700">{fmt}</span> · Auto-syncs bi-weekly (1st &amp; 15th at 07:07 AM). To force a sync, open Claude → Scheduled tasks → "india-roster-sharepoint-sync" → Run now.
        </div>
      </div>
    </div>
  );
}

/* —— Grouped row renderer ——
 * When `grouped` is true, inserts a bold gradient banner row before each new
 * account/project. Banner shows: account name, headcount in this section,
 * total monthly revenue at 160 hrs/mo, and avg margin. Mirrors the India
 * Demand banner pattern.
 *
 * Assumes rows are already sorted by (project, then secondary key).
 */
function renderRowsGrouped(
  rows: any[],
  grouped: boolean,
  handleCellSave: (id: string, field: string, val: string | number) => void,
  removeMember: (id: string) => void,
  totalCols: number,
) {
  if (!grouped) {
    return rows.map((m) => renderMemberRow(m, handleCellSave, removeMember));
  }

  let prevProject: string | null = null;
  return rows.map((m, idx) => {
    const showHeader = m.project !== prevProject;
    prevProject = m.project;

    let sectionCount = 0;
    let sectionRevenue = 0;
    let sectionAvgMargin = 0;
    if (showHeader) {
      const same = rows.filter((x) => x.project === m.project);
      sectionCount = same.length;
      sectionRevenue = same.reduce((s, x) => s + (Number(x.bill_rate) || 0) * 160, 0);
      const withRate = same.filter((x) => x.bill_rate > 0);
      sectionAvgMargin = withRate.length
        ? Math.round(withRate.reduce((s, x) => s + calcMarginPercent(x), 0) / withRate.length)
        : 0;
    }

    return (
      <Fragment key={`row-${m.id}-${idx}`}>
        {showHeader && (
          <tr className="border-y-2 border-blue-200 bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50">
            <td colSpan={totalCols} className="py-2.5 px-3">
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-primary/15 text-primary flex-shrink-0">
                  <Building2 size={14} />
                </span>
                <span className="text-base font-extrabold text-slate-900 tracking-tight">
                  {m.project || '— Unassigned —'}
                </span>
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide">
                  {sectionCount} {sectionCount === 1 ? 'resource' : 'resources'}
                  {sectionRevenue > 0 && (
                    <>
                      <span className="text-slate-300 mx-1">·</span>
                      <span className="text-slate-700"><Sensitive>{`$${(sectionRevenue / 1000).toFixed(0)}k`}</Sensitive></span> /mo @160h
                    </>
                  )}
                  {sectionAvgMargin > 0 && (
                    <>
                      <span className="text-slate-300 mx-1">·</span>
                      avg margin <span className="text-slate-700"><Sensitive>{`${sectionAvgMargin}%`}</Sensitive></span>
                    </>
                  )}
                </span>
              </div>
            </td>
          </tr>
        )}
        {renderMemberRow(m, handleCellSave, removeMember)}
      </Fragment>
    );
  });
}

/* —— Reusable row renderer (used by both Active + Inactive tables) —— */
function renderMemberRow(
  m: any,
  handleCellSave: (id: string, field: string, val: string | number) => void,
  removeMember: (id: string) => void,
) {
  const marginPct = calcMarginPercent(m);
  const marginAbs = calcMarginAbsolute(m);
  const marginColor = marginPct >= 50 ? '#10b981' : marginPct >= 30 ? '#f59e0b' : marginPct > 0 ? '#ef4444' : '#94a3b8';
  return (
    <tr key={m.id} className="border-t border-slate-100 hover:bg-blue-50/30">
      <td className="px-3 py-2 font-medium text-slate-800">
        <EditableCell value={m.name} onSave={(v) => handleCellSave(m.id, 'name', v)} />
      </td>
      <td className="px-3 py-2">
        <EditableCell value={m.role} type="select" options={[...ROSTER_ROLES]} onSave={(v) => handleCellSave(m.id, 'role', v)} />
      </td>
      <td className="px-3 py-2">
        <EditableCell value={m.project} onSave={(v) => handleCellSave(m.id, 'project', v)} />
      </td>
      <td className="px-3 py-2">
        <EditableCell value={m.status} type="select" options={INDIA_ROSTER_STATUSES}
          onSave={(v) => handleCellSave(m.id, 'status', v)}
          displayContent={
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white" style={{ background: INDIA_ROSTER_STATUS_COLORS[m.status] || '#94a3b8' }}>
              {m.status}
            </span>
          }
        />
      </td>
      <td className="px-3 py-2 text-right">
        <Sensitive>
          <EditableCell value={m.cost_per_hour} type="number" onSave={(v) => handleCellSave(m.id, 'cost_per_hour', v)} prefix="$" />
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
          onClick={() => { if (confirm(`Remove ${m.name} from the roster?`)) removeMember(m.id); }}
          className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
          title="Remove member"
        >
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  );
}
