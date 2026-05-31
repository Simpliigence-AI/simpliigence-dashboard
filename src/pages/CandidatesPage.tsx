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
import { useMemo, useState } from 'react';
import { Plus, Trash2, Save, X, Upload, Sparkles, FileText, ExternalLink, ChevronDown, ChevronRight, Linkedin, UploadCloud, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useAuthStore } from '../store/useAuthStore';
import { useStaffingStore } from '../store/useStaffingStore';
import { db } from '../lib/supabaseSync';
import {
  CANDIDATE_STAGES,
  CANDIDATE_STAGE_COLORS,
  type CandidateStage,
  type StaffingCandidate,
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
};

export default function CandidatesPage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { accounts, requisitions, candidates, addCandidate, updateCandidate, removeCandidate } = useStaffingStore();

  const [q, setQ] = useState('');
  const [filterReq, setFilterReq] = useState('');
  const [filterOwner, setFilterOwner] = useState('');
  const [filterStage, setFilterStage] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftCandidate>(emptyDraft);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const owners = useMemo(() => {
    const s = new Set<string>();
    candidates.forEach((c) => { if (c.owning_ta_email) s.add(c.owning_ta_email); });
    return Array.from(s).sort();
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
      if (filterReq === '__unassigned__') {
        if (c.requisition_id) return false;
      } else if (filterReq && c.requisition_id !== filterReq) {
        return false;
      }
      if (filterOwner && (c.owning_ta_email || '') !== filterOwner) return false;
      if (filterStage && c.stage !== filterStage) return false;
      if (needle) {
        const hay = `${c.name} ${c.email} ${c.phone} ${c.source} ${reqLabel(c.requisition_id)} ${(c.skills || []).join(' ')} ${c.profile_summary || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [candidates, q, filterReq, filterOwner, filterStage, requisitions, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <div className="flex items-center gap-2">
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

      {bulkOpen && (
        <BulkImportDialog
          requisitions={requisitions}
          accountName={accountName}
          defaultOwner={(currentUser?.email || '').toLowerCase()}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            placeholder="Search name / email / req / skill…"
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
            <input placeholder="LinkedIn URL (https://linkedin.com/in/…)" value={draft.linkedin_url}
                   onChange={(e) => setDraft({ ...draft, linkedin_url: e.target.value })}
                   className="border border-slate-300 rounded-md px-3 py-2 text-sm md:col-span-6" />
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

      {/* List */}
      <Card title={`${filtered.length} candidate${filtered.length === 1 ? '' : 's'}`}>
        {filtered.length === 0 ? (
          <div className="text-sm text-slate-500 text-center py-12">
            No candidates match. Use <strong>+ Add candidate</strong> to create one.
          </div>
        ) : (
          <div className="overflow-x-auto -mx-6 px-6">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-3 font-semibold w-6"></th>
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Requisition</th>
                  <th className="py-2 pr-3 font-semibold">Stage</th>
                  <th className="py-2 pr-3 font-semibold">Source</th>
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
        )}
      </Card>
    </div>
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
          <input
            value={c.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="w-full text-sm font-medium text-slate-900 bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
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
          <td colSpan={9} className="px-3 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* LinkedIn + resume controls */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">LinkedIn URL</div>
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

  const start = async () => {
    if (!canStart) return;
    setRunning(true);
    const initial: BulkRow[] = files.map((f) => ({ filename: f.name, status: 'pending' }));
    setResults(initial);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const updateRow = (patch: Partial<BulkRow>) => {
        setResults((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
      };
      try {
        updateRow({ status: 'uploading' });
        // 1. Create candidate row with placeholder name (the filename minus ext).
        // Requisition is optional — if not picked, the candidate row is created
        // unassigned and a TA can attach it to a req later from the table.
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

        // 2. Upload the file
        const up = await db.uploadCandidateResume(created.id, file);
        if ('error' in up) {
          updateRow({ status: 'failed', error: `Upload failed: ${up.error}` });
          continue;
        }
        updateCandidate(created.id, {
          resume_url: up.path,
          resume_filename: up.filename,
          resume_uploaded_at: new Date().toISOString(),
        });

        // 3. Parse via edge fn — it writes name/email/etc. into the row server-side
        updateRow({ status: 'parsing' });
        const parsed = await db.parseCandidateResume(created.id);
        if (!parsed.ok) {
          updateRow({ status: 'failed', error: parsed.error });
          continue;
        }
        // Mirror server-side write into our local store so the table updates instantly
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

        updateRow({
          status: 'done',
          name: parsed.fullName || placeholder,
          email: parsed.email,
        });
      } catch (e) {
        updateRow({ status: 'failed', error: (e as Error).message });
      }
    }
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
