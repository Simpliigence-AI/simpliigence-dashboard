/**
 * Supabase Edge Function: twilio-ping
 *
 * One-time smoke test for the dialer's Twilio setup (mirrors
 * salesforce-ping). Reports which TWILIO_* secrets are present, whether
 * the account credentials authenticate, which incoming phone numbers are
 * available as caller IDs, and whether the TwiML app exists and points
 * at the twilio-voice function.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);

const TWILIO_ACCOUNT_SID = env('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = env('TWILIO_AUTH_TOKEN');
const TWILIO_API_KEY_SID = env('TWILIO_API_KEY_SID');
const TWILIO_API_KEY_SECRET = env('TWILIO_API_KEY_SECRET');
const TWILIO_TWIML_APP_SID = env('TWILIO_TWIML_APP_SID');
const TWILIO_CALLER_ID = env('TWILIO_CALLER_ID');
const SUPABASE_URL = env('SUPABASE_URL')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const API = 'https://api.twilio.com/2010-04-01';

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const report: Record<string, unknown> = {
    secrets: {
      TWILIO_ACCOUNT_SID: !!TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: !!TWILIO_AUTH_TOKEN,
      TWILIO_API_KEY_SID: !!TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET: !!TWILIO_API_KEY_SECRET,
      TWILIO_TWIML_APP_SID: !!TWILIO_TWIML_APP_SID,
      TWILIO_CALLER_ID: TWILIO_CALLER_ID || null,
    },
    expectedVoiceUrl: `${SUPABASE_URL}/functions/v1/twilio-voice`,
  };

  try {
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — see DIALER_SETUP.md',
        ...report,
      }), { headers: corsHeaders });
    }

    const auth = { Authorization: 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`) };

    // 1. Account authenticates?
    const acctRes = await fetch(`${API}/Accounts/${TWILIO_ACCOUNT_SID}.json`, { headers: auth });
    if (!acctRes.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: `Twilio auth failed (${acctRes.status}): ${(await acctRes.text()).slice(0, 300)}`,
        ...report,
      }), { headers: corsHeaders });
    }
    const acct = await acctRes.json() as { friendly_name?: string; status?: string };
    report.account = { friendlyName: acct.friendly_name, status: acct.status };

    // 2. Available caller-ID candidates (numbers owned by this account).
    const numsRes = await fetch(`${API}/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PageSize=20`, { headers: auth });
    if (numsRes.ok) {
      const nums = await numsRes.json() as { incoming_phone_numbers?: Array<{ phone_number: string; friendly_name: string; capabilities?: { voice?: boolean } }> };
      report.phoneNumbers = (nums.incoming_phone_numbers || []).map((n) => ({
        phoneNumber: n.phone_number,
        friendlyName: n.friendly_name,
        voice: n.capabilities?.voice ?? null,
      }));
    }

    // 3. TwiML app sanity.
    if (TWILIO_TWIML_APP_SID) {
      const appRes = await fetch(`${API}/Accounts/${TWILIO_ACCOUNT_SID}/Applications/${TWILIO_TWIML_APP_SID}.json`, { headers: auth });
      if (appRes.ok) {
        const app = await appRes.json() as { friendly_name?: string; voice_url?: string; voice_method?: string };
        report.twimlApp = {
          friendlyName: app.friendly_name,
          voiceUrl: app.voice_url,
          voiceMethod: app.voice_method,
          voiceUrlMatches: app.voice_url === report.expectedVoiceUrl,
        };
      } else {
        report.twimlApp = { error: `fetch failed (${appRes.status})` };
      }
    }

    // 4. Account type (trial accounts can't dial unverified numbers).
    report.accountType = (acct as { type?: string }).type ?? null;

    // 4b. CRITICAL: validate the API Key SID+Secret pair. The Voice access
    // token is HMAC-signed with the API Key Secret; if it's wrong the token
    // is rejected by Twilio signaling with error 53000 even though the
    // account auth above (SID+AuthToken) succeeds. An API key can basic-auth
    // to REST, so this directly tests whether the stored secret is correct.
    if (TWILIO_API_KEY_SID && TWILIO_API_KEY_SECRET) {
      const keyAuth = 'Basic ' + btoa(`${TWILIO_API_KEY_SID}:${TWILIO_API_KEY_SECRET}`);
      const keyRes = await fetch(`${API}/Accounts/${TWILIO_ACCOUNT_SID}.json`, { headers: { Authorization: keyAuth } });
      report.apiKeyValid = keyRes.ok;
      if (!keyRes.ok) {
        report.apiKeyError = `API Key SID+Secret rejected (${keyRes.status}). Either the secret doesn't match the SID, or the SID isn't on this account.`;
      }
      // List the account's API keys (SIDs only, no secrets) so we can tell
      // whether the configured SID actually exists here.
      const keysList = await fetch(`${API}/Accounts/${TWILIO_ACCOUNT_SID}/Keys.json?PageSize=50`, { headers: auth });
      if (keysList.ok) {
        const kl = await keysList.json() as { keys?: Array<{ sid: string; friendly_name: string }> };
        const sids = (kl.keys || []).map((k) => ({ sid: k.sid, name: k.friendly_name }));
        report.accountApiKeys = sids;
        report.configuredKeySidExists = sids.some((k) => k.sid === TWILIO_API_KEY_SID);
        report.configuredKeySidTail = TWILIO_API_KEY_SID.slice(-6);
      }
    }

    // 5. Recent calls (last few) — helps see if Twilio even created a call.
    const callsRes = await fetch(`${API}/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json?PageSize=5`, { headers: auth });
    if (callsRes.ok) {
      const cj = await callsRes.json() as { calls?: Array<{ sid: string; to: string; from: string; status: string; direction: string; start_time: string }> };
      report.recentCalls = (cj.calls || []).map((c) => ({ sid: c.sid, to: c.to, from: c.from, status: c.status, direction: c.direction, startTime: c.start_time }));
    }

    // 6. Recent Monitor alerts (errors/warnings) — the real reason a client call died.
    const alertsRes = await fetch(`https://monitor.twilio.com/v1/Alerts?PageSize=5`, { headers: auth });
    if (alertsRes.ok) {
      const aj = await alertsRes.json() as { alerts?: Array<{ error_code: string; log_level: string; alert_text: string; date_generated: string; more_info?: string }> };
      report.recentAlerts = (aj.alerts || []).map((a) => ({
        errorCode: a.error_code, level: a.log_level,
        text: (a.alert_text || '').slice(0, 300), date: a.date_generated, moreInfo: a.more_info,
      }));
    } else {
      report.recentAlerts = `alerts fetch failed (${alertsRes.status})`;
    }

    const missing = Object.entries(report.secrets as Record<string, unknown>)
      .filter(([, v]) => !v).map(([k]) => k);
    return new Response(JSON.stringify({ ok: missing.length === 0, missing, ...report }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message || String(e), ...report }), { status: 500, headers: corsHeaders });
  }
});
