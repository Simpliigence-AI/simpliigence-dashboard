/**
 * Supabase Edge Function: delivery-digest
 *
 * The reminders Governance sent, by email through Microsoft Graph:
 *   • Daily, to each PM, only when something needs them: change requests
 *     waiting on approval longer than digest_cr_stale_days, out-of-scope
 *     client requests nobody has acted on, late tasks, open high/critical
 *     issues, and (Thu/Fri) this week's check-in not yet submitted.
 *   • Mondays, a portfolio digest to portfolio_digest_to (delivery_settings).
 *
 * Driven by pg_cron (job 'delivery-digest', 12:30 UTC daily) with the
 * X-Cron-Secret header checked against the vault secret
 * DELIVERY_CRON_SECRET, or by an admin from the app (Preview / Send now).
 *
 * Body: { mode?: 'auto' | 'daily' | 'portfolio', dryRun?: boolean, onlyTo?: string }
 *   auto (default) = daily, plus portfolio on Mondays.
 *   dryRun returns the emails instead of sending them.
 *   onlyTo sends every email to that one address (for testing).
 *
 * Secrets: SUPABASE_SERVICE_ROLE_KEY, GRAPH_TENANT_ID, GRAPH_CLIENT_ID,
 * GRAPH_CLIENT_SECRET, GRAPH_SENDER_MAILBOX (sender unless delivery_settings
 * has digest_sender).
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno runtime
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = env('SUPABASE_URL')!;
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = env('SUPABASE_ANON_KEY')!;
const APP_URL = 'https://simpliigence-ai.github.io/simpliigence-dashboard';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
function fridayOfWeek(d = new Date()): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + ((5 - x.getUTCDay() + 7) % 7));
  return x.toISOString().slice(0, 10);
}

async function authorised(req: Request, db: Row): Promise<boolean> {
  const secret = req.headers.get('x-cron-secret');
  if (secret) {
    const { data } = await db.rpc('delivery_cron_secret_ok', { p_secret: secret });
    if (data === true) return true;
  }
  const auth = req.headers.get('Authorization');
  if (!auth) return false;
  const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data } = await user.rpc('tab_permission', { p_tab_key: 'project-plans' });
  const row = Array.isArray(data) ? data[0] : data;
  return !!row?.can_approve;
}

async function graphToken(): Promise<string> {
  const t = env('GRAPH_TENANT_ID'), c = env('GRAPH_CLIENT_ID'), s = env('GRAPH_CLIENT_SECRET');
  if (!t || !c || !s) throw new Error('Microsoft Graph secrets are not set');
  const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c, client_secret: s, scope: 'https://graph.microsoft.com/.default' }),
  });
  if (!r.ok) throw new Error(`Graph token failed (${r.status})`);
  return ((await r.json()) as { access_token: string }).access_token;
}

async function sendMail(token: string, from: string, to: string, subject: string, html: string) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] },
      saveToSentItems: false,
    }),
  });
  if (!r.ok) throw new Error(`sendMail to ${to} failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
}

interface Item { project: Row; lines: string[] }

function wrap(title: string, intro: string, sections: { heading: string; items: Item[] }[]): string {
  const body = sections.filter((s) => s.items.length).map((s) => `
    <h3 style="font:600 15px Segoe UI,Arial;margin:22px 0 6px">${esc(s.heading)}</h3>
    ${s.items.map((i) => `
      <div style="margin:0 0 10px">
        <a href="${APP_URL}/project-plans/${esc(i.project.id)}" style="font:600 14px Segoe UI,Arial;color:#1d4ed8;text-decoration:none">${esc(i.project.name)}</a>
        <ul style="font:14px Segoe UI,Arial;margin:4px 0 0 18px;padding:0;color:#111">${i.lines.map((l) => `<li>${l}</li>`).join('')}</ul>
      </div>`).join('')}`).join('');
  return `<div style="max-width:680px">
    <h2 style="font:600 18px Segoe UI,Arial;margin:0 0 4px">${esc(title)}</h2>
    <p style="font:14px Segoe UI,Arial;color:#555;margin:0 0 8px">${intro}</p>${body}
    <p style="font:12px Segoe UI,Arial;color:#888;margin-top:24px">From Project Plans in the Simpliigence Dashboard. Open a project to act on it.</p></div>`;
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    if (!(await authorised(req, db))) return reply({ error: 'Admins only' }, 403);
    const body = (await req.json().catch(() => ({}))) as { mode?: string; dryRun?: boolean; onlyTo?: string; fromCron?: boolean };

    const { data: settingsRows } = await db.from('delivery_settings').select('key, value');
    const S = Object.fromEntries((settingsRows ?? []).map((r: Row) => [r.key, r.value]));
    if (body.fromCron && S.digest_enabled !== 'true') return reply({ ok: true, skipped: 'digest_enabled is off' });
    const staleDays = parseInt(S.digest_cr_stale_days ?? '3', 10) || 3;
    const monday = new Date().getUTCDay() === 1;
    const mode = body.mode ?? 'auto';
    const doDaily = mode === 'auto' || mode === 'daily';
    const doPortfolio = mode === 'portfolio' || (mode === 'auto' && monday);

    const [p, t, i, q, c, k, u] = await Promise.all([
      db.from('delivery_projects').select('id, name, pm, status, current_end, planned_end, health').eq('status', 'active'),
      db.from('delivery_tasks').select('project_id, name, end_date, percent, status'),
      db.from('delivery_issues').select('project_id, description, criticality, state, owner, due_date').eq('state', 'open'),
      db.from('delivery_requests').select('project_id, text, verdict, state, impact_hours, received_at').in('state', ['open', 'awaiting-clarification']),
      db.from('delivery_change_requests').select('project_id, title, state, created_at, approvers, impact_hours').eq('state', 'pending'),
      db.from('delivery_checkins').select('project_id, week_ending, status').eq('week_ending', fridayOfWeek()),
      db.from('authorized_users').select('email, full_name, active'),
    ]);
    const projects = (p.data ?? []) as Row[];
    const by = <T extends Row>(rows: T[] | null) => {
      const m = new Map<string, T[]>();
      for (const r of rows ?? []) { const a = m.get(r.project_id); if (a) a.push(r); else m.set(r.project_id, [r]); }
      return m;
    };
    const tasks = by(t.data), issues = by(i.data), reqs = by(q.data), crs = by(c.data), chk = by(k.data);
    const people = ((u.data ?? []) as Row[]).filter((x) => x.active !== false && x.full_name);
    const emailFor = (name: string | null): string | null => {
      if (!name) return null;
      const n = name.trim().toLowerCase();
      const hit = people.find((x) => x.full_name.toLowerCase() === n)
        ?? people.find((x) => x.full_name.toLowerCase().startsWith(n) || n.startsWith(x.full_name.toLowerCase()));
      return hit?.email ?? null;
    };

    const late = (r: Row) => r.status !== 'done' && (r.percent ?? 0) < 100 && r.end_date && r.end_date < today();
    const weekday = new Date().getUTCDay();
    const perProject = projects.map((prj) => {
      const lines: Record<string, string[]> = { crs: [], scope: [], late: [], issues: [], checkin: [] };
      for (const cr of crs.get(prj.id) ?? []) {
        const age = daysAgo(cr.created_at);
        if (age >= staleDays) {
          const waiting = (cr.approvers ?? []).filter((a: Row) => (a.state ?? 'pending') === 'pending').map((a: Row) => `${a.role}${a.who && a.who !== 'TBD' ? ` (${a.who})` : ''}`);
          lines.crs.push(`<b>${esc(cr.title)}</b> — pending ${age} days${waiting.length ? `, waiting on ${esc(waiting.join(', '))}` : ''}`);
        }
      }
      for (const r of reqs.get(prj.id) ?? []) {
        if (r.verdict === 'red' && r.state === 'open') lines.scope.push(`Out of scope, no action yet (${daysAgo(r.received_at)} days): ${esc(String(r.text).slice(0, 140))}${r.impact_hours ? ` — est. ${r.impact_hours} hrs` : ''}`);
        else if (r.verdict === 'amber' && daysAgo(r.received_at) >= staleDays) lines.scope.push(`Awaiting clarification ${daysAgo(r.received_at)} days: ${esc(String(r.text).slice(0, 140))}`);
      }
      const lateTasks = (tasks.get(prj.id) ?? []).filter(late).sort((a, b) => a.end_date.localeCompare(b.end_date));
      if (lateTasks.length) lines.late.push(`${lateTasks.length} late task${lateTasks.length === 1 ? '' : 's'}: ${lateTasks.slice(0, 5).map((x) => `${esc(x.name)} (due ${x.end_date})`).join('; ')}${lateTasks.length > 5 ? '…' : ''}`);
      for (const iss of (issues.get(prj.id) ?? []).filter((x) => x.criticality === 'high' || x.criticality === 'critical')) {
        lines.issues.push(`[${esc(iss.criticality)}] ${esc(String(iss.description).slice(0, 140))}${iss.owner ? ` — ${esc(iss.owner)}` : ''}${iss.due_date ? `, due ${iss.due_date}` : ''}`);
      }
      if (weekday >= 4 && weekday <= 5 && !(chk.get(prj.id) ?? []).some((x) => x.status === 'submitted')) {
        lines.checkin.push(`This week’s check-in (w/e ${fridayOfWeek()}) isn’t submitted yet.`);
      }
      return { prj, lines };
    });

    const emails: { to: string; subject: string; html: string }[] = [];
    // Active projects whose PM can't be matched to a Dashboard user get no daily email.
    const unmatched = projects.filter((x) => !emailFor(x.pm)).map((x) => `${x.name} (PM: ${x.pm ?? 'none'})`);

    if (doDaily) {
      const byPm = new Map<string, typeof perProject>();
      for (const x of perProject) {
        if (!Object.values(x.lines).some((l) => l.length)) continue;
        const to = emailFor(x.prj.pm);
        if (!to) continue;
        const a = byPm.get(to); if (a) a.push(x); else byPm.set(to, [x]);
      }
      for (const [to, list] of byPm) {
        const sec = (key: string, heading: string) => ({ heading, items: list.filter((x) => x.lines[key].length).map((x) => ({ project: x.prj, lines: x.lines[key] })) });
        const count = list.reduce((n, x) => n + Object.values(x.lines).reduce((m, l) => m + l.length, 0), 0);
        emails.push({
          to,
          subject: `Project Plans: ${count} item${count === 1 ? '' : 's'} need you today`,
          html: wrap('What needs you today', `Your active projects with something waiting. Nothing listed means nothing is waiting.`, [
            sec('crs', `Change requests waiting over ${staleDays} days`),
            sec('scope', 'Client requests outside scope'),
            sec('issues', 'High and critical issues'),
            sec('late', 'Late tasks'),
            sec('checkin', 'Weekly check-in'),
          ]),
        });
      }
    }

    if (doPortfolio && S.portfolio_digest_to) {
      const rows = perProject.map((x) => {
        const openRed = (reqs.get(x.prj.id) ?? []).filter((r) => r.verdict === 'red' && r.state === 'open');
        const hrs = openRed.reduce((n, r) => n + (r.impact_hours ?? 0), 0);
        const pend = (crs.get(x.prj.id) ?? []).length;
        const lt = (tasks.get(x.prj.id) ?? []).filter(late).length;
        const hi = (issues.get(x.prj.id) ?? []).filter((r) => r.criticality === 'high' || r.criticality === 'critical').length;
        const flag = x.prj.health ?? (lt > 3 || hi > 0 || openRed.length ? 'amber' : 'green');
        return { project: x.prj, lines: [
          `Health ${esc(flag)} · PM ${esc(x.prj.pm ?? '—')} · ends ${esc(x.prj.current_end ?? x.prj.planned_end ?? '—')}`,
          `${lt} late tasks · ${hi} high/critical issues · ${pend} CRs pending · ${openRed.length} out-of-scope requests open${hrs ? ` (${hrs} hrs unbilled)` : ''}`,
        ], score: lt + hi * 3 + openRed.length * 2 + pend };
      }).sort((a, b) => b.score - a.score);
      for (const to of String(S.portfolio_digest_to).split(/[,;\s]+/).filter(Boolean)) {
        emails.push({
          to,
          subject: `Delivery portfolio — week of ${today()}`,
          html: wrap('Delivery portfolio', `${projects.length} active projects, most attention needed first.`, [{ heading: 'Projects', items: rows }])
            + (unmatched.length ? `<p style="font:14px Segoe UI,Arial;color:#b45309;margin-top:16px"><b>No PM set who can receive the daily digest:</b> ${esc(unmatched.join('; '))}. Set the PM on each project’s Team.</p>` : ''),
        });
      }
    }

    if (body.dryRun) return reply({ ok: true, dryRun: true, emails, unmatched });

    const from = S.digest_sender || env('GRAPH_SENDER_MAILBOX');
    if (!from) throw new Error('No sender: set GRAPH_SENDER_MAILBOX or delivery_settings.digest_sender');
    const token = emails.length ? await graphToken() : '';
    const sent: string[] = []; const failed: string[] = [];
    for (const m of emails) {
      try { await sendMail(token, from, body.onlyTo || m.to, m.subject, m.html); sent.push(m.to); }
      catch (e) { failed.push(`${m.to}: ${(e as Error).message}`); }
    }
    return reply({ ok: true, sent, failed, unmatched });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[delivery-digest]', msg);
    return reply({ error: msg }, 500);
  }
});
