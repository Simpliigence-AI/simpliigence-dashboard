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

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '-', mdash: '-', hellip: '...', rsquo: "'", lsquo: "'",
  rdquo: '"', ldquo: '"', bull: '*', middot: '*', trade: '(TM)',
  copy: '(c)', reg: '(R)',
};

/**
 * Flatten an HTML email body to readable plain text.
 *
 * This is what lands in `tickets.description` / `ticket_messages.body_text`,
 * which the list view and search read. It replaces the old `msg.bodyPreview`,
 * which is Graph's ~255-char summary: truncated, and with the list markup
 * flattened so every `<ol>` block restarted its numbering as literal text.
 * Rich rendering uses `ticket_messages.body_html` instead (see TicketDrawer).
 *
 * Ordered-list items are numbered here so the text version keeps its
 * sequence; the browser renumbers the real `<ol>` on the HTML side.
 */
function htmlToPlainText(html: string): string {
  let s = html;
  // Drop elements whose contents are not prose.
  s = s.replace(/<(script|style|head|title|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Number list items per enclosing <ol>; bullet the rest.
  s = s.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol\s*>/gi, (_m, inner: string) => {
    let n = 0;
    return '\n' + inner.replace(/<li\b[^>]*>/gi, () => `\n${++n}. `) + '\n';
  });
  s = s.replace(/<li\b[^>]*>/gi, '\n- ');
  // Block boundaries become newlines so paragraphs survive.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  // `li` is absent on purpose: the opening <li> already emitted a newline,
  // so closing one too would double-space every list.
  s = s.replace(/<\/(p|div|tr|h[1-6]|ul|ol|table|blockquote|pre)\s*>/gi, '\n');
  s = s.replace(/<(p|div|tr|h[1-6]|table|blockquote|pre)\b[^>]*>/gi, '\n');
  s = s.replace(/<\/t[dh]\s*>/gi, '\t');
  // Keep something for inline images so a picture-only email is not blank.
  s = s.replace(/<img\b[^>]*>/gi, ' [image] ');
  // Everything else: drop the tag, keep the text.
  s = s.replace(/<[^>]*>/g, '');
  // Entities last, so a decoded "<" cannot look like a tag.
  s = s.replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => {
    const n = parseInt(h, 16);
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
  s = s.replace(/&#(\d+);?/g, (_m, d: string) => {
    const n = parseInt(d, 10);
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
  s = s.replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
  // Tidy whitespace.
  s = s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** Consumer/free mailbox providers.
 *
 *  These are excluded from the INFERRED matching steps (website host, account
 *  name/alias): every client has someone with a gmail address, and inferring
 *  an account from "gmail" would mis-route half the desk. An explicit entry in
 *  accounts.email_domains still wins — that is an admin's deliberate choice —
 *  but it gets logged, because it is almost always a mistake. */
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.in', 'hotmail.com',
  'hotmail.co.uk', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.in',
  'yahoo.co.uk', 'ymail.com', 'rocketmail.com', 'icloud.com', 'me.com',
  'mac.com', 'aol.com', 'protonmail.com', 'proton.me', 'pm.me', 'gmx.com',
  'gmx.de', 'gmx.net', 'zohomail.com', 'mail.com', 'mail.ru', 'yandex.com',
  'yandex.ru', 'qq.com', '163.com', '126.com', 'sina.com', 'rediffmail.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net',
  'cox.net', 'btinternet.com', 'sky.com', 'orange.fr', 'free.fr', 'web.de',
  't-online.de', 'libero.it', 'naver.com', 'daum.net', 'hushmail.com',
  'fastmail.com', 'tutanota.com', 'duck.com', 'hey.com',
]);

/** Host of a free-text website field ("https://Acme.com/about" -> "acme.com"),
 *  or null when it is unusable. `www.` is dropped so it can be compared to a
 *  sending domain. */
function websiteHost(website: string | null | undefined): string | null {
  if (!website) return null;
  const raw = String(website).trim().toLowerCase();
  if (!raw) return null;
  const host = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]
    .split('@').pop()!
    .split(':')[0]
    .replace(/^www\./, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
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

  let payload: { repair?: boolean; value?: Array<{ subscriptionId?: string; changeType?: string; resource?: string;
    resourceData?: { id?: string }; clientState?: string; tenantId?: string; }> } = {};
  try { payload = await req.json(); } catch { return new Response('bad json', { status: 400 }); }

  // Opt-in repair pass. Graph never sets this; desk-backfill does, when an
  // operator explicitly asks to re-process messages that are already in
  // ticket_messages (e.g. tickets ingested before the body/attachment fix).
  // Default false, so the normal webhook path stays exactly as it was and
  // nothing is ever re-written by accident.
  const repair = payload.repair === true;

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

      // Dedup by graph message id. In repair mode we keep going and update the
      // existing rows in place instead of skipping.
      const { data: existingMsg } = await supabase.from('ticket_messages')
        .select('id, ticket_id').eq('graph_message_id', msg.id).maybeSingle();
      if (existingMsg && !repair) { results.push({ id: msg.id, ok: true, error: 'already ingested' }); continue; }

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
      // Use the real message body, not msg.bodyPreview (Graph's ~255-char
      // plain-text summary — truncated, and with all HTML structure flattened).
      // body_html keeps the rich version for the drawer; body_text/description
      // get a full-length readable flattening of it for lists and search.
      const isHtmlBody = msg.body?.contentType === 'html';
      const bodyHtml: string = isHtmlBody ? (msg.body?.content || '') : '';
      const bodyText: string = bodyHtml
        ? htmlToPlainText(bodyHtml)
        : (msg.body?.content || msg.bodyPreview || '');
      const receivedAt: string = msg.receivedDateTime || new Date().toISOString();

      // Route the ticket to an account from the sender's email domain.
      //
      // account_id is a FK to `accounts` (the Account Management table, which
      // owns email_domains) — NOT to concierge_accounts, whose ids live in a
      // different namespace. Anything we cannot resolve to an `accounts` row
      // leaves account_id null and carries the name in `account` only, which
      // is what the by-name grouping in the UI uses.
      //
      // Order: explicit domain list -> internal -> concierge website host ->
      // account name / alias -> Others. Free-mail senders skip every fuzzy
      // step so a personal address never lands on a client account.
      let accountId: string | null = null;
      let accountName: string | null = null;
      let matchReason = 'none';
      const senderDomain = from.email ? from.email.split('@')[1]?.toLowerCase() ?? null : null;
      const isFreeMail = senderDomain ? FREE_MAIL_DOMAINS.has(senderDomain) : false;

      if (senderDomain) {
        // 1. Explicit email_domains match (admin-managed on the Accounts page).
        //    Bind the error: if the column is missing or unindexed this query
        //    fails, and swallowing it silently routes every sender to Others.
        const { data: exact, error: domainErr } = await supabase.from('accounts')
          .select('id, name')
          .contains('email_domains', [senderDomain])
          .limit(1)
          .maybeSingle();
        if (domainErr) {
          console.error('[desk-inbound] accounts.email_domains lookup failed ' +
            '(is the column present? see migration 030):', domainErr.message);
        }
        if (exact) {
          accountId = exact.id;
          accountName = exact.name;
          matchReason = 'email_domains';
          if (isFreeMail) {
            console.warn(`[desk-inbound] "${senderDomain}" is a free-mail domain but is listed in ` +
              `accounts.email_domains for "${exact.name}" — every personal sender on it routes there.`);
          }
        } else if (senderDomain === 'simpliigence.com') {
          // 2. Internal fallback
          const { data: internal } = await supabase.from('accounts')
            .select('id, name').eq('id', 'acct_internal_simpliigence').maybeSingle();
          if (internal) { accountId = internal.id; accountName = internal.name; matchReason = 'internal'; }
        }
      }

      if (!accountId && senderDomain && !isFreeMail) {
        // 3. concierge_accounts.website host == sending domain. That table has
        //    no id we can put in tickets.account_id, so we re-resolve its name
        //    against `accounts`; if there is no such row we keep the name and
        //    leave the FK null rather than writing an invalid id.
        const { data: cAccts, error: cErr } = await supabase.from('concierge_accounts')
          .select('name, website').not('website', 'is', null);
        if (cErr) console.warn('[desk-inbound] concierge_accounts website lookup:', cErr.message);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hit = (cAccts ?? []).find((a: any) => websiteHost(a.website) === senderDomain);
        if (hit?.name) {
          accountName = hit.name;
          matchReason = 'concierge_website';
          // ilike is used for case-insensitivity, so escape its wildcards.
          const namePattern = String(hit.name).replace(/[%_\\]/g, (c: string) => '\\' + c);
          const { data: byName } = await supabase.from('accounts')
            .select('id, name').ilike('name', namePattern).limit(1).maybeSingle();
          if (byName) { accountId = byName.id; accountName = byName.name; }
        }
      }

      if (!accountId && !accountName && senderDomain && !isFreeMail) {
        // 4. Second-level label of the domain vs account name / team alias.
        //    Only for labels long enough that a substring hit means something
        //    ("acme-inc.com" -> "acme-inc"); short labels match far too much.
        // The domain comes from the email, so it is attacker-controlled and is
        // interpolated into a PostgREST `or` filter below — keep it to the
        // characters a hostname label can legally contain.
        const label = senderDomain.split('.')[0].replace(/[^a-z0-9-]/g, '');
        if (label && label.length >= 4) {
          const { data: fuzzy, error: fErr } = await supabase.from('accounts')
            .select('id, name')
            .or(`name.ilike.%${label}%,team_aliases.cs.{${label}}`)
            .limit(1)
            .maybeSingle();
          if (fErr) console.warn('[desk-inbound] account name/alias lookup:', fErr.message);
          if (fuzzy) { accountId = fuzzy.id; accountName = fuzzy.name; matchReason = 'name_or_alias'; }
        }
      }

      if (!accountId && !accountName) {
        // 5. Everything else lands in Others
        const { data: others } = await supabase.from('accounts')
          .select('id, name').eq('id', 'acct_others').maybeSingle();
        if (others) { accountId = others.id; accountName = others.name; matchReason = 'others'; }
      }
      console.log(`[desk-inbound] routed ${from.email ?? '(no sender)'} -> ` +
        `${accountName ?? '(unrouted)'} via ${matchReason}${isFreeMail ? ' (free-mail sender)' : ''}`);

      // Existing ticket via conversation id?
      // In repair mode the row we are re-processing already tells us the ticket.
      let ticketId: string | null = existingMsg?.ticket_id ?? null;
      if (!ticketId && conversationId) {
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
        const ticketPatch: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        };
        if (repair) {
          // Only the message the ticket was created from owns its description.
          const { data: owner } = await supabase.from('tickets')
            .select('graph_message_id').eq('id', ticketId).maybeSingle();
          if (owner?.graph_message_id === msg.id) ticketPatch.description = bodyText;
        }
        await supabase.from('tickets').update(ticketPatch).eq('id', ticketId);
      }

      let messageRowId = existingMsg?.id ?? null;
      if (messageRowId) {
        const { error: msgUpdErr } = await supabase.from('ticket_messages').update({
          from_email: from.email,
          from_name: from.name,
          to_emails: toEmails,
          cc_emails: ccEmails,
          subject,
          body_text: bodyText,
          body_html: bodyHtml,
          received_at: receivedAt,
        }).eq('id', messageRowId);
        if (msgUpdErr) throw new Error(`message update: ${msgUpdErr.message}`);
      } else {
        messageRowId = nanoid();
        const { error: msgErr } = await supabase.from('ticket_messages').insert({
          id: messageRowId,
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
      }

      // Attachments — including the inline images the HTML body references as
      // src="cid:...". Everything here is best-effort inside its own
      // try/catch: desk-inbound is the only inbound path, and Graph will not
      // usefully retry, so a Storage hiccup must never cost us the ticket.
      //
      // Gate: `hasAttachments` is FALSE on messages whose only attachments are
      // inline images, so relying on it alone is exactly how the inline
      // pictures went missing. Also probe when the body references a cid:.
      const mayHaveAttachments = msg.hasAttachments === true || /["'\s]cid:/i.test(bodyHtml);
      if (mayHaveAttachments) {
        try {
          const attRes = await fetch(`https://graph.microsoft.com/v1.0/${resource}/attachments`,
            { headers: { Authorization: `Bearer ${token}` } });
          if (!attRes.ok) {
            console.warn(`[desk-inbound] attachments fetch failed (${attRes.status}) for ${msg.id}`);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const attJson = await attRes.json() as { value?: any[] };
            // On a repair pass, skip anything already stored for this message.
            const seen = new Set<string>();
            if (repair) {
              const { data: existingAtts } = await supabase.from('ticket_attachments')
                .select('graph_attachment_id').eq('message_id', messageRowId);
              for (const r of (existingAtts ?? [])) if (r.graph_attachment_id) seen.add(r.graph_attachment_id);
            }
            for (const a of (attJson.value || [])) {
              // itemAttachment / referenceAttachment carry no bytes.
              if (a['@odata.type'] !== '#microsoft.graph.fileAttachment') continue;
              if (!a.contentBytes) continue;
              if (a.id && seen.has(a.id)) continue;
              const attId = nanoid();
              const safeName = String(a.name || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
              const storagePath = `${ticketId}/${attId}-${safeName}`;
              const bytes = Uint8Array.from(atob(a.contentBytes), (c: string) => c.charCodeAt(0));
              const { error: upErr } = await supabase.storage.from('ticket-attachments').upload(
                storagePath, bytes,
                { contentType: a.contentType || 'application/octet-stream', upsert: false });
              if (upErr) { console.warn('[desk-inbound] attachment upload failed:', upErr.message); continue; }
              const { error: attErr } = await supabase.from('ticket_attachments').insert({
                id: attId,
                ticket_id: ticketId,
                message_id: messageRowId,
                file_name: a.name || 'file',
                content_type: a.contentType || null,
                size_bytes: a.size ?? bytes.byteLength,
                storage_path: storagePath,
                graph_attachment_id: a.id || null,
                is_inline: a.isInline === true,
                // Graph reports contentId without the angle brackets the HTML
                // uses; the client normalises both sides before matching.
                content_id: a.contentId || null,
              });
              if (attErr) console.warn('[desk-inbound] attachment row insert failed:', attErr.message);
            }
          }
        } catch (e) {
          console.warn('[desk-inbound] attachments error:', e instanceof Error ? e.message : String(e));
        }
      }

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
