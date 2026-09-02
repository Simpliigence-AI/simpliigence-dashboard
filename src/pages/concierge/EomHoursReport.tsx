/**
 * End-of-month hours report (Concierge → Billing tab).
 *
 * Read-only. Hours, plus one derived amount (Monthly Bill) — still no invoice
 * total. Every column comes from data that already exists:
 *
 *   Tickets opened    tickets.created_time inside the month
 *   Tickets resolved  tickets.resolved_at inside the month
 *   Est. hours        sum of tickets.estimated_hours for the month's tickets
 *   Hours in month    sum of ticket_time_entries.hours with logged_at in month
 *   Hours on tickets  sum of tickets.hours_logged for the month's tickets
 *                     (lifetime, i.e. including effort logged in other months)
 *   Monthly Bill      est. hours on the month's RESOLVED tickets ×
 *                     concierge_accounts.monthly_rate — the account's monthly
 *                     retainer in USD; there is no hourly rate in the schema.
 *                     Em-dash (not $0) whenever either side is missing.
 *
 * Rows are grouped by the ticket's account NAME, not account_id: inbound
 * routing leaves account_id null whenever it cannot resolve the sender's
 * domain to an Account Management row, and the rest of the page groups by name
 * too. Anything without a name lands in the "(unassigned)" row so the totals
 * still reconcile. The monthly rate is looked up by that same name: tickets
 * carry no concierge_accounts id (tickets.account_id points at the separate
 * `accounts` table), and concierge_accounts.name is unique.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import { Download, Loader2 } from 'lucide-react';
import { useConciergeStore, type ConciergeTicket } from '../../store/useConciergeStore';
import { useConciergeAccountsStore } from '../../store/useConciergeAccountsStore';
import { csvDateStamp, exportRowsToCsv, type CsvColumn } from '../../lib/exportCsv';
import { isTicketClosed } from '../../lib/ticketStatus';

const UNASSIGNED = '(unassigned)';

interface Props {
  tickets: ConciergeTicket[];
}

interface HoursRow {
  account: string;
  opened: number;
  resolved: number;
  estimatedHours: number;
  /** Est. hours on the tickets resolved this month — the basis of Monthly Bill.
   *  Distinct from estimatedHours, which covers the tickets opened this month. */
  resolvedEstimatedHours: number;
  hoursInMonth: number;
  hoursOnMonthTickets: number;
  /** concierge_accounts.monthly_rate for the matching account, in USD/month. */
  monthlyRate: number | null;
  /** resolvedEstimatedHours × monthlyRate; null when either side is missing. */
  monthlyBill: number | null;
}

/** Current month as YYYY-MM, in local time. */
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** True when an ISO timestamp falls inside the local calendar month YYYY-MM. */
function inMonth(iso: string | null, month: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === month;
}

function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

const h1 = (n: number) => (n === 0 ? '—' : n.toFixed(1));
/** Whole dollars, same shape as the amounts on the rest of the Billing tab. */
const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const NO_HOURS: Record<string, number> = {};

interface MonthHours {
  month: string;
  hoursByTicket: Record<string, number>;
  error: string | null;
}

