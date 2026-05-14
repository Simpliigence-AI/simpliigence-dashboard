import { useState, useMemo, useRef, useEffect } from 'react';
import { usePipelineStore, useFinancialStore } from '../store';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Badge } from '../components/ui';
import { Sensitive } from '../components/Sensitive';
import type { ZohoPipelineProject, PipelineResource } from '../types/forecast';
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
        </div>
      )}
    </Card>
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

