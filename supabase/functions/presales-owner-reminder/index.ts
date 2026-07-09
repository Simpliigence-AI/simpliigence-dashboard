/**
 * Supabase Edge Function: presales-owner-reminder
 *
 * Every-other-day briefing to presales-activity owners. Fired by pg_cron
 * once per day. For each owner with at least one activity whose status is
 * 'open' or 'in_progress' AND owner_email is set, sends ONE consolidated
 * email covering all their open activities — but only if the last reminder
 * to that owner was ≥ REMINDER_INTERVAL_HOURS ago (or never).
 *
 * This yields the "every 2–3 days" cadence without any date arithmetic in
 * cron: cron fires daily, the function enforces the per-owner throttle via
 * public.presales_reminder_sends.
 *
 * Auth: verify_jwt is on. pg_cron passes the anon key from the vault as
 * the bearer, which the edge runtime validates before invoking the
 * function — no app-level secret check needed.
 *
 * Reuses the Microsoft Graph client-credentials flow from send-vendor-email
 * (same GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET /
 * GRAPH_SENDER_MAILBOX secrets).
 */

/// <reference lib="deno.ns" />

// @ts-expect-error Deno global provided by the edge runtime
const env = (name: string) => Deno.env.get(name);
// @ts-expect-error esm.sh resolves at runtime in Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const GRAPH_TENANT_ID = env('GRAPH_TENANT_ID');
const GRAPH_CLIENT_ID = env('GRAPH_CLIENT_ID');
const GRAPH_CLIENT_SECRET = env('GRAPH_CLIENT_SECRET');
const GRAPH_SENDER_MAILBOX = env('GRAPH_SENDER_MAILBOX');
const GRAPH_SENDER_NAME = env('GRAPH_SENDER_NAME') || 'Simpliigence Presales';
const DASHBOARD_URL = env('DASHBOARD_URL') || 'https://raghu-simplii.github.io/simpliigence-dashboard/pipeline';

/** How long since the last reminder before we send another. 44h so a daily-
 *  fired cron ends up sending roughly every other day even if the cron
 *  time drifts by a few minutes between firings. */
const REMINDER_INTERVAL_HOURS = 44;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface ActivityRow {
  id: string;
  owner_email: string | null;
  title: string;
  description: string | null;
  activity_type: string;
  priority: string;
  status: string;
  account_name: string | null;
  due_date: string | null;
  pipeline_project_id: string | null;
  revenue_impact: number | null;
  created_at: string;
}

const PRIORITY_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const STATUS_LABEL: Record<string, string> = { open: 'Open', in_progress: 'In progress' };
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderEmailBody(_ownerEmail: string, activities: ActivityRow[]): { subject: string; html: string } {
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...activities].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 3;
    const pb = PRIORITY_RANK[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
    if (a.due_date) return -1;
    if (b.due_date) return 1;
    return a.created_at.localeCompare(b.created_at);
  });

  const rows = sorted.map((a) => {
    const ageDays = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000);
    const dueStr = a.due_date
      ? (a.due_date < today ? `<span style="color:#b91c1c;font-weight:600">${esc(a.due_date)} (overdue)</span>` : esc(a.due_date))
      : '<span style="color:#94a3b8">—</span>';
    const priorityColor = a.priority === 'high' ? '#b91c1c' : a.priority === 'medium' ? '#b45309' : '#64748b';
    const desc = (a.description || '').trim();
    const descTruncated = desc.length > 220 ? desc.slice(0, 220).trim() + '…' : desc;
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top">
        <div style="font-weight:600;color:#0f172a">${esc(a.title)}</div>
        ${a.account_name ? `<div style="font-size:12px;color:#475569;margin-top:2px">${esc(a.account_name)}</div>` : ''}
        ${descTruncated ? `<div style="font-size:12px;color:#475569;margin-top:4px;line-height:1.4">${esc(descTruncated)}</div>` : ''}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:12px">${esc(a.activity_type)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:12px"><span style="color:${priorityColor};font-weight:600">${esc(PRIORITY_LABEL[a.priority] || a.priority)}</span></td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:12px">${esc(STATUS_LABEL[a.status] || a.status)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:12px">${dueStr}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:12px;color:#64748b">${ageDays}d</td>
    </tr>`;
  }).join('');

  const highCount = sorted.filter((a) => a.priority === 'high').length;
  const overdueCount = sorted.filter((a) => a.due_date && a.due_date < today).length;
  const summaryBits: string[] = [`${sorted.length} open`];
  if (highCount > 0) summaryBits.push(`<span style="color:#b91c1c">${highCount} high priority</span>`);
  if (overdueCount > 0) summaryBits.push(`<span style="color:#b91c1c">${overdueCount} overdue</span>`);

  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;max-width:760px;margin:0 auto;padding:24px">
    <div style="padding-bottom:12px;border-bottom:2px solid #F97316;margin-bottom:20px">
      <div style="font-size:18px;font-weight:600;color:#0f172a">Presales activities assigned to you</div>
      <div style="font-size:13px;color:#475569;margin-top:4px">${summaryBits.join(' · ')}</div>
    </div>
    <p style="font-size:14px;line-height:1.55;margin:0 0 16px 0">These presales activities are assigned to you and are still open or in progress. Please move them forward or update their status in the pipeline tracker.</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 20px 0">
      <thead>
        <tr style="background:#F1F5F9;text-align:left">
          <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#475569;font-weight:600">Activity</th>
          <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#475569;font-weight:600">Type</th>
          <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#475569;font-weight:600">Priority</th>
          <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#475569;font-weight:600">Status</th>
          <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#475569;font-weight:600">Due</th>
          <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#475569;font-weight:600">Age</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:13px;line-height:1.55;margin:16px 0">Update these on the Presales tracker: <a href="${DASHBOARD_URL}" style="color:#F97316;font-weight:600;text-decoration:none">${DASHBOARD_URL}</a></p>
    <p style="font-size:11px;color:#94a3b8;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px">This is an automated reminder sent every ~2 days while activities remain open. To stop receiving it for a specific activity, mark it as Done or Cancelled in the tracker.</p>
  </div>`;

  const subject = `Presales: ${sorted.length} open activit${sorted.length === 1 ? 'y' : 'ies'} assigned to you`;
  return { subject, html };
}