export function EomHoursReport({ tickets }: Props) {
  const loadTimeEntriesForMonth = useConciergeStore((s) => s.loadTimeEntriesForMonth);
  const conciergeAccounts = useConciergeAccountsStore((s) => s.accounts);
  const [month, setMonth] = useState<string>(() => currentMonthKey());
  /* One state object stamped with the month it belongs to, so "still loading"
   * is derived from a stale stamp rather than a second setState in the effect
   * body (which cascades a render). */
  const [loaded, setLoaded] = useState<MonthHours | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadTimeEntriesForMonth(month).then(({ entries, error: err }) => {
      if (cancelled) return;
      const byTicket: Record<string, number> = {};
      for (const e of entries) {
        byTicket[e.ticketId] = (byTicket[e.ticketId] ?? 0) + (Number.isFinite(e.hours) ? e.hours : 0);
      }
      setLoaded({ month, hoursByTicket: byTicket, error: err });
    });
    return () => { cancelled = true; };
  }, [month, loadTimeEntriesForMonth]);

  const isCurrent = loaded?.month === month;
  const loading = !isCurrent;
  const hoursByTicket = isCurrent ? loaded.hoursByTicket : NO_HOURS;
  const error = isCurrent ? loaded.error : null;

  /* Monthly retainer per account, keyed by lower-cased name — the same match
   * the Overview tab uses to spot ticket-only accounts. */
  const rateByAccountName = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const a of conciergeAccounts) m.set(a.name.trim().toLowerCase(), a.monthlyRate);
    return m;
  }, [conciergeAccounts]);

  const rows = useMemo<HoursRow[]>(() => {
    const byAccount = new Map<string, HoursRow>();
    const row = (account: string): HoursRow => {
      let r = byAccount.get(account);
      if (!r) {
        r = {
          account, opened: 0, resolved: 0, estimatedHours: 0, resolvedEstimatedHours: 0,
          hoursInMonth: 0, hoursOnMonthTickets: 0,
          monthlyRate: rateByAccountName.get(account.trim().toLowerCase()) ?? null,
          monthlyBill: null,
        };
        byAccount.set(account, r);
      }
      return r;
    };
    const accountOf = (t: ConciergeTicket) => t.account?.trim() || UNASSIGNED;

    for (const t of tickets) {
      const openedThisMonth = inMonth(t.createdTime, month);
      // resolved_at is stamped when the status enters Resolved/Closed; tickets
      // closed before that stamp existed have none, and fall out of the month
      // rather than being guessed at from updated_at, which any edit bumps.
      const resolvedThisMonth = inMonth(t.resolvedAt, month) && isTicketClosed(t.status);
      if (openedThisMonth) {
        const r = row(accountOf(t));
        r.opened += 1;
        if (t.estimatedHours != null && Number.isFinite(t.estimatedHours)) r.estimatedHours += t.estimatedHours;
        if (Number.isFinite(t.hoursLogged)) r.hoursOnMonthTickets += t.hoursLogged;
      }
      if (resolvedThisMonth) {
        const r = row(accountOf(t));
        r.resolved += 1;
        if (t.estimatedHours != null && Number.isFinite(t.estimatedHours)) r.resolvedEstimatedHours += t.estimatedHours;
      }
    }

    // Hours logged this month can belong to a ticket opened in an earlier
    // month, so this pass can introduce accounts the loop above never saw.
    const ticketById = new Map(tickets.map((t) => [t.id, t]));
    for (const [ticketId, hours] of Object.entries(hoursByTicket)) {
      const t = ticketById.get(ticketId);
      // No matching ticket in the loaded list (deleted, or beyond the row cap):
      // keep the hours in the unassigned row rather than dropping them.
      row(t ? accountOf(t) : UNASSIGNED).hoursInMonth += hours;
    }

    const out = Array.from(byAccount.values());
    for (const r of out) {
      // Resolved work only, and only where the account has a rate — a missing
      // rate or estimate leaves the cell an em-dash rather than reading $0.
      r.monthlyBill = r.monthlyRate && r.resolvedEstimatedHours > 0
        ? r.resolvedEstimatedHours * r.monthlyRate
        : null;
    }

    return out.sort((a, b) => {
      if (a.account === UNASSIGNED) return 1;
      if (b.account === UNASSIGNED) return -1;
      return a.account.localeCompare(b.account);
    });
  }, [tickets, month, hoursByTicket, rateByAccountName]);

  // Bills are summed per row, not recomputed from the totals: each account has
  // its own rate, so totals.resolvedEstimatedHours × one rate would be wrong.
  const totals = useMemo<HoursRow>(() => rows.reduce<HoursRow>((acc, r) => ({
    account: 'Total',
    opened: acc.opened + r.opened,
    resolved: acc.resolved + r.resolved,
    estimatedHours: acc.estimatedHours + r.estimatedHours,
    resolvedEstimatedHours: acc.resolvedEstimatedHours + r.resolvedEstimatedHours,
    hoursInMonth: acc.hoursInMonth + r.hoursInMonth,
    hoursOnMonthTickets: acc.hoursOnMonthTickets + r.hoursOnMonthTickets,
    monthlyRate: null,
    monthlyBill: (acc.monthlyBill ?? 0) + (r.monthlyBill ?? 0),
  }), {
    account: 'Total', opened: 0, resolved: 0, estimatedHours: 0, resolvedEstimatedHours: 0,
    hoursInMonth: 0, hoursOnMonthTickets: 0, monthlyRate: null, monthlyBill: 0,
  }), [rows]);

  const columns: CsvColumn<HoursRow>[] = [
    { label: 'Account', value: (r) => r.account },
    { label: 'Tickets opened', value: (r) => String(r.opened) },
    { label: 'Tickets resolved', value: (r) => String(r.resolved) },
    { label: 'Estimated hours', value: (r) => r.estimatedHours.toFixed(2) },
    { label: 'Hours logged in month', value: (r) => r.hoursInMonth.toFixed(2) },
    { label: 'Hours on month tickets (lifetime)', value: (r) => r.hoursOnMonthTickets.toFixed(2) },
    { label: 'Monthly bill (USD)', value: (r) => (r.monthlyBill == null ? '' : r.monthlyBill.toFixed(2)) },
  ];

  const download = () => {
    // Total row included so the export reconciles on its own.
    exportRowsToCsv(`concierge-hours-${month}-${csvDateStamp()}.csv`, [...rows, totals], columns);
  };

  return (
    <Card
      className="mb-6"
      title={`EOM Hours — ${monthLabel(month)}`}
      action={
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => { if (e.target.value) setMonth(e.target.value); }}
            className="px-2 py-1 rounded-md border border-line bg-surface text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label="Report month"
          />
          <Button variant="secondary" onClick={download} disabled={rows.length === 0}>
            <Download size={14} /> CSV
          </Button>
        </div>
      }
    >
      <p className="text-xs text-muted mb-3">
        Ticket counts use the local calendar month ({monthLabel(month)}); “hours logged in month”
        comes from time entries dated inside it, while “lifetime” is all effort ever logged on the
        tickets opened in it. “Monthly bill” is the est. hours on the tickets <span className="font-medium text-ink/80">resolved</span> in
        the month × the account’s monthly rate — em-dash where the account has no rate on file or its
        resolved tickets carry no estimate.
        Tickets with no account are grouped as <span className="font-medium text-ink/80">{UNASSIGNED}</span> —
        they are excluded from every per-account row, and shown separately so the totals reconcile.
      </p>

      {error && (
        <div className="mb-3 text-xs text-red-600">
          Could not load time entries for {monthLabel(month)}: {error}. Hours logged in month will read 0.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted py-6">
          <Loader2 size={16} className="animate-spin" /> Loading hours…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-center text-muted py-8">No tickets or hours in {monthLabel(month)}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/60">
                <th className="text-left py-2 pr-3 text-xs font-medium text-muted uppercase">Account</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Opened</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Resolved</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Est. hrs</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Hrs in month</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted/70 uppercase whitespace-nowrap">Hrs on month tickets</th>
                <th className="text-right py-2 pl-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Monthly Bill</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.account} className="border-b border-line/40 last:border-0 hover:bg-surface-2/70">
                  <td className={`py-2 pr-3 font-medium ${r.account === UNASSIGNED ? 'text-muted italic' : 'text-ink'}`}>{r.account}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-ink/80">{r.opened || '—'}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-ink/80">{r.resolved || '—'}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-ink/80">{h1(r.estimatedHours)}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold text-ink">{h1(r.hoursInMonth)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-muted">{h1(r.hoursOnMonthTickets)}</td>
                  <td
                    className="py-2 pl-2 text-right tabular-nums font-semibold text-ink"
                    title={r.monthlyBill == null ? undefined : `${h1(r.resolvedEstimatedHours)}h resolved × ${usd(r.monthlyRate ?? 0)}/mo`}
                  >{r.monthlyBill == null ? '—' : usd(r.monthlyBill)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface-2/70 font-semibold">
                <td className="py-2 pr-3 text-ink">Total</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{totals.opened}</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{totals.resolved}</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{h1(totals.estimatedHours)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{h1(totals.hoursInMonth)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-muted">{h1(totals.hoursOnMonthTickets)}</td>
                <td className="py-2 pl-2 text-right tabular-nums text-ink">{totals.monthlyBill ? usd(totals.monthlyBill) : '—'}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
