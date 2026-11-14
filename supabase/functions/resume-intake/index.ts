/**
 * Supabase Edge Function: resume-intake
 *
 * Forward an email with resumes attached to india-resumes@simpliigence.com and each
 * resume becomes a candidate, parsed by parse-resume. The forwarder becomes the owning TA.
 *
 * Routing (v2, 13 Nov 2026):
 *   - If the subject or body carries a job ID (REQ-1042), every resume in the email is
 *     attached to that requisition, open or closed.
 *   - No job ID, or a job ID that doesn't exist: the resumes go to the unassigned pool.
 *
 * Duplicates (email / last-10 phone / LinkedIn slug):
 *   - Same person already on the target requisition: that profile gets the new resume.
 *   - Same person sitting in the pool: that profile gets the new resume and moves to the requisition.
 *   - Same person only on OTHER requisitions: a new row is kept on the target requisition
 *     (one row per person per role), and the reply says so.
 *   - No job ID: the oldest matching profile gets the new resume (unchanged from v1).
 *
 * Failures in renew / sweep are emailed to resume_intake_config.alert_to, at most once
 * per 24 h per distinct problem, so a broken mailbox or subscription is never silent.
 *
 * Same shape as demand-intake: Graph subscription per mailbox Inbox -> ack 202 ->
 * process in background. Sweep every 10 min catches dropped notifications; hourly
 * renew keeps subscriptions alive. Sender must be an active authorized_users row.
 *
 * Admin (POST JSON, header x-intake-secret = resume_intake_config.admin_secret):
 *   { action: 'renew' | 'sweep' | 'status' }
 * verify_jwt = false - Graph sends no JWT; notifications are checked against clientState.
 */
// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);
// @ts-expect-error esm.sh at runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = env('SUPABASE_URL')!;
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = env('SUPABASE_ANON_KEY') || SERVICE_KEY;
const GRAPH_TENANT_ID = env('GRAPH_TENANT_ID');
const GRAPH_CLIENT_ID = env('GRAPH_CLIENT_ID');
const GRAPH_CLIENT_SECRET = env('GRAPH_CLIENT_SECRET');
const ALERT_FROM = env('GRAPH_SENDER_MAILBOX') || 'hr@simpliigence.com';
const SELF_URL = `${SUPABASE_URL}/functions/v1/resume-intake`;
const PARSE_URL = `${SUPABASE_URL}/functions/v1/parse-resume`;
const BUCKET = 'candidate-resumes';
const UPDATED_BY = 'resume-intake';
const SOURCE = 'Email intake';
const MAX_FILES = 25;
const MAX_BYTES = 10_000_000;
const CONCURRENCY = 4;
const ALERT_EVERY_MS = 24 * 3600_000;

// deno-lint-ignore no-explicit-any
type Any = any;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function nanoid(len = 21): string {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < len; i++) out += a[buf[i] & 63];
  return out;
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

