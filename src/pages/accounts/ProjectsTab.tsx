/**
 * Current Projects tab on an Account.
 *
 * Hybrid data: shows roster-derived suggested projects (auto-detected from
 * India roster + US roster where project ∋ account name/aliases) AND lets
 * users add free-text projects with achievements / risks / blockers.
 *
 * Schema: account_projects(id, account_id, name, status, team_members[],
 * achievements, risks, blockers, start_date, target_end_date, notes, ts).
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { Plus, Trash2, Loader2, FolderKanban, AlertTriangle, CheckCircle2, Users } from 'lucide-react';
import { nanoid } from 'nanoid';
import { supabase, CLIENT_ID } from '../../lib/supabase';

type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'at_risk' | 'cancelled';

interface AccountProject {
  id: string;
  accountId: string;
  name: string;
  status: ProjectStatus;
  teamMembers: string[];
  achievements: string;
  risks: string;
  blockers: string;
  startDate: string | null;
  targetEndDate: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_STYLES: Record<ProjectStatus, string> = {
  active:    'bg-emerald-100 text-emerald-800',
  on_hold:   'bg-slate-100 text-slate-700',
  completed: 'bg-sky-100 text-sky-700',
  at_risk:   'bg-red-100 text-red-800',
  cancelled: 'bg-slate-100 text-slate-500',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowTo(row: any): AccountProject {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name ?? '',
    status: (row.status ?? 'active') as ProjectStatus,
    teamMembers: Array.isArray(row.team_members) ? row.team_members : [],
    achievements: row.achievements ?? '',
    risks: row.risks ?? '',
    blockers: row.blockers ?? '',
    startDate: row.start_date ?? null,
    targetEndDate: row.target_end_date ?? null,
    notes: row.notes ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(p: AccountProject) {
  return {
    id: p.id,
    account_id: p.accountId,
    name: p.name,
    status: p.status,
    team_members: p.teamMembers,
    achievements: p.achievements || '',
    risks: p.risks || '',
    blockers: p.blockers || '',
    start_date: p.startDate || null,
    target_end_date: p.targetEndDate || null,
    notes: p.notes || '',
    updated_by: CLIENT_ID,
    updated_at: new Date().toISOString(),
  };
}

interface SuggestedTeamMember {
  name: string;
  role: string;
  project: string;
  status: string;
  email: string;
}

export function ProjectsTab({
  accountId,
  accountName: _accountName,
  suggestedTeam,
}: {
  accountId: string;
  accountName: string;
  suggestedTeam: SuggestedTeamMember[];
}) {
  const [rows, setRows] = useState<AccountProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Group roster members by their project value to surface "suggested" projects
  // that the user can promote into a real row with one click.
  const suggestions = useMemo(() => {
    const byProject = new Map<string, SuggestedTeamMember[]>();
    for (const m of suggestedTeam) {
      if (!m.project) continue;
      const arr = byProject.get(m.project) || [];
      arr.push(m);
      byProject.set(m.project, arr);
    }
    return Array.from(byProject.entries())
      .map(([project, members]) => ({ project, members }))
      .sort((a, b) => b.members.length - a.members.length);
  }, [suggestedTeam]);

  const existingProjectNames = useMemo(
    () => new Set(rows.map((r) => r.name.trim().toLowerCase())),
    [rows],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase
      .from('account_projects')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true });
    if (e) { setError(e.message); setLoading(false); return; }
    setRows((data ?? []).map(rowTo));
    setLoading(false);
  }, [accountId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const ch = supabase
      .channel(`projects-${accountId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'account_projects', filter: `account_id=eq.${accountId}` },
        () => { void refresh(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [accountId, refresh]);

  const setSaving = (id: string, on: boolean) =>
    setSavingIds((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  const save = async (p: AccountProject) => {
    setSaving(p.id, true);
    const { error: e } = await supabase.from('account_projects').upsert(toRow(p), { onConflict: 'id' });
    setSaving(p.id, false);
    if (e) setError(e.message);
  };
  const patch = (id: string, p: Partial<AccountProject>) =>
    setRows((r) => r.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const addBlank = (initial?: Partial<AccountProject>) => {
    const now = new Date().toISOString();
    const p: AccountProject = {
      id: nanoid(),
      accountId,
      name: '',
      status: 'active',
      teamMembers: [],
      achievements: '',
      risks: '',
      blockers: '',
      startDate: null,
      targetEndDate: null,
      notes: '',
      createdAt: now,
      updatedAt: now,
      ...initial,
    };
    setRows((r) => [...r, p]);
    if (p.name.trim()) void save(p);
  };
  const promoteSuggestion = (project: string, members: SuggestedTeamMember[]) => {
    addBlank({ name: project, teamMembers: members.map((m) => m.name) });
  };
  const remove = async (id: string) => {
    setRows((r) => r.filter((x) => x.id !== id));
    const { error: e } = await supabase.from('account_projects').delete().eq('id', id);
    if (e) setError(e.message);
  };

  if (loading) return (
    <div className="py-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
      <Loader2 size={14} className="animate-spin" /> Loading projects…
    </div>
  );

  const unpromoted = suggestions.filter((s) => !existingProjectNames.has(s.project.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-slate-500">
          Active engagements with this account — team, achievements, risks, blockers. Pulled-from-roster suggestions appear below.
        </div>
        <button type="button" onClick={() => addBlank()}
                className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 inline-flex items-center gap-1">
          <Plus size={12} /> Add project
        </button>
      </div>
      {error && <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-[11px] text-red-700">{error}</div>}

      {unpromoted.length > 0 && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-3 space-y-2">
          <div className="text-[11px] font-semibold text-violet-700 uppercase tracking-wider inline-flex items-center gap-1">
            <Users size={11} /> Suggested from roster ({unpromoted.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {unpromoted.map((s) => (
              <button
                key={s.project}
                type="button"
                onClick={() => promoteSuggestion(s.project, s.members)}
                className="text-[11px] inline-flex items-center gap-1 bg-white border border-violet-200 hover:border-violet-400 text-slate-700 hover:text-violet-700 rounded px-2 py-1"
                title="Click to add this as a project with the matched team members"
              >
                <Plus size={10} className="text-violet-500" /> {s.project}
                <span className="text-[10px] text-slate-500 ml-1">{s.members.length} member{s.members.length === 1 ? '' : 's'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-lg">
          No projects yet. Click <strong>+ Add project</strong>, or promote one from the suggestions above.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => {
            const saving = savingIds.has(p.id);
            const blur = () => { if (p.name.trim()) void save(p); };
            return (
              <div key={p.id} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <FolderKanban size={16} className="text-indigo-500 flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <input value={p.name}
                             onChange={(e) => patch(p.id, { name: e.target.value })}
                             onBlur={blur}
                             placeholder="Project name *"
                             className="flex-1 text-sm font-semibold text-slate-900 border border-transparent hover:border-slate-300 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rounded px-2 py-1" />
                      <select value={p.status}
                              onChange={(e) => { const s = e.target.value as ProjectStatus; patch(p.id, { status: s }); if (p.name.trim()) void save({ ...p, status: s }); }}
                              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full border-0 cursor-pointer ${STATUS_STYLES[p.status]}`}>
                        <option value="active">Active</option>
                        <option value="at_risk">At Risk</option>
                        <option value="on_hold">On Hold</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[11px] text-slate-500">
                      <span>Start <input type="date" value={p.startDate ?? ''} onChange={(e) => patch(p.id, { startDate: e.target.value || null })} onBlur={blur} className="ml-1 px-1 py-0.5 border border-slate-200 rounded text-[11px]" /></span>
                      <span>Target end <input type="date" value={p.targetEndDate ?? ''} onChange={(e) => patch(p.id, { targetEndDate: e.target.value || null })} onBlur={blur} className="ml-1 px-1 py-0.5 border border-slate-200 rounded text-[11px]" /></span>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {saving ? <Loader2 size={12} className="animate-spin text-slate-400" /> : (
                      <button type="button"
                              onClick={() => { if (confirm(`Remove project "${p.name || 'this project'}"?`)) void remove(p.id); }}
                              className="text-slate-300 hover:text-red-600 p-1 rounded hover:bg-red-50">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider inline-flex items-center gap-1 mb-1">
                    <Users size={10} /> Team ({p.teamMembers.length})
                  </label>
                  <input
                    value={p.teamMembers.join(', ')}
                    onChange={(e) => patch(p.id, { teamMembers: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    onBlur={blur}
                    placeholder="Comma-separated names — Anupama, Manjunath, …"
                    className="w-full text-xs text-slate-700 border border-slate-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 rounded px-2 py-1.5"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider inline-flex items-center gap-1 mb-1">
                      <CheckCircle2 size={10} /> Achievements
                    </label>
                    <textarea value={p.achievements} onChange={(e) => patch(p.id, { achievements: e.target.value })} onBlur={blur}
                              placeholder="Wins, milestones, customer compliments…"
                              rows={3}
                              className="w-full text-[11px] text-slate-700 border border-slate-200 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 rounded px-2 py-1.5 resize-y" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider inline-flex items-center gap-1 mb-1">
                      <AlertTriangle size={10} /> Risks
                    </label>
                    <textarea value={p.risks} onChange={(e) => patch(p.id, { risks: e.target.value })} onBlur={blur}
                              placeholder="Things that might go wrong if unaddressed…"
                              rows={3}
                              className="w-full text-[11px] text-slate-700 border border-slate-200 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100 rounded px-2 py-1.5 resize-y" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-red-700 uppercase tracking-wider inline-flex items-center gap-1 mb-1">
                      <AlertTriangle size={10} /> Blockers
                    </label>
                    <textarea value={p.blockers} onChange={(e) => patch(p.id, { blockers: e.target.value })} onBlur={blur}
                              placeholder="Things blocking progress NOW…"
                              rows={3}
                              className="w-full text-[11px] text-slate-700 border border-slate-200 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 rounded px-2 py-1.5 resize-y" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
