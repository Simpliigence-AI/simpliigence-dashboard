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
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, X, AlertTriangle, Check, RefreshCw, Ban, Plus } from 'lucide-react';
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
  /** Active (non-archived) dashboard projects — the rows shown for matching. */
  projects: ZohoPipelineProject[];
  /**
   * EVERY pipeline project, including archived ones and manual pipeline
   * entries — not just the rows on screen.
   *
   * A Governance project that already exists here as an archived or pipeline
   * project must default to linking, never to creating, or the sync quietly
   * makes duplicates. Orange Capital Partners is exactly this case: it lives
   * here as a manual/Proposed project and in Governance with 7 tasks, and it
   * appears in neither the matching list above (that's active Current
   * Projects only) nor as a genuinely new project.
   */
  allProjects: ZohoPipelineProject[];
  onClose: () => void;
  /**
   * Called once per existing project that changed. Resolves with the first
   * DB save error message, or null when everything persisted.
   */
  onApply: (updates: { id: string; patch: Partial<ZohoPipelineProject> }[]) => Promise<string | null>;
  /**
   * Called once per project to create from a Governance project. Same
   * error contract as onApply.
   */
  onCreate: (projects: ZohoPipelineProject[]) => Promise<string | null>;
}

/** What to do with a Governance project that has no counterpart here. */
type NewAction = 'create' | 'ignore' | string; // string = link to that dashboard project id

/** Governance projects the user has dismissed, so they stop nagging every sync. */
const IGNORE_KEY = 'governance-sync:ignored';

