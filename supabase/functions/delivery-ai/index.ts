/**
 * Supabase Edge Function: delivery-ai
 *
 * The AI helpers Governance had, for Project Plans. One function, several
 * actions. Runs as the caller: reads and writes go through a Supabase client
 * that carries the caller's JWT, so RLS on the 'project-plans' tab applies.
 *
 * Actions (body.action):
 *   sow-parse      { projectId, documentId }  → scope, plan and heatmap proposal from a SOW (preview only)
 *   heatmap        { projectId }              → feature list from the scope (preview only)
 *   draft-cr       { requestId }              → change-request title, description, impact
 *   decline-reply  { requestId }              → email to the client explaining it's out of scope
 *   checkin-draft  { projectId }              → this week's check-in text from the last 7 days
 *   summary        { projectId }              → health (green/amber/red) + exec summary, saved on the project
 *   generate-doc   { projectId, kind, instructions? } → user stories / test cases / process flows /
 *                                                status report as Markdown, saved to Documents
 *
 * Required secret: ANTHROPIC_API_KEY
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno runtime
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = env('SUPABASE_ANON_KEY')!;
const MODEL = 'claude-sonnet-4-5';
const BUCKET = 'delivery-documents';
const MAX_DOC_BYTES = 20 * 1024 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
class UserError extends Error { constructor(m: string, public status = 400) { super(m); } }

const HOUSE = `You work for Simpliigence, a Salesforce and AI consulting firm that runs fixed-scope client implementations (Sales Cloud, Service Cloud, CPQ, Experience Cloud, integrations, data migration, AI agents). Write in plain, direct business English. No filler, no hype, no emojis.`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter((s) => s.trim()) : []);
const bullets = (xs: string[], max = 200) => (xs.length ? xs.slice(0, max).map((x, i) => `${i + 1}. ${x}`).join('\n') : '(none)');
const today = () => new Date().toISOString().slice(0, 10);

async function claude(opts: {
  system: string; content: unknown[]; maxTokens?: number;
  tool?: { name: string; description: string; input_schema: unknown };
}): Promise<{ text: string; input: Row | null }> {
  if (!ANTHROPIC_API_KEY) throw new UserError('ANTHROPIC_API_KEY secret is not set on this Supabase project', 500);
  const body: Row = {
    model: MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    system: [{ type: 'text', text: `${HOUSE}\n\n${opts.system}`, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: opts.content }],
  };
  if (opts.tool) { body.tools = [opts.tool]; body.tool_choice = { type: 'tool', name: opts.tool.name }; }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new UserError(`Claude API failed: ${(await r.text()).slice(0, 300)}`, 502);
  const j = (await r.json()) as { content?: Array<{ type: string; text?: string; input?: Row }> };
  const text = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
  const input = (j.content ?? []).find((b) => b.type === 'tool_use')?.input ?? null;
  return { text, input };
}

/** Everything about a project an AI prompt might need, as one text block. */
async function projectContext(db: Db, projectId: string, opts: { audit?: boolean } = {}): Promise<{ project: Row; text: string }> {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [p, t, f, i, q, c, a] = await Promise.all([
    db.from('delivery_projects').select('*').eq('id', projectId).maybeSingle(),
    db.from('delivery_tasks').select('name, phase, start_date, end_date, percent, status, assignee').eq('project_id', projectId).order('sort_order'),
    db.from('delivery_features').select('name, description, completion_state, demo_state').eq('project_id', projectId).order('order_index'),
    db.from('delivery_issues').select('description, owner, due_date, criticality, state').eq('project_id', projectId),
    db.from('delivery_requests').select('text, verdict, state, impact_hours, received_at').eq('project_id', projectId).order('received_at', { ascending: false }).limit(30),
    db.from('delivery_change_requests').select('title, state, impact_days, impact_hours, created_at').eq('project_id', projectId),
    opts.audit
      ? db.from('delivery_audit').select('at, actor, action, payload').eq('project_id', projectId).gte('at', since).order('at').limit(300)
      : Promise.resolve({ data: [] }),
  ]);
  if (p.error || !p.data) throw new UserError('Project not found or no access', 404);
  const prj = p.data as Row;
  const late = (x: Row) => x.status !== 'done' && (x.percent ?? 0) < 100 && x.end_date && x.end_date < today();
  const tasks = (t.data ?? []) as Row[];
  const lines = [
    `Project: ${prj.name}${prj.client ? ` — client ${prj.client}` : ''}. Status ${prj.status}. Start ${prj.start_date ?? '?'}, end ${prj.current_end ?? prj.planned_end ?? '?'}${prj.planned_end && prj.current_end && prj.planned_end !== prj.current_end ? ` (baseline ${prj.planned_end})` : ''}. Today ${today()}.`,
    `Team: PM ${prj.pm ?? '—'}, delivery lead ${prj.delivery_lead ?? '—'}, architect ${prj.architect ?? '—'}, client sponsor ${prj.sponsor ?? '—'}.`,
    '',
    `In scope:\n${bullets(list(prj.frozen_requirements))}`,
    `Excluded:\n${bullets(list(prj.frozen_exclusions))}`,
    '',
    `Plan (${tasks.length} tasks; ${tasks.filter((x) => x.status === 'done' || (x.percent ?? 0) >= 100).length} done; ${tasks.filter(late).length} late):`,
    ...tasks.slice(0, 150).map((x) => `- [${x.phase ?? 'Unphased'}] ${x.name}: ${x.start_date ?? '?'} → ${x.end_date ?? '?'}, ${x.percent ?? 0}%${late(x) ? ' LATE' : ''}${x.assignee ? `, ${x.assignee}` : ''}`),
    '',
    `Features (heatmap):`,
    ...((f.data ?? []) as Row[]).map((x) => `- ${x.name}: ${x.completion_state}, ${x.demo_state}`),
    '',
    `Open issues:`,
    ...((i.data ?? []) as Row[]).filter((x) => x.state === 'open').map((x) => `- [${x.criticality}] ${x.description}${x.owner ? ` (owner ${x.owner})` : ''}${x.due_date ? `, due ${x.due_date}` : ''}`),
    '',
    `Client requests (latest first):`,
    ...((q.data ?? []) as Row[]).map((x) => `- ${String(x.received_at).slice(0, 10)} [${x.verdict ?? 'unchecked'} / ${x.state}] ${String(x.text).slice(0, 200)}`),
    '',
    `Change requests:`,
    ...((c.data ?? []) as Row[]).map((x) => `- ${x.title}: ${x.state}${x.impact_days ? `, +${x.impact_days} days` : ''}${x.impact_hours ? `, ${x.impact_hours} hrs` : ''}`),
  ];
  if (opts.audit) {
    lines.push('', 'Changes in the last 7 days (audit log):',
      ...((a.data ?? []) as Row[]).map((x) => `- ${String(x.at).slice(0, 16)} ${x.actor}: ${x.action} ${x.payload?.label ?? ''}${x.payload?.fields ? ` (${x.payload.fields.join(', ')})` : ''}`));
  }
  return { project: prj, text: lines.join('\n') };
}