async function graphToken(): Promise<string> {
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET) throw new Error('Graph credentials not configured');
  const r = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: GRAPH_CLIENT_ID, client_secret: GRAPH_CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  if (!r.ok) throw new Error(`MS token (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).access_token;
}

async function graph(token: string, path: string, init: RequestInit = {}): Promise<Any> {
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Graph ${init.method || 'GET'} ${path.slice(0, 80)} (${r.status}): ${(await r.text()).slice(0, 300)}`);
  if (r.status === 202 || r.status === 204) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function graphBytes(token: string, path: string): Promise<Uint8Array> {
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Graph GET bytes (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

async function configValue(key: string): Promise<string | null> {
  const { data } = await supabase.from('resume_intake_config').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function configList(key: string, fallback: string[]): Promise<string[]> {
  try {
    const v = JSON.parse((await configValue(key)) || 'null');
    if (Array.isArray(v)) return v.map((x: string) => String(x).toLowerCase());
  } catch { /* fall through */ }
  return fallback;
}
const mailboxes = () => configList('mailboxes', ['india-resumes@simpliigence.com']);

/**
 * Email the alert list about a failure, at most once per 24 h per `key`.
 * Never throws: an alert that can't be sent must not break the job that raised it.
 */
async function alertOnce(key: string, subject: string, html: string, token?: string) {
  try {
    const stampKey = `alert_last:${key}`.slice(0, 200);
    const last = await configValue(stampKey);
    if (last && Date.now() - new Date(last).getTime() < ALERT_EVERY_MS) return;
    const to = await configList('alert_to', []);
    if (!to.length) { console.warn('[resume-intake] alert_to is empty; alert not sent:', subject); return; }
    const t = token || await graphToken();
    await graph(t, `/users/${encodeURIComponent(ALERT_FROM)}/sendMail`, {
      method: 'POST',
      body: JSON.stringify({
        message: {
          subject: `[Delivery Cockpit] ${subject}`,
          body: { contentType: 'HTML', content: `${html}<p style="color:#666">Sent by the resume email intake job. This alert repeats at most once a day until the problem clears.</p>` },
          toRecipients: to.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: false,
      }),
    });
    await supabase.from('resume_intake_config').upsert({ key: stampKey, value: new Date().toISOString() });
  } catch (e) {
    console.error('[resume-intake] alert failed:', (e as Error).message);
  }
}

const RESUME_EXT = /\.(pdf|docx?|rtf|txt)$/i;
const MIME: Record<string, string> = {
  pdf: 'application/pdf', doc: 'application/msword', rtf: 'application/rtf', txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const NOT_RESUME = /(^|[\s_\-.])(jd|job[\s_-]?desc|invoice|po|purchase[\s_-]?order|offer[\s_-]?letter|payslip|nda|msa|sow)([\s_\-.]|$)/i;

function cleanName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(0, 120) || 'resume';
}
function nameFromFile(fn: string): string {
  return fn.replace(/\.(pdf|docx?|rtf|txt)$/i, '').replace(/[._\-+]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Imported resume';
}

/**
 * Job IDs look like REQ-1042. In a subject line we also accept "REQ 1042", "req#1042"
 * and "REQ:1042"; in body text only the exact REQ-1042 form counts, so a stray
 * "req 2026" in a signature or a quoted thread can't file resumes on the wrong role.
 * Returned upper-cased, in order, de-duplicated.
 */
export function findJobCodes(text: string, strict = false): string[] {
  const out: string[] = [];
  const re = strict ? /\bREQ-(\d{4,6})\b/g : /\bREQ[\s\-#:]{0,3}(\d{4,6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || '')) !== null) {
    const code = `REQ-${m[1]}`;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

type Target = { id: string; job_code: string; title: string; account: string; status: string } | null;

/** Subject wins over body; within each, the first job ID that actually exists wins. */
async function resolveTarget(subject: string, bodyText: string): Promise<{ target: Target; tried: string[] }> {
  const tried = [...findJobCodes(subject), ...findJobCodes(bodyText, true).slice(0, 10)].filter((c, i, a) => a.indexOf(c) === i);
  for (const code of tried) {
    const { data: req } = await supabase.from('india_staffing_requisitions')
      .select('id, job_code, title, status_field, account_id').eq('job_code', code).maybeSingle();
    if (!req) continue;
    const { data: acct } = await supabase.from('india_staffing_accounts').select('name').eq('id', req.account_id).maybeSingle();
    return { target: { id: req.id, job_code: req.job_code, title: req.title || '', account: acct?.name || '', status: req.status_field || '' }, tried };
  }
  return { target: null, tried };
}

async function callParse(candidateId: string): Promise<{ ok: boolean; error?: string; body?: Any }> {
  try {
    const r = await fetch(PARSE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
      body: JSON.stringify({ candidateId }),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body?.ok) return { ok: false, error: String(body?.error || `parse-resume ${r.status}`).slice(0, 300), body };
    return { ok: true, body };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

type FileResult = {
  file: string;
  outcome: 'added' | 'updated' | 'failed';
  candidate_id?: string;
  name?: string;
  matched_on?: string;
  note?: string;
};

async function handleFile(fileName: string, bytes: Uint8Array, owner: string, intakeId: string, target: Target): Promise<FileResult> {
  const id = nanoid();
  const ext = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] || 'pdf').toLowerCase();
  const path = `${id}/${Date.now()}-${cleanName(fileName)}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: MIME[ext] || 'application/octet-stream', upsert: false });
  if (upErr) return { file: fileName, outcome: 'failed', note: `upload: ${upErr.message}` };

  const now = new Date().toISOString();
  const { error: insErr } = await supabase.from('india_staffing_candidates').insert({
    id, requisition_id: target?.id ?? null, name: nameFromFile(fileName), stage: 'Submitted', source: SOURCE,
    submit_date: target ? now.slice(0, 10) : '',
    owning_ta_email: owner, resume_url: path, resume_filename: fileName, resume_uploaded_at: now,
    created_at: now, updated_at: now, updated_by: UPDATED_BY, intake_id: intakeId,
  });
  if (insErr) return { file: fileName, outcome: 'failed', note: `insert: ${insErr.message}` };

  const parsed = await callParse(id);
  const { data: cand } = await supabase.from('india_staffing_candidates')
    .select('id, name, email, phone, linkedin_url').eq('id', id).single();
  if (!parsed.ok) {
    return { file: fileName, outcome: 'added', candidate_id: id, name: cand?.name, note: `stored, not parsed (${parsed.error})` };
  }

  const { data: dups } = await supabase.rpc('find_candidate_duplicates', {
    p_email: cand?.email || null, p_phone: cand?.phone || null, p_linkedin: cand?.linkedin_url || null, p_exclude_id: id,
  });
  const list: Any[] = dups || [];
  if (!list.length) return { file: fileName, outcome: 'added', candidate_id: id, name: cand?.name };

  // Which existing profile, if any, should absorb this resume?
  let dup: Any = null;
  let moveToTarget = false;
  if (!target) {
    dup = list[0];
  } else {
    dup = list.find((d) => d.requisition_id === target.id) || null;
    if (!dup) {
      dup = list.find((d) => !d.requisition_id) || null;
      moveToTarget = !!dup;
    }
    if (!dup) {
      return { file: fileName, outcome: 'added', candidate_id: id, name: cand?.name,
        note: `same person is already on another role (matched on ${list[0].matched_on}); added to ${target.job_code} as well` };
    }
  }

  const patch: Any = { resume_url: path, resume_filename: fileName, resume_uploaded_at: now, updated_at: now, updated_by: UPDATED_BY };
  if (moveToTarget && target) { patch.requisition_id = target.id; patch.submit_date = now.slice(0, 10); patch.intake_id = intakeId; }
  const { error: updErr } = await supabase.from('india_staffing_candidates').update(patch).eq('id', dup.id);
  if (updErr) return { file: fileName, outcome: 'added', candidate_id: id, name: cand?.name, note: `possible duplicate of ${dup.name}; update failed (${updErr.message})` };
  await supabase.from('india_staffing_candidates').delete().eq('id', id);
  await callParse(dup.id);
  return { file: fileName, outcome: 'updated', candidate_id: dup.id, name: dup.name, matched_on: dup.matched_on,
    note: moveToTarget && target ? `moved from the pool to ${target.job_code}` : undefined };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function reply(token: string, mailbox: string, messageId: string, html: string) {
  try {
    await graph(token, `/users/${encodeURIComponent(mailbox)}/messages/${messageId}/reply`, {
      method: 'POST', body: JSON.stringify({ comment: html }),
    });
  } catch (e) {
    console.warn('[resume-intake] reply failed:', (e as Error).message);
  }
}

function destinationHtml(target: Target, tried: string[]): string {
  if (target) {
    const closed = /^(closed|cancelled)/i.test(target.status) ? ` This role is ${esc(target.status)}; the profiles are still filed against it.` : '';
    return `<p>Filed against <b>${esc(target.job_code)}</b> &middot; ${esc(target.title)}${target.account ? ` (${esc(target.account)})` : ''}.${closed}</p>`;
  }
  if (tried.length) {
    return `<p><b>${tried.map(esc).join(', ')}</b> is not a job ID in the Cockpit, so these went to the <b>unassigned pool</b>. Check the ID on the requisition and forward again, or attach them to the role in the Cockpit.</p>`;
  }
  return `<p>No job ID in the subject or body, so these went to the <b>unassigned pool</b>. To file resumes against a role, put its job ID (for example REQ-1042) in the subject.</p>`;
}

function resultsHtml(results: FileResult[], skipped: string[], target: Target, tried: string[]): string {
  const label = { added: 'Added', updated: 'Updated existing', failed: 'Failed' };
  const rows = results.map((r) => `<tr><td style="padding:4px 12px 4px 0">${esc(r.file)}</td><td style="padding:4px 12px 4px 0">${label[r.outcome]}</td><td style="padding:4px 12px 4px 0">${esc(r.name || '')}</td><td style="color:#666">${esc([r.matched_on && `matched on ${r.matched_on}`, r.note].filter(Boolean).join(' · '))}</td></tr>`).join('');
  const a = results.filter((r) => r.outcome === 'added').length;
  const u = results.filter((r) => r.outcome === 'updated').length;
  const f = results.filter((r) => r.outcome === 'failed').length;
  return `${destinationHtml(target, tried)}
<p><b>${a}</b> added, <b>${u}</b> updated, <b>${f}</b> failed. New profiles are owned by you.</p>
<table style="border-collapse:collapse"><tr><th align="left">File</th><th align="left">Result</th><th align="left">Candidate</th><th align="left"></th></tr>${rows}</table>
${skipped.length ? `<p style="color:#666">Skipped (not a resume file): ${skipped.map(esc).join(', ')}</p>` : ''}`;
}

async function processMessage(mailbox: string, resource: string) {
  const token = await graphToken();
  const msg = await graph(token, `/${resource}?$select=id,conversationId,receivedDateTime,from,subject,hasAttachments,body`, {
    headers: { Prefer: 'outlook.body-content-type="text"' },
  });
  const fromEmail: string = (msg.from?.emailAddress?.address || '').toLowerCase();

  const { data: claimed, error: claimErr } = await supabase.from('resume_email_intake').insert({
    graph_message_id: msg.id, conversation_id: msg.conversationId || null, mailbox, received_at: msg.receivedDateTime,
    from_email: fromEmail, from_name: msg.from?.emailAddress?.name || '', subject: msg.subject || '',
  }).select('id').single();
  if (claimErr) return;
  const intakeId: string = claimed.id;
  const setRow = (patch: Any) => supabase.from('resume_email_intake').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', intakeId);

  try {
    const boxes = await mailboxes();
    if (!fromEmail || boxes.includes(fromEmail)) { await setRow({ status: 'ignored', error: 'self' }); return; }
    if (/^(automatic reply|auto(-| )?reply|out of office|undeliverable|delivery status)/i.test(msg.subject || '')) {
      await setRow({ status: 'ignored', error: 'auto-reply' }); return;
    }
    const { data: au } = await supabase.from('authorized_users').select('email, active')
      .ilike('email', fromEmail.replace(/[%_\\]/g, (c) => '\\' + c)).limit(1).maybeSingle();
    if (!au || au.active === false) { await setRow({ status: 'rejected', error: `sender ${fromEmail} not an active authorized user` }); return; }

    const files: Array<{ name: string; bytes: Uint8Array }> = [];
    const skipped: string[] = [];
    if (msg.hasAttachments) {
      const att = await graph(token, `/${resource}/attachments?$select=id,name,contentType,size,isInline`);
      for (const a of att?.value || []) {
        if (a['@odata.type'] !== '#microsoft.graph.fileAttachment' || a.isInline) continue;
        const name = String(a.name || '');
        if (!RESUME_EXT.test(name) || NOT_RESUME.test(name) || (a.size || 0) > MAX_BYTES) { skipped.push(name); continue; }
        if (files.length >= MAX_FILES) { skipped.push(`${name} (over ${MAX_FILES}-file limit)`); continue; }
        try {
          files.push({ name, bytes: await graphBytes(token, `/${resource}/attachments/${a.id}/$value`) });
        } catch (e) {
          skipped.push(`${name} (download failed: ${(e as Error).message})`);
        }
      }
    }

    if (files.length === 0) {
      await setRow({ status: 'no_resume', error: skipped.length ? `skipped: ${skipped.join(', ')}` : 'no attachments' });
      if (!/^\s*re\s*:/i.test(msg.subject || '')) {
        await reply(token, mailbox, msg.id, `<p>No resume found. Attach the resume as a PDF, Word (.doc/.docx), RTF or .txt file and forward again.</p>`);
      }
      return;
    }

    const { target, tried } = await resolveTarget(msg.subject || '', String(msg.body?.content || '').slice(0, 20000));
    await setRow({ files_total: files.length, job_code: target?.job_code ?? (tried[0] || null), requisition_id: target?.id ?? null });

    const results = await pool(files, CONCURRENCY, async (f) => {
      try { return await handleFile(f.name, f.bytes, au.email.toLowerCase(), intakeId, target); }
      catch (e) { return { file: f.name, outcome: 'failed', note: (e as Error).message } as FileResult; }
    });
    const added = results.filter((r) => r.outcome === 'added').length;
    const updated = results.filter((r) => r.outcome === 'updated').length;
    const failed = results.filter((r) => r.outcome === 'failed').length;
    await setRow({ status: failed ? (added + updated ? 'partial' : 'error') : 'done', added, updated, failed, results });
    await reply(token, mailbox, msg.id, resultsHtml(results, skipped, target, tried));
  } catch (e) {
    const em = (e as Error).message || String(e);
    console.error('[resume-intake]', em);
    await setRow({ status: 'error', error: em.slice(0, 1000) });
    await reply(token, mailbox, msg.id, `<p>Couldn't import these resumes automatically (${esc(em.slice(0, 200))}). Please upload them in the Cockpit.</p>`);
    await alertOnce('process', 'Resume email intake failed on a message',
      `<p>An email forwarded to ${esc(mailbox)} by ${esc(fromEmail)} could not be imported.</p><p><b>Error:</b> ${esc(em.slice(0, 500))}</p>`, token);
  }
}

async function sweep(): Promise<Any> {
  const token = await graphToken();
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  let checked = 0, processed = 0;
  const errors: string[] = [];
  for (const mailbox of await mailboxes()) {
    try {
      const list = await graph(token, `/users/${encodeURIComponent(mailbox)}/mailFolders('Inbox')/messages?$top=25&$select=id&$filter=receivedDateTime ge ${since}&$orderby=receivedDateTime desc`);
      const ids: string[] = (list?.value || []).map((m: Any) => m.id);
      checked += ids.length;
      if (!ids.length) continue;
      const { data: seen } = await supabase.from('resume_email_intake').select('graph_message_id').in('graph_message_id', ids);
      const done = new Set((seen || []).map((r: Any) => r.graph_message_id));
      for (const id of ids.filter((x) => !done.has(x))) {
        processed++;
        try { await processMessage(mailbox, `users/${mailbox}/messages/${id}`); }
        catch (e) { errors.push((e as Error).message); }
      }
    } catch (e) { errors.push(`${mailbox}: ${(e as Error).message}`); }
  }
  if (errors.length) {
    await alertOnce('sweep', 'Resume email intake cannot read the mailbox',
      `<p>The 10-minute sweep failed, so forwarded resumes are not being picked up.</p><ul>${errors.slice(0, 5).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`, token);
  }
  return { checked, processed, errors };
}

async function renew(): Promise<Any> {
  const token = await graphToken();
  const expiration = new Date(Date.now() + 70 * 3600_000).toISOString();
  const boxes = await mailboxes();
  const results: Any[] = [];
  const create = async (mailbox: string) => {
    const clientState = nanoid(32);
    const resource = `/users/${mailbox}/mailFolders('Inbox')/messages`;
    const sub = await graph(token, '/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ changeType: 'created', notificationUrl: SELF_URL, resource, expirationDateTime: expiration, clientState }),
    });
    await supabase.from('resume_intake_subscriptions').update({ active: false }).eq('mailbox', mailbox).eq('active', true);
    await supabase.from('resume_intake_subscriptions').insert({
      id: sub.id, mailbox, resource, client_state: clientState, expires_at: sub.expirationDateTime, active: true,
      last_renewed_at: new Date().toISOString(),
    });
    return { mailbox, action: 'created', id: sub.id };
  };
  const { data: active } = await supabase.from('resume_intake_subscriptions').select('id, mailbox').eq('active', true);
  for (const row of active || []) {
    if (boxes.includes(String(row.mailbox).toLowerCase())) continue;
    await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${row.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    await supabase.from('resume_intake_subscriptions').update({ active: false }).eq('id', row.id);
    results.push({ mailbox: row.mailbox, action: 'retired', id: row.id });
  }
  for (const mailbox of boxes) {
    try {
      const row = (active || []).filter((r: Any) => String(r.mailbox).toLowerCase() === mailbox).pop();
      if (!row) { results.push(await create(mailbox)); continue; }
      const r = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${row.id}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expirationDateTime: expiration }),
      });
      if (r.ok) {
        await supabase.from('resume_intake_subscriptions').update({ expires_at: expiration, last_renewed_at: new Date().toISOString() }).eq('id', row.id);
        results.push({ mailbox, action: 'renewed', id: row.id });
      } else if (r.status === 404 || r.status === 410) {
        results.push(await create(mailbox));
      } else {
        results.push({ mailbox, action: 'error', error: `renew (${r.status}): ${(await r.text()).slice(0, 300)}` });
      }
    } catch (e) {
      results.push({ mailbox, action: 'error', error: (e as Error).message });
    }
  }
  const failed = results.filter((x) => x.action === 'error');
  if (failed.length) {
    const missing = failed.some((x) => /\(404\)|invalid|not ?found/i.test(String(x.error)));
    await alertOnce('renew', missing ? 'Resume email intake is off: the mailbox does not exist' : 'Resume email intake cannot subscribe to the mailbox',
      `<p>Resumes forwarded to the intake address are not being imported.</p><ul>${failed.map((x) => `<li><b>${esc(x.mailbox)}</b>: ${esc(x.error)}</li>`).join('')}</ul>${missing ? '<p>Fix: create the shared mailbox in Microsoft 365 admin (Teams &amp; groups &rarr; Shared mailboxes). The job subscribes by itself within the hour.</p>' : ''}`, token);
  }
  return { ok: failed.length === 0, results };
}

// @ts-expect-error Deno.serve
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken !== null) return new Response(validationToken, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  if (req.method !== 'POST') return new Response('ok');

  let body: Any = {};
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  const json = (o: Any, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

  if (body.action) {
    const secret = req.headers.get('x-intake-secret');
    const cfg = await configValue('admin_secret');
    if (!secret || !cfg || secret !== cfg) return new Response('forbidden', { status: 403 });
    try {
      if (body.action === 'status') {
        const { data } = await supabase.from('resume_intake_subscriptions').select('*').order('created_at', { ascending: false });
        return json({ ok: true, subscriptions: data });
      }
      if (body.action === 'sweep') return json({ ok: true, ...(await sweep()) });
      if (body.action === 'renew') return json(await renew());
      return json({ ok: false, error: 'unknown action' }, 400);
    } catch (e) {
      const em = (e as Error).message;
      await alertOnce(`action:${body.action}`, `Resume email intake: ${body.action} failed`, `<p><b>Error:</b> ${esc(em.slice(0, 500))}</p>`);
      return json({ ok: false, error: em }, 500);
    }
  }

  const work = Promise.all((body.value || []).map(async (n: Any) => {
    try {
      const { data: sub } = await supabase.from('resume_intake_subscriptions').select('mailbox, client_state').eq('id', n.subscriptionId).maybeSingle();
      if (!sub || sub.client_state !== n.clientState) { console.warn('[resume-intake] unknown sub / clientState mismatch'); return; }
      await processMessage(sub.mailbox, n.resource);
    } catch (e) { console.error('[resume-intake] notification failed:', (e as Error).message); }
  }));
  // @ts-expect-error EdgeRuntime global
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work); else await work;
  return json({ accepted: (body.value || []).length }, 202);
});
