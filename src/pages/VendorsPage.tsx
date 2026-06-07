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
import { Plus, Trash2, Save, X, Building2, Mail, Send } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useVendorStore } from '../store/useVendorStore';
import { VENDOR_SKILL_PRESETS } from '../types/vendor';
import type { Vendor } from '../types/vendor';

export default function VendorsPage() {
  const { vendors, outreach, addVendor, updateVendor, removeVendor } = useVendorStore();

  const [q, setQ] = useState('');
  const [filterSkill, setFilterSkill] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [adding, setAdding] = useState(false);

  // Per-vendor outreach stats
  const statsByVendor = useMemo(() => {
    const m = new Map<string, { count: number; last: string | null }>();
    for (const o of outreach) {
      const s = m.get(o.vendorId) || { count: 0, last: null };
      s.count += 1;
      if (!s.last || o.sentAt > s.last) s.last = o.sentAt;
      m.set(o.vendorId, s);
    }
    return m;
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

function VendorRow({ vendor, outreachCount, lastContactedAt, onPatch, onRemove }: {
  vendor: Vendor;
  outreachCount: number;
  lastContactedAt: string | null;
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
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Company</div>
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
