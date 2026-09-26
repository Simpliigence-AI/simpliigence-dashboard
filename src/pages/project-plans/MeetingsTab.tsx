/**
 * Meetings — this project's invites from the team's Outlook calendars
 * (delivery_calendar_events, filled by the delivery-calendar edge function),
 * plus the keywords that auto-match an invite to this project.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, CalendarDays } from 'lucide-react';
import { Card, EmptyState } from '../../components/ui';
import { MeetingCalendar } from '../../components/delivery/MeetingCalendar';
import { loadEvents, setCalendarKeywords, fmtAgo, type CalendarEvent } from '../../lib/deliveryHome';
import { supabase } from '../../lib/supabase';
import { useDeliveryStore } from '../../store/useDeliveryStore';

export function MeetingsTab({ projectId, projectName, canEdit }: { projectId: string; projectName: string; canEdit: boolean }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [keywords, setKeywords] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const recordings = useDeliveryStore((s) => s.documents.filter((d) => d.projectId === projectId && d.docType === 'Meeting'));

  const load = useCallback(async () => {
    try {
      const [ev, { data }] = await Promise.all([
        loadEvents({ projectId, fromIso: new Date(Date.now() - 60 * 86400_000).toISOString() }),
        supabase.from('delivery_projects').select('calendar_keywords, client_domains').eq('id', projectId).maybeSingle(),
      ]);
      setEvents(ev);
      setKeywords(((data?.calendar_keywords as string[] | null) ?? []).join(', '));
      setDomains((data?.client_domains as string[] | null) ?? []);
    } finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const now = new Date().toISOString();
  const past = useMemo(() => events.filter((e) => e.endAt < now && !e.isCancelled).reverse(), [events, now]);
  const upcoming = events.filter((e) => e.startAt >= now && !e.isCancelled);
  const lastRec = recordings.reduce<string | null>((m, d) => { const t = d.modifiedAt ?? d.createdAt; return t && (!m || t > m) ? t : m; }, null);

  const save = async () => {
    setSaving(true); setNote(null);
    try {
      const n = await setCalendarKeywords(projectId, keywords.split(',').map((k) => k.trim()).filter(Boolean));
      setNote(n ? `${n} invite${n > 1 ? 's' : ''} re-matched.` : 'Saved.');
      await load();
    } catch (e) { setNote((e as Error).message); } finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Loading meetings…</div>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <Card title="Meetings">
        {events.length === 0 ? (
          <EmptyState icon={<CalendarDays size={32} />} title="No meetings matched yet"
            description={`Invites on Sujatha’s, Anupama’s and the team’s calendars are matched to “${projectName}” by name, keywords and client attendees. Add keywords on the right, or tag an invite from Delivery Home.`} />
        ) : (
          <MeetingCalendar events={events} projectNames={{ [projectId]: projectName }} showProject={false} canEdit={canEdit} onChanged={load} emptyText="Nothing booked ahead." />
        )}
      </Card>
      <div className="space-y-4">
        <Card title="Cadence">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="eyebrow">Next 14 days</dt><dd className={`text-xl font-bold tabular-nums ${upcoming.filter((e) => e.startAt < new Date(Date.now() + 14 * 86400_000).toISOString()).length ? 'text-ink' : 'text-rose'}`}>{upcoming.filter((e) => e.startAt < new Date(Date.now() + 14 * 86400_000).toISOString()).length}</dd></div>
            <div><dt className="eyebrow">Last meeting</dt><dd className="font-semibold text-ink">{past[0] ? fmtAgo(past[0].endAt) : '—'}</dd></div>
            <div className="col-span-2"><dt className="eyebrow">Last recording / transcript</dt><dd className={`font-semibold ${lastRec && Date.now() - new Date(lastRec).getTime() < 14 * 86400_000 ? 'text-ink' : 'text-rose'}`}>{fmtAgo(lastRec)}</dd>
              <p className="text-xs text-muted">From Documents (type Meeting). Save Teams recordings or transcripts to the project’s SharePoint folder.</p></div>
          </dl>
        </Card>
        <Card title="Matching">
          <label className="block text-xs font-semibold text-muted mb-1">Keywords in the invite subject</label>
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} disabled={!canEdit} placeholder="e.g. OCP, Payment Matching"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          <p className="mt-1 text-[11px] text-muted">Comma-separated. The project and client names already count.</p>
          {domains.length > 0 && <p className="mt-2 text-[11px] text-muted">Client domains learned from tagged invites: <span className="text-ink">{domains.join(', ')}</span></p>}
          {canEdit && <button onClick={save} disabled={saving} className="mt-3 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save & re-match'}</button>}
          {note && <p className="mt-2 text-xs text-muted">{note}</p>}
        </Card>
      </div>
    </div>
  );
}
