/**
 * Supabase Edge Function: desk-inbound
 *
 * Microsoft Graph change-notification webhook. Called when a new email lands
 * in the monitored ticket mailbox (e.g. sfconsulting@simpliigence.com).
 *
 * Two request shapes to handle:
 *  1. Validation handshake — Graph POSTs `?validationToken=xxx` when creating
 *     the subscription. Must reply 200 text/plain with the decoded token
 *     within 10 seconds, or the subscription creation fails.
 *  2. Notification — Graph POSTs JSON `{value: [{subscriptionId, resourceData,
 *     clientState, ...}]}`. For each item we fetch the message via Graph,
 *     dedupe by graph_message_id, then either create a ticket or append the
 *     message to an existing ticket in the same conversation.
 *
 * Auth: verify_jwt=false because Graph never sends a JWT. Instead we require
 * `clientState` on every notification to match the value we stored when the
 * subscription was created (see desk-graph-setup).
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

function nanoid(len = 21): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}

async function getGraphToken(): Promise<string> {
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) {
    throw new Error('Missing GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET');
  }
  const url = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: GRAPH_CLIENT_ID,
    client_secret: GRAPH_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
  });
  const r = await fetch(url, { method: 'POST', body });
  if (!r.ok) throw new Error(`MS token failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const d = await r.json() as { access_token?: string };
  if (!d.access_token) throw new Error('MS token returned no access_token');
  return d.access_token;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractEmail(recip: any): { email: string | null; name: string | null } {
  if (!recip) return { email: null, name: null };
  const ea = recip.emailAddress || recip;
  return { email: ea?.address || null, name: ea?.name || null };
}

// @ts-expect-error Deno.serve
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // 1. Validation handshake — Graph sends `POST ?validationToken=xxx`. Reply text/plain.
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken !== null) {
    return new Response(validationToken, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  if (req.method !== 'POST') return new Response('ok', { status: 200 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  let payload: { value?: Array<{ subscriptionId?: string; changeType?: string; resource?: string;
    resourceData?: { id?: string }; clientState?: string; tenantId?: string; }> } = {};
  try { payload = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

  const notifications = payload.value || [];
  const results: Array<{ id?: string; ok: boolean; error?: string }> = [];

  for (const n of notifications) {
    try {
      const { data: subRow, error: subErr } = await supabase
        .from('graph_subscriptions').select('client_state, active').eq('id', n.subscriptionId!).maybeSingle();
      if (subErr) throw new Error(`sub lookup: ${subErr.message}`);
      if (!subRow) { results.push({ ok: false, error: 'unknown subscription' }); continue; }
      if (subRow.client_state !== n.clientState) { results.push({ ok: false, error: 'clientState mismatch' }); continue; }

      const messageId = n.resourceData?.id;
      const resource = n.resource;
      if (!messageId || !resource) { results.push({ ok: false, error: 'missing message id' }); continue; }

      const token = await getGraphToken();
      const msgRes = await fetch(`https://graph.microsoft.com/v1.0/${resource}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!msgRes.ok) throw new Error(`Graph GET (${msgRes.status}): ${(await msgRes.text()).slice(0, 300)}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg: any = await msgRes.json();

      // Dedup by graph message id
      const existing = await supabase.from('ticket_messages').select('id').eq('graph_message_id', msg.id).maybeSingle();
      if (existing.data) { results.push({ id: msg.id, ok: true, error: 'already ingested' }); continue; }

      const from = extractEmail(msg.from);

      // Ignored-sender blocklist. Match rules:
      //   kind='email'     → exact match (case-insensitive)
      //   kind='domain'    → sender address ends with '@' + pattern
      //   kind='substring' → substring of the full sender email
      // If any active rule matches, we skip ticket creation entirely and
      // bump the rule's suppressed_count so the UI can show noise volume.
      if (from.email) {
        const senderLower = from.email.toLowerCase();
        const { data: rules } = await supabase
          .from('concierge_ignored_senders')
          .select('id, pattern, kind')
          .eq('is_active', true);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hit = (rules ?? []).find((r: any) => {
          const p = (r.pattern || '').toLowerCase();
          if (!p) return false;
          if (r.kind === 'email') return senderLower === p;
          if (r.kind === 'domain') return senderLower.endsWith('@' + p) || senderLower.endsWith('.' + p);
          return senderLower.includes(p);
        });
        if (hit) {
          await supabase.rpc('increment_ignored_sender', { rule_id: hit.id });
          results.push({ id: msg.id, ok: true, error: `suppressed: matched ignored-sender rule "${hit.pattern}"` });
          continue;
        }
      }

      const toEmails: string[] = (msg.toRecipients || []).map((r: unknown) => extractEmail(r).email).filter(Boolean);
      const ccEmails: string[] = (msg.ccRecipients || []).map((r: unknown) => extractEmail(r).email).filter(Boolean);
      const conversationId: string = msg.conversationId || '';
      const subject: string = msg.subject || '(no subject)';
      const bodyText: string = msg.bodyPreview || '';
      const bodyHtml: string = msg.body?.content || '';
      const receivedAt: string = msg.receivedDateTime || new Date().toISOString();

      // Best-effort account match by sender domain vs account name / team_aliases
      let accountId: string | null = null;
      let accountName: string | null = null;
      if (from.email) {
        const domain = from.email.split('@')[1]?.toLowerCase();
        if (domain) {
          const domainWord = domain.split('.')[0];
          const { data: acctMatch } = await supabase.from('accounts').select('id, name')
            .or(`name.ilike.%${domainWord}%,team_aliases.cs.{${domainWord}}`).limit(1).maybeSingle();
          if (acctMatch) { accountId = acctMatch.id; accountName = acctMatch.name; }
        }
      }

      // Existing ticket via conversation id?
      let ticketId: string | null = null;
      if (conversationId) {
        const { data: existingTicket } = await supabase.from('tickets').select('id')
          .eq('graph_conversation_id', conversationId).maybeSingle();
        if (existingTicket) ticketId = existingTicket.id;
      }

      if (!ticketId) {
        const { data: recent } = await supabase.from('tickets').select('ticket_number')
          .order('created_at', { ascending: false }).limit(50);
        let nextNumber = 1;
        for (const r of (recent || [])) {
          const n2 = parseInt(r.ticket_number, 10);
          if (Number.isFinite(n2) && n2 >= nextNumber) nextNumber = n2 + 1;
        }
        ticketId = nanoid();
        const { error: insertErr } = await supabase.from('tickets').insert({
          id: ticketId,
          ticket_number: String(nextNumber),
          subject,
          status: 'Open',
          priority: 'medium',
          source: 'email',
          account: accountName,
          account_id: accountId,
          sender_email: from.email,
          sender_name: from.name,
          description: bodyText,
          graph_message_id: msg.id,
          graph_conversation_id: conversationId || null,
          created_time: receivedAt,
          last_synced_at: new Date().toISOString(),
        });
        if (insertErr) throw new Error(`ticket insert: ${insertErr.message}`);
      } else {
        await supabase.from('tickets').update({
          updated_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        }).eq('id', ticketId);
      }

      const { error: msgErr } = await supabase.from('ticket_messages').insert({
        id: nanoid(),
        ticket_id: ticketId,
        direction: 'inbound',
        from_email: from.email,
        from_name: from.name,
        to_emails: toEmails,
        cc_emails: ccEmails,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        graph_message_id: msg.id,
        received_at: receivedAt,
      });
      if (msgErr) throw new Error(`message insert: ${msgErr.message}`);

      results.push({ id: msg.id, ok: true });
    } catch (err) {
      const em = err instanceof Error ? err.message : String(err);
      console.error('[desk-inbound] failed:', em);
      results.push({ ok: false, error: em });
    }
  }

  return new Response(JSON.stringify({ processed: results.length, results }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
});
