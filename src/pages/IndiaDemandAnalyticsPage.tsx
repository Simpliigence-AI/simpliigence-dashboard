/**
 * India Demand Analytics — the on-demand answer to "what did we raise, what
 * closed, and why didn't the rest?"
 *
 * Read-only. Everything is computed in the browser from data the staffing
 * store already holds (requisitions, statuses, history, accounts), so the page
 * costs no extra queries and stays in step with the India Demand tab.
 *
 * The rules it applies — outcome from status_field not stage, closes credited
 * to the month the status flipped, accounts matched case-insensitively — live
 * in src/lib/indiaDemandAnalytics.ts.
 */
import { useMemo, useState } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell,
} from 'recharts';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard, Select } from '../components/ui';
import { useStaffingStore } from '../store/useStaffingStore';
import { exportRowsToCsv, csvDateStamp } from '../lib/exportCsv';
import {
  buildDemandAnalytics, monthLabel, monthRange, REASON_COLORS,
  type ReqView,
} from '../lib/indiaDemandAnalytics';

const OUTCOME_STYLE: Record<string, string> = {
  won:       'bg-green/12 text-green',
  cancelled: 'bg-rose/12 text-rose',
  lost:      'bg-rose/12 text-rose',
  live:      'bg-brand/12 text-brand',
};

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Every month we have data for, oldest first — drives the range pickers. */
function availableMonths(createdAts: string[]): string[] {
  if (createdAts.length === 0) return [currentMonth()];
  const keys = createdAts.map((c) => c.slice(0, 7)).filter(Boolean).sort();
  return monthRange(keys[0], currentMonth() > keys[keys.length - 1] ? currentMonth() : keys[keys.length - 1]);
}

