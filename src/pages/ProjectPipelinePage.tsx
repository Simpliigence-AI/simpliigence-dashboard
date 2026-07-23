import { useState, useMemo, useRef, useEffect } from 'react';
import { useForecastStore, usePipelineStore, useFinancialStore } from '../store';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Badge } from '../components/ui';
import { Sensitive } from '../components/Sensitive';
import { deriveProjectSummaries } from '../lib/parseSpreadsheet';
import type { ZohoPipelineProject, ZohoPhase } from '../types/forecast';
import { ChevronDown, ChevronRight, Users, Calendar, Clock, Rocket, DollarSign, TrendingUp } from 'lucide-react';

/* ── Status badge helper ──────────────────────────────── */
function projectStatusVariant(status: string) {
  const s = status.toLowerCase();
  if (s.includes('progress') || s.includes('track')) return 'info' as const;
  if (s === 'active') return 'success' as const;
  if (s === 'delayed') return 'danger' as const;
  if (s.includes('complet')) return 'neutral' as const;
  return 'default' as const;
}

function phaseStatusVariant(phase: ZohoPhase) {
  if (phase.isClosed) return 'neutral' as const;
  if (phase.status === 'In Progress') return 'info' as const;
  // Active but in the future
  const today = new Date().toISOString().slice(0, 10);
  if (phase.startDate > today) return 'default' as const;
  return 'success' as const;
}

function formatDate(d: string | null) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
}

function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

/** Detect Go-Live date from phases (looks for phase names containing "go-live", "go live", "golive") */
function detectGoLiveDate(phases: ZohoPhase[]): string | null {
  const goLivePhase = phases.find((p) =>
    /go[\s\-_]*live/i.test(p.name)
  );
  return goLivePhase?.startDate ?? null;
}

/** Get go-live date: manual override > phase detection > null */
function getGoLiveDate(project: ZohoPipelineProject): string | null {
  if (project.goLiveDate) return project.goLiveDate;
  return detectGoLiveDate(project.phases ?? []);
}

