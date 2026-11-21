/**
 * Supabase Edge Function: client-portal
 *
 * The only door the client portal has into our data. Clients sign in with an
 * email + password we issue (portal_users); they never get a Supabase auth
 * session, so no internal table policy can ever apply to them. Every request
 * carries the portal session token; every read is scoped here to the projects
 * / Concierge accounts granted to that person (portal_grants) and to what each
 * project's portal_settings allow.
 *
 * Actions (POST JSON):
 *   login       { email, password }               → { token, name, email }
 *   logout      { token }
 *   me          { token }                         → person + what they can open
 *   view        { token, kind, id }               → plan / documents / deliverables / issues / meetings / tickets
 *   file        { token, kind, id, docId }        → { url } short-lived download link
 *   upload-url  { token, kind, id, filename, size }→ { path, signedUrl }
 *   upload-done { token, kind, id, path, filename, size, mime }
 *
 * verify_jwt is off: the function authenticates the portal token itself.
 */
// @ts-expect-error npm specifier
import { createClient } from 'npm:@supabase/supabase-js@2';

// @ts-expect-error Deno runtime
const env = (name: string) => Deno.env.get(name);
const svc = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const MAX_UPLOAD = 50 * 1024 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
class Http extends Error { constructor(m: string, public status = 400) { super(m); } }
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

async function sessionUser(token: unknown): Promise<string> {
  if (typeof token !== 'string' || token.length < 32) throw new Http('Please sign in.', 401);
  const { data, error } = await svc.rpc('portal_session_user', { p_token: token });
  if (error || !data) throw new Http('Your session has ended. Please sign in again.', 401);
  return data as string;
}

async function grant(userId: string, kind: unknown, id: unknown): Promise<'project' | 'concierge'> {
  if ((kind !== 'project' && kind !== 'concierge') || typeof id !== 'string') throw new Http('Unknown item');
  const col = kind === 'project' ? 'project_id' : 'concierge_account_id';
  const { data } = await svc.from('portal_grants').select('id').eq('user_id', userId).eq(col, id).maybeSingle();
  if (!data) throw new Http('You do not have access to this.', 403);
  return kind;
}

const event = (userId: string, kind: string, target: Row = {}, detail: Row | null = null) =>
  svc.from('portal_events').insert({ user_id: userId, kind, project_id: target.project_id ?? null, concierge_account_id: target.concierge_account_id ?? null, detail });

async function graphToken(): Promise<string> {
  const t = env('GRAPH_TENANT_ID'), c = env('GRAPH_CLIENT_ID'), s = env('GRAPH_CLIENT_SECRET');
  const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c!, client_secret: s!, scope: 'https://graph.microsoft.com/.default' }),
  });
  if (!r.ok) throw new Http('Could not reach the document store', 502);
  return ((await r.json()) as { access_token: string }).access_token;
}

const safeName = (s: string) => s.replace(/[^\w.\- ()]+/g, '_').slice(0, 150);

// ── view ────────────────────────────────────────────────────────────────
async function viewProject(id: string) {
  const { data: p } = await svc.from('delivery_projects')
    .select('id,name,client,status,start_date,planned_end,current_end,pm,portal_settings,account_id').eq('id', id).single();
  const s = { plan: true, documents: true, deliverables: true, issues: false, meetings: false, ...(p.portal_settings ?? {}) };
  const out: Row = {
    kind: 'project', id: p.id, name: p.name, client: p.client, status: p.status, pm: p.pm,
    startDate: p.start_date, endDate: p.current_end ?? p.planned_end, sections: s,
  };
  if (s.plan) {
    const { data: tasks } = await svc.from('delivery_tasks')
      .select('id,name,phase,start_date,end_date,percent,status,sort_order').eq('project_id', id).order('sort_order');
    out.tasks = (tasks ?? []).map((t: Row) => ({ id: t.id, name: t.name, phase: t.phase, start: t.start_date, end: t.end_date, done: t.status === 'done' || t.percent >= 100, percent: t.percent ?? 0 }));
  }
  if (s.documents || s.deliverables) {
    const { data: docs } = await svc.from('delivery_documents')
      .select('id,name,doc_type,modified_at,updated_at,size_bytes,client_deliverable,uploaded_by_client,created_at')
      .eq('project_id', id).eq('client_visible', true).order('created_at', { ascending: false });
    const rows = (docs ?? []).map((d: Row) => ({ id: d.id, name: d.name, type: d.doc_type, at: d.modified_at ?? d.updated_at ?? d.created_at, size: d.size_bytes, deliverable: d.client_deliverable, fromClient: d.uploaded_by_client }));
    if (s.documents) out.documents = rows.filter((d: Row) => !d.deliverable && !d.fromClient);
    if (s.deliverables) out.deliverables = rows.filter((d: Row) => d.deliverable || d.fromClient);
  }
  if (s.issues) {
    const { data: iss } = await svc.from('delivery_issues').select('id,description,criticality,due_date,owner,state,created_at').eq('project_id', id).eq('state', 'open').order('created_at', { ascending: false });
    out.issues = iss ?? [];
  }
  if (s.meetings) {
    const { data: ev } = await svc.from('delivery_calendar_events').select('id,subject,start_at,end_at,is_external')
      .eq('project_id', id).eq('is_cancelled', false).eq('is_external', true).gte('start_at', new Date(Date.now() - 14 * 864e5).toISOString()).order('start_at').limit(40);
    out.meetings = (ev ?? []).map((e: Row) => ({ id: e.id, subject: e.subject, start: e.start_at, end: e.end_at }));
  }
  return out;
}

