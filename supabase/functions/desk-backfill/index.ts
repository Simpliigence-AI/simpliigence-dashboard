/**
 * desk-backfill
 *
 * One-shot backfill for emails that arrived while the Graph subscription
 * was expired (or any window where notifications were missed). For each
 * message received since `since`, feeds a synthetic notification to
 * desk-inbound so the existing ticket-creation logic runs unchanged.
 *
 * Input:
 *   { since?: string, mailbox?: string, dryRun?: boolean }
 *   since:   ISO datetime, defaults to 48 hours ago
 *   mailbox: default sfconsulting@simpliigence.com
 *
 * Output:
 *   { ok, scanned, posted, skipped, errors, sinceUsed }
 *
 * Dedup: desk-inbound already skips messages whose graph_message_id is
 * already in ticket_messages, so re-running this is safe.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);

const SUPABASE_URL = env('SUPABASE_URL')!;
const GRAPH_TENANT_ID = env('GRAPH_TENANT_ID');
const GRAPH_CLIENT_ID = env('GRAPH_CLIENT_ID');
const GRAPH_CLIENT_SECRET = env('GRAPH_CLIENT_SECRET');
// @ts-expect-error esm.sh runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

async function getGraphToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: GRAPH_CLIENT_ID!,
    client_secret: GRAPH_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!r.ok) throw new Error(`token (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return j.access_token;
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: 'Graph secrets missing' }), { status: 500, headers: corsHeaders });
  }

  let since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  let mailbox = 'sfconsulting@simpliigence.com';
  let dryRun = false;
  try {
    const body = req.body ? await req.json() : null;
    if (body?.since) since = String(body.since);
    if (body?.mailbox) mailbox = String(body.mailbox);
    dryRun = !!body?.dryRun;
  } catch { /* empty body ok */ }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  try {
    const token = await getGraphToken();

    // Fetch messages received since `since`. Cap at 100 to be safe;
    // paginate via @odata.nextLink if there's more.
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages?$filter=${encodeURIComponent(`receivedDateTime ge ${since}`)}&$select=id,subject,receivedDateTime,from&$top=100&$orderby=receivedDateTime asc`;
    const gRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!gRes.ok) throw new Error(`Graph list (${gRes.status}): ${(await gRes.text()).slice(0, 300)}`);
    const gJson = await gRes.json();
    const messages: Array<{ id: string; subject?: string; receivedDateTime?: string; from?: { emailAddress?: { address?: string } } }> = gJson.value ?? [];

    // Load active subscription so we can put its clientState + id on the
    // synthetic notification (desk-inbound requires clientState match).
    const { data: sub } = await supabase
      .from('graph_subscriptions')
      .select('id, client_state, resource')
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) throw new Error('No active graph subscription; run desk-graph-setup first.');

    let posted = 0, skipped = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const m of messages) {
      // desk-inbound already dedupes on graph_message_id — but we can pre-
      // check to save an HTTP roundtrip.
      const { data: existing } = await supabase.from('ticket_messages').select('id').eq('graph_message_id', m.id).maybeSingle();
      if (existing) { skipped += 1; continue; }
      if (dryRun) { posted += 1; continue; }

      const notification = {
        value: [{
          subscriptionId: sub.id,
          changeType: 'created',
          resource: `${sub.resource}/${m.id}`,
          resourceData: { id: m.id },
          clientState: sub.client_state,
          tenantId: GRAPH_TENANT_ID,
        }],
      };
      const r = await fetch(`${SUPABASE_URL}/functions/v1/desk-inbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notification),
      });
      if (r.ok) posted += 1;
      else errors.push({ id: m.id, error: `${r.status}: ${(await r.text()).slice(0, 120)}` });
      // Small pause so we don't trip Supabase's per-function rate limit
      // when hammering desk-inbound in a tight loop.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    return new Response(JSON.stringify({
      ok: true,
      dryRun,
      sinceUsed: since,
      mailbox,
      scanned: messages.length,
      posted,
      skipped,
      errors: errors.slice(0, 20),
      hasMore: !!gJson['@odata.nextLink'],
    }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message.slice(0, 500) }), { status: 500, headers: corsHeaders });
  }
});
