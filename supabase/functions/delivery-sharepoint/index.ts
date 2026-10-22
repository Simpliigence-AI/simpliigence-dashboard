/**
 * Supabase Edge Function: delivery-sharepoint
 *
 * Links a Project Plans project to a SharePoint / OneDrive for Business
 * folder, lists that folder (and its subfolders) into Documents, and pulls
 * the text out of every project document — SharePoint files and uploads —
 * so "Generate with AI" can read them. Files stay in SharePoint.
 *
 * Actions (body.action):
 *   probe                   → which Graph permissions the Dashboard's app has
 *   link    { projectId, url } → resolve the folder, save it, sync
 *   unlink  { projectId }   → forget the folder and its file list
 *   sync    { projectId }   → re-list the folder, then read new/changed files
 *   extract { projectId }   → read files still waiting (call again while `pending` > 0)
 *   cron                    → nightly: sync every linked project, read what's pending
 *   cron-extract            → every 10 min: read what's pending
 *   link-legacy { defaultRoot? } → one-off: link the folders Governance had on projects
 *
 * Auth: a signed-in user with edit access to the 'project-plans' tab, or the
 * X-Cron-Secret header (DELIVERY_CRON_SECRET vault secret) for pg_cron.
 * Writes use the service role; the user's permission is checked first.
 *
 * Secrets: SUPABASE_SERVICE_ROLE_KEY, GRAPH_TENANT_ID, GRAPH_CLIENT_ID,
 * GRAPH_CLIENT_SECRET (or SHAREPOINT_TENANT_ID / SHAREPOINT_CLIENT_ID /
 * SHAREPOINT_CLIENT_SECRET to use a separate app). The Azure app needs
 * Microsoft Graph application permission Sites.Read.All with admin consent.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error npm specifier
import { createClient } from 'npm:@supabase/supabase-js@2';
import { extract, CONVERT, MEDIA, IMAGE } from './extract.ts';

// @ts-expect-error Deno runtime
const env = (name: string) => Deno.env.get(name);
const SUPABASE_URL = env('SUPABASE_URL')!;
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = env('SUPABASE_ANON_KEY')!;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const BUCKET = 'delivery-documents';
const MAX_FILES = 2000;
const MAX_DEPTH = 8;
const MAX_READ_BYTES = 40 * 1024 * 1024;   // larger files are listed but not read
const BUDGET_MS = 110_000;                  // stop starting new work after this

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
class UserError extends Error { constructor(m: string, public status = 400) { super(m); } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// ── Microsoft Graph ─────────────────────────────────────────────────────

let cached: { token: string; exp: number } | null = null;
async function graphToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  // A separate app registration for SharePoint can be used via SHAREPOINT_* secrets; otherwise the Dashboard's Graph app.
  const sp = !!env('SHAREPOINT_CLIENT_ID');
  const t = (sp && env('SHAREPOINT_TENANT_ID')) || env('GRAPH_TENANT_ID');
  const c = sp ? env('SHAREPOINT_CLIENT_ID') : env('GRAPH_CLIENT_ID');
  const s = sp ? env('SHAREPOINT_CLIENT_SECRET') : env('GRAPH_CLIENT_SECRET');
  if (!t || !c || !s) throw new UserError('Microsoft Graph secrets (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET) are not set.', 500);
  const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c, client_secret: s, scope: 'https://graph.microsoft.com/.default' }),
  });
  if (!r.ok) throw new UserError(`Microsoft sign-in failed (${r.status}): ${(await r.text()).slice(0, 200)}`, 502);
  const j = await r.json() as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

function roles(token: string): string[] {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))).roles ?? [];
  } catch { return []; }
}

const NO_ACCESS = 'The Dashboard’s Microsoft app can’t read SharePoint yet. In Azure: Entra ID → App registrations → the Dashboard app → API permissions → Add → Microsoft Graph → Application → Sites.Read.All → Grant admin consent.';

async function graph(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await graphToken();
  const url = path.startsWith('http') ? path : `${GRAPH}${path}`;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
    if ((r.status === 429 || r.status === 503) && attempt < 3) {
      await new Promise((ok) => setTimeout(ok, Math.min(10, Number(r.headers.get('retry-after')) || 2 ** attempt) * 1000));
      continue;
    }
    return r;
  }
}
async function graphJson(path: string, init: RequestInit = {}): Promise<Row> {
  const r = await graph(path, init);
  if (r.ok) return r.json();
  const body = await r.text();
  let msg = body.slice(0, 300);
  try { msg = JSON.parse(body).error?.message ?? msg; } catch { /* keep */ }
  if (r.status === 401 || r.status === 403) {
    const has = roles(await graphToken()).some((x) => /^(Sites|Files)\.(Read|ReadWrite)\.All$|^Sites\.(Selected|FullControl\.All|Manage\.All)$/.test(x));
    throw new UserError(has ? `SharePoint refused access to that folder: ${msg}` : NO_ACCESS, 403);
  }
  if (r.status === 404) throw new UserError('SharePoint couldn’t find that folder. Paste the link from the folder’s “Copy link” button, or the address bar while the folder is open.', 404);
  throw new UserError(`SharePoint error (${r.status}): ${msg}`, 502);
}

