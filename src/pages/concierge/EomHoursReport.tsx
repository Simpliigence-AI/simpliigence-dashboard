/**
 * End-of-month billing report (Concierge → Billing tab).
 *
 * Every column comes from data that already exists:
 *
 *   Tickets billed    tickets whose billing month is this month
 *   Tickets resolved  of those, the ones now closed
 *   Est. hours        sum of tickets.estimated_hours for the month's tickets
 *   Hours in month    sum of ticket_time_entries.hours with logged_at in month
 *   Hours on tickets  sum of tickets.hours_logged for the month's tickets
 *                     (lifetime, i.e. including effort logged in other months)
 *   Fixed cost        manual per-account charge, not ticket-derived (editable)
 *
 * BILLING MONTH. A ticket belongs to the month in `tickets.billing_month`, and
 * falls back to the month of `created_time` when that is unset. So work raised
 * in August but invoiced in September is set to bill in September and lands in
 * this report's September row — which the old created_time-only rollup could
 * not express, leaving late-arriving tickets effectively unbillable.
 *
 * "Hours in month" deliberately does NOT follow the billing month: it reports
 * effort actually logged inside the calendar month, and is the one column that
 * still answers "what did the team spend in September".
 *
 * Rows are grouped by the ticket's account NAME, not account_id: inbound
 * routing leaves account_id null whenever it cannot resolve the sender's
 * domain to an Account Management row, and the rest of the page groups by name
 * too. Anything without a name lands in the "(unassigned)" row so the totals
 * still reconcile.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import { Download, Loader2 } from 'lucide-react';
import { useConciergeStore, type ConciergeTicket } from '../../store/useConciergeStore';
import { useConciergeFixedBillingStore } from '../../store/useConciergeFixedBillingStore';
import { csvDateStamp, exportRowsToCsv, type CsvColumn } from '../../lib/exportCsv';
import { isTicketClosed } from '../../lib/ticketStatus';

const UNASSIGNED = '(unassigned)';

interface Props {
  tickets: ConciergeTicket[];
}

interface HoursRow {
  account: string;
  billed: number;
  resolved: number;
  estimatedHours: number;
  hoursInMonth: number;
  hoursOnMonthTickets: number;
  fixedCost: number;
  /** Tickets in this row that were raised in an earlier month. */
  carriedIn: number;
}

/** Current month as YYYY-MM, in local time. */
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The local calendar month an ISO timestamp falls in, or null. */
function monthOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The month a ticket bills in: the explicit override, else when it was raised. */
function billingMonthOf(t: ConciergeTicket): string | null {
  return t.billingMonth ?? monthOf(t.createdTime);
}

function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

