/**
 * Supabase Edge Function: delivery-calendar
 *
 * Reads Outlook calendars through Microsoft Graph so Delivery Home and each
 * project's Meetings tab can show what is booked. Mailboxes read:
 *   - the delivery managers in delivery_calendar_mailboxes (kind 'core': Sujatha, Anupama)
 *   - everyone allocated to a current project in forecast_assignments whose name
 *     resolves to an authorized_users email (kind 'team', refreshed every run)
 * Window: 30 days back (for the "recent cadence" signal) to 60 days ahead.
 * Private / confidential events are skipped; bodies are never read or stored.
 * Matching an invite to a project happens in SQL (delivery_calendar_ingest).
 *
 * Actions (body.action):
 *   probe → which Graph application permissions the app has, and whether Calendars.Read is one
 *   sync  → read every mailbox now (any signed-in user with Project Plans access)
 *   cron  → same, from pg_cron (X-Cron-Secret)
 *
 * Secrets: SUPABASE_SERVICE_ROLE_KEY, plus CALENDAR_CLIENT_ID / CALENDAR_CLIENT_SECRET (and optional
 * CALENDAR_TENANT_ID) for an app registration that already has Microsoft Graph *application*
 * permission Calendars.Read; falls back to GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error npm specifier
import { createClient } from 'npm:@supabase/supabase-js@2';

// @ts-expect-error Deno runtime
const env = (name: string) => Deno.env.get(name);
const SUPABASE_URL = env('SUPABASE_URL')!;
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = env('SUPABASE_ANON_KEY')!;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const BACK_DAYS = 30;
const AHEAD_DAYS = 60;
const PARALLEL = 4;
const BUDGET_MS = 120_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
class UserError extends Error { constructor(m: string, public status = 400) { super(m); } }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const NO_CALENDAR_ACCESS =
  'The Dashboard’s Microsoft app can’t read calendars yet. In Azure: Entra ID → App registrations → the Dashboard app → API permissions → Add a permission → Microsoft Graph → Application permissions → Calendars.Read → Add, then “Grant admin consent”.';

// ── Microsoft Graph ─────────────────────────────────────────────────────

let cached: { token: string; exp: number } | null = null;
async function graphToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  // A separate app registration that already has calendar access can be used via CALENDAR_* secrets;
  // otherwise the Dashboard's Graph app (GRAPH_*).
  const own = !!env('CALENDAR_CLIENT_ID');
  const t = (own && env('CALENDAR_TENANT_ID')) || env('GRAPH_TENANT_ID');
  const c = own ? env('CALENDAR_CLIENT_ID') : env('GRAPH_CLIENT_ID');
  const s = own ? env('CALENDAR_CLIENT_SECRET') : env('GRAPH_CLIENT_SECRET');
  if (!t || !c || !s) throw new UserError('Microsoft Graph secrets (CALENDAR_CLIENT_ID / CALENDAR_CLIENT_SECRET, or GRAPH_*) are not set.', 500);
  const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c, client_secret: s, scope: 'https://graph.microsoft.com/.default' }),
  });
  if (!r.ok) throw new UserError(`Microsoft sign-in failed (${r.status}): ${(await r.text()).slice(0, 200)}`, 502);
  const j = await r.json() as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}
function roles(token: string): string[] {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))).roles ?? [];
  } catch { return []; }
}
const canReadCalendars = (r: string[]) => r.some((x) => /^Calendars\.(Read|ReadBasic|ReadWrite)(\.All)?$/.test(x));

async function graphJson(url: string): Promise<Row> {
  const token = await graphToken();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="UTC"' } });
    if ((r.status === 429 || r.status === 503) && attempt < 3) {
      await new Promise((ok) => setTimeout(ok, Math.min(10, Number(r.headers.get('retry-after')) || 2 ** attempt) * 1000));
      continue;
    }
    if (r.ok) return r.json();
    const body = await r.text();
    let msg = body.slice(0, 300);
    try { msg = JSON.parse(body).error?.message ?? msg; } catch { /* keep */ }
    if (r.status === 401 || r.status === 403) throw new UserError(canReadCalendars(roles(token)) ? `Calendar access refused: ${msg}` : NO_CALENDAR_ACCESS, 403);
    if (r.status === 404) throw new UserError('Mailbox not found in Microsoft 365.', 404);
    throw new UserError(`Graph error (${r.status}): ${msg}`, 502);
  }
}

