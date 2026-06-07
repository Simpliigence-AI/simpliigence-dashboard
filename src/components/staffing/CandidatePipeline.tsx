/**
 * Candidate pipeline sub-section rendered inside a requisition's expanded row.
 *
 * Lists candidates currently associated with this requisition, with inline-
 * editable stage / feedback. The "Add candidate" button opens a picker that
 * lets you associate any candidate already in the Candidates tab with this
 * requisition — clicking a candidate sets their `requisition_id` to the
 * current req. To create a brand-new candidate, the user must first add them
 * on the Candidates page (where resume upload + parsing happens) — this
 * guarantees every candidate that ends up on a req exists in the database
 * with full metadata.
 */
import { useMemo, useState } from 'react';
import { UserPlus, Trash2, Mail, Phone, X, Users as UsersIcon, TrendingUp, Search, ExternalLink, FileText, Linkedin } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  CANDIDATE_STAGES,
  ACTIVE_CANDIDATE_STAGES,
  CANDIDATE_STAGE_COLORS,
  type StaffingCandidate,
  type CandidateStage,
} from '../../types/staffing';
import { useStaffingStore } from '../../store/useStaffingStore';

interface Props {
  requisitionId: string;
  /** Candidates currently associated with THIS requisition. */
  candidates: StaffingCandidate[];
  /** Kept for compatibility — picker uses onUpdate instead. */
  onAdd?: (c: Omit<StaffingCandidate, 'id' | 'created_at' | 'updated_at'>) => void;
  onUpdate: (id: string, patch: Partial<StaffingCandidate>) => void;
  onRemove: (id: string) => void;
}

