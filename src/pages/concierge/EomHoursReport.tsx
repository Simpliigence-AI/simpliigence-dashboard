/**
 * End-of-month billing report (Concierge → Billing tab).
 *
 * One row per account we could invoice this month, ending in what to charge:
 *
 *   Tickets billed    tickets whose billing month is the report month
 *   Tickets resolved  of those, the ones now closed
 *   Est. hours        sum of tickets.estimated_hours for the month's tickets
 *   Hours in month    sum of ticket_time_entries.hours with logged_at in month
 *   Hours on tickets  sum of tickets.hours_logged for the month's tickets
 *                     (lifetime, i.e. including effort logged in other months)
 *   T&M cost          est. hours × the account's hourly rate — HOURLY accounts
 *                     only (see the rate note below)
 *   Fixed cost        flat charge, not ticket-derived; prefilled from the
 *                     retainer and editable
 *   Total billing     fixed + T&M
 *
 * WHICH ROWS APPEAR. An account shows up when it has anything billable: an
 * OPEN ticket (in any month — work in flight is work we will invoice), a
 * ticket billed in this month, hours logged in this month, a fixed charge, or
 * a live retainer (those bill every month whether or not a ticket exists —
 * several retainer accounts have never had a ticket raised against them).
 * Earlier this was month-activity only, which made accounts vanish from the
 * report in the months between their tickets closing and the invoice going
 * out.
 *
 * THE RATE. `concierge_accounts.monthly_rate` means two different things
 * depending on `billing_model`: for 'hourly' accounts it is an hourly rate
 * ($45–$120), for retainer/annual accounts it is a monthly amount
 * ($1,833–$6,750). So T&M is computed ONLY for hourly accounts — multiplying a
 * retainer by a ticket's hours produced five-figure nonsense. A retainer
 * account's charge is the retainer, which lands in Fixed cost instead.
 *
 * FIXED COST. Stored per (account name, month) in `concierge_fixed_billing`.
 * A retainer account with no stored row for the month falls back to its
 * monthly_rate, so the common case needs no typing; overtype the cell and the
 * typed figure is stored and wins from then on.
 *
 * BILLING MONTH. A ticket belongs to the month in `tickets.billing_month`, and
 * falls back to the month of `created_time` when that is unset — so work
 * raised in August but invoiced in September lands in the September row.
 * "Hours in month" deliberately does NOT follow it: that column reports effort
 * actually logged inside the calendar month.
 *
 * Rows are grouped by the ticket's account NAME, not account_id: inbound
 * routing leaves account_id null whenever it cannot resolve the sender's
 * domain, and the rest of the page groups by name too. Anything without a name
 * lands in "(unassigned)" so the totals still reconcile.
 */
import { useEffect, useMemo, useState } from 'react';
import { Card } from '../../components/ui';
import { Button } from '../../components/ui/Button';
import { Download, Loader2 } from 'lucide-react';
import { useConciergeStore, type ConciergeTicket } from '../../store/useConciergeStore';
import { useConciergeAccountsStore } from '../../store/useConciergeAccountsStore';
import { useConciergeFixedBillingStore } from '../../store/useConciergeFixedBillingStore';
import { csvDateStamp, exportRowsToCsv, type CsvColumn } from '../../lib/exportCsv';
import { isTicketClosed, isTicketOpen } from '../../lib/ticketStatus';
import type { BillingModel } from '../../types/concierge';

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
  /** Open tickets in any month — why a row with no month activity still shows. */
  openTickets: number;
  billingModel: BillingModel | null;
  /** monthly_rate as stored: $/hour for hourly accounts, $/month otherwise. */
  rate: number | null;
  /** est. hours × hourly rate; null when the account is not hourly or has no rate. */
  tmCost: number | null;
  /** Effective charge: the stored figure, else the retainer fallback. */
  fixedCost: number;
  /** True when fixedCost came from monthly_rate rather than a stored row. */
  fixedIsDefault: boolean;
  /** fixedCost + tmCost. */
  totalBilling: number;
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
/** Whole dollars, same shape as the amounts on the rest of the Billing tab. */
const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const NO_HOURS: Record<string, number> = {};