export default function IndiaDemandAnalyticsPage() {
  const { accounts, requisitions, statuses, history } = useStaffingStore();

  const allMonths = useMemo(
    () => availableMonths(requisitions.map((r) => r.created_at)),
    [requisitions],
  );

  // Default window: the last six months of activity, which is the span a
  // demand conversation actually covers.
  const defaultFrom = allMonths[Math.max(0, allMonths.length - 7)];
  const [from, setFrom] = useState<string>(defaultFrom);
  const [to, setTo] = useState<string>(allMonths[allMonths.length - 1]);
  const [customer, setCustomer] = useState<string>('all');

  const data = useMemo(
    () => buildDemandAnalytics(accounts, requisitions, statuses, history, from, to <= from ? from : to),
    [accounts, requisitions, statuses, history, from, to],
  );

  const monthOptions = useMemo(
    () => allMonths.map((m) => ({ value: m, label: monthLabel(m) })),
    [allMonths],
  );
  const customerOptions = useMemo(
    () => [
      { value: 'all', label: 'All customers' },
      ...data.customers.map((c) => ({ value: c.customer, label: c.customer })),
    ],
    [data.customers],
  );

  const openRows: ReqView[] = useMemo(
    () => data.reqs
      .filter((r) => r.outcome === 'live' || r.outcome === 'lost')
      .filter((r) => customer === 'all' || r.customer === customer)
      .sort((a, b) => a.customer.localeCompare(b.customer) || a.createdMonth.localeCompare(b.createdMonth)),
    [data.reqs, customer],
  );

  const chartData = data.monthRows.map((m) => ({
    month: m.label,
    Raised: m.created,
    Won: m.won,
    Closed: m.cancelled + m.lost,
  }));

  const exportCustomers = () => {
    exportRowsToCsv(
      `india-demand-${from}-to-${to}-${csvDateStamp()}.csv`,
      data.customers,
      [
        { label: 'Customer', value: (c) => c.customer },
        ...data.months.map((m) => ({ label: monthLabel(m), value: (c: typeof data.customers[number]) => String(c.byMonth[m] ?? 0) })),
        { label: 'Reqs raised', value: (c) => String(c.created) },
        { label: 'Positions', value: (c) => String(c.positions) },
        { label: 'Closed Won', value: (c) => String(c.won) },
        { label: 'Cancelled', value: (c) => String(c.cancelled) },
        { label: 'Closed Lost', value: (c) => String(c.lost) },
        { label: 'Still live', value: (c) => String(c.live) },
        { label: 'Win %', value: (c) => `${c.winRate}%` },
      ],
    );
  };

  const exportOpen = () => {
    exportRowsToCsv(
      `india-demand-open-and-lost-${csvDateStamp()}.csv`,
      openRows,
      [
        { label: 'Customer', value: (r) => r.customer },
        { label: 'Role', value: (r) => r.title },
        { label: 'Positions', value: (r) => String(r.positions) },
        { label: 'Raised', value: (r) => monthLabel(r.createdMonth) },
        { label: 'Status', value: (r) => r.status },
        { label: 'Stage', value: (r) => r.stage },
        { label: 'Last update', value: (r) => r.lastNoteDate },
        { label: 'Latest note', value: (r) => r.lastNote },
      ],
    );
  };

  const noReasonPct = data.totals.cancelled + data.totals.lost > 0
    ? Math.round((data.quality.noReason / (data.totals.cancelled + data.totals.lost)) * 100)
    : 0;

  return (
    <div className="w-full">
      <PageHeader
        eyebrow="India T&M"
        tone="teal"
        title="Demand Analytics"
        subtitle="Requisitions raised and closed by customer and month, with the recorded reason for everything that did not close."
        action={
          <div className="flex items-end gap-2">
            <div className="w-32">
              <Select
                label="From"
                value={from}
                options={monthOptions}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="w-32">
              <Select
                label="To"
                value={to}
                options={monthOptions}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
        }
      />

      {/* ── Headline ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <StatCard
          label="Raised"
          value={data.totals.created}
          subtitle={`${data.totals.positions} positions`}
          tone="navy"
        />
        <StatCard
          label="Closed Won"
          value={data.totals.won}
          subtitle={`${data.totals.wonPositions} positions · ${data.totals.winRate}% of reqs`}
          tone="green"
        />
        <StatCard
          label="Cancelled"
          value={data.totals.cancelled}
          subtitle={`${data.totals.cancelledPositions} positions`}
          tone="rose"
        />
        <StatCard
          label="Closed Lost"
          value={data.totals.lost}
          tone="gold"
        />
        <StatCard
          label="Still live"
          value={data.totals.live}
          subtitle={`${data.totals.live - data.totals.onHold} working · ${data.totals.onHold} on hold`}
          tone="blue"
        />
      </div>

      {/* ── Raised vs closed by month ── */}
      <Card
        title="Raised vs. closed, by month"
        className="mb-6"
        action={
          <span className="text-[11px] text-muted">
            Closes are credited to the month the status flipped, not the month the req was raised
          </span>
        }
      >
        {data.totals.created === 0 ? (
          <div className="text-sm text-muted text-center py-10">
            No requisitions raised in this window.
          </div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ fill: '#0f1b2d08' }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Raised" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Won" fill="#16a34a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Closed" name="Cancelled / lost" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* ── By customer ── */}
      <Card
        title={`By customer · ${data.customers.length}`}
        className="mb-6"
        flush
        action={
          <button
            type="button"
            onClick={exportCustomers}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
          >
            <Download size={14} /> CSV
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted border-b border-line/60">
                <th className="py-2.5 pl-6 pr-3 font-semibold">Customer</th>
                {data.months.map((m) => (
                  <th key={m} className="py-2.5 px-2 font-semibold text-right whitespace-nowrap">{monthLabel(m)}</th>
                ))}
                <th className="py-2.5 px-3 font-semibold text-right border-l border-line/60">Reqs</th>
                <th className="py-2.5 px-3 font-semibold text-right">Pos.</th>
                <th className="py-2.5 px-3 font-semibold text-right">Won</th>
                <th className="py-2.5 px-3 font-semibold text-right">Cancelled</th>
                <th className="py-2.5 px-3 font-semibold text-right">Lost</th>
                <th className="py-2.5 px-3 font-semibold text-right">Live</th>
                <th className="py-2.5 pr-6 pl-3 font-semibold text-right">Win %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {data.customers.map((c) => (
                <tr key={c.customer} className="hover:bg-surface-2/60">
                  <td className="py-2 pl-6 pr-3 font-medium text-ink whitespace-nowrap">{c.customer}</td>
                  {data.months.map((m) => (
                    <td key={m} className="py-2 px-2 text-right tabular-nums text-muted">
                      {c.byMonth[m] ? c.byMonth[m] : <span className="opacity-30">·</span>}
                    </td>
                  ))}
                  <td className="py-2 px-3 text-right tabular-nums font-semibold border-l border-line/60">{c.created}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted">{c.positions}</td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-green">{c.won || <span className="opacity-30">·</span>}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-rose">{c.cancelled || <span className="opacity-30">·</span>}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-muted">{c.lost || <span className="opacity-30">·</span>}</td>
                  <td className="py-2 px-3 text-right tabular-nums text-brand">{c.live || <span className="opacity-30">·</span>}</td>
                  <td className="py-2 pr-6 pl-3 text-right tabular-nums font-semibold">{c.winRate}%</td>
                </tr>
              ))}
              {data.customers.length > 0 && (
                <tr className="bg-surface-2/60 font-semibold">
                  <td className="py-2.5 pl-6 pr-3 text-ink">All customers</td>
                  {data.months.map((m) => (
                    <td key={m} className="py-2.5 px-2 text-right tabular-nums">
                      {data.customers.reduce((s, c) => s + (c.byMonth[m] ?? 0), 0)}
                    </td>
                  ))}
                  <td className="py-2.5 px-3 text-right tabular-nums border-l border-line/60">{data.totals.created}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{data.totals.positions}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-green">{data.totals.won}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-rose">{data.totals.cancelled}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums">{data.totals.lost}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-brand">{data.totals.live}</td>
                  <td className="py-2.5 pr-6 pl-3 text-right tabular-nums">{data.totals.winRate}%</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* ── Why they didn't close ── */}
        <Card title={`Why ${data.totals.cancelled + data.totals.lost} requisitions didn't close`}>
          {data.reasons.length === 0 ? (
            <div className="text-sm text-muted text-center py-10">Nothing closed unsuccessfully in this window.</div>
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.reasons.map((r) => ({ ...r, short: r.reason.split(' — ')[0] }))}
                    layout="vertical"
                    margin={{ top: 4, right: 24, bottom: 4, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="short" tick={{ fontSize: 10 }} width={150} />
                    <Tooltip contentStyle={{ fontSize: 12 }} cursor={{ fill: '#0f1b2d08' }} />
                    <Bar dataKey="reqs" name="Requisitions" radius={[0, 4, 4, 0]}>
                      {data.reasons.map((r) => <Cell key={r.reason} fill={REASON_COLORS[r.reason]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted mt-3 leading-relaxed">
                Bucketed from the last status note on each requisition.
                {' '}<strong className="text-ink">{noReasonPct}%</strong> carry no usable closing reason —
                either no note at all, or a note that only reports pipeline activity on the day the req was closed.
              </p>
            </>
          )}
        </Card>

        {/* ── Data quality ── */}
        <Card title="Read this before quoting the numbers">
          <ul className="space-y-3 text-sm text-muted leading-relaxed">
            <li className="flex gap-2.5">
              <AlertTriangle size={15} className="text-gold flex-shrink-0 mt-0.5" />
              <span>
                <strong className="text-ink">Cancelled is being used as a catch-all close.</strong>{' '}
                {data.totals.created > 0 && `${Math.round((data.totals.cancelled / data.totals.created) * 100)}% of requisitions land there. `}
                Until Cancelled and Closed Lost are used distinctly, that rate cannot be read as client behaviour.
              </span>
            </li>
            {data.quality.stageMismatch > 0 && (
              <li className="flex gap-2.5">
                <AlertTriangle size={15} className="text-gold flex-shrink-0 mt-0.5" />
                <span>
                  <strong className="text-ink">{data.quality.stageMismatch} won requisitions never advanced their stage.</strong>{' '}
                  This page reads <code className="text-xs">status_field</code>, never <code className="text-xs">stage</code> — but
                  anything on the India Demand board that filters by stage will miss them.
                </span>
              </li>
            )}
            {data.quality.duplicateAccounts.length > 0 && (
              <li className="flex gap-2.5">
                <AlertTriangle size={15} className="text-gold flex-shrink-0 mt-0.5" />
                <span>
                  <strong className="text-ink">Duplicate accounts:</strong>{' '}
                  {data.quality.duplicateAccounts.join(', ')}. Merged here by name; still split in the demand board.
                </span>
              </li>
            )}
            <li className="flex gap-2.5">
              <AlertTriangle size={15} className="text-gold flex-shrink-0 mt-0.5" />
              <span>
                <strong className="text-ink">No owner on demand rows.</strong> Nothing attributes a requisition to a
                salesperson or recruiter, so this cannot be cut by owner yet.
              </span>
            </li>
          </ul>
        </Card>
      </div>

      {/* ── Still open / lost ── */}
      <Card
        title={`Open and lost · ${openRows.length}`}
        flush
        action={
          <div className="flex items-center gap-3">
            <div className="w-44">
              <Select
                value={customer}
                options={customerOptions}
                onChange={(e) => setCustomer(e.target.value)}
              />
            </div>
            <button
              type="button"
              onClick={exportOpen}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink"
            >
              <Download size={14} /> CSV
            </button>
          </div>
        }
      >
        {openRows.length === 0 ? (
          <div className="text-sm text-muted text-center py-10">Nothing open or lost for this selection.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted border-b border-line/60">
                  <th className="py-2.5 pl-6 pr-3 font-semibold">Customer</th>
                  <th className="py-2.5 px-3 font-semibold">Role</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Pos.</th>
                  <th className="py-2.5 px-3 font-semibold">Raised</th>
                  <th className="py-2.5 px-3 font-semibold">Status</th>
                  <th className="py-2.5 pr-6 pl-3 font-semibold">Latest update</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {openRows.map((r) => (
                  <tr key={r.id} className="hover:bg-surface-2/60 align-top">
                    <td className="py-2 pl-6 pr-3 font-medium text-ink whitespace-nowrap">{r.customer}</td>
                    <td className="py-2 px-3 text-ink/85">{r.title}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted">{r.positions}</td>
                    <td className="py-2 px-3 text-muted whitespace-nowrap">{monthLabel(r.createdMonth)}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold ${OUTCOME_STYLE[r.outcome]}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 pr-6 pl-3 text-muted max-w-md">
                      {r.lastNote
                        ? <>{r.lastNote}{r.lastNoteDate && <span className="text-[11px] opacity-70"> · {r.lastNoteDate}</span>}</>
                        : <span className="opacity-50">No status logged</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