/** Days until go-live from today */
function daysUntilGoLive(goLiveDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(goLiveDate + 'T00:00:00');
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

/** Go-Live urgency badge */
function GoLiveBadge({ date }: { date: string }) {
  const days = daysUntilGoLive(date);
  let variant: 'danger' | 'warning' | 'info' | 'success' | 'neutral' = 'info';
  let label = '';
  if (days < 0) { variant = 'neutral'; label = `${Math.abs(days)}d ago`; }
  else if (days === 0) { variant = 'danger'; label = 'TODAY'; }
  else if (days <= 7) { variant = 'danger'; label = `${days}d away`; }
  else if (days <= 30) { variant = 'warning'; label = `${days}d away`; }
  else { variant = 'info'; label = `${days}d away`; }
  return <Badge variant={variant}>{label}</Badge>;
}

/* ── Phase timeline bar ──────────────────────────────── */
function PhaseTimeline({ phases, projectStart, projectEnd }: { phases: ZohoPhase[]; projectStart: string; projectEnd: string }) {
  const totalDays = Math.max(daysBetween(projectStart, projectEnd), 1);

  return (
    <div className="relative mt-3 mb-1">
      {/* date labels */}
      <div className="flex justify-between text-[10px] text-slate-400 mb-1">
        <span>{formatDate(projectStart)}</span>
        <span>{formatDate(projectEnd)}</span>
      </div>
      {/* track */}
      <div className="relative h-6 bg-slate-100 rounded-full overflow-hidden">
        {phases.map((ph) => {
          const offsetDays = Math.max(daysBetween(projectStart, ph.startDate), 0);
          const durationDays = Math.max(daysBetween(ph.startDate, ph.endDate), 1);
          const left = (offsetDays / totalDays) * 100;
          const width = Math.max((durationDays / totalDays) * 100, 1);
          const bg = ph.isClosed
            ? 'bg-slate-300'
            : ph.status === 'In Progress'
              ? 'bg-blue-500'
              : 'bg-emerald-400';
          return (
            <div
              key={ph.id}
              title={`${ph.name}: ${formatDate(ph.startDate)} – ${formatDate(ph.endDate)} (${ph.status})`}
              className={`absolute top-0 h-full ${bg} border-r border-white/50`}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          );
        })}
        {/* today marker */}
        {(() => {
          const today = new Date().toISOString().slice(0, 10);
          if (today >= projectStart && today <= projectEnd) {
            const pct = (daysBetween(projectStart, today) / totalDays) * 100;
            return <div className="absolute top-0 h-full w-0.5 bg-red-500 z-10" style={{ left: `${pct}%` }} />;
          }
          return null;
        })()}
      </div>
      {/* legend */}
      <div className="flex gap-4 mt-1 text-[10px] text-slate-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300 inline-block" /> Completed</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> In Progress</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Upcoming</span>
        <span className="flex items-center gap-1"><span className="w-0.5 h-2 bg-red-500 inline-block" /> Today</span>
      </div>
    </div>
  );
}

/* ── Inline editable field ───────────────────────── */
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

/* ── Project card ──────────────────────────────── */
function ZohoProjectCard({ project, teamAllocation, loadedCost, cadToUsdRate, onUpdateProject }: {
  project: ZohoPipelineProject;
  teamAllocation: { name: string; role: string; totalHours: number; rateCard: number | null }[] | undefined;
  loadedCost: number;
  cadToUsdRate: number;
  onUpdateProject: (id: string, updates: Partial<ZohoPipelineProject>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const phases = useMemo(
    () => [...(project.phases ?? [])].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [project.phases],
  );
  const completedPhases = phases.filter((p) => p.isClosed).length;
  const currentPhase = phases.find((p) => !p.isClosed);
  const goLiveDate = getGoLiveDate(project);
  const revenue = project.revenue ?? 0;
  const curr = project.revenueCurrency ?? 'USD';
  const currSymbol = curr === 'CAD' ? 'CA$' : '$';
  // Convert revenue to USD for margin calculation
  const revenueUsd = curr === 'CAD' ? revenue * cadToUsdRate : revenue;
  const margin = revenueUsd - loadedCost;
  const marginPct = revenueUsd > 0 ? Math.round((margin / revenueUsd) * 100) : 0;

  return (
    <Card>
      <div
        className="flex items-start justify-between cursor-pointer gap-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {expanded ? <ChevronDown size={16} className="text-slate-400 shrink-0" /> : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
            <h3 className="font-semibold text-slate-800 text-base">{project.name}</h3>
            <Badge variant={projectStatusVariant(project.status)}>{project.status}</Badge>
          </div>
          <div className="flex items-center gap-4 mt-1 ml-6 text-xs text-slate-500 flex-wrap">
            <span className="flex items-center gap-1"><Users size={12} /> {project.owner}</span>
            <span className="flex items-center gap-1"><Calendar size={12} /> {formatDate(project.startDate)} – {formatDate(project.endDate)}</span>
            {phases.length > 0 && (
              <span className="flex items-center gap-1"><Clock size={12} /> {completedPhases}/{phases.length} phases done</span>
            )}
            {currentPhase && (
              <span className="text-blue-600 font-medium">Current: {currentPhase.name}</span>
            )}
          </div>

          {/* Go-Live date - prominent */}
          {goLiveDate && (
            <div className="flex items-center gap-2 mt-2 ml-6">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-1">
                <Rocket size={14} />
                Go-Live: {formatDate(goLiveDate)}
              </span>
              <GoLiveBadge date={goLiveDate} />
            </div>
          )}

          {/* Revenue, Expected Cost & Expected Margin — always visible */}
          <div className="flex items-center gap-4 mt-2 ml-6 text-xs flex-wrap">
            {revenue > 0 ? (
              <span className="flex items-center gap-1 text-emerald-700">
                <DollarSign size={12} /> Revenue: <Sensitive>{`${currSymbol}${revenue.toLocaleString()} ${curr}`}</Sensitive>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-slate-400"><DollarSign size={12} /> Revenue: <em>not set</em></span>
            )}
            {loadedCost > 0 ? (
              <span className="flex items-center gap-1 text-slate-600">
                <TrendingUp size={12} /> Expected Cost: <Sensitive>{`$${Math.round(loadedCost).toLocaleString()} USD`}</Sensitive>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-slate-400"><TrendingUp size={12} /> Expected Cost: <em>no rate cards</em></span>
            )}
            {revenue > 0 && loadedCost > 0 && (
              <span className={`font-semibold ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                Expected Margin: <Sensitive>{`$${Math.round(margin).toLocaleString()} (${marginPct}%)`}</Sensitive>
                {curr === 'CAD' && <span className="font-normal text-slate-400 ml-1">(converted)</span>}
              </span>
            )}
          </div>
        </div>
        {/* mini progress */}
        {phases.length > 0 && (
          <div className="shrink-0 w-24">
            <div className="text-[10px] text-slate-400 text-right mb-0.5">{Math.round((completedPhases / phases.length) * 100)}%</div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${(completedPhases / phases.length) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {expanded && (
        <div className="mt-4 border-t border-slate-100 pt-4 space-y-4">
          {/* Phase timeline */}
          {phases.length > 0 && project.startDate && project.endDate && (
            <PhaseTimeline phases={phases} projectStart={project.startDate} projectEnd={project.endDate} />
          )}

          {/* Phase table */}
          {phases.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Phases</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-slate-200">
                    <th className="pb-2 font-semibold text-slate-600">Phase</th>
                    <th className="pb-2 font-semibold text-slate-600">Start</th>
                    <th className="pb-2 font-semibold text-slate-600">End</th>
                    <th className="pb-2 font-semibold text-slate-600">Status</th>
                    <th className="pb-2 font-semibold text-slate-600">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {phases.map((ph) => (
                    <tr key={ph.id} className={`border-b border-slate-50 ${ph.isClosed ? 'opacity-60' : ''}`}>
                      <td className="py-1.5 font-medium text-slate-700">{ph.name}</td>
                      <td className="py-1.5 text-slate-500 tabular-nums">{formatDate(ph.startDate)}</td>
                      <td className="py-1.5 text-slate-500 tabular-nums">{formatDate(ph.endDate)}</td>
                      <td className="py-1.5">
                        <Badge variant={phaseStatusVariant(ph)}>
                          {ph.isClosed ? 'Completed' : ph.status}
                        </Badge>
                      </td>
                      <td className="py-1.5 text-slate-500 text-xs">{ph.owner}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Team allocation from forecast store */}
          {teamAllocation && teamAllocation.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-slate-700 mb-2">Team Allocation <span className="font-normal text-slate-400">(from Team tab)</span></h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-slate-200">
                    <th className="pb-2 font-semibold text-slate-600">Employee</th>
                    <th className="pb-2 font-semibold text-slate-600">Role</th>
                    <th className="pb-2 font-semibold text-slate-600">Rate</th>
                    <th className="pb-2 font-semibold text-slate-600 text-right">Total Hrs</th>
                  </tr>
                </thead>
                <tbody>
                  {teamAllocation.map((e) => (
                    <tr key={e.name} className="border-b border-slate-50">
                      <td className="py-1.5 font-medium text-slate-700">{e.name}</td>
                      <td className="py-1.5 text-slate-500 text-xs">{e.role || '—'}</td>
                      <td className="py-1.5 text-slate-500">{e.rateCard ? <Sensitive>{`$${e.rateCard}/hr`}</Sensitive> : '—'}</td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">{e.totalHours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Editable fields: Go-Live Date & Revenue */}
          <div className="flex flex-wrap gap-6 items-center">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Go-Live Date</label>
              <InlineEdit
                value={project.goLiveDate ?? (goLiveDate || '')}
                type="date"
                placeholder="Set go-live date"
                onSave={(v) => onUpdateProject(project.id, { goLiveDate: v || null })}
                className="w-36"
              />
              {!project.goLiveDate && goLiveDate && (
                <span className="text-[10px] text-slate-400 block mt-0.5">Auto-detected from phases</span>
              )}
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Project Revenue</label>
              <div className="flex items-center gap-1">
                <select
                  value={curr}
                  onChange={(e) => onUpdateProject(project.id, { revenueCurrency: e.target.value as 'USD' | 'CAD' })}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="USD">USD</option>
                  <option value="CAD">CAD</option>
                </select>
                <Sensitive
                  placeholder={<span className="text-sm text-slate-400 italic">•••</span>}
                >
                  <InlineEdit
                    value={project.revenue ?? ''}
                    type="number"
                    prefix={currSymbol}
                    placeholder="Set revenue"
                    onSave={(v) => onUpdateProject(project.id, { revenue: parseFloat(v) > 0 ? parseFloat(v) : null })}
                    className="w-32"
                  />
                </Sensitive>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Expected Loaded Cost (USD)</label>
              {loadedCost > 0 ? (
                <span className="text-sm font-medium text-slate-700"><Sensitive>{`$${Math.round(loadedCost).toLocaleString()}`}</Sensitive></span>
              ) : (
                <span className="text-sm text-slate-400 italic">No rate cards assigned</span>
              )}
              <span className="text-[10px] text-slate-400 block mt-0.5">Based on forecasted hours × rate cards</span>
            </div>
            {revenue > 0 && loadedCost > 0 && (
              <div>
                <label className="text-xs text-slate-500 block mb-1">Expected Margin {curr === 'CAD' ? '(CAD→USD converted)' : ''}</label>
                <span className={`text-sm font-bold ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  <Sensitive>{`$${Math.round(margin).toLocaleString()} (${marginPct}%)`}</Sensitive>
                </span>
                {curr === 'CAD' && (
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Revenue <Sensitive>{`${currSymbol}${revenue.toLocaleString()}`}</Sensitive> × {cadToUsdRate} = <Sensitive>{`$${Math.round(revenueUsd).toLocaleString()} USD`}</Sensitive>
                  </span>
                )}
              </div>
            )}
            {revenue > 0 && loadedCost === 0 && (
              <div>
                <label className="text-xs text-slate-500 block mb-1">Expected Margin</label>
                <span className="text-xs text-slate-400 italic">Set rate cards on team members to calculate margin</span>
              </div>
            )}
          </div>

          {(!teamAllocation || teamAllocation.length === 0) && phases.length === 0 && (
            <p className="text-sm text-slate-400 italic">No phases or team allocations yet.</p>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── Main page ──────────────────────────────── */
export default function ProjectPipelinePage() {
  const assignments = useForecastStore((s) => s.assignments);
  const allProjects = usePipelineStore((s) => s.projects);
  const updateProject = usePipelineStore((s) => s.updateProject);
  const cadToUsdRate = useFinancialStore((s) => s.settings.cadToUsdRate) || 0.73;

  // Current projects = Zoho-sourced only
  const currentProjects = useMemo(() => allProjects.filter((p) => p.source === 'zoho'), [allProjects]);

  // Derive team allocation per project from forecast store
  const projectSummaries = useMemo(() => deriveProjectSummaries(assignments), [assignments]);
  const teamByProject = useMemo(() => {
    const map = new Map<string, typeof projectSummaries[0]>();
    for (const ps of projectSummaries) map.set(ps.name.toLowerCase(), ps);
    return map;
  }, [projectSummaries]);

  // Stats
  const activeProjects = currentProjects.filter((p) => !['Completed', 'On Hold'].includes(p.status)).length;
  const totalPhases = currentProjects.reduce((sum, p) => sum + (p.phases?.length ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Current Projects"
        subtitle={`${currentProjects.length} current projects`}
      />

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-slate-800">{currentProjects.length}</div>
          <div className="text-xs text-slate-500">Current Projects</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-blue-600">{activeProjects}</div>
          <div className="text-xs text-slate-500">Active / In Progress</div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-2xl font-bold text-emerald-600">{totalPhases}</div>
          <div className="text-xs text-slate-500">Total Phases</div>
        </div>
      </div>

      {/* Current projects */}
      <h2 className="text-lg font-semibold text-slate-800 mb-3">Current Projects</h2>
      <div className="grid grid-cols-1 gap-3 mb-8">
        {currentProjects.map((project) => {
          const ps = teamByProject.get((project.forecastName ?? project.name).toLowerCase()) ?? teamByProject.get(project.name.toLowerCase());
          return (
            <ZohoProjectCard
              key={project.id}
              project={project}
              teamAllocation={ps?.employees}
              loadedCost={ps?.loadedCost ?? 0}
              cadToUsdRate={cadToUsdRate}
              onUpdateProject={updateProject}
            />
          );
        })}
      </div>

    </>
  );
}
