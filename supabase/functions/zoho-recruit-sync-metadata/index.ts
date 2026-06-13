/**
 * Supabase Edge Function: zoho-recruit-sync-metadata
 *
 * Imports candidate metadata from Zoho Recruit into india_staffing_candidates.
 * One invocation processes up to PAGE_BATCH pages × 200 candidates each, then
 * returns nextPage so the client can keep calling until done. Each candidate
 * is keyed by zoho_candidate_id; re-runs upsert (no duplicates).
 *
 *   1. Fetch OAuth access token from refresh token
 *   2. GET /recruit/v2/Candidates?page=N&per_page=200&sort_by=Modified_Time
 *   3. Map Zoho fields → india_staffing_candidates schema
 *   4. UPSERT in chunks of 100
 *
 * Required secrets:
 *   ZOHO_CLIENT_ID                — OAuth app client id (shared w/ other Zoho fns)
 *   ZOHO_CLIENT_SECRET            — OAuth app client secret (shared)
 *   ZOHO_RECRUIT_REFRESH_TOKEN    — self-client refresh token. Scopes (Zoho
 *                                   Recruit uses SINGULAR module names):
 *                                     ZohoRecruit.modules.candidate.READ
 *                                     ZohoRecruit.modules.attachment.READ
 *                                   Or simpler: ZohoRecruit.modules.ALL
 *
 * Optional:
 *   ZOHO_DC                       — data centre suffix ("in"/"com"/"eu"). Default "in".
 *
 * Request body:
 *   { page?: number, pages?: number, modifiedSince?: string (ISO) }
 *   - page          : 1-based start page (default 1)
 *   - pages         : how many pages to process this call (default 5 = 1000 candidates)
 *   - modifiedSince : only fetch records modified after this timestamp (for
 *                     incremental syncs). Default: full sync.
 *
 * Response:
 *   { ok, upserted, totalSeen, nextPage|null, done, errors[] }
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @ts-expect-error esm.sh
import { nanoid } from 'https://esm.sh/nanoid@5';

const ZOHO_DC = env('ZOHO_DC') || 'in';
const ZOHO_CLIENT_ID = env('ZOHO_CLIENT_ID');
const ZOHO_CLIENT_SECRET = env('ZOHO_CLIENT_SECRET');
const ZOHO_RECRUIT_REFRESH_TOKEN = env('ZOHO_RECRUIT_REFRESH_TOKEN');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;

const ACCOUNTS_BASE = `https://accounts.zoho.${ZOHO_DC}`;
const RECRUIT_BASE  = `https://recruit.zoho.${ZOHO_DC}/recruit/v2`;

const PAGE_SIZE = 200;
const DEFAULT_PAGES_PER_INVOCATION = 5;  // ~1000 candidates / call
const MAX_PAGES_PER_INVOCATION = 13;     // ~2600 — fits within edge-fn time budget

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

async function getAccessToken(): Promise<string> {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_RECRUIT_REFRESH_TOKEN) {
    throw new Error('Missing Zoho Recruit OAuth secrets (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_RECRUIT_REFRESH_TOKEN)');
  }
  const params = new URLSearchParams({
    refresh_token: ZOHO_RECRUIT_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Zoho OAuth failed (${res.status}): ${await res.text()}`);
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`Zoho OAuth returned no access_token: ${JSON.stringify(data)}`);
  return data.access_token;
}

/** Best-effort city + region + country from Zoho's separate fields. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function composeLocation(r: any): string | null {
  const parts = [r.City, r.State, r.Country]
    .map((v: unknown) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Map Zoho's free-form stage labels to our CANDIDATE_STAGES union. */
function mapStage(zohoStage: string | null | undefined): string {
  const s = (zohoStage || '').toLowerCase().trim();
  if (!s) return 'Submitted';
  if (s.includes('joined')) return 'Joined';
  if (s.includes('offer accepted')) return 'Offer Accepted';
  if (s.includes('offer extended') || s.includes('offered')) return 'Offer Extended';
  if (s.includes('selected') || s.includes('hired')) return 'Selected';
  if (s.includes('client') || s.includes('round')) return 'Client Round';
  if (s.includes('shortlist')) return 'Shortlisted';
  if (s.includes('interview')) return s.includes('schedul') ? 'Interview Scheduled' : 'Interviewed';
  if (s.includes('screen')) return 'Screening';
  if (s.includes('reject')) return 'Rejected';
  if (s.includes('drop')) return 'Dropped Out';
  if (s.includes('hold')) return 'On Hold';
  return 'Submitted';
}