interface MonthHours {
  month: string;
  hoursByTicket: Record<string, number>;
  error: string | null;
}

/**
 * One inline-editable fixed-cost cell. Commits on blur or Enter.
 * `fallback` is the retainer shown when nothing is stored yet — it displays as
 * a muted placeholder so a prefilled figure is visibly distinct from one that
 * was actually typed, and typing stores it for real.
 */
function FixedCostCell({ account, month, fallback }: { account: string; month: string; fallback: number }) {
  const stored = useConciergeFixedBillingStore((s) => s.byMonth[month]?.[account]?.amount);
  const setAmount = useConciergeFixedBillingStore((s) => s.setAmount);
  const [draft, setDraft] = useState<string | null>(null);

  const isDefault = stored == null;
  const effective = stored ?? fallback;

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim() === '' ? 0 : Number(draft);
    setDraft(null);
    if (!Number.isFinite(next) || next < 0 || next === effective) return;
    void setAmount(account, month, next);
  };

  return (
    <input
      type="number"
      min="0"
      step="1"
      inputMode="decimal"
      value={draft ?? (effective === 0 ? '' : String(effective))}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
      }}
      title={isDefault && fallback > 0
        ? `Default: this account's ${usd(fallback)} retainer. Type to override for ${monthLabel(month)}.`
        : undefined}
      className={`w-24 px-2 py-1 text-right tabular-nums rounded-md border border-line bg-surface
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50
                 ${isDefault ? 'text-muted italic' : 'text-ink'}`}
      aria-label={`Fixed cost for ${account} in ${monthLabel(month)}`}
    />
  );
}

