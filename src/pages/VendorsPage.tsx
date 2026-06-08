/**
 * Vendors — companies who supply candidates.
 *
 * List view: company, SPOC name, SPOC email, skills (multi-select chips),
 * # outreaches and last contacted date. Filter by skill + active.
 *
 * Inline add form at the top (always-visible toggle). Inline edit on every
 * field on each row. Skills picker shows the canonical preset list and lets
 * the user add free-text custom skills.
 *
 * Persists via useVendorStore which fires Supabase writes; realtime keeps
 * other tabs/browsers fresh.
 */
import { useMemo, useState } from 'react';
import { Plus, Trash2, Save, X, Building2, Mail, Send, Activity, Check, AlertCircle, Inbox, Clock, Download } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useVendorStore } from '../store/useVendorStore';
import { useStaffingStore } from '../store/useStaffingStore';
import { VENDOR_SKILL_PRESETS } from '../types/vendor';
import type { Vendor, VendorOutreach, VendorOutreachStatus } from '../types/vendor';

export default function VendorsPage() {
  const { vendors, outreach, addVendor, updateVendor, removeVendor } = useVendorStore();

  const [q, setQ] = useState('');
  const [filterSkill, setFilterSkill] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);

  // Per-vendor outreach stats — count, last activity, plus a stale-follow-up
  // signal. A vendor "needs follow-up" if their newest `sent` outreach is
  // older than FOLLOW_UP_THRESHOLD_DAYS AND has not been superseded by a
  // `replied` event. `bounced` doesn't count as needing follow-up (different
  // failure mode — fix the address).
  const FOLLOW_UP_THRESHOLD_DAYS = 3;
  const statsByVendor = useMemo(() => {
    const m = new Map<string, { count: number; last: string | null; lastSentAt: string | null; hasReply: boolean }>();
    for (const o of outreach) {
      const s = m.get(o.vendorId) || { count: 0, last: null, lastSentAt: null, hasReply: false };
      s.count += 1;
      if (!s.last || o.sentAt > s.last) s.last = o.sentAt;
      if (o.sendStatus === 'sent' && (!s.lastSentAt || o.sentAt > s.lastSentAt)) s.lastSentAt = o.sentAt;
      if (o.sendStatus === 'replied') s.hasReply = true;
      m.set(o.vendorId, s);
    }
    // Layer in derived `needsFollowupDays`
    const now = Date.now();
    const dayMs = 86_400_000;
    const out = new Map<string, { count: number; last: string | null; needsFollowupDays: number | null }>();
    for (const [id, s] of m) {
      let needs: number | null = null;
      if (!s.hasReply && s.lastSentAt) {
        const age = Math.floor((now - Date.parse(s.lastSentAt)) / dayMs);
        if (age >= FOLLOW_UP_THRESHOLD_DAYS) needs = age;
      }
      out.set(id, { count: s.count, last: s.last, needsFollowupDays: needs });
    }
    return out;
  }, [outreach]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vendors
      .filter((v) => showInactive || v.active)
      .filter((v) => {
        if (filterSkill && !v.skills.includes(filterSkill)) return false;
        if (needle) {
          const hay = `${v.companyName} ${v.spocName ?? ''} ${v.spocEmail ?? ''} ${v.skills.join(' ')} ${v.notes}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => a.companyName.localeCompare(b.companyName));
  }, [vendors, q, filterSkill, showInactive]);

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Vendors"
        subtitle={`${vendors.length} vendor${vendors.length === 1 ? '' : 's'} · ${outreach.length} outreach event${outreach.length === 1 ? '' : 's'}`}
        action={
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-semibold bg-primary text-white px-3 py-2 rounded-md hover:bg-primary/90 flex items-center gap-1"
          >
            <Plus size={14} /> Add vendor
          </button>
        }
      />

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <input
            placeholder="Search company / SPOC / email / skill…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <select
            value={filterSkill}
            onChange={(e) => setFilterSkill(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            <option value="">All skills</option>
            {VENDOR_SKILL_PRESETS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="text-xs text-slate-600 inline-flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Include inactive vendors
          </label>
        </div>
      </Card>

      {adding && (
        <AddVendorForm
          onCancel={() => setAdding(false)}
          onAdd={async (p) => {
            await addVendor(p);
            setAdding(false);
          }}
        />
      )}

      <RecentOutreachCard
        outreach={outreach}
        vendorNameById={(id) => vendors.find((v) => v.id === id)?.companyName ?? '—'}
      />

      <Card title={`${filtered.length} vendor${filtered.length === 1 ? '' : 's'}`}>
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500">
            {vendors.length === 0
              ? <>No vendors yet. Click <strong>+ Add vendor</strong> to create one.</>
              : <>No vendors match.</>}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 -mx-6">
            {filtered.map((v) => (
              <VendorRow
                key={v.id}
                vendor={v}
                outreachCount={statsByVendor.get(v.id)?.count ?? 0}
                lastContactedAt={statsByVendor.get(v.id)?.last ?? null}
                needsFollowupDays={statsByVendor.get(v.id)?.needsFollowupDays ?? null}
                onPatch={(patch) => updateVendor(v.id, patch)}
                onRemove={() => {
                  if (confirm(`Remove vendor "${v.companyName}"? Outreach history will be deleted too.`)) {
                    void removeVendor(v.id);
                  }
                }}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ── Single vendor row (inline editable) ── */

function VendorRow({ vendor, outreachCount, lastContactedAt, needsFollowupDays, onPatch, onRemove }: {
  vendor: Vendor;
  outreachCount: number;
  lastContactedAt: string | null;
  /** Number of days since the last `sent` outreach if it's been ≥3 days without
   *  a reply. null when the vendor is fresh, replied, or never emailed. */
  needsFollowupDays: number | null;
  onPatch: (patch: Partial<Vendor>) => void | Promise<void>;
  onRemove: () => void;
}) {
  const niceLast = lastContactedAt
    ? new Date(lastContactedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  return (
    <div className="px-6 py-3 hover:bg-slate-50/60 flex items-start gap-3 group">
      <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 mt-0.5">
        <Building2 size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-1.5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
              Company
              {needsFollowupDays !== null && (
                <span
                  className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800"
                  title={`Last 'sent' outreach was ${needsFollowupDays} days ago and the vendor hasn't replied. Time to nudge.`}
                >
                  <AlertCircle size={9} /> Needs follow-up · {needsFollowupDays}d
                </span>
              )}
            </div>
            <input
              value={vendor.companyName}
              onChange={(e) => onPatch({ companyName: e.target.value })}
              className="w-full text-sm font-semibold text-slate-900 bg-transparent border-0 px-0 py-0.5 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
            />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">SPOC</div>
            <input
              value={vendor.spocName ?? ''}
              onChange={(e) => onPatch({ spocName: e.target.value || null })}
              placeholder="—"
              className="w-full text-sm text-slate-700 bg-transparent border-0 px-0 py-0.5 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
            />
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">SPOC email</div>
            <div className="inline-flex items-center gap-1.5 w-full">
              <Mail size={12} className="text-slate-400 flex-shrink-0" />
              <input
                value={vendor.spocEmail ?? ''}
                onChange={(e) => onPatch({ spocEmail: e.target.value.toLowerCase() || null })}
                placeholder="spoc@vendor.com"
                className="flex-1 text-sm text-slate-700 bg-transparent border-0 px-0 py-0.5 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 rounded"
              />
            </div>
          </div>
        </div>
        <div className="mt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Skills</div>
          <SkillsMultiSelect
            value={vendor.skills}
            onChange={(skills) => onPatch({ skills })}
          />
        </div>
        <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Send size={11} />
            <span className="font-semibold text-slate-700">{outreachCount}</span> outreach{outreachCount === 1 ? '' : 'es'}
          </span>
          <span>Last contacted: <span className="font-medium text-slate-700">{niceLast}</span></span>
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={vendor.active}
              onChange={(e) => onPatch({ active: e.target.checked })}
              className="cursor-pointer"
            />
            <span className={vendor.active ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
              {vendor.active ? 'Active' : 'Inactive'}
            </span>
          </label>
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-700 transition-opacity flex-shrink-0 mt-1"
        title="Remove vendor"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/* ── Skills multi-select with free-text fallback ── */

export function SkillsMultiSelect({ value, onChange }: {
  value: string[];
  onChange: (skills: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const toggle = (s: string) => {
    if (value.includes(s)) onChange(value.filter((x) => x !== s));
    else onChange([...value, s]);
  };
  const addCustom = () => {
    const s = draft.trim();
    if (!s) return;
    if (!value.includes(s)) onChange([...value, s]);
    setDraft('');
    setAdding(false);
  };
  const remove = (s: string) => onChange(value.filter((x) => x !== s));

  // Show currently-selected first, then preset suggestions not yet selected
  const suggestions = VENDOR_SKILL_PRESETS.filter((s) => !value.includes(s));

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((s) => (
            <span key={s} className="inline-flex items-center gap-1 text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {s}
              <button
                type="button"
                onClick={() => remove(s)}
                className="text-primary/60 hover:text-red-700"
                title={`Remove ${s}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1 items-center">
        <details className="inline">
          <summary className="text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer select-none list-none inline-flex items-center gap-1">
            <Plus size={11} /> Add skill from list
          </summary>
          <div className="mt-2 flex flex-wrap gap-1 max-h-40 overflow-y-auto bg-slate-50 border border-slate-200 rounded-md p-2">
            {suggestions.length === 0 ? (
              <span className="text-[11px] text-slate-400 italic">All preset skills already added.</span>
            ) : (
              suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggle(s)}
                  className="text-[11px] bg-white border border-slate-200 text-slate-700 hover:border-primary hover:text-primary px-2 py-0.5 rounded-full"
                >
                  + {s}
                </button>
              ))
            )}
          </div>
        </details>
        <span className="text-slate-300 text-[11px]">·</span>
        {adding ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addCustom(); if (e.key === 'Escape') { setAdding(false); setDraft(''); }}}
              placeholder="custom skill"
              className="text-[11px] border border-slate-300 rounded px-2 py-0.5 w-32"
            />
            <button type="button" onClick={addCustom} className="text-[11px] text-primary font-semibold">Add</button>
            <button type="button" onClick={() => { setAdding(false); setDraft(''); }} className="text-[11px] text-slate-400">cancel</button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-[11px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
          >
            <Plus size={11} /> Add custom skill
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Add-vendor inline form ── */

function AddVendorForm({ onCancel, onAdd }: {
  onCancel: () => void;
  onAdd: (p: { companyName: string; spocName?: string; spocEmail?: string; skills?: string[]; notes?: string }) => Promise<unknown>;
}) {
  const [d, setD] = useState({ companyName: '', spocName: '', spocEmail: '', skills: [] as string[], notes: '' });
  const submit = async () => {
    if (!d.companyName.trim()) return;
    await onAdd({
      companyName: d.companyName.trim(),
      spocName: d.spocName || undefined,
      spocEmail: d.spocEmail || undefined,
      skills: d.skills.length > 0 ? d.skills : undefined,
      notes: d.notes || undefined,
    });
  };
  return (
    <Card className="mb-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Company name *</label>
          <input
            autoFocus
            value={d.companyName}
            onChange={(e) => setD({ ...d, companyName: e.target.value })}
            placeholder="e.g. Talent Edge Pvt Ltd"
            className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">SPOC name</label>
          <input
            value={d.spocName}
            onChange={(e) => setD({ ...d, spocName: e.target.value })}
            placeholder="Optional"
            className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">SPOC email</label>
          <input
            type="email"
            value={d.spocEmail}
            onChange={(e) => setD({ ...d, spocEmail: e.target.value.toLowerCase() })}
            placeholder="spoc@vendor.com"
            className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm"
          />
        </div>
      </div>
      <div className="mb-3">
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Skills</label>
        <SkillsMultiSelect value={d.skills} onChange={(skills) => setD({ ...d, skills })} />
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel}
                className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1">
          <X size={12} /> Cancel
        </button>
        <button type="button" onClick={submit} disabled={!d.companyName.trim()}
                className="text-xs font-semibold bg-primary text-white px-3 py-2 rounded-md hover:bg-primary/90 disabled:opacity-40 inline-flex items-center gap-1">
          <Save size={12} /> Add vendor
        </button>
      </div>
    </Card>
  );
}

/* ── Recent outreach activity feed ─────────────────────────────── */

const OUTREACH_STATUS_META: Record<VendorOutreachStatus, { label: string; cls: string; Icon: typeof Check }> = {
  composed: { label: 'Composed', cls: 'bg-slate-100 text-slate-600',    Icon: Clock },
  sent:     { label: 'Sent',     cls: 'bg-emerald-100 text-emerald-800', Icon: Check },
  bounced:  { label: 'Failed',   cls: 'bg-red-100 text-red-700',         Icon: AlertCircle },
  replied:  { label: 'Replied',  cls: 'bg-sky-100 text-sky-800',         Icon: Inbox },
};

function RecentOutreachCard({ outreach, vendorNameById }: {
  outreach: VendorOutreach[];
  vendorNameById: (id: string) => string;
}) {
  const { requisitions } = useStaffingStore();
  const setOutreachStatus = useVendorStore((s) => s.setOutreachStatus);
  const reqTitleById = (id: string) => requisitions.find((r) => r.id === id)?.title ?? id.slice(0, 8);

  const [showAll, setShowAll] = useState(false);
  const [statusFilter, setStatusFilter] = useState<VendorOutreachStatus | 'all'>('all');
  const [q, setQ] = useState('');

  const recent = useMemo(() => {
    const sorted = [...outreach].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    const byStatus = statusFilter === 'all'
      ? sorted
      : sorted.filter((o) => o.sendStatus === statusFilter);
    const needle = q.trim().toLowerCase();
    const byText = !needle
      ? byStatus
      : byStatus.filter((o) => {
          // Case-insensitive substring across the columns the recruiter sees.
          const hay = `${vendorNameById(o.vendorId)} ${reqTitleById(o.requisitionId)} ${o.subject} ${o.sentBy ?? ''}`.toLowerCase();
          return hay.includes(needle);
        });
    return showAll ? byText : byText.slice(0, 20);
  }, [outreach, showAll, statusFilter, q, vendorNameById, reqTitleById]);

  // Per-status counts for chip labels
  const statusCounts = useMemo(() => {
    const c: Record<VendorOutreachStatus | 'all', number> = {
      all: outreach.length,
      composed: 0, sent: 0, bounced: 0, replied: 0,
    };
    for (const o of outreach) c[o.sendStatus] = (c[o.sendStatus] ?? 0) + 1;
    return c;
  }, [outreach]);

  const today = new Date().toISOString().slice(0, 10);
  const todayOnly = outreach.filter((o) => o.sentAt.startsWith(today));
  const sentToday = todayOnly.filter((o) => o.sendStatus === 'sent').length;
  const failedToday = todayOnly.filter((o) => o.sendStatus === 'bounced').length;

  if (outreach.length === 0) return null;

  const titleSuffix = (sentToday > 0 || failedToday > 0)
    ? ` · today: ${sentToday} sent${failedToday > 0 ? ` · ${failedToday} failed` : ''}`
    : '';

  /** Filter chips for triage. Order matches a typical recruiter mental model:
   *  see all first, then narrow by what's actionable now. */
  const chips: { key: VendorOutreachStatus | 'all'; label: string; cls: string }[] = [
    { key: 'all',      label: 'All',      cls: 'bg-slate-100 text-slate-700' },
    { key: 'sent',     label: 'Sent',     cls: 'bg-emerald-100 text-emerald-800' },
    { key: 'replied',  label: 'Replied',  cls: 'bg-sky-100 text-sky-800' },
    { key: 'bounced',  label: 'Failed',   cls: 'bg-red-100 text-red-700' },
    { key: 'composed', label: 'Composed', cls: 'bg-slate-100 text-slate-600' },
  ];

  /** Download the currently-filtered outreach list as CSV. Reflects exactly
   *  what the table shows (status filter + show-all/show-20 BOTH applied via
   *  `recent`) so accounting/operations can run a monthly vendor report
   *  matching the same view they see on screen. */
  const exportCsv = () => {
    const cols: { label: string; value: (o: VendorOutreach) => string }[] = [
      { label: 'When',        value: (o) => o.sentAt },
      { label: 'Vendor',      value: (o) => vendorNameById(o.vendorId) },
      { label: 'Requisition', value: (o) => reqTitleById(o.requisitionId) },
      { label: 'Subject',     value: (o) => o.subject },
      { label: 'Sent by',     value: (o) => o.sentBy ?? '' },
      { label: 'Status',      value: (o) => o.sendStatus },
      { label: 'Error',       value: (o) => o.sendError ?? '' },
    ];
    const esc = (s: string) => /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    const header = cols.map((c) => c.label).join(',');
    const rows = recent.map((o) => cols.map((c) => esc(c.value(o))).join(','));
    const csv = [header, ...rows].join('\r\n');
    const today = new Date().toISOString().slice(0, 10);
    const filename = `vendor-outreach-${statusFilter}-${today}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="mb-4" title={`Recent outreach activity · ${outreach.length} total${titleSuffix}`}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search subject / vendor / req / sender…"
        className="w-full mb-2 border border-slate-200 rounded-md px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <div className="flex items-center gap-1.5 flex-wrap mb-3">
        {chips.map((c) => {
          const active = statusFilter === c.key;
          const n = statusCounts[c.key] ?? 0;
          if (c.key !== 'all' && n === 0) return null; // hide empty buckets
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setStatusFilter(c.key)}
              className={`text-[10px] font-semibold inline-flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors ${
                active ? `${c.cls} ring-2 ring-offset-1 ring-current` : `${c.cls} opacity-60 hover:opacity-100`
              }`}
            >
              {c.label} <span className="tabular-nums">{n}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={exportCsv}
          disabled={recent.length === 0}
          className="ml-auto text-[10px] font-semibold bg-white border border-slate-300 text-slate-700 px-2 py-0.5 rounded-full hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1"
          title={`Download ${recent.length} event${recent.length === 1 ? '' : 's'} as CSV`}
        >
          <Download size={10} /> Export
        </button>
      </div>
      <div className="overflow-x-auto -mx-6 px-6">
        <table className="min-w-full text-sm [&_td]:align-middle [&_th]:align-middle">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
              <th className="py-2 pr-3 font-semibold"><Activity size={10} className="inline mr-1" />When</th>
              <th className="py-2 pr-3 font-semibold">Vendor</th>
              <th className="py-2 pr-3 font-semibold">Requisition</th>
              <th className="py-2 pr-3 font-semibold">Subject</th>
              <th className="py-2 pr-3 font-semibold">By</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 font-semibold w-32">Mark</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {recent.map((o) => {
              const meta = OUTREACH_STATUS_META[o.sendStatus] ?? OUTREACH_STATUS_META.composed;
              return (
                <tr key={o.id} className="hover:bg-slate-50/60">
                  <td className="py-2 pr-3 text-[11px] tabular-nums text-slate-500">
                    {new Date(o.sentAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="py-2 pr-3 text-xs font-medium text-slate-900 truncate max-w-[160px]" title={vendorNameById(o.vendorId)}>
                    {vendorNameById(o.vendorId)}
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-700 truncate max-w-[200px]" title={reqTitleById(o.requisitionId)}>
                    {reqTitleById(o.requisitionId)}
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-600 truncate max-w-[240px]" title={o.subject}>
                    {o.subject}
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-slate-500 truncate max-w-[160px]" title={o.sentBy ?? ''}>
                    {o.sentBy ?? '—'}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`text-[10px] font-semibold inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${meta.cls}`} title={o.sendError ?? meta.label}>
                      <meta.Icon size={10} /> {meta.label}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    {/* Manual status flip — closes the loop without webhooks.
                     *  Only offered while the row is in `sent` (already-replied
                     *  / bounced / composed rows don't get this affordance). */}
                    {o.sendStatus === 'sent' ? (
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void setOutreachStatus(o.id, 'replied')}
                          className="text-[10px] font-semibold text-sky-700 hover:text-sky-900 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-sky-50"
                          title="They replied — mark as replied"
                        >
                          <Inbox size={10} /> Replied
                        </button>
                        <button
                          type="button"
                          onClick={() => void setOutreachStatus(o.id, 'bounced')}
                          className="text-[10px] font-semibold text-red-700 hover:text-red-900 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-red-50"
                          title="Bounced or undeliverable"
                        >
                          <AlertCircle size={10} /> Bounced
                        </button>
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {outreach.length > 20 && (
        <div className="text-center mt-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[11px] text-primary font-semibold hover:underline"
          >
            {showAll ? 'Show only latest 20' : `Show all ${outreach.length} events`}
          </button>
        </div>
      )}
    </Card>
  );
}
