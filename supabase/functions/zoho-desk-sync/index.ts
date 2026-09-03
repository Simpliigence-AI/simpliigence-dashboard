/**
 * Supabase Edge Function: zoho-desk-sync
 *
 * Fetches OPEN + ON HOLD + ESCALATED tickets from Zoho Desk and upserts them
 * into public.tickets. Called by the Concierge page's Refresh button.
 *
 * Also brings each ticket's attachments over: the files on the ticket itself
 * and the files on its conversation threads are downloaded, uploaded to the
 * private `ticket-attachments` Storage bucket, and recorded in
 * public.ticket_attachments with `zoho_attachment_id` set — the same table and
 * bucket the email path (desk-inbound) writes to, using the same storage path
 * convention, so both sources coexist. Requires migration 032.
 *
 * Attachment work is best-effort: a ticket or a file that fails is counted and
 * reported, never fatal to the sync. Downloading needs the refresh token's
 * Desk scope to cover ticket reads; a 401/403 from the attachment endpoints
 * means the token must be re-issued with Desk.tickets.READ.
 *
 * Required env (Supabase Edge Functions → Secrets):
 *   ZOHO_CLIENT_ID              OAuth app client id (same one used by other zoho-* fns)
 *   ZOHO_CLIENT_SECRET          OAuth app client secret
 *   ZOHO_DESK_REFRESH_TOKEN     self-client refresh token with Desk.tickets.READ scope
 *   ZOHO_DESK_ORG_ID            numeric org id from Zoho Desk setup
 *   ZOHO_DC                     (optional) 'in' | 'com' | 'eu' | 'au' — default 'in'
 *
 * Response: { ok, count, syncedAt, attachments?, error?, message? }
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
  attachmentCount?: string | number;   // read for attachment sync; not mapped to a column
  accountId?: string;
  account?: { accountName?: string };
  contact?: { accountName?: string };
}

// --- Attachments -----------------------------------------------------------

// Caps, so one pathological ticket cannot stall a whole sync. Everything past
// a cap is counted and logged, never silently dropped.
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;  // Zoho's own per-file ceiling is well under this
const MAX_ATTACHMENTS_PER_TICKET = 25;
const MAX_THREADS_PER_TICKET = 25;
// A page of tickets that mostly do have attachments still runs several Zoho
// calls each and can out-run the function's execution limit. Stop scanning at
// this point and report how many tickets went unscanned; the next sync picks
// them up (already stored files are skipped, so nothing is re-downloaded).
const ATTACHMENT_SCAN_BUDGET_MS = 60_000;

interface ZohoAttachment {
  id?: string;
  name?: string;
  size?: string | number;   // Zoho sends this as a string
  href?: string | null;
}

// The same attachment downloads from a different path depending on whether it
// hangs off the ticket or off one of its conversation threads.
interface FoundAttachment {
  att: ZohoAttachment;
  threadId?: string;
}

interface AttachmentStats {
  stored: number;
  skipped: number;
  failed: number;
  unscannedTickets: number;
}

// Local copy of desk-inbound's id minter. There is no supabase/functions/_shared.
function nanoid(len = 21): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

function deskFetch(url: string, accessToken: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      orgId: ZOHO_DESK_ORG_ID!,
    },
  });
}

async function deskJson<T>(path: string, accessToken: string): Promise<T> {
  const res = await deskFetch(`${DESK_BASE}${path}`, accessToken);
  if (!res.ok) {
    throw new Error(`Zoho Desk GET ${path} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  // Zoho answers "nothing here" with 204 and an empty body rather than an
  // empty list, and res.json() throws on that — which would have turned every
  // attachment-free ticket into a reported failure.
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Where to GET an attachment's bytes.
 *
 * Zoho's published OpenAPI spec puts an `href` on every attachment object and
 * documents no ticket-level `/content` path, so `href` is the authoritative
 * link. It comes back in several shapes though — relative, absolute, and on
 * the agent console's `/supportapi` prefix — and it is a URL handed to us by a
 * remote response, so we keep only its path and re-host it on our own
 * DESK_BASE rather than following it as given. When Zoho omits `href` we fall
 * back to the `/content` convention its spec documents for every other
 * attachment family (comments, articles, community topics, transitions).
 */