async function viewConcierge(id: string) {
  const { data: a } = await svc.from('concierge_accounts').select('id,name,portal_settings,billing_model').eq('id', id).single();
  const s = { tickets: true, documents: true, deliverables: true, ...(a.portal_settings ?? {}) };
  const out: Row = { kind: 'concierge', id: a.id, name: a.name, sections: s };
  if (s.tickets) {
    const { data: t } = await svc.from('tickets').select('id,ticket_number,subject,status,priority,created_time,created_at,updated_at,resolved_at')
      .eq('account_id', id).order('created_at', { ascending: false }).limit(150);
    out.tickets = (t ?? []).map((r: Row) => ({ id: r.id, number: r.ticket_number, subject: r.subject, status: r.status, priority: r.priority, opened: r.created_time ?? r.created_at, updated: r.updated_at, resolved: r.resolved_at }));
  }
  if (s.documents || s.deliverables) {
    const { data: docs } = await svc.from('concierge_account_documents').select('id,title,filename,uploaded_at,size_bytes,uploaded_by_client,kind')
      .eq('account_id', id).eq('client_visible', true).order('uploaded_at', { ascending: false });
    const rows = (docs ?? []).map((d: Row) => ({ id: d.id, name: d.title || d.filename, type: d.kind, at: d.uploaded_at, size: d.size_bytes, fromClient: d.uploaded_by_client }));
    if (s.documents) out.documents = rows.filter((d: Row) => !d.fromClient);
    if (s.deliverables) out.deliverables = rows.filter((d: Row) => d.fromClient);
  }
  return out;
}