async function getGraphToken(): Promise<string> {
  const url = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: GRAPH_CLIENT_ID!,
    client_secret: GRAPH_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(`Graph token failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const data = await r.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Graph token response missing access_token');
  return data.access_token;
}

async function sendEmail(token: string, to: string, subject: string, html: string): Promise<void> {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(GRAPH_SENDER_MAILBOX!)}/sendMail`;
  const payload = {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }],
      from: { emailAddress: { address: GRAPH_SENDER_MAILBOX!, name: GRAPH_SENDER_NAME } },
      replyTo: [{ emailAddress: { address: GRAPH_SENDER_MAILBOX! } }],
    },
    saveToSentItems: true,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Graph sendMail rejected (${r.status}): ${(await r.text()).slice(0, 300)}`);
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: activities, error: qErr } = await supabase
      .from('presales_activities')
      .select('id, owner_email, title, description, activity_type, priority, status, account_name, due_date, pipeline_project_id, revenue_impact, created_at')
      .in('status', ['open', 'in_progress'])
      .not('owner_email', 'is', null);
    if (qErr) {
      return new Response(JSON.stringify({ error: 'query failed', detail: qErr.message }), { status: 500, headers: corsHeaders });
    }

    const byOwner = new Map<string, ActivityRow[]>();
    for (const row of (activities as ActivityRow[])) {
      const key = (row.owner_email || '').trim().toLowerCase();
      if (!key) continue;
      const list = byOwner.get(key) || [];
      list.push(row);
      byOwner.set(key, list);
    }

    if (byOwner.size === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'no owners with open activities' }), { headers: corsHeaders });
    }

    const { data: recentSends, error: sErr } = await supabase
      .from('presales_reminder_sends')
      .select('owner_email, last_sent_at')
      .in('owner_email', Array.from(byOwner.keys()));
    if (sErr) {
      return new Response(JSON.stringify({ error: 'reminder-send lookup failed', detail: sErr.message }), { status: 500, headers: corsHeaders });
    }
    const lastSentByOwner = new Map<string, string>();
    for (const r of (recentSends as { owner_email: string; last_sent_at: string }[])) {
      lastSentByOwner.set(r.owner_email.toLowerCase(), r.last_sent_at);
    }

    const now = Date.now();
    const cutoff = now - REMINDER_INTERVAL_HOURS * 3600 * 1000;

    const results: Array<{ owner: string; sent: boolean; reason?: string; activities: number; error?: string }> = [];
    let token: string | null = null;

    for (const [owner, rows] of byOwner.entries()) {
      const lastSent = lastSentByOwner.get(owner);
      if (lastSent && new Date(lastSent).getTime() > cutoff) {
        const hoursSince = Math.round((now - new Date(lastSent).getTime()) / 3600 / 1000);
        results.push({ owner, sent: false, reason: `throttled (${hoursSince}h since last send, need ${REMINDER_INTERVAL_HOURS}h)`, activities: rows.length });
        continue;
      }
      try {
        if (!token) token = await getGraphToken();
        const { subject, html } = renderEmailBody(owner, rows);
        await sendEmail(token, owner, subject, html);
        await supabase.from('presales_reminder_sends').upsert({
          owner_email: owner,
          last_sent_at: new Date().toISOString(),
          activity_count: rows.length,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'owner_email' });
        results.push({ owner, sent: true, activities: rows.length });
      } catch (e) {
        results.push({ owner, sent: false, error: (e as Error).message, activities: rows.length });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      owners_checked: byOwner.size,
      sent: results.filter((r) => r.sent).length,
      throttled: results.filter((r) => r.reason).length,
      failed: results.filter((r) => r.error).length,
      results,
    }), { headers: corsHeaders });
  } catch (e) {
    console.error('[presales-owner-reminder]', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});
