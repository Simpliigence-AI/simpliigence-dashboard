/**
 * Supabase Edge Function: governance-sync
 *
 * Read-only proxy to the Delivery Governance tool
 * (https://simpliigence-governance.onrender.com), powering the "Sync with
 * Delivery Governance" button on /projects.
 *
 * ── Why a proxy at all ──
 * Governance authenticates with a bearer token that its own frontend keeps in
 * localStorage on its own origin. The dashboard is a different origin, so it
 * can neither read that token nor rely on a cookie (Governance doesn't set
 * one — an unauthenticated /api/projects with credentials:'include' returns
 * 401). Fetching from the browser is therefore impossible regardless of CORS.
 * This function logs in server-side instead, so the Governance service-account
 * password never reaches the client.
 *
 * Required secrets:
 *   GOVERNANCE_EMAIL     — service account email in the Governance tool
 *   GOVERNANCE_PASSWORD  — its password
 * Optional:
 *   GOVERNANCE_BASE_URL  — defaults to the production Render URL
 *
 * Actions (POST body):
 *   { action: 'list' }
 *     → { projects: [{ id, name, client, startDate, plannedEnd, currentEnd,
 *                      pm, deliveryLead, taskCount }] }
 *     Used to populate the name-matching dialog.
 *
 *   { action: 'plan', projectIds: string[] }
 *     → { plans: { [governanceProjectId]: {
 *           name, startDate, endDate, phases: ZohoPhase[], taskCount } } }
 *     Tasks are grouped into phases — see toPhases() for why.
 *
 * This function NEVER writes to Governance. It only reads.
 */

/// <reference lib="deno.ns" />

// @ts-expect-error Deno global provided by the edge runtime
const env = (name: string) => Deno.env.get(name);

const BASE = (env('GOVERNANCE_BASE_URL') || 'https://simpliigence-governance.onrender.com').replace(/\/$/, '');
const GOV_EMAIL = env('GOVERNANCE_EMAIL');
const GOV_PASSWORD = env('GOVERNANCE_PASSWORD');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface GovProject {
  id: string;
  name: string;
  client?: string;
  start_date?: string | null;
  planned_end?: string | null;
  current_end?: string | null;
  pm?: string;
  delivery_lead?: string;
}

interface GovTask {
  id: string;
  name: string;
  phase?: string;
  start?: string | null;
  end?: string | null;
  percent?: number;
  status?: string;
  assignee?: string;
}

interface Phase {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  isClosed: boolean;
  completedOn?: string;
  owner: string;
}

/** Empty string / null / undefined all mean "not set" in Governance. */
function d(v: string | null | undefined): string | null {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
}

async function login(): Promise<string> {
  if (!GOV_EMAIL || !GOV_PASSWORD) {
    throw new Error(
      'Governance credentials not configured. Set the GOVERNANCE_EMAIL and ' +
      'GOVERNANCE_PASSWORD secrets on this Supabase project.',
    );
  }
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: GOV_EMAIL, password: GOV_PASSWORD }),
  });
  if (!r.ok) {
    const body = (await r.text()).slice(0, 300);
    throw new Error(`Governance login failed (${r.status}): ${body}`);
  }
  const data = await r.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Governance login returned no access_token');
  return data.access_token;
}

async function govGet<T>(token: string, path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const body = (await r.text()).slice(0, 300);
    throw new Error(`Governance GET ${path} failed (${r.status}): ${body}`);
  }
  return await r.json() as T;
}

async function getTasks(token: string, pid: string): Promise<GovTask[]> {
  const raw = await govGet<unknown>(token, `/api/projects/${pid}/tasks`);
  if (Array.isArray(raw)) return raw as GovTask[];
  return ((raw as { tasks?: GovTask[] }).tasks) ?? [];
}

