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
import { Plus, Trash2, Save, X, Upload, Sparkles, FileText, ExternalLink, ChevronDown, ChevronRight, Linkedin, UploadCloud, CheckCircle, AlertCircle, Loader2, UserPlus, IndianRupee, PhoneOutgoing, PhoneCall } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useAuthStore } from '../store/useAuthStore';
import { useStaffingStore } from '../store/useStaffingStore';
import { useCallsStore } from '../store/useCallsStore';
import { db } from '../lib/supabaseSync';
import { ACTIVE_CALL_STATUSES } from '../types/candidateCalls';
import type { CallTemplate, CandidateCall } from '../types/candidateCalls';
import { TaIdentity } from '../components/TaIdentity';
import { CandidateMapView } from './candidates/CandidateMapView';
import {
  CANDIDATE_STAGES,
  CANDIDATE_STAGE_COLORS,
  ACTIVE_CANDIDATE_STAGES,
  AVAILABILITY_LABELS,
  type CandidateStage,
  type StaffingCandidate,
  type StaffingRequisition,
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
  // When set, render a modal overlay with the full detail for this candidate.
  // Used by the cards view so clicking a card doesn't kick you out into the
  // table view + scroll-find-your-row dance.
  const [detailCandidateId, setDetailCandidateId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table' | 'map'>('cards');
  // Cap the number of rendered cards/rows so we don't blow up the main thread
  // when there are ~5k candidates. "Load more" doubles the window. Resets to
  // the default whenever a filter changes (handled with a useEffect below).
  const PAGE_SIZE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

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

  // O(1) lookups for the filter haystack — used to be requisitions.find() +
  // accounts.find() per-candidate, which at 4,800 candidates × 100 reqs × 20
  // accounts froze the page on every keystroke and on initial mount.
  const reqById = useMemo(() => {
    const m = new Map<string, StaffingRequisition>();
    for (const r of requisitions) m.set(r.id, r);
    return m;
  }, [requisitions]);
  const accountById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.name);
    return m;
  }, [accounts]);

  const accountName = (rid: string) => {
    const req = reqById.get(rid);
    if (!req) return '—';
    return accountById.get(req.account_id) ?? '—';
  };
  const reqLabel = (rid: string) => {
    const req = reqById.get(rid);
    return req ? `${req.title} (${accountName(rid)})` : '—';
  };

  // Reset the visible-window when filters change so the user always starts
  // at the top of the (newly-narrowed) list instead of a phantom offset.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [q, filterReq, filterStage, filterLocation, filterOwner, aiMatchSet]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hasSearch = needle.length > 0;
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
      // Skip the (relatively expensive) haystack build when there is no
      // search query — saves ~5k string concatenations on initial mount.
      if (hasSearch) {
        const req = c.requisition_id ? reqById.get(c.requisition_id) : undefined;
        const reqStr = req ? `${req.title} ${accountById.get(req.account_id) ?? ''}` : '';
        const hay = `${c.name} ${c.email} ${c.phone} ${c.source} ${reqStr} ${(c.skills || []).join(' ')} ${c.profile_summary || ''} ${c.location || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [candidates, q, filterReq, filterOwner, filterStage, filterLocation, reqById, accountById, aiMatchSet]);

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

      {detailCandidateId && (() => {
        const c = candidates.find((x) => x.id === detailCandidateId);
        if (!c) return null;
        return (
          <CandidateDetailModal
            candidate={c}
            requisitions={requisitions}
            accountName={accountName}
            onChange={(patch) => updateCandidate(c.id, patch)}
            onRemove={() => { removeCandidate(c.id); setDetailCandidateId(null); }}
            onClose={() => setDetailCandidateId(null)}
          />
        );
      })()}

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
          <button
            type="button"
            onClick={() => setViewMode('map')}
            className={`px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors ${
              viewMode === 'map' ? 'bg-primary text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Map view — candidates plotted on India by city"
          >
            <MapPin size={12} /> Map
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
      ) : viewMode === 'map' ? (
        <CandidateMapView candidates={filtered} />
      ) : viewMode === 'cards' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
            {filtered.slice(0, visibleCount).map((c) => (
              <CandidateCard
                key={c.id}
                c={c}
                requisitionLabel={reqLabel(c.requisition_id)}
                onOpen={() => setDetailCandidateId(c.id)}
              />
            ))}
          </div>
          <LoadMoreFooter shown={Math.min(visibleCount, filtered.length)} total={filtered.length} onMore={() => setVisibleCount((v) => v + PAGE_SIZE)} />
        </>
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
                {filtered.slice(0, visibleCount).map((c) => (
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
          <LoadMoreFooter shown={Math.min(visibleCount, filtered.length)} total={filtered.length} onMore={() => setVisibleCount((v) => v + PAGE_SIZE)} />
        </Card>
      )}
    </div>
  );
}

