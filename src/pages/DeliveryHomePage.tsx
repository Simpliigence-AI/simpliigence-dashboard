/**
 * Delivery Home — one screen that says where delivery needs attention.
 *
 *   Portfolio health   how many projects are on track / need attention / at risk
 *   Portfolio board    every project as one row: five signal dots (staffing, docs,
 *                      cadence, issues, timeline) beside its bar on a shared timeline
 *   Needs attention    ONE tabbed panel for the five checks instead of five stacked lists
 *   Pods + Next up     pod booking bars and the next few project meetings
 *   Calendar           the full Outlook project calendar, on its own tab
 *
 * All the rules live in SQL (v_delivery_home_projects, v_delivery_pod_util —
 * migration 040) so this page only lays them out.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Loader2, RefreshCw, UserX, FileWarning, CalendarX, Flag, AlarmClock, CalendarDays, ChevronRight, ShieldAlert,
  LayoutDashboard, Video, CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Badge, Button } from '../components/ui';
import { MeetingCalendar } from '../components/delivery/MeetingCalendar';
import { useTabPermission } from '../hooks/useTabPermission';
import { fmtDate } from '../lib/deliveryPlan';
import {
  loadHomeProjects, loadPodUtil, setProjectTm, loadOpenIssues, loadEvents, loadMailboxes, syncCalendars, fmtAgo, fmtIn,
  AZURE_APP_PERMISSIONS_URL, type HomeProject, type PodMonth, type OpenIssue, type CalendarEvent, type Mailbox,
} from '../lib/deliveryHome';

const POD_LOW = 50;
const todayIso = () => new Date().toISOString().slice(0, 10);

type CheckKey = 'alloc' | 'docs' | 'cadence' | 'issues' | 'timeline';
type Level = 'ok' | 'warn' | 'bad' | 'off';
const DAY = 86400_000;

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
  const [view, setView] = useState<'overview' | 'calendar'>('overview');
  const [check, setCheck] = useState<CheckKey | null>(null);
  const [now] = useState(() => Date.now());

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

  // Deviance checks apply to fixed-price projects only; T&M engagements are listed and skipped.
  const fixed = shown.filter((p) => !p.isTm);
  const tmCount = shown.length - fixed.length;
  const fixedPlanIds = new Set(fixed.map((p) => p.planId).filter(Boolean) as string[]);
  const unallocated = fixed.filter((p) => p.allocState !== 'ok');
  const lowPods = useMemo(() => {
    const m = new Map<string, PodMonth[]>();
    for (const r of pods) { if (!m.has(r.pod)) m.set(r.pod, []); m.get(r.pod)!.push(r); }
    return [...m.entries()].filter(([, rows]) => rows.some((r) => r.pct < POD_LOW));
  }, [pods]);
  const docGaps = fixed.filter((p) => p.docGap);
  const cadence = fixed.filter((p) => p.cadenceGap);
  const followUps = issues.filter((i) => fixedPlanIds.has(i.projectId) && (!i.dueDate || i.dueDate < todayIso() || !i.owner?.trim() || i.criticality === 'critical' || i.criticality === 'high'));
  const breaches = fixed.filter((p) => p.breachReasons.length > 0);
  const [tmBusy, setTmBusy] = useState<string | null>(null);
  const toggleTm = async (p: HomeProject, v: boolean) => {
    setTmBusy(p.pipelineId);
    setProjects((all) => all.map((x) => (x.pipelineId === p.pipelineId ? { ...x, isTm: v } : x)));
    try { await setProjectTm(p.pipelineId, v); }
    catch (e) { setProjects((all) => all.map((x) => (x.pipelineId === p.pipelineId ? { ...x, isTm: !v } : x))); alert((e as Error).message); }
    finally { setTmBusy(null); }
  };
  const tagged = useMemo(() => events.filter((e) => e.projectId && planIds.has(e.projectId)), [events, planIds]);
  const untaggedAll = useMemo(() => events.filter((e) => !e.projectId && e.isExternal && e.matchSource !== 'ignored'), [events]);
  const calEvents = showUntagged ? [...tagged, ...untaggedAll] : tagged;
  const nowIso = new Date(now).toISOString();
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

  const atRisk = fixed.filter((p) => projectLevel(p) === 'bad');
  const watch = fixed.filter((p) => projectLevel(p) === 'warn');
  const onTrack = fixed.filter((p) => projectLevel(p) === 'ok');
  const in14 = new Date(now + 14 * DAY).toISOString();
  const meetings14 = upcoming.filter((e) => e.startAt < in14).length;

  const checks: Array<{ key: CheckKey; label: string; icon: ReactNode; count: number; note: string }> = [
    { key: 'timeline', label: 'Timeline', icon: <AlarmClock size={14} />, count: breaches.length, note: 'Status Delayed, a phase or task open past its end date, go-live or end date passed, or the end moved past the baseline.' },
    { key: 'issues', label: 'Issues', icon: <Flag size={14} />, count: followUps.length, note: 'Open issues that are overdue, have no owner or due date, or are high / critical.' },
    { key: 'alloc', label: 'Staffing', icon: <UserX size={14} />, count: unallocated.length, note: 'Months inside the project window with zero hours in Team → Projects (this year’s months only).' },
    { key: 'docs', label: 'Docs', icon: <FileWarning size={14} />, count: docGaps.length, note: 'Plan shows requirements / design done or past due (or 30+ days in with no such phase) and the Requirements, Design or User Stories documents aren’t uploaded.' },
    { key: 'cadence', label: 'Cadence', icon: <CalendarX size={14} />, count: cadence.length, note: 'No meeting recording in Documents in the last 14 days, or no project meeting booked in the next 14.' },
  ];
  const activeCheck = check ?? checks.find((c) => c.count > 0)?.key ?? 'timeline';
  const active = checks.find((c) => c.key === activeCheck)!;

  // Shared time axis for the board: 2 months back → 6 months ahead, month gridlines.
  const axisStart = startOfMonth(now, -2);
  const axisEnd = startOfMonth(now, 7);
  const months = Array.from({ length: 9 }, (_, i) => startOfMonth(now, i - 2));
  const pos = (t: number) => Math.min(100, Math.max(0, ((t - axisStart) / (axisEnd - axisStart)) * 100));
  const board = [...shown].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Delivery" tone="brand" title="Delivery Home"
        subtitle="Where every project stands, what needs follow-up, and what’s booked next."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-line bg-surface p-1 text-xs font-semibold">
              <button type="button" onClick={() => setView('overview')} className={`px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 ${view === 'overview' ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}><LayoutDashboard size={13} /> Overview</button>
              <button type="button" onClick={() => setView('calendar')} className={`px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 ${view === 'calendar' ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}><CalendarDays size={13} /> Calendar <span className="tabular-nums opacity-80">{meetings14}</span></button>
            </div>
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

      {view === 'overview' ? (
        <>
          {/* Portfolio health — one bar, then the five checks as buttons into the panel below */}
          <Card>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-center">
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[2.5rem] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">{shown.length}</span>
                  <span className="text-sm font-semibold text-muted">project{shown.length === 1 ? '' : 's'} in flight</span>
                </div>
                <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-2" role="img"
                  aria-label={`${onTrack.length} on track, ${watch.length} need attention, ${atRisk.length} at risk, ${tmCount} time and materials`}>
                  {onTrack.length > 0 && <div className="bg-green" style={{ flex: onTrack.length }} />}
                  {watch.length > 0 && <div className="bg-gold" style={{ flex: watch.length }} />}
                  {atRisk.length > 0 && <div className="bg-rose" style={{ flex: atRisk.length }} />}
                  {tmCount > 0 && <div className="bg-muted/40" style={{ flex: tmCount }} />}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/80">
                  <Legend dot="bg-green" n={onTrack.length} label="On track" />
                  <Legend dot="bg-gold" n={watch.length} label="Needs attention" />
                  <Legend dot="bg-rose" n={atRisk.length} label="At risk" />
                  {tmCount > 0 && <Legend dot="bg-muted/40" n={tmCount} label="T&M (not checked)" />}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {checks.map((c) => (
                  <button key={c.key} type="button" onClick={() => { setCheck(c.key); document.getElementById('dh-attention')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${c.count > 0 ? 'border-rose/25 bg-rose/[0.06] hover:bg-rose/10' : 'border-line/70 bg-surface hover:bg-surface-2/60'}`}>
                    <div className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ${c.count > 0 ? 'text-rose' : 'text-muted'}`}>{c.icon}{c.label}</div>
                    <div className={`mt-0.5 text-2xl font-bold tabular-nums ${c.count > 0 ? 'text-rose' : 'text-ink'}`}>{c.count}</div>
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* Portfolio board — signals + timeline, one row per project */}
          <Card flush>
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-line/60">
              <h3 className="text-[0.9375rem] font-bold text-ink tracking-[-0.015em]">Portfolio board</h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                <Legend dot="bg-green" label="Clear" /><Legend dot="bg-gold" label="Watch" /><Legend dot="bg-rose" label="Act" />
                <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-px bg-brand" /> Today</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[940px]">
                <div className="grid grid-cols-[240px_200px_minmax(0,1fr)_120px_28px] items-end gap-3 px-5 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <div>Project</div>
                  <div className="grid grid-cols-5 text-center">
                    {SIGNALS.map((sg) => <span key={sg.key} title={sg.label}>{sg.short}</span>)}
                  </div>
                  <div className="relative h-4">
                    {months.map((m) => <span key={m} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${pos(m + 15 * DAY)}%` }}>{new Date(m).toLocaleDateString(undefined, { month: 'short' })}</span>)}
                  </div>
                  <div>Next meeting</div><div />
                </div>
                {board.length === 0 && <p className="px-5 py-8 text-sm text-muted">No current projects for this owner.</p>}
                {board.map((p) => {
                  const lv = projectLevel(p);
                  const st = p.startDate ? Date.parse(p.startDate) : null;
                  const en = p.endDate ? Date.parse(p.endDate) : null;
                  const gl = p.goLive ? Date.parse(p.goLive) : null;
                  return (
                    <div key={p.pipelineId} className="grid grid-cols-[240px_200px_minmax(0,1fr)_120px_28px] items-center gap-3 border-t border-line/30 px-5 py-2 hover:bg-surface-2/40">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[lv]}`} />
                          <ProjectLink p={p} />
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 pl-4 text-[11px] text-muted">
                          <span className="truncate">{normOwner(p.owner) || 'No owner'} · {p.teamSize} on team</span>
                          <label className={`inline-flex shrink-0 items-center gap-1 rounded px-1 font-semibold ${p.isTm ? 'bg-gold/12 text-gold' : ''} ${perm.canEdit ? 'cursor-pointer' : ''}`} title="Time & materials projects are left out of the checks">
                            <input type="checkbox" aria-label={`${p.name} is time and materials`} checked={p.isTm} disabled={!perm.canEdit || tmBusy === p.pipelineId}
                              onChange={(e) => toggleTm(p, e.target.checked)} className="h-3 w-3 accent-amber-500" />
                            T&amp;M
                          </label>
                        </div>
                      </div>
                      <div className="grid grid-cols-5 justify-items-center">
                        {SIGNALS.map((sg) => { const r = sg.read(p); return <span key={sg.key} title={`${sg.label}: ${r.tip}`} className={`h-3.5 w-3.5 rounded-full ${p.isTm ? 'border border-dashed border-line' : LEVEL_DOT[r.level]}`} />; })}
                      </div>
                      <div className="relative h-7" title={`${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}${p.goLive ? ` · go-live ${fmtDate(p.goLive)}` : ''}`}>
                        {months.map((m) => <span key={m} className="absolute inset-y-0 w-px bg-line/50" style={{ left: `${pos(m)}%` }} />)}
                        {st != null && en != null && en >= axisStart && st <= axisEnd ? (
                          <span className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full ${LEVEL_BAR[lv]}`} style={{ left: `${pos(st)}%`, width: `${Math.max(1.2, pos(en) - pos(st))}%` }} />
                        ) : (
                          <span className="absolute inset-y-0 left-1 flex items-center text-[11px] text-muted">{st == null || en == null ? 'No dates set' : en < axisStart ? `Ended ${fmtDate(p.endDate)}` : `Starts ${fmtDate(p.startDate)}`}</span>
                        )}
                        {gl != null && gl >= axisStart && gl <= axisEnd && <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-surface bg-ink" style={{ left: `${pos(gl)}%` }} title={`Go-live ${fmtDate(p.goLive)}`} />}
                        <span className="absolute inset-y-0 w-px bg-brand" style={{ left: `${pos(now)}%` }} />
                      </div>
                      <div className="text-xs whitespace-nowrap">{p.nextMeetingAt ? fmtIn(p.nextMeetingAt) : <span className="text-muted">none booked</span>}</div>
                      <ProjectLink p={p} icon />
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            {/* Needs attention — tabs instead of five stacked lists */}
            <section id="dh-attention" className="scroll-mt-20">
              <Card flush>
                <div className="px-5 pt-3.5">
                  <h3 className="text-[0.9375rem] font-bold text-ink tracking-[-0.015em]">Needs attention</h3>
                  <div className="mt-2.5 flex flex-wrap gap-1" role="tablist">
                    {checks.map((c) => (
                      <button key={c.key} type="button" role="tab" aria-selected={c.key === activeCheck} onClick={() => setCheck(c.key)}
                        className={`inline-flex items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-xs font-semibold ${c.key === activeCheck ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
                        {c.icon}{c.label}
                        <span className={`rounded-full px-1.5 py-px text-[10px] tabular-nums ${c.count > 0 ? 'bg-rose/12 text-rose' : 'bg-surface-2 text-muted'}`}>{c.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="border-y border-line/60 bg-surface-2/40 px-5 py-2 text-xs text-muted">{active.note}{tmCount ? ` Covers the ${fixed.length} fixed-price projects.` : ''}</p>
                {activeCheck === 'alloc' && (
                  <List empty="Every current project has people booked for every month of its window.">
                    {unallocated.map((p) => (
                      <Row key={p.pipelineId} p={p}>
                        {p.allocState === 'none'
                          ? <span className="text-rose font-semibold">Nobody allocated</span>
                          : <>No hours in <span className="font-semibold text-ink">{p.unstaffedMonths.join(', ')}</span> · {Math.round(p.allocatedHours)} hrs booked across {p.windowMonths} months</>}
                      </Row>
                    ))}
                  </List>
                )}
                {activeCheck === 'docs' && (
                  <List empty="Every project past design has its requirements, design and user stories uploaded.">
                    {docGaps.map((p) => (
                      <Row key={p.pipelineId} p={p} tab="documents">
                        Missing <span className="font-semibold text-ink">{p.missingDocs.join(', ')}</span>
                        {p.rdDonePerPlan ? ' · plan shows requirements / design complete or past due' : ' · 30+ days in, no design phase in the plan'}
                      </Row>
                    ))}
                  </List>
                )}
                {activeCheck === 'cadence' && (
                  <List empty="Every project has a recent recording and a meeting booked.">
                    {cadence.map((p) => (
                      <Row key={p.pipelineId} p={p} tab="meetings">
                        Last recording <span className="font-semibold text-ink">{fmtAgo(p.lastRecordingAt)}</span>
                        {' · '}last meeting {fmtAgo(p.lastHeldAt)}
                        {' · '}next <span className={p.upcoming14d === 0 ? 'font-semibold text-rose' : 'font-semibold text-ink'}>{fmtIn(p.nextMeetingAt)}</span>
                      </Row>
                    ))}
                  </List>
                )}
                {activeCheck === 'issues' && (
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
                )}
                {activeCheck === 'timeline' && (
                  <List empty="No project is past a date.">
                    {breaches.map((p) => (
                      <Row key={p.pipelineId} p={p} tab="plan">
                        <span className="text-rose font-semibold">{p.breachReasons.join(' · ')}</span>
                      </Row>
                    ))}
                  </List>
                )}
              </Card>
            </section>

            <div className="space-y-5">
              {/* Next up */}
              <Card flush>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-line/60">
                  <h3 className="text-[0.9375rem] font-bold text-ink tracking-[-0.015em]">Next up</h3>
                  <button type="button" onClick={() => setView('calendar')} className="text-xs font-semibold text-primary hover:underline">Full calendar</button>
                </div>
                {upcoming.length === 0 ? <p className="px-5 py-6 text-sm text-muted">{calendarBlocked ? 'No calendars read yet.' : 'No upcoming project meetings.'}</p> : (
                  <ul className="divide-y divide-line/30">
                    {upcoming.slice(0, 5).map((e) => {
                      const d = new Date(e.startAt);
                      return (
                        <li key={e.id} className="flex items-center gap-3 px-5 py-2.5">
                          <div className="w-11 shrink-0 rounded-lg bg-brand/10 py-1 text-center">
                            <div className="text-[10px] font-bold uppercase text-brand-dark">{d.toLocaleDateString(undefined, { month: 'short' })}</div>
                            <div className="text-base font-bold leading-none text-ink tabular-nums">{d.getDate()}</div>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-ink">{e.subject}</div>
                            <div className="truncate text-xs text-muted">{d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {e.projectId ? projectNames[e.projectId] : ''}</div>
                          </div>
                          {e.joinUrl && <a href={e.joinUrl} target="_blank" rel="noreferrer" className="shrink-0 text-muted hover:text-primary" aria-label={`Join ${e.subject}`}><Video size={16} /></a>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>

              {/* Pods */}
              <Card flush>
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-line/60">
                  <h3 className="text-[0.9375rem] font-bold text-ink tracking-[-0.015em]">Pod booking, next 60 days</h3>
                  {lowPods.length > 0 ? <Badge variant="danger">{lowPods.length} under {POD_LOW}%</Badge> : pods.length > 0 ? <Badge variant="success">All above {POD_LOW}%</Badge> : null}
                </div>
                {pods.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No pods set up yet (Team → People → Pod).</p> : (
                  <div className="space-y-3 px-5 py-4">
                    {[...new Set(pods.map((r) => r.pod))].map((pod) => {
                      const rows = pods.filter((r) => r.pod === pod);
                      return (
                        <div key={pod}>
                          <div className="flex items-baseline justify-between text-sm"><span className="font-semibold text-ink">{pod}</span><span className="text-xs text-muted">{rows[0]?.members} people</span></div>
                          <div className="mt-1 space-y-1">
                            {rows.map((r) => (
                              <div key={r.mon} className="flex items-center gap-2 text-[11px]" title={r.projects.map((x) => `${x.project}: ${x.hours}h`).join('\n') || 'Nothing booked'}>
                                <span className="w-8 shrink-0 text-muted">{r.monthLabel}</span>
                                <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                                  <div className={`h-full rounded-full ${r.pct < POD_LOW ? 'bg-rose' : r.pct > 100 ? 'bg-violet' : r.pct < 80 ? 'bg-gold' : 'bg-green'}`} style={{ width: `${Math.min(100, r.pct)}%` }} />
                                  <span className="absolute inset-y-0 w-px bg-ink/30" style={{ left: `${POD_LOW}%` }} />
                                </div>
                                <span className={`w-9 shrink-0 text-right font-bold tabular-nums ${r.pct < POD_LOW ? 'text-rose' : 'text-ink'}`}>{Math.round(r.pct)}%</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </div>
          </div>
        </>
      ) : (
        <Card flush>
          <div className="px-5 py-3.5 border-b border-line/60">
            <div className="flex items-center gap-2">
              <h3 className="text-[0.9375rem] font-bold text-ink tracking-[-0.015em]">Meetings across projects</h3>
              <span className="text-xs font-semibold text-muted tabular-nums">{upcoming.length} upcoming</span>
            </div>
            <p className="mt-0.5 text-xs text-muted">Read from {mailboxes.filter((m) => m.active).length} Outlook calendars (Sujatha, Anupama and allocated team members) · last sync {lastSync ? fmtAgo(lastSync) : 'never'}</p>
          </div>
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
            {untagged.length > 0 && (
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-ink/80">
                <input type="checkbox" checked={showUntagged} onChange={(e) => setShowUntagged(e.target.checked)} />
                Show {untagged.length} untagged client meeting{untagged.length > 1 ? 's' : ''} so they can be tagged to a project or hidden
              </label>
            )}
            <MeetingCalendar events={calEvents} projectNames={projectNames} canEdit={perm.canEdit} onChanged={load}
              emptyText={calendarBlocked ? 'No calendars read yet.' : 'No upcoming project meetings.'} />
          </div>
        </Card>
      )}
      {syncMsg && !calendarBlocked && <div className="text-xs text-muted">{syncMsg}</div>}
    </div>
  );
}

// ── Bits ────────────────────────────────────────────────────────────────

const LEVEL_DOT: Record<Level, string> = { ok: 'bg-green', warn: 'bg-gold', bad: 'bg-rose', off: 'bg-muted/40' };
const LEVEL_BAR: Record<Level, string> = { ok: 'bg-green/70', warn: 'bg-gold/80', bad: 'bg-rose/80', off: 'bg-muted/35' };

/** The five checks, read off one project. Order = the column order on the board. */
const SIGNALS: Array<{ key: CheckKey; short: string; label: string; read: (p: HomeProject) => { level: Level; tip: string } }> = [
  { key: 'alloc', short: 'Staff', label: 'Staffing', read: (p) => p.allocState === 'none' ? { level: 'bad', tip: 'nobody allocated' } : p.allocState === 'gaps' ? { level: 'warn', tip: `no hours in ${p.unstaffedMonths.join(', ')}` } : { level: 'ok', tip: 'booked for the whole window' } },
  { key: 'docs', short: 'Docs', label: 'Documents', read: (p) => p.docGap ? { level: 'warn', tip: `missing ${p.missingDocs.join(', ')}` } : { level: 'ok', tip: 'uploaded' } },
  { key: 'cadence', short: 'Meet', label: 'Meeting cadence', read: (p) => p.cadenceGap ? { level: 'warn', tip: `last recording ${fmtAgo(p.lastRecordingAt)}, next meeting ${fmtIn(p.nextMeetingAt)}` } : { level: 'ok', tip: 'recent recording and a meeting booked' } },
  { key: 'issues', short: 'Issues', label: 'Issues', read: (p) => p.overdueIssues || p.severeIssues ? { level: 'bad', tip: `${p.openIssues} open, ${p.overdueIssues} overdue, ${p.severeIssues} high / critical` } : p.openIssues ? { level: 'warn', tip: `${p.openIssues} open` } : { level: 'ok', tip: 'none open' } },
  { key: 'timeline', short: 'Dates', label: 'Timeline', read: (p) => p.breachReasons.length ? { level: 'bad', tip: p.breachReasons.join(' · ') } : { level: 'ok', tip: 'no date passed' } },
];

/** Worst signal wins; T&M projects aren't checked. */
function projectLevel(p: HomeProject): Level {
  if (p.isTm) return 'off';
  const levels = SIGNALS.map((s) => s.read(p).level);
  return levels.includes('bad') ? 'bad' : levels.includes('warn') ? 'warn' : 'ok';
}
const rank = (p: HomeProject) => ({ bad: 0, warn: 1, ok: 2, off: 3 })[projectLevel(p)];

function startOfMonth(t: number, offset: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime();
}

function Legend({ dot, n, label }: { dot: string; n?: number; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${dot}`} />{n != null && <b className="tabular-nums text-ink">{n}</b>}{label}</span>;
}

/** "Sujatha N" and "Sujatha Neelakannan" are the same owner. */
function normOwner(o: string | null): string {
  const s = (o ?? '').trim();
  if (!s) return '';
  const [first, ...rest] = s.split(/\s+/);
  return rest.length ? `${first} ${rest[0][0].toUpperCase()}.` : first;
}

function List({ empty, children }: { empty: string; children: ReactNode[] }) {
  if (!children.length) return <p className="flex items-center gap-2 px-5 py-8 text-sm text-muted"><CheckCircle2 size={16} className="text-green" />{empty}</p>;
  return <ul className="divide-y divide-line/30 max-h-[24rem] overflow-y-auto">{children}</ul>;
}

function ProjectLink({ p, icon, tab }: { p: HomeProject; icon?: boolean; tab?: string }) {
  const to = p.planId ? `/project-plans/${p.planId}${tab ? `?tab=${tab}` : ''}` : '/projects';
  if (icon) return <Link to={to} className="text-muted hover:text-ink" aria-label={`Open ${p.name}`}><ChevronRight size={16} /></Link>;
  return <Link to={to} className="block truncate font-semibold text-ink hover:text-primary">{p.name}</Link>;
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
