/**
 * Supabase Edge Function: desk-graph-setup
 *
 * Admin-triggered helper to create / renew / delete the Microsoft Graph
 * change-notification subscription that pushes new emails to `desk-inbound`.
 *
 * Actions (POST body):
 *   { action: 'create',  mailbox: 'sfconsulting@simpliigence.com' }
 *   { action: 'renew',   id: '<subscription-id>' }
 *   { action: 'delete',  id: '<subscription-id>' }
 *   { action: 'status' }
 *
 * Env:
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET  (client-credentials flow)
 *   DESK_INBOUND_URL   — full URL of the desk-inbound edge function
 *                         (default: '<SUPABASE_URL>/functions/v1/desk-inbound')
 *   DESK_CLIENT_STATE  — shared secret to verify incoming webhooks
 *                         (auto-generated if not set)
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);
// @ts-expect-error esm.sh at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const GRAPH_TENANT_ID = env('GRAPH_TENANT_ID');
const GRAPH_CLIENT_ID = env('GRAPH_CLIENT_ID');
const GRAPH_CLIENT_SECRET = env('GRAPH_CLIENT_SECRET');
const DESK_INBOUND_URL = env('DESK_INBOUND_URL') || `${SUPABASE_URL}/functions/v1/desk-inbound`;
const DESK_CLIENT_STATE_ENV = env('DESK_CLIENT_STATE');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

function nanoid(len = 32): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

async function getGraphToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: GRAPH_CLIENT_ID!,
    client_secret: GRAPH_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
  });
  const r = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, { method: 'POST', body });
  if (!r.ok) throw new Error(`MS token (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const d = await r.json() as { access_token?: string };
  if (!d.access_token) throw new Error('no access_token');
  return d.access_token;
}

// @ts-expect-error Deno.serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({})) as { action?: string; mailbox?: string; id?: string };

  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    return new Response(JSON.stringify({
      ok: false,
      message: 'Microsoft Graph credentials not configured. Set GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET on this edge function in Supabase Dashboard → Edge Functions → Secrets. The Azure AD app needs Mail.Read (application permission) with admin consent granted.',
    }), { status: 200, headers: jsonHeaders });
  }

  try {
    if (body.action === 'status') {
      const { data } = await supabase.from('graph_subscriptions').select('*').order('created_at', { ascending: false });
      return new Response(JSON.stringify({ ok: true, subscriptions: data || [] }), { headers: jsonHeaders });
    }

    const token = await getGraphToken();

    if (body.action === 'create') {
      const mailbox = body.mailbox || 'sfconsulting@simpliigence.com';
      const clientState = DESK_CLIENT_STATE_ENV || nanoid(32);
      const expiration = new Date(Date.now() + 70 * 3600_000).toISOString();
      const resource = `/users/${mailbox}/messages`;
      const r = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeType: 'created', notificationUrl: DESK_INBOUND_URL, resource, expirationDateTime: expiration, clientState }),
      });
      if (!r.ok) throw new Error(`Graph create (${r.status}): ${(await r.text()).slice(0, 500)}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sub: any = await r.json();
      await supabase.from('graph_subscriptions').upsert({
        id: sub.id, resource, change_type: 'created', notification_url: DESK_INBOUND_URL,
        client_state: clientState, expires_at: sub.expirationDateTime || expiration, active: true,
        last_renewed_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      return new Response(JSON.stringify({ ok: true, subscription: sub }), { headers: jsonHeaders });
    }

    if (body.action === 'renew') {
      if (!body.id) throw new Error('id required');
      const expiration = new Date(Date.now() + 70 * 3600_000).toISOString();
      const r = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${body.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expirationDateTime: expiration }),
      });
      if (!r.ok) throw new Error(`renew (${r.status}): ${(await r.text()).slice(0, 300)}`);
      await supabase.from('graph_subscriptions').update({ expires_at: expiration, last_renewed_at: new Date().toISOString() }).eq('id', body.id);
      return new Response(JSON.stringify({ ok: true, expiresAt: expiration }), { headers: jsonHeaders });
    }

    if (body.action === 'delete') {
      if (!body.id) throw new Error('id required');
      const r = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${body.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok && r.status !== 404) throw new Error(`delete (${r.status}): ${(await r.text()).slice(0, 300)}`);
      await supabase.from('graph_subscriptions').update({ active: false }).eq('id', body.id);
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
    }

    return new Response(JSON.stringify({ ok: false, error: 'unknown action' }), { status: 400, headers: jsonHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: jsonHeaders });
  }
});