const h1 = (n: number) => (n === 0 ? '—' : n.toFixed(1));
const usd = (n: number) => (n === 0 ? '—' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`);

const NO_HOURS: Record<string, number> = {};

interface MonthHours {
  month: string;
  hoursByTicket: Record<string, number>;
  error: string | null;
}

/** One inline-editable fixed-cost cell. Commits on blur or Enter. */
function FixedCostCell({ account, month }: { account: string; month: string }) {
  const stored = useConciergeFixedBillingStore((s) => s.byMonth[month]?.[account]?.amount ?? 0);
  const setAmount = useConciergeFixedBillingStore((s) => s.setAmount);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim() === '' ? 0 : Number(draft);
    setDraft(null);
    if (!Number.isFinite(next) || next < 0 || next === stored) return;
    void setAmount(account, month, next);
  };

  return (
    <input
      type="number"
      min="0"
      step="1"
      inputMode="decimal"
      value={draft ?? (stored === 0 ? '' : String(stored))}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
      }}
      className="w-24 px-2 py-1 text-right tabular-nums rounded-md border border-line bg-surface text-ink
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      aria-label={`Fixed cost for ${account} in ${monthLabel(month)}`}
    />
  );
}

export function EomHoursReport({ tickets }: Props) {
  const loadTimeEntriesForMonth = useConciergeStore((s) => s.loadTimeEntriesForMonth);
  const loadFixedMonth = useConciergeFixedBillingStore((s) => s.loadMonth);
  const fixedByMonth = useConciergeFixedBillingStore((s) => s.byMonth);
  const fixedError = useConciergeFixedBillingStore((s) => s.error);

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

  useEffect(() => { void loadFixedMonth(month); }, [month, loadFixedMonth]);

  const isCurrent = loaded?.month === month;
  const loading = !isCurrent;
  const hoursByTicket = isCurrent ? loaded.hoursByTicket : NO_HOURS;
  const error = isCurrent ? loaded.error : null;

  const rows = useMemo<HoursRow[]>(() => {
    const fixedThisMonth = fixedByMonth[month] ?? {};
    const byAccount = new Map<string, HoursRow>();
    const row = (account: string): HoursRow => {
      let r = byAccount.get(account);
      if (!r) {
        r = {
          account, billed: 0, resolved: 0, estimatedHours: 0,
          hoursInMonth: 0, hoursOnMonthTickets: 0, fixedCost: 0, carriedIn: 0,
        };
        byAccount.set(account, r);
      }
      return r;
    };
    const accountOf = (t: ConciergeTicket) => t.account?.trim() || UNASSIGNED;

    for (const t of tickets) {
      if (billingMonthOf(t) !== month) continue;
      const r = row(accountOf(t));
      r.billed += 1;
      if (monthOf(t.createdTime) !== month) r.carriedIn += 1;
      if (t.estimatedHours != null && Number.isFinite(t.estimatedHours)) r.estimatedHours += t.estimatedHours;
      if (Number.isFinite(t.hoursLogged)) r.hoursOnMonthTickets += t.hoursLogged;
      // "Resolved" is now "of the tickets billed this month, how many are
      // done" rather than "resolved during this calendar month" — the row is
      // an invoice line, and a ticket belongs to exactly one billing month.
      if (isTicketClosed(t.status) && t.resolvedAt) r.resolved += 1;
    }

    // Hours logged this month can belong to a ticket billed in another month,
    // so this pass can introduce accounts the loop above never saw.
    const ticketById = new Map(tickets.map((t) => [t.id, t]));
    for (const [ticketId, hours] of Object.entries(hoursByTicket)) {
      const t = ticketById.get(ticketId);
      // No matching ticket in the loaded list (deleted, or beyond the row cap):
      // keep the hours in the unassigned row rather than dropping them.
      row(t ? accountOf(t) : UNASSIGNED).hoursInMonth += hours;
    }

    // A fixed charge stands on its own — an account can be billed a retainer in
    // a month with no tickets and no logged hours at all.
    for (const [account, entry] of Object.entries(fixedThisMonth)) {
      if (entry.amount > 0 || byAccount.has(account)) row(account).fixedCost = entry.amount;
    }

    return Array.from(byAccount.values()).sort((a, b) => {
      if (a.account === UNASSIGNED) return 1;
      if (b.account === UNASSIGNED) return -1;
      return a.account.localeCompare(b.account);
    });
  }, [tickets, month, hoursByTicket, fixedByMonth]);

  const totals = useMemo<HoursRow>(() => rows.reduce<HoursRow>((acc, r) => ({
    account: 'Total',
    billed: acc.billed + r.billed,
    resolved: acc.resolved + r.resolved,
    estimatedHours: acc.estimatedHours + r.estimatedHours,
    hoursInMonth: acc.hoursInMonth + r.hoursInMonth,
    hoursOnMonthTickets: acc.hoursOnMonthTickets + r.hoursOnMonthTickets,
    fixedCost: acc.fixedCost + r.fixedCost,
    carriedIn: acc.carriedIn + r.carriedIn,
  }), {
    account: 'Total', billed: 0, resolved: 0, estimatedHours: 0,
    hoursInMonth: 0, hoursOnMonthTickets: 0, fixedCost: 0, carriedIn: 0,
  }), [rows]);

  const columns: CsvColumn<HoursRow>[] = [
    { label: 'Account', value: (r) => r.account },
    { label: 'Tickets billed', value: (r) => String(r.billed) },
    { label: 'Of which carried in', value: (r) => String(r.carriedIn) },
    { label: 'Tickets resolved', value: (r) => String(r.resolved) },
    { label: 'Estimated hours', value: (r) => r.estimatedHours.toFixed(2) },
    { label: 'Hours logged in month', value: (r) => r.hoursInMonth.toFixed(2) },
    { label: 'Hours on month tickets (lifetime)', value: (r) => r.hoursOnMonthTickets.toFixed(2) },
    { label: 'Fixed cost (USD)', value: (r) => r.fixedCost.toFixed(2) },
  ];

  const download = () => {
    // Total row included so the export reconciles on its own.
    exportRowsToCsv(`concierge-billing-${month}-${csvDateStamp()}.csv`, [...rows, totals], columns);
  };

  return (
    <Card
      className="mb-6"
      title={`EOM Billing — ${monthLabel(month)}`}
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
        Tickets are counted in the month set on the ticket’s <span className="font-medium text-ink/80">Bill in</span> field,
        falling back to the month they were raised — so an August ticket marked “Bill in September” appears here in
        September. “Hrs in month” is the exception: it always comes from time entries dated inside {monthLabel(month)}.
        <span className="font-medium text-ink/80"> Fixed cost</span> is a manual charge, independent of tickets — type
        into the cell to set it. Tickets with no account are grouped as{' '}
        <span className="font-medium text-ink/80">{UNASSIGNED}</span> — excluded from every per-account row, and shown
        separately so the totals reconcile.
      </p>

      {error && (
        <div className="mb-3 text-xs text-red-600">
          Could not load time entries for {monthLabel(month)}: {error}. Hours logged in month will read 0.
        </div>
      )}
      {fixedError && (
        <div className="mb-3 text-xs text-red-600">
          Could not load fixed costs: {fixedError}. Check that migration 032 has been applied.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted py-6">
          <Loader2 size={16} className="animate-spin" /> Loading hours…
        </div>
      ) : rows.length === 0 ? (
        <p className="text-center text-muted py-8">No tickets, hours or fixed charges in {monthLabel(month)}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/60">
                <th className="text-left py-2 pr-3 text-xs font-medium text-muted uppercase">Account</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Billed</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Resolved</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Est. hrs</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Hrs in month</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted/70 uppercase whitespace-nowrap">Hrs on month tickets</th>
                <th className="text-right py-2 pl-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Fixed cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.account} className="border-b border-line/40 last:border-0 hover:bg-surface-2/70">
                  <td className={`py-2 pr-3 font-medium ${r.account === UNASSIGNED ? 'text-muted italic' : 'text-ink'}`}>{r.account}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-ink/80">
                    {r.billed || '—'}
                    {r.carriedIn > 0 && (
                      <span
                        className="ml-1 text-[11px] text-amber-600 cursor-help"
                        title={`${r.carriedIn} raised in an earlier month, billed here`}
                      >+{r.carriedIn}</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-ink/80">{r.resolved || '—'}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-ink/80">{h1(r.estimatedHours)}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold text-ink">{h1(r.hoursInMonth)}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-muted">{h1(r.hoursOnMonthTickets)}</td>
                  <td className="py-2 pl-2 text-right">
                    {r.account === UNASSIGNED
                      ? <span className="text-muted">—</span>
                      : <FixedCostCell account={r.account} month={month} />}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface-2/70 font-semibold">
                <td className="py-2 pr-3 text-ink">Total</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{totals.billed}</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{totals.resolved}</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{h1(totals.estimatedHours)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{h1(totals.hoursInMonth)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-muted">{h1(totals.hoursOnMonthTickets)}</td>
                <td className="py-2 pl-2 text-right tabular-nums text-ink pr-2">{usd(totals.fixedCost)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