const utc = (s?: string) => (s ? (s.endsWith('Z') ? s : `${s}Z`) : null);
const SELECT = 'iCalUId,subject,start,end,isAllDay,isCancelled,organizer,attendees,onlineMeeting,webLink,location,sensitivity,showAs,type';

async function readMailbox(email: string, from: Date, to: Date) {
  const out = new Map<string, Row>();
  let next: string | null = `${GRAPH}/users/${encodeURIComponent(email)}/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$top=200&$select=${SELECT}`;
  while (next) {
    const page = await graphJson(next);
    for (const e of (page.value ?? []) as Row[]) {
      if (e.sensitivity === 'private' || e.sensitivity === 'confidential') continue;
      if (e.showAs === 'free' && !(e.attendees ?? []).length) continue; // reminders / holds
      const start = utc(e.start?.dateTime), end = utc(e.end?.dateTime);
      if (!start || !end || !e.iCalUId) continue;
      const id = `${e.iCalUId}|${start.slice(0, 16)}`;
      out.set(id, {
        id,
        subject: String(e.subject ?? '').slice(0, 500),
        start, end,
        allDay: !!e.isAllDay,
        cancelled: !!e.isCancelled,
        organizer: e.organizer?.emailAddress?.address ?? null,
        organizerName: e.organizer?.emailAddress?.name ?? null,
        attendees: ((e.attendees ?? []) as Row[]).slice(0, 80).map((a) => ({
          email: String(a.emailAddress?.address ?? '').toLowerCase(),
          name: a.emailAddress?.name ?? null,
          response: a.status?.response ?? null,
          type: a.type ?? null,
        })),
        joinUrl: e.onlineMeeting?.joinUrl ?? null,
        webLink: e.webLink ?? null,
        location: e.location?.displayName || null,
      });
    }
    next = page['@odata.nextLink'] ?? null;
  }
  return [...out.values()];
}

// ── Mailboxes ───────────────────────────────────────────────────────────

/** Refresh the 'team' mailboxes from current allocations; keep 'core' ones as they are. */
async function refreshTeamMailboxes() {
  const [{ data: projects }, { data: fa }, { data: users }] = await Promise.all([
    svc.from('pipeline_projects').select('name, forecast_name, status').not('status', 'in', '("Archived","Completed","Proposed","Trashed")'),
    svc.from('forecast_assignments').select('employee_name, project'),
    svc.from('authorized_users').select('email, full_name, active'),
  ]);
  const current = new Set(((projects ?? []) as Row[]).map((p) => String(p.forecast_name || p.name).trim().toLowerCase()));
  const byName = new Map<string, Row>();
  for (const u of (users ?? []) as Row[]) if (u.full_name && u.active !== false) byName.set(String(u.full_name).trim().toLowerCase(), u);
  const team = new Map<string, string>();
  for (const a of (fa ?? []) as Row[]) {
    if (!current.has(String(a.project ?? '').trim().toLowerCase())) continue;
    const u = byName.get(String(a.employee_name ?? '').trim().toLowerCase());
    if (u?.email && /@simpliigence\.com$/i.test(u.email)) team.set(String(u.email).toLowerCase(), u.full_name);
  }
  const { data: existing } = await svc.from('delivery_calendar_mailboxes').select('email, kind');
  const core = new Set(((existing ?? []) as Row[]).filter((m) => m.kind === 'core').map((m) => m.email));
  const rows = [...team].filter(([e]) => !core.has(e)).map(([email, name]) => ({ email, name, kind: 'team', active: true, updated_at: new Date().toISOString() }));
  if (rows.length) await svc.from('delivery_calendar_mailboxes').upsert(rows, { onConflict: 'email' });
  const stale = ((existing ?? []) as Row[]).filter((m) => m.kind === 'team' && !team.has(m.email)).map((m) => m.email);
  if (stale.length) await svc.from('delivery_calendar_mailboxes').update({ active: false }).in('email', stale);
}

