/**
 * GovernanceSyncModal — match dashboard projects to Delivery Governance
 * projects, then pull each one's plan.
 *
 * The two tools don't agree on names (and won't reliably, since either side
 * can be renamed independently), so the match is made once, confirmed by a
 * human, and then STORED on the project as governanceProjectId. Later syncs
 * reuse the stored link and don't re-guess.
 *
 * What the sync pulls:
 *   - project start / end dates
 *   - the plan, as phases derived from Governance's tasks
 *
 * What it deliberately does NOT touch:
 *   - team allocation. That comes from the Project Team tab (forecast
 *     assignments) and is the dashboard's own source of truth. Governance
 *     has per-task assignees, but they're a different thing from a costed
 *     allocation, and overwriting one with the other would break the cost
 *     calculation.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, X, AlertTriangle, Check, RefreshCw, Ban } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { ZohoPipelineProject, ZohoPhase } from '../../types/forecast';

/** A project as Delivery Governance sees it. */
interface GovProject {
  id: string;
  name: string;
  client: string;
  startDate: string | null;
  plannedEnd: string | null;
  currentEnd: string | null;
  pm: string;
  deliveryLead: string;
  /** 0 means Governance has no plan for it yet — syncing would pull nothing. */
  taskCount: number;
}

interface GovPlan {
  name: string;
  startDate: string | null;
  endDate: string | null;
  phases: ZohoPhase[];
  taskCount: number;
}

/** Sentinel for "don't link this project" — distinct from "not yet chosen". */
const SKIP = '__skip__';

/**
 * Call governance-sync and surface the function's OWN error message.
 *
 * supabase.functions.invoke throws on any non-2xx and leaves `data` null, so
 * the caller only ever sees "Edge Function returned a non-2xx status code" —
 * which tells a user nothing. The real message (e.g. "Governance credentials
 * not configured…", or a Governance login failure) is in the Response hanging
 * off the error as `.context`, so read that back out.
 */
async function callGovernance<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke<T & { error?: string }>('governance-sync', { body });
  if (!error) {
    if (data && (data as { error?: string }).error) {
      return { data: null, error: (data as { error?: string }).error! };
    }
    return { data: data as T, error: null };
  }
  const ctx = (error as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const parsed = await ctx.clone().json() as { error?: string };
      if (parsed?.error) return { data: null, error: parsed.error };
    } catch {
      const text = await ctx.clone().text().catch(() => '');
      if (text) return { data: null, error: text.slice(0, 400) };
    }
  }
  return { data: null, error: error.message || 'Sync failed.' };
}

interface Props {
  /** Active (non-archived) dashboard projects, the ones worth matching. */
  projects: ZohoPipelineProject[];
  onClose: () => void;
  /** Called once per project that actually changed. */
  onApply: (updates: { id: string; patch: Partial<ZohoPipelineProject> }[]) => void;
}

/**
 * Normalise for comparison: lowercase, strip punctuation and spacing, so
 * "Qu Data - Phase 1" and "QuData Phase1" collapse to the same key.
 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Suggest a Governance project for a dashboard project.
 *
 * Exact normalised name first, then containment either way (so "Copeland"
 * finds "Copeland Support"). Returns null rather than a weak guess — a wrong
 * auto-match that someone clicks past is worse than no match, because it
 * writes another project's dates over this one.
 */
function suggest(p: ZohoPipelineProject, gov: GovProject[]): GovProject | null {
  const candidates = [p.name, p.forecastName ?? ''].filter(Boolean).map(norm);
  for (const c of candidates) {
    const exact = gov.find((g) => norm(g.name) === c);
    if (exact) return exact;
  }
  for (const c of candidates) {
    if (c.length < 4) continue;
    const partial = gov.find((g) => norm(g.name).includes(c) || c.includes(norm(g.name)));
    if (partial) return partial;
  }
  return null;
}

function fmt(d: string | null): string {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' });
}

