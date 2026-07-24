/**
 * Supabase Edge Function: dialer-contact-search
 *
 * Unified contact lookup for the Dialer page. Fans out to:
 *   - Salesforce: SOSL across Contacts + Leads (name search), or SOQL
 *     LIKE on phone fields when the query looks like a number. Uses the
 *     same client-credentials flow as salesforce-sync-account.
 *   - ZoomInfo: PKI JWT auth → contact search → enrich top hits for
 *     phone numbers. Degrades gracefully when ZOOMINFO_* secrets are
 *     absent (same convention as account-research).
 *
 * Request:  POST { query: string, limit?: number, sources?: ('salesforce'|'zoominfo')[] }
 * Response: { ok, results: [{source, id, name, title, company, phone, mobile, email}],
 *             salesforce: {configured, error?}, zoominfo: {configured, error?} }
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);

const SF_CLIENT_ID = env('SF_CLIENT_ID');
const SF_CLIENT_SECRET = env('SF_CLIENT_SECRET');
const SF_INSTANCE_URL = (env('SF_INSTANCE_URL') || '').replace(/\/$/, '');
const ZOOMINFO_USERNAME = env('ZOOMINFO_USERNAME');
const ZOOMINFO_CLIENT_ID = env('ZOOMINFO_CLIENT_ID');
const ZOOMINFO_PRIVATE_KEY = env('ZOOMINFO_PRIVATE_KEY');

const ZI_API = 'https://api.zoominfo.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

export interface DialerContact {
  source: 'salesforce' | 'zoominfo';
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
}

/* ────────────────────────── Salesforce ────────────────────────── */

