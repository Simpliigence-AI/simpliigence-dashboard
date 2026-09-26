/**
 * MeetingCalendar — project meetings read from Outlook (delivery_calendar_events).
 *
 * Two views over the same events:
 *   Month   a calendar grid, one colour per project; click a day to list it
 *   Agenda  day-by-day list with time, project, attendees and a join link
 * Used across all projects on Delivery Home and for one project on its
 * Meetings tab. Untagged invites (external attendees, no project matched) can be
 * tagged or dismissed in place when the viewer can edit.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Video, Users, ExternalLink, Tag, EyeOff } from 'lucide-react';
import type { CalendarEvent } from '../../lib/deliveryHome';
import { dayKey, fmtDay, fmtTime, tagEvent } from '../../lib/deliveryHome';

const PALETTE = [
  'bg-sky-500/15 text-ink border-sky-500/40',
  'bg-violet-500/15 text-ink border-violet-500/40',
  'bg-emerald-500/15 text-ink border-emerald-500/40',
  'bg-amber-500/15 text-ink border-amber-500/40',
  'bg-rose-500/15 text-ink border-rose-500/40',
  'bg-teal-500/15 text-ink border-teal-500/40',
  'bg-indigo-500/15 text-ink border-indigo-500/40',
  'bg-lime-500/15 text-ink border-lime-500/40',
];
const UNTAGGED = 'bg-surface-2 text-muted border-line border-dashed';
function colorFor(id: string | null, order: string[]): string {
  if (!id) return UNTAGGED;
  const i = order.indexOf(id);
  return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
}

interface Props {
  events: CalendarEvent[];
  /** plan id → project name */
  projectNames: Record<string, string>;
  /** Show the project label on each event (off on a single project's tab). */
  showProject?: boolean;
  canEdit?: boolean;
  onChanged?: () => void;
  emptyText?: string;
}

