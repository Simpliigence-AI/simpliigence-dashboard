/**
 * Supabase Edge Function: delivery-extract
 *
 * Pulls issues out of what people are already writing and leaves them on the
 * project (or Concierge account) as *suggested* issues for the PM to accept
 * or dismiss in the weekly check-in. Nothing goes into the issue log or the
 * heat map until a person accepts it.
 *
 * Sources, each read only since the last successful run and never twice
 * (extraction_seen):
 *   email          Outlook mail of the check-in owners / PMs (Graph Mail.Read),
 *                  matched to a project by client domain, keyword or name.
 *   status_report  Status-report documents on a project (text already
 *                  extracted by delivery-sharepoint).
 *   teams          The project's Teams channel (delivery_projects.teams_channel_id,
 *                  "teamId/channelId"; Graph ChannelMessage.Read.All).
 *   slack          The project's / account's Slack channel (slack_channel_id;
 *                  SLACK_BOT_TOKEN secret).
 *   ticket         Inbound Concierge ticket emails, per account.
 *
 * Cost: only messages already matched to a project are sent to Claude, in
 * one batched call per project, using Haiku. Unmatched mail is never read
 * past its headers.
 *
 * If a source fails, the run is recorded in extraction_runs and an email goes
 * to EXTRACT_ALERT_TO (delivery_settings key extract_alert_to, default
 * raghu@simpliigence.com) — only when the set of failures changes, so a
 * broken source alerts once, not every hour.
 *
 * Actions (body.action): probe | run. Auth: X-Cron-Secret (pg_cron) or a
 * signed-in user with Project Plans edit.
 */
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error npm specifier
import { createClient } from 'npm:@supabase/supabase-js@2';

// @ts-expect-error Deno runtime
const env = (name: string) => Deno.env.get(name);
const SUPABASE_URL = env('SUPABASE_URL')!;
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = env('SUPABASE_ANON_KEY')!;
const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const SLACK_TOKEN = env('SLACK_BOT_TOKEN');
const MODEL = 'claude-haiku-4-5';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const FIRST_RUN_DAYS = 7;
const MAX_MSGS_PER_TARGET = 25;
const BUDGET_MS = 110_000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
let started = Date.now();
const timeLeft = () => BUDGET_MS - (Date.now() - started);

async function sha(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const strip = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// ── Auth ────────────────────────────────────────────────────────────────
async function authorised(req: Request): Promise<boolean> {
  const secret = req.headers.get('x-cron-secret');
  if (secret) {
    const { data } = await svc.rpc('delivery_cron_secret_ok', { p_secret: secret });
    if (data === true) return true;
  }
  const auth = req.headers.get('Authorization');
  if (!auth) return false;
  const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data } = await user.rpc('tab_permission', { p_tab_key: 'project-plans' });
  const row = Array.isArray(data) ? data[0] : data;
  return !!row?.can_edit;
}

// ── Microsoft Graph ─────────────────────────────────────────────────────
let cachedToken: { token: string; exp: number } | null = null;
async function graphToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const t = env('GRAPH_TENANT_ID'), c = env('GRAPH_CLIENT_ID'), s = env('GRAPH_CLIENT_SECRET');
  if (!t || !c || !s) throw new Error('Microsoft Graph secrets (GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET) are not set');
  const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c, client_secret: s, scope: 'https://graph.microsoft.com/.default' }),
  });
  if (!r.ok) throw new Error(`Microsoft sign-in failed (${r.status})`);
  const j = await r.json() as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}
function graphRoles(token: string): string[] {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))).roles ?? [];
  } catch { return []; }
}
async function graph(path: string, init: RequestInit = {}): Promise<Row> {
  const token = await graphToken();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'outlook.body-content-type="text"', ...(init.headers ?? {}) },
    });
    if ((r.status === 429 || r.status === 503) && attempt < 3) {
      await new Promise((ok) => setTimeout(ok, Math.min(10, Number(r.headers.get('retry-after')) || 2 ** attempt) * 1000));
      continue;
    }
    if (r.status === 202 || r.status === 204) return {};
    const body = await r.text();
    if (!r.ok) {
      let msg = body.slice(0, 300);
      try { msg = JSON.parse(body).error?.message ?? msg; } catch { /* keep */ }
      throw new Error(`Graph ${r.status}: ${msg}`);
    }
    return body ? JSON.parse(body) : {};
  }
}