function attachmentUrl(att: ZohoAttachment, ticketId: string, threadId?: string): string {
  if (att.href) {
    try {
      const path = new URL(att.href, DESK_BASE).pathname.replace('/supportapi/', '/');
      if (path.startsWith('/api/v1/')) return `${DESK_BASE}${path}`;
    } catch {
      // Malformed href — fall through to the documented path below.
    }
  }
  const base = threadId
    ? `${DESK_BASE}/api/v1/tickets/${ticketId}/threads/${threadId}/attachments`
    : `${DESK_BASE}/api/v1/tickets/${ticketId}/attachments`;
  return `${base}/${att.id}/content`;
}

/**
 * Every attachment Zoho holds for one ticket: the ticket's own files, plus the
 * files on each conversation thread.
 *
 * The counts Zoho already returned on the ticket list do the pruning, so the
 * common case — a ticket with nothing attached anywhere — costs no API call at
 * all, and neither does a thread with no files. A count Zoho omitted means
 * "unknown", so we look rather than assume empty.
 */
async function findAttachments(ticket: ZohoTicket, accessToken: string): Promise<FoundAttachment[]> {
  const found: FoundAttachment[] = [];

  if (Number(ticket.attachmentCount ?? NaN) !== 0) {
    const ticketLevel = await deskJson<{ data?: ZohoAttachment[] }>(
      `/api/v1/tickets/${ticket.id}/attachments`, accessToken);
    for (const att of ticketLevel.data ?? []) found.push({ att });
  }

  if ((Number(ticket.threadCount ?? 0) || 0) > 0) {
    const threads = await deskJson<{ data?: { id?: string; attachmentCount?: string | number }[] }>(
      `/api/v1/tickets/${ticket.id}/threads?limit=${MAX_THREADS_PER_TICKET}`, accessToken);
    for (const t of threads.data ?? []) {
      if (!t.id || Number(t.attachmentCount ?? NaN) === 0) continue;
      const detail = await deskJson<{ attachments?: ZohoAttachment[] }>(
        `/api/v1/tickets/${ticket.id}/threads/${t.id}`, accessToken);
      for (const att of detail.attachments ?? []) found.push({ att, threadId: t.id });
    }
  }

  return found;
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
      const body = await deskJson<{ data?: ZohoTicket[] }>(
        `/api/v1/tickets?status=${encodeURIComponent(STATUS_FILTER)}&limit=${LIMIT}&from=${page * LIMIT}&sortBy=-createdTime&include=contacts`,
        accessToken);
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

    // Attachments. Strictly additive and best-effort: the ticket upsert above
    // has already succeeded, and nothing below is allowed to undo that. Every
    // failure and every cap is counted so a partial run is visible instead of
    // looking like a clean one.
    const attachments: AttachmentStats = { stored: 0, skipped: 0, failed: 0, unscannedTickets: 0 };
    const scanDeadline = Date.now() + ATTACHMENT_SCAN_BUDGET_MS;

    for (const [i, t] of collected.entries()) {
      if (Date.now() > scanDeadline) {
        attachments.unscannedTickets = collected.length - i;
        console.warn(`[zoho-desk-sync] attachment scan budget spent; ${attachments.unscannedTickets} tickets unscanned`);
        break;
      }
      try {
        const found = await findAttachments(t, accessToken);
        if (found.length === 0) continue;

        // What we already hold for this ticket, so a re-sync neither duplicates
        // rows nor re-downloads bytes — the pre-flight desk-inbound does with
        // Graph ids, keyed on Zoho's id instead.
        const { data: stored } = await supabase.from('ticket_attachments')
          .select('zoho_attachment_id').eq('ticket_id', t.id);
        const seen = new Set<string>();
        for (const r of stored ?? []) if (r.zoho_attachment_id) seen.add(r.zoho_attachment_id);

        let attempted = 0;
        for (const { att, threadId } of found) {
          // One file can be listed both on the ticket and on a thread; `seen`
          // grows as we go, so it is only fetched once.
          if (!att.id || seen.has(att.id)) continue;
          seen.add(att.id);

          if (attempted >= MAX_ATTACHMENTS_PER_TICKET) { attachments.skipped++; continue; }
          attempted++;

          try {
            const res = await deskFetch(attachmentUrl(att, t.id, threadId), accessToken);
            if (!res.ok) {
              throw new Error(`download failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
            }
            // Size gate before anything is buffered. content-length is what the
            // server will actually send; Zoho's declared `size` covers the case
            // where the header is missing.
            const declaredBytes = Number(res.headers.get('content-length') ?? att.size ?? 0) || 0;
            if (declaredBytes > MAX_ATTACHMENT_BYTES) {
              attachments.skipped++;
              console.warn(`[zoho-desk-sync] ${att.name} on ticket ${t.id} skipped: ${declaredBytes} bytes exceeds the ${MAX_ATTACHMENT_BYTES}-byte cap`);
              continue;
            }
            const bytes = new Uint8Array(await res.arrayBuffer());
            if (bytes.byteLength === 0) throw new Error('Zoho returned an empty body');

            // Same storage path convention as desk-inbound, so email-sourced
            // and Zoho-sourced files share the bucket without colliding.
            const rowId = nanoid();
            const fileName = att.name || 'file';
            const contentType = res.headers.get('content-type');
            const storagePath = `${t.id}/${rowId}-${fileName.replace(/[^A-Za-z0-9._-]/g, '_')}`;
            const { error: upErr } = await supabase.storage.from('ticket-attachments')
              .upload(storagePath, bytes, {
                contentType: contentType || 'application/octet-stream',
                upsert: false,
              });
            if (upErr) throw new Error(`storage upload: ${upErr.message}`);

            const { error: rowErr } = await supabase.from('ticket_attachments').insert({
              id: rowId,
              ticket_id: t.id,
              message_id: null,          // attached to the ticket, not to a ticket_messages row
              file_name: fileName,
              content_type: contentType,
              size_bytes: bytes.byteLength,
              storage_path: storagePath,
              graph_attachment_id: null, // not from Graph; see zoho_attachment_id
              zoho_attachment_id: att.id,
              is_inline: false,          // Zoho serves inline images inside the thread HTML
            });
            if (rowErr) throw new Error(`row insert: ${rowErr.message}`);
            attachments.stored++;
          } catch (e) {
            attachments.failed++;
            console.warn(`[zoho-desk-sync] attachment ${att.id} on ticket ${t.id} failed:`, e instanceof Error ? e.message : String(e));
          }
        }
        if (attempted >= MAX_ATTACHMENTS_PER_TICKET) {
          console.warn(`[zoho-desk-sync] ticket ${t.id} hit the ${MAX_ATTACHMENTS_PER_TICKET}-attachment cap; the rest were skipped`);
        }
      } catch (e) {
        attachments.failed++;
        console.warn(`[zoho-desk-sync] attachment scan for ticket ${t.id} failed:`, e instanceof Error ? e.message : String(e));
      }
    }

    // NO reconciliation delete here, deliberately. This used to delete every
    // `tickets` row whose id was absent from the Zoho page we just fetched.
    // `public.tickets` is no longer Zoho-owned: tickets also arrive by email
    // via the `desk-inbound` function and are created by hand in the UI, and
    // none of those exist in Zoho — so absence from a Zoho response is not
    // evidence that a ticket is stale, and the cleanup destroyed real data
    // every time someone pressed the legacy Refresh button. Zoho-sourced rows
    // that leave the watched statuses simply keep their last synced state;
    // let them be closed/removed explicitly instead.

    // Attachment trouble must not be invisible. The Concierge chip reads
    // `last_error`, so a run that synced tickets cleanly but could not bring
    // every file over says so there, while still reporting last_ok: true.
    const attachmentNote = (attachments.failed || attachments.skipped || attachments.unscannedTickets)
      ? `tickets synced OK; attachments: ${attachments.stored} stored, ${attachments.skipped} skipped, ${attachments.failed} failed, ${attachments.unscannedTickets} tickets unscanned`
      : null;

    const finishedAt = new Date();
    await supabase.from('sync_status').upsert({
      source: 'zoho_desk_tickets',
      last_synced_at: nowIso,
      last_ok: true,
      last_error: attachmentNote,
      last_duration_ms: finishedAt.getTime() - startedAt.getTime(),
      last_rows_upserted: rows.length,
      updated_at: nowIso,
    }, { onConflict: 'source' });

    return new Response(JSON.stringify({
      ok: true,
      count: rows.length,
      syncedAt: nowIso,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      attachments,
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