async function docBlock(db: Db, doc: Row): Promise<unknown> {
  if (!doc.storage_path) throw new UserError('That file is still being copied over. Try again in a few minutes.');
  const name = String(doc.name).toLowerCase();
  const { data, error } = await db.storage.from(BUCKET).download(doc.storage_path);
  if (error || !data) throw new UserError(`Could not read ${doc.name}: ${error?.message ?? 'no data'}`);
  if (data.size > MAX_DOC_BYTES) throw new UserError(`${doc.name} is too large to read (over 20 MB).`);
  if (name.endsWith('.pdf')) {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: toBase64(await data.arrayBuffer()) }, title: doc.name };
  }
  if (/\.(md|txt|csv)$/.test(name)) {
    return { type: 'document', source: { type: 'text', media_type: 'text/plain', data: await data.text() }, title: doc.name };
  }
  throw new UserError('Upload the SOW as a PDF — Word and PowerPoint files can’t be read directly. In Word: File → Save As → PDF.');
}

// ── Actions ─────────────────────────────────────────────────────────────

async function sowParse(db: Db, b: Row) {
  const { data: doc } = await db.from('delivery_documents').select('*').eq('id', b.documentId).maybeSingle();
  if (!doc || doc.project_id !== b.projectId) throw new UserError('Document not found on this project.', 404);
  const block = await docBlock(db, doc);
  const { input } = await claude({
    maxTokens: 8000,
    system: `Read the attached Statement of Work and extract what a delivery team needs to run the project.
- requirements: every deliverable or capability that is in scope, one per item, specific enough to judge a client request against ("Up to 50 custom reports covering pipeline, forecast and revenue", not "Reporting"). Keep the SOW's numbers and limits.
- exclusions: everything explicitly out of scope, deferred, or the client's responsibility.
- phases: the delivery plan as ordered phases, each with tasks. start_week is weeks from project start (0 = first week); duration_weeks at least 1. If the SOW gives a timeline, follow it; otherwise propose a realistic Salesforce delivery plan (discovery, design, build sprints, testing/UAT, training, go-live, hypercare) sized to the scope.
- features: 8–25 client-visible features or modules for a build/demo heatmap.
- milestones: named dates or weeks the SOW commits to (go-live, UAT start), if any.
Call record_sow once.`,
    content: [block, { type: 'text', text: 'Extract the scope, plan and features from this SOW.' }],
    tool: {
      name: 'record_sow',
      description: 'Record what the SOW contains.',
      input_schema: {
        type: 'object',
        properties: {
          requirements: { type: 'array', items: { type: 'string' } },
          exclusions: { type: 'array', items: { type: 'string' } },
          phases: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                tasks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { name: { type: 'string' }, start_week: { type: 'integer', minimum: 0 }, duration_weeks: { type: 'integer', minimum: 1 } },
                    required: ['name', 'start_week', 'duration_weeks'],
                  },
                },
              },
              required: ['name', 'tasks'],
            },
          },
          features: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] } },
          milestones: { type: 'array', items: { type: 'string' } },
          total_weeks: { type: 'integer' },
        },
        required: ['requirements', 'exclusions', 'phases', 'features'],
      },
    },
  });
  if (!input) throw new UserError('Claude did not return a result. Try again.', 502);
  return { proposal: input, document: doc.name };
}

