/**
 * Supabase Edge Function: zoho-people-sync
 *
 * Called by the dashboard's "Sync from Zoho People" button on the Actual
 * Hours page. Proxies Zoho People Timetracker so the client never sees the
 * OAuth refresh token or Zoho credentials.
 *
 * Required secrets (set with `supabase secrets set ...`):
 *   ZOHO_CLIENT_ID              — OAuth app client id (shared with zoho-projects-sync)
 *   ZOHO_CLIENT_SECRET          — OAuth app client secret (shared)
 *   ZOHO_PEOPLE_REFRESH_TOKEN   — self-client refresh token with
 *                                 ZohoPeople.timetracker.READ +
 *                                 ZohoPeople.attendance.READ +
 *                                 ZohoPeople.employee.READ
 *
 * Optional:
 *   ZOHO_DC   — data centre suffix ("in", "com", "eu", "au"). Default: "in".
 *
 * Response shape (success):
 *   { entries: ActualHourEntry[], syncedAt: string, counts: { fetched, kept } }
 *
 * Response shape (error): { error: string, detail?: string } with HTTP 4xx/5xx.
 *
 * Fetches year-to-date timesheet records (Jan 1 of current year → today),
 * paginating in batches of 200 until Zoho returns an empty page.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global is provided by the edge runtime
const env = (name: string) => Deno.env.get(name);

const ZOHO_DC = env('ZOHO_DC') || 'in';
const ZOHO_CLIENT_ID = env('ZOHO_CLIENT_ID');
const ZOHO_CLIENT_SECRET = env('ZOHO_CLIENT_SECRET');
const ZOHO_PEOPLE_REFRESH_TOKEN = env('ZOHO_PEOPLE_REFRESH_TOKEN');

const ACCOUNTS_BASE = `https://accounts.zoho.${ZOHO_DC}`;
const PEOPLE_BASE = `https://people.zoho.${ZOHO_DC}/people/api`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const PAGE_SIZE = 200;
const MAX_PAGES = 200; // hard cap (200 × 200 = 40k rows; YTD for ~100 ppl shouldn't approach this)

// ── Types describing what we use from Zoho People's response ──
interface ZohoPeopleTimeLogRow {
  // Real Zoho People Timetracker fields (gettimelogs endpoint):
  timelogId?: string;        // unique per timelog
  erecno?: string;           // employee record number
  employeeFirstName?: string;
  employeeLastName?: string;
  employeeMailId?: string;
  jobName?: string;          // the project/job they're billing time against
  projectName?: string;      // parent container ("Simpliigence - General" etc.)
  jobId?: string;
  projectId?: string;
  workDate?: string;
  hours?: string | number;       // "HH:MM" string
  hoursInMins?: number;          // canonical numeric — preferred
  billingStatus?: string;
  billedStatus?: string;
  approvalStatus?: string;
  description?: string;
  taskName?: string;
  // Legacy aliases other tenants have used — kept defensively:
  // (recordId / RecordID / employeeId / EmployeeID / etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

interface NormalisedEntry {
  id: string;
  employee_id: string;
  employee_name: string;
  email: string | null;
  project: string | null;
  work_date: string; // YYYY-MM-DD
  hours: number;
  billing: string | null;
  notes: string | null;
}

// ── Zoho OAuth ──
async function getAccessToken(): Promise<string> {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_PEOPLE_REFRESH_TOKEN) {
    throw new Error('Missing Zoho People OAuth secrets (ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_PEOPLE_REFRESH_TOKEN)');
  }
  const params = new URLSearchParams({
    refresh_token: ZOHO_PEOPLE_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoho OAuth failed (${res.status}): ${text}`);
  }
  const data = await res.json() as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(`Zoho OAuth returned no access_token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function zohoPeopleGet<T>(accessToken: string, path: string): Promise<T> {
  const url = `${PEOPLE_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zoho People GET ${path} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return await res.json() as T;
}

// ── Row normalisation (handles Zoho's field-name drift across tenants) ──
function pickStr(row: ZohoPeopleTimeLogRow, ...keys: (keyof ZohoPeopleTimeLogRow)[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function pickNum(row: ZohoPeopleTimeLogRow, ...keys: (keyof ZohoPeopleTimeLogRow)[]): number {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') {
      const n = typeof v === 'number' ? v : parseFloat(String(v));
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

/** Zoho returns minutes as the canonical numeric, plus an "HH:MM" string.
 *  Prefer the numeric; fall back to parsing the string. */
function parseHours(raw: ZohoPeopleTimeLogRow): number {
  const mins = pickNum(raw, 'hoursInMins');
  if (mins > 0) return Math.round((mins / 60) * 100) / 100;
  const s = pickStr(raw, 'hours');
  if (s.includes(':')) {
    const [h, m] = s.split(':');
    const hi = parseInt(h, 10) || 0;
    const mi = parseInt(m, 10) || 0;
    return Math.round((hi + mi / 60) * 100) / 100;
  }
  const n = pickNum(raw, 'hours');
  return n;
}

