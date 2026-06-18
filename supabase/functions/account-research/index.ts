/**
 * Supabase Edge Function: account-research
 *
 * Refresh ZoomInfo data for an account.
 *
 * Request body: { accountId: string, accountName: string }
 * Response:
 *   { ok: true } — data was fetched and upserted into account_research
 *   { ok: false, message: string } — graceful failure (e.g. credentials
 *     not configured yet). The cached row already in account_research
 *     remains valid; the UI continues to render it.
 *
 * Required secrets (set via `supabase secrets set`):
 *   ZOOMINFO_USERNAME      — service account username
 *   ZOOMINFO_CLIENT_ID     — OAuth client id
 *   ZOOMINFO_PRIVATE_KEY   — RSA private key for ZI's JWT auth
 *
 * Until those are set, the function returns a friendly "not configured"
 * message and the UI shows whatever was last seeded into account_research
 * (manually or via Claude MCP tooling).
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global provided by edge runtime
const env = (name: string) => Deno.env.get(name);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization',
  'Content-Type': 'application/json',
};

// @ts-expect-error Deno.serve provided by edge runtime
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let body: { accountId?: string; accountName?: string } = {};
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders });
  }

  if (!body.accountId) {
    return new Response(JSON.stringify({ ok: false, error: 'accountId required' }), { status: 400, headers: corsHeaders });
  }

  const ziUser = env('ZOOMINFO_USERNAME');
  const ziClient = env('ZOOMINFO_CLIENT_ID');
  const ziKey = env('ZOOMINFO_PRIVATE_KEY');

  // No creds yet — return the cached data as-is, with a friendly hint.
  if (!ziUser || !ziClient || !ziKey) {
    return new Response(JSON.stringify({
      ok: false,
      message: 'ZoomInfo credentials not configured on the edge function. Ask Raghu to set ZOOMINFO_USERNAME, ZOOMINFO_CLIENT_ID, and ZOOMINFO_PRIVATE_KEY via Supabase Dashboard → Edge Functions → Secrets. Cached data is still shown.',
    }), { status: 200, headers: corsHeaders });
  }

  // TODO: when credentials are configured, implement the ZI auth + fetch
  // flow here. Use ZI's JWT-with-RSA OAuth, then call:
  //   POST /lookup/company — find company by name
  //   POST /enrich/company — pull profile
  //   POST /search/scoops  — pull scoops
  //   POST /search/news    — pull news
  //   POST /search/contact — pull C-suite contacts
  // Compose into the account_research row shape, upsert, return ok:true.
  return new Response(JSON.stringify({
    ok: false,
    message: 'ZoomInfo live-fetch implementation pending — credentials are set but the fetch code is a stub. Use Claude MCP to seed cached data for now.',
  }), { status: 200, headers: corsHeaders });
});
