/**
 * MeetingCalendar — meetings read from Outlook (delivery_calendar_events), shown
 * three ways over the same events:
 *
 *   Week    a time grid, Mon–Sun, events placed by start/end with overlaps side by side,
 *           a "now" line on today
 *   Month   a calendar grid with coloured event pills; click a day to open its agenda
 *   Agenda  day-by-day cards with time, project, attendees and a Join button
 *
 * One colour per project (or account) across all three views, with a legend that
 * doubles as a filter. Click any event for its detail — join link, Outlook link,
 * attendees, and (when the viewer can edit) tag / untag / hide.
 *
 * Used on Delivery Home (all projects), a project's Meetings tab (one project) and
 * Concierge Home (accounts). Colours are inline hex tints over the theme's ink, so
 * they read in light and dark mode alike.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Video, Users, ExternalLink, EyeOff, X, Clock, CalendarDays, MapPin } from 'lucide-react';
import type { CalendarEvent } from '../../lib/deliveryHome';
import { dayKey, fmtTime, tagEvent } from '../../lib/deliveryHome';

const HUES = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#14b8a6', '#6366f1', '#84cc16', '#f97316', '#ec4899', '#06b6d4', '#a855f7'];
const GREY = '#94a3b8';
const HOUR_PX = 52;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type View = 'week' | 'month' | 'agenda';

interface Props {
  events: CalendarEvent[];
  /** id → display name (plan id for projects, account id on Concierge). */
  projectNames: Record<string, string>;
  /** Show the project label and legend (off on a single project's tab). */
  showProject?: boolean;
  canEdit?: boolean;
  onChanged?: () => void;
  emptyText?: string;
}

const startOfWeek = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const minutesOf = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const initials = (s: string) => s.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const tint = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

