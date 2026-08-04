/**
 * Supabase Edge Function: leave-notify
 *
 * Sends the three transactional emails around the leave-request lifecycle:
 *   - event='submitted'  → email to the manager, "so-and-so requested leave"
 *   - event='approved'   → email to the employee, "your leave was approved"
 *   - event='rejected'   → email to the employee, "your leave was rejected"
 *
 * All emails go out as GRAPH_SENDER_MAILBOX (hr@simpliigence.com) via the
 * same Microsoft Graph client-credentials flow used by send-vendor-email
 * and presales-owner-reminder.
 *
 * Called via `supabase.functions.invoke('leave-notify', { body: {...} })`.
 * Non-blocking from the client's perspective — failures are logged but
 * never surface as a UI error.
 *
 * Request body:
 *   { requestId: string, event: 'submitted' | 'approved' | 'rejected' }
 */

/// <reference lib="deno.ns" />

// @ts-expect-error Deno global provided by edge runtime
const env = (name: string) => Deno.env.get(name);
// @ts-expect-error esm.sh resolves at runtime in Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const GRAPH_TENANT_ID = env('GRAPH_TENANT_ID');
const GRAPH_CLIENT_ID = env('GRAPH_CLIENT_ID');
const GRAPH_CLIENT_SECRET = env('GRAPH_CLIENT_SECRET');
const GRAPH_SENDER_MAILBOX = env('GRAPH_SENDER_MAILBOX');
const GRAPH_SENDER_NAME = env('GRAPH_SENDER_NAME') || 'Simpliigence HR';
const DASHBOARD_URL = env('DASHBOARD_URL') || 'https://simpliigence-ai.github.io/simpliigence-dashboard/leave';
const LEAVE_NOTIFY_CC = env('LEAVE_NOTIFY_CC') || 'akanksha@simpliigence.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

type Event = 'submitted' | 'approved' | 'rejected';

interface LeaveRequestRow {
  id: string;
  employee_email: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  manager_email: string | null;
  decision_comment: string | null;
}

interface LeaveTypeRow { id: string; name: string; code: string; color: string; }
interface UserRow { email: string; full_name: string | null; }

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

