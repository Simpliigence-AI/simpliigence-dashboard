/**
 * Supabase Edge Function: restore-time-entries
 *
 * Recovery tool for the /my-time silent-delete incident and any future
 * accidental-deletion scenario. Compares the live `time_entries` table
 * against a specific day's snapshot in the `db-backups` bucket and either
 * reports what's missing (`mode: 'diff'`) or inserts the missing rows
 * back (`mode: 'restore'`).
 *
 * Non-destructive by design:
 *   - Never UPDATES an existing row (so any legitimate edits since the
 *     backup are preserved).
 *   - Never DELETES.
 *   - Only INSERTS rows whose id is present in the backup but missing
 *     from the live table.
 *
 * Idempotent: running twice is a no-op after the first restore.
 *
 * Request body:
 *   {
 *     mode: 'diff' | 'restore',
 *     date: 'YYYY-MM-DD',        // which daily backup to compare against
 *     employeeEmail?: string,    // optional — scope the diff/restore to one user
 *   }
 *
 * Response:
 *   {
 *     ok: true,
 *     mode,
 *     backupFile,
 *     inBackup: number,          // total rows in backup for scope
 *     inLive: number,            // total rows live for scope
 *     missing: number,           // rows in backup not in live (candidates for restore)
 *     restored?: number,         // only present when mode='restore'
 *     sample: Array<{ id, employeeEmail, workDate, projectName, hours, status, source }>,
 *   }
 *
 * Auth: uses the same X-Backup-Cron-Secret header as daily-backup, so only
 * ops with the secret can hit this. Admin UI can wrap it with a user-JWT
 * flow later, but for the immediate incident this is the fastest safe path.
 */

/// <reference lib="deno.ns" />

// @ts-expect-error Deno global provided by edge runtime
const env = (name: string) => Deno.env.get(name);
// @ts-expect-error esm.sh resolves at runtime in Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const BACKUP_CRON_SECRET = env('BACKUP_CRON_SECRET');
const BUCKET = 'db-backups';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-backup-cron-secret, authorization',
  'Content-Type': 'application/json',
};

interface Body {
  mode?: 'diff' | 'restore';
  date?: string;
  employeeEmail?: string;
}

// @ts-expect-error Deno.serve
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Auth: allow either the cron secret or a service-role JWT (via
  // Authorization header). The former is what curl callers use; the
  // latter what an admin UI would use via supabase.functions.invoke.
  const cronSecret = req.headers.get('x-backup-cron-secret');
  if (BACKUP_CRON_SECRET && cronSecret !== BACKUP_CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: corsHeaders });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), { status: 400, headers: corsHeaders });
  }
  const mode = body.mode === 'restore' ? 'restore' : 'diff';
  const dateStr = (body.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return new Response(JSON.stringify({ error: 'date must be YYYY-MM-DD' }), { status: 400, headers: corsHeaders });
  }
  const employeeScope = body.employeeEmail?.trim().toLowerCase() || null;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Find that day's backup file. Filename shape is
  //    'simpliigence-backup-YYYY-MM-DD-HH-MM-SS.json'. Grab the latest.
  const { data: files, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list('', { limit: 100, search: `simpliigence-backup-${dateStr}` });
  if (listErr) {
    return new Response(JSON.stringify({ error: 'list backups failed', detail: listErr.message }), { status: 500, headers: corsHeaders });
  }
  if (!files || files.length === 0) {
    return new Response(JSON.stringify({ error: `no backup file for ${dateStr}`, hint: 'daily-backup runs at 02:30 UTC; try the next day' }), { status: 404, headers: corsHeaders });
  }
  const backupFile = files.sort((a, b) => (b.name).localeCompare(a.name))[0].name;

  // 2. Download and parse.
  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(backupFile);
  if (dlErr || !blob) {
    return new Response(JSON.stringify({ error: 'download failed', detail: dlErr?.message }), { status: 500, headers: corsHeaders });
  }
  const raw = await blob.text();
  let parsed: { tables?: Record<string, unknown[]> } & Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as { tables?: Record<string, unknown[]> };
  } catch (e) {
    return new Response(JSON.stringify({ error: 'backup JSON parse failed', detail: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
  // daily-backup nests every table under `tables.<name>`. Fall back to
  // a flat shape in case the payload format changes.
  const backupRows = (
    (parsed.tables && (parsed.tables as Record<string, unknown[]>).time_entries)
    ?? (parsed as unknown as Record<string, unknown[]>).time_entries
    ?? []
  ) as Array<Record<string, unknown>>;
  const scopedBackup = employeeScope
    ? backupRows.filter((r) => String(r.employee_email || '').toLowerCase() === employeeScope)
    : backupRows;

  // 3. Fetch live IDs so we know what's missing. Pull ALL live time_entries
  //    (or just the employee's scope) — cheap because we only need the id.
  let liveIds = new Set<string>();
  let liveCount = 0;
  {
    // Supabase caps at 1000 per page; loop.
    let from = 0;
    const pageSize = 1000;
    while (true) {
      let q = supabase.from('time_entries').select('id', { count: 'exact' }).range(from, from + pageSize - 1);
      if (employeeScope) q = q.eq('employee_email', employeeScope);
      const { data, count, error } = await q;
      if (error) {
        return new Response(JSON.stringify({ error: 'live fetch failed', detail: error.message }), { status: 500, headers: corsHeaders });
      }
      if (typeof count === 'number') liveCount = count;
      for (const r of (data || [])) liveIds.add(String((r as { id: string }).id));
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
  }

  // 4. Compute the diff.
  const missing = scopedBackup.filter((r) => !liveIds.has(String(r.id)));
  const sample = missing.slice(0, 20).map((r) => ({
    id: r.id,
    employeeEmail: r.employee_email,
    workDate: r.work_date,
    projectName: r.project_name,
    hours: r.hours,
    status: r.status,
    source: r.source,
  }));

  // 5. Diff mode: report and exit.
  if (mode === 'diff') {
    return new Response(JSON.stringify({
      ok: true,
      mode,
      backupFile,
      scope: employeeScope || 'all',
      inBackup: scopedBackup.length,
      inLive: liveCount,
      missing: missing.length,
      sample,
    }), { headers: corsHeaders });
  }

  // 6. Restore mode: insert missing rows. Batched to stay under Postgrest's
  //    payload cap. Never touches existing rows.
  if (missing.length === 0) {
    return new Response(JSON.stringify({
      ok: true, mode, backupFile, scope: employeeScope || 'all',
      inBackup: scopedBackup.length, inLive: liveCount, missing: 0, restored: 0, sample: [],
    }), { headers: corsHeaders });
  }
  let restored = 0;
  const errors: Array<{ id: string; error: string }> = [];
  const BATCH = 200;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const { error } = await supabase.from('time_entries').insert(batch);
    if (error) {
      // If a batch fails (e.g. one row violates a check constraint), fall
      // back to per-row inserts so we still recover as much as possible.
      for (const row of batch) {
        const { error: singleErr } = await supabase.from('time_entries').insert(row);
        if (singleErr) errors.push({ id: String(row.id), error: singleErr.message });
        else restored += 1;
      }
    } else {
      restored += batch.length;
    }
  }

  return new Response(JSON.stringify({
    ok: true, mode, backupFile,
    scope: employeeScope || 'all',
    inBackup: scopedBackup.length, inLive: liveCount,
    missing: missing.length,
    restored,
    errors: errors.slice(0, 20),
    sample,
  }), { headers: corsHeaders });
});
