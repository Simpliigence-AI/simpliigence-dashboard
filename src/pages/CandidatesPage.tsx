/**
 * Candidates — bulk CRUD for india_staffing_candidates.
 *
 * Each row now supports:
 *   - LinkedIn URL
 *   - Resume/CV upload to Supabase Storage (bucket: candidate-resumes)
 *   - Auto-parse the resume via the parse-resume edge function — extracts
 *     skills and a profile summary using Claude.
 *
 * Persists via useStaffingStore.{addCandidate, updateCandidate, removeCandidate},
 * which already write to Supabase via db.upsertIndiaCandidate / deleteIndiaCandidate.
 */
import { useEffect, useMemo, useState } from 'react';
import { Users as UsersIcon, FileCheck2, CalendarRange, LayoutGrid, Table as TableIcon, MapPin, Briefcase, Mail, Phone, Zap } from 'lucide-react';
import { Plus, Trash2, Save, X, Upload, Sparkles, FileText, ExternalLink, ChevronDown, ChevronRight, Linkedin, UploadCloud, CheckCircle, AlertCircle, Loader2, UserPlus, IndianRupee } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useAuthStore } from '../store/useAuthStore';
import { useStaffingStore } from '../store/useStaffingStore';
import { db } from '../lib/supabaseSync';
import {
  CANDIDATE_STAGES,
  CANDIDATE_STAGE_COLORS,
  ACTIVE_CANDIDATE_STAGES,
  AVAILABILITY_LABELS,
  type CandidateStage,
  type StaffingCandidate,
  type AvailabilityKind,
} from '../types/staffing';

const SOURCE_OPTIONS = ['LinkedIn', 'Naukri', 'Referral', 'Vendor', 'Internal DB', 'Other'];

interface DraftCandidate {
  name: string;
  email: string;
  phone: string;
  requisition_id: string;
  source: string;
  stage: CandidateStage;
  owning_ta_email: string;
  linkedin_url: string;
  location: string;
}

const emptyDraft: DraftCandidate = {
  name: '',
  email: '',
  phone: '',
  requisition_id: '',
  source: 'LinkedIn',
  stage: 'Submitted',
  owning_ta_email: '',
  linkedin_url: '',
  location: '',
};

