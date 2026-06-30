import { useState, useMemo, useRef, useEffect } from 'react';
import { usePipelineStore, useFinancialStore } from '../store';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Badge } from '../components/ui';
import { Sensitive } from '../components/Sensitive';
import type { ZohoPipelineProject, PipelineResource } from '../types/forecast';
import { db } from '../lib/supabaseSync';
import { useAuthStore } from '../store/useAuthStore';
import { buildSowDocxBlob, type SowSectionInput } from '../lib/sowDocx';
import {
  Plus,
  ArrowRightCircle,
  Trash2,
  Calendar,
  DollarSign,
  Users,
  Layers,
  UserPlus,
  X,
  Check,
  FileText,
  Sparkles,
  Loader2,
  Download,
} from 'lucide-react';

const ROLE_LABELS: Record<string, string> = {
  BA: 'BAs',
  JuniorDev: 'Jr Devs',
  SeniorDev: 'Sr Devs',
};

/** Helper to get headcount from resources array */
function getHeadcount(resources: PipelineResource[], role: string): number {
  return resources.find((r) => r.roleCategory === role)?.count ?? 0;
}

/** Build resources array from headcount values */
function buildResources(ba: number, jd: number, sd: number, hrsPerMonth = 160): PipelineResource[] {
  const res: PipelineResource[] = [];
  if (ba > 0) res.push({ roleCategory: 'BA', count: ba, hoursPerMonth: hrsPerMonth });
  if (jd > 0) res.push({ roleCategory: 'JuniorDev', count: jd, hoursPerMonth: hrsPerMonth });
  if (sd > 0) res.push({ roleCategory: 'SeniorDev', count: sd, hoursPerMonth: hrsPerMonth });
  return res;
}

/** Total people from resources */
function totalPeople(resources: PipelineResource[]): number {
  return resources.reduce((sum, r) => sum + r.count, 0);
}

/* ── Status badge helper ─────────────────────── */
function statusVariant(status: string) {
  const s = status.toLowerCase();
  if (s === 'proposed') return 'default' as const;
  if (s === 'negotiation') return 'warning' as const;
  if (s === 'confirmed') return 'success' as const;
  if (s === 'on hold') return 'neutral' as const;
  return 'info' as const;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
}

const PIPELINE_STATUSES = ['Proposed', 'Negotiation', 'Confirmed', 'On Hold'];