function loadIgnored(): Set<string> {
  try {
    const raw = localStorage.getItem(IGNORE_KEY);
    return new Set(raw ? JSON.parse(raw) as string[] : []);
  } catch { return new Set(); }
}
function saveIgnored(s: Set<string>) {
  try { localStorage.setItem(IGNORE_KEY, JSON.stringify([...s])); } catch { /* best effort */ }
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

export function GovernanceSyncModal({ projects, allProjects, onClose, onApply, onCreate }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gov, setGov] = useState<GovProject[]>([]);
  /** dashboard project id → governance project id (or SKIP). */
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ name: string; note: string; ok: boolean }[] | null>(null);
  /** DB persistence failure — synced in-app, but the save didn't reach Supabase. */
  const [saveError, setSaveError] = useState<string | null>(null);
  /** governance project id → what to do with it (only for unmatched ones). */
  const [newAction, setNewAction] = useState<Record<string, NewAction>>({});
  const [ignored, setIgnored] = useState<Set<string>>(() => loadIgnored());

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

  /**
   * Governance projects with nothing on this side.
   *
   * "Nothing on this side" is checked against ALL pipeline projects, not just
   * the active ones on screen — archived projects (Cool Air Rentals, Qu Data)
   * and manual pipeline entries (Orange Capital Partners) already exist, and
   * offering to create them would duplicate. Anything already picked as a
   * match above is excluded too.
   */
  const unmatched = useMemo(() => {
    const claimed = new Set(Object.values(choice).filter((v) => v && v !== SKIP));
    const linked = new Set(allProjects.map((p) => p.governanceProjectId).filter(Boolean) as string[]);
    return gov.filter((g) => !claimed.has(g.id) && !linked.has(g.id));
  }, [gov, choice, allProjects]);

  /**
   * Current Projects only — a Governance project is a delivery project, and
   * its counterpart here is a Current project, never a Pipeline one.
   *
   * Pipeline entries (source 'manual') are pre-sale/proposed work that
   * happens to share a name. Treating one as the counterpart would attach a
   * live plan to a proposal instead of creating the real project: Orange
   * Capital Partners is proposed here but running in Governance with 7 tasks,
   * so it should be created as a Current project, leaving the pipeline entry
   * where it is.
   *
   * Archived Current projects still count. Cool Air Rentals and Qu Data are
   * archived here but live in Governance, and they're the same project — the
   * link belongs on the existing row rather than on a second copy of it.
   */
  const currentOnly = useMemo(() => allProjects.filter((p) => p.source === 'zoho'), [allProjects]);

  /** An existing Current project with the same name, if there is one. */
  const localTwin = useCallback(
    (g: GovProject) => currentOnly.find((p) => norm(p.name) === norm(g.name)) ?? null,
    [currentOnly],
  );

  /**
   * Link targets are Current projects only, for the same reason as localTwin
   * — a Governance plan belongs on a delivery project, not on a pipeline
   * proposal. Anything already claimed by a match above is excluded so two
   * Governance projects can't be pointed at the same row.
   */
  const linkTargets = useMemo(() => {
    const claimed = new Set(Object.values(choice).filter((v) => v && v !== SKIP));
    return currentOnly
      .filter((p) => !p.governanceProjectId || !claimed.has(p.governanceProjectId))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [currentOnly, choice]);

  /**
   * Default action per unmatched Governance project.
   *
   * Order of preference:
   *   1. previously dismissed → stay dismissed, so junk like "Baseline
   *      Project" doesn't have to be re-ignored on every sync
   *   2. a same-named project already exists here → link to it, never create
   *      a second copy
   *   3. otherwise create, since the whole complaint is that new Governance
   *      projects never show up here
   */
  useEffect(() => {
    setNewAction((prev) => {
      const next = { ...prev };
      for (const g of unmatched) {
        if (next[g.id] !== undefined) continue;
        if (ignored.has(g.id)) next[g.id] = 'ignore';
        else next[g.id] = localTwin(g)?.id ?? 'create';
      }
      return next;
    });
  }, [unmatched, ignored, localTwin]);

  const toCreateCount = unmatched.filter((g) => newAction[g.id] === 'create').length;
  const toLinkCount = unmatched.filter((g) => {
    const a = newAction[g.id];
    return a && a !== 'create' && a !== 'ignore';
  }).length;

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

    // Unmatched Governance projects the user chose to act on.
    const creating = unmatched.filter((g) => newAction[g.id] === 'create');
    const linking = unmatched
      .map((g) => ({ g, targetId: newAction[g.id] }))
      .filter((x): x is { g: GovProject; targetId: string } =>
        !!x.targetId && x.targetId !== 'create' && x.targetId !== 'ignore');

    const planIds = [
      ...pairs.map((x) => x.gid),
      ...creating.map((g) => g.id),
      ...linking.map((x) => x.g.id),
    ];

    const { data, error: e } = await callGovernance<{ plans: Record<string, GovPlan> }>({
      action: 'plan', projectIds: planIds,
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

    // Governance projects linked onto an existing dashboard project that
    // wasn't in the matching list above (archived, or a manual pipeline entry
    // like Orange Capital Partners).
    for (const { g, targetId } of linking) {
      const target = allProjects.find((p) => p.id === targetId);
      if (!target) continue;
      const plan = data.plans[g.id];
      const patch: Partial<ZohoPipelineProject> = {
        governanceProjectId: g.id,
        governanceProjectName: g.name,
        governanceSyncedAt: now,
      };
      if (plan?.startDate) patch.startDate = plan.startDate;
      if (plan?.endDate) patch.endDate = plan.endDate;
      if (plan && plan.phases.length > 0) patch.phases = plan.phases;
      updates.push({ id: target.id, patch });
      report.push({
        name: target.name,
        note: `linked to “${g.name}”${plan?.phases.length ? ` · ${plan.phases.length} phases` : ' · no plan yet'}`,
        ok: true,
      });
    }

    // Genuinely new Governance projects → create them here.
    const created: ZohoPipelineProject[] = [];
    for (const g of creating) {
      const plan = data.plans[g.id];
      created.push({
        // Deterministic id from the Governance id, so a double-click or a
        // second sync can't produce two rows for the same project.
        id: `gov-${g.id}`,
        name: g.name,
        // 'zoho' is the historical name for what the UI labels "Current" —
        // it's what puts a project in the Current Projects list, the Project
        // Team picker and the timesheet dropdown. The Zoho sync itself is
        // long gone; renaming the value would mean touching seven filters
        // across the app, so it stays as the marker for "a live project".
        source: 'zoho',
        status: 'In Progress',
        owner: g.pm || g.deliveryLead || '',
        startDate: plan?.startDate ?? g.startDate,
        endDate: plan?.endDate ?? g.currentEnd ?? g.plannedEnd,
        resources: [],
        phases: plan?.phases ?? [],
        governanceProjectId: g.id,
        governanceProjectName: g.name,
        governanceSyncedAt: now,
      });
      report.push({
        name: g.name,
        note: `created${plan?.phases.length ? ` · ${plan.phases.length} phases from ${plan.taskCount} tasks` : ' · no plan in Governance yet'}`,
        ok: true,
      });
    }

    // Remember dismissals so they don't come back every sync.
    const nextIgnored = new Set(ignored);
    for (const g of unmatched) {
      if (newAction[g.id] === 'ignore') nextIgnored.add(g.id);
      else nextIgnored.delete(g.id);
    }
    setIgnored(nextIgnored);
    saveIgnored(nextIgnored);

    // Creates run before updates so a project exists before anything patches
    // it. Either failing is reported — a row that shows on screen but never
    // reached Postgres is the worst outcome here, because the next sync would
    // see it as missing and offer to create it all over again.
    const createErr = created.length ? await onCreate(created) : null;
    const applyErr = await onApply(updates);
    setSaveError(createErr ?? applyErr);
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
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-line/60 bg-gradient-to-r from-blue-50 to-white shrink-0">
          <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Link2 size={15} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-ink">Sync with Delivery Governance</div>
            <div className="text-[11px] text-muted">
              Confirm which Governance project each one is, then pull its dates and plan.
              Team allocation stays from the Project Team tab.
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-muted/70 hover:text-ink/80 p-1 rounded hover:bg-surface-2">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
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
              {saveError ? (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 mb-2">
                  <div className="font-semibold mb-0.5">Synced, but saving to the database failed</div>
                  Changes only apply in this browser and will not reach other users. {saveError}
                </div>
              ) : (
                <div className="text-sm font-semibold text-ink mb-2">Sync complete</div>
              )}
              {result.map((r) => (
                <div key={r.name} className="flex items-start gap-2 text-xs">
                  {r.ok
                    ? <Check size={13} className="text-emerald-600 mt-0.5 shrink-0" />
                    : <AlertTriangle size={13} className="text-amber-600 mt-0.5 shrink-0" />}
                  <span className="font-medium text-ink">{r.name}</span>
                  <span className="text-muted">— {r.note}</span>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && !result && (
            <>
              <div className="grid grid-cols-[1fr_auto_1.3fr] gap-x-3 gap-y-0 items-center px-2 pb-1.5 mb-1 border-b border-line/60">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">This tool</div>
                <div />
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Delivery Governance</div>
              </div>

              {projects.map((p) => {
                const sel = choice[p.id] ?? '';
                const g = sel && sel !== SKIP ? govById.get(sel) : null;
                const noPlan = g ? g.taskCount === 0 : false;
                return (
                  <div key={p.id} className="grid grid-cols-[1fr_auto_1.3fr] gap-x-3 items-center px-2 py-2 rounded-lg hover:bg-surface-2/70">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{p.name}</div>
                      <div className="text-[11px] text-muted/70">
                        {fmt(p.startDate)} – {fmt(p.endDate)} · {p.phases?.length ?? 0} phases
                      </div>
                    </div>

                    <div className="text-line">
                      {sel === SKIP ? <Ban size={14} className="text-muted/70" /> : <Link2 size={14} />}
                    </div>

                    <div className="min-w-0">
                      <select
                        value={sel}
                        onChange={(e) => setChoice((c) => ({ ...c, [p.id]: e.target.value }))}
                        className={`w-full px-2.5 py-1.5 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                          sel === SKIP ? 'border-line text-muted/70'
                          : sel ? 'border-line text-ink'
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
                        <div className={`text-[11px] mt-0.5 ${noPlan ? 'text-amber-700' : 'text-muted/70'}`}>
                          {noPlan
                            ? 'No plan in Governance — dates only, existing phases kept'
                            : `${fmt(g.startDate)} – ${fmt(g.currentEnd ?? g.plannedEnd)} · ${g.taskCount} tasks`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* ── New in Governance ── */}
              {unmatched.length > 0 && (
                <div className="mt-5 pt-4 border-t border-line">
                  <div className="flex items-baseline gap-2 mb-1 px-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                      In Governance, not here
                    </div>
                    <span className="text-xs font-semibold text-blue-800 bg-blue-100 rounded-full px-2 py-0.5">
                      {unmatched.length}
                    </span>
                    <span className="text-[11px] text-muted/70">
                      created in Governance since the last sync
                    </span>
                  </div>

                  {unmatched.map((g) => {
                    const act = newAction[g.id] ?? 'create';
                    const isCreate = act === 'create';
                    const isIgnore = act === 'ignore';
                    return (
                      <div key={g.id} className="grid grid-cols-[1fr_auto_1.3fr] gap-x-3 items-center px-2 py-2 rounded-lg hover:bg-surface-2/70">
                        <div className="min-w-0">
                          <div className={`text-sm font-medium truncate ${isIgnore ? 'text-muted/70 line-through' : 'text-ink'}`}>
                            {g.name}
                          </div>
                          <div className="text-[11px] text-muted/70">
                            {fmt(g.startDate)} – {fmt(g.currentEnd ?? g.plannedEnd)}
                            {g.taskCount > 0 ? ` · ${g.taskCount} tasks` : ' · no plan yet'}
                            {g.pm ? ` · ${g.pm}` : ''}
                          </div>
                        </div>

                        <div className="text-line">
                          {isIgnore ? <Ban size={14} className="text-muted/70" />
                            : isCreate ? <Plus size={14} className="text-emerald-600" />
                            : <Link2 size={14} />}
                        </div>

                        <div className="min-w-0">
                          <select
                            value={act}
                            onChange={(e) => setNewAction((s) => ({ ...s, [g.id]: e.target.value }))}
                            className={`w-full px-2.5 py-1.5 text-sm rounded-lg border bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                              isCreate ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                              : isIgnore ? 'border-line text-muted/70'
                              : 'border-line text-ink'
                            }`}
                          >
                            <option value="create">Create as a new project here</option>
                            <option value="ignore">Ignore — don&apos;t bring it in</option>
                            <optgroup label="…or link to an existing project">
                              {linkTargets.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}{t.status === 'Archived' ? ' (archived)' : ''}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                          {isCreate && (
                            <div className="text-[11px] mt-0.5 text-muted/70">
                              Added to Current Projects. Team allocation is set on the Project Team tab.
                            </div>
                          )}
                          {isIgnore && (
                            <div className="text-[11px] mt-0.5 text-muted/70">
                              Remembered — it won&apos;t be offered again.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-line/60 bg-surface-2/70 shrink-0">
          {!result && !loading && !error && (
            <div className="text-[11px] text-muted mb-2">
              {linkedCount} of {projects.length} matched
              {toCreateCount > 0 && <span className="text-emerald-700"> · {toCreateCount} to create</span>}
              {toLinkCount > 0 && <span> · {toLinkCount} to link</span>}
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
              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-line bg-white text-ink/80 hover:bg-surface-2"
            >
              {result ? 'Done' : 'Cancel'}
            </button>
            {!result && (
              <button
                type="button"
                onClick={() => void runSync()}
                disabled={loading || syncing || !!error || (linkedCount + toCreateCount + toLinkCount) === 0}
                className="text-xs font-semibold px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {syncing
                  ? 'Syncing…'
                  : `Sync ${linkedCount + toCreateCount + toLinkCount} project${linkedCount + toCreateCount + toLinkCount === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