/**
 * Collapse Governance tasks into the dashboard's phase model.
 *
 * Governance stores a flat task list where `phase` is a label on each task;
 * the dashboard renders phases ("8/10 phases done", "Current: Go-Live"). So
 * tasks are grouped by their phase label, and each group becomes one phase
 * spanning its earliest start to its latest end.
 *
 * A phase counts as closed only when every task in it is at 100% — a phase
 * that is 9/10 done is still in progress, and rounding it up would make the
 * dashboard's completion count lie.
 *
 * Phase order follows first appearance in the task list rather than start
 * date: Governance returns tasks in plan order, and a phase whose first task
 * slipped shouldn't jump position.
 */
function toPhases(tasks: GovTask[]): Phase[] {
  const groups = new Map<string, GovTask[]>();
  for (const t of tasks) {
    const key = (t.phase ?? '').trim() || 'Unphased';
    const g = groups.get(key);
    if (g) g.push(t); else groups.set(key, [t]);
  }

  const out: Phase[] = [];
  for (const [name, items] of groups) {
    const starts = items.map((t) => d(t.start)).filter((v): v is string => !!v).sort();
    const ends = items.map((t) => d(t.end)).filter((v): v is string => !!v).sort();
    const allDone = items.every((t) => (t.percent ?? 0) >= 100);
    const anyStarted = items.some((t) => (t.percent ?? 0) > 0);
    // Assignees are per-task; surface one only when the whole phase has a
    // single owner, otherwise the label would be arbitrary.
    const owners = Array.from(new Set(items.map((t) => (t.assignee ?? '').trim()).filter(Boolean)));

    out.push({
      id: `gov-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      startDate: starts[0] ?? '',
      endDate: ends[ends.length - 1] ?? '',
      status: allDone ? 'Completed' : anyStarted ? 'In Progress' : 'Active',
      isClosed: allDone,
      ...(allDone && ends.length ? { completedOn: ends[ends.length - 1] } : {}),
      owner: owners.length === 1 ? owners[0] : '',
    });
  }
  return out;
}

/** Bounded concurrency so a 15-project pull doesn't fan out 15 sockets at once. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({})) as { action?: string; projectIds?: string[] };
    const action = body.action ?? 'list';
    const token = await login();

    if (action === 'list') {
      const projects = await govGet<GovProject[]>(token, '/api/projects');
      // Task counts come along so the dialog can warn about projects that have
      // no plan in Governance yet — syncing those would otherwise look like a
      // silent no-op.
      const counts = await mapLimit(projects, 6, async (p) => {
        try { return (await getTasks(token, p.id)).length; } catch { return 0; }
      });
      return new Response(JSON.stringify({
        projects: projects.map((p, i) => ({
          id: p.id,
          name: p.name,
          client: p.client ?? '',
          startDate: d(p.start_date),
          plannedEnd: d(p.planned_end),
          currentEnd: d(p.current_end),
          pm: p.pm ?? '',
          deliveryLead: p.delivery_lead ?? '',
          taskCount: counts[i],
        })),
      }), { headers: corsHeaders });
    }

    if (action === 'plan') {
      const ids = body.projectIds ?? [];
      if (ids.length === 0) {
        return new Response(JSON.stringify({ plans: {} }), { headers: corsHeaders });
      }
      const all = await govGet<GovProject[]>(token, '/api/projects');
      const byId = new Map(all.map((p) => [p.id, p]));

      const results = await mapLimit(ids, 6, async (pid) => {
        const p = byId.get(pid);
        if (!p) return [pid, null] as const;
        const tasks = await getTasks(token, pid);
        const phases = toPhases(tasks);
        return [pid, {
          name: p.name,
          // current_end is the live end date; planned_end is the baseline.
          // The dashboard shows the live one.
          startDate: d(p.start_date),
          endDate: d(p.current_end) ?? d(p.planned_end),
          phases,
          taskCount: tasks.length,
        }] as const;
      });

      const plans: Record<string, unknown> = {};
      for (const [pid, plan] of results) if (plan) plans[pid] = plan;
      return new Response(JSON.stringify({ plans }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400, headers: corsHeaders,
    });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[governance-sync]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