async function heatmap(db: Db, b: Row) {
  const { text } = await projectContext(db, b.projectId);
  const { input } = await claude({
    maxTokens: 3000,
    system: 'From the project scope and plan, list 8–25 client-visible features or modules for a build/demo heatmap. Group related requirements; skip project-management items (status reports, steering meetings). Call record_features once.',
    content: [{ type: 'text', text }],
    tool: {
      name: 'record_features', description: 'Record heatmap features.',
      input_schema: { type: 'object', properties: { features: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] } } }, required: ['features'] },
    },
  });
  return { features: input?.features ?? [] };
}

async function loadRequest(db: Db, id: string): Promise<Row> {
  const { data } = await db.from('delivery_requests').select('*').eq('id', id).maybeSingle();
  if (!data) throw new UserError('Request not found or no access', 404);
  return data;
}

async function draftCr(db: Db, b: Row) {
  const r = await loadRequest(db, b.requestId);
  const { text } = await projectContext(db, r.project_id);
  const { input } = await claude({
    maxTokens: 2000,
    system: `Draft a change request for the client request below. It goes to the client sponsor for approval, so write it for them.
- title: short, specific (max 80 chars).
- description: what will be delivered, assumptions, what is not included, and dependencies. 4–10 short lines, plain text with "- " bullets allowed.
- impact_hours: build + test effort. impact_days: calendar delay to the plan.
- milestone_shift: one sentence on what moves (e.g. "Go-live moves from 14 Nov to 28 Nov").
Use the scope review below if present. Call record_cr once.`,
    content: [{ type: 'text', text: `${text}\n\n---\nClient request${r.requester ? ` from ${r.requester}` : ''} (${String(r.received_at).slice(0, 10)}):\n${r.text}\n\nScope review: ${r.verdict ?? 'not checked'}. ${r.matched ?? ''} ${r.detail ?? ''}\nEarlier estimate: ${r.impact_hours ?? '?'} hrs, +${r.impact_days ?? '?'} days.` }],
    tool: {
      name: 'record_cr', description: 'Record the change request draft.',
      input_schema: {
        type: 'object',
        properties: { title: { type: 'string' }, description: { type: 'string' }, impact_hours: { type: 'integer', minimum: 0 }, impact_days: { type: 'integer', minimum: 0 }, milestone_shift: { type: 'string' } },
        required: ['title', 'description', 'impact_hours', 'impact_days', 'milestone_shift'],
      },
    },
  });
  if (!input) throw new UserError('Claude did not return a draft. Try again.', 502);
  return { draft: input };
}