// ── Targets (projects + concierge accounts) ─────────────────────────────
interface Target {
  kind: 'project' | 'concierge';
  id: string;
  name: string;
  account: string | null;
  domains: string[];
  keywords: string[];
  teamsChannel: string | null;
  slackChannel: string | null;
  openIssues: string[];
}

async function loadTargets(): Promise<Target[]> {
  const [p, a, iss, c, ci] = await Promise.all([
    svc.from('delivery_projects').select('id,name,client,status,calendar_keywords,client_domains,teams_channel_id,slack_channel_id,account_id').in('status', ['active', 'on_hold']),
    svc.from('delivery_accounts').select('id,name'),
    svc.from('delivery_issues').select('project_id,description').eq('state', 'open'),
    svc.from('concierge_accounts').select('id,name,is_dormant,client_domains,calendar_keywords,slack_channel_id').or('is_dormant.is.null,is_dormant.eq.false'),
    svc.from('concierge_issues').select('account_id,description').eq('state', 'open'),
  ]);
  const acct = new Map(((a.data ?? []) as Row[]).map((r) => [r.id, r.name]));
  const projIssues = new Map<string, string[]>();
  for (const r of (iss.data ?? []) as Row[]) (projIssues.get(r.project_id) ?? projIssues.set(r.project_id, []).get(r.project_id)!).push(r.description);
  const concIssues = new Map<string, string[]>();
  for (const r of (ci.data ?? []) as Row[]) (concIssues.get(r.account_id) ?? concIssues.set(r.account_id, []).get(r.account_id)!).push(r.description);

  const out: Target[] = [];
  for (const r of (p.data ?? []) as Row[]) {
    const account = acct.get(r.account_id) ?? r.client ?? null;
    out.push({
      kind: 'project', id: r.id, name: r.name, account,
      domains: (r.client_domains ?? []).map((d: string) => d.toLowerCase()),
      keywords: [...(r.calendar_keywords ?? [])].map((k: string) => k.toLowerCase()).filter((k: string) => k.length >= 3),
      teamsChannel: r.teams_channel_id ?? null, slackChannel: r.slack_channel_id ?? null,
      openIssues: projIssues.get(r.id) ?? [],
    });
  }
  for (const r of (c.data ?? []) as Row[]) {
    out.push({
      kind: 'concierge', id: r.id, name: r.name, account: r.name,
      domains: (r.client_domains ?? []).map((d: string) => d.toLowerCase()),
      keywords: (r.calendar_keywords ?? []).map((k: string) => k.toLowerCase()),
      teamsChannel: null, slackChannel: r.slack_channel_id ?? null,
      openIssues: concIssues.get(r.id) ?? [],
    });
  }
  return out;
}

/** Best project for an email: client domain 3, keyword 3, account name in subject 2, project name 4. Ties stay unmatched. */
function matchEmail(targets: Target[], subject: string, addrs: string[]): Target | null {
  const subj = ` ${norm(subject)} `;
  const domains = new Set(addrs.map((a) => a.split('@')[1]?.toLowerCase()).filter(Boolean));
  let best: Target | null = null, bestScore = 0, tie = false;
  for (const t of targets) {
    if (t.kind !== 'project') continue;
    let s = 0;
    if (t.domains.some((d) => domains.has(d))) s += 3;
    if (t.keywords.some((k) => subj.includes(` ${norm(k)} `))) s += 3;
    const projName = norm(t.name.split('—').pop() ?? '');
    if (t.account && subj.includes(` ${norm(t.account)} `)) s += 2;
    if (projName.length > 3 && subj.includes(` ${projName} `) && t.account && subj.includes(` ${norm(t.account)} `)) s += 2;
    if (s > bestScore) { best = t; bestScore = s; tie = false; } else if (s === bestScore && s > 0) tie = true;
  }
  return bestScore >= 2 && !tie ? best : null;
}

interface Msg { ref: string; source: string; title: string; from: string; at: string; text: string; url: string | null }

// ── Claude ──────────────────────────────────────────────────────────────
interface Found { ref: string; description: string; criticality: string; owner: string | null; due: string | null }

