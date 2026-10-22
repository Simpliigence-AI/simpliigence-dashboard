/**
 * Supabase Edge Function: governance-docs-import
 *
 * One-off mover for phase 3 of the Governance → Dashboard merge. Governance
 * kept its project documents on its Render disk; this downloads each one
 * through the Governance API (/api/documents/{id}/download) and streams it
 * into the private 'delivery-documents' bucket, then sets storage_path on the
 * delivery_documents row. Rows already moved are skipped, so it is safe to
 * call repeatedly until `remaining` is 0. Delete this function once Render is
 * shut down.
 *
 * Auth: an admin's JWT (can_approve on 'project-plans'), or an
 * X-Import-Secret header matching the vault secret DELIVERY_IMPORT_SECRET
 * (checked by delivery_import_secret_ok(); lets pg_net drive the move).
 *
 * Secrets used: GOVERNANCE_BASE_URL (optional), GOVERNANCE_EMAIL,
 * GOVERNANCE_PASSWORD, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Body: { limit?: number (default 3, max 10), ids?: string[], retry?: boolean }
 *   Each call also stops once ~120 MB has been moved, so it fits the
 *   edge-function time limit; the first file is always attempted.
 *   Rows that failed before are skipped unless retry=true or named in ids.
 * Response: { ok, moved: [...], failed: [{id, name, error}], remaining }
 *
 * Body { action: 'audit' } instead copies Governance's audit trail
 * (/api/projects/{id}/audit for every project) into delivery_audit, ids
 * prefixed 'gov-' so re-running doesn't duplicate.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno runtime
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = env('SUPABASE_URL')!;
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = env('SUPABASE_ANON_KEY')!;
const BASE = (env('GOVERNANCE_BASE_URL') || 'https://simpliigence-governance.onrender.com').replace(/\/$/, '');
const GOV_EMAIL = env('GOVERNANCE_EMAIL');
const GOV_PASSWORD = env('GOVERNANCE_PASSWORD');
const BUCKET = 'delivery-documents';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-import-secret',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown', txt: 'text/plain', url: 'text/plain',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4',
};
const mimeFor = (name: string) => MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';

/** Storage keys: keep the name readable but only safe characters. */
const safeName = (name: string) =>
  name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').slice(0, 150) || 'file';

async function authorised(req: Request): Promise<boolean> {
  const secret = req.headers.get('x-import-secret');
  if (secret) {
    const svc = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data } = await svc.rpc('delivery_import_secret_ok', { p_secret: secret });
    if (data === true) return true;
  }
  const auth = req.headers.get('Authorization');
  if (!auth) return false;
  const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data } = await user.rpc('tab_permission', { p_tab_key: 'project-plans' });
  const row = Array.isArray(data) ? data[0] : data;
  return !!(row && (row.can_approve ?? row.approve));
}

async function govLogin(): Promise<string> {
  if (!GOV_EMAIL || !GOV_PASSWORD) throw new Error('GOVERNANCE_EMAIL / GOVERNANCE_PASSWORD secrets are not set');
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: GOV_EMAIL, password: GOV_PASSWORD }),
  });
  if (!r.ok) throw new Error(`Governance login failed (${r.status})`);
  const d = (await r.json()) as { access_token?: string };
  if (!d.access_token) throw new Error('Governance login returned no token');
  return d.access_token;
}

/** Copy Governance's audit events for every project into delivery_audit. */
async function importAudit() {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const token = await govLogin();
  const { data: projects } = await db.from('delivery_projects').select('id');
  let copied = 0;
  const failed: string[] = [];
  for (const p of projects ?? []) {
    const r = await fetch(`${BASE}/api/projects/${p.id}/audit`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) { failed.push(`${p.id}: ${r.status}`); continue; }
    const raw = await r.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const events: any[] = Array.isArray(raw) ? raw : (raw.events ?? raw.audit ?? raw.items ?? []);
    const rows = events.filter((e) => e && (e.id || e.at)).map((e) => ({
      id: `gov-${e.id ?? `${p.id}-${e.at}-${e.action}`}`,
      project_id: e.project_id ?? p.id,
      at: e.at ?? e.created_at ?? e.timestamp,
      actor: e.actor ?? e.actor_name ?? e.user ?? null,
      action: e.action ?? e.kind ?? 'event',
      payload: typeof e.payload === 'string' ? (() => { try { return JSON.parse(e.payload); } catch { return { text: e.payload }; } })() : (e.payload ?? {}),
    })).filter((x) => x.at);
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('delivery_audit').upsert(rows.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true });
      if (error) { failed.push(`${p.id}: ${error.message}`); break; }
      copied += Math.min(500, rows.length - i);
    }
  }
  return { ok: true, action: 'audit', copied, failed };
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);
  try {
    if (!(await authorised(req))) return reply({ error: 'Admins only' }, 403);
    const body = (await req.json().catch(() => ({}))) as { limit?: number; ids?: string[]; retry?: boolean; action?: string };
    if (body.action === 'audit') return reply(await importAudit());
    const limit = Math.max(1, Math.min(10, body.limit ?? 3));

    const db = createClient(SUPABASE_URL, SERVICE_KEY);
    let q = db.from('delivery_documents').select('id, project_id, name, legacy_id, size_bytes')
      .not('legacy_id', 'is', null).is('storage_path', null)
      .order('size_bytes', { ascending: true }).limit(limit);
    if (body.ids?.length) q = q.in('id', body.ids);
    else if (!body.retry) q = q.is('import_error', null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const token = rows?.length ? await govLogin() : '';
    const moved: string[] = [];
    const failed: { id: string; name: string; error: string }[] = [];

    const BUDGET = 120 * 1024 * 1024;
    let sent = 0;
    for (const d of rows ?? []) {
      if (sent > 0 && sent + (d.size_bytes ?? 0) > BUDGET) break;
      sent += d.size_bytes ?? 0;
      try {
        const g = await fetch(`${BASE}/api/documents/${d.legacy_id}/download`, { headers: { Authorization: `Bearer ${token}` } });
        if (!g.ok || !g.body) throw new Error(`download ${g.status}`);
        const mime = mimeFor(d.name);
        const path = `${d.project_id}/${d.id}/${safeName(d.name)}`;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          'Content-Type': mime,
          'x-upsert': 'true',
        };
        const len = g.headers.get('content-length');
        if (len) headers['Content-Length'] = len;
        // Stream straight through: recordings are up to ~190 MB, more than an
        // edge function can hold in memory.
        const up = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(path)}`, {
          method: 'POST', headers, body: g.body,
          // @ts-expect-error Deno streaming upload
          duplex: 'half',
        });
        if (!up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 200)}`);
        const { error: uErr } = await db.from('delivery_documents')
          .update({ storage_path: path, mime_type: mime, import_error: null }).eq('id', d.id);
        if (uErr) throw new Error(uErr.message);
        moved.push(d.name);
      } catch (e) {
        const msg = (e as Error).message || String(e);
        failed.push({ id: d.id, name: d.name, error: msg });
        await db.from('delivery_documents').update({ import_error: msg.slice(0, 500) }).eq('id', d.id);
      }
    }

    const { count } = await db.from('delivery_documents').select('id', { count: 'exact', head: true })
      .not('legacy_id', 'is', null).is('storage_path', null);
    return reply({ ok: true, moved, failed, remaining: count ?? null });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[governance-docs-import]', msg);
    return reply({ error: msg }, 500);
  }
});