export function EomHoursReport({ tickets }: Props) {
  const loadTimeEntriesForMonth = useConciergeStore((s) => s.loadTimeEntriesForMonth);
  const conciergeAccounts = useConciergeAccountsStore((s) => s.accounts);
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

  /* Rate + billing model per account, keyed by lower-cased name — the same
   * match the Overview tab uses to spot ticket-only accounts. */
  const accountByName = useMemo(() => {
    const m = new Map<string, { rate: number | null; model: BillingModel | null }>();
    for (const a of conciergeAccounts) {
      m.set(a.name.trim().toLowerCase(), { rate: a.monthlyRate, model: a.billingModel ?? null });
    }
    return m;
  }, [conciergeAccounts]);

  const rows = useMemo<HoursRow[]>(() => {
    const fixedThisMonth = fixedByMonth[month] ?? {};
    const byAccount = new Map<string, HoursRow>();
    const row = (account: string): HoursRow => {
      let r = byAccount.get(account);
      if (!r) {
        const meta = accountByName.get(account.trim().toLowerCase());
        r = {
          account, billed: 0, resolved: 0, estimatedHours: 0,
          hoursInMonth: 0, hoursOnMonthTickets: 0, openTickets: 0,
          billingModel: meta?.model ?? null,
          rate: meta?.rate ?? null,
          tmCost: null, fixedCost: 0, fixedIsDefault: false, totalBilling: 0, carriedIn: 0,
        };
        byAccount.set(account, r);
      }
      return r;
    };
    const accountOf = (t: ConciergeTicket) => t.account?.trim() || UNASSIGNED;

    for (const t of tickets) {
      // An open ticket keeps its account on the report whatever month it bills
      // in — the work is in flight and will be invoiced.
      if (isTicketOpen(t.status)) row(accountOf(t)).openTickets += 1;

      if (billingMonthOf(t) !== month) continue;
      const r = row(accountOf(t));
      r.billed += 1;
      if (monthOf(t.createdTime) !== month) r.carriedIn += 1;
      const est = t.estimatedHours != null && Number.isFinite(t.estimatedHours) ? t.estimatedHours : 0;
      r.estimatedHours += est;
      if (Number.isFinite(t.hoursLogged)) r.hoursOnMonthTickets += t.hoursLogged;
      // "Resolved" is "of the tickets billed this month, how many are done" —
      // the row is an invoice line, and a ticket bills in exactly one month.
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

    // A stored fixed charge stands on its own — an account can be billed in a
    // month with no tickets and no logged hours at all.
    for (const account of Object.keys(fixedThisMonth)) row(account);

    // Every live retainer bills every month, ticket or no ticket. Without this
    // an account like Integrity Together ($2,000/mo) never appeared at all:
    // no ticket has ever carried its name, so nothing else would create a row
    // for it and the retainer went uninvoiced.
    for (const a of conciergeAccounts) {
      if (a.isDormant) continue;
      if (a.billingModel === 'hourly') continue;   // no retainer to charge
      if (!a.monthlyRate) continue;
      row(a.name.trim());
    }

    const out = Array.from(byAccount.values());
    for (const r of out) {
      const hourly = r.billingModel === 'hourly';
      // Only hourly accounts have an hourly rate to multiply by; a retainer ×
      // hours is meaningless, so those show no T&M and bill via Fixed cost.
      r.tmCost = hourly && r.rate && r.estimatedHours > 0 ? r.estimatedHours * r.rate : null;

      const stored = fixedThisMonth[r.account]?.amount;
      // Retainer/annual accounts default to their monthly amount; hourly ones
      // default to nothing, since their charge is the T&M above.
      const fallback = !hourly && r.rate ? r.rate : 0;
      r.fixedIsDefault = stored == null;
      r.fixedCost = stored ?? fallback;
      r.totalBilling = r.fixedCost + (r.tmCost ?? 0);
    }

    return out.sort((a, b) => {
      if (a.account === UNASSIGNED) return 1;
      if (b.account === UNASSIGNED) return -1;
      return a.account.localeCompare(b.account);
    });
  }, [tickets, month, hoursByTicket, accountByName, fixedByMonth, conciergeAccounts]);

  // Money is summed per row, never recomputed from the totals: each account has
  // its own rate and model, so one multiplication across the total would lie.
  const totals = useMemo<HoursRow>(() => rows.reduce<HoursRow>((acc, r) => ({
    account: 'Total',
    billed: acc.billed + r.billed,
    resolved: acc.resolved + r.resolved,
    estimatedHours: acc.estimatedHours + r.estimatedHours,
    hoursInMonth: acc.hoursInMonth + r.hoursInMonth,
    hoursOnMonthTickets: acc.hoursOnMonthTickets + r.hoursOnMonthTickets,
    openTickets: acc.openTickets + r.openTickets,
    billingModel: null,
    rate: null,
    tmCost: (acc.tmCost ?? 0) + (r.tmCost ?? 0),
    fixedCost: acc.fixedCost + r.fixedCost,
    fixedIsDefault: false,
    totalBilling: acc.totalBilling + r.totalBilling,
    carriedIn: acc.carriedIn + r.carriedIn,
  }), {
    account: 'Total', billed: 0, resolved: 0, estimatedHours: 0,
    hoursInMonth: 0, hoursOnMonthTickets: 0, openTickets: 0, billingModel: null, rate: null,
    tmCost: 0, fixedCost: 0, fixedIsDefault: false, totalBilling: 0, carriedIn: 0,
  }), [rows]);

  const columns: CsvColumn<HoursRow>[] = [
    { label: 'Account', value: (r) => r.account },
    { label: 'Billing model', value: (r) => r.billingModel ?? '' },
    { label: 'Rate (USD)', value: (r) => (r.rate == null ? '' : String(r.rate)) },
    { label: 'Open tickets', value: (r) => String(r.openTickets) },
    { label: 'Tickets billed', value: (r) => String(r.billed) },
    { label: 'Of which carried in', value: (r) => String(r.carriedIn) },
    { label: 'Tickets resolved', value: (r) => String(r.resolved) },
    { label: 'Estimated hours', value: (r) => r.estimatedHours.toFixed(2) },
    { label: 'Hours logged in month', value: (r) => r.hoursInMonth.toFixed(2) },
    { label: 'Hours on month tickets (lifetime)', value: (r) => r.hoursOnMonthTickets.toFixed(2) },
    { label: 'T&M cost (USD)', value: (r) => (r.tmCost == null ? '' : r.tmCost.toFixed(2)) },
    { label: 'Fixed cost (USD)', value: (r) => r.fixedCost.toFixed(2) },
    { label: 'Total billing (USD)', value: (r) => r.totalBilling.toFixed(2) },
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
        Every account with something billable appears: an open ticket, a ticket billed in {monthLabel(month)},
        hours logged, or a fixed charge. Tickets count in the month set on the ticket’s{' '}
        <span className="font-medium text-ink/80">Bill in</span> field, falling back to the month they were raised.
        <span className="font-medium text-ink/80"> T&amp;M</span> is est. hours × the hourly rate, for hourly accounts
        only — a retainer account bills through <span className="font-medium text-ink/80">Fixed cost</span>, which is
        prefilled with its retainer (shown greyed) and editable. <span className="font-medium text-ink/80">Total</span>{' '}
        is fixed + T&amp;M. “Hrs in month” is the one column that ignores the billing month: it comes from time entries
        dated inside {monthLabel(month)}. Tickets with no account are grouped as{' '}
        <span className="font-medium text-ink/80">{UNASSIGNED}</span>.
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
        <p className="text-center text-muted py-8">Nothing billable in {monthLabel(month)}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line/60">
                <th className="text-left py-2 pr-3 text-xs font-medium text-muted uppercase">Account</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Open</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Billed</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Resolved</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Est. hrs</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Hrs in month</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted/70 uppercase whitespace-nowrap">Hrs on month tickets</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">T&amp;M cost</th>
                <th className="text-right py-2 px-2 text-xs font-medium text-muted uppercase whitespace-nowrap">Fixed cost</th>
                <th className="text-right py-2 pl-2 text-xs font-semibold text-ink/70 uppercase whitespace-nowrap">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.account} className="border-b border-line/40 last:border-0 hover:bg-surface-2/70">
                  <td className={`py-2 pr-3 font-medium ${r.account === UNASSIGNED ? 'text-muted italic' : 'text-ink'}`}>
                    {r.account}
                    {r.billingModel === 'hourly' && r.rate != null && (
                      <span className="ml-1.5 text-[11px] font-normal text-muted">{usd(r.rate)}/h</span>
                    )}
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums text-ink/80">{r.openTickets || '—'}</td>
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
                  <td
                    className="py-2 px-2 text-right tabular-nums text-ink/80"
                    title={r.tmCost != null ? `${r.estimatedHours.toFixed(2)}h × ${usd(r.rate ?? 0)}/h` : undefined}
                  >
                    {r.tmCost == null ? '—' : usd(r.tmCost)}
                  </td>
                  <td className="py-2 px-2 text-right">
                    {r.account === UNASSIGNED
                      ? <span className="text-muted">—</span>
                      : <FixedCostCell
                          account={r.account}
                          month={month}
                          fallback={r.fixedIsDefault ? r.fixedCost : 0}
                        />}
                  </td>
                  <td className="py-2 pl-2 pr-1 text-right tabular-nums font-semibold text-ink">
                    {r.totalBilling ? usd(r.totalBilling) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-surface-2/70 font-semibold">
                <td className="py-2 pr-3 text-ink">Total</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{totals.openTickets || '—'}</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{totals.billed || '—'}</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{totals.resolved || '—'}</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{h1(totals.estimatedHours)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">{h1(totals.hoursInMonth)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-muted">{h1(totals.hoursOnMonthTickets)}</td>
                <td className="py-2 px-2 text-right tabular-nums text-ink">
                  {totals.tmCost ? usd(totals.tmCost) : '—'}
                </td>
                <td className="py-2 px-2 text-right tabular-nums text-ink pr-2">
                  {totals.fixedCost ? usd(totals.fixedCost) : '—'}
                </td>
                <td className="py-2 pl-2 pr-1 text-right tabular-nums text-ink">
                  {totals.totalBilling ? usd(totals.totalBilling) : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}
