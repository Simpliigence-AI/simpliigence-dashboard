/**
 * Supabase Edge Function: daily-backup
 *
 * Server-side daily JSON backup of every important table. Runs on a pg_cron
 * schedule (see supabase/migrations) and uploads the result to the private
 * `db-backups` storage bucket. Keeps the last 30 days of backups, deletes
 * older ones each run.
 *
 * This replaces (and complements) the client-side daily backup in
 * src/lib/backup.ts which only fires when someone opens the app. Server-side
 * means no admin presence needed — runs even on weekends and holidays.
 *
 * Required secrets (already present for other functions):
 *   SUPABASE_URL                 — auto-provided by edge runtime
 *   SUPABASE_SERVICE_ROLE_KEY    — auto-provided by edge runtime
 *   BACKUP_CRON_SECRET           — set via `supabase secrets set` — pg_cron passes
 *                                  this in the X-Backup-Cron-Secret header so only
 *                                  the cron job can trigger the function
 *
 * Manual invocation (for ops):
 *   curl -X POST https://<project>.supabase.co/functions/v1/daily-backup \
 *     -H "X-Backup-Cron-Secret: $BACKUP_CRON_SECRET"
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global provided by edge runtime
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh resolves at runtime in Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const BACKUP_CRON_SECRET = env('BACKUP_CRON_SECRET');

const BUCKET = 'db-backups';
const RETENTION_DAYS = 30;

// Mirrors src/lib/backup.ts. If you add a table to one list, add it to both.
const TABLES = [
  'forecast_assignments',
  'forecast_meta',
  'financial_settings',
  'sync_config',
  'hiring_forecast_config',
  'staffing_requests',
  'pipeline_projects',
  'india_staffing_accounts',
  'india_staffing_requisitions',
  'india_staffing_statuses',
  'india_staffing_candidates',
  'india_staffing_history',
  'us_staffing_accounts',
  'us_staffing_requisitions',
  'open_bench_resources',
  'open_bench_updates',
  'india_roster',
  'us_roster',
  'authorized_users',
  'actual_hours',
  'ta_daily_log',
  'team_members',
  'time_entries',
  'time_entry_periods',
  'accounts',
  'account_connects',
  'account_action_items',
  'account_client_contacts',
  'vendors',
  'vendor_outreach',
  'audit_log',
  'call_templates',
  'candidate_calls',
  'user_page_views',
  'user_sessions',
] as const;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-backup-cron-secret',
  'Content-Type': 'application/json',
};

// @ts-expect-error Deno.serve provided by edge runtime
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Auth gate: only the configured secret can run this. Without it, a leaked
  // anon key would let anyone trigger a full DB dump.
  if (BACKUP_CRON_SECRET) {
    const provided = req.headers.get('x-backup-cron-secret');
    if (provided !== BACKUP_CRON_SECRET) {
      return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
        status: 401, headers: corsHeaders,
      });
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const startedAt = new Date();
  const tables: Record<string, unknown[]> = {};
  const rowCounts: Record<string, number> = {};
  const errors: Record<string, string> = {};

  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) {
      errors[table] = error.message;
      tables[table] = [];
      rowCounts[table] = 0;
      console.warn(`[daily-backup] fetch ${table} failed:`, error.message);
    } else {
      tables[table] = data || [];
      rowCounts[table] = data?.length ?? 0;
    }
  }

  const payload = {
    version: 1 as const,
    timestamp: startedAt.toISOString(),
    source: 'edge-function:daily-backup',
    rowCounts,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    tables,
  };

  const json = JSON.stringify(payload);
  const filename = `simpliigence-backup-${startedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;

  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(filename, json, {
    contentType: 'application/json',
    upsert: false,
  });

  if (uploadErr) {
    console.error('[daily-backup] upload failed:', uploadErr.message);
    return new Response(JSON.stringify({ ok: false, error: uploadErr.message }), {
      status: 500, headers: corsHeaders,
    });
  }

  // Retention: list everything in the bucket, delete anything older than 30 days.
  // The bucket only holds our backups so listing is bounded.
  const { data: existing, error: listErr } = await supabase.storage.from(BUCKET).list('', {
    limit: 1000, sortBy: { column: 'created_at', order: 'desc' },
  });

  let deleted = 0;
  if (!listErr && existing) {
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const stale = existing
      .filter((o) => o.created_at && new Date(o.created_at).getTime() < cutoff)
      .map((o) => o.name);
    if (stale.length > 0) {
      const { error: delErr } = await supabase.storage.from(BUCKET).remove(stale);
      if (delErr) console.warn('[daily-backup] retention cleanup failed:', delErr.message);
      else deleted = stale.length;
    }
  }

  const finishedAt = new Date();
  const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);

  return new Response(JSON.stringify({
    ok: true,
    filename,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    tablesBackedUp: TABLES.length - Object.keys(errors).length,
    totalRows,
    rowCounts,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    retentionDeleted: deleted,
  }), { headers: corsHeaders });
});
