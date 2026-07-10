/**
 * Supabase Edge Function: salesforce-ping
 *
 * One-time smoke test. Tries Salesforce Client Credentials OAuth flow
 * using the SF_CLIENT_ID + SF_CLIENT_SECRET + SF_INSTANCE_URL secrets.
 * Returns whether auth works, what user identity we authenticated as,
 * and a sample count of Accounts we can see.
 *
 * If Client Credentials fails with e.g. "unsupported_grant_type", the
 * org needs the External Client App's Client Credentials Flow enabled,
 * OR we fall back to a refresh-token flow (separate edge function).
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);

const SF_CLIENT_ID = env('SF_CLIENT_ID');
const SF_CLIENT_SECRET = env('SF_CLIENT_SECRET');
const SF_INSTANCE_URL = (env('SF_INSTANCE_URL') || '').replace(/\/$/, '');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const report: Record<string, unknown> = { steps: [] as unknown[] };
  const step = (name: string, detail: unknown) => (report.steps as unknown[]).push({ [name]: detail });

  try {
    if (!SF_CLIENT_ID || !SF_CLIENT_SECRET || !SF_INSTANCE_URL) {
      return new Response(JSON.stringify({
        ok: false,
        error: 'Missing one of SF_CLIENT_ID / SF_CLIENT_SECRET / SF_INSTANCE_URL secrets',
        haveClientId: !!SF_CLIENT_ID,
        haveClientSecret: !!SF_CLIENT_SECRET,
        haveInstanceUrl: !!SF_INSTANCE_URL,
      }), { status: 500, headers: corsHeaders });
    }
    step('instance', SF_INSTANCE_URL);

    // 1. Client Credentials OAuth token
    const tokenRes = await fetch(`${SF_INSTANCE_URL}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: SF_CLIENT_ID,
        client_secret: SF_CLIENT_SECRET,
      }),
    });
    const tokenBody = await tokenRes.text();
    step('token_status', tokenRes.status);
    step('token_body', tokenBody.slice(0, 800));
    if (!tokenRes.ok) {
      return new Response(JSON.stringify({
        ok: false,
        error: `Client Credentials flow failed (${tokenRes.status})`,
        detail: tokenBody.slice(0, 500),
        hint: tokenBody.includes('unsupported_grant_type')
          ? 'In the External Client App → Policies, enable "Client Credentials Flow" and pick a Run As user.'
          : tokenBody.includes('invalid_client_id')
          ? 'SF_CLIENT_ID does not match a Connected App / External Client App on this org.'
          : undefined,
        report,
      }), { status: 502, headers: corsHeaders });
    }
    const tokenJson = JSON.parse(tokenBody) as { access_token: string; instance_url?: string };
    const accessToken = tokenJson.access_token;
    const instanceUrl = (tokenJson.instance_url || SF_INSTANCE_URL).replace(/\/$/, '');

    // 2. Identity check
    const idRes = await fetch(`${instanceUrl}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const idJson = idRes.ok ? await idRes.json() : { error: await idRes.text() };
    step('userinfo_status', idRes.status);

    // 3. Try a small SOQL query
    const soql = 'SELECT Id, Name, AnnualRevenue, Industry FROM Account ORDER BY LastModifiedDate DESC LIMIT 5';
    const queryRes = await fetch(`${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(soql)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const queryBody = await queryRes.text();
    step('query_status', queryRes.status);

    return new Response(JSON.stringify({
      ok: queryRes.ok,
      identity: idJson,
      instanceUrl,
      sampleAccounts: queryRes.ok ? JSON.parse(queryBody) : queryBody.slice(0, 500),
      report,
    }, null, 2), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({
      ok: false,
      error: (e as Error).message,
      report,
    }), { status: 500, headers: corsHeaders });
  }
});