/** Coerce a Zoho-typed value to plain string. */
function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // Zoho lookup fields come as { id, name } — prefer name
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof v === 'object' && (v as any).name) return String((v as any).name).trim();
  return '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCandidate(r: any) {
  const first = str(r.First_Name);
  const last = str(r.Last_Name);
  const fullName = [first, last].filter(Boolean).join(' ').trim()
    || str(r.Full_Name)
    || '(unnamed)';
  const linkedin = str(r.LinkedIn) || str(r.LinkedIn_URL) || '';
  return {
    zoho_candidate_id: String(r.id),
    name: fullName,
    email: str(r.Email).toLowerCase(),
    phone: str(r.Mobile) || str(r.Phone),
    linkedin_url: linkedin || null,
    location: composeLocation(r),
    experience: str(r.Current_Job_Title) || str(r.Title),
    source: str(r.Source) || 'Zoho Recruit',
    stage: mapStage(str(r.Candidate_Stage) || str(r.Candidate_Status)),
    submit_date: (str(r.Date_of_Submission) || str(r.Created_Time) || new Date().toISOString()).slice(0, 10),
    feedback: '',
  };
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const startPage  = Math.max(1, Number(body.page) || 1);
    const pagesThisCall = Math.min(MAX_PAGES_PER_INVOCATION, Math.max(1, Number(body.pages) || DEFAULT_PAGES_PER_INVOCATION));
    const modifiedSince = typeof body.modifiedSince === 'string' ? body.modifiedSince : null;

    const accessToken = await getAccessToken();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let totalSeen = 0;
    let upserted = 0;
    const errors: string[] = [];
    let hitEnd = false;

    for (let i = 0; i < pagesThisCall; i++) {
      const page = startPage + i;
      const qs = new URLSearchParams({
        page: String(page),
        per_page: String(PAGE_SIZE),
        sort_by: 'Modified_Time',
        sort_order: 'desc',
      });
      const headers: Record<string, string> = { Authorization: `Zoho-oauthtoken ${accessToken}` };
      if (modifiedSince) headers['If-Modified-Since'] = modifiedSince;

      const zres = await fetch(`${RECRUIT_BASE}/Candidates?${qs.toString()}`, { headers });
      // 204 = no records this page (or no changes since `If-Modified-Since`).
      if (zres.status === 204) { hitEnd = true; break; }
      if (!zres.ok) {
        errors.push(`Page ${page}: Zoho ${zres.status} ${(await zres.text()).slice(0, 200)}`);
        hitEnd = true;
        break;
      }
      const pageData = await zres.json() as { data?: unknown[]; info?: { more_records?: boolean } };
      const rows = Array.isArray(pageData.data) ? pageData.data : [];
      if (rows.length === 0) { hitEnd = true; break; }
      totalSeen += rows.length;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mapped = rows.map((r) => mapCandidate(r as any));

      // Existing-row lookup: keeps original id + created_at for updates so
      // the audit trigger sees only the columns we actually changed.
      const zohoIds = mapped.map((m) => m.zoho_candidate_id);
      const { data: existing } = await supabase
        .from('india_staffing_candidates')
        .select('id, zoho_candidate_id, created_at')
        .in('zoho_candidate_id', zohoIds);
      const existingMap = new Map<string, { id: string; created_at: string }>(
        (existing || []).map((e: { id: string; zoho_candidate_id: string; created_at: string }) =>
          [e.zoho_candidate_id, { id: e.id, created_at: e.created_at }]
        ),
      );

      const now = new Date().toISOString();
      const rowsForUpsert = mapped.map((m) => {
        const existingRow = existingMap.get(m.zoho_candidate_id);
        return {
          id: existingRow?.id || nanoid(),
          requisition_id: '',
          experience: m.experience,
          stage: m.stage,
          submit_date: m.submit_date,
          feedback: m.feedback,
          source: m.source,
          email: m.email,
          phone: m.phone,
          name: m.name,
          location: m.location,
          linkedin_url: m.linkedin_url,
          zoho_candidate_id: m.zoho_candidate_id,
          created_at: existingRow?.created_at || now,
          updated_at: now,
          updated_by: 'zoho-recruit-sync',
        };
      });

      // Chunk size 25 — keeps each upsert + its 25 audit-trigger writes
      // comfortably under Postgres' statement_timeout.
      for (let j = 0; j < rowsForUpsert.length; j += 25) {
        const chunk = rowsForUpsert.slice(j, j + 25);
        const { error } = await supabase
          .from('india_staffing_candidates')
          .upsert(chunk, { onConflict: 'zoho_candidate_id' });
        if (error) {
          errors.push(`Page ${page} chunk ${j}: ${error.message}`);
        } else {
          upserted += chunk.length;
        }
      }

      // Last page returned fewer than PAGE_SIZE — we've reached the end.
      if (rows.length < PAGE_SIZE || pageData.info?.more_records === false) {
        hitEnd = true;
        break;
      }
    }

    const nextPage = hitEnd ? null : startPage + pagesThisCall;
    return new Response(JSON.stringify({
      ok: true,
      upserted,
      totalSeen,
      nextPage,
      done: hitEnd,
      errors,
    }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[zoho-recruit-sync-metadata]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
