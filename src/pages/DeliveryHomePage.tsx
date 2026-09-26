/**
 * Delivery Home — one page that says where delivery needs attention.
 *
 *   Current projects     every project in flight, with its flags
 *   Not allocated        nobody booked, or months in the project window with no hours
 *   Pods under 50%       any month touching the next 60 days
 *   Docs missing         plan says requirements / design are done (or due) but the
 *                        requirements, design or user-story documents aren't uploaded
 *   Meeting cadence      no recording in 14 days, or nothing booked in the next 14
 *   Issues to close      open issues that are overdue, unowned or undated
 *   Timeline breaches    delayed status, phases / tasks past end, go-live or end passed
 *   Upcoming meetings    every project meeting from Sujatha's, Anupama's and the team's
 *                        Outlook calendars, as a month calendar or an agenda
 *
 * All the rules live in SQL (v_delivery_home_projects, v_delivery_pod_util —
 * migration 040) so this page only lays them out.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Loader2, RefreshCw, FolderKanban, UserX, Gauge, FileWarning, CalendarX, Flag, AlarmClock, CalendarDays, ChevronRight, ShieldAlert,
} from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Badge, Button } from '../components/ui';
import { MeetingCalendar } from '../components/delivery/MeetingCalendar';
import { useTabPermission } from '../hooks/useTabPermission';
import { fmtDate } from '../lib/deliveryPlan';
import {
  loadHomeProjects, loadPodUtil, loadOpenIssues, loadEvents, loadMailboxes, syncCalendars, fmtAgo, fmtIn,
  AZURE_APP_PERMISSIONS_URL, type HomeProject, type PodMonth, type OpenIssue, type CalendarEvent, type Mailbox,
} from '../lib/deliveryHome';

const POD_LOW = 50;
const todayIso = () => new Date().toISOString().slice(0, 10);

type SectionKey = 'projects' | 'alloc' | 'pods' | 'docs' | 'cadence' | 'issues' | 'timeline' | 'calendar';

export default function DeliveryHomePage() {
  const perm = useTabPermission('project-plans');
  const [projects, setProjects] = useState<HomeProject[]>([]);
  const [pods, setPods] = useState<PodMonth[]>([]);
  const [issues, setIssues] = useState<OpenIssue[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState('all');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [showUntagged, setShowUntagged] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, pd, is, ev, mb] = await Promise.all([loadHomeProjects(), loadPodUtil(), loadOpenIssues(), loadEvents(), loadMailboxes()]);
      setProjects(p); setPods(pd); setIssues(is); setEvents(ev); setMailboxes(mb);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (perm.canView) void load(); }, [perm.canView, load]);

  const owners = useMemo(() => [...new Set(projects.map((p) => normOwner(p.owner)).filter(Boolean))].sort(), [projects]);
  const shown = useMemo(() => projects.filter((p) => owner === 'all' || normOwner(p.owner) === owner), [projects, owner]);
  const planIds = useMemo(() => new Set(shown.map((p) => p.planId).filter(Boolean) as string[]), [shown]);
  const projectNames = useMemo(() => Object.fromEntries(projects.filter((p) => p.planId).map((p) => [p.planId!, p.name])), [projects]);
  const byPlan = useMemo(() => new Map(projects.filter((p) => p.planId).map((p) => [p.planId!, p])), [projects]);

  const unallocated = shown.filter((p) => p.allocState !== 'ok');
  const lowPods = useMemo(() => {
    const m = new Map<string, PodMonth[]>();
    for (const r of pods) { if (!m.has(r.pod)) m.set(r.pod, []); m.get(r.pod)!.push(r); }
    return [...m.entries()].filter(([, rows]) => rows.some((r) => r.pct < POD_LOW));
  }, [pods]);
  const docGaps = shown.filter((p) => p.docGap);
  const cadence = shown.filter((p) => p.cadenceGap);
  const followUps = issues.filter((i) => planIds.has(i.projectId) && (!i.dueDate || i.dueDate < todayIso() || !i.owner?.trim() || i.criticality === 'critical' || i.criticality === 'high'));
  const breaches = shown.filter((p) => p.breachReasons.length > 0);
  const tagged = useMemo(() => events.filter((e) => e.projectId && planIds.has(e.projectId)), [events, planIds]);
  const untaggedAll = useMemo(() => events.filter((e) => !e.projectId && e.isExternal && e.matchSource !== 'ignored'), [events]);
  const calEvents = showUntagged ? [...tagged, ...untaggedAll] : tagged;
  const nowIso = new Date().toISOString();
  const upcoming = tagged.filter((e) => e.startAt >= nowIso && !e.isCancelled && e.matchSource !== 'ignored');
  const untagged = untaggedAll.filter((e) => e.startAt >= nowIso && !e.isCancelled);

  const calendarBlocked = mailboxes.find((m) => m.lastError && /can.t read calendars/i.test(m.lastError))?.lastError
    ?? (syncMsg && /can.t read calendars/i.test(syncMsg) ? syncMsg : null);
  const lastSync = mailboxes.reduce<string | null>((m, b) => (b.lastSyncedAt && (!m || b.lastSyncedAt > m) ? b.lastSyncedAt : m), null);

  const runSync = async () => {
    setSyncing(true); setSyncMsg(null);
    try { const r = await syncCalendars(); setSyncMsg(`Read ${r.mailboxes} calendars · ${r.events} events${r.errors ? ` · ${r.errors} couldn’t be read` : ''}`); await load(); }
    catch (e) { setSyncMsg((e as Error).message); await load(); }
    finally { setSyncing(false); }
  };

  if (!perm.loading && !perm.canView) return <Navigate to="/" replace />;
  if (loading) return <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Loading Delivery Home…</div>;

  const go = (k: SectionKey) => document.getElementById(`dh-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Delivery" tone="brand" title="Delivery Home"
        subtitle="Where every project stands, what needs follow-up, and what’s booked next."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className="text-sm rounded-lg border border-line bg-surface px-3 py-2">
              <option value="all">All owners</option>
              {owners.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <Button variant="secondary" onClick={runSync} disabled={syncing}>
              {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Sync calendars
            </Button>
          </div>
        }
      />

      {error && <div className="rounded-lg border border-rose/30 bg-rose/5 px-4 py-3 text-sm text-rose">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <Tile icon={<FolderKanban size={16} />} label="Current projects" value={shown.length} onClick={() => go('projects')} />
        <Tile icon={<UserX size={16} />} label="Not allocated" value={unallocated.length} bad={unallocated.length > 0} onClick={() => go('alloc')} />
        <Tile icon={<Gauge size={16} />} label="Pods < 50%" value={lowPods.length} bad={lowPods.length > 0} onClick={() => go('pods')} />
        <Tile icon={<FileWarning size={16} />} label="Docs missing" value={docGaps.length} bad={docGaps.length > 0} onClick={() => go('docs')} />
        <Tile icon={<CalendarX size={16} />} label="Cadence gaps" value={cadence.length} bad={cadence.length > 0} onClick={() => go('cadence')} />
        <Tile icon={<Flag size={16} />} label="Issues to close" value={followUps.length} bad={followUps.length > 0} onClick={() => go('issues')} />
        <Tile icon={<AlarmClock size={16} />} label="Timeline breaches" value={breaches.length} bad={breaches.length > 0} onClick={() => go('timeline')} />
        <Tile icon={<CalendarDays size={16} />} label="Meetings next 14d" value={upcoming.filter((e) => e.startAt < new Date(Date.now() + 14 * 86400_000).toISOString()).length} onClick={() => go('calendar')} />
      </div>

      {/* Current projects */}
      <Section id="projects" title="Current projects" count={shown.length}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted border-b border-line/60">
                <th className="px-5 py-2 font-semibold">Project</th><th className="px-3 py-2 font-semibold">Owner</th>
                <th className="px-3 py-2 font-semibold">Window</th><th className="px-3 py-2 font-semibold text-right">Team</th>
                <th className="px-3 py-2 font-semibold">Next meeting</th><th className="px-3 py-2 font-semibold">Flags</th><th />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.pipelineId} className="border-b border-line/30 last:border-0 hover:bg-surface-2/40">
                  <td className="px-5 py-2.5"><ProjectLink p={p} /><div className="text-xs text-muted">{p.status}</div></td>
                  <td className="px-3 py-2.5 text-ink/80">{normOwner(p.owner) || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-ink/80 whitespace-nowrap">{fmtDate(p.startDate)} → {fmtDate(p.endDate)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{p.teamSize}</td>
                  <td className="px-3 py-2.5 text-xs whitespace-nowrap">{p.nextMeetingAt ? fmtIn(p.nextMeetingAt) : <span className="text-muted">none booked</span>}</td>
                  <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">
                    {p.allocState === 'none' && <Badge variant="danger">Not allocated</Badge>}
                    {p.allocState === 'gaps' && <Badge variant="warning">Unstaffed {p.unstaffedMonths.length} mo</Badge>}
                    {p.docGap && <Badge variant="warning">Docs missing</Badge>}
                    {p.cadenceGap && <Badge variant="warning">Cadence</Badge>}
                    {p.openIssues > 0 && <Badge variant={p.overdueIssues || p.severeIssues ? 'danger' : 'neutral'}>{p.openIssues} issue{p.openIssues > 1 ? 's' : ''}</Badge>}
                    {p.breachReasons.length > 0 && <Badge variant="danger">Timeline</Badge>}
                    {!(p.allocState !== 'ok' || p.docGap || p.cadenceGap || p.openIssues || p.breachReasons.length) && <Badge variant="success">On track</Badge>}
                  </div></td>
                  <td className="pr-4"><ProjectLink p={p} icon /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Allocation */}
        <Section id="alloc" title="Projects not allocated for their full duration" count={unallocated.length}
          note="Months inside the project window with zero hours in Team → Projects. The forecast stores months without a year, so only this year’s months are checked.">
          <List empty="Every current project has people booked for every month of its window.">
            {unallocated.map((p) => (
              <Row key={p.pipelineId} p={p}>
                {p.allocState === 'none'
                  ? <span className="text-rose font-semibold">Nobody allocated</span>
                  : <>No hours in <span className="font-semibold text-ink">{p.unstaffedMonths.join(', ')}</span> · {Math.round(p.allocatedHours)} hrs booked across {p.windowMonths} months</>}
              </Row>
            ))}
          </List>
        </Section>

        {/* Pods */}
        <Section id="pods" title={`Pods under ${POD_LOW}% in the next 60 days`} count={lowPods.length}
          note="Hours booked ÷ (pod members × 160) per month — the same rule as Team → Pod Utilization.">
          {pods.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No pods set up yet (Team → People → Pod).</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted border-b border-line/60">
                  <th className="px-5 py-2 font-semibold">Pod</th>
                  {[...new Set(pods.map((r) => r.monthLabel))].map((m) => <th key={m} className="px-3 py-2 font-semibold text-right">{m}</th>)}
                </tr></thead>
                <tbody>
                  {[...new Set(pods.map((r) => r.pod))].map((pod) => {
                    const rows = pods.filter((r) => r.pod === pod);
                    return (
                      <tr key={pod} className="border-b border-line/30 last:border-0">
                        <td className="px-5 py-2 font-semibold text-ink">{pod}<div className="text-xs font-normal text-muted">{rows[0]?.members} people</div></td>
                        {rows.map((r) => (
                          <td key={r.mon} className="px-3 py-2 text-right" title={r.projects.map((x) => `${x.project}: ${x.hours}h`).join('\n') || 'Nothing booked'}>
                            <span className={`inline-block min-w-[3.5rem] rounded-md px-2 py-0.5 text-xs font-bold tabular-nums ${r.pct < POD_LOW ? 'bg-rose/12 text-rose' : r.pct > 100 ? 'bg-violet/12 text-violet' : r.pct < 80 ? 'bg-gold/12 text-gold' : 'bg-green/12 text-green'}`}>{Math.round(r.pct)}%</span>
                            <div className="text-[11px] text-muted tabular-nums">{Math.round(r.hours)} / {r.capacity}h</div>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Docs */}
        <Section id="docs" title="Requirements / design not evidenced against the plan" count={docGaps.length}
          note="Flagged when the plan’s discovery / requirements / design phase is done or past due (or the project is 30+ days in with no such phase) and Requirements, Design or User Stories documents aren’t in Documents.">
          <List empty="Every project past design has its requirements, design and user stories uploaded.">
            {docGaps.map((p) => (
              <Row key={p.pipelineId} p={p} tab="documents">
                Missing <span className="font-semibold text-ink">{p.missingDocs.join(', ')}</span>
                {p.rdDonePerPlan ? ' · plan shows requirements / design complete or past due' : ' · 30+ days in, no design phase in the plan'}
              </Row>
            ))}
          </List>
        </Section>

        {/* Cadence */}
        <Section id="cadence" title="Meeting cadence needs attention" count={cadence.length}
          note="No meeting recording or transcript in the project’s Documents in the last 14 days, or no project meeting booked in the next 14 days.">
          <List empty="Every project has a recent recording and a meeting booked.">
            {cadence.map((p) => (
              <Row key={p.pipelineId} p={p} tab="meetings">
                Last recording <span className="font-semibold text-ink">{fmtAgo(p.lastRecordingAt)}</span>
                {' · '}last meeting {fmtAgo(p.lastHeldAt)}
                {' · '}next <span className={p.upcoming14d === 0 ? 'font-semibold text-rose' : 'font-semibold text-ink'}>{fmtIn(p.nextMeetingAt)}</span>
              </Row>
            ))}
          </List>
        </Section>

        {/* Issues */}
        <Section id="issues" title="Issues needing follow-up" count={followUps.length}
          note="Open issues that are overdue, have no owner or due date, or are high / critical.">
          <List empty="No open issues need chasing.">
            {followUps.map((i) => {
              const p = byPlan.get(i.projectId);
              const overdue = i.dueDate && i.dueDate < todayIso();
              return (
                <li key={i.id} className="px-5 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-ink break-words">{i.description}</div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        {p && <Link to={`/project-plans/${i.projectId}`} className="font-semibold text-primary hover:underline">{p.name}</Link>}
                        <span>Owner: {i.owner?.trim() || <span className="text-rose font-semibold">none</span>}</span>
                        <span>Due: {i.dueDate ? <span className={overdue ? 'text-rose font-semibold' : ''}>{fmtDate(i.dueDate)}{overdue ? ' (overdue)' : ''}</span> : <span className="text-rose font-semibold">not set</span>}</span>
                        <span>Open {fmtAgo(i.createdAt)}</span>
                      </div>
                    </div>
                    <Badge variant={i.criticality === 'critical' || i.criticality === 'high' ? 'danger' : 'neutral'}>{i.criticality}</Badge>
                  </div>
                </li>
              );
            })}
          </List>
        </Section>

        {/* Timeline */}
        <Section id="timeline" title="Timeline breaches" count={breaches.length}
          note="Status Delayed, a phase or task open past its end date, go-live or end date passed, or the end moved past the baseline.">
          <List empty="No project is past a date.">
            {breaches.map((p) => (
              <Row key={p.pipelineId} p={p} tab="plan">
                <span className="text-rose font-semibold">{p.breachReasons.join(' · ')}</span>
              </Row>
            ))}
          </List>
        </Section>
      </div>

      {/* Calendar */}
      <Section id="calendar" title="Upcoming meetings across projects" count={upcoming.length}
        note={`Read from ${mailboxes.filter((m) => m.active).length} Outlook calendars (Sujatha, Anupama and allocated team members) · last sync ${lastSync ? fmtAgo(lastSync) : 'never'}`}>
        <div className="p-5 space-y-4">
          {calendarBlocked && (
            <div className="flex gap-3 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm">
              <ShieldAlert size={18} className="shrink-0 text-gold" />
              <div>
                <div className="font-semibold text-ink">Calendar access isn’t switched on yet.</div>
                <div className="text-ink/80">An Azure admin needs to add <b>Calendars.Read</b> (Application) to the Dashboard’s Microsoft app and grant admin consent.{' '}
                  <a className="font-semibold text-primary hover:underline" href={AZURE_APP_PERMISSIONS_URL} target="_blank" rel="noreferrer">Open the app’s API permissions</a>, then click Sync calendars.</div>
              </div>
            </div>
          )}
          {syncMsg && !calendarBlocked && <div className="text-xs text-muted">{syncMsg}</div>}
          {untagged.length > 0 && (
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-ink/80">
              <input type="checkbox" checked={showUntagged} onChange={(e) => setShowUntagged(e.target.checked)} />
              Show {untagged.length} untagged client meeting{untagged.length > 1 ? 's' : ''} so they can be tagged to a project or hidden
            </label>
          )}
          <MeetingCalendar events={calEvents} projectNames={projectNames} canEdit={perm.canEdit} onChanged={load}
            emptyText={calendarBlocked ? 'No calendars read yet.' : 'No upcoming project meetings.'} />
        </div>
      </Section>
    </div>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────

/** "Sujatha N" and "Sujatha Neelakannan" are the same owner. */
function normOwner(o: string | null): string {
  const s = (o ?? '').trim();
  if (!s) return '';
  const [first, ...rest] = s.split(/\s+/);
  return rest.length ? `${first} ${rest[0][0].toUpperCase()}.` : first;
}

function Tile({ icon, label, value, bad, onClick }: { icon: ReactNode; label: string; value: number; bad?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left rounded-xl border border-line/70 bg-surface px-4 py-3 hover:bg-surface-2/60 transition-colors">
      <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${bad ? 'text-rose' : 'text-muted'}`}>{icon}{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${bad ? 'text-rose' : 'text-ink'}`}>{value}</div>
    </button>
  );
}

function Section({ id, title, count, note, children }: { id: string; title: string; count: number; note?: string; children: ReactNode }) {
  return (
    <section id={`dh-${id}`} className="scroll-mt-20">
      <Card flush>
        <div className="px-5 py-3.5 border-b border-line/60">
          <div className="flex items-center gap-2">
            <h3 className="text-[0.9375rem] font-bold text-ink tracking-[-0.015em]">{title}</h3>
            <span className="text-xs font-semibold text-muted tabular-nums">{count}</span>
          </div>
          {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
        </div>
        {children}
      </Card>
    </section>
  );
}

function List({ empty, children }: { empty: string; children: ReactNode[] }) {
  if (!children.length) return <p className="px-5 py-6 text-sm text-muted">{empty}</p>;
  return <ul className="divide-y divide-line/30 max-h-[26rem] overflow-y-auto">{children}</ul>;
}

function ProjectLink({ p, icon, tab }: { p: HomeProject; icon?: boolean; tab?: string }) {
  const to = p.planId ? `/project-plans/${p.planId}${tab ? `?tab=${tab}` : ''}` : '/projects';
  if (icon) return <Link to={to} className="text-muted hover:text-ink" aria-label={`Open ${p.name}`}><ChevronRight size={16} /></Link>;
  return <Link to={to} className="font-semibold text-ink hover:text-primary">{p.name}</Link>;
}

function Row({ p, tab, children }: { p: HomeProject; tab?: string; children: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-2.5">
      <div className="min-w-0">
        <ProjectLink p={p} tab={tab} />
        <div className="text-xs text-muted">{children}</div>
      </div>
      <ProjectLink p={p} tab={tab} icon />
    </li>
  );
}