function normaliseRow(row: ZohoPeopleTimeLogRow, fallbackIdx: number): NormalisedEntry | null {
  const id = pickStr(row, 'timelogId', 'recordId', 'RecordID') || `row-${fallbackIdx}`;
  const employee_id = pickStr(row, 'erecno', 'employeeId', 'EmployeeID') || 'unknown';
  const first = pickStr(row, 'employeeFirstName');
  const last = pickStr(row, 'employeeLastName');
  const employee_name = [first, last].filter(Boolean).join(' ').trim()
    || pickStr(row, 'employeeName', 'EmployeeName', 'Employee')
    || '(unnamed)';
  const work_date = pickStr(row, 'workDate', 'WorkDate', 'Date', 'fromDate');
  const hours = parseHours(row);
  if (!work_date || hours <= 0) return null;
  return {
    id,
    employee_id,
    employee_name,
    email: pickStr(row, 'employeeMailId', 'mailId', 'email', 'EmailID') || null,
    // Prefer jobName (the granular billable job) over projectName (which is
    // often a generic parent like "Simpliigence - General").
    project: pickStr(row, 'jobName', 'projectName', 'Job', 'Project') || null,
    work_date,
    hours,
    billing: pickStr(row, 'billingStatus', 'billedStatus', 'BillingStatus') || null,
    notes: pickStr(row, 'description', 'Description', 'taskName', 'workItem') || null,
  };
}

/** YTD broken into per-month chunks because Zoho People enforces
 *  "maximum of one month's data can be fetched at a time". */
function ytdMonthChunks(): Array<{ from: string; to: string }> {
  const now = new Date();
  const year = now.getUTCFullYear();
  const todayStr = now.toISOString().slice(0, 10);
  const chunks: Array<{ from: string; to: string }> = [];
  for (let m = 0; m <= now.getUTCMonth(); m++) {
    const first = new Date(Date.UTC(year, m, 1));
    const lastDay = new Date(Date.UTC(year, m + 1, 0)).getUTCDate();
    const last = new Date(Date.UTC(year, m, lastDay));
    const from = first.toISOString().slice(0, 10);
    let to = last.toISOString().slice(0, 10);
    // For the current month, cap at today.
    if (to > todayStr) to = todayStr;
    chunks.push({ from, to });
  }
  return chunks;
}

// ── Main handler ──
// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const accessToken = await getAccessToken();
    const chunks = ytdMonthChunks();
    const overallFrom = chunks[0]?.from;
    const overallTo = chunks[chunks.length - 1]?.to;

    const all: NormalisedEntry[] = [];
    const seen = new Set<string>();
    let fetched = 0;
    let kept = 0;

    for (const { from, to } of chunks) {
      for (let page = 0; page < MAX_PAGES; page++) {
        const sIndex = page * PAGE_SIZE + 1;
        // Endpoint is `gettimelogs` (plural). Zoho People rejects `gettimelog`.
        const path =
          `/timetracker/gettimelogs?dateFormat=yyyy-MM-dd&fromDate=${from}&toDate=${to}` +
          `&user=ALL&sIndex=${sIndex}&limit=${PAGE_SIZE}`;
        const raw = await zohoPeopleGet<unknown>(accessToken, path);
        // Zoho People responses vary across plans: sometimes a bare array,
        // sometimes {response: {result: [...]}}, sometimes {timelogs: [...]},
        // sometimes {response: {result: {<id>: {...row}, ...}}}.
        let rows: ZohoPeopleTimeLogRow[] = [];
        if (Array.isArray(raw)) {
          rows = raw as ZohoPeopleTimeLogRow[];
        } else if (raw && typeof raw === 'object') {
          const obj = raw as Record<string, unknown>;
          const cand =
            (obj.response as Record<string, unknown> | undefined)?.result ??
            obj.timelogs ??
            obj.records ??
            obj.result;
          if (Array.isArray(cand)) {
            rows = cand as ZohoPeopleTimeLogRow[];
          } else if (cand && typeof cand === 'object') {
            rows = Object.values(cand as Record<string, ZohoPeopleTimeLogRow>);
          }
        }
        if (rows.length === 0) break;
        fetched += rows.length;
        for (let i = 0; i < rows.length; i++) {
          const e = normaliseRow(rows[i], fetched + i);
          if (!e) continue;
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          all.push(e);
          kept++;
        }
        if (rows.length < PAGE_SIZE) break;
      }
    }

    const body = {
      entries: all,
      syncedAt: new Date().toISOString(),
      range: { from: overallFrom, to: overallTo },
      counts: { fetched, kept },
    };
    console.log(`[zoho-people-sync] fetched ${fetched} rows, kept ${kept} across ${chunks.length} months (${overallFrom}..${overallTo})`);
    return new Response(JSON.stringify(body), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[zoho-people-sync]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