export function CandidatePipeline({ requisitionId, candidates, onUpdate }: Props) {
  // onAdd / onRemove are kept in Props for parent compatibility but no
  // longer used here — the picker associates existing candidates via
  // onUpdate(id, { requisition_id }), and the trash button detaches via
  // onUpdate(id, { requisition_id: '' }) so the candidate row stays alive.
  const [showPicker, setShowPicker] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  /** All candidates known to the system, used by the picker. */
  const { candidates: allCandidates, requisitions: allReqs } = useStaffingStore();

  /** Mini-funnel: count candidates currently at each active stage. */
  const stageCounts = useMemo(() => {
    const counts: Partial<Record<CandidateStage, number>> = {};
    for (const c of candidates) counts[c.stage] = (counts[c.stage] || 0) + 1;
    return counts;
  }, [candidates]);

  const active = candidates.filter((c) => ACTIVE_CANDIDATE_STAGES.includes(c.stage));
  const inactive = candidates.filter((c) => !ACTIVE_CANDIDATE_STAGES.includes(c.stage));

  // ── Picker candidate list ──
  // Show every candidate NOT already on this req. Unassigned first, then ones
  // currently on a different req (with a hint of where they are).
  const pickerCandidates = useMemo(() => {
    const onThisReqIds = new Set(candidates.map((c) => c.id));
    const needle = pickerQuery.trim().toLowerCase();
    const reqTitleOf = (rid: string) => allReqs.find((r) => r.id === rid)?.title ?? null;
    return allCandidates
      .filter((c) => !onThisReqIds.has(c.id))
      .filter((c) => {
        if (!needle) return true;
        const skillsStr = Array.isArray(c.skills) ? c.skills.join(' ') : '';
        const hay = `${c.name} ${c.email ?? ''} ${c.phone ?? ''} ${c.source ?? ''} ${skillsStr} ${c.profile_summary ?? ''} ${c.location ?? ''}`.toLowerCase();
        return hay.includes(needle);
      })
      .map((c) => ({
        ...c,
        currentReqTitle: c.requisition_id ? reqTitleOf(c.requisition_id) : null,
      }))
      .sort((a, b) => {
        // Unassigned (no req) first, then by name
        const ua = a.requisition_id ? 1 : 0;
        const ub = b.requisition_id ? 1 : 0;
        if (ua !== ub) return ua - ub;
        return a.name.localeCompare(b.name);
      });
  }, [allCandidates, candidates, allReqs, pickerQuery]);

  const associate = (c: StaffingCandidate) => {
    onUpdate(c.id, { requisition_id: requisitionId });
    // Optional UX: keep the picker open so the user can add multiple in a row.
  };

  return (
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <UsersIcon size={12} className="text-slate-400" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
            Candidates ({candidates.length})
            {active.length > 0 && <span className="ml-1 text-emerald-500">· {active.length} active</span>}
          </span>
        </div>
        <button
          onClick={() => { setShowPicker((v) => !v); setPickerQuery(''); }}
          className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:bg-primary/10 px-2 py-0.5 rounded transition-colors"
        >
          {showPicker ? <X size={11} /> : <UserPlus size={11} />}
          {showPicker ? 'Cancel' : 'Add Candidate'}
        </button>
      </div>

      {/* Mini pipeline strip — only when candidates exist */}
      {candidates.length > 0 && (
        <div className="flex gap-1 mb-2 flex-wrap">
          {CANDIDATE_STAGES.map((s) => {
            const count = stageCounts[s] || 0;
            if (count === 0) return null;
            return (
              <span
                key={s}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold text-white"
                style={{ background: CANDIDATE_STAGE_COLORS[s] }}
                title={`${count} candidate${count > 1 ? 's' : ''} at ${s}`}
              >
                {s} <span className="bg-white/25 rounded px-1">{count}</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Picker — pick from existing candidates */}
      {showPicker && (
        <div className="mb-3 p-3 rounded-lg border border-blue-200 bg-blue-50/40">
          <div className="text-[11px] text-slate-700 mb-2">
            Pick an existing candidate to add to this requisition. Don't see them?{' '}
            <Link
              to="/candidates"
              target="_blank"
              className="text-primary font-semibold hover:underline inline-flex items-center gap-0.5"
            >
              Add them in Candidates tab <ExternalLink size={10} />
            </Link>
          </div>
          <div className="relative mb-2">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Search name / email / skill / location…"
              className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          {pickerCandidates.length === 0 ? (
            <div className="text-xs text-slate-500 italic py-3 text-center">
              {allCandidates.length === 0 ? (
                <>No candidates in the database yet. <Link to="/candidates" target="_blank" className="text-primary font-semibold hover:underline">Add one in Candidates tab</Link>.</>
              ) : pickerQuery ? (
                <>No candidates match "<strong>{pickerQuery}</strong>".</>
              ) : (
                <>All candidates in the database are already on this requisition.</>
              )}
            </div>
          ) : (
            <ul className="max-h-72 overflow-y-auto -mx-1 px-1 divide-y divide-slate-100">
              {pickerCandidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => associate(c)}
                    className="w-full text-left px-2 py-1.5 hover:bg-white rounded transition-colors flex items-start gap-2"
                    title="Click to associate this candidate with the requisition"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-slate-900">{c.name}</span>
                        {c.experience && <span className="text-[10px] text-slate-500">{c.experience}</span>}
                        {c.location && <span className="text-[10px] text-slate-400">· {c.location}</span>}
                        {c.currentReqTitle ? (
                          <span className="text-[10px] text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full" title="Currently on another req — clicking moves them">
                            on: {c.currentReqTitle}
                          </span>
                        ) : (
                          <span className="text-[10px] text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded-full">
                            unassigned
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-[10px] text-slate-500 mt-0.5">
                        {c.email && <span className="inline-flex items-center gap-0.5"><Mail size={9} /> {c.email}</span>}
                        {c.phone && <span className="inline-flex items-center gap-0.5"><Phone size={9} /> {c.phone}</span>}
                        {c.linkedin_url && <span className="inline-flex items-center gap-0.5"><Linkedin size={9} /> LinkedIn</span>}
                        {c.resume_url && <span className="inline-flex items-center gap-0.5"><FileText size={9} /> Resume</span>}
                        {c.source && <span>· {c.source}</span>}
                      </div>
                      {Array.isArray(c.skills) && c.skills.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.skills.slice(0, 6).map((s: string) => (
                            <span key={s} className="text-[9px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-full whitespace-nowrap">{s}</span>
                          ))}
                          {c.skills.length > 6 && (
                            <span className="text-[9px] text-slate-400">+{c.skills.length - 6}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] font-semibold text-primary self-center flex-shrink-0">
                      + Associate
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Empty state */}
      {candidates.length === 0 && !showPicker && (
        <p className="text-xs text-slate-400 italic py-2">
          No candidates tracked yet. Click <strong>Add Candidate</strong> to pick from the Candidates database.
        </p>
      )}

      {/* Candidate list — active first */}
      {candidates.length > 0 && (
        <div className="space-y-1.5">
          {[...active, ...inactive].map((c) => {
            const isEditing = editingId === c.id;
            const isArchived = !ACTIVE_CANDIDATE_STAGES.includes(c.stage);
            return (
              <div
                key={c.id}
                className={`group flex items-start gap-2 p-2 rounded-lg border transition-all ${
                  isArchived ? 'border-slate-200 bg-slate-50/50 opacity-70' : 'border-slate-200 bg-white hover:border-blue-200 hover:shadow-sm'
                }`}
              >
                {/* Stage pill */}
                <select
                  value={c.stage}
                  onChange={(e) => onUpdate(c.id, { stage: e.target.value as CandidateStage })}
                  className="text-[10px] font-bold text-white rounded px-1.5 py-0.5 border-0 cursor-pointer flex-shrink-0"
                  style={{ background: CANDIDATE_STAGE_COLORS[c.stage] }}
                  title="Click to change stage"
                >
                  {CANDIDATE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {isEditing ? (
                      <input
                        value={c.name}
                        onChange={(e) => onUpdate(c.id, { name: e.target.value })}
                        onBlur={() => setEditingId(null)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setEditingId(null); }}
                        autoFocus
                        className="text-xs font-bold px-1 py-0 border border-blue-300 rounded bg-blue-50"
                      />
                    ) : (
                      <span
                        onClick={() => setEditingId(c.id)}
                        className="text-xs font-bold text-slate-800 cursor-pointer hover:text-primary"
                      >
                        {c.name}
                      </span>
                    )}
                    {c.experience && <span className="text-[10px] text-slate-500">{c.experience}</span>}
                    {c.submit_date && <span className="text-[10px] text-slate-400">· submitted {c.submit_date}</span>}
                    {c.source && <span className="text-[10px] text-slate-400">· {c.source}</span>}
                    {c.email && (
                      <a href={`mailto:${c.email}`} className="text-[10px] text-blue-500 hover:underline inline-flex items-center gap-0.5">
                        <Mail size={9} /> {c.email}
                      </a>
                    )}
                    {c.phone && (
                      <span className="text-[10px] text-slate-500 inline-flex items-center gap-0.5">
                        <Phone size={9} /> {c.phone}
                      </span>
                    )}
                  </div>
                  {/* Feedback — inline editable */}
                  <input
                    value={c.feedback}
                    onChange={(e) => onUpdate(c.id, { feedback: e.target.value })}
                    placeholder="Add feedback / interview notes..."
                    className="mt-1 w-full px-1.5 py-0.5 text-[11px] text-slate-600 border border-transparent rounded focus:outline-none focus:border-blue-300 focus:bg-blue-50 hover:border-slate-200"
                  />
                </div>

                <button
                  onClick={() => {
                    if (confirm(`Remove "${c.name}" from this requisition? The candidate will stay in the Candidates database — just no longer associated with this req.`)) {
                      // Detach from this req (not delete). The candidate row stays
                      // in india_staffing_candidates so they can be reassociated
                      // to a different req later via the picker.
                      onUpdate(c.id, { requisition_id: '' });
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all flex-shrink-0"
                  title="Detach from requisition (candidate stays in database)"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Tiny conversion hint — only when we have data */}
      {candidates.length >= 3 && (() => {
        const selected = candidates.filter((c) => ['Selected', 'Offer Extended', 'Offer Accepted', 'Joined'].includes(c.stage)).length;
        const rate = Math.round((selected / candidates.length) * 100);
        return (
          <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
            <TrendingUp size={10} />
            Conversion: <span className="font-bold text-slate-600">{selected}</span> of <span className="font-bold">{candidates.length}</span> selected ({rate}%)
          </div>
        );
      })()}
    </div>
  );
}