export function MeetingCalendar({ events, projectNames, showProject = true, canEdit = false, onChanged, emptyText }: Props) {
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [picked, setPicked] = useState<string | null>(null);
  const [loadedAt] = useState(() => Date.now());
  const order = useMemo(() => Object.keys(projectNames).sort((a, b) => projectNames[a].localeCompare(projectNames[b])), [projectNames]);
  const live = useMemo(() => events.filter((e) => !e.isCancelled && e.matchSource !== 'ignored'), [events]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of live) { const k = dayKey(e.startAt); if (!m.has(k)) m.set(k, []); m.get(k)!.push(e); }
    return m;
  }, [live]);

  const today = dayKey(new Date().toISOString());
  const cells = useMemo(() => {
    const first = new Date(cursor);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7)); // Monday-first
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  const agenda = useMemo(() => {
    const nowIso = new Date(loadedAt - 60 * 60_000).toISOString();
    const list = picked ? (byDay.get(picked) ?? []) : live.filter((e) => e.endAt >= nowIso);
    const groups = new Map<string, CalendarEvent[]>();
    for (const e of list) { const k = dayKey(e.startAt); if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(e); }
    return [...groups.entries()];
  }, [live, byDay, picked, loadedAt]);

  const legend = order.filter((id) => live.some((e) => e.projectId === id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-line p-0.5 bg-surface">
          {(['month', 'agenda'] as const).map((v) => (
            <button key={v} onClick={() => { setView(v); if (v === 'agenda') setPicked(null); }}
              className={`px-3 py-1 text-xs font-semibold rounded-md ${view === v ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}>
              {v === 'month' ? 'Month' : 'Upcoming'}
            </button>
          ))}
        </div>
        {view === 'month' && (
          <div className="flex items-center gap-2">
            <button aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="p-1.5 rounded-md hover:bg-surface-2"><ChevronLeft size={16} /></button>
            <div className="text-sm font-bold text-ink w-32 text-center">{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
            <button aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="p-1.5 rounded-md hover:bg-surface-2"><ChevronRight size={16} /></button>
            <button onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }} className="ml-1 px-2 py-1 text-xs font-semibold rounded-md border border-line hover:bg-surface-2">Today</button>
          </div>
        )}
      </div>

      {showProject && legend.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {legend.map((id) => <span key={id} className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${colorFor(id, order)}`}>{projectNames[id]}</span>)}
          {live.some((e) => !e.projectId) && <span className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${UNTAGGED}`}>Untagged</span>}
        </div>
      )}

      {view === 'month' && (
        <div className="grid grid-cols-7 border-l border-t border-line/70 rounded-lg overflow-hidden text-xs">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="px-2 py-1.5 border-r border-b border-line/70 bg-surface-2/60 font-semibold text-muted">{d}</div>)}
          {cells.map((d) => {
            const k = dayKey(d.toISOString());
            const list = byDay.get(k) ?? [];
            const inMonth = d.getMonth() === cursor.getMonth();
            return (
              <button key={k} onClick={() => { setPicked(k); setView('agenda'); }}
                className={`flex flex-col justify-start min-h-[5.5rem] p-1 text-left border-r border-b border-line/70 hover:bg-surface-2/60 ${inMonth ? 'bg-surface' : 'bg-surface-2/30 text-muted'}`}>
                <div className={`mb-0.5 text-[11px] font-semibold ${k === today ? 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white' : ''}`}>{d.getDate()}</div>
                <div className="space-y-0.5">
                  {list.slice(0, 3).map((e) => (
                    <div key={e.id} title={`${fmtTime(e.startAt)} ${e.subject}`} className={`truncate rounded border px-1 py-px text-[10.5px] leading-tight ${colorFor(e.projectId, order)}`}>
                      <span className="tabular-nums">{e.isAllDay ? '' : fmtTime(e.startAt) + ' '}</span>{e.subject}
                    </div>
                  ))}
                  {list.length > 3 && <div className="text-[10.5px] text-muted px-1">+{list.length - 3} more</div>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {view === 'agenda' && (
        <div>
          {picked && (
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span className="font-semibold text-ink">{fmtDay(picked + 'T12:00:00')}</span>
              <button onClick={() => setPicked(null)} className="text-xs text-primary hover:underline">Show all upcoming</button>
            </div>
          )}
          {agenda.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">{emptyText ?? 'No meetings.'}</p>
          ) : (
            <div className="space-y-4">
              {agenda.map(([day, list]) => (
                <div key={day}>
                  <div className="eyebrow mb-1.5">{fmtDay(day + 'T12:00:00')}{day === today ? ' · Today' : ''}</div>
                  <ul className="space-y-1.5">
                    {list.map((e) => <EventRow key={e.id} e={e} color={colorFor(e.projectId, order)} projectName={e.projectId ? projectNames[e.projectId] : null}
                      showProject={showProject} canEdit={canEdit} projectNames={projectNames} order={order} onChanged={onChanged} />)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ e, color, projectName, showProject, canEdit, projectNames, order, onChanged }: {
  e: CalendarEvent; color: string; projectName: string | null; showProject: boolean; canEdit: boolean;
  projectNames: Record<string, string>; order: string[]; onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const external = e.attendees.filter((a) => a.email && !a.email.endsWith('@simpliigence.com'));
  const act = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); onChanged?.(); } catch (err) { alert((err as Error).message); } finally { setBusy(false); } };
  return (
    <li className={`flex flex-wrap items-start gap-3 rounded-lg border-l-4 border border-line/60 bg-surface px-3 py-2 ${color.split(' ').filter((c) => c.startsWith('border-') && !c.startsWith('border-dashed')).join(' ')}`}>
      <div className="w-20 shrink-0 text-xs font-semibold tabular-nums text-ink">
        {e.isAllDay ? 'All day' : <>{fmtTime(e.startAt)}<div className="font-normal text-muted">{fmtTime(e.endAt)}</div></>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink break-words">{e.subject}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          {showProject && (projectName
            ? <span className={`rounded border px-1.5 py-px font-semibold ${color}`} title={e.matchReason ?? ''}>{projectName}{e.matchSource === 'auto' ? '' : ''}</span>
            : <span className={`rounded border px-1.5 py-px ${UNTAGGED}`}>Untagged</span>)}
          <span className="inline-flex items-center gap-1"><Users size={12} /> {e.attendees.length}{external.length ? ` · ${external.length} client` : ''}</span>
          {e.organizerName && <span>Organiser: {e.organizerName}</span>}
          {e.location && !e.joinUrl && <span>{e.location}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {e.joinUrl && <a href={e.joinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-semibold hover:bg-surface-2"><Video size={12} /> Join</a>}
        {e.webLink && <a href={e.webLink} target="_blank" rel="noreferrer" title="Open in Outlook" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"><ExternalLink size={13} /></a>}
        {canEdit && (
          <label className="inline-flex items-center gap-1 text-xs" title="Tag to a project">
            <Tag size={12} className="text-muted" />
            <select disabled={busy} value={e.projectId ?? ''} onChange={(ev) => act(() => tagEvent(e.id, ev.target.value || null))}
              className="max-w-[10rem] rounded-md border border-line bg-surface px-1.5 py-1 text-xs">
              <option value="">{e.projectId ? 'Untag' : 'Tag project…'}</option>
              {order.map((id) => <option key={id} value={id}>{projectNames[id]}</option>)}
            </select>
          </label>
        )}
        {canEdit && !e.projectId && (
          <button disabled={busy} onClick={() => act(() => tagEvent(e.id, null, true))} title="Not a project meeting — hide it"
            className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-ink"><EyeOff size={13} /></button>
        )}
      </div>
    </li>
  );
}