async function extract(t: Target, msgs: Msg[]): Promise<Found[]> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const today = new Date().toISOString().slice(0, 10);
  const items = msgs.map((m, i) => `<item id="${i}" source="${m.source}" from="${m.from}" date="${m.at.slice(0, 10)}">\n<title>${m.title}</title>\n${m.text.slice(0, 2500)}\n</item>`).join('\n');
  const prompt = `You review project communications for a Salesforce consulting firm (Simpliigence) and pull out ISSUES for the ${t.kind === 'project' ? 'project' : 'managed-services account'} "${t.name}"${t.account ? ` (client: ${t.account})` : ''}.

An issue is something that needs action or puts delivery at risk: a blocker, a defect or escalation, a missed or slipping date, a dependency the client or we owe, a scope dispute, an unhappy stakeholder, an access or environment problem, a resourcing gap. NOT issues: FYIs, meeting logistics, thanks, status that is on track, marketing, newsletters, automated notifications.

Already logged as open (do not repeat these, even reworded):
${t.openIssues.length ? t.openIssues.map((d) => `- ${d}`).join('\n') : '- (none)'}

Today is ${today}. Return ONLY a JSON array, no prose. One object per distinct issue:
{"item": <item id>, "description": "<one clear sentence, max 200 chars, what is wrong and what is needed>", "criticality": "low|medium|high|critical", "owner": "<person or party who must act, or null>", "due": "<YYYY-MM-DD if a date is stated, else null>"}
Merge duplicates across items. Return [] if there are none.

${items}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json() as { content: { type: string; text?: string }[] };
  const text = j.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let arr: Row[] = [];
  try { arr = JSON.parse(m[0]); } catch { return []; }
  return arr
    .filter((x) => x && typeof x.description === 'string' && msgs[Number(x.item)])
    .map((x) => ({
      ref: msgs[Number(x.item)].ref,
      description: String(x.description).slice(0, 400),
      criticality: ['low', 'medium', 'high', 'critical'].includes(x.criticality) ? x.criticality : 'medium',
      owner: x.owner ? String(x.owner).slice(0, 120) : null,
      due: /^\d{4}-\d{2}-\d{2}$/.test(String(x.due ?? '')) ? x.due : null,
    }));
}

async function saveFound(t: Target, msgs: Msg[], found: Found[]): Promise<number> {
  let n = 0;
  for (const f of found) {
    const m = msgs.find((x) => x.ref === f.ref)!;
    const key = await sha(`${t.kind}:${t.id}:${norm(f.description)}`);
    const { error } = await svc.from('extracted_issues').insert({
      project_id: t.kind === 'project' ? t.id : null,
      concierge_account_id: t.kind === 'concierge' ? t.id : null,
      description: f.description, criticality: f.criticality, owner_hint: f.owner, due_hint: f.due,
      source: m.source, source_ref: m.ref, source_title: m.title.slice(0, 300), source_from: m.from,
      source_url: m.url, source_excerpt: m.text.slice(0, 600), source_at: m.at, dedupe_key: key,
    });
    if (!error) n++;
    else if (!String(error.message).includes('duplicate')) throw new Error(error.message);
  }
  return n;
}

async function unseen(source: string, refs: string[]): Promise<Set<string>> {
  if (!refs.length) return new Set();
  const seen = new Set<string>();
  for (let i = 0; i < refs.length; i += 200) {
    const { data } = await svc.from('extraction_seen').select('ref').eq('source', source).in('ref', refs.slice(i, i + 200));
    for (const r of (data ?? []) as Row[]) seen.add(r.ref);
  }
  return new Set(refs.filter((r) => !seen.has(r)));
}
async function markSeen(source: string, refs: string[]) {
  for (let i = 0; i < refs.length; i += 500) {
    await svc.from('extraction_seen').upsert(refs.slice(i, i + 500).map((ref) => ({ source, ref })), { onConflict: 'source,ref', ignoreDuplicates: true });
  }
}

// ── Sources ─────────────────────────────────────────────────────────────
type Bucket = Map<string, { t: Target; msgs: Msg[] }>;
function add(b: Bucket, t: Target, m: Msg) {
  const e = b.get(`${t.kind}:${t.id}`) ?? b.set(`${t.kind}:${t.id}`, { t, msgs: [] }).get(`${t.kind}:${t.id}`)!;
  if (e.msgs.length < MAX_MSGS_PER_TARGET) e.msgs.push(m);
}

async function mailboxes(): Promise<string[]> {
  const [p, c, cal] = await Promise.all([
    svc.from('delivery_projects').select('checkin_owner').in('status', ['active', 'on_hold']),
    svc.from('concierge_accounts').select('checkin_owner'),
    svc.from('delivery_calendar_mailboxes').select('email,kind').eq('kind', 'core'),
  ]);
  const set = new Set<string>();
  for (const r of [...(p.data ?? []), ...(c.data ?? [])] as Row[]) if (r.checkin_owner) set.add(String(r.checkin_owner).toLowerCase());
  for (const r of (cal.data ?? []) as Row[]) if (r.email) set.add(String(r.email).toLowerCase());
  return [...set];
}

async function readEmail(targets: Target[], since: Date, b: Bucket) {
  const stats = { read: 0, matched: 0, partial: false };
  const boxes = await mailboxes();
  const seenNow: string[] = [];
  for (const box of boxes) {
    if (timeLeft() < 60_000) { stats.partial = true; break; }
    let next: string | null = `/users/${encodeURIComponent(box)}/messages?$filter=receivedDateTime ge ${since.toISOString()}&$orderby=receivedDateTime desc&$top=50&$select=id,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,webLink`;
    let pages = 0;
    const headers: Row[] = [];
    while (next && pages < 4) {
      const page = await graph(next);
      headers.push(...((page.value ?? []) as Row[]));
      next = page['@odata.nextLink'] ?? null;
      pages++;
    }
    stats.read += headers.length;
    const fresh = await unseen('email', headers.map((h) => h.internetMessageId ?? h.id));
    for (const h of headers) {
      const ref = h.internetMessageId ?? h.id;
      if (!fresh.has(ref)) continue;
      fresh.delete(ref);
      seenNow.push(ref);
      const addrs = [h.from, ...(h.toRecipients ?? []), ...(h.ccRecipients ?? [])].map((x: Row) => String(x?.emailAddress?.address ?? '').toLowerCase()).filter(Boolean);
      const t = matchEmail(targets, h.subject ?? '', addrs);
      if (!t) continue;
      // Only now pay to read the body.
      const full = await graph(`/users/${encodeURIComponent(box)}/messages/${h.id}?$select=uniqueBody,body`);
      const text = String(full.uniqueBody?.content || full.body?.content || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      stats.matched++;
      add(b, t, {
        ref, source: 'email', title: h.subject ?? '(no subject)',
        from: h.from?.emailAddress?.name || h.from?.emailAddress?.address || '',
        at: h.receivedDateTime, text, url: h.webLink ?? null,
      });
    }
  }
  return { stats, seenNow };
}

async function readStatusReports(targets: Target[], b: Bucket) {
  const ids = targets.filter((t) => t.kind === 'project').map((t) => t.id);
  const { data, error } = await svc.from('delivery_documents')
    .select('id,project_id,name,doc_type,modified_at,updated_at,web_url')
    .in('project_id', ids)
    .or('doc_type.ilike.%status%,name.ilike.%status report%,name.ilike.%weekly status%,name.ilike.%status update%')
    .eq('text_status', 'done');
  if (error) throw new Error(error.message);
  const docs = (data ?? []) as Row[];
  const refs = docs.map((d) => `${d.id}@${d.modified_at ?? d.updated_at}`);
  const fresh = await unseen('status_report', refs);
  const seenNow: string[] = [];
  for (const d of docs) {
    const ref = `${d.id}@${d.modified_at ?? d.updated_at}`;
    if (!fresh.has(ref)) continue;
    seenNow.push(ref);
    const { data: txt } = await svc.from('delivery_document_text').select('body').eq('document_id', d.id).maybeSingle();
    const body = String(txt?.body ?? '').trim();
    const t = targets.find((x) => x.kind === 'project' && x.id === d.project_id);
    if (!body || !t) continue;
    add(b, t, { ref, source: 'status_report', title: d.name, from: 'Status report', at: d.modified_at ?? d.updated_at, text: body.slice(0, 6000), url: d.web_url ?? null });
  }
  return { stats: { read: docs.length, matched: seenNow.length }, seenNow };
}

async function readTeams(targets: Target[], since: Date, b: Bucket) {
  const withChannel = targets.filter((t) => t.teamsChannel);
  const seenNow: string[] = [];
  let read = 0;
  for (const t of withChannel) {
    const [team, channel] = String(t.teamsChannel).split(/[/|]/);
    if (!team || !channel) continue;
    const page = await graph(`/teams/${team}/channels/${encodeURIComponent(channel)}/messages?$top=50`);
    const msgs = ((page.value ?? []) as Row[]).filter((m) => m.messageType === 'message' && new Date(m.lastModifiedDateTime ?? m.createdDateTime) >= since);
    read += msgs.length;
    const fresh = await unseen('teams', msgs.map((m) => `${team}/${m.id}@${m.lastModifiedDateTime ?? m.createdDateTime}`));
    for (const m of msgs) {
      const ref = `${team}/${m.id}@${m.lastModifiedDateTime ?? m.createdDateTime}`;
      if (!fresh.has(ref)) continue;
      seenNow.push(ref);
      const text = strip(String(m.body?.content ?? ''));
      if (text.length < 15) continue;
      add(b, t, { ref, source: 'teams', title: m.subject || `Teams · ${t.name}`, from: m.from?.user?.displayName ?? '', at: m.createdDateTime, text, url: m.webUrl ?? null });
    }
  }
  return { stats: { read, matched: seenNow.length, channels: withChannel.length }, seenNow };
}

async function readSlack(targets: Target[], since: Date, b: Bucket) {
  const withChannel = targets.filter((t) => t.slackChannel);
  if (!withChannel.length) return { stats: { read: 0, matched: 0, channels: 0 }, seenNow: [] as string[] };
  if (!SLACK_TOKEN) throw new Error('SLACK_BOT_TOKEN is not set, so Slack channels mapped to projects cannot be read');
  const seenNow: string[] = [];
  let read = 0;
  for (const t of withChannel) {
    const r = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(t.slackChannel!)}&oldest=${since.getTime() / 1000}&limit=100`, { headers: { Authorization: `Bearer ${SLACK_TOKEN}` } });
    const j = await r.json() as Row;
    if (!j.ok) throw new Error(`Slack ${t.slackChannel}: ${j.error}`);
    const msgs = ((j.messages ?? []) as Row[]).filter((m) => !m.subtype && m.text);
    read += msgs.length;
    const fresh = await unseen('slack', msgs.map((m) => `${t.slackChannel}/${m.ts}`));
    for (const m of msgs) {
      const ref = `${t.slackChannel}/${m.ts}`;
      if (!fresh.has(ref)) continue;
      seenNow.push(ref);
      if (String(m.text).length < 15) continue;
      add(b, t, { ref, source: 'slack', title: `Slack · ${t.name}`, from: m.user_profile?.real_name ?? m.user ?? '', at: new Date(Number(m.ts) * 1000).toISOString(), text: String(m.text), url: null });
    }
  }
  return { stats: { read, matched: seenNow.length, channels: withChannel.length }, seenNow };
}

