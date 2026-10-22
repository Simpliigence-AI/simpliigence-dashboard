/**
 * Concierge Home — where the concierge book needs attention, in one place.
 *
 *   Accounts            every active (non-dormant) account with its flags
 *   Quiet accounts      no ticket raised in the last N days (default 15)
 *   Tickets to chase    open tickets not being worked (no activity in N days),
 *                       with no estimated hours, or with nobody assigned
 *   Billing below floor this month's fixed + T&M under the threshold (same maths as Billing)
 *   Meeting cadence     no client meeting booked in the next 14 days
 *   Calendar            client meetings from the team's Outlook calendars, matched to
 *                       accounts by name, keyword or a client-domain attendee
 *
 * Rules live in SQL (migration 042: v_concierge_home_accounts, v_concierge_home_tickets,
 * v_concierge_calendar_events); thresholds in concierge_home_settings, editable here.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Building2, MailQuestion, Hourglass, Timer, UserX, DollarSign, CalendarDays, CalendarX, Settings2, ChevronRight } from 'lucide-react';
import { Card, Badge } from '../../components/ui';
import { MeetingCalendar } from '../../components/delivery/MeetingCalendar';
import { supabase } from '../../lib/supabase';
import { useTabPermission } from '../../hooks/useTabPermission';
import { fmtAgo, fmtIn, type CalendarEvent } from '../../lib/deliveryHome';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface HomeAccount {
  id: string; name: string; billingModel: string | null; monthlyRate: number | null; health: string | null;
  openTickets: number; recentTickets: number; lastTicketAt: string | null;
  quiet: boolean; noEstimate: number; unassigned: number; stalled: number;
  fixedAmount: number; tmAmount: number; monthBilling: number; belowFloor: boolean;
  held30d: number; lastMeetingAt: string | null; nextMeetingAt: string | null; upcoming14d: number; noUpcomingMeeting: boolean;
}
interface HomeTicket {
  id: string; ticketNumber: string | null; subject: string; status: string; priority: string | null; account: string | null;
  accountId: string | null; assigneeEmail: string | null; estimatedHours: number | null; lastActivityAt: string | null;
  noEstimate: boolean; unassigned: boolean; stalled: boolean; overdue: boolean; idleDays: number | null;
}
interface Settings { billingFloor: number; quietDays: number; staleDays: number }

const n = (v: any) => (v == null ? 0 : Number(v));
const usd = (v: number) => v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const MODEL: Record<string, string> = { hourly: 'Hourly', monthly_retainer: 'Retainer', annual_unlimited: 'Annual' };

export function ConciergeHomeTab({ onOpenTicket }: { onOpenTicket: (id: string) => void }) {
  const perm = useTabPermission('concierge');
  const [accounts, setAccounts] = useState<HomeAccount[]>([]);
  const [tickets, setTickets] = useState<HomeTicket[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [settings, setSettings] = useState<Settings>({ billingFloor: 1000, quietDays: 15, staleDays: 7 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [a, t, e, s] = await Promise.all([
        supabase.from('v_concierge_home_accounts').select('*').order('name'),
        supabase.from('v_concierge_home_tickets').select('*').order('last_activity_at', { ascending: true }),
        supabase.from('v_concierge_calendar_events').select('*').gte('start_at', since).order('start_at').limit(2000),
        supabase.from('concierge_home_settings').select('*').eq('id', 1).maybeSingle(),
      ]);
      const err = a.error ?? t.error ?? e.error ?? s.error;
      if (err) throw new Error(err.message);
      setAccounts(((a.data ?? []) as any[]).map((r) => ({
        id: r.id, name: r.name, billingModel: r.billing_model ?? null, monthlyRate: r.monthly_rate == null ? null : n(r.monthly_rate), health: r.health ?? null,
        openTickets: n(r.open_tickets), recentTickets: n(r.recent_tickets), lastTicketAt: r.last_ticket_at ?? null,
        quiet: !!r.quiet, noEstimate: n(r.no_estimate), unassigned: n(r.unassigned), stalled: n(r.stalled),
        fixedAmount: n(r.fixed_amount), tmAmount: n(r.tm_amount), monthBilling: n(r.month_billing), belowFloor: !!r.below_floor,
        held30d: n(r.held_30d), lastMeetingAt: r.last_meeting_at ?? null, nextMeetingAt: r.next_meeting_at ?? null,
        upcoming14d: n(r.upcoming_14d), noUpcomingMeeting: !!r.no_upcoming_meeting,
      })));
      setTickets(((t.data ?? []) as any[]).map((r) => ({
        id: r.id, ticketNumber: r.ticket_number ?? null, subject: r.subject ?? '(no subject)', status: r.status, priority: r.priority ?? null,
        account: r.account ?? null, accountId: r.account_id ?? null, assigneeEmail: r.assignee_email ?? null,
        estimatedHours: r.estimated_hours == null ? null : n(r.estimated_hours), lastActivityAt: r.last_activity_at ?? null,
        noEstimate: !!r.no_estimate, unassigned: !!r.unassigned, stalled: !!r.stalled, overdue: !!r.overdue, idleDays: r.idle_days ?? null,
      })));
      setEvents(((e.data ?? []) as any[]).map((r) => ({
        id: r.id, subject: r.subject ?? '(no subject)', startAt: r.start_at, endAt: r.end_at, isAllDay: !!r.is_all_day, isCancelled: !!r.is_cancelled,
        organizer: r.organizer ?? null, organizerName: r.organizer_name ?? null, attendees: Array.isArray(r.attendees) ? r.attendees : [],
        mailboxes: [], joinUrl: r.join_url ?? null, webLink: r.web_link ?? null, location: r.location ?? null, isExternal: !!r.is_external,
        projectId: r.concierge_account_id, matchSource: 'auto', matchReason: null,
      })));
      if (s.data) setSettings({ billingFloor: n((s.data as any).billing_floor), quietDays: n((s.data as any).quiet_days), staleDays: n((s.data as any).stale_days) });
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const names = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a.name])), [accounts]);
  const quiet = accounts.filter((a) => a.quiet);
  const chase = tickets.filter((t) => t.stalled || t.noEstimate || t.unassigned);
  const stalled = tickets.filter((t) => t.stalled);
  const noEst = tickets.filter((t) => t.noEstimate);
  const unassigned = tickets.filter((t) => t.unassigned);
  const lowBill = accounts.filter((a) => a.belowFloor);
  const noMeeting = accounts.filter((a) => a.noUpcomingMeeting);
  const [loadedAt] = useState(() => Date.now());
  const in14 = new Date(loadedAt + 14 * 86400_000).toISOString();
  const nowIso = new Date(loadedAt).toISOString();
  const upcoming = events.filter((e) => e.startAt >= nowIso && e.startAt < in14 && !e.isCancelled);

  if (loading) return <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Loading Concierge Home…</div>;

  const go = (k: string) => document.getElementById(`ch-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="space-y-6">
      {error && <div className="rounded-lg border border-rose/30 bg-rose/5 px-4 py-3 text-sm text-rose">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
        <Tile icon={<Building2 size={16} />} label="Active accounts" value={accounts.length} onClick={() => go('accounts')} />
        <Tile icon={<MailQuestion size={16} />} label={`No ticket ${settings.quietDays}d`} value={quiet.length} bad={quiet.length > 0} onClick={() => go('quiet')} />
        <Tile icon={<Hourglass size={16} />} label="Not being worked" value={stalled.length} bad={stalled.length > 0} onClick={() => go('tickets')} />
        <Tile icon={<Timer size={16} />} label="No estimate" value={noEst.length} bad={noEst.length > 0} onClick={() => go('tickets')} />
        <Tile icon={<UserX size={16} />} label="Unassigned" value={unassigned.length} bad={unassigned.length > 0} onClick={() => go('tickets')} />
        <Tile icon={<DollarSign size={16} />} label={`Billing < ${usd(settings.billingFloor)}`} value={lowBill.length} bad={lowBill.length > 0} onClick={() => go('billing')} />
        <Tile icon={<CalendarX size={16} />} label="No meeting booked" value={noMeeting.length} bad={noMeeting.length > 0} onClick={() => go('cadence')} />
        <Tile icon={<CalendarDays size={16} />} label="Meetings next 14d" value={upcoming.length} onClick={() => go('calendar')} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Rules: no ticket in <b className="text-ink">{settings.quietDays} days</b> · open ticket idle <b className="text-ink">{settings.staleDays} days</b> · billing floor <b className="text-ink">{usd(settings.billingFloor)}</b> this month.</span>
        {perm.canEdit && <button onClick={() => setEditing((v) => !v)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 font-semibold text-ink/80 hover:bg-surface-2"><Settings2 size={12} /> Change</button>}
      </div>
      {editing && <SettingsForm value={settings} onSaved={(s) => { setSettings(s); setEditing(false); void load(); }} />}

      <Section id="accounts" title="Accounts" count={accounts.length}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted border-b border-line/60">
              <th className="px-5 py-2 font-semibold">Account</th><th className="px-3 py-2 font-semibold text-right">Open</th>
              <th className="px-3 py-2 font-semibold">Last ticket</th><th className="px-3 py-2 font-semibold text-right">This month</th>
              <th className="px-3 py-2 font-semibold">Next meeting</th><th className="px-3 py-2 font-semibold">Flags</th>
            </tr></thead>
            <tbody>
              {accounts.map((a) => {
                const clean = !(a.quiet || a.stalled || a.noEstimate || a.unassigned || a.belowFloor || a.noUpcomingMeeting);
                return (
                  <tr key={a.id} className="border-b border-line/30 last:border-b-0 hover:bg-surface-2/40">
                    <td className="px-5 py-2.5"><div className="font-semibold text-ink">{a.name}</div><div className="text-xs text-muted">{MODEL[a.billingModel ?? ''] ?? a.billingModel ?? '—'}{a.monthlyRate ? ` · ${usd(a.monthlyRate)}${a.billingModel === 'hourly' ? '/hr' : '/mo'}` : ''}</div></td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{a.openTickets}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">{fmtAgo(a.lastTicketAt)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${a.belowFloor ? 'text-rose font-semibold' : ''}`} title={`Fixed ${usd(a.fixedAmount)} + T&M ${usd(a.tmAmount)}`}>{usd(a.monthBilling)}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">{a.nextMeetingAt ? fmtIn(a.nextMeetingAt) : <span className="text-muted">none booked</span>}</td>
                    <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">
                      {a.quiet && <Badge variant="warning">No ticket {settings.quietDays}d</Badge>}
                      {a.stalled > 0 && <Badge variant="danger">{a.stalled} not worked</Badge>}
                      {a.noEstimate > 0 && <Badge variant="warning">{a.noEstimate} no estimate</Badge>}
                      {a.unassigned > 0 && <Badge variant="warning">{a.unassigned} unassigned</Badge>}
                      {a.belowFloor && <Badge variant="danger">Billing low</Badge>}
                      {a.noUpcomingMeeting && <Badge variant="neutral">No meeting</Badge>}
                      {clean && <Badge variant="success">On track</Badge>}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section id="quiet" title={`No tickets in the last ${settings.quietDays} days`} count={quiet.length}
          note="Active accounts that haven't raised a ticket recently — check in before the relationship goes quiet.">
          <List empty="Every active account has raised a ticket recently.">
            {quiet.map((a) => (
              <li key={a.id} className="px-5 py-2.5">
                <div className="font-semibold text-ink">{a.name}</div>
                <div className="text-xs text-muted">Last ticket <b className="text-ink">{fmtAgo(a.lastTicketAt)}</b> · {a.openTickets} open · next meeting {fmtIn(a.nextMeetingAt)}</div>
              </li>
            ))}
          </List>
        </Section>

        <Section id="billing" title={`Billing below ${usd(settings.billingFloor)} this month`} count={lowBill.length}
          note="Fixed cost (stored, or the retainer's monthly amount) + T&M (estimated hours on tickets billed this month × hourly rate) — the Billing tab's maths.">
          <List empty="Every account is at or above the floor this month.">
            {lowBill.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <div>
                  <div className="font-semibold text-ink">{a.name}</div>
                  <div className="text-xs text-muted">Fixed {usd(a.fixedAmount)} + T&amp;M {usd(a.tmAmount)} · {MODEL[a.billingModel ?? ''] ?? a.billingModel}</div>
                </div>
                <span className="font-bold tabular-nums text-rose">{usd(a.monthBilling)}</span>
              </li>
            ))}
          </List>
        </Section>

        <Section id="tickets" title="Tickets needing follow-up" count={chase.length}
          note={`Open tickets with no activity (time logged, reply sent, update) in ${settings.staleDays} days, no estimated hours, or nobody assigned. Click one to open it.`}>
          <List empty="Every open ticket is assigned, estimated and moving.">
            {chase.map((t) => (
              <li key={t.id}>
                <button onClick={() => onOpenTicket(t.id)} className="flex w-full items-center justify-between gap-3 px-5 py-2.5 text-left hover:bg-surface-2/50">
                  <div className="min-w-0">
                    <div className="text-sm text-ink break-words">{t.ticketNumber ? <span className="text-muted">#{t.ticketNumber} </span> : null}{t.subject}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span className="font-semibold text-ink/80">{t.account || 'No account'}</span>
                      <span>{t.status}</span>
                      <span>{t.assigneeEmail ? t.assigneeEmail.split('@')[0] : <span className="text-rose font-semibold">unassigned</span>}</span>
                      <span>Est: {t.estimatedHours ? `${t.estimatedHours}h` : <span className="text-rose font-semibold">none</span>}</span>
                      <span>Last activity {fmtAgo(t.lastActivityAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {t.stalled && <Badge variant="danger">Idle {t.idleDays}d</Badge>}
                    {t.overdue && <Badge variant="danger">Overdue</Badge>}
                    <ChevronRight size={14} className="text-muted" />
                  </div>
                </button>
              </li>
            ))}
          </List>
        </Section>

        <Section id="cadence" title="No client meeting booked in the next 14 days" count={noMeeting.length}
          note="From the team's Outlook calendars. An invite counts for an account when its subject names the account or a client-domain contact is invited.">
          <List empty="Every account has a meeting booked.">
            {noMeeting.map((a) => (
              <li key={a.id} className="px-5 py-2.5">
                <div className="font-semibold text-ink">{a.name}</div>
                <div className="text-xs text-muted">Last meeting <b className="text-ink">{fmtAgo(a.lastMeetingAt)}</b> · {a.held30d} in the last 30 days</div>
              </li>
            ))}
          </List>
        </Section>
      </div>

      <Section id="calendar" title="Client meetings" count={upcoming.length}
        note="Upcoming and recent meetings with concierge clients, from the team's Outlook calendars (synced hourly).">
        <div className="p-5">
          <MeetingCalendar events={events} projectNames={names} canEdit={false} emptyText="No client meetings booked." />
        </div>
      </Section>
    </div>
  );
}

function SettingsForm({ value, onSaved }: { value: Settings; onSaved: (s: Settings) => void }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('concierge_home_set_settings', { p_billing_floor: v.billingFloor, p_quiet_days: v.quietDays, p_stale_days: v.staleDays });
    setBusy(false);
    if (error) { alert(error.message); return; }
    onSaved(v);
  };
  const field = (label: string, k: keyof Settings, suffix: string) => (
    <label className="text-xs font-semibold text-muted">
      {label}
      <div className="mt-1 flex items-center gap-1">
        <input type="number" min={1} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
          className="w-28 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink" />
        <span>{suffix}</span>
      </div>
    </label>
  );
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-5">
        {field('Billing floor this month', 'billingFloor', 'USD')}
        {field('Flag accounts with no ticket in', 'quietDays', 'days')}
        {field('Flag open tickets idle for', 'staleDays', 'days')}
        <button onClick={save} disabled={busy} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </Card>
  );
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
    <section id={`ch-${id}`} className="scroll-mt-20">
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
