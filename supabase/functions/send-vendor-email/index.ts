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
 *   FROM_EMAIL            — verified sender, e.g. "hr@simpliigence.com"
 *                           (must match a domain verified in Resend)
 * Optional:
 *   FROM_NAME             — display name on the From header. Default: "Simpliigence Hiring".
 *
 * Request body:
 *   {
 *     to: string | string[],     // single email or array
 *     subject: string,
 *     body: string,              // plain text (newlines preserved)
 *     replyTo?: string,          // override Reply-To
 *     fromName?: string,         // per-call override of FROM_NAME
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

    const { to, subject, body, replyTo, fromName } = await req.json() as ReqBody;
    if (!to || (Array.isArray(to) ? to.length === 0 : !to.trim())) {
      return new Response(JSON.stringify({ error: 'Missing "to" — supply a string or array' }), { status: 400, headers: corsHeaders });
    }
    if (!subject || !subject.trim()) {
      return new Response(JSON.stringify({ error: 'Missing "subject"' }), { status: 400, headers: corsHeaders });
    }
    if (!body || !body.trim()) {
      return new Response(JSON.stringify({ error: 'Missing "body"' }), { status: 400, headers: corsHeaders });
    }

    const fromHeader = `${(fromName || FROM_NAME_DEFAULT).replace(/[<>]/g, '')} <${FROM_EMAIL}>`;
    const toList = Array.isArray(to) ? to.filter(Boolean) : [to];

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
        ...(replyTo ? { reply_to: replyTo } : {}),
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