async function readTickets(targets: Target[], since: Date, b: Bucket) {
  const conc = new Map(targets.filter((t) => t.kind === 'concierge').map((t) => [t.id, t]));
  const { data, error } = await svc.from('ticket_messages')
    .select('id,ticket_id,from_email,from_name,subject,body_text,received_at,created_at,tickets!inner(account_id,web_url,ticket_number)')
    .eq('direction', 'inbound').gte('created_at', since.toISOString()).limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const fresh = await unseen('ticket', rows.map((r) => r.id));
  const seenNow: string[] = [];
  for (const r of rows) {
    if (!fresh.has(r.id)) continue;
    seenNow.push(r.id);
    const t = conc.get(r.tickets?.account_id);
    const text = String(r.body_text ?? '').replace(/\s+/g, ' ').trim();
    if (!t || !text) continue;
    add(b, t, { ref: r.id, source: 'ticket', title: `${r.tickets?.ticket_number ? `#${r.tickets.ticket_number} ` : ''}${r.subject ?? ''}`, from: r.from_name || r.from_email || '', at: r.received_at ?? r.created_at, text, url: r.tickets?.web_url ?? null });
  }
  return { stats: { read: rows.length, matched: seenNow.length }, seenNow };
}

// ── Alerts ──────────────────────────────────────────────────────────────
async function alertOnChange(errors: Record<string, string>) {
  const sig = Object.keys(errors).sort().join(',');
  const { data: prev } = await svc.from('delivery_settings').select('value').eq('key', 'extract_last_error_sig').maybeSingle();
  if ((prev?.value ?? '') === sig) return;
  await svc.from('delivery_settings').upsert({ key: 'extract_last_error_sig', value: sig, updated_at: new Date().toISOString() });
  if (!sig) return; // recovered — nothing to send
  const { data: to } = await svc.from('delivery_settings').select('value').eq('key', 'extract_alert_to').maybeSingle();
  const recipient = to?.value || 'raghu@simpliigence.com';
  const from = env('GRAPH_SENDER_MAILBOX');
  if (!from) return;
  const html = `<p>The hourly issue extraction for Delivery Cockpit could not read some sources:</p><ul>${Object.entries(errors).map(([k, v]) => `<li><b>${k}</b>: ${v.replace(/</g, '&lt;')}</li>`).join('')}</ul><p>Other sources kept running. You will get one email when this set of failures changes, not every hour.</p>`;
  await graph(`/users/${encodeURIComponent(from)}/sendMail`, {
    method: 'POST',
    body: JSON.stringify({ message: { subject: 'Delivery Cockpit: issue extraction source failing', body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: recipient } }] }, saveToSentItems: false }),
  });
}