async function declineReply(db: Db, b: Row) {
  const r = await loadRequest(db, b.requestId);
  const { text } = await projectContext(db, r.project_id);
  const { input } = await claude({
    maxTokens: 1500,
    system: `Write a short email from the Simpliigence project manager to the client replying to the request below. Be warm and firm: acknowledge the ask, say plainly that it sits outside the signed scope (cite the scope item or exclusion), and offer the route forward — a change request with an estimate, or parking it for a later phase. If the verdict is "amber", ask the specific clarifying questions instead of declining. Address the requester by first name if known. No sign-off or signature (Outlook adds it). 90–160 words. Call record_email once.`,
    content: [{ type: 'text', text: `${text}\n\n---\nClient request${r.requester ? ` from ${r.requester}` : ''}:\n${r.text}\n\nScope review: ${r.verdict ?? 'not checked'}. Matched: ${r.matched ?? '—'}. ${r.detail ?? ''}\nEstimate: ${r.impact_hours ?? '?'} hrs, +${r.impact_days ?? '?'} days.` }],
    tool: {
      name: 'record_email', description: 'Record the email.',
      input_schema: { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'] },
    },
  });
  if (!input) throw new UserError('Claude did not return a draft. Try again.', 502);
  return { email: input };
}

async function checkinDraft(db: Db, b: Row) {
  const { text } = await projectContext(db, b.projectId, { audit: true });
  const { input } = await claude({
    maxTokens: 2000,
    system: `Draft this week's status check-in for the PM to review. Use only facts in the context — plan progress, tasks completed or moved, heatmap changes, issues, client requests and change requests, and the last 7 days of the audit log. Each field is 2–6 short "- " bullet lines; write "- Nothing this week" if there is genuinely nothing. Fields: activities_build (configuration/development), activities_testing (QA/UAT), activities_demos (demos and client sessions), activities_pm (governance, risks, decisions, CRs), upcoming_focus (next week). Call record_checkin once.`,
    content: [{ type: 'text', text }],
    tool: {
      name: 'record_checkin', description: 'Record the check-in draft.',
      input_schema: {
        type: 'object',
        properties: { activities_build: { type: 'string' }, activities_testing: { type: 'string' }, activities_demos: { type: 'string' }, activities_pm: { type: 'string' }, upcoming_focus: { type: 'string' } },
        required: ['activities_build', 'activities_testing', 'activities_demos', 'activities_pm', 'upcoming_focus'],
      },
    },
  });
  if (!input) throw new UserError('Claude did not return a draft. Try again.', 502);
  return { draft: input };
}

async function summary(db: Db, b: Row) {
  const { text } = await projectContext(db, b.projectId, { audit: true });
  const { input } = await claude({
    maxTokens: 1500,
    system: `Write an executive summary of this project for the Simpliigence leadership team.
- health: green (on track), amber (at risk — slipping, open high issues or unresolved scope), red (off track — late milestones, critical issues, or disputed scope).
- summary: 4–7 short Markdown lines: where it stands, what moved this week, top risks with owners, scope/CR position with hours, and the one decision needed (if any). Be specific; use dates and numbers.
Call record_summary once.`,
    content: [{ type: 'text', text }],
    tool: {
      name: 'record_summary', description: 'Record the summary.',
      input_schema: { type: 'object', properties: { health: { type: 'string', enum: ['green', 'amber', 'red'] }, summary: { type: 'string' } }, required: ['health', 'summary'] },
    },
  });
  if (!input) throw new UserError('Claude did not return a summary. Try again.', 502);
  const { data, error } = await db.from('delivery_projects')
    .update({ summary: input.summary, health: input.health, summary_at: new Date().toISOString() })
    .eq('id', b.projectId).select().single();
  if (error || !data) throw new UserError('Could not save the summary — you may only have view access.', 403);
  return { project: data };
}

const DOC_KINDS: Record<string, { label: string; docType: string; prompt: string }> = {
  user_stories: {
    label: 'User Stories', docType: 'User Stories',
    prompt: 'Write Salesforce user stories covering every in-scope requirement. Group by epic (## heading per epic). Each story: ### ID and title, "As a <role>, I want … so that …", acceptance criteria as a Given/When/Then bullet list, and Salesforce notes (objects, automation, security). Number stories US-001, US-002…',
  },
  test_cases: {
    label: 'Test Cases', docType: 'Test Cases',
    prompt: 'Write UAT test cases covering every in-scope requirement and the main negative paths. Group by feature (## heading). Use a Markdown table per group with columns: ID (TC-001…), Scenario, Preconditions, Steps, Expected result, Requirement.',
  },
  process_flows: {
    label: 'Process Flows', docType: 'Process Flows',
    prompt: 'Document the to-be business processes the scope implies. For each process: ## name, purpose, actors, trigger, numbered steps showing who does what in Salesforce, decision points, automation, and a Mermaid flowchart in a ```mermaid block.',
  },
  status_report: {
    label: 'Status Report', docType: 'Status Report',
    prompt: 'Write this week\'s client-facing status report: overall RAG with one-line reason, progress this week, next week, milestones table (milestone, planned, forecast, status), risks and issues table (item, impact, owner, due), scope and change requests, decisions needed from the client. Use facts from the context only.',
  },
};

async function generateDoc(db: Db, b: Row, email: string | null) {
  const kind = DOC_KINDS[b.kind];
  if (!kind) throw new UserError(`Unknown document type "${b.kind}".`);
  const { project, text } = await projectContext(db, b.projectId, { audit: b.kind === 'status_report' });
  const { data: prev } = await db.from('delivery_documents').select('id, version, storage_path')
    .eq('project_id', b.projectId).eq('generator', b.kind).order('created_at', { ascending: false }).limit(1);
  // Regenerating: give Claude the previous version and the reviewers' open comments.
  let revision = '';
  let feedbackIds: string[] = [];
  if (prev?.[0]) {
    const [{ data: fb }, file] = await Promise.all([
      db.from('delivery_document_feedback').select('id, body, author').eq('document_id', prev[0].id).eq('state', 'open'),
      prev[0].storage_path && /\.(md|txt)$/i.test(prev[0].storage_path) ? db.storage.from(BUCKET).download(prev[0].storage_path) : Promise.resolve({ data: null }),
    ]);
    feedbackIds = (fb ?? []).map((f: Row) => f.id);
    const prevText = file?.data ? (await file.data.text()).slice(0, 60000) : '';
    if (prevText) revision += `\n\nPrevious version (${prev[0].version}) — revise it rather than starting over:\n<<<\n${prevText}\n>>>`;
    if (fb?.length) revision += `\n\nReviewer comments to apply in this version (every one must be addressed):\n${fb.map((f: Row) => `- ${f.body}${f.author ? ` (${f.author})` : ''}`).join('\n')}`;
  }
  const { text: md } = await claude({
    maxTokens: 8000,
    system: `${kind.prompt}\nOutput only the Markdown document, starting with a # title line. No preamble. Stay under about 4,500 words — group or summarise rather than stop mid-document.`,
    content: [{ type: 'text', text: `${text}${b.instructions ? `\n\nExtra instructions from the PM:\n${b.instructions}` : ''}${revision}` }],
  });
  if (!md) throw new UserError('Claude returned an empty document. Try again.', 502);

  const lastV = prev?.[0]?.version ? parseInt(String(prev[0].version).replace(/\D/g, ''), 10) || 0 : 0;
  const version = `v${lastV + 1}`;
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const stamp = b.kind === 'status_report' ? ` — w/e ${today()}` : '';
  const name = `${kind.label} ${version} — ${project.name}${stamp}.md`;
  const path = `${b.projectId}/${id}/${kind.label.replace(/\s+/g, '_')}_${version}.md`;
  const bytes = new TextEncoder().encode(md);
  const up = await db.storage.from(BUCKET).upload(path, new Blob([bytes], { type: 'text/markdown' }), { contentType: 'text/markdown', upsert: false });
  if (up.error) throw new UserError(`Could not save the document: ${up.error.message}`, 403);
  const { data: doc, error } = await db.from('delivery_documents').insert({
    id, project_id: b.projectId, name, doc_type: kind.docType, source: 'generated', generator: b.kind, version, state: 'draft',
    storage_path: path, mime_type: 'text/markdown', size_bytes: bytes.length, modified_at: new Date().toISOString(),
    supersedes_id: prev?.[0]?.id ?? null, added_by: email,
  }).select().single();
  if (error || !doc) {
    await db.storage.from(BUCKET).remove([path]);
    throw new UserError('Could not save the document — you may only have view access.', 403);
  }
  if (feedbackIds.length) {
    await db.from('delivery_document_feedback').update({ state: 'resolved' }).in('id', feedbackIds);
  }
  return { document: doc, addressed: feedbackIds.length };
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);
  try {
    const auth = req.headers.get('Authorization');
    if (!auth) return reply({ error: 'Sign in required' }, 401);
    const b = (await req.json().catch(() => ({}))) as Row;
    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: u } = await db.auth.getUser();
    const email = u?.user?.email ?? null;

    let out: unknown;
    switch (b.action) {
      case 'sow-parse': out = await sowParse(db, b); break;
      case 'heatmap': out = await heatmap(db, b); break;
      case 'draft-cr': out = await draftCr(db, b); break;
      case 'decline-reply': out = await declineReply(db, b); break;
      case 'checkin-draft': out = await checkinDraft(db, b); break;
      case 'summary': out = await summary(db, b); break;
      case 'generate-doc': out = await generateDoc(db, b, email); break;
      default: throw new UserError(`Unknown action "${b.action}".`);
    }
    return reply({ ok: true, ...(out as Row) });
  } catch (e) {
    const status = e instanceof UserError ? e.status : 500;
    const msg = (e as Error).message || String(e);
    console.error('[delivery-ai]', msg);
    return reply({ error: msg }, status);
  }
});
