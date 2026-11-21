/**
 * Project Plans — every delivery project, grouped the way the business runs:
 * Strategic Accounts (projects clubbed under each client account), SMB and
 * Strategic Placement. Per project: plan progress, late tasks, open and
 * suggested issues, and this week's check-in against its owner.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ClipboardList, Search, AlertTriangle, Loader2, ChevronRight, ChevronDown, Plus, Mail, Building2, Sparkles, Pencil, Trash2, X } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, EmptyState, Button } from '../components/ui';
import { NewProjectDialog } from './project-plans/NewProjectDialog';
import { DigestPanel } from './project-plans/DigestPanel';
import { useDeliveryStore } from '../store/useDeliveryStore';
import { useTabPermission } from '../hooks/useTabPermission';
import { fmtDate, HEALTH } from '../lib/deliveryPlan';
import { alertError } from '../lib/planToast';
import { SEGMENTS, useDeliveryAccounts, checkinState, CHECKIN_STYLE, firstName, type CheckinState } from '../lib/deliveryRebuild';
import type { DeliveryProject, DeliverySegment, DeliveryAccount } from '../types/delivery';
import type { PlanSummary } from '../store/useDeliveryStore';

type Filter = 'active' | 'completed' | 'all';
const UNASSIGNED = '__none__';

export default function ProjectPlansPage() {
  const perm = useTabPermission('project-plans');
  const { projects, summaries, loading, error, loadProjects } = useDeliveryStore();
  const { accounts, load: loadAccounts } = useDeliveryAccounts();
  const [filter, setFilter] = useState<Filter>('active');
  const [segment, setSegment] = useState<DeliverySegment | 'all'>('all');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [digest, setDigest] = useState(false);
  const [managing, setManaging] = useState(false);

  useEffect(() => {
    if (!perm.canView) return;
    void loadProjects();
    loadAccounts().catch(alertError);
  }, [perm.canView, loadProjects, loadAccounts]);

  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return projects
      .filter((p) => (filter === 'all' ? true : filter === 'active' ? p.status === 'active' || p.status === 'on_hold' : p.status === 'completed' || p.status === 'cancelled'))
      .filter((p) => segment === 'all' || accById.get(p.accountId ?? '')?.segment === segment)
      .filter((p) => !needle || [p.name, p.client, p.pm, p.deliveryLead, accById.get(p.accountId ?? '')?.name].some((v) => v?.toLowerCase().includes(needle)));
  }, [projects, filter, segment, q, accById]);

  if (!perm.loading && !perm.canView) return <Navigate to="/" replace />;

  const unassigned = visible.filter((p) => !p.accountId || !accById.has(p.accountId));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Delivery" tone="brand" title="Project Plans"
        subtitle="Strategic accounts, SMB and strategic placements — plans, issues and weekly check-ins in one place." />

      <Portfolio projects={projects} summaries={summaries} accounts={accounts} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {(['active', 'completed', 'all'] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md capitalize ${filter === f ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}>{f}</button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          {([['all', 'All segments'], ...SEGMENTS.map((s) => [s.key, s.label])] as [DeliverySegment | 'all', string][]).map(([k, label]) => (
            <button key={k} onClick={() => setSegment(k)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md ${segment === k ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}>{label}</button>
          ))}
        </div>
        <label className="relative flex-1 min-w-[12rem] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/70" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project, account or PM"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-line bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30" />
        </label>
        <div className="ml-auto flex gap-2">
          {perm.canEdit && <Button variant="ghost" onClick={() => setManaging(true)}><Building2 size={14} /> Accounts</Button>}
          {perm.canApprove && <Button variant="ghost" onClick={() => setDigest(true)}><Mail size={14} /> Email digest</Button>}
          {perm.canEdit && <Button onClick={() => setCreating(true)}><Plus size={14} /> New project</Button>}
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose/30 bg-rose/5 px-4 py-3 text-sm text-rose">{error}</div>}
      <NewProjectDialog open={creating} onClose={() => setCreating(false)} />
      {digest && <DigestPanel onClose={() => setDigest(false)} />}
      {managing && <AccountsDialog onClose={() => setManaging(false)} />}

      {loading && projects.length === 0 ? (
        <Card><div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Loading plans…</div></Card>
      ) : visible.length === 0 ? (
        <Card><EmptyState icon={<ClipboardList size={36} />} title="No projects here" description={q ? 'Nothing matches that search.' : 'No projects in this view yet.'} /></Card>
      ) : (
        <div className="space-y-6">
          {SEGMENTS.filter((s) => segment === 'all' || s.key === segment).map((s) => {
            const segAccounts = accounts.filter((a) => a.segment === s.key);
            const groups = segAccounts
              .map((a) => ({ account: a, rows: visible.filter((p) => p.accountId === a.id) }))
              .filter((g) => g.rows.length > 0);
            if (!groups.length) return null;
            const n = groups.reduce((m, g) => m + g.rows.length, 0);
            return (
              <section key={s.key} className="space-y-3">
                <div className="flex items-baseline gap-3">
                  <h2 className="text-lg font-bold text-ink">{s.label}</h2>
                  <span className="text-xs text-muted">{n} project{n === 1 ? '' : 's'} · {groups.length} account{groups.length === 1 ? '' : 's'}</span>
                </div>
                <Card flush>
                  <PlansTable groups={groups} summaries={summaries} showAccountHeaders={s.key === 'strategic' || groups.some((g) => g.rows.length > 1)} />
                </Card>
              </section>
            );
          })}
          {unassigned.length > 0 && segment === 'all' && (
            <section className="space-y-3">
              <div className="flex items-baseline gap-3">
                <h2 className="text-lg font-bold text-ink">No account yet</h2>
                <span className="text-xs text-muted">Open a project and pick its account</span>
              </div>
              <Card flush><PlansTable groups={[{ account: { id: UNASSIGNED, name: 'Unassigned', segment: 'smb', conciergeAccountId: null, sortOrder: 999 }, rows: unassigned }]} summaries={summaries} showAccountHeaders={false} /></Card>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function PlansTable({ groups, summaries, showAccountHeaders }: { groups: { account: DeliveryAccount; rows: DeliveryProject[] }[]; summaries: Record<string, PlanSummary>; showAccountHeaders: boolean }) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="px-5 py-3 font-semibold">Project</th>
            <th className="px-3 py-3 font-semibold">PM</th>
            <th className="px-3 py-3 font-semibold">End</th>
            <th className="px-3 py-3 font-semibold w-36">Plan</th>
            <th className="px-3 py-3 font-semibold text-right">Late</th>
            <th className="px-3 py-3 font-semibold text-right">Issues</th>
            <th className="px-3 py-3 font-semibold text-right" title="Issues pulled from email, Teams, Slack and status reports, waiting for the PM">Suggested</th>
            <th className="px-3 py-3 font-semibold">Weekly check-in</th>
            <th className="w-8 pr-4" />
          </tr>
        </thead>
        <tbody>
          {groups.map(({ account, rows }) => {
            const open = !collapsed[account.id];
            const issues = rows.reduce((m, p) => m + (summaries[p.id]?.openIssues ?? 0), 0);
            return [
              showAccountHeaders && (
                <tr key={`h-${account.id}`} className="bg-surface-2/60 border-b border-line/60 cursor-pointer" onClick={() => setCollapsed((c) => ({ ...c, [account.id]: open }))}>
                  <td colSpan={9} className="px-5 py-2">
                    <span className="inline-flex items-center gap-2 font-bold text-ink">
                      {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                      <Building2 size={14} className="text-muted" /> {account.name}
                      <span className="text-xs font-normal text-muted">{rows.length} project{rows.length === 1 ? '' : 's'}{issues ? ` · ${issues} open issue${issues === 1 ? '' : 's'}` : ''}</span>
                    </span>
                  </td>
                </tr>
              ),
              ...(open || !showAccountHeaders ? rows.map((p) => <PlanRow key={p.id} p={p} s={summaries[p.id]} indent={showAccountHeaders} onOpen={() => navigate(`/project-plans/${p.id}`)} />) : []),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function PlanRow({ p, s, indent, onOpen }: { p: DeliveryProject; s: PlanSummary | undefined; indent: boolean; onOpen: () => void }) {
  const pct = s && s.tasks ? Math.round((s.done / s.tasks) * 100) : 0;
  const end = p.currentEnd ?? p.plannedEnd ?? s?.planEnd ?? null;
  const ck: CheckinState = checkinState(s?.lastCheckin ?? null, p.status === 'active');
  return (
    <tr onClick={onOpen} className="border-b border-line/40 hover:bg-surface-2/50 cursor-pointer">
      <td className={`py-3 ${indent ? 'pl-11' : 'pl-5'} pr-3`}>
        {p.health && <span title={HEALTH[p.health].label} className={`inline-block h-2 w-2 rounded-full mr-2 ${HEALTH[p.health].dot}`} />}
        <Link to={`/project-plans/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-ink hover:text-primary">{p.name}</Link>
        {p.status === 'on_hold' && <span className="ml-2 text-[11px] font-semibold text-amber-600">On hold</span>}
        {(p.status === 'completed' || p.status === 'cancelled') && <span className="ml-2 text-[11px] font-semibold text-muted capitalize">{p.status}</span>}
      </td>
      <td className="px-3 py-3 text-ink/80 whitespace-nowrap">{p.pm ?? '—'}</td>
      <td className="px-3 py-3 tabular-nums text-muted whitespace-nowrap">{fmtDate(end)}</td>
      <td className="px-3 py-3">
        {s && s.tasks ? (
          <div>
            <div className="flex justify-between text-[10px] text-muted mb-0.5 tabular-nums"><span>{s.done}/{s.tasks}</span><span>{pct}%</span></div>
            <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden"><div className="h-full bg-green rounded-full" style={{ width: `${pct}%` }} /></div>
          </div>
        ) : <span className="text-xs text-muted/70">No plan</span>}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{s?.late ? <span className="font-semibold text-rose">{s.late}</span> : <span className="text-muted/60">0</span>}</td>
      <td className="px-3 py-3 text-right tabular-nums">
        {s?.openIssues ? <span className="inline-flex items-center gap-1">{s.criticalIssues > 0 && <AlertTriangle size={12} className="text-rose" />}{s.openIssues}</span> : <span className="text-muted/60">0</span>}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {s?.suggested ? <span className="inline-flex items-center gap-1 font-semibold text-violet-600"><Sparkles size={12} />{s.suggested}</span> : <span className="text-muted/60">0</span>}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        {ck === 'na' ? <span className="text-muted/60 text-xs">—</span> : (
          <span className="inline-flex items-center gap-2 text-xs">
            <span className={`px-2 py-0.5 rounded-md font-bold ring-1 ring-inset ${CHECKIN_STYLE[ck].cls}`}>{CHECKIN_STYLE[ck].label}</span>
            <span className="text-muted">{firstName(p.checkinOwner)}</span>
          </span>
        )}
      </td>
      <td className="pr-4 text-muted/60"><ChevronRight size={16} /></td>
    </tr>
  );
}

/** KPI strip across active projects, split by segment. */
function Portfolio({ projects, summaries, accounts }: { projects: DeliveryProject[]; summaries: Record<string, PlanSummary>; accounts: DeliveryAccount[] }) {
  const active = projects.filter((p) => p.status === 'active');
  if (!active.length) return null;
  const seg = new Map(accounts.map((a) => [a.id, a.segment]));
  const count = (k: DeliverySegment) => active.filter((p) => seg.get(p.accountId ?? '') === k).length;
  const sum = (k: keyof PlanSummary) => active.reduce((n, p) => n + (Number(summaries[p.id]?.[k]) || 0), 0);
  const states = active.map((p) => checkinState(summaries[p.id]?.lastCheckin ?? null, true));
  const done = states.filter((x) => x === 'done').length;
  const overdue = states.filter((x) => x === 'overdue').length;
  const tiles: [string, string, string?, boolean?][] = [
    ['Active projects', String(active.length), `${count('strategic')} strategic · ${count('smb')} SMB · ${count('placement')} placement`],
    ['Late tasks', String(sum('late')), undefined, sum('late') > 0],
    ['High / critical issues', String(sum('criticalIssues')), `${sum('openIssues')} open in total`, sum('criticalIssues') > 0],
    ['Suggested issues', String(sum('suggested')), 'From email, Teams, Slack, status reports'],
    ['Check-ins this week', `${done}/${active.length}`, overdue ? `${overdue} overdue` : 'Due Fridays', overdue > 0],
    ['CRs awaiting sign-off', String(sum('pendingCrs'))],
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {tiles.map(([label, value, sub, bad]) => (
        <div key={label} className="rounded-xl border border-line/70 bg-surface px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</div>
          <div className={`mt-1 text-2xl font-bold tabular-nums ${bad ? 'text-rose' : 'text-ink'}`}>{value}</div>
          {sub && <div className="text-[11px] text-muted">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** Create, rename, re-segment and remove accounts. */
function AccountsDialog({ onClose }: { onClose: () => void }) {
  const { accounts, save, remove } = useDeliveryAccounts();
  const projects = useDeliveryStore((s) => s.projects);
  const [name, setName] = useState('');
  const [seg, setSeg] = useState<DeliverySegment>('strategic');
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-ink">Accounts</h2>
          <button onClick={onClose} className="text-muted hover:text-ink"><X size={18} /></button>
        </div>
        <form className="flex flex-wrap gap-2 mb-5" onSubmit={async (e) => {
          e.preventDefault();
          try { await save({ name, segment: seg }); setName(''); } catch (err) { alertError(err); }
        }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New account name" className="flex-1 min-w-[12rem] rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          <select value={seg} onChange={(e) => setSeg(e.target.value as DeliverySegment)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            {SEGMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <Button type="submit" disabled={!name.trim()}><Plus size={14} /> Add</Button>
        </form>
        {SEGMENTS.map((s) => (
          <div key={s.key} className="mb-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">{s.label}</div>
            <div className="divide-y divide-line/50 rounded-lg border border-line/70">
              {accounts.filter((a) => a.segment === s.key).map((a) => {
                const n = projects.filter((p) => p.accountId === a.id).length;
                return (
                  <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    {editing === a.id ? (
                      <AccountEditor a={a} onDone={() => setEditing(null)} />
                    ) : (
                      <>
                        <span className="font-semibold text-ink flex-1">{a.name}</span>
                        <span className="text-xs text-muted">{n} project{n === 1 ? '' : 's'}</span>
                        <button title="Rename or move" onClick={() => setEditing(a.id)} className="text-muted hover:text-ink"><Pencil size={14} /></button>
                        <button title={n ? 'Move its projects first' : 'Delete account'} disabled={n > 0}
                          onClick={() => { if (window.confirm(`Delete account “${a.name}”?`)) remove(a.id).catch(alertError); }}
                          className="text-muted hover:text-rose disabled:opacity-30"><Trash2 size={14} /></button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountEditor({ a, onDone }: { a: DeliveryAccount; onDone: () => void }) {
  const save = useDeliveryAccounts((s) => s.save);
  const [name, setName] = useState(a.name);
  const [seg, setSeg] = useState<DeliverySegment>(a.segment);
  return (
    <form className="flex flex-1 gap-2" onSubmit={async (e) => { e.preventDefault(); try { await save({ id: a.id, name, segment: seg }); onDone(); } catch (err) { alertError(err); } }}>
      <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm" autoFocus />
      <select value={seg} onChange={(e) => setSeg(e.target.value as DeliverySegment)} className="rounded-lg border border-line bg-surface px-2 py-1 text-sm">
        {SEGMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
      <Button type="submit" size="sm">Save</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
    </form>
  );
}