/** Modal overlay used when a candidate card is clicked. Reuses CandidateRow
 *  with expanded=true inside a wrapper table so we get the same form fields,
 *  skills, summary, and call history as the inline table-view expansion —
 *  without yanking the user out of the cards view. */
function CandidateDetailModal({ candidate, requisitions, accountName, onChange, onRemove, onClose }: {
  candidate: StaffingCandidate;
  requisitions: StaffingRequisition[];
  accountName: (rid: string) => string;
  onChange: (patch: Partial<StaffingCandidate>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4 md:p-8" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white rounded-t-xl">
          <div className="text-sm font-bold text-slate-900">{candidate.name || '(unnamed)'}</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xs font-semibold">
            ✕ Close
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <tbody>
              <CandidateRow
                c={candidate}
                requisitions={requisitions}
                accountName={accountName}
                expanded={true}
                onToggleExpand={onClose}
                onChange={onChange}
                onRemove={onRemove}
              />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Pagination footer used at the bottom of both cards & table views. Renders
 *  nothing when the full filtered set is already visible — the freeze we hit
 *  was caused by trying to render all 4,800 rows in one pass, so this caps
 *  the rendered window and asks the user to opt-in to more. */
function LoadMoreFooter({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div className="mt-4 flex flex-col items-center gap-1.5 py-3 text-xs">
      <div className="text-slate-500">Showing <span className="font-semibold text-slate-800">{shown.toLocaleString()}</span> of <span className="font-semibold text-slate-800">{total.toLocaleString()}</span></div>
      <button type="button" onClick={onMore}
              className="px-4 py-1.5 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold">
        Load more
      </button>
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
      className="text-left bg-white rounded-xl border border-slate-200/80 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 overflow-hidden group h-full flex flex-col"
    >
      {/* Top accent bar coloured by stage */}
      <div className="h-1 flex-shrink-0" style={{ backgroundColor: stageColor }} />

      <div className="p-4 flex flex-col flex-1 gap-3">
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
            <div className="flex items-baseline gap-2 min-w-0">
              <div className="text-sm font-bold text-slate-900 truncate group-hover:text-primary transition-colors">
                {c.name || '(unnamed)'}
              </div>
              {typeof c.years_of_experience === 'number' && c.years_of_experience > 0 && (
                <span
                  className="flex-shrink-0 text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded-md whitespace-nowrap"
                  title="Years of experience"
                >
                  {c.years_of_experience}y
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 truncate flex items-center gap-1">
              <Briefcase size={11} className="text-slate-400" />
              {titleLine}
            </div>
          </div>
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

        {/* Footer row: contact icons + actions — pinned to bottom so all cards align */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
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
          <OwnerCell email={c.owning_ta_email ?? ''} onChange={(v) => onChange({ owning_ta_email: v || undefined })} />
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
                  accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
            <CallControls candidate={c} />
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
        <tr className="bg-slate-50/60">
          <td colSpan={10} className="px-4 py-5">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-5">

              {/* — Header strip: summary as quote-style or empty-state — */}
              {c.profile_summary ? (
                <div className="border-l-4 border-primary/40 pl-4 py-1">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-2">
                    Profile summary
                    {c.parsed_at && (
                      <span className="text-[10px] text-slate-400 normal-case font-normal">
                        · parsed {new Date(c.parsed_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-800 leading-relaxed italic">"{c.profile_summary}"</p>
                </div>
              ) : (
                <div className="text-[12px] text-slate-400 italic border-l-4 border-slate-200 pl-4 py-1">
                  {c.resume_url
                    ? 'No summary yet — upload triggered parsing; click Reparse below if it stalled.'
                    : 'Upload a resume to auto-generate a profile summary + skills.'}
                </div>
              )}

              {/* — Skills row (full width) — */}
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Skills {c.skills && c.skills.length > 0 && (
                    <span className="text-slate-400 normal-case font-normal">· {c.skills.length}</span>
                  )}
                </div>
                {(c.skills && c.skills.length > 0) ? (
                  <div className="flex flex-wrap gap-1.5">
                    {c.skills.map((s) => (
                      <span key={s} className="text-[11px] bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full">{s}</span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400 italic">
                    {c.resume_url ? 'No skills extracted yet — click Reparse below.' : 'Upload a resume to auto-extract skills.'}
                  </div>
                )}
              </div>

              {/* — Two-column lower grid: Contact + Hiring details — */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* Contact column */}
                <section className="rounded-lg border border-slate-200 p-4 space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <Linkedin size={11} /> Contact + Resume
                  </h4>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Location</label>
                    <input
                      value={c.location ?? ''}
                      onChange={(e) => onChange({ location: e.target.value || undefined })}
                      placeholder="e.g. Bangalore, India"
                      list="candidate-location-options"
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">LinkedIn URL</label>
                    <input
                      value={c.linkedin_url ?? ''}
                      onChange={(e) => onChange({ linkedin_url: e.target.value.trim() || undefined })}
                      placeholder="https://linkedin.com/in/jane-doe"
                      className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    {c.linkedin_url && (
                      <a href={c.linkedin_url} target="_blank" rel="noopener noreferrer"
                         className="mt-1 inline-flex items-center gap-1 text-[11px] text-sky-600 hover:underline">
                        <ExternalLink size={11} /> Open profile
                      </a>
                    )}
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Resume / CV</label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <label className="inline-flex items-center gap-1 text-xs bg-white border border-slate-300 rounded-md px-2.5 py-1.5 hover:bg-slate-100 cursor-pointer">
                        <Upload size={12} />
                        {c.resume_url ? 'Replace' : 'Upload PDF / .txt'}
                        <input
                          type="file"
                          accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          className="hidden"
                          onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
                          disabled={uploading || parsing}
                        />
                      </label>
                      {c.resume_url && (
                        <>
                          <button type="button" onClick={handleOpenResume}
                                  className="text-xs inline-flex items-center gap-1 text-primary hover:underline">
                            <FileText size={12} /> {c.resume_filename || 'View'}
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
                    {(uploading || parsing) && (
                      <div className="text-[11px] text-sky-600 mt-1 inline-flex items-center gap-1">
                        <Loader2 size={11} className="animate-spin" /> {uploading ? 'Uploading…' : 'Parsing…'}
                      </div>
                    )}
                    {error && (
                      <div className="text-[11px] text-red-600 mt-1">{error}</div>
                    )}
                  </div>
                </section>

                {/* Hiring details column */}
                <section className="rounded-lg border border-slate-200 p-4 space-y-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                    <IndianRupee size={11} /> Hiring details
                  </h4>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">Open to</label>
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
                  </div>

                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Expected salary</label>
                    <div className="relative">
                      <IndianRupee size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={c.expected_salary ?? ''}
                        onChange={(e) => onChange({ expected_salary: e.target.value || undefined })}
                        placeholder="e.g. 12-14 LPA, $60/hr"
                        className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                  </div>

                  {(c.source === 'Referral' || c.referrer_email || c.referrer_name) && (
                    <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1.5 flex items-center gap-1">
                        <UserPlus size={11} /> Referred by
                      </div>
                      {c.referrer_email && (
                        <div className="mb-2 bg-white rounded-md border border-emerald-200 px-2.5 py-1.5">
                          <TaIdentity email={c.referrer_email} avatarSize={26} nameSize="text-xs" showEmail />
                        </div>
                      )}
                      <input
                        value={c.referrer_email ?? ''}
                        onChange={(e) => onChange({ referrer_email: e.target.value.trim().toLowerCase() || undefined })}
                        placeholder="employee@simpliigence.com"
                        className="w-full border border-emerald-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 mb-1 bg-white"
                      />
                      <input
                        value={c.referrer_name ?? ''}
                        onChange={(e) => onChange({ referrer_name: e.target.value || undefined })}
                        placeholder="Referrer name (optional)"
                        className="w-full border border-emerald-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300 bg-white"
                      />
                      {c.referred_at && (
                        <p className="text-[10px] text-slate-500 mt-1">
                          Referred on {new Date(c.referred_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  )}
                </section>
              </div>

              {/* AI call history + latest transcript */}
              <CallHistoryPanel candidateId={c.id} />

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
                accept=".pdf,.txt,.docx,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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

/** Inline owner cell — shows the assigned TA's name + avatar in display mode,
 *  becomes a typeable input when clicked. Hits Save on blur. */
function OwnerCell({ email, onChange }: { email: string; onChange: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(email);
  const directory = useAuthStore((s) => s.directory);
  const allEmails = Object.keys(directory);

  useEffect(() => { setDraft(email); }, [email]);

  if (editing) {
    return (
      <input
        autoFocus
        list="owner-cell-emails"
        value={draft}
        onChange={(e) => setDraft(e.target.value.toLowerCase())}
        onBlur={() => {
          setEditing(false);
          if (draft !== email) onChange(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setDraft(email); setEditing(false); }
        }}
        placeholder="ta@simpliigence.com"
        className="text-xs bg-white border border-slate-300 px-2 py-1 rounded focus:outline-none focus:ring-2 focus:ring-primary/40 w-44"
      />
    );
  }

  if (!email) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-[11px] text-slate-400 italic hover:text-slate-700 hover:bg-slate-50 rounded px-1.5 py-0.5"
      >
        Unassigned — assign…
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="hover:bg-slate-50 rounded px-1 py-0.5 -mx-1"
        title="Click to change"
      >
        <TaIdentity email={email} avatarSize={22} nameSize="text-xs" />
      </button>
      {/* Shared datalist for known TA emails — populated once per render */}
      <datalist id="owner-cell-emails">
        {allEmails.map((e) => <option key={e} value={e} />)}
      </datalist>
    </>
  );
}

/* ── Outbound AI calling ──
 *  CallControls — 📞 button + status pill on each candidate row.
 *  CallModal     — picks a template, confirms phone + consent, fires.
 *  CallHistoryPanel — transcript + extracted answers inside the row's
 *                    expanded detail.
 */

const CALL_STATUS_PILL: Record<CandidateCall['status'], { label: string; cls: string }> = {
  queued:        { label: 'Queued',      cls: 'bg-slate-100 text-slate-600' },
  dialing:       { label: 'Dialing…',    cls: 'bg-amber-100 text-amber-800' },
  ringing:       { label: 'Ringing…',    cls: 'bg-amber-100 text-amber-800' },
  'in-progress': { label: 'Talking',     cls: 'bg-sky-100 text-sky-800' },
  completed:     { label: 'Done',        cls: 'bg-emerald-100 text-emerald-800' },
  'no-answer':   { label: 'No answer',   cls: 'bg-slate-200 text-slate-700' },
  failed:        { label: 'Failed',      cls: 'bg-red-100 text-red-700' },
  cancelled:     { label: 'Cancelled',   cls: 'bg-slate-100 text-slate-500' },
};

function CallControls({ candidate }: { candidate: StaffingCandidate }) {
  // Subscribe to the raw `calls` array (stable reference unless it changes),
  // then derive the latest one for this candidate via useMemo. Avoids running
  // `.filter().sort()` inside the Zustand selector, which would return a new
  // value each call and (in combination with realtime store updates) was
  // suspected of the infinite-render bug on /candidates.
  const allCalls = useCallsStore((s) => s.calls);
  const latestCall = useMemo(() => {
    const matching = allCalls.filter((c) => c.candidateId === candidate.id);
    if (matching.length === 0) return undefined;
    return matching.reduce((acc, c) => (c.createdAt > acc.createdAt ? c : acc));
  }, [allCalls, candidate.id]);
  const templates = useCallsStore((s) => s.templates);
  const [modalOpen, setModalOpen] = useState(false);

  const isActive = !!latestCall && ACTIVE_CALL_STATUSES.includes(latestCall.status);
  const pill = latestCall ? CALL_STATUS_PILL[latestCall.status] : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        disabled={isActive || !candidate.phone}
        title={
          !candidate.phone
            ? 'Add a phone number on the candidate first'
            : isActive
              ? 'A call is already in progress — wait for it to finish'
              : 'Start an AI screening call to this candidate'
        }
        className="inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:text-emerald-900 underline underline-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isActive
          ? <Loader2 size={12} className="animate-spin" />
          : <PhoneOutgoing size={12} />}
        Call
      </button>
      {pill && (
        <span
          className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${pill.cls}`}
          title={`Last call: ${pill.label}${latestCall?.endedAt ? ' · ' + new Date(latestCall.endedAt).toLocaleString() : ''}`}
        >
          {pill.label}
        </span>
      )}
      {modalOpen && (
        <CallModal
          candidate={candidate}
          templates={templates.filter((t) => t.active)}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function CallModal({ candidate, templates, onClose }: {
  candidate: StaffingCandidate;
  templates: CallTemplate[];
  onClose: () => void;
}) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const startCall = useCallsStore((s) => s.startCall);
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? 'tmpl-india-v1');
  const [roleTitle, setRoleTitle] = useState('');
  const [phone, setPhone] = useState(candidate.phone || '');
  const [consent, setConsent] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tpl = templates.find((t) => t.id === templateId);
  const canStart = !!phone.trim() && consent && !starting;

  const handleStart = async () => {
    if (!canStart) return;
    setError(null);
    setStarting(true);
    try {
      const res = await startCall({
        candidateId: candidate.id,
        templateId,
        roleTitle: roleTitle.trim() || undefined,
        triggeredBy: currentUser?.email ?? undefined,
      });
      if (res.ok) onClose();
      else setError(res.error);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-800">📞 Call {candidate.name || 'candidate'}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Outbound AI screening via Vapi</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Template</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm bg-white"
            >
              {templates.length === 0 && <option value="tmpl-india-v1">India · Candidate Screening v1</option>}
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {tpl && (
              <p className="text-[10px] text-slate-500 mt-1">
                {tpl.questions.length} question{tpl.questions.length === 1 ? '' : 's'} · ~3–5 min call
              </p>
            )}
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Role title (optional)</label>
            <input
              type="text"
              value={roleTitle}
              onChange={(e) => setRoleTitle(e.target.value)}
              placeholder="e.g. Senior Salesforce Developer"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
            />
            <p className="text-[10px] text-slate-500 mt-1">Used in the AI's opening line.</p>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 …"
              className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm tabular-nums"
            />
            <p className="text-[10px] text-slate-500 mt-1">10-digit Indian numbers auto-prefix +91.</p>
          </div>
          <label className="flex items-start gap-2 text-[11px] text-slate-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I confirm the candidate consented to screening calls when they shared their resume / applied. The opening line will disclose this is an AI assistant and the call is being recorded.
            </span>
          </label>
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">{error}</div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-xs font-semibold text-slate-600 hover:text-slate-900 px-3 py-2">Cancel</button>
          <button
            onClick={handleStart}
            disabled={!canStart}
            className="text-xs font-semibold bg-emerald-600 text-white px-4 py-2 rounded-md hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
          >
            <PhoneCall size={12} /> {starting ? 'Dialing…' : 'Start call'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CallHistoryPanel({ candidateId }: { candidateId: string }) {
  // Same pattern as CallControls — subscribe to stable `calls`, filter via useMemo.
  const allCalls = useCallsStore((s) => s.calls);
  const calls = useMemo(
    () => allCalls.filter((c) => c.candidateId === candidateId),
    [allCalls, candidateId],
  );
  if (calls.length === 0) return null;
  const latest = [...calls].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  const pill = CALL_STATUS_PILL[latest.status];
  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Latest AI call</div>
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${pill.cls}`}>
          {pill.label}
        </span>
      </div>
      <div className="text-[11px] text-slate-500 mb-3">
        Triggered by <span className="font-medium">{latest.triggeredBy || '—'}</span>
        {latest.startedAt && ` · ${new Date(latest.startedAt).toLocaleString()}`}
        {latest.durationSec != null && ` · ${Math.round(latest.durationSec)}s`}
        {latest.costUsd != null && ` · $${latest.costUsd.toFixed(3)}`}
      </div>
      {latest.errorMsg && (
        <div className="text-[11px] text-red-700 mb-2 italic">{latest.errorMsg}</div>
      )}
      {latest.extractedAnswers && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {[
            ['Employer', latest.extractedAnswers.current_employer],
            ['Location', latest.extractedAnswers.current_location],
            ['Relocate?', latest.extractedAnswers.willing_to_relocate == null ? '' : (latest.extractedAnswers.willing_to_relocate ? 'Yes' : 'No')],
            ['Current CTC', latest.extractedAnswers.current_ctc_inr ? `₹${(latest.extractedAnswers.current_ctc_inr / 100000).toFixed(1)} LPA` : ''],
            ['Expected CTC', latest.extractedAnswers.expected_ctc_inr ? `₹${(latest.extractedAnswers.expected_ctc_inr / 100000).toFixed(1)} LPA` : ''],
            ['Notice', latest.extractedAnswers.notice_period_days != null ? `${latest.extractedAnswers.notice_period_days} days` : ''],
            ['Engagement', latest.extractedAnswers.engagement || ''],
          ].filter(([, v]) => v).map(([label, value]) => (
            <div key={label as string} className="bg-white rounded border border-slate-200 px-2 py-1.5">
              <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
              <div className="text-xs font-medium text-slate-900 mt-0.5">{value as string}</div>
            </div>
          ))}
        </div>
      )}
      {latest.extractedAnswers?.overall_summary && (
        <p className="text-xs text-slate-700 italic border-l-4 border-emerald-400 pl-3 mb-3">
          {latest.extractedAnswers.overall_summary}
        </p>
      )}
      {latest.transcript && (
        <details>
          <summary className="text-[11px] text-slate-500 cursor-pointer hover:text-slate-800">
            Show transcript ({latest.transcript.length.toLocaleString()} chars)
          </summary>
          <pre className="mt-2 text-[11px] text-slate-700 bg-white border border-slate-200 rounded p-3 max-h-72 overflow-y-auto whitespace-pre-wrap font-mono">{latest.transcript}</pre>
        </details>
      )}
      {latest.recordingUrl && (
        <div className="mt-2">
          <audio controls src={latest.recordingUrl} className="w-full h-8" />
        </div>
      )}
      {calls.length > 1 && (
        <div className="text-[10px] text-slate-400 mt-2">{calls.length} total calls to this candidate</div>
      )}
    </section>
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