export function MeetingCalendar({ events, projectNames, showProject = true, canEdit = false, onChanged, emptyText }: Props) {
  const [view, setView] = useState<View>('week');
  const [cursor, setCursor] = useState(() => new Date());
  const [picked, setPicked] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<CalendarEvent | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);

  const order = useMemo(() => Object.keys(projectNames).sort((a, b) => projectNames[a].localeCompare(projectNames[b])), [projectNames]);
  const colorOf = (id: string | null) => (id ? HUES[Math.max(0, order.indexOf(id)) % HUES.length] : GREY);

  const live = useMemo(() => events.filter((e) => !e.isCancelled && e.matchSource !== 'ignored'), [events]);
  const visible = useMemo(() => live.filter((e) => !hidden.has(e.projectId ?? '__none')), [live, hidden]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of visible) { const k = dayKey(e.startAt); if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    for (const list of m.values()) list.sort((a, b) => a.startAt.localeCompare(b.startAt));
    return m;
  }, [visible]);

  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    const nowIso = now.toISOString();
    for (const e of live) if (e.endAt >= nowIso) counts.set(e.projectId ?? '__none', (counts.get(e.projectId ?? '__none') ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => (a[0] === '__none' ? 1 : b[0] === '__none' ? -1 : (projectNames[a[0]] ?? '').localeCompare(projectNames[b[0]] ?? '')));
  }, [live, now, projectNames]);

  const weekStart = startOfWeek(cursor);
  const title = view === 'week'
    ? `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const step = (dir: number) => {
    setPicked(null);
    if (view === 'week') setCursor(addDays(cursor, dir * 7));
    else setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1));
  };
  const weekCount = useMemo(() => {
    const a = weekStart.getTime(), b = addDays(weekStart, 7).getTime();
    return visible.filter((e) => { const t = new Date(e.startAt).getTime(); return t >= a && t < b; }).length;
  }, [visible, weekStart]);

  const toggle = (id: string) => setHidden((h) => { const n = new Set(h); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => { setCursor(new Date()); setPicked(null); }} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2">Today</button>
          {view !== 'agenda' && (
            <div className="flex items-center rounded-lg border border-line bg-surface">
              <button aria-label="Previous" onClick={() => step(-1)} className="px-2 py-1.5 text-muted hover:text-ink"><ChevronLeft size={16} /></button>
              <button aria-label="Next" onClick={() => step(1)} className="px-2 py-1.5 text-muted hover:text-ink"><ChevronRight size={16} /></button>
            </div>
          )}
          <div className="ml-1">
            <div className="text-base font-bold tracking-[-0.01em] text-ink">{view === 'agenda' ? (picked ? new Date(picked + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Upcoming') : title}</div>
            {view === 'week' && <div className="text-[11px] text-muted">{weekCount} meeting{weekCount === 1 ? '' : 's'} this week</div>}
          </div>
        </div>
        <div className="inline-flex rounded-lg bg-surface-2/80 p-0.5 ring-1 ring-line/70">
          {(['week', 'month', 'agenda'] as const).map((v) => (
            <button key={v} onClick={() => { setView(v); if (v !== 'agenda') setPicked(null); }}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${view === v ? 'bg-surface text-ink shadow-sm ring-1 ring-line/70' : 'text-muted hover:text-ink'}`}>
              {v === 'week' ? 'Week' : v === 'month' ? 'Month' : 'Agenda'}
            </button>
          ))}
        </div>
      </div>

      {/* Legend / filter */}
      {showProject && legend.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {legend.map(([id, n]) => {
            const off = hidden.has(id);
            const c = id === '__none' ? GREY : colorOf(id);
            return (
              <button key={id} onClick={() => toggle(id)} title={off ? 'Show' : 'Hide'}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-opacity ${off ? 'opacity-40' : ''}`}
                style={{ borderColor: tint(c, 0.45), background: tint(c, 0.1) }}>
                <span className="h-2 w-2 rounded-full" style={{ background: c }} />
                <span className="text-ink">{id === '__none' ? 'Untagged' : projectNames[id]}</span>
                <span className="tabular-nums text-muted">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {view === 'week' && <WeekGrid start={weekStart} byDay={byDay} now={now} colorOf={colorOf} names={projectNames} showProject={showProject} onOpen={setOpen} />}
      {view === 'month' && <MonthGrid cursor={cursor} byDay={byDay} now={now} colorOf={colorOf} onPick={(k) => { setPicked(k); setView('agenda'); }} onOpen={setOpen} />}
      {view === 'agenda' && (
        <Agenda events={picked ? (byDay.get(picked) ?? []) : visible.filter((e) => e.endAt >= new Date(now.getTime() - 3600_000).toISOString())}
          now={now} colorOf={colorOf} names={projectNames} showProject={showProject} onOpen={setOpen}
          emptyText={emptyText ?? 'No meetings.'} onClearPick={picked ? () => setPicked(null) : undefined} />
      )}

      {open && <EventDetail e={open} color={colorOf(open.projectId)} names={projectNames} order={order} showProject={showProject}
        canEdit={canEdit} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); onChanged?.(); }} />}
    </div>
  );
}

/* ── Week ─────────────────────────────────────────────────────────────── */

interface Placed { e: CalendarEvent; top: number; height: number; col: number; cols: number }

/** Lay one day's timed events out in side-by-side columns where they overlap. */
function layoutDay(list: CalendarEvent[], startHour: number): Placed[] {
  const items = list.filter((e) => !e.isAllDay).map((e) => {
    const s = minutesOf(e.startAt), end = Math.max(minutesOf(e.endAt), s + 15);
    return { e, s, end: sameDay(new Date(e.startAt), new Date(e.endAt)) ? end : 24 * 60 };
  }).sort((a, b) => a.s - b.s || b.end - a.end);
  const out: Placed[] = [];
  let cluster: typeof items = [], clusterEnd = -1;
  const flush = () => {
    const colsEnd: number[] = [];
    const placed = cluster.map((it) => {
      let c = colsEnd.findIndex((x) => x <= it.s);
      if (c < 0) { c = colsEnd.length; colsEnd.push(it.end); } else colsEnd[c] = it.end;
      return { it, c };
    });
    for (const { it, c } of placed) {
      out.push({ e: it.e, col: c, cols: colsEnd.length, top: ((it.s - startHour * 60) / 60) * HOUR_PX, height: Math.max(((it.end - it.s) / 60) * HOUR_PX - 2, 20) });
    }
    cluster = []; clusterEnd = -1;
  };
  for (const it of items) { if (cluster.length && it.s >= clusterEnd) flush(); cluster.push(it); clusterEnd = Math.max(clusterEnd, it.end); }
  if (cluster.length) flush();
  return out;
}

function WeekGrid({ start, byDay, now, colorOf, names, showProject, onOpen }: {
  start: Date; byDay: Map<string, CalendarEvent[]>; now: Date; colorOf: (id: string | null) => string;
  names: Record<string, string>; showProject: boolean; onOpen: (e: CalendarEvent) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const lists = days.map((d) => byDay.get(dayKey(d.toISOString())) ?? []);
  // Working hours by default, stretched to fit anything booked outside them.
  let minH = 8, maxH = 19;
  for (const l of lists) for (const e of l) if (!e.isAllDay) {
    minH = Math.min(minH, Math.floor(minutesOf(e.startAt) / 60));
    maxH = Math.max(maxH, Math.min(24, Math.ceil(Math.max(minutesOf(e.endAt), minutesOf(e.startAt) + 30) / 60)));
  }
  const hours = Array.from({ length: maxH - minH }, (_, i) => minH + i);
  const allDay = lists.map((l) => l.filter((e) => e.isAllDay));
  const hasAllDay = allDay.some((l) => l.length);
  const nowTop = ((now.getHours() * 60 + now.getMinutes() - minH * 60) / 60) * HOUR_PX;

  return (
    <div className="overflow-x-auto rounded-xl border border-line/70 bg-surface">
      <div className="min-w-[760px]">
        {/* Header */}
        <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-line/70">
          <div />
          {days.map((d, i) => {
            const today = sameDay(d, now);
            return (
              <div key={i} className={`flex flex-col items-center gap-0.5 py-2 ${i >= 5 ? 'bg-surface-2/40' : ''}`}>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${today ? 'text-primary' : 'text-muted'}`}>{WEEKDAYS[i]}</span>
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold tabular-nums ${today ? 'bg-primary text-white shadow' : 'text-ink'}`}>{d.getDate()}</span>
                <span className="h-3 text-[10px] text-muted tabular-nums">{lists[i].length ? `${lists[i].length} mtg` : ''}</span>
              </div>
            );
          })}
        </div>
        {hasAllDay && (
          <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-line/70">
            <div className="py-1 pr-2 text-right text-[10px] text-muted">all-day</div>
            {allDay.map((l, i) => (
              <div key={i} className="space-y-0.5 p-1">
                {l.map((e) => <Pill key={e.id} e={e} color={colorOf(e.projectId)} onOpen={onOpen} />)}
              </div>
            ))}
          </div>
        )}
        {/* Body */}
        <div className="relative grid grid-cols-[3.5rem_repeat(7,1fr)]" style={{ height: hours.length * HOUR_PX }}>
          <div className="relative">
            {hours.map((h, i) => (
              <div key={h} className="absolute right-2 -translate-y-1/2 text-[10px] font-medium text-muted tabular-nums" style={{ top: i * HOUR_PX }}>
                {i === 0 ? '' : new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' })}
              </div>
            ))}
          </div>
          {days.map((d, i) => {
            const today = sameDay(d, now);
            const placed = layoutDay(lists[i], minH);
            return (
              <div key={i} className={`relative border-l border-line/60 ${i >= 5 ? 'bg-surface-2/40' : ''} ${today ? 'bg-primary/[0.04]' : ''}`}>
                {hours.map((h, j) => <div key={h} className="absolute inset-x-0 border-t border-line/40" style={{ top: j * HOUR_PX }} />)}
                {hours.map((h, j) => <div key={`${h}h`} className="absolute inset-x-0 border-t border-dashed border-line/20" style={{ top: j * HOUR_PX + HOUR_PX / 2 }} />)}
                {placed.map((p) => {
                  const c = colorOf(p.e.projectId);
                  const past = p.e.endAt < now.toISOString();
                  const w = 100 / p.cols;
                  return (
                    <button key={p.e.id} onClick={() => onOpen(p.e)} title={p.e.subject}
                      className={`absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left shadow-sm transition hover:z-20 hover:shadow-md ${past ? 'opacity-70' : ''}`}
                      style={{ top: p.top + 1, height: p.height, left: `calc(${p.col * w}% + 2px)`, width: `calc(${w}% - 4px)`, background: tint(c, 0.16), borderColor: c }}>
                      <div className="truncate text-[11px] font-semibold leading-tight text-ink">{p.e.subject}</div>
                      {p.height > 30 && <div className="truncate text-[10px] leading-tight text-muted tabular-nums">{fmtTime(p.e.startAt)} – {fmtTime(p.e.endAt)}</div>}
                      {p.height > 46 && showProject && p.e.projectId && <div className="truncate text-[10px] font-semibold leading-tight" style={{ color: c }}>{names[p.e.projectId]}</div>}
                    </button>
                  );
                })}
                {today && nowTop >= 0 && nowTop <= hours.length * HOUR_PX && (
                  <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowTop }}>
                    <div className="relative h-0.5 bg-rose-500"><span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-rose-500" /></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Month ────────────────────────────────────────────────────────────── */

function MonthGrid({ cursor, byDay, now, colorOf, onPick, onOpen }: {
  cursor: Date; byDay: Map<string, CalendarEvent[]>; now: Date; colorOf: (id: string | null) => string;
  onPick: (k: string) => void; onOpen: (e: CalendarEvent) => void;
}) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = startOfWeek(first);
  const weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) / 7);
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
  return (
    <div className="overflow-hidden rounded-xl border border-line/70 bg-surface">
      <div className="grid grid-cols-7 border-b border-line/70 bg-surface-2/50">
        {WEEKDAYS.map((d) => <div key={d} className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-muted">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const k = dayKey(d.toISOString());
          const list = byDay.get(k) ?? [];
          const inMonth = d.getMonth() === cursor.getMonth();
          const today = sameDay(d, now);
          const weekend = i % 7 >= 5;
          return (
            <div key={k} role="button" tabIndex={0} onClick={() => onPick(k)} onKeyDown={(ev) => { if (ev.key === 'Enter') onPick(k); }}
              className={`group min-h-[6.5rem] cursor-pointer border-b border-r border-line/50 p-1.5 transition-colors hover:bg-primary/[0.04] ${(i + 1) % 7 === 0 ? 'border-r-0' : ''} ${weekend ? 'bg-surface-2/35' : ''} ${inMonth ? '' : 'opacity-45'}`}>
              <div className="mb-1 flex items-center justify-between">
                <span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold tabular-nums ${today ? 'bg-primary text-white shadow' : 'text-ink'}`}>{d.getDate()}</span>
                {list.length > 0 && <span className="text-[10px] font-semibold text-muted tabular-nums">{list.length}</span>}
              </div>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((e) => <Pill key={e.id} e={e} color={colorOf(e.projectId)} onOpen={onOpen} showTime past={e.endAt < now.toISOString()} />)}
                {list.length > 3 && <div className="px-1 text-[10px] font-semibold text-primary">+{list.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Pill({ e, color, onOpen, showTime, past }: { e: CalendarEvent; color: string; onOpen: (e: CalendarEvent) => void; showTime?: boolean; past?: boolean }) {
  return (
    <button onClick={(ev) => { ev.stopPropagation(); onOpen(e); }} title={e.subject}
      className={`flex w-full items-center gap-1 truncate rounded px-1 py-[2px] text-left text-[10.5px] leading-tight text-ink hover:brightness-95 ${past ? 'opacity-70' : ''}`}
      style={{ background: tint(color, 0.14) }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {showTime && !e.isAllDay && <span className="shrink-0 font-semibold tabular-nums text-muted">{fmtTime(e.startAt).replace(/:00/, '').replace(/\s/g, '').toLowerCase()}</span>}
      <span className="truncate font-medium">{e.subject}</span>
    </button>
  );
}

/* ── Agenda ───────────────────────────────────────────────────────────── */

function Agenda({ events, now, colorOf, names, showProject, onOpen, emptyText, onClearPick }: {
  events: CalendarEvent[]; now: Date; colorOf: (id: string | null) => string; names: Record<string, string>;
  showProject: boolean; onOpen: (e: CalendarEvent) => void; emptyText: string; onClearPick?: () => void;
}) {
  const [days, setDays] = useState(7);
  const all = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of [...events].sort((a, b) => a.startAt.localeCompare(b.startAt))) { const k = dayKey(e.startAt); if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    return [...m.entries()];
  }, [events]);
  // A single picked day shows in full; the rolling list shows a week of days at a time.
  const groups = onClearPick ? all : all.slice(0, days);
  if (!groups.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line py-12 text-sm text-muted">
        <CalendarDays size={28} className="opacity-50" /> {emptyText}
        {onClearPick && <button onClick={onClearPick} className="text-xs font-semibold text-primary hover:underline">Show all upcoming</button>}
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {onClearPick && <button onClick={onClearPick} className="text-xs font-semibold text-primary hover:underline">← Show all upcoming</button>}
      {groups.map(([day, list]) => {
        const d = new Date(day + 'T12:00:00');
        const today = sameDay(d, now);
        return (
          <div key={day} className="flex gap-4">
            <div className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl ${today ? 'bg-primary text-white shadow' : 'bg-surface-2 text-ink ring-1 ring-line/70'}`}>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${today ? 'text-white/85' : 'text-muted'}`}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="text-xl font-bold leading-none tabular-nums">{d.getDate()}</span>
            </div>
            <ul className="min-w-0 flex-1 space-y-2">
              {list.map((e) => {
                const c = colorOf(e.projectId);
                const people = e.attendees.filter((a) => a.email);
                const clients = people.filter((a) => !a.email.endsWith('@simpliigence.com')).length;
                const live = e.startAt <= now.toISOString() && e.endAt >= now.toISOString();
                return (
                  <li key={e.id}>
                    <button onClick={() => onOpen(e)} className="group flex w-full items-stretch gap-3 overflow-hidden rounded-xl border border-line/70 bg-surface text-left shadow-sm transition hover:shadow-md">
                      <span className="w-1 shrink-0" style={{ background: c }} />
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 py-2.5 pr-3">
                        <div className="w-24 shrink-0 text-xs font-semibold tabular-nums text-ink">
                          {e.isAllDay ? 'All day' : <>{fmtTime(e.startAt)}<div className="font-normal text-muted">{fmtTime(e.endAt)}</div></>}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-ink">{e.subject}</span>
                            {live && <span className="rounded-full bg-rose-500 px-1.5 py-px text-[9px] font-bold uppercase text-white">Now</span>}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted">
                            {showProject && (e.projectId
                              ? <span className="font-semibold" style={{ color: c }}>{names[e.projectId]}</span>
                              : <span className="italic">Untagged</span>)}
                            {e.organizerName && <span>by {e.organizerName}</span>}
                            {clients > 0 && <span>{clients} client{clients > 1 ? 's' : ''}</span>}
                          </div>
                        </div>
                        <div className="flex items-center -space-x-1.5">
                          {people.slice(0, 4).map((a) => (
                            <span key={a.email} title={a.name ?? a.email}
                              className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-surface"
                              style={{ background: a.email.endsWith('@simpliigence.com') ? '#64748b' : c }}>{initials(a.name ?? a.email)}</span>
                          ))}
                          {people.length > 4 && <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-[9px] font-bold text-muted ring-2 ring-surface">+{people.length - 4}</span>}
                        </div>
                        {e.joinUrl && (
                          <a href={e.joinUrl} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-white shadow-sm" style={{ background: c }}>
                            <Video size={12} /> Join
                          </a>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {groups.length < all.length && (
        <button onClick={() => setDays((d) => d + 7)} className="ml-[4.5rem] rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2">
          Show more · {all.length - groups.length} more day{all.length - groups.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

/* ── Detail ───────────────────────────────────────────────────────────── */

function EventDetail({ e, color, names, order, showProject, canEdit, onClose, onChanged }: {
  e: CalendarEvent; color: string; names: Record<string, string>; order: string[]; showProject: boolean;
  canEdit: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); onChanged(); } catch (err) { alert((err as Error).message); } finally { setBusy(false); } };
  const people = e.attendees.filter((a) => a.email);
  const start = new Date(e.startAt);
  const canTag = canEdit && showProject && order.length > 1;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
        <div className="h-1.5" style={{ background: color }} />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-bold leading-snug text-ink">{e.subject}</h3>
            <button aria-label="Close" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"><X size={16} /></button>
          </div>
          <div className="mt-3 space-y-2 text-sm">
            <div className="flex items-center gap-2 text-ink/90"><Clock size={14} className="text-muted" />
              {start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}{!e.isAllDay && <> · {fmtTime(e.startAt)} – {fmtTime(e.endAt)}</>}
            </div>
            {showProject && (
              <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                <span className="font-semibold text-ink">{e.projectId ? names[e.projectId] : 'Untagged'}</span>
                {e.matchReason && <span className="text-xs text-muted">· {e.matchReason}</span>}
              </div>
            )}
            {e.location && !e.joinUrl && <div className="flex items-center gap-2 text-ink/90"><MapPin size={14} className="text-muted" />{e.location}</div>}
            {e.organizerName && <div className="text-xs text-muted">Organised by {e.organizerName}</div>}
          </div>
          {people.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted"><Users size={12} /> {people.length} attendee{people.length > 1 ? 's' : ''}</div>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {people.map((a) => (
                  <li key={a.email} className="flex items-center gap-2 text-xs">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full text-[8px] font-bold text-white" style={{ background: a.email.endsWith('@simpliigence.com') ? '#64748b' : color }}>{initials(a.name ?? a.email)}</span>
                    <span className="truncate text-ink">{a.name ?? a.email}</span>
                    {!a.email.endsWith('@simpliigence.com') && <span className="rounded bg-surface-2 px-1 text-[9px] font-semibold text-muted">client</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {e.joinUrl && <a href={e.joinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm" style={{ background: color }}><Video size={13} /> Join meeting</a>}
            {e.webLink && <a href={e.webLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface-2"><ExternalLink size={13} /> Open in Outlook</a>}
            {canTag && (
              <select disabled={busy} value={e.projectId ?? ''} onChange={(ev) => act(() => tagEvent(e.id, ev.target.value || null))}
                className="ml-auto rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-ink">
                <option value="">{e.projectId ? 'Untag' : 'Tag to project…'}</option>
                {order.map((id) => <option key={id} value={id}>{names[id]}</option>)}
              </select>
            )}
            {canTag && !e.projectId && (
              <button disabled={busy} onClick={() => act(() => tagEvent(e.id, null, true))} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1.5 text-xs text-muted hover:text-ink"><EyeOff size={12} /> Not a project meeting</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