const shareToken = (url: string) =>
  'u!' + btoa(unescape(encodeURIComponent(url))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');

const ITEM_FIELDS = 'id,name,size,webUrl,lastModifiedDateTime,file,folder,parentReference';

/** Turn whatever link the user pasted into { driveId, itemId }. */
async function resolveFolder(raw: string): Promise<Row> {
  const url = raw.trim();
  if (!/^https:\/\/[^/]+\.sharepoint\.com\//i.test(url)) {
    throw new UserError('Paste a SharePoint or OneDrive for Business link (https://…sharepoint.com/…).');
  }
  // 1) Sharing links (Copy link) and most plain links resolve through /shares.
  const r = await graph(`/shares/${shareToken(url)}/driveItem?$select=${ITEM_FIELDS}`, { headers: { Prefer: 'redeemSharingLinkIfNecessary' } });
  if (r.ok) return r.json();
  if (r.status === 401 || r.status === 403) await graphJson(`/shares/${shareToken(url)}/driveItem`); // throws the right message

  // 2) Browser address-bar links: …/sites/X/Shared Documents/Forms/AllItems.aspx?id=/sites/X/Shared Documents/Folder
  const u = new URL(url);
  let serverPath = u.searchParams.get('id') ?? u.searchParams.get('RootFolder') ?? decodeURIComponent(u.pathname);
  serverPath = serverPath.replace(/\/Forms\/[^/]+\.aspx$/i, '').replace(/\/$/, '');
  const m = serverPath.match(/^\/(sites|teams|personal)\/([^/]+)(\/.*)?$/i);
  if (!m) throw new UserError('Couldn’t work out the folder from that link. Open the folder in SharePoint, click “Copy link”, and paste that.');
  const site = await graphJson(`/sites/${u.hostname}:/${m[1]}/${m[2]}`);
  const drives = (await graphJson(`/sites/${site.id}/drives?$select=id,name,webUrl`)).value as Row[];
  const full = `https://${u.hostname}${serverPath}`.toLowerCase();
  const drive = drives
    .filter((d) => full.startsWith(decodeURIComponent(d.webUrl).toLowerCase()))
    .sort((a, b) => b.webUrl.length - a.webUrl.length)[0];
  if (!drive) throw new UserError('Couldn’t find that document library. Open the folder in SharePoint, click “Copy link”, and paste that.');
  const rel = full.slice(decodeURIComponent(drive.webUrl).length).replace(/^\//, '');
  const relReal = serverPath.slice(serverPath.length - rel.length);
  return graphJson(rel ? `/drives/${drive.id}/root:/${encodeURI(relReal)}?$select=${ITEM_FIELDS}` : `/drives/${drive.id}/root?$select=${ITEM_FIELDS}`);
}

interface SpFile { id: string; name: string; size: number; webUrl: string; modified: string; mime: string | null; path: string }

async function listFolder(driveId: string, itemId: string): Promise<{ files: SpFile[]; truncated: boolean }> {
  const files: SpFile[] = [];
  const queue: Array<{ id: string; path: string; depth: number }> = [{ id: itemId, path: '', depth: 0 }];
  while (queue.length) {
    const f = queue.shift()!;
    let next: string | null = `/drives/${driveId}/items/${f.id}/children?$top=999&$select=${ITEM_FIELDS}`;
    while (next) {
      const page = await graphJson(next);
      for (const it of (page.value ?? []) as Row[]) {
        if (it.folder) {
          if (f.depth + 1 < MAX_DEPTH) queue.push({ id: it.id, path: f.path ? `${f.path}/${it.name}` : it.name, depth: f.depth + 1 });
        } else if (it.file) {
          if (it.name.startsWith('~$')) continue;   // Office lock files
          files.push({ id: it.id, name: it.name, size: it.size ?? 0, webUrl: it.webUrl, modified: it.lastModifiedDateTime, mime: it.file.mimeType ?? null, path: f.path });
          if (files.length >= MAX_FILES) return { files, truncated: true };
        }
      }
      next = page['@odata.nextLink'] ?? null;
    }
  }
  return { files, truncated: false };
}

// ── Sync ────────────────────────────────────────────────────────────────

function guessType(name: string, path: string): string {
  const s = `${path}/${name}`.toLowerCase();
  if (MEDIA.test(name) || /transcript|recording|meeting|minutes|\bmom\b|kick.?off|workshop/.test(s)) return 'Meeting';
  if (/\bsow\b|statement of work|order form|proposal|contract/.test(s)) return 'SOW';
  if (/user.?stor|backlog|epic/.test(s)) return 'User Stories';
  if (/test|uat|\bqa\b/.test(s)) return 'Test Cases';
  if (/process|flow|swimlane/.test(s)) return 'Process Flows';
  if (/requirement|\bbrd\b|\bfrd\b|discovery|scope/.test(s)) return 'Requirements';
  if (/design|architecture|solution|data model|erd|mapping|integration/.test(s)) return 'Design';
  if (/status|report|steer|steerco/.test(s)) return 'Status';
  return 'Other';
}

async function syncProject(projectId: string, actor: string | null) {
  const { data: p } = await svc.from('delivery_projects').select('id, sp_drive_id, sp_item_id').eq('id', projectId).maybeSingle();
  if (!p?.sp_item_id) throw new UserError('This project isn’t linked to a SharePoint folder yet.');
  try {
    const { files, truncated } = await listFolder(p.sp_drive_id, p.sp_item_id);
    const { data: existing } = await svc.from('delivery_documents').select('id, sp_item_id, modified_at, size_bytes, name, sp_path')
      .eq('project_id', projectId).eq('source', 'sharepoint');
    const byItem = new Map(((existing ?? []) as Row[]).map((d) => [d.sp_item_id, d]));
    const seen = new Set<string>();
    const inserts: Row[] = [];
    let updated = 0;
    for (const f of files) {
      seen.add(f.id);
      const old = byItem.get(f.id);
      const meta = { name: f.name, sp_path: f.path || null, web_url: f.webUrl, size_bytes: f.size, modified_at: f.modified, mime_type: f.mime };
      if (!old) {
        inserts.push({ id: newId(), project_id: projectId, source: 'sharepoint', state: 'review', doc_type: guessType(f.name, f.path),
          sp_item_id: f.id, sp_drive_id: p.sp_drive_id, text_status: 'pending', added_by: 'SharePoint', ...meta });
      } else if (new Date(old.modified_at).getTime() !== new Date(f.modified).getTime() || Number(old.size_bytes) !== f.size) {
        await svc.from('delivery_documents').update({ ...meta, text_status: 'pending', text_error: null }).eq('id', old.id);
        updated++;
      } else if (old.name !== f.name || (old.sp_path ?? '') !== f.path) {
        await svc.from('delivery_documents').update({ name: f.name, sp_path: f.path || null, web_url: f.webUrl }).eq('id', old.id);
      }
    }
    for (let i = 0; i < inserts.length; i += 200) {
      const { error } = await svc.from('delivery_documents').insert(inserts.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }
    const gone = ((existing ?? []) as Row[]).filter((d) => !seen.has(d.sp_item_id)).map((d) => d.id);
    for (let i = 0; i < gone.length; i += 200) await svc.from('delivery_documents').delete().in('id', gone.slice(i, i + 200));
    const note = truncated ? `Only the first ${MAX_FILES} files are listed.` : null;
    await svc.from('delivery_projects').update({ sp_synced_at: new Date().toISOString(), sp_sync_error: note }).eq('id', projectId);
    const res = { total: files.length, added: inserts.length, updated, removed: gone.length, truncated };
    if (res.added || res.updated || res.removed) {
      const bits = [res.added && `${res.added} added`, res.updated && `${res.updated} changed`, res.removed && `${res.removed} removed`].filter(Boolean).join(', ');
      await svc.from('delivery_audit').insert({ project_id: projectId, actor: actor ?? 'SharePoint sync', action: 'sharepoint.sync',
        payload: { label: `SharePoint folder: ${bits}` } });
    }
    return res;
  } catch (e) {
    await svc.from('delivery_projects').update({ sp_sync_error: (e as Error).message.slice(0, 500) }).eq('id', projectId);
    throw e;
  }
}

// ── Text extraction ─────────────────────────────────────────────────────

async function readBytes(d: Row): Promise<{ bytes: Uint8Array; name: string } | { skip: string }> {
  if (d.size_bytes && Number(d.size_bytes) > MAX_READ_BYTES && !MEDIA.test(d.name)) return { skip: `Too large to read (over ${MAX_READ_BYTES / 1024 / 1024} MB).` };
  if (d.storage_path) {
    const { data, error } = await svc.storage.from(BUCKET).download(d.storage_path);
    if (error || !data) throw new Error(`storage: ${error?.message ?? 'no data'}`);
    return { bytes: new Uint8Array(await data.arrayBuffer()), name: d.name };
  }
  if (d.sp_item_id && d.sp_drive_id) {
    const convert = CONVERT.test(d.name);
    const r = await graph(`/drives/${d.sp_drive_id}/items/${d.sp_item_id}/content${convert ? '?format=pdf' : ''}`);
    if (!r.ok) throw new Error(`SharePoint download failed (${r.status})`);
    return { bytes: new Uint8Array(await r.arrayBuffer()), name: convert ? `${d.name}.pdf` : d.name };
  }
  return { skip: 'No file to read.' };
}

async function extractOne(d: Row) {
  let status: string, text: string | undefined, reason: string | undefined;
  if (MEDIA.test(d.name) || IMAGE.test(d.name)) {
    ({ status, reason } = await extract(d.name, new Uint8Array()));
  } else {
    try {
      const got = await readBytes(d);
      if ('skip' in got) { status = 'none'; reason = got.skip; }
      else ({ status, text, reason } = await extract(got.name, got.bytes));
    } catch (e) {
      status = 'error'; reason = (e as Error).message.slice(0, 300);
    }
  }
  if (status === 'ok' && text) {
    await svc.from('delivery_document_text').upsert({ document_id: d.id, project_id: d.project_id, body: text, extracted_at: new Date().toISOString() });
  } else {
    await svc.from('delivery_document_text').delete().eq('document_id', d.id);
  }
  await svc.from('delivery_documents').update({ text_status: status, text_error: reason ?? null, text_chars: text?.length ?? null }).eq('id', d.id);
}

const HEAVY = /\.(pdf|doc|dot|ppt|pps|pot|xls|rtf|odt|odp|ods|msg)$/i;   // PDF parsing is CPU-heavy

async function extractPending(projectId: string | null, deadline: number) {
  // A run that died mid-file (out of CPU/memory) leaves it 'reading'. Retry once on its own; then give up.
  const { data: stuck } = await svc.from('delivery_documents').select('id, text_error').eq('text_status', 'reading');
  for (const d of (stuck ?? []) as Row[]) {
    const err = String(d.text_error ?? '');
    const since = Date.parse(err.replace(/^reading since /, '').replace(/ #2$/, ''));
    if (since && Date.now() - since < 3 * 60_000) continue;          // may still be running
    await svc.from('delivery_documents').update(err.endsWith('#2')
      ? { text_status: 'error', text_error: 'Could not read this file — it may be too large or complex. Save a smaller PDF or Word copy.' }
      : { text_status: 'pending', text_error: 'retry' }).eq('id', d.id);
  }
  // Edge functions have a small CPU allowance per request, so each run reads a bounded amount;
  // the 10-minute job and the Documents tab keep calling until nothing is pending.
  let heavyLeft = 3, bytesLeft = 30e6, done = 0;
  outer: for (;;) {
    let q = svc.from('delivery_documents').select('id, project_id, name, storage_path, sp_item_id, sp_drive_id, size_bytes, text_error')
      .eq('text_status', 'pending').order('size_bytes', { ascending: true, nullsFirst: true }).limit(12);
    if (projectId) q = q.eq('project_id', projectId);
    const { data } = await q;
    const batch = (data ?? []) as Row[];
    if (!batch.length) break;
    for (let i = 0; i < batch.length;) {
      if (Date.now() > deadline || bytesLeft <= 0) break outer;
      const d = batch[i];
      const heavy = HEAVY.test(d.name) || d.text_error === 'retry';
      if (heavy && heavyLeft <= 0) break outer;
      // Light files (Word, PowerPoint, text) three at a time; PDFs, conversions and retries alone.
      let n = 1;
      if (!heavy) while (n < 3 && i + n < batch.length && !HEAVY.test(batch[i + n].name) && batch[i + n].text_error !== 'retry') n++;
      const group = batch.slice(i, i + n);
      for (const g of group) {
        await svc.from('delivery_documents').update({ text_status: 'reading', text_error: `reading since ${new Date().toISOString()}${g.text_error === 'retry' ? ' #2' : ''}` }).eq('id', g.id);
      }
      await Promise.all(group.map(extractOne));
      if (heavy) heavyLeft--;
      bytesLeft -= group.reduce((t, g) => t + (MEDIA.test(g.name) || IMAGE.test(g.name) ? 0 : Number(g.size_bytes ?? 0)), 0);
      done += n; i += n;
    }
  }
  let c = svc.from('delivery_documents').select('id', { count: 'exact', head: true }).in('text_status', ['pending', 'reading']);
  if (projectId) c = c.eq('project_id', projectId);
  const { count } = await c;
  return { read: done, pending: count ?? 0 };
}

async function linkProject(projectId: string, url: string, actor: string | null) {
  const item = await resolveFolder(url);
  if (!item.folder) throw new UserError(`“${item.name}” is a file, not a folder. Link the folder that holds the project’s documents.`);
  const driveId = item.parentReference?.driveId;
  if (!driveId) throw new UserError('Couldn’t read the folder’s library. Try the folder’s “Copy link” link instead.');
  const { data: prj } = await svc.from('delivery_projects').select('sp_item_id').eq('id', projectId).maybeSingle();
  if (!prj) throw new UserError('Project not found', 404);
  if (prj.sp_item_id && prj.sp_item_id !== item.id) {
    await svc.from('delivery_documents').delete().eq('project_id', projectId).eq('source', 'sharepoint');
  }
  const { data: project } = await svc.from('delivery_projects').update({
    sp_folder_url: item.webUrl ?? url, sp_folder_name: item.name, sp_drive_id: driveId, sp_item_id: item.id, sp_sync_error: null, updated_by: actor,
  }).eq('id', projectId).select().single();
  return project;
}

// ── Handler ─────────────────────────────────────────────────────────────

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);
  const started = Date.now();
  const deadline = started + BUDGET_MS;
  try {
    const b = (await req.json().catch(() => ({}))) as Row;
    let actor: string | null = null;
    const secret = req.headers.get('x-cron-secret');
    let cron = false;
    if (secret) {
      const { data } = await svc.rpc('delivery_cron_secret_ok', { p_secret: secret });
      if (data !== true) return reply({ error: 'Bad cron secret' }, 401);
      cron = true;
    } else {
      const auth = req.headers.get('Authorization');
      if (!auth) return reply({ error: 'Sign in required' }, 401);
      const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const [{ data: u }, { data: canEdit }] = await Promise.all([user.auth.getUser(), user.rpc('has_tab', { p_tab_key: 'project-plans', p_verb: 'edit' })]);
      if (!u?.user) return reply({ error: 'Sign in required' }, 401);
      if (canEdit !== true) return reply({ error: 'You need edit access to Project Plans for this.' }, 403);
      const { data: au } = await svc.from('authorized_users').select('full_name').ilike('email', u.user.email ?? '').maybeSingle();
      actor = au?.full_name ?? u.user.email ?? null;
    }

    switch (b.action) {
      case 'probe': {
        const token = await graphToken();
        const r = roles(token);
        // Names only (never values) of secrets that look like Microsoft app credentials.
        // @ts-expect-error Deno
        const names = Object.keys(Deno.env.toObject()).filter((k) => /GRAPH|AZURE|MS_|MSFT|MICROSOFT|SHAREPOINT|ENTRA|TENANT|CLIENT_ID|CLIENT_SECRET|O365|M365|SP_/i.test(k)).sort();
        return reply({ ok: true, roles: r, secrets: names, canRead: r.some((x) => /^(Sites|Files)\.(Read|ReadWrite)\.All$|^Sites\.(FullControl|Manage)\.All$/.test(x)) });
      }
      case 'link': {
        if (cron) throw new UserError('Not allowed');
        if (!b.projectId || !b.url) throw new UserError('projectId and url are required');
        const project = await linkProject(b.projectId, String(b.url), actor);
        const sync = await syncProject(b.projectId, actor);
        const text = await extractPending(b.projectId, deadline);
        return reply({ ok: true, project, ...sync, ...text });
      }
      case 'link-legacy': {
        // One-off: link the folders Governance had on each project (delivery_projects.sharepoint_folder).
        if (!cron) throw new UserError('Not allowed');
        const { data: rows } = await svc.from('delivery_projects').select('id, name, sharepoint_folder').not('sharepoint_folder', 'is', null).is('sp_item_id', null);
        const out: Row[] = [];
        for (const p of (rows ?? []) as Row[]) {
          const v = String(p.sharepoint_folder).trim();
          const url = /^https?:\/\//i.test(v) ? v : `${b.defaultRoot ?? ''}/${encodeURIComponent(v)}`;
          try {
            if (!/^https?:\/\//i.test(url)) throw new Error('not a link');
            await linkProject(p.id, url, 'Governance');
            out.push({ project: p.name, ...(await syncProject(p.id, 'Governance')) });
          } catch (e) { out.push({ project: p.name, folder: v, error: (e as Error).message }); }
        }
        return reply({ ok: true, linked: out });
      }
      case 'unlink': {
        if (cron) throw new UserError('Not allowed');
        await svc.from('delivery_documents').delete().eq('project_id', b.projectId).eq('source', 'sharepoint');
        const { data: project } = await svc.from('delivery_projects').update({
          sp_folder_url: null, sp_folder_name: null, sp_drive_id: null, sp_item_id: null, sp_synced_at: null, sp_sync_error: null, updated_by: actor,
        }).eq('id', b.projectId).select().single();
        return reply({ ok: true, project });
      }
      case 'sync': {
        const sync = await syncProject(b.projectId, actor);
        const text = await extractPending(b.projectId, deadline);
        const { data: project } = await svc.from('delivery_projects').select('*').eq('id', b.projectId).single();
        return reply({ ok: true, project, ...sync, ...text });
      }
      case 'extract': {
        if (b.documentId) {
          await svc.from('delivery_documents').update({ text_status: 'pending' }).eq('id', b.documentId).eq('project_id', b.projectId);
        }
        return reply({ ok: true, ...(await extractPending(b.projectId ?? null, deadline)) });
      }
      case 'cron': {
        if (!cron) throw new UserError('Not allowed');
        const { data: linked } = await svc.from('delivery_projects').select('id').not('sp_item_id', 'is', null);
        const synced: Row[] = [];
        for (const p of (linked ?? []) as Row[]) {
          if (Date.now() > deadline - 30_000) break;
          try { synced.push({ id: p.id, ...(await syncProject(p.id, null)) }); }
          catch (e) { synced.push({ id: p.id, error: (e as Error).message }); }
        }
        return reply({ ok: true, synced, ...(await extractPending(null, deadline)) });
      }
      case 'cron-extract': {
        if (!cron) throw new UserError('Not allowed');
        return reply({ ok: true, ...(await extractPending(null, deadline)) });
      }
      default:
        throw new UserError(`Unknown action "${b.action}".`);
    }
  } catch (e) {
    const status = e instanceof UserError ? e.status : 500;
    const msg = (e as Error).message || String(e);
    console.error('[delivery-sharepoint]', msg);
    return reply({ error: msg }, status);
  }
});