export default function CandidatesPage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { accounts, requisitions, candidates, addCandidate, updateCandidate, removeCandidate } = useStaffingStore();

  const [q, setQ] = useState('');
  const [filterReq, setFilterReq] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftCandidate>(emptyDraft);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  // ── AI search state ──
  const [aiQuery, setAiQuery] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMatchSet, setAiMatchSet] = useState<Set<string> | null>(null);
  const [aiExplanation, setAiExplanation] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);

  const runAiSearch = async () => {
    const q = aiQuery.trim();
    if (!q) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const res = await db.searchCandidates(q);
      if (res.ok) {
        setAiMatchSet(new Set(res.matchedIds));
        setAiExplanation(res.explanation);
      } else {
        setAiError(res.error);
        setAiMatchSet(null);
      }
    } finally {
      setAiBusy(false);
    }
  };

  const clearAiSearch = () => {
    setAiQuery('');
    setAiMatchSet(null);
    setAiExplanation('');
    setAiError(null);
  };

  const owners = useMemo(() => {
    const s = new Set<string>();
    candidates.forEach((c) => { if (c.owning_ta_email) s.add(c.owning_ta_email); });
    return Array.from(s).sort();
  }, [candidates]);

  const locations = useMemo(() => {
    const s = new Set<string>();
    candidates.forEach((c) => { if (c.location && c.location.trim()) s.add(c.location.trim()); });
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [candidates]);

  const accountName = (rid: string) => {
    const req = requisitions.find((r) => r.id === rid);
    if (!req) return '—';
    return accounts.find((a) => a.id === req.account_id)?.name ?? '—';
  };
  const reqLabel = (rid: string) => {
    const req = requisitions.find((r) => r.id === rid);
    return req ? `${req.title} (${accountName(rid)})` : '—';
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return candidates.filter((c) => {
      // When an AI search is active, restrict to its match set first.
      if (aiMatchSet && !aiMatchSet.has(c.id)) return false;
      if (filterReq === '__unassigned__') {
        if (c.requisition_id) return false;
      } else if (filterReq && c.requisition_id !== filterReq) {
        return false;
      }
      if (filterOwner && (c.owning_ta_email || '') !== filterOwner) return false;
      if (filterStage && c.stage !== filterStage) return false;
      // Location filter is a substring match (case-insensitive) so "Bangalore"
      // also matches "Bangalore, India" or "Bengaluru, KA".
      if (filterLocation) {
        const want = filterLocation.toLowerCase();
        const have = (c.location || '').toLowerCase();
        if (!have.includes(want)) return false;
      }
      if (needle) {
        const hay = `${c.name} ${c.email} ${c.phone} ${c.source} ${reqLabel(c.requisition_id)} ${(c.skills || []).join(' ')} ${c.profile_summary || ''} ${c.location || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [candidates, q, filterReq, filterOwner, filterStage, filterLocation, requisitions, accounts, aiMatchSet]); // eslint-disable-line react-hooks/exhaustive-deps

  // KPI strip stats (across ALL candidates, not filtered — gives a true at-a-glance view)
  const kpis = useMemo(() => {
    const total = candidates.length;
    const active = candidates.filter((c) => ACTIVE_CANDIDATE_STAGES.includes(c.stage)).length;
    const parsed = candidates.filter((c) => c.parsed_at).length;
    const sevenDaysAgo = Date.now() - 7 * 86400 * 1000;
    const recent = candidates.filter((c) => {
      const t = c.submit_date ? Date.parse(c.submit_date) : NaN;
      return !Number.isNaN(t) && t >= sevenDaysAgo;
    }).length;
    return { total, active, parsed, recent };
  }, [candidates]);

  const commitAdd = async () => {
    if (!draft.name.trim()) return;
    addCandidate({
      requisition_id: draft.requisition_id,
      name: draft.name.trim(),
      experience: '',
      stage: draft.stage,
      submit_date: new Date().toISOString().slice(0, 10),
      feedback: '',
      source: draft.source,
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      owning_ta_email: draft.owning_ta_email.trim().toLowerCase() || undefined,
      linkedin_url: draft.linkedin_url.trim() || undefined,
      location: draft.location.trim() || undefined,
    });
    setAdding(false);
    setDraft({ ...emptyDraft, owning_ta_email: (currentUser?.email || '').toLowerCase() });
  };

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Candidates"
        subtitle="All candidates currently being worked across India Staffing requisitions"
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setReferralOpen(true)}
              className="text-xs font-semibold bg-white border border-emerald-300 text-emerald-800 px-3 py-2 rounded-md hover:bg-emerald-50 flex items-center gap-1"
              title="Submit a candidate referral on behalf of an employee"
            >
              <UserPlus size={14} /> Add referral
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              className="text-xs font-semibold bg-white border border-slate-300 text-slate-700 px-3 py-2 rounded-md hover:bg-slate-50 flex items-center gap-1"
              title="Drop multiple resumes; each one is auto-parsed and creates a candidate"
            >
              <UploadCloud size={14} /> Bulk import resumes
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                setDraft({ ...emptyDraft, owning_ta_email: (currentUser?.email || '').toLowerCase() });
              }}
              className="text-xs font-semibold bg-primary text-white px-3 py-2 rounded-md hover:bg-primary/90 flex items-center gap-1"
            >
              <Plus size={14} /> Add candidate
            </button>
          </div>
        }
      />

      {referralOpen && (
        <AddReferralDialog
          requisitions={requisitions}
          accountName={accountName}
          defaultOwner={(currentUser?.email || '').toLowerCase()}
          onClose={() => setReferralOpen(false)}
          onSubmit={(input) => {
            addCandidate(input);
            setReferralOpen(false);
          }}
        />
      )}

      {bulkOpen && (
        <BulkImportDialog
          requisitions={requisitions}
          accountName={accountName}
          defaultOwner={(currentUser?.email || '').toLowerCase()}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {/* KPI strip — colorful at-a-glance counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiTile color="indigo" icon={<UsersIcon size={18} />} label="All candidates" value={kpis.total} />
        <KpiTile color="emerald" icon={<Zap size={18} />} label="Active" value={kpis.active} subtitle="in funnel" />
        <KpiTile color="amber" icon={<FileCheck2 size={18} />} label="Resume parsed" value={kpis.parsed} subtitle={`${kpis.total ? Math.round((kpis.parsed / kpis.total) * 100) : 0}% of total`} />
        <KpiTile color="sky" icon={<CalendarRange size={18} />} label="Added · last 7d" value={kpis.recent} />
      </div>

      {/* AI search bar — gradient pop */}
      <div className="mb-4 rounded-xl bg-gradient-to-r from-amber-100/70 via-orange-50 to-rose-50 border border-amber-200/70 shadow-sm p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles size={16} className="text-amber-500 flex-shrink-0" />
          <input
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runAiSearch(); }}
            placeholder='Ask Claude: e.g. "all servicemax candidates" or "salesforce architects in bangalore"'
            className="flex-1 min-w-[200px] bg-white/90 border border-amber-200 rounded-lg px-3 py-2 text-sm placeholder:text-amber-700/40 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
          />
          <button
            type="button"
            onClick={runAiSearch}
            disabled={aiBusy || !aiQuery.trim()}
            className="text-xs font-semibold bg-gradient-to-r from-amber-500 to-orange-500 text-white px-4 py-2 rounded-lg hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm"
          >
            <Sparkles size={12} /> {aiBusy ? 'Searching…' : 'Ask Claude'}
          </button>
          {aiMatchSet && (
            <button
              type="button"
              onClick={clearAiSearch}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2 py-1 inline-flex items-center gap-1"
              title="Clear AI search"
            >
              <X size={12} /> Clear
            </button>
          )}
        </div>
        {aiMatchSet && (
          <div className="mt-2 text-[11px] text-slate-600">
            <span className="font-semibold text-amber-700">
              {aiMatchSet.size} match{aiMatchSet.size === 1 ? '' : 'es'}
            </span>
            {aiExplanation && <span className="text-slate-500"> · {aiExplanation}</span>}
          </div>
        )}
        {aiError && (
          <div className="mt-2 text-[11px] text-red-700">{aiError}</div>
        )}
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input
            placeholder="Search name / email / skill / location…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <select
            value={filterReq}
            onChange={(e) => setFilterReq(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            <option value="">All requisitions</option>
            <option value="__unassigned__">— Unassigned —</option>
            {requisitions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </select>
          <select
            value={filterOwner}
            onChange={(e) => setFilterOwner(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            <option value="">All owners</option>
            {owners.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
          >
            <option value="">All stages</option>
            {CANDIDATE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            list="candidate-location-options"
            placeholder="Location (e.g. Bangalore)"
            value={filterLocation}
            onChange={(e) => setFilterLocation(e.target.value)}
            className="border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            title="Substring match — type 'Bangalore' to find candidates whose location contains it"
          />
          <datalist id="candidate-location-options">
            {locations.map((l) => <option key={l} value={l} />)}
          </datalist>
        </div>
      </Card>

      {/* Add row */}
      {adding && (
        <Card className="mb-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <input placeholder="Name *" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                   className="border border-slate-300 rounded-md px-3 py-2 text-sm md:col-span-1" />
            <input placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                   className="border border-slate-300 rounded-md px-3 py-2 text-sm md:col-span-1" />
            <input placeholder="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                   className="border border-slate-300 rounded-md px-3 py-2 text-sm md:col-span-1" />
            <select value={draft.requisition_id} onChange={(e) => setDraft({ ...draft, requisition_id: e.target.value })}
                    className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white md:col-span-1">
              <option value="">No requisition (unassigned)</option>
              {requisitions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                    className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white">
              {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input placeholder="Owning TA email" value={draft.owning_ta_email}
                   onChange={(e) => setDraft({ ...draft, owning_ta_email: e.target.value })}
                   className="border border-slate-300 rounded-md px-3 py-2 text-sm" />
            <input placeholder="Location (e.g. Bangalore, India)" value={draft.location}
                   onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                   list="candidate-location-options"
                   className="border border-slate-300 rounded-md px-3 py-2 text-sm md:col-span-2" />
            <input placeholder="LinkedIn URL (https://linkedin.com/in/…)" value={draft.linkedin_url}
                   onChange={(e) => setDraft({ ...draft, linkedin_url: e.target.value })}
                   className="border border-slate-300 rounded-md px-3 py-2 text-sm md:col-span-4" />
            <div className="md:col-span-6 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setAdding(false)}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1">
                <X size={12} /> Cancel
              </button>
              <button type="button" onClick={commitAdd}
                      disabled={!draft.name.trim()}
                      className="text-xs font-semibold bg-primary text-white px-3 py-2 rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
                <Save size={12} /> Add candidate
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            Tip: after adding, click <strong>▸</strong> on the row to upload the resume — it'll auto-extract skills + summary.
          </p>
        </Card>
      )}

      {/* List header w/ count + view toggle */}
      <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
        <div className="text-sm font-semibold text-slate-700">
          {filtered.length} candidate{filtered.length === 1 ? '' : 's'}
          {filtered.length !== candidates.length && (
            <span className="ml-1 text-slate-400 font-normal">of {candidates.length}</span>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              viewMode === 'cards' ? 'bg-primary text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Card view — rich, browse-friendly"
          >
            <LayoutGrid size={12} /> Cards
          </button>
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              viewMode === 'table' ? 'bg-primary text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Table view — dense, power-user editing"
          >
            <TableIcon size={12} /> Table
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <div className="text-sm text-slate-500 text-center py-12">
            <UsersIcon size={32} className="mx-auto mb-2 text-slate-300" />
            <div>No candidates match your filters.</div>
            <div className="text-[11px] text-slate-400 mt-1">
              Try clearing filters or use <strong>+ Add candidate</strong> at the top.
            </div>
          </div>
        </Card>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <CandidateCard
              key={c.id}
              c={c}
              requisitionLabel={reqLabel(c.requisition_id)}
              onOpen={() => {
                setViewMode('table');
                const next = new Set(expanded);
                next.add(c.id);
                setExpanded(next);
              }}
            />
          ))}
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-3 font-semibold w-6"></th>
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Requisition</th>
                  <th className="py-2 pr-3 font-semibold">Stage</th>
                  <th className="py-2 pr-3 font-semibold">Source</th>
                  <th className="py-2 pr-3 font-semibold">Location</th>
                  <th className="py-2 pr-3 font-semibold">Owning TA</th>
                  <th className="py-2 pr-3 font-semibold">Email / Phone</th>
                  <th className="py-2 pr-3 font-semibold">Resume / LinkedIn</th>
                  <th className="py-2 pr-3 font-semibold w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <CandidateRow
                    key={c.id}
                    c={c}
                    requisitions={requisitions}
                    accountName={accountName}
                    expanded={expanded.has(c.id)}
                    onToggleExpand={() => {
                      const next = new Set(expanded);
                      if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                      setExpanded(next);
                    }}
                    onChange={(patch) => updateCandidate(c.id, patch)}
                    onRemove={() => removeCandidate(c.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ── KPI tile — colored top-of-page stat ── */
function KpiTile({ color, icon, label, value, subtitle }: {
  color: 'indigo' | 'emerald' | 'amber' | 'sky';
  icon: React.ReactNode;
  label: string;
  value: number;
  subtitle?: string;
}) {
  const palette: Record<typeof color, { bg: string; iconBg: string; iconColor: string; ring: string }> = {
    indigo:  { bg: 'from-indigo-50 to-violet-50',  iconBg: 'bg-indigo-100',  iconColor: 'text-indigo-600',  ring: 'border-indigo-100' },
    emerald: { bg: 'from-emerald-50 to-teal-50',    iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600', ring: 'border-emerald-100' },
    amber:   { bg: 'from-amber-50 to-orange-50',    iconBg: 'bg-amber-100',   iconColor: 'text-amber-600',   ring: 'border-amber-100' },
    sky:     { bg: 'from-sky-50 to-cyan-50',        iconBg: 'bg-sky-100',     iconColor: 'text-sky-600',     ring: 'border-sky-100' },
  };
  const p = palette[color];
  return (
    <div className={`rounded-xl bg-gradient-to-br ${p.bg} border ${p.ring} px-4 py-3 shadow-sm hover:shadow transition-shadow`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
          <div className="text-2xl font-extrabold text-slate-900 mt-0.5 tabular-nums">{value}</div>
          {subtitle && <div className="text-[10px] text-slate-500 mt-0.5">{subtitle}</div>}
        </div>
        <div className={`w-9 h-9 rounded-lg ${p.iconBg} ${p.iconColor} flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

/* ── Candidate card — colorful browse-friendly tile ── */
function CandidateCard({ c, requisitionLabel, onOpen }: {
  c: StaffingCandidate;
  requisitionLabel: string;
  onOpen: () => void;
}) {
  const stageColor = CANDIDATE_STAGE_COLORS[c.stage] || '#94a3b8';
  // Avatar bubble — initials + tint derived from stage so the grid looks varied
  const initials = (c.name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';
  const titleLine = c.experience || '—';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left bg-white rounded-xl border border-slate-200/80 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden group"
    >
      {/* Top accent bar coloured by stage */}
      <div className="h-1" style={{ backgroundColor: stageColor }} />

      <div className="p-4 space-y-3">
        {/* Header row: avatar, name, stage chip */}
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm"
            style={{ backgroundColor: stageColor }}
            aria-hidden
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-900 truncate group-hover:text-primary transition-colors">
              {c.name || '(unnamed)'}
            </div>
            <div className="text-[11px] text-slate-500 truncate flex items-center gap-1">
              <Briefcase size={11} className="text-slate-400" />
              {titleLine}
            </div>
          </div>
          <span
            className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full text-white whitespace-nowrap"
            style={{ backgroundColor: stageColor }}
          >
            {c.stage}
          </span>
        </div>

        {/* Location + requisition */}
        <div className="space-y-1 text-[11px]">
          {c.location && (
            <div className="flex items-center gap-1.5 text-slate-600">
              <MapPin size={11} className="text-slate-400 flex-shrink-0" />
              <span className="truncate">{c.location}</span>
            </div>
          )}
          {requisitionLabel !== '—' && (
            <div className="flex items-center gap-1.5 text-slate-600">
              <Briefcase size={11} className="text-slate-400 flex-shrink-0" />
              <span className="truncate">{requisitionLabel}</span>
            </div>
          )}
        </div>

        {/* Skills chips — top 6, colored by index for variety */}
        {(c.skills && c.skills.length > 0) && (
          <div className="flex flex-wrap gap-1">
            {c.skills.slice(0, 6).map((s, i) => {
              const skillPalette = [
                'bg-indigo-50 text-indigo-700 border-indigo-100',
                'bg-emerald-50 text-emerald-700 border-emerald-100',
                'bg-amber-50 text-amber-700 border-amber-100',
                'bg-sky-50 text-sky-700 border-sky-100',
                'bg-rose-50 text-rose-700 border-rose-100',
                'bg-violet-50 text-violet-700 border-violet-100',
              ];
              return (
                <span key={s} className={`text-[10px] px-1.5 py-0.5 rounded-md border ${skillPalette[i % skillPalette.length]}`}>
                  {s}
                </span>
              );
            })}
            {c.skills.length > 6 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-md text-slate-500 bg-slate-50 border border-slate-100">
                +{c.skills.length - 6}
              </span>
            )}
          </div>
        )}

        {/* Footer row: contact icons + actions */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2 text-slate-400 text-[11px] min-w-0 flex-1">
            {c.email && (
              <a
                href={`mailto:${c.email}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 hover:text-slate-700 truncate"
                title={c.email}
              >
                <Mail size={11} /> <span className="truncate">{c.email}</span>
              </a>
            )}
            {!c.email && c.phone && (
              <span className="inline-flex items-center gap-1" title={c.phone}>
                <Phone size={11} /> {c.phone}
              </span>
            )}
            {!c.email && !c.phone && <span className="text-slate-300">No contact</span>}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {c.resume_url && (
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 text-primary" title="Has resume">
                <FileText size={12} />
              </span>
            )}
            {c.linkedin_url && (
              <a
                href={c.linkedin_url}
                target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-sky-50 text-sky-600 hover:bg-sky-100"
                title="LinkedIn"
              >
                <Linkedin size={12} />
              </a>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function CandidateRow({ c, requisitions, accountName, expanded, onToggleExpand, onChange, onRemove }: {
  c: StaffingCandidate;
  requisitions: { id: string; title: string; account_id: string }[];
  accountName: (rid: string) => string;
  expanded: boolean;
  onToggleExpand: () => void;
  onChange: (patch: Partial<StaffingCandidate>) => void;
  onRemove: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const res = await db.uploadCandidateResume(c.id, file);
      if ('error' in res) { setError(res.error); return; }
      onChange({
        resume_url: res.path,
        resume_filename: res.filename,
        resume_uploaded_at: new Date().toISOString(),
      });
      // Auto-parse immediately. Edge function fills DB blanks; mirror that
      // into local React state so the UI doesn't need a refetch.
      setParsing(true);
      const parsed = await db.parseCandidateResume(c.id);
      if (parsed.ok) {
        const patch: Partial<typeof c> = {
          skills: parsed.skills,
          profile_summary: parsed.summary,
          parsed_at: parsed.parsedAt,
        };
        const blank = (v: string | undefined | null) => !v || !v.trim();
        if (parsed.fullName && (blank(c.name) || /\.(pdf|txt|docx)$/i.test(c.name))) patch.name = parsed.fullName;
        if (parsed.email && blank(c.email)) patch.email = parsed.email;
        if (parsed.phone && blank(c.phone)) patch.phone = parsed.phone;
        if (parsed.linkedinUrl && blank(c.linkedin_url)) patch.linkedin_url = parsed.linkedinUrl;
        if (parsed.location && blank(c.location)) patch.location = parsed.location;
        if (parsed.currentTitle && blank(c.experience)) patch.experience = parsed.currentTitle;
        onChange(patch);
      } else {
        setError(parsed.error);
      }
    } finally {
      setUploading(false);
      setParsing(false);
    }
  };

  const handleReparse = async () => {
    setError(null);
    setParsing(true);
    try {
      const parsed = await db.parseCandidateResume(c.id);
      if (parsed.ok) {
        // Reparse never overwrites identity fields — only refreshes skills + summary
        onChange({ skills: parsed.skills, profile_summary: parsed.summary, parsed_at: parsed.parsedAt });
      } else {
        setError(parsed.error);
      }
    } finally {
      setParsing(false);
    }
  };

  const handleOpenResume = async () => {
    if (!c.resume_url) return;
    const url = await db.signedResumeUrl(c.resume_url, 300);
    if (url) window.open(url, '_blank');
  };

  return (
    <>
      <tr className="hover:bg-slate-50/60">
        <td className="py-2 pr-1 align-top">
          <button type="button" onClick={onToggleExpand} className="text-slate-400 hover:text-slate-700">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="py-2 pr-3 align-top">
          <div className="flex items-center gap-1.5">
            <input
              value={c.name}
              onChange={(e) => onChange({ name: e.target.value })}
              className="flex-1 text-sm font-medium text-slate-900 bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {c.source === 'Referral' && (
              <span
                className="text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 whitespace-nowrap"
                title={c.referrer_email ? `Referred by ${c.referrer_email}` : 'Employee referral'}
              >
                <UserPlus size={9} /> Referral
              </span>
            )}
          </div>
          {(c.skills && c.skills.length > 0) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {c.skills.slice(0, 4).map((s) => (
                <span key={s} className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">{s}</span>
              ))}
              {c.skills.length > 4 && (
                <span className="text-[10px] text-slate-400">+{c.skills.length - 4}</span>
              )}
            </div>
          )}
        </td>
        <td className="py-2 pr-3 align-top">
          <select
            value={c.requisition_id || ''}
            onChange={(e) => onChange({ requisition_id: e.target.value })}
            className={`text-xs border border-slate-200 rounded px-2 py-1 bg-white max-w-[220px] ${!c.requisition_id ? 'italic text-slate-500' : ''}`}
          >
            <option value="">Unassigned</option>
            {requisitions.map((r) => (
              <option key={r.id} value={r.id}>{r.title} — {accountName(r.id)}</option>
            ))}
          </select>
        </td>
        <td className="py-2 pr-3 align-top">
          <select
            value={c.stage}
            onChange={(e) => onChange({ stage: e.target.value as CandidateStage })}
            style={{ borderLeft: `3px solid ${CANDIDATE_STAGE_COLORS[c.stage]}` }}
            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
          >
            {CANDIDATE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </td>
        <td className="py-2 pr-3 align-top">
          <select
            value={c.source}
            onChange={(e) => onChange({ source: e.target.value })}
            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
          >
            {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            {c.source && !SOURCE_OPTIONS.includes(c.source) && (
              <option value={c.source}>{c.source}</option>
            )}
          </select>
        </td>
        <td className="py-2 pr-3 align-top">
          <input
            value={c.location ?? ''}
            onChange={(e) => onChange({ location: e.target.value || undefined })}
            placeholder="—"
            list="candidate-location-options"
            className="text-xs bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 w-36"
          />
        </td>
        <td className="py-2 pr-3 align-top">
          <input
            value={c.owning_ta_email ?? ''}
            onChange={(e) => onChange({ owning_ta_email: e.target.value.toLowerCase() })}
            placeholder="ta@…"
            className="text-xs bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 w-44"
          />
        </td>
        <td className="py-2 pr-3 align-top text-xs text-slate-500">
          <input
            value={c.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="email"
            className="text-xs bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 w-44"
          />
          <input
            value={c.phone}
            onChange={(e) => onChange({ phone: e.target.value })}
            placeholder="phone"
            className="text-xs bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 w-32 mt-0.5"
          />
        </td>
        <td className="py-2 pr-3 align-top">
          <div className="flex items-center gap-2 flex-wrap">
            {c.resume_url ? (
              <button
                type="button"
                onClick={handleOpenResume}
                title={c.resume_filename || 'View resume'}
                className="inline-flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 underline underline-offset-2"
              >
                <FileText size={12} /> Resume
              </button>
            ) : (
              <label className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 cursor-pointer">
                <Upload size={12} />
                {uploading ? 'Uploading…' : 'Upload CV'}
                <input
                  type="file"
                  accept=".pdf,.txt,application/pdf,text/plain"
                  className="hidden"
                  onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
                  disabled={uploading || parsing}
                />
              </label>
            )}
            {c.linkedin_url ? (
              <a
                href={c.linkedin_url}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:text-sky-800 underline underline-offset-2"
                title={c.linkedin_url}
              >
                <Linkedin size={12} /> LinkedIn
              </a>
            ) : null}
          </div>
        </td>
        <td className="py-2 pr-3 text-right align-top">
          <button
            type="button"
            onClick={() => { if (confirm(`Delete ${c.name}?`)) onRemove(); }}
            className="text-red-500 hover:text-red-700"
            title="Delete candidate"
          >
            <Trash2 size={14} />
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-slate-50/50">
          <td colSpan={10} className="px-3 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* LinkedIn + location + resume controls */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Location</div>
                <input
                  value={c.location ?? ''}
                  onChange={(e) => onChange({ location: e.target.value || undefined })}
                  placeholder="e.g. Bangalore, India"
                  list="candidate-location-options"
                  className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />

                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 mt-3">LinkedIn URL</div>
                <input
                  value={c.linkedin_url ?? ''}
                  onChange={(e) => onChange({ linkedin_url: e.target.value.trim() || undefined })}
                  placeholder="https://linkedin.com/in/jane-doe"
                  className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                {c.linkedin_url && (
                  <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer"
                     className="mt-1 inline-flex items-center gap-1 text-[11px] text-sky-600 hover:underline">
                    <ExternalLink size={11} /> Open profile
                  </a>
                )}

                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1 mt-3">Resume / CV</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="inline-flex items-center gap-1 text-xs bg-white border border-slate-300 rounded-md px-2.5 py-1.5 hover:bg-slate-100 cursor-pointer">
                    <Upload size={12} />
                    {c.resume_url ? 'Replace file' : 'Upload PDF or .txt'}
                    <input
                      type="file"
                      accept=".pdf,.txt,application/pdf,text/plain"
                      className="hidden"
                      onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
                      disabled={uploading || parsing}
                    />
                  </label>
                  {c.resume_url && (
                    <>
                      <button type="button" onClick={handleOpenResume}
                              className="text-xs inline-flex items-center gap-1 text-primary hover:underline">
                        <FileText size={12} /> {c.resume_filename || 'View resume'}
                      </button>
                      <button type="button" onClick={handleReparse}
                              disabled={parsing}
                              className="text-xs inline-flex items-center gap-1 bg-amber-100 text-amber-900 hover:bg-amber-200 rounded-md px-2.5 py-1.5 disabled:opacity-50">
                        <Sparkles size={12} /> {parsing ? 'Parsing…' : (c.parsed_at ? 'Reparse' : 'Parse now')}
                      </button>
                    </>
                  )}
                </div>
                {c.resume_uploaded_at && (
                  <div className="text-[10px] text-slate-400 mt-1">
                    Uploaded {new Date(c.resume_uploaded_at).toLocaleString()}
                  </div>
                )}
                {error && (
                  <div className="text-[11px] text-red-600 mt-1">{error}</div>
                )}
              </div>

              {/* Skills */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Skills {c.parsed_at && <span className="text-slate-400 normal-case">· parsed {new Date(c.parsed_at).toLocaleDateString()}</span>}
                </div>
                {(c.skills && c.skills.length > 0) ? (
                  <div className="flex flex-wrap gap-1.5">
                    {c.skills.map((s) => (
                      <span key={s} className="text-[11px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">{s}</span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400 italic">
                    {c.resume_url ? 'No skills extracted yet — click Parse now.' : 'Upload a resume to auto-extract skills.'}
                  </div>
                )}
              </div>

              {/* Summary */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Profile summary</div>
                {c.profile_summary ? (
                  <p className="text-xs text-slate-700 leading-relaxed">{c.profile_summary}</p>
                ) : (
                  <div className="text-[11px] text-slate-400 italic">
                    {c.resume_url ? 'No summary yet — click Parse now.' : 'Upload a resume to auto-generate a summary.'}
                  </div>
                )}
              </div>

              {/* Availability + Expected salary (always shown) */}
              <div className="lg:col-span-3 border-t border-slate-200 pt-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Open to</div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {(['full_time', 'contracting'] as AvailabilityKind[]).map((kind) => {
                      const checked = (c.availability ?? []).includes(kind);
                      return (
                        <label
                          key={kind}
                          className={`cursor-pointer text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                            checked
                              ? 'bg-primary text-white border-primary'
                              : 'bg-white text-slate-600 border-slate-300 hover:border-primary hover:text-primary'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="hidden"
                            checked={checked}
                            onChange={() => {
                              const cur = c.availability ?? [];
                              const next = checked ? cur.filter((x) => x !== kind) : [...cur, kind];
                              onChange({ availability: next });
                            }}
                          />
                          {AVAILABILITY_LABELS[kind]}
                        </label>
                      );
                    })}
                  </div>
                  {(!c.availability || c.availability.length === 0) && (
                    <p className="text-[10px] text-slate-400 italic mt-1">Not specified.</p>
                  )}
                </div>

                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Expected salary</div>
                  <div className="relative">
                    <IndianRupee size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={c.expected_salary ?? ''}
                      onChange={(e) => onChange({ expected_salary: e.target.value || undefined })}
                      placeholder="e.g. 12-14 LPA, $60/hr, Negotiable"
                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">Free-text — annual, hourly, or range.</p>
                </div>

                {/* Referrer info — shown only when this is a referral (source='Referral'
                    OR referrer fields already populated). */}
                {(c.source === 'Referral' || c.referrer_email || c.referrer_name) && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 mb-1 flex items-center gap-1">
                      <UserPlus size={11} /> Referred by
                    </div>
                    <input
                      value={c.referrer_email ?? ''}
                      onChange={(e) => onChange({ referrer_email: e.target.value.trim().toLowerCase() || undefined })}
                      placeholder="employee@simpliigence.com"
                      className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 mb-1"
                    />
                    <input
                      value={c.referrer_name ?? ''}
                      onChange={(e) => onChange({ referrer_name: e.target.value || undefined })}
                      placeholder="Referrer display name (optional)"
                      className="w-full border border-slate-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 mb-1"
                    />
                    {c.referred_at && (
                      <p className="text-[10px] text-slate-400">
                        Referred {new Date(c.referred_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

type BulkRowStatus = 'pending' | 'uploading' | 'parsing' | 'done' | 'failed';
interface BulkRow {
  filename: string;
  status: BulkRowStatus;
  name?: string;
  email?: string;
  error?: string;
}

/* ── Bulk resume import dialog ──
 *
 * Drag-drop N PDFs/.txt files. Pick a requisition (FK) and owning TA. Each file:
 *   1. addCandidate({...}) creates a row with a placeholder name (the filename)
 *   2. uploadCandidateResume uploads the file to storage
 *   3. parseCandidateResume fires the edge function — Claude extracts identity
 *      + skills + summary and writes back into the row (only filling blanks).
 * Realtime broadcasts the update so the new candidate appears in the table.
 */
/** How many resume parses can run concurrently. Anthropic rate limits + the
 *  edge-function cold-start budget put a soft ceiling around 6–8. */
const BULK_CONCURRENCY = 6;
/** Rough per-resume cost (USD) used for the live estimate. ~$3/MTok input on
 *  Sonnet 4.5 × ~5k tokens + ~700 output tokens. Prompt caching pulls actual
 *  cost down ~30–40% after the first call lands. */
const COST_PER_RESUME_USD = 0.025;

function BulkImportDialog({ requisitions, accountName, defaultOwner, onClose }: {
  requisitions: { id: string; title: string; account_id: string }[];
  accountName: (rid: string) => string;
  defaultOwner: string;
  onClose: () => void;
}) {
  const { addCandidate, updateCandidate } = useStaffingStore();
  const [requisitionId, setRequisitionId] = useState('');
  const [owner, setOwner] = useState(defaultOwner);
  const [source, setSource] = useState('LinkedIn');
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<BulkRow[]>([]);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  /** Tick once a second while running so the elapsed / ETA labels stay live.
   *  We don't read `tick` directly — its only job is to force a re-render. */
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const canStart = files.length > 0 && !running;

  const handleDrop = (incoming: FileList | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming).filter((f) => /\.(pdf|txt)$/i.test(f.name));
    if (arr.length === 0) return;
    setFiles((prev) => [...prev, ...arr]);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const processOne = async (idx: number, file: File, updateRow: (patch: Partial<BulkRow>) => void) => {
    try {
      updateRow({ status: 'uploading' });
      const placeholder = file.name.replace(/\.(pdf|txt)$/i, '');
      const created = addCandidate({
        requisition_id: requisitionId || '',
        name: placeholder,
        experience: '',
        stage: 'Submitted',
        submit_date: new Date().toISOString().slice(0, 10),
        feedback: '',
        source,
        email: '',
        phone: '',
        owning_ta_email: owner || undefined,
      });

      const up = await db.uploadCandidateResume(created.id, file);
      if ('error' in up) {
        updateRow({ status: 'failed', error: `Upload failed: ${up.error}` });
        return;
      }
      updateCandidate(created.id, {
        resume_url: up.path,
        resume_filename: up.filename,
        resume_uploaded_at: new Date().toISOString(),
      });

      updateRow({ status: 'parsing' });
      const parsed = await db.parseCandidateResume(created.id);
      if (!parsed.ok) {
        updateRow({ status: 'failed', error: parsed.error });
        return;
      }
      const patch: Partial<StaffingCandidate> = {
        skills: parsed.skills,
        profile_summary: parsed.summary,
        parsed_at: parsed.parsedAt,
      };
      if (parsed.fullName) patch.name = parsed.fullName;
      if (parsed.email) patch.email = parsed.email;
      if (parsed.phone) patch.phone = parsed.phone;
      if (parsed.linkedinUrl) patch.linkedin_url = parsed.linkedinUrl;
      if (parsed.currentTitle) patch.experience = parsed.currentTitle;
      updateCandidate(created.id, patch);

      updateRow({ status: 'done', name: parsed.fullName || placeholder, email: parsed.email });
    } catch (e) {
      updateRow({ status: 'failed', error: (e as Error).message });
    }
    void idx; // silence unused-var lint (idx used by closure caller)
  };

  const start = async () => {
    if (!canStart) return;
    setRunning(true);
    setStartedAt(Date.now());
    const initial: BulkRow[] = files.map((f) => ({ filename: f.name, status: 'pending' }));
    setResults(initial);

    // Worker-pool pattern: BULK_CONCURRENCY parallel workers pull from a shared queue.
    // Wall-clock ≈ ceil(N / concurrency) × per-resume time.
    let next = 0;
    const total = files.length;
    const claim = () => {
      const i = next;
      next += 1;
      return i < total ? i : -1;
    };
    const updateRow = (idx: number, patch: Partial<BulkRow>) => {
      setResults((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
    };

    const worker = async () => {
      while (true) {
        const idx = claim();
        if (idx < 0) return;
        // eslint-disable-next-line no-await-in-loop
        await processOne(idx, files[idx], (patch) => updateRow(idx, patch));
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(BULK_CONCURRENCY, total) }, () => worker()),
    );
    setRunning(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={running ? undefined : onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-800">Bulk import resumes</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Drop multiple PDFs or .txt files — each one is parsed and creates a candidate row.</div>
          </div>
          <button onClick={onClose} disabled={running} className="text-slate-400 hover:text-slate-700 text-xl leading-none disabled:opacity-40">×</button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Settings applied to every imported candidate */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Requisition (optional)</label>
              <select
                value={requisitionId}
                onChange={(e) => setRequisitionId(e.target.value)}
                disabled={running}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white disabled:bg-slate-50"
              >
                <option value="">Unassigned (attach later)</option>
                {requisitions.map((r) => (
                  <option key={r.id} value={r.id}>{r.title} — {accountName(r.id)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Owning TA</label>
              <input
                value={owner}
                onChange={(e) => setOwner(e.target.value.toLowerCase())}
                disabled={running}
                placeholder="ta@simpliigence.com"
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Source</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                disabled={running}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white disabled:bg-slate-50"
              >
                {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Drop zone */}
          {!running && results.length === 0 && (
            <label
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(e.dataTransfer.files); }}
              className="block border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:bg-slate-50 hover:border-primary/50"
            >
              <UploadCloud size={28} className="text-slate-400 mx-auto mb-2" />
              <div className="text-sm text-slate-700 font-medium">Drop PDFs / .txt files here</div>
              <div className="text-[11px] text-slate-500 mt-1">or click to pick — you can add many at once</div>
              <input
                type="file"
                multiple
                accept=".pdf,.txt,application/pdf,text/plain"
                className="hidden"
                onChange={(e) => handleDrop(e.target.files)}
              />
            </label>
          )}

          {/* Live progress bar (while running or after a run) */}
          {results.length > 0 && (() => {
            const total = results.length;
            const done = results.filter((r) => r.status === 'done').length;
            const failed = results.filter((r) => r.status === 'failed').length;
            const completed = done + failed;
            const inFlight = results.filter((r) => r.status === 'uploading' || r.status === 'parsing').length;
            const pct = Math.round((completed / total) * 100);
            const elapsedMs = startedAt ? Date.now() - startedAt : 0;
            const fmt = (ms: number) => {
              const s = Math.floor(ms / 1000);
              const m = Math.floor(s / 60);
              return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
            };
            const avgPerItemMs = completed > 0 ? elapsedMs / completed : 0;
            const remaining = total - completed;
            // With BULK_CONCURRENCY in flight, remaining wall-clock ≈
            //   ceil(remaining / concurrency) × avg-per-item
            const etaMs = avgPerItemMs > 0 && remaining > 0
              ? Math.ceil(remaining / BULK_CONCURRENCY) * avgPerItemMs
              : 0;
            const costSoFar = done * COST_PER_RESUME_USD;
            const costRemaining = remaining * COST_PER_RESUME_USD;
            return (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-600">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">
                      {completed} of {total}
                    </span>
                    <span>·</span>
                    <span className="text-emerald-700">{done} parsed</span>
                    {failed > 0 && <><span>·</span><span className="text-red-700">{failed} failed</span></>}
                    {inFlight > 0 && <><span>·</span><span className="text-sky-700">{inFlight} in flight</span></>}
                  </div>
                  <div className="text-slate-500 tabular-nums">
                    {running ? <>elapsed {fmt(elapsedMs)}{etaMs > 0 && ` · ETA ~${fmt(etaMs)}`}</> : <>completed in {fmt(elapsedMs)}</>}
                  </div>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-[10px] text-slate-500 tabular-nums">
                  est. spent ${costSoFar.toFixed(2)}{remaining > 0 && ` · est. remaining $${costRemaining.toFixed(2)}`}
                  <span className="ml-1 text-slate-400">(prompt-cached calls run cheaper — these are upper bounds)</span>
                </div>
              </div>
            );
          })()}

          {/* File list / progress */}
          {(files.length > 0 || results.length > 0) && (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-600 flex items-center justify-between">
                <span>{(results.length || files.length)} file{(results.length || files.length) === 1 ? '' : 's'}</span>
                {!running && results.length === 0 && (
                  <button onClick={() => setFiles([])} className="text-[11px] text-slate-400 hover:text-slate-700">Clear all</button>
                )}
              </div>
              <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {(results.length > 0
                  ? results
                  : files.map<BulkRow>((f) => ({ filename: f.name, status: 'pending' }))
                ).map((r, idx) => (
                  <li key={idx} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <StatusIcon status={r.status} />
                      <div className="min-w-0">
                        <div className="text-slate-900 truncate" title={r.filename}>{r.filename}</div>
                        {('name' in r && r.name) && (
                          <div className="text-[11px] text-slate-600 truncate">
                            → {r.name}{r.email ? ` · ${r.email}` : ''}
                          </div>
                        )}
                        {('error' in r && r.error) && (
                          <div className="text-[11px] text-red-700 italic truncate" title={r.error}>{r.error}</div>
                        )}
                      </div>
                    </div>
                    {results.length === 0 && (
                      <button onClick={() => removeFile(idx)} className="text-slate-400 hover:text-red-700" title="Remove">
                        <X size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="text-[11px] text-slate-500">
            {results.length > 0 && !running && (
              <>
                <strong className="text-emerald-700">{results.filter((r) => r.status === 'done').length} created</strong>
                {results.some((r) => r.status === 'failed') && (
                  <span className="ml-2 text-red-700">· {results.filter((r) => r.status === 'failed').length} failed</span>
                )}
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={running}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-2 disabled:opacity-40"
            >
              {results.length > 0 && !running ? 'Close' : 'Cancel'}
            </button>
            {results.length === 0 ? (
              <button
                onClick={start}
                disabled={!canStart}
                className="text-xs font-semibold bg-primary text-white px-4 py-2 rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
              >
                <Sparkles size={12} /> Parse {files.length || ''} file{files.length === 1 ? '' : 's'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: 'pending' | 'uploading' | 'parsing' | 'done' | 'failed' }) {
  if (status === 'pending')  return <FileText size={14} className="text-slate-400 flex-shrink-0" />;
  if (status === 'uploading') return <Loader2 size={14} className="text-sky-500 animate-spin flex-shrink-0" />;
  if (status === 'parsing')  return <Loader2 size={14} className="text-amber-500 animate-spin flex-shrink-0" />;
  if (status === 'done')     return <CheckCircle size={14} className="text-emerald-600 flex-shrink-0" />;
  return <AlertCircle size={14} className="text-red-600 flex-shrink-0" />;
}

/* ── Add referral dialog ──
 *  Quick way for a TA (or admin) to capture an employee referral. Creates a
 *  candidate row with source='Referral' + referrer fields populated.
 */
function AddReferralDialog({ requisitions, accountName, defaultOwner, onClose, onSubmit }: {
  requisitions: { id: string; title: string; account_id: string }[];
  accountName: (rid: string) => string;
  defaultOwner: string;
  onClose: () => void;
  onSubmit: (input: Omit<StaffingCandidate, 'id' | 'created_at' | 'updated_at'>) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [requisitionId, setRequisitionId] = useState('');
  const [referrerEmail, setReferrerEmail] = useState('');
  const [referrerName, setReferrerName] = useState('');
  const [expectedSalary, setExpectedSalary] = useState('');
  const [availability, setAvailability] = useState<AvailabilityKind[]>(['full_time']);
  const [notes, setNotes] = useState('');

  const canSubmit = name.trim() && referrerEmail.trim();

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      requisition_id: requisitionId || '',
      name: name.trim(),
      experience: '',
      stage: 'Submitted',
      submit_date: new Date().toISOString().slice(0, 10),
      feedback: notes.trim(),
      source: 'Referral',
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      owning_ta_email: defaultOwner || undefined,
      linkedin_url: linkedinUrl.trim() || undefined,
      referrer_email: referrerEmail.trim().toLowerCase(),
      referrer_name: referrerName.trim() || undefined,
      referred_at: new Date().toISOString().slice(0, 10),
      availability,
      expected_salary: expectedSalary.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
              <UserPlus size={14} className="text-emerald-600" /> Add employee referral
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Capture a candidate referred by a Simpliigence employee.</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Referrer */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-2">Referred by</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Employee email *</label>
                <input
                  value={referrerEmail}
                  onChange={(e) => setReferrerEmail(e.target.value)}
                  placeholder="employee@simpliigence.com"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Display name</label>
                <input
                  value={referrerName}
                  onChange={(e) => setReferrerName(e.target.value)}
                  placeholder="Optional"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                />
              </div>
            </div>
          </div>

          {/* Candidate */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-2">Candidate</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Name *</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@example.com"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 …"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">LinkedIn URL</label>
                <input
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/…"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>
          </div>

          {/* Fit details */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-700 mb-2">Fit details</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Requisition (optional)</label>
                <select
                  value={requisitionId}
                  onChange={(e) => setRequisitionId(e.target.value)}
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
                >
                  <option value="">Unassigned (attach later)</option>
                  {requisitions.map((r) => (
                    <option key={r.id} value={r.id}>{r.title} — {accountName(r.id)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Expected salary</label>
                <input
                  value={expectedSalary}
                  onChange={(e) => setExpectedSalary(e.target.value)}
                  placeholder="e.g. 12-14 LPA, $60/hr"
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Open to</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {(['full_time', 'contracting'] as AvailabilityKind[]).map((kind) => {
                    const checked = availability.includes(kind);
                    return (
                      <label
                        key={kind}
                        className={`cursor-pointer text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                          checked
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-slate-600 border-slate-300 hover:border-primary hover:text-primary'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="hidden"
                          checked={checked}
                          onChange={() => {
                            setAvailability((cur) =>
                              checked ? cur.filter((x) => x !== kind) : [...cur, kind],
                            );
                          }}
                        />
                        {AVAILABILITY_LABELS[kind]}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Notes</label>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Why this candidate? Notable strengths, recent role, etc."
                  className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50">
          <button
            onClick={onClose}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-2"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="text-xs font-semibold bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
          >
            <UserPlus size={12} /> Submit referral
          </button>
        </div>
      </div>
    </div>
  );
}
