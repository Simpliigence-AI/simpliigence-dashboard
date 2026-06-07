/**
 * Supabase Edge Function: send-vendor-email
 *
 * Phase 2 of the Send-to-Vendor flow: actually delivers the email from
 * the server instead of opening a `mailto:` link in the user's mail client.
 *
 * Email provider: Resend (https://resend.com). Cheapest, simplest API for
 * transactional email. Free tier covers 3,000/month which is plenty for
 * vendor outreach.
 *
 * Required secrets (set with `supabase secrets set ...`):
 *   RESEND_API_KEY        — re_xxx key from Resend dashboard
 *   FROM_EMAIL            — fallback sender, e.g. "no-reply@simpliigence.com"
 *                           (its domain must be verified in Resend).
 *                           Used only when the caller does not pass `from`.
 * Optional:
 *   FROM_NAME             — display name on the From header. Default: "Simpliigence Hiring".
 *   FROM_DOMAIN_ALLOWLIST — comma-separated list of domains the caller is
 *                           allowed to send AS. Defaults to the domain of FROM_EMAIL.
 *
 * Request body:
 *   {
 *     to: string | string[],     // single email or array
 *     subject: string,
 *     body: string,              // plain text (newlines preserved)
 *     from?: string,             // per-call sender — must be on the allow-listed domain
 *     fromName?: string,         // display name override (e.g. "Raghu Seetharam")
 *     replyTo?: string,          // override Reply-To (defaults to `from` so vendors reply to the recruiter)
 *   }
 *
 * Response (success):
 *   { ok: true, id: string }
 *
 * Response (error):
 *   { error: string, detail?: string } with HTTP 4xx/5xx.
 *
 * Notes:
 *   - The function authenticates the caller via Supabase JWT (verify_jwt=true
 *     on the function). Anyone signed in can send — the SendToVendorDialog
 *     already gates by role on the page side.
 *   - We DO NOT log to vendor_outreach here — the client does that so it can
 *     associate the outreach row with a requisition_id and other context it
 *     already has in hand.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno runtime
const env = (name: string) => Deno.env.get(name);

const RESEND_API_KEY = env('RESEND_API_KEY');
const FROM_EMAIL = env('FROM_EMAIL');
const FROM_NAME_DEFAULT = env('FROM_NAME') || 'Simpliigence Hiring';
const FROM_DOMAIN_ALLOWLIST = (env('FROM_DOMAIN_ALLOWLIST') || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Pull the domain part out of "user@domain.tld". */
function emailDomain(addr: string): string {
  const idx = addr.lastIndexOf('@');
  return idx > 0 ? addr.slice(idx + 1).toLowerCase() : '';
}

/** Domains the caller is allowed to send AS via the `from` param.
 *  Defaults to the domain of FROM_EMAIL. Override with
 *  FROM_DOMAIN_ALLOWLIST=simpliigence.com,foo.com to allow extras. */
function allowedFromDomains(): string[] {
  if (FROM_DOMAIN_ALLOWLIST.length > 0) return FROM_DOMAIN_ALLOWLIST;
  const d = FROM_EMAIL ? emailDomain(FROM_EMAIL) : '';
  return d ? [d] : [];
}

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
  from?: string;
  replyTo?: string;
  fromName?: string;
}

/** Convert plain-text body (with newlines) to a minimally-HTMLified version
 *  so the email renders with paragraph breaks in any client. We deliberately
 *  keep both `text` and `html` on the Resend payload so plain-text clients
 *  fall back nicely. */
function bodyToHtml(plain: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Wrap each paragraph in <p>; convert single newlines inside a paragraph to <br>.
  const paragraphs = plain.split(/\n{2,}/).map((p) => {
    const inner = escape(p).replace(/\n/g, '<br>');
    return `<p style="margin:0 0 12px 0; line-height:1.5;">${inner}</p>`;
  });
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #1e293b;">${paragraphs.join('')}</div>`;
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({
          error: 'RESEND_API_KEY secret is not set on this Supabase project',
          detail: 'Sign up at resend.com (free), grab an API key, then run: supabase secrets set RESEND_API_KEY=re_xxx --project-ref <your-project>',
        }),
        { status: 500, headers: corsHeaders },
      );
    }
    if (!FROM_EMAIL) {
      return new Response(
        JSON.stringify({
          error: 'FROM_EMAIL secret is not set on this Supabase project',
          detail: 'Set it via: supabase secrets set FROM_EMAIL=hr@simpliigence.com. The domain must be verified in your Resend dashboard.',
        }),
        { status: 500, headers: corsHeaders },
      );
    }

    const { to, subject, body, from, replyTo, fromName } = await req.json() as ReqBody;
    if (!to || (Array.isArray(to) ? to.length === 0 : !to.trim())) {
      return new Response(JSON.stringify({ error: 'Missing "to" — supply a string or array' }), { status: 400, headers: corsHeaders });
    }
    if (!subject || !subject.trim()) {
      return new Response(JSON.stringify({ error: 'Missing "subject"' }), { status: 400, headers: corsHeaders });
    }
    if (!body || !body.trim()) {
      return new Response(JSON.stringify({ error: 'Missing "body"' }), { status: 400, headers: corsHeaders });
    }

    // Resolve the actual sender:
    //   - If the caller passed `from` and its domain is on the allowlist,
    //     use it. This is how each recruiter sends AS themselves so vendor
    //     replies land directly in their inbox.
    //   - If `from` is on a non-allowlisted domain, reject — otherwise this
    //     function would let anyone spoof any domain through the verified
    //     Resend setup.
    //   - If `from` is omitted, fall back to FROM_EMAIL (the old behaviour).
    const allowed = allowedFromDomains();
    let sender = FROM_EMAIL;
    if (from && from.trim()) {
      const reqDomain = emailDomain(from.trim());
      if (!reqDomain || !allowed.includes(reqDomain)) {
        return new Response(
          JSON.stringify({
            error: `Sender domain "${reqDomain || from}" is not allowed`,
            detail: `Allowed sending domains: ${allowed.join(', ') || '(none — set FROM_DOMAIN_ALLOWLIST or FROM_EMAIL)'}`,
          }),
          { status: 400, headers: corsHeaders },
        );
      }
      sender = from.trim();
    }

    const displayName = (fromName || FROM_NAME_DEFAULT).replace(/[<>]/g, '');
    const fromHeader = `${displayName} <${sender}>`;
    const toList = Array.isArray(to) ? to.filter(Boolean) : [to];
    // Default Reply-To to the sender so replies bounce back to the recruiter
    // even if a mail client rewrites the visible From header.
    const effectiveReplyTo = replyTo || sender;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromHeader,
        to: toList,
        subject: subject.trim(),
        text: body,
        html: bodyToHtml(body),
        reply_to: effectiveReplyTo,
      }),
    });

    if (!resendRes.ok) {
      const text = await resendRes.text();
      // Resend returns { name, message } JSON on error; surface it intact.
      return new Response(
        JSON.stringify({ error: 'Resend rejected the email', detail: text.slice(0, 500) }),
        { status: 502, headers: corsHeaders },
      );
    }
    const data = await resendRes.json() as { id?: string };
    if (!data.id) {
      return new Response(JSON.stringify({ error: 'Resend returned no id', detail: JSON.stringify(data).slice(0, 200) }), { status: 502, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true, id: data.id }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[send-vendor-email]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