async function sendEmail(token: string, to: string, subject: string, html: string, cc: string[] = []): Promise<void> {
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(GRAPH_SENDER_MAILBOX!)}/sendMail`;
  const payload = {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }],
      ccRecipients: cc.map((address) => ({ emailAddress: { address } })),
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

function renderEmail(event: Event, req: LeaveRequestRow, type: LeaveTypeRow, empName: string): { to: string; subject: string; html: string; cc?: string[] } {
  const range = req.start_date === req.end_date
    ? req.start_date
    : `${req.start_date} → ${req.end_date}`;
  const days = req.days;
  const typeBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:${type.color};color:#fff;font-size:11px;font-weight:600">${esc(type.name)}</span>`;

  if (event === 'submitted') {
    return {
      to: req.manager_email || GRAPH_SENDER_MAILBOX!,
      cc: [LEAVE_NOTIFY_CC],
      subject: `Leave request: ${empName} — ${range} (${days}d ${type.code})`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;max-width:640px;margin:0 auto;padding:24px">
        <div style="padding-bottom:12px;border-bottom:2px solid #F97316;margin-bottom:20px">
          <div style="font-size:18px;font-weight:600">Leave request awaiting your approval</div>
          <div style="font-size:13px;color:#475569;margin-top:4px">${esc(empName)} has requested time off.</div>
        </div>
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#64748b;width:120px">Type</td><td style="padding:6px 0">${typeBadge}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Dates</td><td style="padding:6px 0;font-weight:600">${esc(range)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Days</td><td style="padding:6px 0;font-weight:600">${days}</td></tr>
          ${req.reason ? `<tr><td style="padding:6px 0;color:#64748b;vertical-align:top">Reason</td><td style="padding:6px 0">${esc(req.reason)}</td></tr>` : ''}
        </table>
        <p style="margin:20px 0"><a href="${DASHBOARD_URL}" style="display:inline-block;padding:10px 16px;background:#F97316;color:#fff;text-decoration:none;font-weight:600;border-radius:8px;font-size:13px">Approve or reject →</a></p>
        <p style="font-size:11px;color:#94a3b8;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px">You're receiving this because you're set as ${esc(empName)}'s manager on their user profile.</p>
      </div>`,
    };
  }

  if (event === 'approved') {
    return {
      to: req.employee_email,
      subject: `Leave approved: ${range} (${days}d ${type.code})`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;max-width:640px;margin:0 auto;padding:24px">
        <div style="padding-bottom:12px;border-bottom:2px solid #10b981;margin-bottom:20px">
          <div style="font-size:18px;font-weight:600">Your leave was approved ✓</div>
        </div>
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr><td style="padding:6px 0;color:#64748b;width:120px">Type</td><td style="padding:6px 0">${typeBadge}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Dates</td><td style="padding:6px 0;font-weight:600">${esc(range)}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b">Days</td><td style="padding:6px 0;font-weight:600">${days}</td></tr>
          ${req.decision_comment ? `<tr><td style="padding:6px 0;color:#64748b;vertical-align:top">Manager note</td><td style="padding:6px 0">${esc(req.decision_comment)}</td></tr>` : ''}
        </table>
        <p style="font-size:13px;color:#475569;margin:20px 0">Days have been deducted from your ${esc(type.name)} balance. Have a great time off.</p>
        <p style="font-size:11px;color:#94a3b8;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px">See all your leave: <a href="${DASHBOARD_URL}" style="color:#F97316">${DASHBOARD_URL}</a></p>
      </div>`,
    };
  }

  // rejected
  return {
    to: req.employee_email,
    subject: `Leave request declined: ${range} (${days}d ${type.code})`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;max-width:640px;margin:0 auto;padding:24px">
      <div style="padding-bottom:12px;border-bottom:2px solid #ef4444;margin-bottom:20px">
        <div style="font-size:18px;font-weight:600">Your leave request was declined</div>
      </div>
      <table style="width:100%;font-size:13px;border-collapse:collapse">
        <tr><td style="padding:6px 0;color:#64748b;width:120px">Type</td><td style="padding:6px 0">${typeBadge}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Dates</td><td style="padding:6px 0;font-weight:600">${esc(range)}</td></tr>
        <tr><td style="padding:6px 0;color:#64748b">Days</td><td style="padding:6px 0;font-weight:600">${days}</td></tr>
        ${req.decision_comment ? `<tr><td style="padding:6px 0;color:#64748b;vertical-align:top">Manager note</td><td style="padding:6px 0">${esc(req.decision_comment)}</td></tr>` : ''}
      </table>
      <p style="font-size:13px;color:#475569;margin:20px 0">You can submit a fresh request with adjusted dates on the leave page.</p>
      <p style="font-size:11px;color:#94a3b8;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px">Open leave: <a href="${DASHBOARD_URL}" style="color:#F97316">${DASHBOARD_URL}</a></p>
    </div>`,
  };
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const missing: string[] = [];
    if (!GRAPH_TENANT_ID) missing.push('GRAPH_TENANT_ID');
    if (!GRAPH_CLIENT_ID) missing.push('GRAPH_CLIENT_ID');
    if (!GRAPH_CLIENT_SECRET) missing.push('GRAPH_CLIENT_SECRET');
    if (!GRAPH_SENDER_MAILBOX) missing.push('GRAPH_SENDER_MAILBOX');
    if (missing.length > 0) {
      return new Response(JSON.stringify({ error: `Missing edge function secret(s): ${missing.join(', ')}` }), { status: 500, headers: corsHeaders });
    }

    const { requestId, event } = await req.json() as { requestId: string; event: Event };
    if (!requestId || !event) {
      return new Response(JSON.stringify({ error: 'requestId and event are required' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const [reqRes, typeReqRes] = await Promise.all([
      supabase.from('leave_requests').select('*').eq('id', requestId).single(),
      supabase.from('leave_requests').select('leave_type_id').eq('id', requestId).single(),
    ]);
    if (reqRes.error || !reqRes.data) {
      return new Response(JSON.stringify({ error: 'leave request not found', detail: reqRes.error?.message }), { status: 404, headers: corsHeaders });
    }
    const request = reqRes.data as LeaveRequestRow;

    const { data: typeRow } = await supabase.from('leave_types').select('*').eq('id', typeReqRes.data?.leave_type_id ?? request.leave_type_id).single();
    if (!typeRow) {
      return new Response(JSON.stringify({ error: 'leave type not found' }), { status: 500, headers: corsHeaders });
    }

    const { data: userRow } = await supabase.from('authorized_users').select('email, full_name').eq('email', request.employee_email).maybeSingle();
    const empName = (userRow as UserRow | null)?.full_name || request.employee_email;

    const email = renderEmail(event, request, typeRow as LeaveTypeRow, empName);
    if (!email.to) {
      return new Response(JSON.stringify({ ok: false, reason: 'no recipient — manager_email empty and no fallback' }), { headers: corsHeaders });
    }

    const token = await getGraphToken();
    await sendEmail(token, email.to, email.subject, email.html, email.cc);

    return new Response(JSON.stringify({ ok: true, sentTo: email.to, event }), { headers: corsHeaders });
  } catch (e) {
    console.error('[leave-notify]', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});