/* ── Inline editable field ────────────────────── */
function InlineEdit({ value, onSave, type = 'text', prefix = '', placeholder = 'Click to set', className = '' }: {
  value: string | number | null | undefined;
  onSave: (v: string) => void;
  type?: 'text' | 'number' | 'date';
  prefix?: string;
  placeholder?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ''));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.select(); } }, [editing]);
  const commit = () => { onSave(draft.trim()); setEditing(false); };
  if (editing) {
    return (
      <input
        ref={ref}
        type={type}
        className={`rounded border border-primary/40 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      />
    );
  }
  return (
    <span onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(String(value ?? '')); }} className="cursor-pointer hover:text-primary">
      {value ? `${prefix}${value}` : <span className="text-slate-400 italic">{placeholder}</span>}
    </span>
  );
}

/* ── New Pipeline Project Form ──────────────── */
function NewProjectForm({ onAdd, onCancel }: { onAdd: (p: ZohoPipelineProject) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState('Proposed');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [revenue, setRevenue] = useState('');
  const [revCurrency, setRevCurrency] = useState<'USD' | 'CAD'>('USD');
  const [baCount, setBaCount] = useState(0);
  const [jdCount, setJdCount] = useState(0);
  const [sdCount, setSdCount] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const project: ZohoPipelineProject = {
      id: `manual-${Date.now()}`,
      name: name.trim(),
      status,
      owner: owner.trim() || 'Unassigned',
      startDate: startDate || null,
      endDate: endDate || null,
      source: 'manual',
      revenue: parseFloat(revenue) > 0 ? parseFloat(revenue) : null,
      revenueCurrency: revCurrency,
      resources: buildResources(baCount, jdCount, sdCount),
    };
    onAdd(project);
  };

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-slate-800 text-base">New Pipeline Project</h3>
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="col-span-2 md:col-span-1">
            <label className="text-xs text-slate-500 block mb-1">Project Name *</label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary"
              placeholder="e.g. Acme Corp Phase 2"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Owner</label>
            <input
              type="text"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder="Project owner"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {PIPELINE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Expected Start</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Expected End</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Est. Revenue</label>
            <div className="flex gap-1">
              <select
                value={revCurrency}
                onChange={(e) => setRevCurrency(e.target.value as 'USD' | 'CAD')}
                className="rounded border border-slate-300 bg-white px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="USD">USD</option>
                <option value="CAD">CAD</option>
              </select>
              <input
                type="number"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="0"
                min="0"
              />
            </div>
          </div>
        </div>

        {/* Resource needs */}
        <div>
          <label className="text-xs text-slate-500 block mb-2 flex items-center gap-1">
            <UserPlus size={12} /> Resource Needs (headcount) — feeds into Hiring Forecast
          </label>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Business Analysts</label>
              <input type="number" min={0} value={baCount} onChange={(e) => setBaCount(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Junior Developers</label>
              <input type="number" min={0} value={jdCount} onChange={(e) => setJdCount(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Senior Developers</label>
              <input type="number" min={0} value={sdCount} onChange={(e) => setSdCount(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-primary/50" />
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Check size={16} />
            Add to Pipeline
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

/* ── Pipeline project card ─────────────────── */
function PipelineProjectCard({
  project,
  onUpdate,
  onRemove,
  onMoveToCurrent,
}: {
  project: ZohoPipelineProject;
  onUpdate: (id: string, updates: Partial<ZohoPipelineProject>) => void;
  onRemove: (id: string) => void;
  onMoveToCurrent: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmMove, setConfirmMove] = useState(false);
  const [sowOpen, setSowOpen] = useState(false);
  const [editSowId, setEditSowId] = useState<string | null>(null);
  const [sowReloadKey, setSowReloadKey] = useState(0);
  const revenue = project.revenue ?? 0;
  const curr = project.revenueCurrency ?? 'USD';
  const currSymbol = curr === 'CAD' ? 'CA$' : '$';

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-slate-800 text-base">{project.name}</h3>
            <Badge variant={statusVariant(project.status)}>{project.status}</Badge>
            <Badge variant="default">Pipeline</Badge>
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-slate-500 flex-wrap">
            <span className="flex items-center gap-1"><Users size={12} /> {project.owner}</span>
            {(project.startDate || project.endDate) && (
              <span className="flex items-center gap-1">
                <Calendar size={12} /> {formatDate(project.startDate)} – {formatDate(project.endDate)}
              </span>
            )}
            {revenue > 0 && (
              <span className="flex items-center gap-1 text-emerald-700">
                <DollarSign size={12} /> Est. Revenue: <Sensitive>{`${currSymbol}${revenue.toLocaleString()} ${curr}`}</Sensitive>
              </span>
            )}
            {totalPeople(project.resources) > 0 && (
              <span className="flex items-center gap-1 text-violet-700">
                <UserPlus size={12} />
                {project.resources.map((r) => `${r.count} ${ROLE_LABELS[r.roleCategory] ?? r.roleCategory}`).join(', ')}
              </span>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setSowOpen(true); }}
            title="Generate Statement of Work"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <FileText size={14} />
            Generate SOW
          </button>
          {!confirmMove ? (
            <button
              onClick={() => setConfirmMove(true)}
              title="Move to Current Projects"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <ArrowRightCircle size={14} />
              Move to Current
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500">Sure?</span>
              <button
                onClick={() => { onMoveToCurrent(project.id); setConfirmMove(false); }}
                className="px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmMove(false)}
                className="px-2 py-1 text-xs text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
              >
                No
              </button>
            </div>
          )}
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete project"
              className="p-1.5 text-slate-400 hover:text-red-500 transition-colors rounded hover:bg-red-50"
            >
              <Trash2 size={14} />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs text-red-600">Delete?</span>
              <button
                onClick={() => { onRemove(project.id); setConfirmDelete(false); }}
                className="px-2 py-1 text-xs text-white bg-red-600 rounded hover:bg-red-700"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 text-xs text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Project Name</label>
              <InlineEdit
                value={project.name}
                onSave={(v) => v && onUpdate(project.id, { name: v })}
                placeholder="Project name"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Owner</label>
              <InlineEdit
                value={project.owner}
                onSave={(v) => onUpdate(project.id, { owner: v || 'Unassigned' })}
                placeholder="Owner"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Status</label>
              <select
                value={project.status}
                onChange={(e) => onUpdate(project.id, { status: e.target.value })}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                {PIPELINE_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Est. Revenue</label>
              <div className="flex items-center gap-1">
                <select
                  value={curr}
                  onChange={(e) => onUpdate(project.id, { revenueCurrency: e.target.value as 'USD' | 'CAD' })}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="USD">USD</option>
                  <option value="CAD">CAD</option>
                </select>
                <Sensitive placeholder={<span className="text-sm text-slate-400 italic">•••</span>}>
                  <InlineEdit
                    value={project.revenue ?? ''}
                    type="number"
                    prefix={currSymbol}
                    placeholder="Set revenue"
                    onSave={(v) => onUpdate(project.id, { revenue: parseFloat(v) > 0 ? parseFloat(v) : null })}
                    className="w-32"
                  />
                </Sensitive>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Expected Start</label>
              <InlineEdit
                value={project.startDate ?? ''}
                type="date"
                placeholder="Set date"
                onSave={(v) => onUpdate(project.id, { startDate: v || null })}
                className="w-36"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Expected End</label>
              <InlineEdit
                value={project.endDate ?? ''}
                type="date"
                placeholder="Set date"
                onSave={(v) => onUpdate(project.id, { endDate: v || null })}
                className="w-36"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Go-Live Date</label>
              <InlineEdit
                value={project.goLiveDate ?? ''}
                type="date"
                placeholder="Set go-live"
                onSave={(v) => onUpdate(project.id, { goLiveDate: v || null })}
                className="w-36"
              />
            </div>
          </div>

          {/* Resource needs */}
          <div className="mt-4 pt-3 border-t border-slate-100">
            <label className="text-xs text-slate-500 block mb-2 flex items-center gap-1">
              <UserPlus size={12} /> Resource Needs (feeds into Hiring Forecast)
            </label>
            <div className="flex gap-4 items-end">
              {(['BA', 'JuniorDev', 'SeniorDev'] as const).map((role) => (
                <div key={role}>
                  <label className="text-[10px] text-slate-400 block mb-1">{ROLE_LABELS[role]}</label>
                  <input
                    type="number"
                    min={0}
                    className="w-16 rounded border border-slate-200 bg-white px-2 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary/50"
                    value={getHeadcount(project.resources, role)}
                    onChange={(e) => {
                      const val = Math.max(0, Number(e.target.value) || 0);
                      const updated = buildResources(
                        role === 'BA' ? val : getHeadcount(project.resources, 'BA'),
                        role === 'JuniorDev' ? val : getHeadcount(project.resources, 'JuniorDev'),
                        role === 'SeniorDev' ? val : getHeadcount(project.resources, 'SeniorDev'),
                      );
                      onUpdate(project.id, { resources: updated });
                    }}
                  />
                </div>
              ))}
              {totalPeople(project.resources) > 0 && (
                <span className="text-[10px] text-slate-400 pb-1">
                  = {totalPeople(project.resources)} people × 160 hrs/mo
                </span>
              )}
            </div>
          </div>

          <SowHistory
            projectId={project.id}
            refreshKey={`${sowOpen ? 'open' : 'closed'}-${sowReloadKey}`}
            onEdit={(id) => { setEditSowId(id); setSowOpen(true); }}
          />
        </div>
      )}
      {sowOpen && (
        <SowWizard
          project={project}
          initialSowId={editSowId ?? undefined}
          onClose={() => {
            setSowOpen(false);
            setEditSowId(null);
            // Bump the reload key so SowHistory re-fetches and reflects any
            // saves that happened inside the wizard.
            setSowReloadKey((k) => k + 1);
          }}
        />
      )}
    </Card>
  );
}

// ── SOW Wizard ──────────────────────────────────────────
const SOW_STATUSES = ['draft', 'sent', 'signed', 'archived'] as const;
const SOW_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-300',
  sent: 'bg-blue-50 text-blue-700 border-blue-200',
  signed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-amber-50 text-amber-700 border-amber-200',
};

/** Lists every saved SOW for a project, newest first. Each row exposes
 *  download, status (click to flip), edit-as-new-version, and delete.
 *  refreshKey forces a re-fetch when a save likely happened. */
function SowHistory({ projectId, refreshKey, onEdit }: {
  projectId: string;
  refreshKey: string;
  onEdit: (sowId: string) => void;
}) {
  type Row = {
    id: string; version: number; sowType: string; clientName: string;
    effectiveDate: string | null; createdAt: string; createdBy: string | null;
    docxPath: string | null; status: string;
  };
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    db.listSowsForProject(projectId).then((r) => { setRows(r); setLoading(false); });
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    db.listSowsForProject(projectId).then((r) => {
      if (cancelled) return;
      setRows(r);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectId, refreshKey]);

  const downloadSaved = async (path: string | null) => {
    if (!path) return;
    const url = await db.signedSowDocxUrl(path);
    if (!url) return;
    window.open(url, '_blank');
  };

  const cycleStatus = async (row: Row) => {
    const idx = SOW_STATUSES.indexOf(row.status as (typeof SOW_STATUSES)[number]);
    const next = SOW_STATUSES[(idx + 1) % SOW_STATUSES.length];
    setBusyId(row.id);
    const res = await db.setSowStatus(row.id, next);
    setBusyId(null);
    if (res.ok) setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: next } : r)));
  };

  const remove = async (row: Row) => {
    setBusyId(row.id);
    const res = await db.deleteSow(row.id, row.docxPath);
    setBusyId(null);
    if (res.ok) {
      setConfirmDelete(null);
      reload();
    }
  };

  if (loading && rows.length === 0) {
    return (
      <div className="mt-4 pt-3 border-t border-slate-100">
        <div className="text-xs text-slate-400">Loading SOW history…</div>
      </div>
    );
  }
  if (rows.length === 0) return null;

  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
      <div className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5">
        <FileText size={12} /> SOW versions ({rows.length})
      </div>
      <div className="space-y-1">
        {rows.map((r) => {
          const isConfirming = confirmDelete === r.id;
          const isBusy = busyId === r.id;
          const statusClass = SOW_STATUS_STYLES[r.status] ?? SOW_STATUS_STYLES.draft;
          return (
            <div key={r.id} className="flex items-center justify-between gap-3 py-1.5 px-2 hover:bg-slate-50 rounded text-xs">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="font-semibold text-slate-700 shrink-0">v{r.version}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 shrink-0">{r.sowType}</span>
                <button
                  type="button"
                  onClick={() => cycleStatus(r)}
                  disabled={isBusy}
                  title="Click to advance status (draft → sent → signed → archived)"
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border shrink-0 uppercase tracking-wide hover:opacity-80 disabled:opacity-50 ${statusClass}`}
                >
                  {r.status}
                </button>
                <span className="text-slate-600 truncate">{r.clientName}</span>
                <span className="text-slate-400 shrink-0">· {new Date(r.createdAt).toLocaleDateString()}</span>
                {r.createdBy && <span className="text-slate-400 truncate hidden md:inline">by {r.createdBy}</span>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => downloadSaved(r.docxPath)}
                  disabled={!r.docxPath || isBusy}
                  className="px-2 py-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1"
                  title={r.docxPath ? 'Download .docx' : 'No .docx attached (legacy save)'}
                >
                  <Download size={11} /> .docx
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(r.id)}
                  disabled={isBusy}
                  className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1"
                  title="Open in wizard to tweak and save as next version"
                >
                  Edit
                </button>
                {!isConfirming ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(r.id)}
                    disabled={isBusy}
                    title="Delete this SOW version"
                    className="p-1 text-slate-400 hover:text-red-500 disabled:opacity-40 rounded hover:bg-red-50"
                  >
                    <Trash2 size={12} />
                  </button>
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-red-600">Delete?</span>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      disabled={isBusy}
                      className="px-1.5 py-0.5 text-[10px] text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(null)}
                      className="px-1.5 py-0.5 text-[10px] text-slate-600 bg-slate-100 rounded hover:bg-slate-200"
                    >
                      No
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Multi-step modal for generating a Statement of Work for a pipeline
 *  project. Two flavours:
 *    1. Concierge — Time & Materials support engagement.
 *    2. Implementation — fixed-fee build/delivery with payment milestones.
 *  User fills rough inputs; gpt-4.1-nano (via the generate-sow edge fn)
 *  polishes them into Simpliigence-style legal language and returns a
 *  ready-to-print HTML doc + structured sections. */
function SowWizard({ project, onClose, initialSowId }: { project: ZohoPipelineProject; onClose: () => void; initialSowId?: string }) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const today = new Date().toISOString().slice(0, 10);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [sowType, setSowType] = useState<'concierge' | 'implementation' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Client info (step 2)
  const [clientName, setClientName] = useState(project.name || '');
  const [clientAddress, setClientAddress] = useState('');
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today);

  // Concierge inputs (step 3)
  const [conActivities, setConActivities] = useState('');
  const [conHourlyRate, setConHourlyRate] = useState('$95 / hour or 115 CAD / per hour');
  const [conPaymentTerms, setConPaymentTerms] = useState('3 days from invoice date');
  const [conInvoiceDate, setConInvoiceDate] = useState('1st of every month');
  const [conTerminationNotice, setConTerminationNotice] = useState('4 weeks');
  const [conMinHours, setConMinHours] = useState('N/A');
  const [conTravelPolicy, setConTravelPolicy] = useState('Based on actuals, pre-approved by the client.');
  const [conSpecial, setConSpecial] = useState('');

  // Implementation inputs (step 3)
  const [impGoals, setImpGoals] = useState('');
  const [impInScope, setImpInScope] = useState('');
  const [impOutOfScope, setImpOutOfScope] = useState('');
  const [impAssumptions, setImpAssumptions] = useState('');
  const [impMilestones, setImpMilestones] = useState('');
  const [impTotalFees, setImpTotalFees] = useState('');
  const [impDuration, setImpDuration] = useState('');
  const [impSpecial, setImpSpecial] = useState('');
  const [impCurrentState, setImpCurrentState] = useState('');
  const [impPriorities, setImpPriorities] = useState('');
  const [impFutureVision, setImpFutureVision] = useState('');
  const [impPricingModel, setImpPricingModel] = useState<'fixed' | 'tm'>('fixed');
  const [impSolution, setImpSolution] = useState('Salesforce');

  // Result (step 4)
  const [html, setHtml] = useState<string>('');
  const [sections, setSections] = useState<SowSectionInput[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // When the wizard is opened with an initialSowId (clone-and-edit from
  // SowHistory), load that row and prefill every field so the user can
  // tweak and re-generate as the next version.
  useEffect(() => {
    if (!initialSowId) return;
    let cancelled = false;
    (async () => {
      const sow = await db.loadSow(initialSowId);
      if (cancelled || !sow) return;
      setSowType(sow.sowType);
      setClientName(sow.clientName);
      setClientAddress(sow.clientAddress);
      setSignerName(sow.signerName);
      setSignerTitle(sow.signerTitle);
      setSignerEmail(sow.signerEmail);
      setEffectiveDate(sow.effectiveDate || today);
      const i = sow.inputs as Record<string, string | undefined>;
      if (sow.sowType === 'concierge') {
        setConActivities(i.activities ?? '');
        setConHourlyRate(i.hourlyRate ?? conHourlyRate);
        setConPaymentTerms(i.paymentTerms ?? conPaymentTerms);
        setConInvoiceDate(i.invoiceDate ?? conInvoiceDate);
        setConTerminationNotice(i.terminationNotice ?? conTerminationNotice);
        setConMinHours(i.minimumHours ?? conMinHours);
        setConTravelPolicy(i.travelPolicy ?? conTravelPolicy);
        setConSpecial(i.specialConditions ?? '');
      } else {
        setImpGoals(i.businessGoals ?? '');
        setImpInScope(i.inScope ?? '');
        setImpOutOfScope(i.outOfScope ?? '');
        setImpAssumptions(i.assumptions ?? '');
        setImpMilestones(i.paymentMilestones ?? '');
        setImpTotalFees(i.totalFees ?? '');
        setImpDuration(i.durationWeeks ?? '');
        setImpSpecial(i.specialConditions ?? '');
        setImpCurrentState(i.currentState ?? '');
        setImpPriorities(i.strategicPriorities ?? '');
        setImpFutureVision(i.futureVision ?? '');
        setImpPricingModel((i.pricingModel as 'fixed' | 'tm') ?? 'fixed');
        setImpSolution(i.solution ?? 'Salesforce');
      }
      // Jump the user straight to the scope step — they're editing a known
      // template, not starting from scratch.
      setStep(3);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSowId]);

  const inputsForGenerate = sowType === 'concierge' ? {
    activities: conActivities, hourlyRate: conHourlyRate, paymentTerms: conPaymentTerms,
    invoiceDate: conInvoiceDate, terminationNotice: conTerminationNotice,
    minimumHours: conMinHours, travelPolicy: conTravelPolicy, specialConditions: conSpecial,
  } : {
    businessGoals: impGoals, inScope: impInScope, outOfScope: impOutOfScope,
    assumptions: impAssumptions, paymentMilestones: impMilestones, totalFees: impTotalFees,
    durationWeeks: impDuration, specialConditions: impSpecial,
    currentState: impCurrentState, strategicPriorities: impPriorities,
    futureVision: impFutureVision, pricingModel: impPricingModel, solution: impSolution,
  };

  const generate = async () => {
    if (!sowType) return;
    setBusy(true); setError(null); setWarnings([]);
    const res = await db.generateSow({
      sowType,
      projectName: project.name,
      clientName, clientAddress, signerName, signerTitle, effectiveDate,
      inputs: inputsForGenerate,
    });
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setHtml(res.html);
    setSections(res.sections);
    setWarnings(res.warnings);
    setStep(4);
  };

  const buildDocxBlob = async () => {
    return buildSowDocxBlob(
      { clientName, effectiveDate, signerName, signerTitle },
      sections,
    );
  };

  /** Save the SOW: upload the generated .docx to sow-documents, then write
   *  the row into pipeline_sows. Each save is a NEW version (version history). */
  const save = async () => {
    if (!sowType) return;
    setBusy(true); setError(null);
    try {
      const version = await db.nextSowVersion(project.id);
      const blob = await buildDocxBlob();
      const docxPath = await db.uploadSowDocx(project.id, clientName, blob);
      const id = `sow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const res = await db.saveSow({
        id,
        pipelineProjectId: project.id, projectName: project.name,
        sowType, clientName, clientAddress, signerName, signerTitle, signerEmail, effectiveDate,
        inputs: inputsForGenerate as unknown as Record<string, unknown>,
        sections, html, docxPath, version,
        createdBy: (currentUser?.email || '').toLowerCase(),
      });
      if (!res.ok) { setError(res.error || 'Save failed'); return; }
      setSavedId(id);
    } catch (e) {
      setError((e as Error).message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const downloadHtml = () => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SOW-${clientName.replace(/[^a-zA-Z0-9]+/g, '_')}-${effectiveDate}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadDocx = async () => {
    setBusy(true);
    try {
      const blob = await buildDocxBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SOW-${clientName.replace(/[^a-zA-Z0-9]+/g, '_')}-${effectiveDate}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message || 'DOCX build failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto p-4 md:p-8" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 sticky top-0 bg-white rounded-t-xl">
          <div>
            <div className="text-sm font-bold text-slate-900">Generate Statement of Work</div>
            <div className="text-[11px] text-slate-500">{project.name} · Step {step} of 4</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xs font-semibold">✕ Close</button>
        </div>

        <div className="p-5 space-y-4">

          {step === 1 && (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-800">What kind of project is this?</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <button type="button" onClick={() => { setSowType('concierge'); setStep(2); }}
                        className="text-left p-4 border-2 border-slate-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors">
                  <div className="font-bold text-sm text-slate-900 mb-1">🛠 Concierge / Support</div>
                  <div className="text-xs text-slate-600">Time & Materials engagement for ongoing enhancements, business-ops support, ad-hoc work. Billed hourly.</div>
                </button>
                <button type="button" onClick={() => { setSowType('implementation'); setStep(2); }}
                        className="text-left p-4 border-2 border-slate-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50/30 transition-colors">
                  <div className="font-bold text-sm text-slate-900 mb-1">🚀 Implementation</div>
                  <div className="text-xs text-slate-600">Fixed-scope build / delivery with business goals, in/out-of-scope, assumptions, payment milestones.</div>
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-800">Client details</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Client legal name *">
                  <input value={clientName} onChange={(e) => setClientName(e.target.value)} className={fInput} />
                </Field>
                <Field label="Effective date *">
                  <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className={fInput} />
                </Field>
              </div>
              <Field label="Client address">
                <input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} placeholder="20 Erb St. West Suite 1001 Waterloo, ON N2L 1T2" className={fInput} />
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Signer name">
                  <input value={signerName} onChange={(e) => setSignerName(e.target.value)} className={fInput} />
                </Field>
                <Field label="Signer title">
                  <input value={signerTitle} onChange={(e) => setSignerTitle(e.target.value)} className={fInput} />
                </Field>
                <Field label="Signer email">
                  <input type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} className={fInput} />
                </Field>
              </div>
              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(1)} className="text-xs text-slate-500 hover:text-slate-800">← Back</button>
                <button onClick={() => setStep(3)} disabled={!clientName || !effectiveDate} className="px-4 py-1.5 bg-primary text-white rounded-md text-xs font-semibold disabled:opacity-50">Next →</button>
              </div>
            </div>
          )}

          {step === 3 && sowType === 'concierge' && (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-800">Concierge scope & pricing</div>
              <Field label="Activities to support *">
                <textarea value={conActivities} onChange={(e) => setConActivities(e.target.value)} rows={4}
                          placeholder="Enhancements on Salesforce platform, business operations support, user training, technical evaluations, onsite meetings…"
                          className={fInput} />
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Hourly rate"><input value={conHourlyRate} onChange={(e) => setConHourlyRate(e.target.value)} className={fInput} /></Field>
                <Field label="Minimum hours/month"><input value={conMinHours} onChange={(e) => setConMinHours(e.target.value)} className={fInput} /></Field>
                <Field label="Payment terms"><input value={conPaymentTerms} onChange={(e) => setConPaymentTerms(e.target.value)} className={fInput} /></Field>
                <Field label="Invoice date"><input value={conInvoiceDate} onChange={(e) => setConInvoiceDate(e.target.value)} className={fInput} /></Field>
                <Field label="Termination notice"><input value={conTerminationNotice} onChange={(e) => setConTerminationNotice(e.target.value)} className={fInput} /></Field>
                <Field label="Travel & Expenses"><input value={conTravelPolicy} onChange={(e) => setConTravelPolicy(e.target.value)} className={fInput} /></Field>
              </div>
              <Field label="Special conditions (optional)">
                <textarea value={conSpecial} onChange={(e) => setConSpecial(e.target.value)} rows={2} className={fInput} />
              </Field>
              {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(2)} className="text-xs text-slate-500 hover:text-slate-800">← Back</button>
                <button onClick={generate} disabled={!conActivities || busy} className="px-4 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {busy ? 'Generating…' : 'Generate SOW'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && sowType === 'implementation' && (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-slate-800">Implementation scope</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Solution / platform">
                  <input value={impSolution} onChange={(e) => setImpSolution(e.target.value)} placeholder="Salesforce Sales Cloud" className={fInput} />
                </Field>
                <Field label="Pricing model">
                  <select value={impPricingModel} onChange={(e) => setImpPricingModel(e.target.value as 'fixed' | 'tm')} className={fInput}>
                    <option value="fixed">Fixed price with milestones</option>
                    <option value="tm">Time & Materials</option>
                  </select>
                </Field>
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Executive Summary context</div>
              <Field label="Current state / business context">
                <textarea value={impCurrentState} onChange={(e) => setImpCurrentState(e.target.value)} rows={2}
                          placeholder="One or two sentences on the client's current situation and the challenge driving this initiative."
                          className={fInput} />
              </Field>
              <Field label="Strategic priorities">
                <textarea value={impPriorities} onChange={(e) => setImpPriorities(e.target.value)} rows={2}
                          placeholder="Bullets or phrases — what outcomes matter most to leadership."
                          className={fInput} />
              </Field>
              <Field label="Future vision">
                <textarea value={impFutureVision} onChange={(e) => setImpFutureVision(e.target.value)} rows={2}
                          placeholder="One sentence on the future state the platform unlocks."
                          className={fInput} />
              </Field>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 pt-2">Scope</div>
              <Field label="Business goals *">
                <textarea value={impGoals} onChange={(e) => setImpGoals(e.target.value)} rows={3}
                          placeholder="What is the client trying to achieve? Outcomes, not features."
                          className={fInput} />
              </Field>
              <Field label="In-scope (what Simpliigence will deliver) *">
                <textarea value={impInScope} onChange={(e) => setImpInScope(e.target.value)} rows={4}
                          placeholder="Bullets / rough phrases. Claude will tighten the language."
                          className={fInput} />
              </Field>
              <Field label="Out-of-scope (explicit exclusions)">
                <textarea value={impOutOfScope} onChange={(e) => setImpOutOfScope(e.target.value)} rows={3} className={fInput} />
              </Field>
              <Field label="Assumptions">
                <textarea value={impAssumptions} onChange={(e) => setImpAssumptions(e.target.value)} rows={3}
                          placeholder="Client SPOC available, environment access, decisions within 48h, etc."
                          className={fInput} />
              </Field>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Total fees *"><input value={impTotalFees} onChange={(e) => setImpTotalFees(e.target.value)} placeholder="$120,000 USD" className={fInput} /></Field>
                <Field label="Duration"><input value={impDuration} onChange={(e) => setImpDuration(e.target.value)} placeholder="12 weeks" className={fInput} /></Field>
                <Field label="Payment milestones *"><input value={impMilestones} onChange={(e) => setImpMilestones(e.target.value)} placeholder="30% signing, 40% UAT, 30% go-live" className={fInput} /></Field>
              </div>
              <Field label="Special conditions (optional)">
                <textarea value={impSpecial} onChange={(e) => setImpSpecial(e.target.value)} rows={2} className={fInput} />
              </Field>
              {error && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(2)} className="text-xs text-slate-500 hover:text-slate-800">← Back</button>
                <button onClick={generate} disabled={!impGoals || !impInScope || !impTotalFees || !impMilestones || busy}
                        className="px-4 py-1.5 bg-indigo-600 text-white rounded-md text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {busy ? 'Generating…' : 'Generate SOW'}
                </button>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-800">Preview</div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={downloadDocx} disabled={busy} className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded inline-flex items-center gap-1 disabled:opacity-50">
                    <Download size={12} /> Download .docx
                  </button>
                  <button onClick={downloadHtml} className="px-3 py-1.5 text-xs font-semibold border border-slate-300 rounded inline-flex items-center gap-1 hover:bg-slate-50">
                    <Download size={12} /> .html
                  </button>
                  <button onClick={save} disabled={busy || !!savedId} className="px-3 py-1.5 text-xs font-semibold bg-primary text-white rounded inline-flex items-center gap-1 disabled:opacity-50">
                    {savedId ? '✓ Saved' : (busy ? 'Saving…' : 'Save to project')}
                  </button>
                </div>
              </div>
              {warnings.length > 0 && (
                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                  <b>AI suggested review:</b>
                  <ul className="list-disc pl-4 mt-1">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
              <div className="border border-slate-300 rounded-md max-h-[60vh] overflow-y-auto">
                <iframe srcDoc={html} className="w-full h-[60vh] border-0" title="SOW preview" />
              </div>
              <div className="text-[11px] text-slate-500">
                Tip: open the downloaded HTML in Chrome → Cmd-P → "Save as PDF" for a print-ready document.
              </div>
              <div className="flex justify-between pt-2">
                <button onClick={() => setStep(3)} className="text-xs text-slate-500 hover:text-slate-800">← Back to edit</button>
                <button onClick={onClose} className="px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-300 rounded">Close</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

const fInput = 'w-full border border-slate-300 rounded-md px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

/* ── Main Pipeline page ──────────────────────── */
export default function PipelinePage() {
  const allProjects = usePipelineStore((s) => s.projects);
  const addProject = usePipelineStore((s) => s.addProject);
  const updateProject = usePipelineStore((s) => s.updateProject);
  const removeProject = usePipelineStore((s) => s.removeProject);
  const [showForm, setShowForm] = useState(false);
  const cadToUsdRate = useFinancialStore((s) => s.settings.cadToUsdRate);

  /** Convert a project's revenue to USD */
  const toUsd = (p: ZohoPipelineProject) => {
    if (!p.revenue) return 0;
    return p.revenueCurrency === 'CAD' ? p.revenue * cadToUsdRate : p.revenue;
  };

  // Pipeline = manually created projects only
  const pipelineProjects = useMemo(() => allProjects.filter((p) => p.source === 'manual'), [allProjects]);

  // Stats
  const proposed = pipelineProjects.filter((p) => p.status === 'Proposed').length;
  const negotiation = pipelineProjects.filter((p) => p.status === 'Negotiation').length;
  const totalRevenueUsd = pipelineProjects.reduce((sum, p) => sum + toUsd(p), 0);

  const handleAdd = (project: ZohoPipelineProject) => {
    addProject(project);
    setShowForm(false);
  };

  const handleMoveToCurrent = (id: string) => {
    // Change source from 'manual' to 'zoho' to move to current projects
    updateProject(id, { source: 'zoho', status: 'In Progress' });
  };

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle={`${pipelineProjects.length} pipeline projects`}
        action={
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Plus size={16} />
            Add Pipeline Project
          </button>
        }
      />

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-800">{pipelineProjects.length}</div>
          <div className="text-xs text-slate-500">Total Pipeline</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-amber-600">{proposed}</div>
          <div className="text-xs text-slate-500">Proposed</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-blue-600">{negotiation}</div>
          <div className="text-xs text-slate-500">In Negotiation</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-emerald-600">
            {totalRevenueUsd > 0 ? `$${(totalRevenueUsd / 1000).toFixed(0)}k` : '—'}
          </div>
          <div className="text-xs text-slate-500">Pipeline Revenue (USD)</div>
        </div>
      </div>

      {/* New project form */}
      {showForm && (
        <div className="mb-6">
          <NewProjectForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {/* Pipeline projects list */}
      {pipelineProjects.length === 0 && !showForm ? (
        <Card>
          <div className="text-center py-12">
            <div className="text-slate-400 mb-3">
              <Layers size={48} className="mx-auto opacity-50" />
            </div>
            <h3 className="text-lg font-semibold text-slate-600 mb-1">No pipeline projects yet</h3>
            <p className="text-sm text-slate-400 mb-4">
              Add upcoming projects to track your pipeline and forecast future resource needs.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={16} />
              Add Your First Pipeline Project
            </button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {pipelineProjects.map((project) => (
            <PipelineProjectCard
              key={project.id}
              project={project}
              onUpdate={updateProject}
              onRemove={removeProject}
              onMoveToCurrent={handleMoveToCurrent}
            />
          ))}
        </div>
      )}

      {/* Pipeline funnel summary */}
      {pipelineProjects.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-slate-800 mb-3">Pipeline Funnel</h2>
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <div className="flex items-end gap-6">
              {PIPELINE_STATUSES.map((status) => {
                const count = pipelineProjects.filter((p) => p.status === status).length;
                const rev = pipelineProjects
                  .filter((p) => p.status === status)
                  .reduce((sum, p) => sum + toUsd(p), 0);
                const maxCount = Math.max(pipelineProjects.length, 1);
                const height = Math.max((count / maxCount) * 120, 8);
                return (
                  <div key={status} className="flex-1 text-center">
                    <div className="flex flex-col items-center justify-end" style={{ height: 140 }}>
                      <div className="text-sm font-bold text-slate-700 mb-1">{count}</div>
                      <div
                        className={`w-full rounded-t-lg ${
                          status === 'Proposed' ? 'bg-slate-300' :
                          status === 'Negotiation' ? 'bg-amber-400' :
                          status === 'Confirmed' ? 'bg-emerald-500' :
                          'bg-slate-200'
                        }`}
                        style={{ height }}
                      />
                    </div>
                    <div className="text-xs font-medium text-slate-600 mt-2">{status}</div>
                    {rev > 0 && (
                      <div className="text-[10px] text-slate-400">${(rev / 1000).toFixed(0)}k</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

