import { useState, useMemo, useRef, useEffect, lazy, Suspense } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { SEGMENTS } from '../lib/deliveryRebuild';
import type { DeliverySegment } from '../types/delivery';
import { useForecastStore, usePipelineStore, useFinancialStore, useActualHoursStore } from '../store';
import { PageHeader } from '../components/shared/PageHeader';
import { Card, Badge, StatCard } from '../components/ui';
import { Sensitive } from '../components/Sensitive';
import { deriveProjectSummaries } from '../lib/parseSpreadsheet';
import type { ZohoPipelineProject, ZohoPhase } from '../types/forecast';
import { Loader2, ChevronDown, ChevronRight, Users, Clock, Rocket, Archive, ArchiveRestore, Link2, ListChecks, FolderKanban, AlertTriangle, Search } from 'lucide-react';

const IndiaRosterPage = lazy(() => import('./IndiaRosterPage'));

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

/* ── Phase timeline bar ──────────────────────────────── */
function PhaseTimeline({ phases, projectStart, projectEnd }: { phases: ZohoPhase[]; projectStart: string; projectEnd: string }) {
  const totalDays = Math.max(daysBetween(projectStart, projectEnd), 1);

  return (
    <div className="relative mt-3 mb-1">
      {/* date labels */}
      <div className="flex justify-between text-[10px] text-muted/70 mb-1">
        <span>{formatDate(projectStart)}</span>
        <span>{formatDate(projectEnd)}</span>
      </div>
      {/* track */}
      <div className="relative h-6 bg-surface-2 rounded-full overflow-hidden">
        {phases.map((ph) => {
          const offsetDays = Math.max(daysBetween(projectStart, ph.startDate), 0);
          const durationDays = Math.max(daysBetween(ph.startDate, ph.endDate), 1);
          const left = (offsetDays / totalDays) * 100;
          const width = Math.max((durationDays / totalDays) * 100, 1);
          const bg = ph.isClosed
            ? 'bg-line'
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
      <div className="flex gap-4 mt-1 text-[10px] text-muted">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-line inline-block" /> Completed</span>
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
        className={`rounded border border-primary/40 bg-surface px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      />
    );
  }
  return (
    <span onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(String(value ?? '')); }} className="cursor-pointer hover:text-primary">
      {value ? `${prefix}${value}` : <span className="text-muted/70 italic">{placeholder}</span>}
    </span>
  );
}

/* ── Actuals ──────────────────────────────── */
/** Hours logged against one project, from `unified_actual_hours`
 *  (submitted + approved time entries). */
interface ProjectActuals {
  total: number;
  thisMonth: number;
  byPerson: Map<string, { name: string; hours: number; thisMonth: number }>;
}

const personKey = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
const fmtHrs = (n: number) => (Math.round(n * 10) / 10).toLocaleString();

/** Column template shared by the list header and every project row. */
const ROW_GRID = 'grid-cols-[minmax(220px,1.6fr)_minmax(150px,1.2fr)_90px_minmax(130px,1fr)_100px_84px]';

/* ── Project row ──────────────────────────────── */
function ZohoProjectCard({ project, teamAllocation, actuals, loadedCost, cadToUsdRate, onUpdateProject, onArchive, onRestore }: {
  project: ZohoPipelineProject;
  teamAllocation: { name: string; role: string; totalHours: number; rateCard: number | null }[] | undefined;
  actuals: ProjectActuals | undefined;
  loadedCost: number;
  cadToUsdRate: number;
  onUpdateProject: (id: string, updates: Partial<ZohoPipelineProject>) => void;
  /** Present on active cards only. */
  onArchive?: (id: string) => void;
  /** Present on archived cards only. */
  onRestore?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
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
  const forecastHours = (teamAllocation ?? []).reduce((sum, e) => sum + e.totalHours, 0);

  // Forecast and actual side by side: everyone allocated, plus anyone who
  // logged time here without an allocation.
  const teamRows = useMemo(() => {
    const rows = (teamAllocation ?? []).map((e) => {
      const a = actuals?.byPerson.get(personKey(e.name));
      return { ...e, actual: a?.hours ?? 0, actualMonth: a?.thisMonth ?? 0, allocated: true };
    });
    const seen = new Set(rows.map((r) => personKey(r.name)));
    for (const [k, a] of actuals?.byPerson ?? []) {
      if (seen.has(k)) continue;
      rows.push({ name: a.name, role: '', totalHours: 0, rateCard: null, actual: a.hours, actualMonth: a.thisMonth, allocated: false });
    }
    return rows;
  }, [teamAllocation, actuals]);

  const hoursPct = forecastHours > 0 ? Math.round(((actuals?.total ?? 0) / forecastHours) * 100) : null;
  const glDays = goLiveDate ? daysUntilGoLive(goLiveDate) : null;

  return (
    <div className={`border-t border-line/40 first:border-t-0 ${expanded ? 'bg-surface-2/30' : ''}`}>
      <div
        className={`grid ${ROW_GRID} items-center gap-4 px-5 py-3 cursor-pointer hover:bg-surface-2/50`}
        onClick={() => setExpanded(!expanded)}
      >
        {/* Project */}
        <div className="flex min-w-0 items-start gap-2">
          {expanded ? <ChevronDown size={16} className="mt-0.5 text-muted/70 shrink-0" /> : <ChevronRight size={16} className="mt-0.5 text-muted/70 shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-semibold text-ink">{project.name}</h3>
              <Badge variant={projectStatusVariant(project.status)}>{project.status}</Badge>
            </div>
            <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted"><Users size={11} /> {project.owner || 'No owner'} · {formatDate(project.startDate)} – {formatDate(project.endDate)}</div>
          </div>
        </div>

        {/* Phases — one segment per phase */}
        <div className="min-w-0">
          {phases.length > 0 ? (
            <>
              <div className="flex h-2 gap-0.5" title={phases.map((ph) => `${ph.isClosed ? '✓' : ph.id === currentPhase?.id ? '▶' : '·'} ${ph.name}`).join('\n')}>
                {phases.map((ph) => (
                  <span key={ph.id} className={`flex-1 rounded-full ${ph.isClosed ? 'bg-green' : ph.id === currentPhase?.id ? 'bg-brand' : 'bg-line'}`} />
                ))}
              </div>
              <div className="mt-1 truncate text-xs text-muted">
                <span className="font-semibold text-ink tabular-nums">{completedPhases}/{phases.length}</span>
                {currentPhase ? <> · now <span className="font-medium text-brand-dark">{currentPhase.name}</span></> : ' · all phases done'}
              </div>
            </>
          ) : <span className="text-xs text-muted/70">No phases yet</span>}
        </div>

        {/* Go-live */}
        <div className="min-w-0">
          {goLiveDate && glDays != null ? (
            <>
              <div className={`flex items-center gap-1.5 text-sm font-semibold ${glDays < 0 ? 'text-muted' : glDays <= 7 ? 'text-rose' : glDays <= 30 ? 'text-gold' : 'text-ink'}`}>
                <Rocket size={13} /> {glDays < 0 ? 'Live' : glDays === 0 ? 'Today' : `${glDays}d`}
              </div>
              <div className="text-xs text-muted">{formatDate(goLiveDate)}</div>
            </>
          ) : <span className="text-xs text-muted/70">No go-live set</span>}
        </div>

        {/* Hours — actual against forecast */}
        <div className="min-w-0">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            {hoursPct != null && <div className={`h-full rounded-full ${hoursPct > 110 ? 'bg-rose' : hoursPct > 90 ? 'bg-gold' : 'bg-teal'}`} style={{ width: `${Math.min(100, hoursPct)}%` }} />}
          </div>
          <div className="mt-1 truncate text-xs text-muted">
            <span className="font-semibold text-ink tabular-nums">{fmtHrs(actuals?.total ?? 0)}</span>
            {forecastHours > 0 ? <> of {fmtHrs(forecastHours)} h{hoursPct != null && hoursPct > 110 && <span className="font-semibold text-rose"> · over</span>}</> : ' h logged · no forecast'}
          </div>
        </div>

        {/* Margin */}
        <div className="min-w-0 text-right">
          {revenue > 0 && loadedCost > 0 ? (
            <Sensitive placeholder={<span className="text-sm text-muted/70">•••</span>}>
              <div className={`text-sm font-bold tabular-nums ${marginPct >= 30 ? 'text-green' : marginPct >= 0 ? 'text-gold' : 'text-rose'}`}>{marginPct}%</div>
              <div className="text-xs text-muted tabular-nums">${Math.round(margin / 1000).toLocaleString()}k margin</div>
            </Sensitive>
          ) : <span className="text-xs text-muted/70">{revenue > 0 ? 'No rate cards' : 'Revenue not set'}</span>}
        </div>

        {/* Archive / restore — stopPropagation so the row doesn't expand under the click */}
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {project.governanceProjectId && (
            <Link to={`/project-plans/${project.governanceProjectId}`} title="Open project plan" aria-label={`Open the plan for ${project.name}`}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-primary"><ListChecks size={15} /></Link>
          )}
          {onRestore && (
            <button onClick={() => onRestore(project.id)} title="Restore to the active project list" aria-label={`Restore ${project.name}`}
              className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"><ArchiveRestore size={15} /></button>
          )}
          {onArchive && (!confirmArchive ? (
            <button onClick={() => setConfirmArchive(true)} title="Move to Archive — project stops appearing in the active project list" aria-label={`Archive ${project.name}`}
              className="rounded-lg p-1.5 text-muted hover:bg-gold/12 hover:text-gold"><Archive size={15} /></button>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => { onArchive(project.id); setConfirmArchive(false); }} className="px-2 py-1 text-xs font-semibold text-white bg-gold rounded">Archive</button>
              <button onClick={() => setConfirmArchive(false)} className="px-2 py-1 text-xs text-muted bg-surface-2 rounded">No</button>
            </div>
          ))}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-line/40 px-5 py-4 pl-11 space-y-4">
          {/* Plan now lives in the Dashboard (migration 033). Migrated plans keep
              their Governance id, so the existing link is the plan's id. */}
          {project.governanceProjectId && (
            <Link
              to={`/project-plans/${project.governanceProjectId}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <ListChecks size={13} /> Open project plan
            </Link>
          )}
          {/* Phase timeline */}
          {phases.length > 0 && project.startDate && project.endDate && (
            <PhaseTimeline phases={phases} projectStart={project.startDate} projectEnd={project.endDate} />
          )}

          {/* Phase table */}
          {phases.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-ink/80 mb-2">Phases</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-line">
                    <th className="pb-2 font-semibold text-muted">Phase</th>
                    <th className="pb-2 font-semibold text-muted">Start</th>
                    <th className="pb-2 font-semibold text-muted">End</th>
                    <th className="pb-2 font-semibold text-muted">Status</th>
                    <th className="pb-2 font-semibold text-muted">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {phases.map((ph) => (
                    <tr key={ph.id} className={`border-b border-line/40 ${ph.isClosed ? 'opacity-60' : ''}`}>
                      <td className="py-1.5 font-medium text-ink/80">{ph.name}</td>
                      <td className="py-1.5 text-muted tabular-nums">{formatDate(ph.startDate)}</td>
                      <td className="py-1.5 text-muted tabular-nums">{formatDate(ph.endDate)}</td>
                      <td className="py-1.5">
                        <Badge variant={phaseStatusVariant(ph)}>
                          {ph.isClosed ? 'Completed' : ph.status}
                        </Badge>
                      </td>
                      <td className="py-1.5 text-muted text-xs">{ph.owner}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Team allocation from forecast store */}
          {teamRows.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-ink/80 mb-2">Team Allocation &amp; Actuals <span className="font-normal text-muted/70">(forecast from Team tab · actuals from submitted and approved time)</span></h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-line">
                    <th className="pb-2 font-semibold text-muted">Employee</th>
                    <th className="pb-2 font-semibold text-muted">Role</th>
                    <th className="pb-2 font-semibold text-muted">Rate</th>
                    <th className="pb-2 font-semibold text-muted text-right">Forecast Hrs</th>
                    <th className="pb-2 font-semibold text-muted text-right">Actual Hrs</th>
                    <th className="pb-2 font-semibold text-muted text-right">This Month</th>
                  </tr>
                </thead>
                <tbody>
                  {teamRows.map((e) => (
                    <tr key={e.name} className="border-b border-line/40">
                      <td className="py-1.5 font-medium text-ink/80">
                        {e.name}
                        {!e.allocated && <span className="ml-2 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">not allocated</span>}
                      </td>
                      <td className="py-1.5 text-muted text-xs">{e.role || '—'}</td>
                      <td className="py-1.5 text-muted">{e.rateCard ? <Sensitive>{`$${e.rateCard}/hr`}</Sensitive> : '—'}</td>
                      <td className="py-1.5 text-right tabular-nums">{e.allocated ? fmtHrs(e.totalHours) : '—'}</td>
                      <td className={`py-1.5 text-right font-semibold tabular-nums ${e.allocated && e.totalHours > 0 && e.actual > e.totalHours * 1.1 ? 'text-red-600' : ''}`}>{fmtHrs(e.actual)}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted">{fmtHrs(e.actualMonth)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Editable fields: Go-Live Date & Revenue */}
          <div className="flex flex-wrap gap-6 items-center">
            <div>
              <label className="text-xs text-muted block mb-1">Go-Live Date</label>
              <InlineEdit
                value={project.goLiveDate ?? (goLiveDate || '')}
                type="date"
                placeholder="Set go-live date"
                onSave={(v) => onUpdateProject(project.id, { goLiveDate: v || null })}
                className="w-36"
              />
              {!project.goLiveDate && goLiveDate && (
                <span className="text-[10px] text-muted/70 block mt-0.5">Auto-detected from phases</span>
              )}
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Project Revenue</label>
              <div className="flex items-center gap-1">
                <select
                  value={curr}
                  onChange={(e) => onUpdateProject(project.id, { revenueCurrency: e.target.value as 'USD' | 'CAD' })}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded border border-line bg-surface px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                >
                  <option value="USD">USD</option>
                  <option value="CAD">CAD</option>
                </select>
                <Sensitive
                  placeholder={<span className="text-sm text-muted/70 italic">•••</span>}
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
              <label className="text-xs text-muted block mb-1">Expected Loaded Cost (USD)</label>
              {loadedCost > 0 ? (
                <span className="text-sm font-medium text-ink/80"><Sensitive>{`$${Math.round(loadedCost).toLocaleString()}`}</Sensitive></span>
              ) : (
                <span className="text-sm text-muted/70 italic">No rate cards assigned</span>
              )}
              <span className="text-[10px] text-muted/70 block mt-0.5">Based on forecasted hours × rate cards</span>
            </div>
            {revenue > 0 && loadedCost > 0 && (
              <div>
                <label className="text-xs text-muted block mb-1">Expected Margin {curr === 'CAD' ? '(CAD→USD converted)' : ''}</label>
                <span className={`text-sm font-bold ${margin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  <Sensitive>{`$${Math.round(margin).toLocaleString()} (${marginPct}%)`}</Sensitive>
                </span>
                {curr === 'CAD' && (
                  <span className="text-[10px] text-muted/70 block mt-0.5">
                    Revenue <Sensitive>{`${currSymbol}${revenue.toLocaleString()}`}</Sensitive> × {cadToUsdRate} = <Sensitive>{`$${Math.round(revenueUsd).toLocaleString()} USD`}</Sensitive>
                  </span>
                )}
              </div>
            )}
            {revenue > 0 && loadedCost === 0 && (
              <div>
                <label className="text-xs text-muted block mb-1">Expected Margin</label>
                <span className="text-xs text-muted/70 italic">Set rate cards on team members to calculate margin</span>
              </div>
            )}
          </div>

          {teamRows.length === 0 && phases.length === 0 && (
            <p className="text-sm text-muted/70 italic">No phases or team allocations yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main page ──────────────────────────────── */
type CpTab = 'projects' | 'roster';

/**
 * Current Projects — one place for everything we deliver:
 *   Projects   fixed-price and T&M projects, grouped Strategic Accounts / SMB / Strategic Placement
 *   T&M Roster India T&M placements (synced from Sales Planning 2026), managed by Vivek
 * Managers see the T&M Roster only — the access they had on India Roster.
 */
export default function ProjectPipelinePage() {
  const role = useAuthStore((s) => s.currentUser?.role);
  const isAdmin = useAuthStore((s) => !!s.currentUser?.isAdmin) || role === 'admin';
  const [params, setParams] = useSearchParams();
  const tab: CpTab = !isAdmin || params.get('tab') === 'roster' ? 'roster' : 'projects';
  const setTab = (t: CpTab) => setParams(t === 'projects' ? {} : { tab: t }, { replace: true });
  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        tone="brand"
        title="Current Projects"
        subtitle={tab === 'roster'
          ? 'T&M placements under Strategic Placement — India roster synced from Sales Planning 2026. Managed by Vivek Royan.'
          : 'Strategic accounts, SMB and strategic placements in flight. Click a row for phases, team and actuals.'}
        action={isAdmin ? (
          <Link to="/project-plans" className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-line text-ink hover:bg-surface-2">
            <Link2 size={14} /> Project Plans
          </Link>
        ) : undefined}
      />
      {isAdmin && (
        <div className="mb-5 inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist">
          {([['projects', 'Projects'], ['roster', 'T&M Roster · Strategic Placement']] as [CpTab, string][]).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`px-4 py-1.5 text-sm font-semibold rounded-md ${tab === k ? 'bg-primary text-white' : 'text-muted hover:text-ink'}`}>{label}</button>
          ))}
        </div>
      )}
      {tab === 'projects' ? <ProjectsTab /> : (
        <Suspense fallback={<div className="flex items-center gap-2 py-10 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Loading roster…</div>}>
          <IndiaRosterPage embedded />
        </Suspense>
      )}
    </>
  );
}

function ProjectsTab() {
  const assignments = useForecastStore((s) => s.assignments);
  const allProjects = usePipelineStore((s) => s.projects);
  const updateProject = usePipelineStore((s) => s.updateProject);
  const cadToUsdRate = useFinancialStore((s) => s.settings.cadToUsdRate) || 0.73;
  const actualEntries = useActualHoursStore((s) => s.entries);

  // Actual hours per project (by name, case-insensitive) and per person.
  const actualsByProject = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    const map = new Map<string, ProjectActuals>();
    for (const e of actualEntries) {
      if (!e.project || !e.hours) continue;
      const key = e.project.trim().toLowerCase();
      let pa = map.get(key);
      if (!pa) { pa = { total: 0, thisMonth: 0, byPerson: new Map() }; map.set(key, pa); }
      const inMonth = e.workDate?.startsWith(month) ?? false;
      pa.total += e.hours;
      if (inMonth) pa.thisMonth += e.hours;
      const name = e.employeeName || e.email || 'Unknown';
      const pk = personKey(name);
      const pp = pa.byPerson.get(pk) ?? { name, hours: 0, thisMonth: 0 };
      pp.hours += e.hours;
      if (inMonth) pp.thisMonth += e.hours;
      pa.byPerson.set(pk, pp);
    }
    return map;
  }, [actualEntries]);
  const actualsFor = (p: ZohoPipelineProject) =>
    actualsByProject.get(p.name.trim().toLowerCase()) ??
    (p.forecastName ? actualsByProject.get(p.forecastName.trim().toLowerCase()) : undefined);

  // Current projects = Zoho-sourced only.
  //
  // Archived ones (status === 'Archived') drop out of the main list into their
  // own collapsed section. Archiving is a status flip, not a delete — the row,
  // its phases and its cost history all stay put, and Restore puts it back.
  // Status is used rather than a separate flag so it survives a round-trip
  // through Supabase without a schema change.
  const [showArchived, setShowArchived] = useState(false);
  const zohoProjects = useMemo(() => allProjects.filter((p) => p.source === 'zoho'), [allProjects]);
  const currentProjects = useMemo(() => zohoProjects.filter((p) => p.status !== 'Archived'), [zohoProjects]);
  const archivedProjects = useMemo(() => zohoProjects.filter((p) => p.status === 'Archived'), [zohoProjects]);

  const archive = (id: string) => updateProject(id, { status: 'Archived' });
  // 'In Progress' is the neutral re-entry status — the real one would have to
  // come back from Zoho, and that sync no longer runs.
  const restore = (id: string) => updateProject(id, { status: 'In Progress' });

  // Derive team allocation per project from forecast store
  const projectSummaries = useMemo(() => deriveProjectSummaries(assignments), [assignments]);
  const teamByProject = useMemo(() => {
    const map = new Map<string, typeof projectSummaries[0]>();
    for (const ps of projectSummaries) map.set(ps.name.toLowerCase(), ps);
    return map;
  }, [projectSummaries]);

  // Segment per Current Projects row, via its plan's account (migration 048).
  const [segOf, setSegOf] = useState<Record<string, { segment: DeliverySegment; account: string }>>({});
  useEffect(() => {
    void supabase.from('delivery_projects').select('pipeline_project_id, delivery_accounts(name, segment)').not('pipeline_project_id', 'is', null)
      .then(({ data }) => {
        const m: Record<string, { segment: DeliverySegment; account: string }> = {};
        for (const r of (data ?? []) as unknown as { pipeline_project_id: string; delivery_accounts: { name: string; segment: DeliverySegment } | null }[]) {
          if (r.delivery_accounts) m[r.pipeline_project_id] = { segment: r.delivery_accounts.segment, account: r.delivery_accounts.name };
        }
        setSegOf(m);
      });
  }, []);

  // Filters + sort
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState<'golive' | 'name' | 'progress'>('golive');
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of currentProjects) m.set(p.status, (m.get(p.status) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [currentProjects]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const progress = (p: ZohoPipelineProject) => { const ph = p.phases ?? []; return ph.length ? ph.filter((x) => x.isClosed).length / ph.length : 0; };
    const gl = (p: ZohoPipelineProject) => { const d = getGoLiveDate(p); if (!d) return Number.MAX_SAFE_INTEGER; const n = daysUntilGoLive(d); return n < 0 ? Number.MAX_SAFE_INTEGER - 1 : n; };
    return currentProjects
      .filter((p) => statusFilter === 'all' || p.status === statusFilter)
      .filter((p) => !needle || `${p.name} ${p.owner ?? ''}`.toLowerCase().includes(needle))
      .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'progress' ? progress(b) - progress(a) : gl(a) - gl(b) || a.name.localeCompare(b.name));
  }, [currentProjects, query, statusFilter, sort]);

  // Stats
  const delayed = currentProjects.filter((p) => p.status.toLowerCase() === 'delayed').length;
  const goLiveSoon = currentProjects.filter((p) => { const d = getGoLiveDate(p); if (!d) return false; const n = daysUntilGoLive(d); return n >= 0 && n <= 30; }).length;
  const hoursThisMonth = currentProjects.reduce((sum, p) => sum + (actualsFor(p)?.thisMonth ?? 0), 0);

  const renderRow = (project: ZohoPipelineProject, archived: boolean) => {
    const ps = teamByProject.get((project.forecastName ?? project.name).toLowerCase()) ?? teamByProject.get(project.name.toLowerCase());
    return (
      <ZohoProjectCard
        key={project.id}
        project={project}
        teamAllocation={ps?.employees}
        actuals={actualsFor(project)}
        loadedCost={ps?.loadedCost ?? 0}
        cadToUsdRate={cadToUsdRate}
        onUpdateProject={updateProject}
        {...(archived ? { onRestore: restore } : { onArchive: archive })}
      />
    );
  };
  const listHeader = (
    <div className={`grid ${ROW_GRID} gap-4 px-5 py-2.5 border-b border-line/60 bg-surface-2/50 text-[10px] font-semibold uppercase tracking-wide text-muted`}>
      <div className="pl-6">Project</div><div>Phases</div><div>Go-live</div><div>Hours</div><div className="text-right">Margin</div><div />
    </div>
  );

  return (
    <>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <StatCard label="Current projects" value={currentProjects.length} icon={<FolderKanban size={20} />} tone="blue" />
        <StatCard label="Go-live in 30 days" value={goLiveSoon} icon={<Rocket size={20} />} tone={goLiveSoon > 0 ? 'gold' : 'green'} />
        <StatCard label="Delayed" value={delayed} icon={<AlertTriangle size={20} />} tone={delayed > 0 ? 'rose' : 'green'} />
        <StatCard label="Hours this month" value={fmtHrs(hoursThisMonth)} icon={<Clock size={20} />} tone="teal" />
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
          {[['all', currentProjects.length] as [string, number], ...statusCounts].map(([st, n]) => (
            <button key={st} type="button" aria-pressed={statusFilter === st} onClick={() => setStatusFilter(st)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${statusFilter === st ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink/80 hover:bg-surface-2'}`}>
              {st === 'all' ? 'All' : st}<span className={`tabular-nums text-[10px] ${statusFilter === st ? 'text-white/85' : 'text-muted'}`}>{n}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a project or owner" aria-label="Find a project or owner"
              className="w-56 rounded-lg border border-line bg-surface py-1.5 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort projects" className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm">
            <option value="golive">Go-live soonest</option>
            <option value="progress">Most progressed</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {/* Current projects — one list, not a stack of cards */}
      <Card flush className="mb-8 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[900px]">
            {listHeader}
            {visible.length === 0
              ? <p className="px-5 py-10 text-center text-sm text-muted">No projects match.</p>
              : [...SEGMENTS.map((sg) => ({ key: sg.key as string, label: sg.label })), { key: 'none', label: 'Not grouped yet' }].map((sg) => {
                  const rows = visible.filter((p) => (segOf[p.id]?.segment ?? 'none') === sg.key);
                  if (!rows.length) return null;
                  return [
                    <div key={`seg-${sg.key}`} className="flex items-baseline gap-2 px-5 py-2 bg-surface-2/70 border-b border-line/60">
                      <span className="text-sm font-bold text-ink">{sg.label}</span>
                      <span className="text-xs text-muted">{rows.length} project{rows.length === 1 ? '' : 's'}</span>
                      {sg.key === 'placement' && <span className="text-xs text-muted">· T&M, managed by Vivek</span>}
                    </div>,
                    ...[...new Set(rows.map((p) => segOf[p.id]?.account ?? ''))].sort().flatMap((acct) => {
                      const inAcct = rows.filter((p) => (segOf[p.id]?.account ?? '') === acct);
                      return [
                        acct && (inAcct.length > 1 || sg.key === 'strategic')
                          ? <div key={`acct-${sg.key}-${acct}`} className="px-5 pl-8 py-1.5 border-b border-line/40 text-xs font-semibold text-ink/80">{acct} <span className="font-normal text-muted">· {inAcct.length}</span></div>
                          : null,
                        ...inAcct.map((p) => renderRow(p, false)),
                      ];
                    }),
                  ];
                })}
          </div>
        </div>
      </Card>

      {/* Archived — collapsed by default; reference, not daily work */}
      {archivedProjects.length > 0 && (
        <div className="mb-8">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="w-full flex items-center gap-2 text-left py-2 group"
          >
            {showArchived ? <ChevronDown size={16} className="text-muted/70" /> : <ChevronRight size={16} className="text-muted/70" />}
            <Archive size={15} className="text-amber-600" />
            <h2 className="text-lg font-semibold text-ink">Archived</h2>
            <span className="text-xs font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">
              {archivedProjects.length}
            </span>
            <span className="text-xs text-muted/70 font-normal">
              wrapped up — hidden from the active list, nothing deleted
            </span>
            <span className="ml-auto text-xs text-muted group-hover:text-ink/80">
              {showArchived ? 'Hide' : 'Show'}
            </span>
          </button>

          {showArchived && (
            <Card flush className="mt-2 overflow-hidden opacity-80 hover:opacity-100 transition-opacity">
              <div className="overflow-x-auto"><div className="min-w-[900px]">
                {listHeader}
                {archivedProjects.map((p) => renderRow(p, true))}
              </div></div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
