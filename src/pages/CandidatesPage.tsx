/**
 * Candidates — bulk CRUD for india_staffing_candidates.
 *
 * One row per candidate. Editable inline:
 *   - name, email, phone
 *   - requisition (FK), source, stage
 *   - owning TA (the email that drives My Day auto-population)
 *
 * Filters: text search, requisition, owning TA, stage.
 * Add: top "+ Add candidate" button → inline new row.
 *
 * Persists via useStaffingStore.{addCandidate, updateCandidate, removeCandidate},
 * which already write to Supabase via db.upsertIndiaCandidate / deleteIndiaCandidate.
 */
import { useMemo, useState } from 'react';
import { Plus, Trash2, Save, X } from 'lucide-react';
import { PageHeader } from '../components/shared/PageHeader';
import { Card } from '../components/ui';
import { useAuthStore } from '../store/useAuthStore';
import { useStaffingStore } from '../store/useStaffingStore';
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
}

const emptyDraft: DraftCandidate = {
  name: '',
  email: '',
  phone: '',
  requisition_id: '',
  source: 'LinkedIn',
  stage: 'Submitted',
  owning_ta_email: '',
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
      if (filterReq && c.requisition_id !== filterReq) return false;
      if (filterOwner && (c.owning_ta_email || '') !== filterOwner) return false;
      if (filterStage && c.stage !== filterStage) return false;
      if (needle) {
        const hay = `${c.name} ${c.email} ${c.phone} ${c.source} ${reqLabel(c.requisition_id)}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [candidates, q, filterReq, filterOwner, filterStage, requisitions, accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitAdd = async () => {
    if (!draft.name.trim() || !draft.requisition_id) return;
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
        }
      />

      {/* Filters */}
      <Card className="mb-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            placeholder="Search name / email / req…"
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
              <option value="">Requisition *</option>
              {requisitions.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </select>
            <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                    className="border border-slate-300 rounded-md px-3 py-2 text-sm bg-white">
              {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input placeholder="Owning TA email" value={draft.owning_ta_email}
                   onChange={(e) => setDraft({ ...draft, owning_ta_email: e.target.value })}
                   className="border border-slate-300 rounded-md px-3 py-2 text-sm" />
            <div className="md:col-span-6 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setAdding(false)}
                      className="text-xs font-semibold text-slate-500 hover:text-slate-700 flex items-center gap-1">
                <X size={12} /> Cancel
              </button>
              <button type="button" onClick={commitAdd}
                      disabled={!draft.name.trim() || !draft.requisition_id}
                      className="text-xs font-semibold bg-primary text-white px-3 py-2 rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
                <Save size={12} /> Add candidate
              </button>
            </div>
          </div>
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
                  <th className="py-2 pr-3 font-semibold">Name</th>
                  <th className="py-2 pr-3 font-semibold">Requisition</th>
                  <th className="py-2 pr-3 font-semibold">Stage</th>
                  <th className="py-2 pr-3 font-semibold">Source</th>
                  <th className="py-2 pr-3 font-semibold">Owning TA</th>
                  <th className="py-2 pr-3 font-semibold">Email / Phone</th>
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

function CandidateRow({ c, requisitions, accountName, onChange, onRemove }: {
  c: StaffingCandidate;
  requisitions: { id: string; title: string; account_id: string }[];
  accountName: (rid: string) => string;
  onChange: (patch: Partial<StaffingCandidate>) => void;
  onRemove: () => void;
}) {
  return (
    <tr className="hover:bg-slate-50/60">
      <td className="py-2 pr-3">
        <input
          value={c.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-full text-sm font-medium text-slate-900 bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </td>
      <td className="py-2 pr-3">
        <select
          value={c.requisition_id}
          onChange={(e) => onChange({ requisition_id: e.target.value })}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white max-w-[220px]"
        >
          {requisitions.map((r) => (
            <option key={r.id} value={r.id}>{r.title} — {accountName(r.id)}</option>
          ))}
        </select>
      </td>
      <td className="py-2 pr-3">
        <select
          value={c.stage}
          onChange={(e) => onChange({ stage: e.target.value as CandidateStage })}
          style={{ borderLeft: `3px solid ${CANDIDATE_STAGE_COLORS[c.stage]}` }}
          className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
        >
          {CANDIDATE_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
      <td className="py-2 pr-3">
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
      <td className="py-2 pr-3">
        <input
          value={c.owning_ta_email ?? ''}
          onChange={(e) => onChange({ owning_ta_email: e.target.value.toLowerCase() })}
          placeholder="ta@…"
          className="text-xs bg-transparent border-0 px-1 py-0.5 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 w-44"
        />
      </td>
      <td className="py-2 pr-3 text-xs text-slate-500">
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
      <td className="py-2 pr-3 text-right">
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
  );
}
