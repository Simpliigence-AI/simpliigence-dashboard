/**
 * Concierge — 360-degree view of Simpliigence's managed-services accounts.
 *
 * Four tabs:
 *   1. Overview — account cards with health, contract, current work, feature
 *      heat-map, and open-ticket count. Click a card to open the account
 *      drawer with the full feature list + backlog + tech stack + billing.
 *   2. Tickets  — Zoho Desk tickets grouped by account (the previous
 *      Concierge experience, preserved).
 *   3. Backlog  — cross-account view of every "not_implemented" or "planned"
 *      feature, ranked by upsell revenue potential.
 *   4. Billing  — monthly billing history per account with sparkline trend.
 */
import { useState, useMemo } from 'react';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, JSX } from 'react';
import { useConciergeStore } from '../store/useConciergeStore';
import type { ConciergeTicket } from '../store/useConciergeStore';
import { useConciergeAccountsStore } from '../store/useConciergeAccountsStore';
import type {
  ConciergeAccount,
  ConciergeFeature,
  ConciergeBillingEntry,
  BillingModel,
  AccountHealth,
  FeatureStatus,
  FeaturePriority,
} from '../types/concierge';
import {
  BILLING_MODEL_META,
  HEALTH_META,
  FEATURE_STATUS_META,
  FEATURE_PRIORITY_META,
  STANDARD_FEATURE_CATALOG,
} from '../types/concierge';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, StatCard, Badge, Button, EmptyState, Drawer } from '../components/ui';

/* Native form controls — the shared Input/Select/Textarea wrappers add labels
 * and margins that break the tight inline rows we use in the account drawer. */
type BaseInputProps = InputHTMLAttributes<HTMLInputElement>;
type BaseSelectProps = SelectHTMLAttributes<HTMLSelectElement>;
type BaseTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
const INPUT_CLS = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary';
const Input = ({ className = '', ...p }: BaseInputProps) => <input className={`${INPUT_CLS} ${className}`} {...p} />;
const Select = ({ className = '', children, ...p }: BaseSelectProps) => (
  <select className={`${INPUT_CLS} bg-white ${className}`} {...p}>{children}</select>
);
const Textarea = ({ className = '', ...p }: BaseTextareaProps) => <textarea className={`${INPUT_CLS} ${className}`} {...p} />;
import {
  Search,
  ChevronDown,
  ChevronRight,
  Headset,
  AlertTriangle,
  Clock,
  ExternalLink,
  DollarSign,
  TrendingUp,
  Sparkles,
  Plus,
  X,
  LayoutGrid,
  Ticket,
  Package,
  Receipt,
  Building2,
  Cpu,
  Trash2,
} from 'lucide-react';

/* ── Helpers ───────────────────────────────────── */

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date();
}
function ticketStatusVariant(status: string): 'danger' | 'warning' {
  return status === 'Open' ? 'danger' : 'warning';
}
function priorityVariant(priority: string | null): 'danger' | 'warning' | 'neutral' {
  if (priority === 'High') return 'danger';
  if (priority === 'Medium') return 'warning';
  return 'neutral';
}
function fmtUSD(n: number | null | undefined, opts?: { compact?: boolean }): string {
  if (n == null) return '—';
  if (opts?.compact && Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  }
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}
function monthLabel(m: string): string {
  const [y, mo] = m.split('-');
  const d = new Date(Number(y), Number(mo) - 1, 1);
  return d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
}
function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type Tab = 'overview' | 'tickets' | 'backlog' | 'billing';

/* ── Ticket group card (preserved from old page) ── */

interface ClientGroup {
  account: string;
  tickets: ConciergeTicket[];
  openCount: number;
  onHoldCount: number;
}

