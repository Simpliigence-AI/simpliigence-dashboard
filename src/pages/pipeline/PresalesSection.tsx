/**
 * Presales Activities — tracker that lives inside the Pipeline page.
 *
 * Captures concrete presales initiatives the Solution Engineering team
 * commits to in the recurring sales↔SE sync: POCs, demos, points of view,
 * capability builds, research deep-dives.
 *
 * Two ways to add activities:
 *   1. "Log meeting" — paste Read.AI link / upload audio / paste notes →
 *      Claude (extract-presales-activities edge fn) suggests N line items,
 *      user reviews + saves.
 *   2. "+ Activity" — direct manual entry.
 *
 * Activities link to a Pipeline Project (optional) so revenue impact can
 * be tied back to specific opportunities.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Sparkles, Loader2, X, Save, Trash2, Mic, Square, Upload,
  Link as LinkIcon, ChevronDown, ChevronRight, AlertTriangle,
  Calendar, DollarSign, Briefcase, ListFilter, Search,
  Building2,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { usePresalesStore } from '../../store/usePresalesStore';
import { usePipelineStore } from '../../store/usePipelineStore';
import { fetchPresales, db } from '../../lib/supabaseSync';
import { Card } from '../../components/ui';
import { Sensitive } from '../../components/Sensitive';
import { UserPicker } from '../../components/UserPicker';
import {
  ACTIVITY_TYPES, PRIORITIES, ACTIVITY_STATUSES,
  ACTIVITY_TYPE_META, PRIORITY_META, STATUS_META,
} from '../../types/presales';
import type {
  PresalesActivity, ActivityType, Priority, ActivityStatus,
} from '../../types/presales';

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toFixed(0)}`;
}

function daysUntil(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const ms = new Date(dueDate).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.ceil(ms / 86400000);
}

export function PresalesSection() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const myEmail = (currentUser?.email || '').toLowerCase();

  const activities = usePresalesStore((s) => s.activities);
  const meetings = usePresalesStore((s) => s.meetings);
  const hydrate = usePresalesStore((s) => s.hydrate);
  const addActivity = usePresalesStore((s) => s.addActivity);
  const updateActivity = usePresalesStore((s) => s.updateActivity);
  const removeActivity = usePresalesStore((s) => s.removeActivity);
  const removeMeeting = usePresalesStore((s) => s.removeMeeting);

  const pipelineProjects = usePipelineStore((s) => s.projects);
  const projectsForLookup = useMemo(() => pipelineProjects.filter((p) => p.source === 'manual'), [pipelineProjects]);

  // Hydrate on mount (lazy — App.tsx doesn't fetch presales at boot)
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const data = await fetchPresales();
      if (!cancelled && data) hydrate(data.meetings, data.activities);
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [hydrate]);

  // Filters
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | ActivityType>('all');
  const [filterPriority, setFilterPriority] = useState<'all' | Priority>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | ActivityStatus>('open');
  const [filterOwner, setFilterOwner] = useState<string>('');
  const [filterProject, setFilterProject] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Modals
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [addingActivity, setAddingActivity] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const projectNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of pipelineProjects) m[p.id] = p.name;
    return m;
  }, [pipelineProjects]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return activities.filter((a) => {
      if (filterType !== 'all' && a.activityType !== filterType) return false;
      if (filterPriority !== 'all' && a.priority !== filterPriority) return false;
      if (filterStatus !== 'all' && a.status !== filterStatus) return false;
      if (filterOwner && (a.ownerEmail || '').toLowerCase() !== filterOwner.toLowerCase()) return false;
      if (filterProject !== 'all') {
        if (filterProject === '__none__' && a.pipelineProjectId) return false;
        if (filterProject !== '__none__' && a.pipelineProjectId !== filterProject) return false;
      }
      if (needle) {
        const hay = `${a.title} ${a.description ?? ''} ${a.accountName ?? ''} ${projectNameById[a.pipelineProjectId ?? ''] ?? ''} ${a.ownerEmail ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    }).sort((a, b) => {
      // Active first → high priority → soonest due → newest
      const sa = STATUS_META[a.status].rank;
      const sb = STATUS_META[b.status].rank;
      if (sa !== sb) return sa - sb;
      const pa = PRIORITY_META[a.priority].rank;
      const pb = PRIORITY_META[b.priority].rank;
      if (pa !== pb) return pa - pb;
      const da = a.dueDate ?? '9999-12-31';
      const db2 = b.dueDate ?? '9999-12-31';
      if (da !== db2) return da.localeCompare(db2);
      return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
    });
  }, [activities, search, filterType, filterPriority, filterStatus, filterOwner, filterProject, projectNameById]);

  // KPI strip
  const openCount = activities.filter((a) => a.status === 'open' || a.status === 'in_progress').length;
  const highPriorityOpen = activities.filter((a) => (a.status === 'open' || a.status === 'in_progress') && a.priority === 'high').length;
  const overdue = activities.filter((a) => {
    if (a.status === 'done' || a.status === 'cancelled') return false;
    const d = daysUntil(a.dueDate);
    return d != null && d < 0;
  }).length;
  const revenueImpactOpen = activities
    .filter((a) => (a.status === 'open' || a.status === 'in_progress') && Number.isFinite(a.revenueImpact ?? NaN))
    .reduce((s, a) => s + (a.revenueImpact ?? 0), 0);

  const owners = useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) if (a.ownerEmail) set.add(a.ownerEmail);
    return [...set].sort();
  }, [activities]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="mt-8">
      {/* Section header */}
      <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Sparkles size={18} className="text-violet-600" /> Presales Activities
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Track POCs, demos, points of view, capability builds, and research the SE team is committed to.
            Log a meeting to have Claude extract activities automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMeetingModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-violet-600 text-white hover:bg-violet-700 transition-colors"
          >
            <Sparkles size={14} /> Log presales meeting
          </button>
          <button
            type="button"
            onClick={() => setAddingActivity(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-primary text-white hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} /> Activity
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Open</div>
          <div className="text-xl font-extrabold text-slate-800">{openCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">of {activities.length} total</div>
        </div>
        <div className={`rounded-xl border p-3 ${highPriorityOpen > 0 ? 'border-rose-300 bg-rose-50/40' : 'border-slate-200 bg-white'}`}>
          <div className={`text-[10px] uppercase tracking-wider font-bold mb-1 ${highPriorityOpen > 0 ? 'text-rose-700' : 'text-slate-400'}`}>High priority</div>
          <div className={`text-xl font-extrabold ${highPriorityOpen > 0 ? 'text-rose-700' : 'text-slate-800'}`}>{highPriorityOpen}</div>
          <div className={`text-[10px] mt-0.5 ${highPriorityOpen > 0 ? 'text-rose-600' : 'text-slate-500'}`}>still open</div>
        </div>
        <div className={`rounded-xl border p-3 ${overdue > 0 ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
          <div className={`text-[10px] uppercase tracking-wider font-bold mb-1 ${overdue > 0 ? 'text-amber-700' : 'text-slate-400'}`}>Overdue</div>
          <div className={`text-xl font-extrabold ${overdue > 0 ? 'text-amber-700' : 'text-slate-800'}`}>{overdue}</div>
          <div className={`text-[10px] mt-0.5 ${overdue > 0 ? 'text-amber-600' : 'text-slate-500'}`}>past due date</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Revenue impact</div>
          <div className="text-xl font-extrabold text-slate-800"><Sensitive>{fmtMoney(revenueImpactOpen)}</Sensitive></div>
          <div className="text-[10px] text-slate-500 mt-0.5">across open items</div>
        </div>
      </div>

      {/* Filter bar */}
      <Card className="mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400" />
            <input
              placeholder="Search title / description / account / owner…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-slate-300 rounded-md pl-7 pr-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | ActivityStatus)} className="border border-slate-300 rounded-md px-2 py-1.5 text-xs">
            <option value="all">All statuses</option>
            {ACTIVITY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value as 'all' | Priority)} className="border border-slate-300 rounded-md px-2 py-1.5 text-xs">
            <option value="all">All priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
          </select>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value as 'all' | ActivityType)} className="border border-slate-300 rounded-md px-2 py-1.5 text-xs">
            <option value="all">All types</option>
            {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY_TYPE_META[t].label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1.5 rounded-md border transition-colors ${
              showFilters ? 'border-primary text-primary bg-primary/5' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ListFilter size={11} /> {showFilters ? 'Less' : 'More filters'}
          </button>
        </div>
        {showFilters && (
          <div className="flex items-center gap-2 flex-wrap mt-2 pt-2 border-t border-slate-100">
            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Owner</label>
            <select value={filterOwner} onChange={(e) => setFilterOwner(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-xs">
              <option value="">Any</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 ml-3">Project</label>
            <select value={filterProject} onChange={(e) => setFilterProject(e.target.value)} className="border border-slate-300 rounded-md px-2 py-1.5 text-xs">
              <option value="all">Any</option>
              <option value="__none__">— No project link —</option>
              {projectsForLookup.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => {
                setSearch(''); setFilterType('all'); setFilterPriority('all'); setFilterStatus('open'); setFilterOwner(''); setFilterProject('all');
              }}
              className="text-[10px] text-slate-500 hover:text-primary ml-2"
            >
              Reset all
            </button>
          </div>
        )}
      </Card>

      {/* Manual-add inline form */}
      {addingActivity && (
        <ActivityForm
          projects={projectsForLookup}
          createdBy={myEmail}
          onCancel={() => setAddingActivity(false)}
          onSubmit={async (row) => {
            await addActivity(row);
            setAddingActivity(false);
          }}
        />
      )}

      {/* Meeting log modal */}
      {meetingModalOpen && (
        <MeetingModal
          projects={projectsForLookup}
          createdBy={myEmail}
          onClose={() => setMeetingModalOpen(false)}
        />
      )}

      {/* Activity list */}
      {loading ? (
        <div className="py-8 text-center text-xs text-slate-400 inline-flex items-center gap-2 justify-center w-full">
          <Loader2 size={12} className="animate-spin" /> Loading presales activities…
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl bg-slate-50/40">
          {activities.length === 0
            ? <>No presales activities yet. Log a meeting or add one manually to get started.</>
            : <>No activities match the current filters.</>}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((a) => (
            <ActivityRow
              key={a.id}
              activity={a}
              projectName={a.pipelineProjectId ? projectNameById[a.pipelineProjectId] ?? null : null}
              meetingDate={a.meetingId ? meetings.find((m) => m.id === a.meetingId)?.meetingDate ?? null : null}
              isExpanded={expanded.has(a.id)}
              onToggleExpand={() => toggleExpand(a.id)}
              onUpdate={(patch) => updateActivity(a.id, patch)}
              onRemove={() => removeActivity(a.id)}
              projects={projectsForLookup}
            />
          ))}
        </div>
      )}

      {/* Recent meetings strip */}
      {meetings.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs uppercase tracking-wider font-bold text-slate-400 mb-2">Recent meetings ({meetings.length})</h3>
          <div className="space-y-1">
            {meetings.slice(0, 5).map((m) => {
              const linked = activities.filter((a) => a.meetingId === m.id).length;
              return (
                <div key={m.id} className="flex items-center justify-between text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5">
                  <span className="inline-flex items-center gap-2 truncate">
                    <Calendar size={11} className="text-slate-400" />
                    <span className="font-semibold text-slate-700">{m.meetingDate}</span>
                    {m.title && <span className="text-slate-500 truncate">· {m.title}</span>}
                    {m.attendees && <span className="text-slate-400 truncate">· {m.attendees}</span>}
                  </span>
                  <span className="inline-flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-slate-500">{linked} activit{linked === 1 ? 'y' : 'ies'}</span>
                    {m.sourceUrl && (
                      <a href={m.sourceUrl} target="_blank" rel="noreferrer" className="text-sky-600 hover:text-sky-800" title="Open source link">
                        <LinkIcon size={11} />
                      </a>
                    )}
                    <button
                      onClick={() => { if (confirm(`Delete meeting from ${m.meetingDate}? Linked activities will remain but lose their meeting reference.`)) removeMeeting(m.id); }}
                      className="text-red-400 hover:text-red-700" title="Delete meeting"
                    >
                      <Trash2 size={11} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Activity row (collapsed + expanded states) ─────────────────── */

function ActivityRow({ activity, projectName, meetingDate, isExpanded, onToggleExpand, onUpdate, onRemove, projects }: {
  activity: PresalesActivity;
  projectName: string | null;
  meetingDate: string | null;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (patch: Partial<PresalesActivity>) => Promise<void> | void;
  onRemove: () => Promise<void> | void;
  projects: Array<{ id: string; name: string }>;
}) {
  const typeMeta = ACTIVITY_TYPE_META[activity.activityType];
  const prioMeta = PRIORITY_META[activity.priority];
  const statusMeta = STATUS_META[activity.status];
  const days = daysUntil(activity.dueDate);
  const overdue = days != null && days < 0 && activity.status !== 'done' && activity.status !== 'cancelled';
  const urgentBorder = activity.priority === 'high' && (activity.status === 'open' || activity.status === 'in_progress');

  return (
    <div className={`rounded-xl border bg-white transition-all ${urgentBorder ? 'border-rose-300' : 'border-slate-200 hover:border-primary/30'}`}>
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full text-left p-3 flex items-start gap-3"
      >
        {isExpanded ? <ChevronDown size={14} className="text-slate-500 mt-0.5 flex-shrink-0" /> : <ChevronRight size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${typeMeta.cls}`}>{typeMeta.label}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${prioMeta.cls}`}>{prioMeta.label}</span>
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${statusMeta.cls}`}>{statusMeta.label}</span>
            <span className="font-semibold text-sm text-slate-800 truncate">{activity.title}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500 flex-wrap">
            {projectName && (
              <span className="inline-flex items-center gap-1">
                <Briefcase size={10} /> {projectName}
              </span>
            )}
            {activity.accountName && !projectName && (
              <span className="inline-flex items-center gap-1">
                <Building2 size={10} /> {activity.accountName}
              </span>
            )}
            {activity.ownerEmail && (
              <span className="truncate max-w-[180px]">@ {activity.ownerEmail}</span>
            )}
            {activity.dueDate && (
              <span className={`inline-flex items-center gap-1 ${overdue ? 'text-rose-600 font-semibold' : ''}`}>
                <Calendar size={10} /> {activity.dueDate}
                {days != null && (
                  <span className={overdue ? 'text-rose-600' : 'text-slate-400'}>
                    ({days === 0 ? 'today' : days > 0 ? `in ${days}d` : `${-days}d overdue`})
                  </span>
                )}
              </span>
            )}
            {activity.revenueImpact != null && (
              <span className="inline-flex items-center gap-1">
                <DollarSign size={10} /> <Sensitive>{fmtMoney(activity.revenueImpact)}</Sensitive>
              </span>
            )}
            {meetingDate && (
              <span className="inline-flex items-center gap-1 text-slate-400">
                <Sparkles size={10} /> from {meetingDate} meeting
              </span>
            )}
          </div>
        </div>
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-slate-100 pt-3">
          <ActivityForm
            projects={projects}
            createdBy={activity.createdBy ?? ''}
            initial={activity}
            onCancel={onToggleExpand}
            onSubmit={async (row) => {
              const patch: Partial<PresalesActivity> = {
                title: row.title,
                description: row.description,
                activityType: row.activityType,
                priority: row.priority,
                status: row.status,
                ownerEmail: row.ownerEmail,
                dueDate: row.dueDate,
                revenueImpact: row.revenueImpact,
                pipelineProjectId: row.pipelineProjectId,
                accountName: row.accountName,
                notes: row.notes,
              };
              await onUpdate(patch);
              onToggleExpand();
            }}
            onRemove={async () => {
              if (confirm(`Delete activity "${activity.title}"?`)) {
                await onRemove();
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ── Reusable activity form (used both inline create + expanded edit) ── */

interface ActivityFormValues {
  title: string;
  description: string | null;
  activityType: ActivityType;
  priority: Priority;
  status: ActivityStatus;
  ownerEmail: string | null;
  dueDate: string | null;
  revenueImpact: number | null;
  pipelineProjectId: string | null;
  accountName: string | null;
  notes: string | null;
}

function ActivityForm({ projects, createdBy, initial, onSubmit, onCancel, onRemove }: {
  projects: Array<{ id: string; name: string }>;
  createdBy: string;
  initial?: PresalesActivity;
  onSubmit: (row: ActivityFormValues & { createdBy: string; meetingId?: string | null }) => Promise<void>;
  onCancel: () => void;
  onRemove?: () => Promise<void> | void;
}) {
  const [d, setD] = useState<ActivityFormValues>({
    title: initial?.title ?? '',
    description: initial?.description ?? null,
    activityType: initial?.activityType ?? 'POC',
    priority: initial?.priority ?? 'medium',
    status: initial?.status ?? 'open',
    ownerEmail: initial?.ownerEmail ?? null,
    dueDate: initial?.dueDate ?? null,
    revenueImpact: initial?.revenueImpact ?? null,
    pipelineProjectId: initial?.pipelineProjectId ?? null,
    accountName: initial?.accountName ?? null,
    notes: initial?.notes ?? null,
  });

  const submit = async () => {
    if (!d.title.trim()) return;
    await onSubmit({ ...d, title: d.title.trim(), createdBy, meetingId: initial?.meetingId ?? null });
  };

  return (
    <div className={`rounded-xl ${initial ? '' : 'bg-white border border-slate-200 p-3 mb-3'}`}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
        <div className="md:col-span-3">
          <Field label="Title *">
            <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })}
              placeholder="e.g. POC: claims-routing agent for Carrier"
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
          </Field>
        </div>
        <Field label="Type">
          <select value={d.activityType} onChange={(e) => setD({ ...d, activityType: e.target.value as ActivityType })}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white">
            {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY_TYPE_META[t].label}</option>)}
          </select>
        </Field>
        <Field label="Priority">
          <select value={d.priority} onChange={(e) => setD({ ...d, priority: e.target.value as Priority })}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white">
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as ActivityStatus })}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white">
            {ACTIVITY_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </Field>
        <Field label="Owner">
          <UserPicker
            value={d.ownerEmail}
            onChange={(email) => setD({ ...d, ownerEmail: email })}
            placeholder="— Pick a user —"
          />
        </Field>
        <Field label="Due date">
          <input type="date" value={d.dueDate ?? ''} onChange={(e) => setD({ ...d, dueDate: e.target.value || null })}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
        </Field>
        <Field label="Revenue impact ($)">
          <input type="number" min={0} step={1000} value={d.revenueImpact ?? ''} onChange={(e) => setD({ ...d, revenueImpact: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="e.g. 250000"
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
        </Field>
        <Field label="Pipeline project">
          <select value={d.pipelineProjectId ?? ''} onChange={(e) => setD({ ...d, pipelineProjectId: e.target.value || null })}
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs bg-white">
            <option value="">— None —</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label="Client / account">
          <input value={d.accountName ?? ''} onChange={(e) => setD({ ...d, accountName: e.target.value || null })}
            placeholder="e.g. Carrier"
            className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
        </Field>
        <div className="md:col-span-3">
          <Field label="Description">
            <textarea value={d.description ?? ''} onChange={(e) => setD({ ...d, description: e.target.value || null })}
              rows={3}
              placeholder="What's the deliverable, the why, and any constraints?"
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs resize-y" />
          </Field>
        </div>
        <div className="md:col-span-3">
          <Field label="Notes (internal)">
            <textarea value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value || null })}
              rows={2}
              placeholder="Status updates, blockers, links…"
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs resize-y" />
          </Field>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        {onRemove ? (
          <button type="button" onClick={onRemove}
            className="text-xs text-red-600 hover:text-red-800 inline-flex items-center gap-1">
            <Trash2 size={12} /> Delete
          </button>
        ) : <span />}
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel}
            className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
            <X size={12} /> Cancel
          </button>
          <button type="button" onClick={submit} disabled={!d.title.trim()}
            className="text-xs font-semibold bg-primary text-white px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1">
            <Save size={12} /> {initial ? 'Save changes' : 'Add activity'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Meeting modal: capture + AI extract + bulk-create activities ── */

interface SuggestedActivity {
  selected: boolean;
  title: string;
  description: string;
  activity_type: ActivityType;
  priority: Priority;
  owner_email: string | null;
  due_date: string | null;
  revenue_impact: number | null;
  account_name: string | null;
  pipeline_project_id: string | null;
}

function MeetingModal({ projects, createdBy, onClose }: {
  projects: Array<{ id: string; name: string }>;
  createdBy: string;
  onClose: () => void;
}) {
  const upsertMeeting = usePresalesStore((s) => s.upsertMeeting);
  const addActivities = usePresalesStore((s) => s.addActivities);

  const today = new Date().toISOString().slice(0, 10);
  const [d, setD] = useState({
    meetingDate: today,
    title: '',
    attendees: '',
    sourceUrl: '',
    recordingPath: null as string | null,
    rawNotes: '',
  });
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string>('');
  const [suggested, setSuggested] = useState<SuggestedActivity[]>([]);
  const [saving, setSaving] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        await uploadAudio(file);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch (e) {
      setError(`Mic access denied: ${(e as Error).message}`);
    }
  };
  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setRecording(false);
  };
  const uploadAudio = async (file: File) => {
    setUploading(true);
    setError(null);
    const path = await db.uploadPresalesRecording(file);
    setUploading(false);
    if (!path) { setError('Upload failed. See console for detail.'); return; }
    setD((cur) => ({ ...cur, recordingPath: path }));
  };

  const extract = async () => {
    if (!d.rawNotes.trim() && !d.recordingPath && !d.sourceUrl.trim()) {
      setError('Paste notes, upload a recording, or add a Read.AI link first.');
      return;
    }
    setExtracting(true);
    setError(null);
    // The edge fn doesn't fetch Read.AI URLs — pass any URL text into raw notes so Claude can at least know it.
    const linkLine = d.sourceUrl.trim() ? `Source URL: ${d.sourceUrl.trim()}` : '';
    const text = [linkLine, d.rawNotes].filter(Boolean).join('\n\n');
    const result = await db.extractPresalesActivities({
      meetingDate: d.meetingDate,
      attendees: d.attendees || undefined,
      text: text || undefined,
      audioPath: d.recordingPath || undefined,
      knownProjects: projects.map((p) => ({ id: p.id, name: p.name })),
    });
    setExtracting(false);
    if (!result) {
      setError('AI extract failed. Check the extract-presales-activities edge function logs.');
      return;
    }
    setSummary(result.summary);
    setSuggested(result.activities.map((a) => ({ ...a, selected: true })));
  };

  const saveAll = async () => {
    if (!d.meetingDate) { setError('Meeting date required.'); return; }
    setSaving(true);
    setError(null);
    try {
      const meeting = await upsertMeeting({
        meetingDate: d.meetingDate,
        title: d.title || null,
        attendees: d.attendees || null,
        sourceUrl: d.sourceUrl || null,
        recordingPath: d.recordingPath,
        rawNotes: d.rawNotes || null,
        summary: summary || null,
        createdBy,
      });
      const toCreate = suggested.filter((a) => a.selected && a.title.trim());
      if (toCreate.length > 0) {
        await addActivities(toCreate.map((a) => ({
          meetingId: meeting.id,
          pipelineProjectId: a.pipeline_project_id,
          accountName: a.account_name,
          title: a.title,
          description: a.description,
          activityType: a.activity_type,
          priority: a.priority,
          status: 'open' as const,
          ownerEmail: a.owner_email,
          dueDate: a.due_date,
          revenueImpact: a.revenue_impact,
          notes: null,
          createdBy,
        })));
      }
      onClose();
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-6">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-violet-600" />
            <h2 className="text-base font-bold text-slate-800">Log presales meeting</h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {/* Meeting metadata */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Field label="Date *">
              <input type="date" value={d.meetingDate} onChange={(e) => setD({ ...d, meetingDate: e.target.value })}
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
            </Field>
            <Field label="Title">
              <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })}
                placeholder="e.g. Sales ↔ SE weekly"
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
            </Field>
            <Field label="Attendees">
              <input value={d.attendees} onChange={(e) => setD({ ...d, attendees: e.target.value })}
                placeholder="Scott, Raghu, Manjunath…"
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
            </Field>
          </div>

          {/* Three input modes: link / upload / paste */}
          <div className="rounded-md border border-dashed border-slate-300 p-3 bg-slate-50/60 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 flex items-center gap-1">
                <LinkIcon size={11} /> Read.AI / Fireflies / Zoom link
              </label>
              <input value={d.sourceUrl} onChange={(e) => setD({ ...d, sourceUrl: e.target.value })}
                placeholder="https://app.read.ai/…"
                className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1 flex items-center gap-1">
                <Upload size={11} /> Upload meeting audio
              </label>
              <div className="flex items-center gap-2">
                <input type="file" accept="audio/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAudio(f); }}
                  className="text-xs flex-1" />
                {!recording ? (
                  <button type="button" onClick={startRecording}
                    className="text-[10px] font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 px-2 py-1 rounded inline-flex items-center gap-1">
                    <Mic size={10} /> Mic
                  </button>
                ) : (
                  <button type="button" onClick={stopRecording}
                    className="text-[10px] font-semibold text-white bg-red-600 hover:bg-red-700 px-2 py-1 rounded inline-flex items-center gap-1 animate-pulse">
                    <Square size={10} /> Stop
                  </button>
                )}
              </div>
              {uploading && <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-1"><Loader2 size={10} className="animate-spin" /> Uploading…</div>}
              {d.recordingPath && !uploading && <div className="text-[10px] text-emerald-700 mt-1 truncate">✓ {d.recordingPath.split('/').pop()}</div>}
            </div>
          </div>

          {/* Raw notes paste */}
          <div className="rounded-md border border-dashed border-indigo-200 bg-indigo-50/40 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">Paste raw notes</label>
              <button type="button" onClick={extract} disabled={extracting}
                className="text-[11px] font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-2.5 py-1 rounded inline-flex items-center gap-1">
                {extracting ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {extracting ? 'Extracting…' : 'AI extract activities'}
              </button>
            </div>
            <textarea value={d.rawNotes} onChange={(e) => setD({ ...d, rawNotes: e.target.value })}
              rows={4}
              placeholder="Paste the Read.AI summary / meeting transcript / your messy notes. Claude will extract discrete presales activities below."
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-xs resize-y" />
          </div>

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1.5 inline-flex items-center gap-1">
              <AlertTriangle size={12} /> {error}
            </div>
          )}

          {/* Summary + suggested activities */}
          {summary && (
            <div className="rounded-md border border-violet-200 bg-violet-50/50 p-3 text-xs text-slate-700">
              <div className="text-[10px] uppercase tracking-wider font-bold text-violet-700 mb-1">Meeting summary</div>
              {summary}
            </div>
          )}

          {suggested.length > 0 && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/30 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 mb-2">
                Suggested activities ({suggested.filter((a) => a.selected).length} selected)
              </div>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {suggested.map((a, i) => (
                  <SuggestedActivityRow
                    key={i}
                    value={a}
                    projects={projects}
                    onChange={(v) => setSuggested((cur) => cur.map((x, j) => j === i ? v : x))}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50/40 rounded-b-2xl">
          <button type="button" onClick={onClose}
            className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
            <X size={12} /> Cancel
          </button>
          <button type="button" onClick={saveAll} disabled={saving}
            className="text-xs font-semibold bg-violet-600 text-white px-3 py-1.5 rounded-md hover:bg-violet-700 disabled:opacity-40 inline-flex items-center gap-1">
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={12} />}
            Save meeting + {suggested.filter((a) => a.selected).length} activit{suggested.filter((a) => a.selected).length === 1 ? 'y' : 'ies'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SuggestedActivityRow({ value, projects, onChange }: {
  value: SuggestedActivity;
  projects: Array<{ id: string; name: string }>;
  onChange: (v: SuggestedActivity) => void;
}) {
  const set = <K extends keyof SuggestedActivity>(k: K, v: SuggestedActivity[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2.5">
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={value.selected} onChange={(e) => set('selected', e.target.checked)} className="mt-1" />
        <div className="flex-1 min-w-0">
          <input value={value.title} onChange={(e) => set('title', e.target.value)}
            className="w-full text-xs font-semibold border border-slate-200 rounded px-1.5 py-0.5" />
          <textarea value={value.description} onChange={(e) => set('description', e.target.value)}
            rows={2}
            className="w-full text-[11px] text-slate-700 border border-slate-200 rounded px-1.5 py-0.5 mt-1 resize-y" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mt-1.5">
            <select value={value.activity_type} onChange={(e) => set('activity_type', e.target.value as ActivityType)}
              className="text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white">
              {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{ACTIVITY_TYPE_META[t].label}</option>)}
            </select>
            <select value={value.priority} onChange={(e) => set('priority', e.target.value as Priority)}
              className="text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white">
              {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
            </select>
            <select value={value.pipeline_project_id ?? ''} onChange={(e) => set('pipeline_project_id', e.target.value || null)}
              className="text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white">
              <option value="">— No project —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="date" value={value.due_date ?? ''} onChange={(e) => set('due_date', e.target.value || null)}
              className="text-[10px] border border-slate-200 rounded px-1 py-0.5" />
            <input value={value.owner_email ?? ''} onChange={(e) => set('owner_email', e.target.value || null)}
              placeholder="owner@simpliigence.com"
              className="text-[10px] border border-slate-200 rounded px-1 py-0.5" />
            <input value={value.account_name ?? ''} onChange={(e) => set('account_name', e.target.value || null)}
              placeholder="Client name"
              className="text-[10px] border border-slate-200 rounded px-1 py-0.5" />
            <input type="number" min={0} step={1000} value={value.revenue_impact ?? ''}
              onChange={(e) => set('revenue_impact', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="Revenue $"
              className="text-[10px] border border-slate-200 rounded px-1 py-0.5" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
