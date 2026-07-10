/**
 * Supabase Edge Function: zoho-desk-sync
 *
 * Fetches OPEN + ON HOLD + ESCALATED tickets from Zoho Desk and upserts them
 * into public.tickets. Called by the Concierge page's Refresh button.
 *
 * Required env (Supabase Edge Functions → Secrets):
 *   ZOHO_CLIENT_ID              OAuth app client id (same one used by other zoho-* fns)
 *   ZOHO_CLIENT_SECRET          OAuth app client secret
 *   ZOHO_DESK_REFRESH_TOKEN     self-client refresh token with Desk.tickets.READ scope
 *   ZOHO_DESK_ORG_ID            numeric org id from Zoho Desk setup
 *   ZOHO_DC                     (optional) 'in' | 'com' | 'eu' | 'au' — default 'in'
 *
 * Response: { ok, count, syncedAt, error?, message? }
 *
 * Writes sync_status.zoho_desk_tickets on every call — success or failure —
 * so the Concierge UI's "Last synced" chip reflects reality.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);
// @ts-expect-error esm.sh resolves at runtime in Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ZOHO_DC = env('ZOHO_DC') || 'in';
const ZOHO_CLIENT_ID = env('ZOHO_CLIENT_ID');
const ZOHO_CLIENT_SECRET = env('ZOHO_CLIENT_SECRET');
const ZOHO_DESK_REFRESH_TOKEN = env('ZOHO_DESK_REFRESH_TOKEN');
const ZOHO_DESK_ORG_ID = env('ZOHO_DESK_ORG_ID');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;

const ACCOUNTS_BASE = `https://accounts.zoho.${ZOHO_DC}`;
const DESK_BASE = `https://desk.zoho.${ZOHO_DC}`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

async function getAccessToken(): Promise<string> {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_DESK_REFRESH_TOKEN) {
    throw new Error('Missing Zoho Desk secrets (ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_DESK_REFRESH_TOKEN)');
  }
  const params = new URLSearchParams({
    refresh_token: ZOHO_DESK_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Zoho OAuth failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Zoho OAuth returned no access_token');
  return data.access_token;
}

interface ZohoTicket {
  id: string;
  ticketNumber?: string;
  subject?: string;
  status?: string;
  priority?: string | null;
  channel?: string;
  createdTime?: string;
  dueDate?: string | null;
  webUrl?: string;
  threadCount?: string | number;
  commentCount?: string | number;
  accountId?: string;
  account?: { accountName?: string };
  contact?: { accountName?: string };
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const startedAt = new Date();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // Graceful fallback if creds aren't configured. UI shows cached data + a helpful message.
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_DESK_REFRESH_TOKEN || !ZOHO_DESK_ORG_ID) {
    await supabase.from('sync_status').upsert({
      source: 'zoho_desk_tickets',
      last_ok: false,
      last_error: 'ZOHO_CLIENT_ID/SECRET/DESK_REFRESH_TOKEN/DESK_ORG_ID not configured — ask Raghu to set them via Supabase Dashboard → Edge Functions → Secrets.',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source' });
    return new Response(JSON.stringify({
      ok: false,
      message: 'Zoho Desk credentials not configured on the edge function. Set ZOHO_DESK_REFRESH_TOKEN + ZOHO_DESK_ORG_ID via Supabase Dashboard → Edge Functions → Secrets. Cached tickets continue to render.',
    }), { status: 200, headers: jsonHeaders });
  }

  try {
    const accessToken = await getAccessToken();

    // Zoho Desk paginates via `from`/`limit` (max 100 per page). Pull up to
    // 500 tickets across statuses we care about.
    const STATUS_FILTER = 'Open,On Hold,Escalated';
    const LIMIT = 100;
    const MAX_PAGES = 5;
    const collected: ZohoTicket[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${DESK_BASE}/api/v1/tickets?status=${encodeURIComponent(STATUS_FILTER)}&limit=${LIMIT}&from=${page * LIMIT}&sortBy=-createdTime&include=contacts`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Zoho-oauthtoken ${accessToken}`,
          orgId: ZOHO_DESK_ORG_ID,
        },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Zoho Desk GET failed (${res.status}): ${text.slice(0, 400)}`);
      }
      const body = await res.json() as { data?: ZohoTicket[] };
      const data = body.data || [];
      collected.push(...data);
      if (data.length < LIMIT) break;
    }

    const nowIso = new Date().toISOString();
    const rows = collected.map((t) => ({
      id: t.id,
      ticket_number: String(t.ticketNumber ?? ''),
      subject: t.subject || '',
      status: t.status || 'Open',
      priority: t.priority ?? null,
      account: t.account?.accountName || t.contact?.accountName || null,
      channel: t.channel || null,
      created_time: t.createdTime || null,
      due_date: t.dueDate || null,
      web_url: t.webUrl || null,
      thread_count: Number(t.threadCount ?? 0) || 0,
      comment_count: Number(t.commentCount ?? 0) || 0,
      last_synced_at: nowIso,
    }));

    if (rows.length > 0) {
      const { error: e } = await supabase.from('tickets').upsert(rows, { onConflict: 'id' });
      if (e) throw new Error(`upsert failed: ${e.message}`);
    }

    // Drop tickets we no longer see (closed or moved out of our watched statuses).
    if (collected.length > 0) {
      const activeIds = rows.map((r) => r.id);
      const { error: e } = await supabase.from('tickets').delete().not('id', 'in', `(${activeIds.map((x) => `"${x}"`).join(',')})`);
      if (e) console.warn('[zoho-desk-sync] stale-cleanup delete failed:', e.message);
    }

    const finishedAt = new Date();
    await supabase.from('sync_status').upsert({
      source: 'zoho_desk_tickets',
      last_synced_at: nowIso,
      last_ok: true,
      last_error: null,
      last_duration_ms: finishedAt.getTime() - startedAt.getTime(),
      last_rows_upserted: rows.length,
      updated_at: nowIso,
    }, { onConflict: 'source' });

    return new Response(JSON.stringify({
      ok: true,
      count: rows.length,
      syncedAt: nowIso,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    }), { headers: jsonHeaders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from('sync_status').upsert({
      source: 'zoho_desk_tickets',
      last_ok: false,
      last_error: msg.slice(0, 1000),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source' });
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: jsonHeaders });
  }
});
