/**
 * Supabase Edge Function: send-vendor-email
 *
 * Sends a vendor outreach email via Microsoft Graph using the "HR Portal"
 * Azure AD app's application permissions (Mail.Send granted at the tenant
 * level). The email is sent AS the shared mailbox configured in
 * GRAPH_SENDER_MAILBOX (e.g. hr@simpliigence.com), so vendors see a single
 * official identity, not the individual recruiter's address.
 *
 * Why Graph instead of SMTP / Resend:
 *   - Reuses the existing HR Portal Azure app — no new vendor signup,
 *     no DNS records, no app passwords.
 *   - The email lands in the sender mailbox's Outlook Sent Items folder
 *     automatically (saveToSentItems: true) — built-in audit trail.
 *   - Replies route to the recruiter via the Reply-To header.
 *
 * Required Supabase secrets (set via Dashboard → Edge Functions → Secrets):
 *   GRAPH_TENANT_ID        — Azure AD tenant id
 *   GRAPH_CLIENT_ID        — HR Portal app client id
 *   GRAPH_CLIENT_SECRET    — HR Portal app client secret value
 *   GRAPH_SENDER_MAILBOX   — mailbox to send AS, e.g. "hr@simpliigence.com"
 *                            (this mailbox must exist in the tenant)
 *
 * Optional:
 *   GRAPH_SENDER_NAME      — display name on the From header.
 *                            Default: "Simpliigence Talent".
 *
 * Request body:
 *   {
 *     to: string | string[],     // single email or array
 *     subject: string,
 *     body: string,              // plain text (newlines preserved)
 *     fromName?: string,         // override the display name on this send
 *     replyTo?: string,          // address vendors hit when they Reply
 *                                // (default: GRAPH_SENDER_MAILBOX)
 *   }
 *
 * Response (success):
 *   { ok: true, id: string }   // synthetic id; Graph returns 202 with no body
 *
 * Response (error):
 *   { error: string, detail?: string } with HTTP 4xx/5xx.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno runtime
const env = (name: string) => Deno.env.get(name);

const GRAPH_TENANT_ID = env('GRAPH_TENANT_ID');
const GRAPH_CLIENT_ID = env('GRAPH_CLIENT_ID');
const GRAPH_CLIENT_SECRET = env('GRAPH_CLIENT_SECRET');
const GRAPH_SENDER_MAILBOX = env('GRAPH_SENDER_MAILBOX');
const GRAPH_SENDER_NAME_DEFAULT = env('GRAPH_SENDER_NAME') || 'Simpliigence Talent';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface ReqBody {
  to?: string | string[];
  subject?: string;
  body?: string;
  fromName?: string;
  replyTo?: string;
}

/** Convert plain-text body (with newlines) to a minimally-HTMLified version
 *  so the email renders with paragraph breaks in any client. Graph's
 *  `contentType: 'HTML'` makes the recipient's mail client render it; we
 *  also include the plain text inline for accessibility. */
function bodyToHtml(plain: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const paragraphs = plain.split(/\n{2,}/).map((p) => {
    const inner = escape(p).replace(/\n/g, '<br>');
    return `<p style="margin:0 0 12px 0; line-height:1.5;">${inner}</p>`;
  });
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #1e293b;">${paragraphs.join('')}</div>`;
}

/** Cache the Graph access token in module scope. Tokens are valid for ~60min;
 *  we refresh ~5min before expiry so a slow request never gets denied. Deno
 *  edge function instances stay warm long enough to amortize this. */
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 5 * 60 * 1000) {
    return cachedToken.token;
  }
  const url = `https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: GRAPH_CLIENT_ID!,
    client_secret: GRAPH_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Graph token request failed (${r.status}): ${text.slice(0, 300)}`);
  }
  const data = await r.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Graph token response missing access_token');
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    const missing: string[] = [];
    if (!GRAPH_TENANT_ID) missing.push('GRAPH_TENANT_ID');
    if (!GRAPH_CLIENT_ID) missing.push('GRAPH_CLIENT_ID');
    if (!GRAPH_CLIENT_SECRET) missing.push('GRAPH_CLIENT_SECRET');
    if (!GRAPH_SENDER_MAILBOX) missing.push('GRAPH_SENDER_MAILBOX');
    if (missing.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Missing edge function secret(s): ${missing.join(', ')}`,
          detail: 'Set these on https://supabase.com/dashboard/project/<ref>/settings/functions',
        }),
        { status: 500, headers: corsHeaders },
      );
    }

    const { to, subject, body, fromName, replyTo } = await req.json() as ReqBody;
    if (!to || (Array.isArray(to) ? to.length === 0 : !to.trim())) {
      return new Response(JSON.stringify({ error: 'Missing "to" — supply a string or array' }), { status: 400, headers: corsHeaders });
    }
    if (!subject || !subject.trim()) {
      return new Response(JSON.stringify({ error: 'Missing "subject"' }), { status: 400, headers: corsHeaders });
    }
    if (!body || !body.trim()) {
      return new Response(JSON.stringify({ error: 'Missing "body"' }), { status: 400, headers: corsHeaders });
    }

    const toList = Array.isArray(to) ? to.filter(Boolean) : [to];
    const displayName = (fromName || GRAPH_SENDER_NAME_DEFAULT).replace(/[<>]/g, '');
    const effectiveReplyTo = (replyTo && replyTo.trim()) || GRAPH_SENDER_MAILBOX!;

    let token: string;
    try {
      token = await getGraphToken();
    } catch (e) {
      const msg = (e as Error).message || String(e);
      return new Response(
        JSON.stringify({ error: 'Failed to obtain Graph access token', detail: msg }),
        { status: 502, headers: corsHeaders },
      );
    }

    const graphPayload = {
      message: {
        subject: subject.trim(),
        body: { contentType: 'HTML', content: bodyToHtml(body) },
        toRecipients: toList.map((address) => ({ emailAddress: { address } })),
        from: { emailAddress: { address: GRAPH_SENDER_MAILBOX!, name: displayName } },
        replyTo: [{ emailAddress: { address: effectiveReplyTo } }],
      },
      saveToSentItems: true,
    };

    const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(GRAPH_SENDER_MAILBOX!)}/sendMail`;
    const sendRes = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(graphPayload),
    });

    if (!sendRes.ok) {
      const text = await sendRes.text();
      // Graph's error shape is { error: { code, message } }; surface it as-is.
      return new Response(
        JSON.stringify({
          error: `Graph rejected sendMail (HTTP ${sendRes.status})`,
          detail: text.slice(0, 500),
        }),
        { status: 502, headers: corsHeaders },
      );
    }

    // Graph returns 202 Accepted with an empty body on success — no message id.
    // Synthesize a client-visible id so the outreach row has something to log.
    // Format mirrors typical email ids enough that the UI doesn't need special-casing.
    const syntheticId = `graph-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    return new Response(JSON.stringify({ ok: true, id: syntheticId }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[send-vendor-email]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