// ── file / upload ───────────────────────────────────────────────────────
async function fileUrl(kind: string, id: string, docId: string): Promise<string> {
  if (kind === 'project') {
    const { data: d } = await svc.from('delivery_documents').select('storage_path,sp_drive_id,sp_item_id,web_url,client_visible,project_id')
      .eq('id', docId).eq('project_id', id).maybeSingle();
    if (!d || !d.client_visible) throw new Http('Document not available', 404);
    if (d.storage_path) {
      const { data, error } = await svc.storage.from('delivery-documents').createSignedUrl(d.storage_path, 300, { download: true });
      if (error) throw new Http('Could not open the file', 500);
      return data.signedUrl;
    }
    if (d.sp_drive_id && d.sp_item_id) {
      const token = await graphToken();
      const r = await fetch(`https://graph.microsoft.com/v1.0/drives/${d.sp_drive_id}/items/${d.sp_item_id}?$select=@microsoft.graph.downloadUrl`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json() as Row;
      if (!r.ok || !j['@microsoft.graph.downloadUrl']) throw new Http('Could not open the file', 502);
      return j['@microsoft.graph.downloadUrl'];
    }
    throw new Http('This document has no file attached', 404);
  }
  const { data: d } = await svc.from('concierge_account_documents').select('storage_path,client_visible').eq('id', docId).eq('account_id', id).maybeSingle();
  if (!d || !d.client_visible || !d.storage_path) throw new Http('Document not available', 404);
  const { data, error } = await svc.storage.from('concierge-docs').createSignedUrl(d.storage_path, 300, { download: true });
  if (error) throw new Http('Could not open the file', 500);
  return data.signedUrl;
}

const bucketFor = (kind: string) => (kind === 'project' ? 'delivery-documents' : 'concierge-docs');

// @ts-expect-error Deno runtime
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);
  try {
    const b = await req.json().catch(() => ({})) as Row;
    switch (b.action) {
      case 'login': {
        if (typeof b.email !== 'string' || typeof b.password !== 'string') throw new Http('Enter your email and password.');
        const { data, error } = await svc.rpc('portal_login', { p_email: b.email, p_password: b.password });
        if (error) throw new Http('Sign-in is unavailable right now.', 500);
        if (!data?.ok) return reply({ error: data?.error ?? 'Email or password is incorrect.' }, 401);
        return reply({ token: data.token, name: data.name, email: data.email });
      }
      case 'logout': {
        if (typeof b.token === 'string') {
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(b.token)))].map((x) => x.toString(16).padStart(2, '0')).join('');
          await svc.from('portal_sessions').update({ expires_at: new Date().toISOString() }).eq('token_hash', hash);
        }
        return reply({ ok: true });
      }
      case 'me': {
        const uid = await sessionUser(b.token);
        const [{ data: u }, { data: g }] = await Promise.all([
          svc.from('portal_users').select('email,full_name,company').eq('id', uid).single(),
          svc.from('portal_grants').select('project_id,concierge_account_id,delivery_projects(id,name,client,status),concierge_accounts(id,name)').eq('user_id', uid),
        ]);
        const items = ((g ?? []) as Row[]).map((r) => r.project_id
          ? { kind: 'project', id: r.project_id, name: r.delivery_projects?.name, client: r.delivery_projects?.client, status: r.delivery_projects?.status }
          : { kind: 'concierge', id: r.concierge_account_id, name: r.concierge_accounts?.name, client: r.concierge_accounts?.name, status: 'active' })
          .filter((x) => x.name && x.status !== 'cancelled');
        return reply({ email: u.email, name: u.full_name, company: u.company, items });
      }
      case 'view': {
        const uid = await sessionUser(b.token);
        const kind = await grant(uid, b.kind, b.id);
        const data = kind === 'project' ? await viewProject(b.id) : await viewConcierge(b.id);
        await event(uid, 'view', kind === 'project' ? { project_id: b.id } : { concierge_account_id: b.id });
        return reply(data);
      }
      case 'file': {
        const uid = await sessionUser(b.token);
        const kind = await grant(uid, b.kind, b.id);
        if (typeof b.docId !== 'string') throw new Http('Unknown document');
        const url = await fileUrl(kind, b.id, b.docId);
        await event(uid, 'download', kind === 'project' ? { project_id: b.id } : { concierge_account_id: b.id }, { docId: b.docId });
        return reply({ url });
      }
      case 'upload-url': {
        const uid = await sessionUser(b.token);
        const kind = await grant(uid, b.kind, b.id);
        const size = Number(b.size);
        if (!b.filename || !(size > 0)) throw new Http('Choose a file to upload.');
        if (size > MAX_UPLOAD) throw new Http('Files can be up to 50 MB.');
        const path = `portal/${b.id}/${crypto.randomUUID()}-${safeName(String(b.filename))}`;
        const { data, error } = await svc.storage.from(bucketFor(kind)).createSignedUploadUrl(path);
        if (error) throw new Http('Upload is unavailable right now.', 500);
        return reply({ path, signedUrl: data.signedUrl, uploadToken: data.token });
      }
      case 'upload-done': {
        const uid = await sessionUser(b.token);
        const kind = await grant(uid, b.kind, b.id);
        const path = String(b.path ?? '');
        if (!path.startsWith(`portal/${b.id}/`) || path.includes('..')) throw new Http('Bad upload');
        const { data: u } = await svc.from('portal_users').select('email').eq('id', uid).single();
        const name = safeName(String(b.filename ?? path.split('/').pop()));
        if (kind === 'project') {
          const { error } = await svc.from('delivery_documents').insert({
            id: crypto.randomUUID(), project_id: b.id, name, doc_type: 'Client upload', source: 'upload', state: 'review',
            storage_path: path, mime_type: b.mime ?? null, size_bytes: Number(b.size) || null, added_by: `client: ${u.email}`,
            client_visible: true, uploaded_by_client: u.email, modified_at: new Date().toISOString(),
          });
          if (error) throw new Http('Could not save the upload', 500);
        } else {
          const { error } = await svc.from('concierge_account_documents').insert({
            account_id: b.id, kind: 'document', title: name, filename: name, storage_path: path, mime_type: b.mime ?? null,
            size_bytes: Number(b.size) || null, uploaded_by: `client: ${u.email}`, ai_status: 'done', client_visible: true, uploaded_by_client: u.email,
          });
          if (error) throw new Http('Could not save the upload', 500);
        }
        await event(uid, 'upload', kind === 'project' ? { project_id: b.id } : { concierge_account_id: b.id }, { name });
        return reply({ ok: true });
      }
      default:
        throw new Http('Unknown action');
    }
  } catch (e) {
    const status = e instanceof Http ? e.status : 500;
    return reply({ error: e instanceof Http ? e.message : 'Something went wrong.' }, status);
  }
});