// ── Handlers ────────────────────────────────────────────────────────────
async function probe() {
  const token = await graphToken().catch((e) => { throw e; });
  const r = graphRoles(token);
  return {
    graphRoles: r,
    email: r.some((x) => /^Mail\.(Read|ReadBasic|ReadWrite)(\.All)?$/.test(x)),
    teams: r.some((x) => /^ChannelMessage\.Read\.All$/.test(x)),
    sendMail: r.includes('Mail.Send'),
    slackToken: !!SLACK_TOKEN,
    anthropic: !!ANTHROPIC_API_KEY,
    mailboxes: await mailboxes(),
  };
}

async function run() {
  const { data: last } = await svc.from('extraction_runs').select('started_at').eq('ok', true).order('started_at', { ascending: false }).limit(1).maybeSingle();
  const floor = Date.now() - FIRST_RUN_DAYS * 864e5;
  const since = new Date(Math.max(floor, last?.started_at ? new Date(last.started_at).getTime() - 15 * 60_000 : floor));
  const { data: runRow } = await svc.from('extraction_runs').insert({}).select('id').single();
  const targets = await loadTargets();
  const bucket: Bucket = new Map();
  const sources: Row = {};
  const errors: Record<string, string> = {};
  const seenBy: Record<string, string[]> = {};

  const readers: [string, () => Promise<{ stats: Row; seenNow: string[] }>][] = [
    ['email', () => readEmail(targets, since, bucket)],
    ['status_report', () => readStatusReports(targets, bucket)],
    ['teams', () => readTeams(targets, since, bucket)],
    ['slack', () => readSlack(targets, since, bucket)],
    ['ticket', () => readTickets(targets, since, bucket)],
  ];
  for (const [name, fn] of readers) {
    try {
      const { stats, seenNow } = await fn();
      sources[name] = stats;
      seenBy[name] = seenNow;
    } catch (e) {
      errors[name] = String((e as Error).message ?? e).slice(0, 300);
      sources[name] = { error: errors[name] };
    }
  }

  // Analyse projects four at a time. Anything not analysed (time ran out, or Claude
  // failed) is left unseen so the next run picks it up — nothing is dropped.
  let suggested = 0;
  const pending = [...bucket.values()].filter((b) => b.msgs.length);
  const notDone = new Set<string>();
  const worker = async () => {
    for (;;) {
      const job = pending.shift();
      if (!job) return;
      if (timeLeft() < 12_000) {
        errors.budget = 'Ran out of time before every project was analysed; the rest is picked up next hour.';
        for (const m of job.msgs) notDone.add(m.ref);
        continue;
      }
      try {
        const found = await extract(job.t, job.msgs);
        suggested += await saveFound(job.t, job.msgs, found);
      } catch (e) {
        errors.claude = String((e as Error).message ?? e).slice(0, 300);
        for (const m of job.msgs) notDone.add(m.ref);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (const k of Object.keys(seenBy)) seenBy[k] = seenBy[k].filter((r) => !notDone.has(r));
  for (const [name, refs] of Object.entries(seenBy)) await markSeen(name, refs);

  if (sources.email?.partial) errors.budget = 'Not every mailbox was read this hour; the next run continues from the same point.';
  // Only a fully clean run moves the read window forward; seen-tracking stops double work.
  const ok = !errors.claude && !errors.email && !errors.budget;
  await svc.from('extraction_runs').update({ finished_at: new Date().toISOString(), ok, sources: { ...sources, suggested, errors }, error: Object.keys(errors).length ? JSON.stringify(errors) : null }).eq('id', runRow!.id);
  const alertable = { ...errors };
  delete alertable.budget;
  await alertOnChange(alertable).catch(() => { /* alert best-effort */ });
  return { ok, since: since.toISOString(), suggested, sources, errors };
}

// @ts-expect-error Deno runtime
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  started = Date.now();
  try {
    if (!(await authorised(req))) return reply({ error: 'Not authorised' }, 401);
    const body = await req.json().catch(() => ({})) as Row;
    if (body.action === 'probe') return reply(await probe());
    return reply(await run());
  } catch (e) {
    return reply({ error: String((e as Error).message ?? e) }, 500);
  }
});
