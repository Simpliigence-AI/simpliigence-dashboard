/**
 * Supabase Edge Function: twilio-token
 *
 * Mints a Twilio Voice SDK access token so the Dialer page can register
 * a browser softphone. The token is a Twilio-flavored JWT (cty
 * "twilio-fpa;v=1") signed HS256 with a Twilio API key secret — we build
 * it by hand so we don't need the Node-only twilio package in Deno.
 *
 * Required secrets:
 *   TWILIO_ACCOUNT_SID     — ACxxxx
 *   TWILIO_API_KEY_SID     — SKxxxx (Console → Account → API keys)
 *   TWILIO_API_KEY_SECRET  — secret shown once when the API key is created
 *   TWILIO_TWIML_APP_SID   — APxxxx (TwiML app whose Voice URL points at twilio-voice)
 *
 * Request:  POST (authenticated dashboard user; verify_jwt stays ON)
 * Response: { ok: true, token, identity, ttlSec } | { ok: false, error }
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_ACCOUNT_SID = env('TWILIO_ACCOUNT_SID');
const TWILIO_API_KEY_SID = env('TWILIO_API_KEY_SID');
const TWILIO_API_KEY_SECRET = env('TWILIO_API_KEY_SECRET');
const TWILIO_TWIML_APP_SID = env('TWILIO_TWIML_APP_SID');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY')!;

const TTL_SEC = 3600;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const encodeJson = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function signHs256(input: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  return b64url(new Uint8Array(sig));
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_API_KEY_SID || !TWILIO_API_KEY_SECRET || !TWILIO_TWIML_APP_SID) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Twilio dialer secrets not configured. Set TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID (see DIALER_SETUP.md).',
        haveAccountSid: !!TWILIO_ACCOUNT_SID,
        haveApiKeySid: !!TWILIO_API_KEY_SID,
        haveApiKeySecret: !!TWILIO_API_KEY_SECRET,
        haveTwimlAppSid: !!TWILIO_TWIML_APP_SID,
      }), { status: 200, headers: corsHeaders });
    }

    // Identify the dashboard user from their Supabase JWT so calls are
    // attributable per-person in Twilio logs.
    const authHeader = req.headers.get('authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: userData } = await supabase.auth.getUser(jwt);
    const email = userData?.user?.email || 'unknown';
    // Twilio identities must be URL-safe; keep it readable but strict.
    const identity = email.toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 121) || 'dialer_user';

    const iat = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' };
    const payload = {
      jti: `${TWILIO_API_KEY_SID}-${iat}`,
      iss: TWILIO_API_KEY_SID,
      sub: TWILIO_ACCOUNT_SID,
      iat,
      exp: iat + TTL_SEC,
      grants: {
        identity,
        voice: {
          outgoing: { application_sid: TWILIO_TWIML_APP_SID },
          incoming: { allow: false },
        },
      },
    };
    const signingInput = `${encodeJson(header)}.${encodeJson(payload)}`;
    const signature = await signHs256(signingInput, TWILIO_API_KEY_SECRET);
    const token = `${signingInput}.${signature}`;

    return new Response(JSON.stringify({ ok: true, token, identity, ttlSec: TTL_SEC }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[twilio-token]', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: corsHeaders });
  }
});
