/**
 * Supabase Edge Function: scope-classify
 *
 * Classify one client request against the project's signed scope (the
 * scope-creep check that used to run in the Delivery Governance app).
 * Called from Project Plans → Requests when a request is logged, and again
 * from its "Re-classify" button.
 *
 * Runs as the caller: every read and the final write go through a Supabase
 * client that carries the caller's JWT, so RLS on the 'project-plans' tab
 * decides who may classify (edit) and what they can see.
 *
 * Evidence given to Claude, strongest first:
 *   1. delivery_projects.frozen_requirements / frozen_exclusions (contract)
 *   2. Frozen SOW documents (PDF or text) from the 'delivery-documents'
 *      bucket, attached as documents — best effort, skipped on error
 *   3. Heatmap features and plan task names (what the team is building)
 *
 * Required secrets:
 *   ANTHROPIC_API_KEY
 *
 * Request body:  { requestId: string }
 * Response:      { ok: true, request: <delivery_requests row> } | { error, detail? }
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

const CLAUDE_MODEL = 'claude-sonnet-4-5';
const MAX_SOW_DOCS = 2;
const MAX_DOC_BYTES = 8 * 1024 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });

const SYSTEM = `You are the scope-control reviewer for Simpliigence, a Salesforce and AI consulting firm running fixed-scope client projects.

A client has asked for something mid-project. Decide whether it is already in the signed scope.

Verdicts
- green: clearly covered by a frozen requirement (or a normal, small part of delivering one). The team absorbs it.
- amber: unclear. It partly matches, straddles a boundary, is too vague to size, or there is no scope baseline to judge against. The PM must clarify with the client or architect.
- red: not covered, or explicitly excluded. It needs a change request before any work starts.

Rules
- Only the frozen requirements, frozen exclusions and the attached SOW documents are contractual. Features and plan tasks show what the team is building; treat them as supporting evidence, never as proof something was sold.
- An explicit exclusion that matches makes it red, whatever else matches.
- Verbal promises, emails and "we assumed" do not change scope. Say so if the request leans on one.
- If there are no frozen requirements, no exclusions and no SOW document, the verdict is amber unless the request is plainly a new module or integration (then red). Say the baseline is missing.
- Estimate effort for work that is not in scope (amber or red) as a Salesforce delivery team would: impact_hours for build + test, impact_days as calendar delay to the plan. For green, both are 0.
- matched: quote or closely paraphrase the requirement/exclusion that decided it, or say why nothing matched. One sentence.
- detail: 2–4 sentences a PM can paste to the client. Plain English, no jargon, no hedging filler.

Call the record_verdict tool exactly once.`;

const TOOL = {
  name: 'record_verdict',
  description: 'Record the scope verdict for this client request.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['green', 'amber', 'red'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      matched: { type: 'string' },
      detail: { type: 'string' },
      impact_hours: { type: 'integer', minimum: 0 },
      impact_days: { type: 'integer', minimum: 0 },
    },
    required: ['verdict', 'confidence', 'matched', 'detail', 'impact_hours', 'impact_days'],
  },
};

const STATE_FOR: Record<string, string> = { green: 'applied', amber: 'awaiting-clarification', red: 'open' };

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Frozen SOW documents as Claude document blocks. PDFs and text only
 *  (Word/PowerPoint can't be read here — freeze a PDF of the signed SOW).
 *  Never throws. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sowBlocks(db: any, docs: any[]): Promise<{ blocks: unknown[]; used: string[]; note: string | null }> {
  const readable = (n: string) => /\.(pdf|md|txt)$/i.test(n);
  const usable = docs.filter((d) => d.storage_path && readable(String(d.name))).slice(0, MAX_SOW_DOCS);
  const skipped = docs.filter((d) => d.storage_path && !readable(String(d.name))).map((d) => d.name);
  const blocks: unknown[] = [];
  const used: string[] = [];
  const failed: string[] = [];
  for (const d of usable) {
    try {
      const { data, error } = await db.storage.from('delivery-documents').download(d.storage_path);
      if (error || !data) throw new Error(error?.message ?? 'no data');
      if (data.size > MAX_DOC_BYTES) throw new Error('too large');
      if (/\.pdf$/i.test(d.name)) {
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: toBase64(await data.arrayBuffer()) },
          title: d.name,
        });
      } else {
        blocks.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: await data.text() }, title: d.name });
      }
      used.push(d.name);
    } catch {
      failed.push(d.name);
    }
  }
  const notes = [
    failed.length ? `Could not read: ${failed.join(', ')}.` : '',
    !used.length && skipped.length ? `Frozen SOW is not a PDF (${skipped.join(', ')}), so only the requirement list was used.` : '',
  ].filter(Boolean);
  return { blocks, used, note: notes.length ? notes.join(' ') : null };
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter((s) => s.trim()) : []);
const bullets = (xs: string[]) => (xs.length ? xs.map((x, i) => `${i + 1}. ${x}`).join('\n') : '(none)');

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply({ error: 'POST only' }, 405);

  try {
    if (!ANTHROPIC_API_KEY) return reply({ error: 'ANTHROPIC_API_KEY secret is not set on this Supabase project' }, 500);
    const auth = req.headers.get('Authorization');
    if (!auth) return reply({ error: 'Sign in required' }, 401);

    const { requestId } = (await req.json()) as { requestId?: string };
    if (!requestId) return reply({ error: 'requestId is required' }, 400);

    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: auth } } });

    const { data: r, error: rErr } = await db.from('delivery_requests').select('*').eq('id', requestId).maybeSingle();
    if (rErr || !r) return reply({ error: 'Request not found or no access', detail: rErr?.message }, 404);

    const [p, f, t, d] = await Promise.all([
      db.from('delivery_projects').select('name, client, frozen_requirements, frozen_exclusions').eq('id', r.project_id).single(),
      db.from('delivery_features').select('name, description').eq('project_id', r.project_id).order('order_index'),
      db.from('delivery_tasks').select('name, phase').eq('project_id', r.project_id).order('sort_order'),
      db.from('delivery_documents').select('name, storage_path, modified_at')
        .eq('project_id', r.project_id).eq('state', 'frozen').ilike('doc_type', 'sow%')
        .order('modified_at', { ascending: false }),
    ]);
    if (p.error || !p.data) return reply({ error: 'Project not found', detail: p.error?.message }, 404);

    const reqs = list(p.data.frozen_requirements);
    const excl = list(p.data.frozen_exclusions);
    const features = (f.data ?? []).map((x: { name: string; description?: string }) => (x.description ? `${x.name} — ${x.description}` : x.name));
    const tasks = (t.data ?? []).map((x: { name: string; phase?: string }) => (x.phase ? `[${x.phase}] ${x.name}` : x.name));
    const sow = await sowBlocks(db, d.data ?? []);

    const brief = [
      `Project: ${p.data.name}${p.data.client ? ` (client: ${p.data.client})` : ''}`,
      '',
      `Frozen requirements (contractual):\n${bullets(reqs)}`,
      '',
      `Frozen exclusions (contractual):\n${bullets(excl)}`,
      '',
      `SOW documents attached: ${sow.used.length ? sow.used.join(', ') : 'none'}`,
      '',
      `Heatmap features (supporting only):\n${bullets(features.slice(0, 80))}`,
      '',
      `Plan tasks (supporting only):\n${bullets(tasks.slice(0, 120))}`,
      '',
      '---',
      `Client request${r.requester ? ` from ${r.requester}` : ''}${r.source ? ` via ${r.source}` : ''}:`,
      r.text,
    ].join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content: [...sow.blocks, { type: 'text', text: brief }] }],
      }),
    });
    if (!res.ok) return reply({ error: 'Claude API failed', detail: (await res.text()).slice(0, 500) }, 502);
    const out = (await res.json()) as { content?: Array<{ type: string; input?: Record<string, unknown> }> };
    const v = out.content?.find((b) => b.type === 'tool_use')?.input;
    if (!v || !['green', 'amber', 'red'].includes(String(v.verdict))) return reply({ error: 'Claude returned no verdict' }, 502);

    const verdict = String(v.verdict);
    const detail = [String(v.detail ?? '').trim(), sow.note].filter(Boolean).join(' ');
    const patch: Record<string, unknown> = {
      verdict,
      confidence: Math.max(0, Math.min(1, Number(v.confidence) || 0)),
      matched: String(v.matched ?? '').trim() || null,
      detail: detail || null,
      impact_hours: verdict === 'green' ? 0 : Math.max(0, Math.round(Number(v.impact_hours) || 0)),
      impact_days: verdict === 'green' ? 0 : Math.max(0, Math.round(Number(v.impact_days) || 0)),
      classifier: 'claude',
      // Re-classifying resets any earlier override.
      original_verdict: null,
      appeal_state: 'none',
      appeal_resolution: null,
      appeal_resolved_by: null,
    };
    // Don't move a request the PM has already acted on.
    if (!r.cr_id && ['open', 'awaiting-clarification', 'applied'].includes(r.state)) patch.state = STATE_FOR[verdict];

    const { data: saved, error: uErr } = await db.from('delivery_requests').update(patch).eq('id', requestId).select().single();
    if (uErr || !saved) return reply({ error: 'Could not save the verdict — you may only have view access.', detail: uErr?.message }, 403);
    return reply({ ok: true, request: saved });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[scope-classify]', msg);
    return reply({ error: msg }, 500);
  }
});