export function GovernanceSyncModal({ projects, onClose, onApply }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gov, setGov] = useState<GovProject[]>([]);
  /** dashboard project id → governance project id (or SKIP). */
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ name: string; note: string; ok: boolean }[] | null>(null);

  // Load the Governance project list and pre-fill the matches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: e } = await callGovernance<{ projects: GovProject[] }>({ action: 'list' });
      if (cancelled) return;
      if (e || !data?.projects) {
        setError(e || 'Could not reach Delivery Governance.');
        setLoading(false);
        return;
      }
      setGov(data.projects);
      // A link confirmed previously wins over a fresh guess.
      const initial: Record<string, string> = {};
      for (const p of projects) {
        if (p.governanceProjectId && data.projects.some((g) => g.id === p.governanceProjectId)) {
          initial[p.id] = p.governanceProjectId;
        } else {
          initial[p.id] = suggest(p, data.projects)?.id ?? '';
        }
      }
      setChoice(initial);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projects]);

  const govById = useMemo(() => new Map(gov.map((g) => [g.id, g])), [gov]);

  const linkedCount = Object.values(choice).filter((v) => v && v !== SKIP).length;
  /** Linked to a Governance project that has no tasks — sync would pull nothing. */
  const emptyPlanCount = Object.values(choice)
    .filter((v) => v && v !== SKIP)
    .filter((v) => (govById.get(v)?.taskCount ?? 0) === 0).length;

  const runSync = async () => {
    setSyncing(true);
    setError(null);
    const pairs = projects
      .map((p) => ({ p, gid: choice[p.id] }))
      .filter((x): x is { p: ZohoPipelineProject; gid: string } => !!x.gid && x.gid !== SKIP);

    const { data, error: e } = await callGovernance<{ plans: Record<string, GovPlan> }>({
      action: 'plan', projectIds: pairs.map((x) => x.gid),
    });
    if (e || !data?.plans) {
      setError(e || 'Sync failed.');
      setSyncing(false);
      return;
    }

    const now = new Date().toISOString();
    const updates: { id: string; patch: Partial<ZohoPipelineProject> }[] = [];
    const report: { name: string; note: string; ok: boolean }[] = [];

    for (const { p, gid } of pairs) {
      const plan = data.plans[gid];
      if (!plan) {
        report.push({ name: p.name, note: 'not found in Governance', ok: false });
        continue;
      }
      const patch: Partial<ZohoPipelineProject> = {
        governanceProjectId: gid,
        governanceProjectName: plan.name,
        governanceSyncedAt: now,
      };
      // Only take dates Governance actually has. A blank there means "not
      // set", not "clear ours" — clobbering a real date with null would lose
      // information the dashboard already had.
      if (plan.startDate) patch.startDate = plan.startDate;
      if (plan.endDate) patch.endDate = plan.endDate;

      if (plan.phases.length > 0) {
        patch.phases = plan.phases;
        report.push({
          name: p.name,
          note: `${plan.phases.length} phases from ${plan.taskCount} tasks`,
          ok: true,
        });
      } else {
        // Governance has no plan for this one. Keep whatever phases the
        // dashboard already has rather than blanking them — several projects
        // still carry a full phase list from the old Zoho sync, and an empty
        // pull must not destroy it.
        report.push({
          name: p.name,
          note: 'no plan in Governance — dates only, existing phases kept',
          ok: true,
        });
      }
      updates.push({ id: p.id, patch });
    }

    // Projects the user explicitly unlinked.
    for (const p of projects) {
      if (choice[p.id] === SKIP && p.governanceProjectId) {
        updates.push({ id: p.id, patch: { governanceProjectId: null, governanceProjectName: null } });
        report.push({ name: p.name, note: 'unlinked', ok: true });
      }
    }

    onApply(updates);
    setResult(report);
    setSyncing(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[6vh]" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[86vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-white shrink-0">
          <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Link2 size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-slate-900">Sync with Delivery Governance</div>
            <div className="text-[11px] text-slate-500">
              Confirm which Governance project each one is, then pull its dates and plan.
              Team allocation stays from the Project Team tab.
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" /> Loading Governance projects…
            </div>
          )}

          {error && !loading && (
            <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2.5">
              <div className="font-semibold mb-0.5">Couldn&apos;t reach Delivery Governance</div>
              {error}
            </div>
          )}

          {result && (
            <div className="space-y-1.5">
              <div className="text-sm font-semibold text-slate-800 mb-2">Sync complete</div>
              {result.map((r) => (
                <div key={r.name} className="flex items-start gap-2 text-xs">
                  {r.ok
                    ? <Check size={13} className="text-emerald-600 mt-0.5 shrink-0" />
                    : <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />}
                  <span className="font-medium text-slate-800">{r.name}</span>
                  <span className="text-slate-500">— {r.note}</span>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && !result && (
            <>
              <div className="grid grid-cols-[1fr_auto_1.3fr] gap-x-3 gap-y-0 items-center px-2 pb-1.5 mb-1 border-b border-slate-100">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">This tool</div>
                <div />
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Delivery Governance</div>
              </div>

              {projects.map((p) => {
                const sel = choice[p.id] ?? '';
                const g = sel && sel !== SKIP ? govById.get(sel) : null;
                const noPlan = g ? g.taskCount === 0 : false;
                return (
                  <div key={p.id} className="grid grid-cols-[1fr_auto_1.3fr] gap-x-3 items-center px-2 py-2 rounded-lg hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{p.name}</div>
                      <div className="text-[11px] text-slate-400">
                        {fmt(p.startDate)} – {fmt(p.endDate)} · {p.phases?.length ?? 0} phases
                      </div>
                    </div>

                    <div className="text-slate-300">
                      {sel === SKIP ? <Ban size={14} className="text-slate-400" /> : <Link2 size={14} />}
                    </div>

                    <div className="min-w-0">
                      <select
                        value={sel}
                        onChange={(e) => setChoice((c) => ({ ...c, [p.id]: e.target.value }))}
                        className={`w-full px-2.5 py-1.5 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                          sel === SKIP ? 'border-slate-200 text-slate-400'
                          : sel ? 'border-slate-300 text-slate-800'
                          : 'border-amber-300 bg-amber-50 text-amber-900'
                        }`}
                      >
                        <option value="">— pick a match —</option>
                        <option value={SKIP}>Don&apos;t link this project</option>
                        {gov.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}{o.taskCount === 0 ? '  (no plan)' : `  (${o.taskCount} tasks)`}
                          </option>
                        ))}
                      </select>
                      {g && (
                        <div className={`text-[11px] mt-0.5 ${noPlan ? 'text-amber-700' : 'text-slate-400'}`}>
                          {noPlan
                            ? 'No plan in Governance — dates only, existing phases kept'
                            : `${fmt(g.startDate)} – ${fmt(g.currentEnd ?? g.plannedEnd)} · ${g.taskCount} tasks`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 shrink-0">
          {!result && !loading && !error && (
            <div className="text-[11px] text-slate-500 mb-2">
              {linkedCount} of {projects.length} matched
              {emptyPlanCount > 0 && (
                <span className="text-amber-700">
                  {' '}· {emptyPlanCount} linked to a Governance project with no plan yet
                </span>
              )}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            >
              {result ? 'Done' : 'Cancel'}
            </button>
            {!result && (
              <button
                type="button"
                onClick={() => void runSync()}
                disabled={loading || syncing || !!error || linkedCount === 0}
                className="text-xs font-semibold px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {syncing ? 'Syncing…' : `Sync ${linkedCount} project${linkedCount === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