function ClientGroupCard({ group }: { group: ClientGroup }) {
  const [expanded, setExpanded] = useState(group.openCount > 0);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
          <h3 className="text-sm font-semibold text-slate-800">{group.account}</h3>
          <Badge variant="neutral">{group.tickets.length} ticket{group.tickets.length !== 1 ? 's' : ''}</Badge>
        </div>
        <div className="flex items-center gap-2">
          {group.openCount > 0 && <Badge variant="danger">{group.openCount} Open</Badge>}
          {group.onHoldCount > 0 && <Badge variant="warning">{group.onHoldCount} On Hold</Badge>}
        </div>
      </button>
      {expanded && (
        <div className="px-6 pb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500 uppercase">#</th>
                <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500 uppercase">Subject</th>
                <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500 uppercase">Status</th>
                <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500 uppercase">Priority</th>
                <th className="text-left py-2 pr-4 text-xs font-medium text-slate-500 uppercase">Created</th>
                <th className="text-left py-2 text-xs font-medium text-slate-500 uppercase">Due</th>
              </tr>
            </thead>
            <tbody>
              {group.tickets.map((t) => (
                <tr key={t.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2.5 pr-4 text-slate-500 font-mono text-xs">{t.ticketNumber}</td>
                  <td className="py-2.5 pr-4 max-w-xs">
                    <a href={t.webUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                      <span className="truncate">{t.subject}</span>
                      <ExternalLink size={12} className="flex-shrink-0 opacity-60" />
                    </a>
                  </td>
                  <td className="py-2.5 pr-4"><Badge variant={ticketStatusVariant(t.status)}>{t.status}</Badge></td>
                  <td className="py-2.5 pr-4"><Badge variant={priorityVariant(t.priority)}>{t.priority ?? 'None'}</Badge></td>
                  <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap">{fmtDate(t.createdTime)}</td>
                  <td className={`py-2.5 whitespace-nowrap ${isOverdue(t.dueDate) ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
                    {fmtDate(t.dueDate)}{isOverdue(t.dueDate) && <span className="ml-1 text-xs">(overdue)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Account card (Overview tab) ────────────────── */

interface AccountCardProps {
  account: ConciergeAccount;
  features: ConciergeFeature[];
  openTickets: number;
  monthAmount: number;
  onOpen: () => void;
}

function AccountCard({ account, features, openTickets, monthAmount, onOpen }: AccountCardProps) {
  const total = features.length;
  const implemented = features.filter((f) => f.status === 'implemented').length;
  const inProgress = features.filter((f) => f.status === 'in_progress').length;
  const planned = features.filter((f) => f.status === 'planned').length;
  const notImpl = features.filter((f) => f.status === 'not_implemented').length;
  const coverage = total > 0 ? Math.round((implemented / total) * 100) : 0;
  const health = HEALTH_META[account.health];
  const billing = BILLING_MODEL_META[account.billingModel];
  const upsellPotential = features
    .filter((f) => f.status !== 'implemented')
    .reduce((sum, f) => sum + (f.upsellEstimate ?? 0), 0);
  const dormant = account.isDormant;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`text-left rounded-xl shadow-sm hover:shadow-md transition-all p-5 flex flex-col gap-4 ${
        dormant
          ? 'bg-rose-50 border-2 border-rose-300 hover:border-rose-500 ring-1 ring-rose-200'
          : `bg-white border border-slate-200 hover:border-primary/40 ring-1 ${health.ring}`
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={16} className="text-slate-400 flex-shrink-0" />
            <h3 className="text-base font-semibold text-slate-900 truncate">{account.name}</h3>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="neutral" className={billing.cls}>{billing.label}</Badge>
            {dormant ? (
              <Badge variant="danger" className="bg-rose-200 text-rose-900">Dormant — Re-engage</Badge>
            ) : (
              <Badge variant="neutral" className={health.cls}>{health.label}</Badge>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Monthly</div>
          <div className="text-sm font-semibold text-slate-900">{fmtUSD(account.monthlyRate, { compact: true })}</div>
        </div>
      </div>

      {/* Feature heat bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-slate-500">Feature coverage</span>
          <span className="text-xs font-medium text-slate-700">{coverage}% ({implemented}/{total})</span>
        </div>
        <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
          {total > 0 ? (
            <>
              {implemented > 0 && <div className="bg-emerald-500" style={{ width: `${(implemented / total) * 100}%` }} />}
              {inProgress > 0 && <div className="bg-sky-400" style={{ width: `${(inProgress / total) * 100}%` }} />}
              {planned > 0 && <div className="bg-amber-400" style={{ width: `${(planned / total) * 100}%` }} />}
              {notImpl > 0 && <div className="bg-slate-200" style={{ width: `${(notImpl / total) * 100}%` }} />}
            </>
          ) : (
            <div className="w-full bg-slate-100" />
          )}
        </div>
      </div>

      {/* Tech stack chips (max 4) */}
      {account.techStack.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {account.techStack.slice(0, 4).map((t) => (
            <span key={t} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-600">
              <Cpu size={10} />
              {t}
            </span>
          ))}
          {account.techStack.length > 4 && (
            <span className="px-1.5 py-0.5 text-[11px] text-slate-500">+{account.techStack.length - 4}</span>
          )}
        </div>
      )}

      {/* Footer stats */}
      <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Tickets</div>
          <div className="text-sm font-semibold text-slate-900">{openTickets}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">This month</div>
          <div className="text-sm font-semibold text-slate-900">{fmtUSD(monthAmount, { compact: true })}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Upsell</div>
          <div className="text-sm font-semibold text-emerald-600">{fmtUSD(upsellPotential, { compact: true })}</div>
        </div>
      </div>
    </button>
  );
}

/* ── Account drawer (edit + features + billing) ── */

function AccountDrawer({
  account,
  features,
  billing,
  tickets,
  onClose,
}: {
  account: ConciergeAccount;
  features: ConciergeFeature[];
  billing: ConciergeBillingEntry[];
  tickets: ConciergeTicket[];
  onClose: () => void;
}) {
  const store = useConciergeAccountsStore();
  const [newFeatureName, setNewFeatureName] = useState('');
  const [newFeatureCategory, setNewFeatureCategory] = useState('Sales Cloud');
  const [newTech, setNewTech] = useState('');
  const [showBillingForm, setShowBillingForm] = useState(false);
  const [billingMonth, setBillingMonth] = useState(currentMonth());
  const [billingAmount, setBillingAmount] = useState('');
  const [billingHours, setBillingHours] = useState('');

  const addFeatureFromCatalog = async (catalog: { name: string; category: string }) => {
    if (features.some((f) => f.name.toLowerCase() === catalog.name.toLowerCase())) return;
    await store.addFeature({ accountId: account.id, name: catalog.name, category: catalog.category });
  };

  const submitNewFeature = async () => {
    if (!newFeatureName.trim()) return;
    await store.addFeature({ accountId: account.id, name: newFeatureName, category: newFeatureCategory });
    setNewFeatureName('');
  };

  const addTech = async () => {
    const t = newTech.trim();
    if (!t) return;
    if (account.techStack.includes(t)) return;
    await store.updateAccount(account.id, { techStack: [...account.techStack, t] });
    setNewTech('');
  };

  const removeTech = async (t: string) => {
    await store.updateAccount(account.id, { techStack: account.techStack.filter((x) => x !== t) });
  };

  const submitBilling = async () => {
    const amount = Number(billingAmount);
    if (!Number.isFinite(amount) || amount < 0) return;
    await store.addBilling({
      accountId: account.id,
      month: billingMonth,
      amount,
      hours: Number(billingHours) || 0,
    });
    setBillingAmount('');
    setBillingHours('');
    setShowBillingForm(false);
  };

  const sortedBilling = [...billing].sort((a, b) => b.month.localeCompare(a.month));
  const sortedFeatures = [...features].sort((a, b) =>
    FEATURE_STATUS_META[a.status].label.localeCompare(FEATURE_STATUS_META[b.status].label) ||
    FEATURE_PRIORITY_META[a.priority].rank - FEATURE_PRIORITY_META[b.priority].rank,
  );

  return (
    <Drawer open={true} onClose={onClose} title={account.name} width="max-w-3xl">
      <div className="space-y-6">
        {/* Dormant flag */}
        <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer ${
          account.isDormant ? 'bg-rose-50 border-rose-300' : 'bg-slate-50 border-slate-200'
        }`}>
          <input
            type="checkbox"
            checked={account.isDormant}
            onChange={(e) => store.updateAccount(account.id, { isDormant: e.target.checked })}
            className="w-4 h-4 accent-rose-600"
          />
          <div className="flex-1">
            <div className={`text-sm font-semibold ${account.isDormant ? 'text-rose-800' : 'text-slate-700'}`}>
              {account.isDormant ? 'Dormant — needs re-engagement' : 'Mark as dormant'}
            </div>
            <div className="text-xs text-slate-600">
              Dormant accounts render red on the Overview tab; use them as a re-engagement target list to reactivate concierge relationships.
            </div>
          </div>
        </label>

        {/* Contract + status */}
        <section className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Billing Model</label>
            <Select
              value={account.billingModel}
              onChange={(e) => store.updateAccount(account.id, { billingModel: e.target.value as BillingModel })}
              className="mt-1 w-full"
            >
              {Object.entries(BILLING_MODEL_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Health</label>
            <Select
              value={account.health}
              onChange={(e) => store.updateAccount(account.id, { health: e.target.value as AccountHealth })}
              className="mt-1 w-full"
            >
              {Object.entries(HEALTH_META).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Monthly Rate (USD)</label>
            <Input
              type="number"
              value={account.monthlyRate ?? ''}
              onChange={(e) => store.updateAccount(account.id, { monthlyRate: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="e.g. 5000"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Owner Email</label>
            <Input
              type="email"
              value={account.ownerEmail ?? ''}
              onChange={(e) => store.updateAccount(account.id, { ownerEmail: e.target.value || null })}
              placeholder="owner@simpliigence.com"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Contract Start</label>
            <Input
              type="date"
              value={account.contractStart ?? ''}
              onChange={(e) => store.updateAccount(account.id, { contractStart: e.target.value || null })}
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Contract End</label>
            <Input
              type="date"
              value={account.contractEnd ?? ''}
              onChange={(e) => store.updateAccount(account.id, { contractEnd: e.target.value || null })}
              className="mt-1"
            />
          </div>
        </section>

        {/* Work summary */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Current Work</label>
            <Textarea
              rows={3}
              value={account.currentWork ?? ''}
              onChange={(e) => store.updateAccount(account.id, { currentWork: e.target.value || null })}
              placeholder="What we're doing this month…"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Previous Work</label>
            <Textarea
              rows={3}
              value={account.previousWork ?? ''}
              onChange={(e) => store.updateAccount(account.id, { previousWork: e.target.value || null })}
              placeholder="What we delivered before…"
              className="mt-1"
            />
          </div>
        </section>

        {/* Tech stack */}
        <section>
          <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
            <Cpu size={16} /> Tech Stack
          </h3>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {account.techStack.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 text-xs text-slate-700">
                {t}
                <button type="button" onClick={() => removeTech(t)} className="hover:text-rose-600">
                  <X size={12} />
                </button>
              </span>
            ))}
            {account.techStack.length === 0 && (
              <span className="text-xs text-slate-400">None recorded yet.</span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              value={newTech}
              onChange={(e) => setNewTech(e.target.value)}
              placeholder="Add tech (e.g. Salesforce Sales Cloud, MuleSoft, Zoho…)"
              onKeyDown={(e) => e.key === 'Enter' && addTech()}
              className="flex-1"
            />
            <Button variant="secondary" onClick={addTech}><Plus size={14} /> Add</Button>
          </div>
        </section>

        {/* Features / heat map / backlog */}
        <section>
          <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
            <Sparkles size={16} /> Functionality Heat Map ({features.length})
          </h3>
          <div className="space-y-2 mb-3">
            {sortedFeatures.map((f) => (
              <FeatureRow key={f.id} feature={f} />
            ))}
            {features.length === 0 && (
              <p className="text-sm text-slate-500 italic">No features tracked. Add from catalog below or free-form.</p>
            )}
          </div>

          {/* Add feature */}
          <div className="bg-slate-50 rounded-lg p-3 space-y-2">
            <div className="flex gap-2">
              <Input
                value={newFeatureName}
                onChange={(e) => setNewFeatureName(e.target.value)}
                placeholder="Add custom feature/functionality"
                onKeyDown={(e) => e.key === 'Enter' && submitNewFeature()}
                className="flex-1"
              />
              <Input
                value={newFeatureCategory}
                onChange={(e) => setNewFeatureCategory(e.target.value)}
                placeholder="Category"
                className="w-40"
              />
              <Button variant="secondary" onClick={submitNewFeature}><Plus size={14} /> Add</Button>
            </div>

            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">Or add from catalog:</div>
              <div className="flex flex-wrap gap-1">
                {STANDARD_FEATURE_CATALOG.filter((c) => !features.some((f) => f.name === c.name)).map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    onClick={() => addFeatureFromCatalog(c)}
                    className="text-[11px] px-2 py-1 rounded border border-slate-200 bg-white hover:bg-primary/5 hover:border-primary/40 text-slate-700"
                  >
                    + {c.name}
                  </button>
                ))}
                {STANDARD_FEATURE_CATALOG.every((c) => features.some((f) => f.name === c.name)) && (
                  <span className="text-xs text-slate-400 italic">All catalog items added.</span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Tickets for this account */}
        {tickets.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
              <Ticket size={16} /> Open Tickets ({tickets.length})
            </h3>
            <div className="space-y-1">
              {tickets.map((t) => (
                <a
                  key={t.id}
                  href={t.webUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block px-3 py-2 rounded-md border border-slate-200 hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-slate-500">#{t.ticketNumber}</span>
                    <span className="flex-1 truncate text-slate-800">{t.subject}</span>
                    <Badge variant={ticketStatusVariant(t.status)}>{t.status}</Badge>
                    <ExternalLink size={12} className="opacity-60" />
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Billing history */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <Receipt size={16} /> Billing History ({billing.length})
            </h3>
            <Button variant="secondary" onClick={() => setShowBillingForm(!showBillingForm)}>
              <Plus size={14} /> Add month
            </Button>
          </div>
          {showBillingForm && (
            <div className="bg-slate-50 rounded-lg p-3 mb-2 grid grid-cols-4 gap-2">
              <Input type="month" value={billingMonth} onChange={(e) => setBillingMonth(e.target.value)} />
              <Input type="number" value={billingAmount} onChange={(e) => setBillingAmount(e.target.value)} placeholder="Amount ($)" />
              <Input type="number" value={billingHours} onChange={(e) => setBillingHours(e.target.value)} placeholder="Hours" />
              <Button onClick={submitBilling}>Save</Button>
            </div>
          )}
          {sortedBilling.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 text-xs font-medium text-slate-500 uppercase">Month</th>
                  <th className="text-right py-2 text-xs font-medium text-slate-500 uppercase">Amount</th>
                  <th className="text-right py-2 text-xs font-medium text-slate-500 uppercase">Hours</th>
                  <th className="text-right py-2 text-xs font-medium text-slate-500 uppercase">$/hr</th>
                  <th className="py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {sortedBilling.map((b) => (
                  <tr key={b.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 text-slate-800">{monthLabel(b.month)}</td>
                    <td className="py-2 text-right font-medium text-slate-900">{fmtUSD(b.amount)}</td>
                    <td className="py-2 text-right text-slate-600">{b.hours.toFixed(1)}</td>
                    <td className="py-2 text-right text-slate-500">{b.hours > 0 ? fmtUSD(b.amount / b.hours) : '—'}</td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => store.removeBilling(b.id)} className="text-slate-400 hover:text-rose-600">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-500 italic">No billing entries yet.</p>
          )}
        </section>

        {/* Danger zone */}
        <section className="pt-4 border-t border-slate-100">
          <Button
            variant="secondary"
            onClick={() => {
              if (confirm(`Delete concierge account "${account.name}"? This removes all its features and billing history.`)) {
                store.removeAccount(account.id);
                onClose();
              }
            }}
            className="text-rose-600 hover:bg-rose-50 border-rose-200"
          >
            <Trash2 size={14} /> Delete account
          </Button>
        </section>
      </div>
    </Drawer>
  );
}

function FeatureRow({ feature }: { feature: ConciergeFeature }) {
  const store = useConciergeAccountsStore();
  const meta = FEATURE_STATUS_META[feature.status];
  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg border border-slate-100 hover:border-slate-200 bg-white">
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${meta.heat}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-slate-800 truncate">{feature.name}</span>
          {feature.category && <span className="text-xs text-slate-400">· {feature.category}</span>}
        </div>
      </div>
      <Select
        value={feature.status}
        onChange={(e) => store.setFeatureStatus(feature.id, e.target.value as FeatureStatus)}
        className="text-xs h-8"
      >
        {Object.entries(FEATURE_STATUS_META).map(([k, v]) => (
          <option key={k} value={k}>{v.label}</option>
        ))}
      </Select>
      <Select
        value={feature.priority}
        onChange={(e) => store.updateFeature(feature.id, { priority: e.target.value as FeaturePriority })}
        className="text-xs h-8 w-24"
      >
        {Object.entries(FEATURE_PRIORITY_META).map(([k, v]) => (
          <option key={k} value={k}>{v.label}</option>
        ))}
      </Select>
      <Input
        type="number"
        value={feature.upsellEstimate ?? ''}
        onChange={(e) => store.updateFeature(feature.id, { upsellEstimate: e.target.value === '' ? null : Number(e.target.value) })}
        placeholder="$ upsell"
        className="w-24 h-8 text-xs"
      />
      <button type="button" onClick={() => store.removeFeature(feature.id)} className="text-slate-400 hover:text-rose-600">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/* ── New account dialog ─────────────────────────── */

function NewAccountForm({ onClose, defaultName }: { onClose: () => void; defaultName?: string }) {
  const store = useConciergeAccountsStore();
  const [name, setName] = useState(defaultName ?? '');
  const [billingModel, setBillingModel] = useState<BillingModel>('monthly_retainer');
  const [monthlyRate, setMonthlyRate] = useState('');
  const [isDormant, setIsDormant] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    await store.addAccount({
      name,
      billingModel,
      monthlyRate: monthlyRate ? Number(monthlyRate) : null,
      isDormant,
    });
    onClose();
  };

  return (
    <Drawer open={true} onClose={onClose} title="New Concierge Account" width="max-w-md">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Account name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Whitmore Inc." autoFocus className="mt-1" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Billing model</label>
          <Select value={billingModel} onChange={(e) => setBillingModel(e.target.value as BillingModel)} className="mt-1 w-full">
            {Object.entries(BILLING_MODEL_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Monthly rate (USD)</label>
          <Input type="number" value={monthlyRate} onChange={(e) => setMonthlyRate(e.target.value)} placeholder="e.g. 5000" className="mt-1" />
        </div>
        <label className="flex items-center gap-2 p-3 rounded-lg border border-rose-200 bg-rose-50 cursor-pointer">
          <input
            type="checkbox"
            checked={isDormant}
            onChange={(e) => setIsDormant(e.target.checked)}
            className="w-4 h-4 accent-rose-600"
          />
          <div>
            <div className="text-sm font-medium text-rose-800">Mark as dormant</div>
            <div className="text-xs text-rose-600">Card shows red — target for re-engagement to reactivate concierge.</div>
          </div>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Create account</Button>
        </div>
      </div>
    </Drawer>
  );
}

/* ── Main page ──────────────────────────────────── */

export default function ConciergePage() {
  const { tickets, lastSynced } = useConciergeStore();
  const { accounts, features, billing } = useConciergeAccountsStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [seedName, setSeedName] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');

  const ticketsByAccount = useMemo(() => {
    const m = new Map<string, ConciergeTicket[]>();
    for (const t of tickets) {
      const list = m.get(t.account) ?? [];
      list.push(t);
      m.set(t.account, list);
    }
    return m;
  }, [tickets]);

  const featuresByAccount = useMemo(() => {
    const m = new Map<string, ConciergeFeature[]>();
    for (const f of features) {
      const list = m.get(f.accountId) ?? [];
      list.push(f);
      m.set(f.accountId, list);
    }
    return m;
  }, [features]);

  const billingByAccount = useMemo(() => {
    const m = new Map<string, ConciergeBillingEntry[]>();
    for (const b of billing) {
      const list = m.get(b.accountId) ?? [];
      list.push(b);
      m.set(b.accountId, list);
    }
    return m;
  }, [billing]);

  const nowMonth = currentMonth();

  const stats = useMemo(() => {
    const activeAccounts = accounts.filter((a) => !a.isDormant);
    const mrr = activeAccounts
      .filter((a) => a.billingModel !== 'hourly')
      .reduce((sum, a) => sum + (a.monthlyRate ?? 0), 0);
    const openTickets = tickets.filter((t) => t.status === 'Open').length;
    const upsellPipeline = features
      .filter((f) => f.status !== 'implemented')
      .reduce((sum, f) => sum + (f.upsellEstimate ?? 0), 0);
    const atRisk = activeAccounts.filter((a) => a.health !== 'green').length;
    const dormantCount = accounts.filter((a) => a.isDormant).length;
    return { mrr, openTickets, upsellPipeline, atRisk, dormantCount, accountCount: accounts.length };
  }, [accounts, tickets, features]);

  /* Overview: matching ticket-only accounts that don't yet have a concierge_account record */
  const unmanagedAccountNames = useMemo(() => {
    const managed = new Set(accounts.map((a) => a.name.toLowerCase().trim()));
    const seen = new Set<string>();
    for (const t of tickets) {
      const name = t.account.trim();
      if (name && !managed.has(name.toLowerCase()) && !seen.has(name)) {
        seen.add(name);
      }
    }
    return Array.from(seen).sort();
  }, [accounts, tickets]);

  const filteredAccounts = useMemo(() => {
    const base = search.trim()
      ? accounts.filter((a) => {
          const q = search.toLowerCase();
          return (
            a.name.toLowerCase().includes(q) ||
            a.techStack.some((t) => t.toLowerCase().includes(q)) ||
            (a.currentWork ?? '').toLowerCase().includes(q)
          );
        })
      : accounts;
    // Dormant accounts float to the top so re-engagement targets are visible first.
    return [...base].sort((a, b) => Number(b.isDormant) - Number(a.isDormant) || a.name.localeCompare(b.name));
  }, [accounts, search]);

  const openAccount = openAccountId ? accounts.find((a) => a.id === openAccountId) : null;

  /* Tickets tab — preserved */
  const clientGroups = useMemo<ClientGroup[]>(() => {
    return Array.from(ticketsByAccount.entries())
      .map(([account, ts]) => ({
        account,
        tickets: ts,
        openCount: ts.filter((t) => t.status === 'Open').length,
        onHoldCount: ts.filter((t) => t.status === 'On Hold').length,
      }))
      .sort((a, b) => b.tickets.length - a.tickets.length);
  }, [ticketsByAccount]);

  /* Backlog tab: all not-implemented / planned features ranked by upsell */
  const backlog = useMemo(() => {
    return features
      .filter((f) => f.status === 'not_implemented' || f.status === 'planned')
      .map((f) => {
        const acct = accounts.find((a) => a.id === f.accountId);
        return { feature: f, account: acct };
      })
      .filter((row) => row.account)
      .sort((a, b) => (b.feature.upsellEstimate ?? 0) - (a.feature.upsellEstimate ?? 0));
  }, [features, accounts]);

  /* Billing tab: monthly totals per account across last 12 months */
  const billingMatrix = useMemo(() => {
    const months: string[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const rows = accounts.map((a) => {
      const byMonth = new Map((billingByAccount.get(a.id) ?? []).map((b) => [b.month, b]));
      const cells = months.map((m) => byMonth.get(m)?.amount ?? 0);
      const total = cells.reduce((s, v) => s + v, 0);
      const max = Math.max(...cells, 1);
      return { account: a, cells, total, max };
    });
    return { months, rows };
  }, [accounts, billingByAccount]);

  return (
    <div>
      <PageHeader
        title="Concierge"
        subtitle="360° view of managed-services accounts — contracts, functionality, tickets, billing"
        action={
          <div className="flex items-center gap-3">
            {lastSynced && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <Clock size={14} />
                Tickets synced {new Date(lastSynced).toLocaleDateString()}
              </div>
            )}
            <Button onClick={() => { setSeedName(undefined); setShowNewAccount(true); }}>
              <Plus size={14} /> New account
            </Button>
          </div>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <StatCard label="Accounts" value={stats.accountCount} icon={<Building2 size={20} />} />
        <StatCard label="MRR" value={fmtUSD(stats.mrr, { compact: true })} subtitle="Active retainers" icon={<DollarSign size={20} />} />
        <StatCard label="Open Tickets" value={stats.openTickets} icon={<Headset size={20} />} />
        <StatCard label="Upsell Pipeline" value={fmtUSD(stats.upsellPipeline, { compact: true })} subtitle="From backlog" icon={<TrendingUp size={20} />} />
        <StatCard label="At Risk" value={stats.atRisk} subtitle={stats.atRisk > 0 ? 'Need attention' : 'All healthy'} icon={<AlertTriangle size={20} />} />
        <StatCard label="Dormant" value={stats.dormantCount} subtitle={stats.dormantCount > 0 ? 'Re-engage' : 'None'} icon={<AlertTriangle size={20} />} />
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 bg-white border border-slate-200 rounded-lg p-1 mb-6 w-fit">
        {([
          { key: 'overview', label: 'Overview', icon: <LayoutGrid size={14} /> },
          { key: 'tickets',  label: 'Tickets',  icon: <Ticket size={14} /> },
          { key: 'backlog',  label: 'Backlog',  icon: <Package size={14} /> },
          { key: 'billing',  label: 'Billing',  icon: <Receipt size={14} /> },
        ] as Array<{ key: Tab; label: string; icon: JSX.Element }>).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1.5 ${
              tab === t.key ? 'bg-primary text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ─────────────────────────── */}
      {tab === 'overview' && (
        <>
          <div className="mb-4 max-w-sm relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search accounts, tech, work…" className="pl-9" />
          </div>

          {accounts.length === 0 ? (
            <EmptyState
              icon={<Building2 size={32} />}
              title="No concierge accounts yet"
              description="Create your first managed-services account, or import from your existing ticket clients below."
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredAccounts.map((a) => {
                const acctTickets = (ticketsByAccount.get(a.name) ?? []).filter((t) => t.status === 'Open');
                const monthEntry = (billingByAccount.get(a.id) ?? []).find((b) => b.month === nowMonth);
                return (
                  <AccountCard
                    key={a.id}
                    account={a}
                    features={featuresByAccount.get(a.id) ?? []}
                    openTickets={acctTickets.length}
                    monthAmount={monthEntry?.amount ?? 0}
                    onOpen={() => setOpenAccountId(a.id)}
                  />
                );
              })}
            </div>
          )}

          {/* Unmanaged (ticket-only) accounts */}
          {unmanagedAccountNames.length > 0 && (
            <Card title="Ticket clients not yet in Concierge" className="mt-6">
              <p className="text-sm text-slate-500 mb-3">
                These clients have open Zoho Desk tickets but no Concierge account record. Add them to track billing, features, and upsell.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {unmanagedAccountNames.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => { setSeedName(n); setShowNewAccount(true); }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-primary/5 hover:border-primary/40 text-sm text-slate-700"
                  >
                    <Plus size={12} /> {n}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── TICKETS ──────────────────────────── */}
      {tab === 'tickets' && (
        <>
          {clientGroups.length === 0 ? (
            <EmptyState icon={<Ticket size={32} />} title="No tickets" description="Zoho Desk tickets will appear here once synced." />
          ) : (
            <div className="space-y-4">
              {clientGroups.map((g) => <ClientGroupCard key={g.account} group={g} />)}
            </div>
          )}
        </>
      )}

      {/* ── BACKLOG ──────────────────────────── */}
      {tab === 'backlog' && (
        <Card title={`Upsell Backlog (${backlog.length})`} action={
          <div className="text-sm text-slate-500">
            Est. pipeline: <span className="font-semibold text-emerald-600">{fmtUSD(stats.upsellPipeline)}</span>
          </div>
        }>
          {backlog.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No open backlog items. Add "planned" or "not implemented" features to an account to build your upsell pipeline.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 text-xs font-medium text-slate-500 uppercase">Account</th>
                  <th className="text-left py-2 text-xs font-medium text-slate-500 uppercase">Feature</th>
                  <th className="text-left py-2 text-xs font-medium text-slate-500 uppercase">Category</th>
                  <th className="text-left py-2 text-xs font-medium text-slate-500 uppercase">Status</th>
                  <th className="text-left py-2 text-xs font-medium text-slate-500 uppercase">Priority</th>
                  <th className="text-right py-2 text-xs font-medium text-slate-500 uppercase">Est. Upsell</th>
                </tr>
              </thead>
              <tbody>
                {backlog.map(({ feature, account }) => (
                  <tr
                    key={feature.id}
                    onClick={() => account && setOpenAccountId(account!.id)}
                    className="border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50"
                  >
                    <td className="py-2 text-slate-800 font-medium">{account?.name}</td>
                    <td className="py-2 text-slate-700">{feature.name}</td>
                    <td className="py-2 text-slate-500">{feature.category || '—'}</td>
                    <td className="py-2"><Badge className={FEATURE_STATUS_META[feature.status].cls}>{FEATURE_STATUS_META[feature.status].label}</Badge></td>
                    <td className="py-2"><Badge className={FEATURE_PRIORITY_META[feature.priority].cls}>{FEATURE_PRIORITY_META[feature.priority].label}</Badge></td>
                    <td className="py-2 text-right font-semibold text-emerald-600">{fmtUSD(feature.upsellEstimate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* ── BILLING ──────────────────────────── */}
      {tab === 'billing' && (
        <Card title="Monthly Billing (last 12 months)">
          {accounts.length === 0 ? (
            <p className="text-center text-slate-500 py-8">Add concierge accounts to see billing history.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 pr-3 text-xs font-medium text-slate-500 uppercase sticky left-0 bg-white">Account</th>
                    {billingMatrix.months.map((m) => (
                      <th key={m} className="text-right py-2 px-2 text-xs font-medium text-slate-500 uppercase whitespace-nowrap">{monthLabel(m)}</th>
                    ))}
                    <th className="text-right py-2 pl-3 text-xs font-medium text-slate-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {billingMatrix.rows.map(({ account, cells, total, max }) => (
                    <tr
                      key={account.id}
                      onClick={() => setOpenAccountId(account.id)}
                      className="border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50"
                    >
                      <td className="py-2 pr-3 text-slate-800 font-medium sticky left-0 bg-white">{account.name}</td>
                      {cells.map((v, i) => (
                        <td key={i} className="py-2 px-2 text-right relative">
                          {v > 0 && (
                            <div className="absolute inset-1 rounded" style={{ background: `rgba(16, 185, 129, ${0.08 + 0.35 * (v / max)})` }} />
                          )}
                          <span className="relative text-slate-700">{v > 0 ? fmtUSD(v, { compact: true }) : '—'}</span>
                        </td>
                      ))}
                      <td className="py-2 pl-3 text-right font-semibold text-slate-900">{fmtUSD(total, { compact: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Drawers */}
      {openAccount && (
        <AccountDrawer
          account={openAccount}
          features={featuresByAccount.get(openAccount.id) ?? []}
          billing={billingByAccount.get(openAccount.id) ?? []}
          tickets={ticketsByAccount.get(openAccount.name) ?? []}
          onClose={() => setOpenAccountId(null)}
        />
      )}
      {showNewAccount && (
        <NewAccountForm onClose={() => setShowNewAccount(false)} defaultName={seedName} />
      )}
    </div>
  );
}