async function sfToken(): Promise<{ accessToken: string; instanceUrl: string }> {
  const res = await fetch(`${SF_INSTANCE_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: SF_CLIENT_ID!, client_secret: SF_CLIENT_SECRET! }),
  });
  if (!res.ok) throw new Error(`SF OAuth (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const j = await res.json() as { access_token: string; instance_url?: string };
  return { accessToken: j.access_token, instanceUrl: (j.instance_url || SF_INSTANCE_URL).replace(/\/$/, '') };
}

/** Escape SOSL reserved characters. */
const soslEscape = (s: string) => s.replace(/([?&|!{}[\]()^~*:\\"'+-])/g, '\\$1');
const looksLikePhone = (s: string) => s.replace(/[^0-9]/g, '').length >= 6 && /^[\s0-9()+.-]+$/.test(s);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sfRecordToContact(r: any, kind: 'Contact' | 'Lead'): DialerContact {
  return {
    source: 'salesforce',
    id: r.Id,
    name: r.Name || '',
    title: r.Title || null,
    company: kind === 'Contact' ? (r.Account?.Name || null) : (r.Company || null),
    phone: r.Phone || null,
    mobile: r.MobilePhone || null,
    email: r.Email || null,
  };
}

async function searchSalesforce(query: string, limit: number): Promise<DialerContact[]> {
  const { accessToken, instanceUrl } = await sfToken();
  const headers = { Authorization: `Bearer ${accessToken}` };
  const results: DialerContact[] = [];

  if (looksLikePhone(query)) {
    // Phone search: SOQL LIKE on the last 7+ digits to survive formatting differences.
    const digits = query.replace(/[^0-9]/g, '').slice(-7);
    const like = `'%${digits}%'`;
    const [contacts, leads] = await Promise.all([
      fetch(`${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(
        `SELECT Id, Name, Title, Phone, MobilePhone, Email, Account.Name FROM Contact WHERE Phone LIKE ${like} OR MobilePhone LIKE ${like} LIMIT ${limit}`,
      )}`, { headers }).then((r) => r.ok ? r.json() : { records: [] }),
      fetch(`${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(
        `SELECT Id, Name, Title, Phone, MobilePhone, Email, Company FROM Lead WHERE IsConverted = false AND (Phone LIKE ${like} OR MobilePhone LIKE ${like}) LIMIT ${limit}`,
      )}`, { headers }).then((r) => r.ok ? r.json() : { records: [] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ]) as any[];
    for (const r of contacts.records || []) results.push(sfRecordToContact(r, 'Contact'));
    for (const r of leads.records || []) results.push(sfRecordToContact(r, 'Lead'));
    return results.slice(0, limit);
  }

  const sosl =
    `FIND {${soslEscape(query)}*} IN NAME FIELDS RETURNING ` +
    `Contact(Id, Name, Title, Phone, MobilePhone, Email, Account.Name ORDER BY LastModifiedDate DESC LIMIT ${limit}), ` +
    `Lead(Id, Name, Title, Phone, MobilePhone, Email, Company WHERE IsConverted = false ORDER BY LastModifiedDate DESC LIMIT ${limit})`;
  const res = await fetch(`${instanceUrl}/services/data/v60.0/search?q=${encodeURIComponent(sosl)}`, { headers });
  if (!res.ok) throw new Error(`SOSL (${res.status}): ${(await res.text()).slice(0, 300)}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = await res.json() as { searchRecords?: any[] };
  for (const r of j.searchRecords || []) {
    const kind = r.attributes?.type === 'Lead' ? 'Lead' : 'Contact';
    results.push(sfRecordToContact(r, kind));
  }
  return results.slice(0, limit);
}

/* ────────────────────────── ZoomInfo ────────────────────────── */

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Import a PEM (PKCS#8) RSA private key for RS256 signing. */
async function importRsaKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END)[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8', raw.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
}

/** ZoomInfo PKI auth: self-signed RS256 JWT → POST /authenticate → access token (~60 min). */
async function ziAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    aud: 'enterprise_api',
    iss: 'api-client@zoominfo.com',
    username: ZOOMINFO_USERNAME,
    client_id: ZOOMINFO_CLIENT_ID,
    iat: now - 60,
    exp: now + 300,
  };
  const enc = new TextEncoder();
  const input = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(payload)))}`;
  const key = await importRsaKey(ZOOMINFO_PRIVATE_KEY!);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(input));
  const clientJwt = `${input}.${b64url(new Uint8Array(sig))}`;

  const res = await fetch(`${ZI_API}/authenticate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${clientJwt}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`ZI auth (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const j = await res.json() as { jwt?: string };
  if (!j.jwt) throw new Error('ZI auth returned no jwt');
  return j.jwt;
}

async function searchZoomInfo(query: string, limit: number): Promise<DialerContact[]> {
  const token = await ziAccessToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1. Search contacts by person name (also matches company via fallback below).
  const searchRes = await fetch(`${ZI_API}/search/contact`, {
    method: 'POST', headers,
    body: JSON.stringify({ personName: query, rpp: limit, page: 1 }),
  });
  if (!searchRes.ok) throw new Error(`ZI search (${searchRes.status}): ${(await searchRes.text()).slice(0, 300)}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchJson = await searchRes.json() as { data?: any[] };
  const hits = (searchJson.data || []).slice(0, limit);
  if (!hits.length) return [];

  // 2. Enrich for phone numbers (search results don't include them).
  const enrichRes = await fetch(`${ZI_API}/enrich/contact`, {
    method: 'POST', headers,
    body: JSON.stringify({
      matchPersonInput: hits.map((h) => ({ personId: h.id })),
      outputFields: ['id', 'firstName', 'lastName', 'jobTitle', 'companyName', 'phone', 'mobilePhone', 'email'],
    }),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let enriched: Record<string, any> = {};
  if (enrichRes.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ej = await enrichRes.json() as any;
    const results = ej?.data?.result || ej?.data || [];
    for (const r of Array.isArray(results) ? results : []) {
      const d = Array.isArray(r?.data) ? r.data[0] : r;
      if (d?.id != null) enriched[String(d.id)] = d;
    }
  } else {
    console.warn('[dialer-contact-search] ZI enrich failed:', enrichRes.status, (await enrichRes.text()).slice(0, 200));
  }

  return hits.map((h) => {
    const e = enriched[String(h.id)] || {};
    const name = [e.firstName ?? h.firstName, e.lastName ?? h.lastName].filter(Boolean).join(' ')
      || h.name || '';
    return {
      source: 'zoominfo' as const,
      id: String(h.id),
      name,
      title: e.jobTitle ?? h.jobTitle ?? null,
      company: e.companyName ?? h.company?.name ?? h.companyName ?? null,
      phone: e.phone ?? null,
      mobile: e.mobilePhone ?? null,
      email: e.email ?? null,
    };
  });
}

/* ────────────────────────── Handler ────────────────────────── */

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json() as { query?: string; limit?: number; sources?: string[] };
    const query = (body.query || '').trim();
    const limit = Math.min(Math.max(body.limit || 8, 1), 20);
    const sources = body.sources?.length ? body.sources : ['salesforce', 'zoominfo'];
    if (query.length < 2) {
      return new Response(JSON.stringify({ ok: false, error: 'query must be at least 2 characters' }), { status: 400, headers: corsHeaders });
    }

    const sfConfigured = !!(SF_CLIENT_ID && SF_CLIENT_SECRET && SF_INSTANCE_URL);
    const ziConfigured = !!(ZOOMINFO_USERNAME && ZOOMINFO_CLIENT_ID && ZOOMINFO_PRIVATE_KEY);

    const [sfRes, ziRes] = await Promise.allSettled([
      sources.includes('salesforce') && sfConfigured ? searchSalesforce(query, limit) : Promise.resolve([]),
      sources.includes('zoominfo') && ziConfigured ? searchZoomInfo(query, limit) : Promise.resolve([]),
    ]);

    const results: DialerContact[] = [
      ...(sfRes.status === 'fulfilled' ? sfRes.value : []),
      ...(ziRes.status === 'fulfilled' ? ziRes.value : []),
    ];

    return new Response(JSON.stringify({
      ok: true,
      results,
      salesforce: {
        configured: sfConfigured,
        error: sfRes.status === 'rejected' ? String((sfRes.reason as Error)?.message || sfRes.reason).slice(0, 300) : undefined,
      },
      zoominfo: {
        configured: ziConfigured,
        error: ziRes.status === 'rejected' ? String((ziRes.reason as Error)?.message || ziRes.reason).slice(0, 300) : undefined,
        ...(ziConfigured ? {} : { message: 'Set ZOOMINFO_USERNAME, ZOOMINFO_CLIENT_ID, ZOOMINFO_PRIVATE_KEY to enable ZoomInfo search.' }),
      },
    }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[dialer-contact-search]', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: corsHeaders });
  }
});