async function syncAll(deadline: number) {
  await refreshTeamMailboxes();
  const { data: boxes } = await svc.from('delivery_calendar_mailboxes').select('email, kind').eq('active', true).order('kind').order('last_synced_at', { nullsFirst: true });
  const from = new Date(Date.now() - BACK_DAYS * 86400_000);
  const to = new Date(Date.now() + AHEAD_DAYS * 86400_000);
  const results: Row[] = [];
  const queue = [...((boxes ?? []) as Row[])];
  let blocked: string | null = null;
  const worker = async () => {
    while (queue.length && !blocked) {
      if (Date.now() > deadline) { results.push({ mailbox: queue.shift()!.email, skipped: 'out of time — next run' }); continue; }
      const m = queue.shift()!;
      try {
        const events = await readMailbox(m.email, from, to);
        const { data, error } = await svc.rpc('delivery_calendar_ingest', { p_mailbox: m.email, p_from: from.toISOString(), p_to: to.toISOString(), p_events: events });
        if (error) throw new Error(error.message);
        results.push(data as Row);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === NO_CALENDAR_ACCESS) blocked = msg;
        await svc.from('delivery_calendar_mailboxes').update({ last_error: msg.slice(0, 500), updated_at: new Date().toISOString() }).eq('email', m.email);
        results.push({ mailbox: m.email, error: msg });
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  if (blocked) throw new UserError(blocked, 403);
  return { mailboxes: results.length, events: results.reduce((s, r) => s + (r.events ?? 0), 0), errors: results.filter((r) => r.error).length, results };
}

// ── Handler ─────────────────────────────────────────────────────────────

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);
  const deadline = Date.now() + BUDGET_MS;
  try {
    const b = (await req.json().catch(() => ({}))) as Row;
    const secret = req.headers.get('x-cron-secret');
    let cron = false;
    if (secret) {
      const { data } = await svc.rpc('delivery_cron_secret_ok', { p_secret: secret });
      if (data !== true) return reply({ error: 'Bad cron secret' }, 401);
      cron = true;
    } else {
      const auth = req.headers.get('Authorization');
      if (!auth) return reply({ error: 'Sign in required' }, 401);
      const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const [{ data: u }, { data: canView }] = await Promise.all([user.auth.getUser(), user.rpc('has_tab', { p_tab_key: 'project-plans', p_verb: 'view' })]);
      if (!u?.user) return reply({ error: 'Sign in required' }, 401);
      if (canView !== true) return reply({ error: 'You need access to Project Plans for this.' }, 403);
    }

    switch (b.action) {
      case 'probe': {
        const tok = await graphToken();
        const r = roles(tok);
        let appName: string | null = null;
        try { const p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); appName = JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))).app_displayname ?? null; } catch { /* ignore */ }
        return reply({ ok: true, app: appName, usingCalendarSecrets: !!env('CALENDAR_CLIENT_ID'), roles: r, canReadCalendars: canReadCalendars(r), help: canReadCalendars(r) ? null : NO_CALENDAR_ACCESS });
      }
      case 'sync':
      case 'cron': {
        if (b.action === 'cron' && !cron) throw new UserError('Not allowed');
        return reply({ ok: true, ...(await syncAll(deadline)) });
      }
      default:
        throw new UserError(`Unknown action "${b.action}".`);
    }
  } catch (e) {
    const status = e instanceof UserError ? e.status : 500;
    const msg = (e as Error).message || String(e);
    console.error('[delivery-calendar]', msg);
    return reply({ error: msg }, status);
  }
});
