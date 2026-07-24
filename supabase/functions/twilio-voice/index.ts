/**
 * Supabase Edge Function: twilio-voice
 *
 * TwiML webhook for the dialer's TwiML app. When the browser softphone
 * calls Device.connect({ params: { To, callId } }), Twilio hits this URL
 * and we answer with <Dial> TwiML that bridges the browser leg to the
 * PSTN number, records the call dual-channel, and points lifecycle /
 * recording callbacks at twilio-status / twilio-recording.
 *
 * Deploy with --no-verify-jwt (Twilio can't present a Supabase JWT).
 * Authenticity is checked via the X-Twilio-Signature header instead
 * (HMAC-SHA1 with TWILIO_AUTH_TOKEN, per Twilio's webhook security doc).
 *
 * Required secrets:
 *   TWILIO_AUTH_TOKEN   — for signature validation
 *   TWILIO_CALLER_ID    — E.164 Twilio number (or verified caller ID) shown to the callee
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_AUTH_TOKEN = env('TWILIO_AUTH_TOKEN');
const TWILIO_CALLER_ID = env('TWILIO_CALLER_ID');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
/** Escape hatch for debugging signature mismatches; never leave on. */
const SKIP_SIG = env('DIALER_SKIP_TWILIO_SIG') === 'true';

const xmlHeaders = { 'Content-Type': 'text/xml' };

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function twiml(inner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>${inner}</Response>`, { headers: xmlHeaders });
}

/**
 * Validate X-Twilio-Signature: Base64(HMAC-SHA1(authToken, url + sorted
 * POST params concatenated as key+value)). We rebuild the public URL from
 * SUPABASE_URL because the edge runtime's req.url can differ from the URL
 * Twilio actually signed.
 */
async function validSignature(req: Request, form: URLSearchParams): Promise<boolean> {
  if (SKIP_SIG) return true;
  if (!TWILIO_AUTH_TOKEN) return false;
  const sigHeader = req.headers.get('x-twilio-signature');
  if (!sigHeader) return false;
  const u = new URL(req.url);
  const url = `${SUPABASE_URL}/functions/v1${u.pathname.replace(/^\/functions\/v1/, '')}${u.search}`;
  const keys = [...new Set([...form.keys()])].sort();
  let data = url;
  for (const k of keys) data += k + (form.get(k) ?? '');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(TWILIO_AUTH_TOKEN),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  let b64 = '';
  for (const b of new Uint8Array(sig)) b64 += String.fromCharCode(b);
  return btoa(b64) === sigHeader;
}

/** Very light E.164 gate — digits with leading +, 8–16 chars. */
const isE164 = (s: string) => /^\+[1-9][0-9]{6,14}$/.test(s);

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  try {
    const raw = await req.text();
    const form = new URLSearchParams(raw);

    if (!(await validSignature(req, form))) {
      console.warn('[twilio-voice] rejected: bad or missing X-Twilio-Signature');
      return new Response('Forbidden', { status: 403 });
    }

    const to = (form.get('To') || '').trim();
    const callId = (form.get('callId') || '').trim();
    const callSid = form.get('CallSid') || '';

    if (!TWILIO_CALLER_ID) {
      return twiml('<Say>Dialer is not fully configured. Missing caller I D secret.</Say><Hangup/>');
    }
    if (!isE164(to)) {
      return twiml('<Say>Invalid destination number.</Say><Hangup/>');
    }

    // Link the Twilio parent (browser-leg) CallSid to our row so the
    // status / recording webhooks can find it.
    if (callId) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      await supabase.from('dialer_calls').update({
        provider_call_sid: callSid,
        caller_id: TWILIO_CALLER_ID,
        status: 'ringing',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by: 'twilio-voice',
      }).eq('id', callId);
    }

    const statusCb = `${SUPABASE_URL}/functions/v1/twilio-status`;
    const recordingCb = `${SUPABASE_URL}/functions/v1/twilio-recording`;

    return twiml(
      `<Dial callerId="${xmlEscape(TWILIO_CALLER_ID)}" answerOnBridge="true" ` +
      `record="record-from-answer-dual" ` +
      `recordingStatusCallback="${xmlEscape(recordingCb)}" ` +
      `recordingStatusCallbackEvent="completed">` +
      `<Number statusCallback="${xmlEscape(statusCb)}" ` +
      `statusCallbackEvent="initiated ringing answered completed">` +
      xmlEscape(to) +
      `</Number></Dial>`,
    );
  } catch (e) {
    console.error('[twilio-voice]', (e as Error).message || String(e));
    return twiml('<Say>An application error occurred.</Say><Hangup/>');
  }
});
