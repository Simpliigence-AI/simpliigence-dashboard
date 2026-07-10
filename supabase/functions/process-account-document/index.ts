/**
 * process-account-document
 *
 * Given a concierge_account_documents row, extract text (if needed) and hand
 * it to Claude to produce ai_summary + ai_topics. Idempotent — re-invoking
 * against the same row just re-summarizes.
 *
 * Input: { documentId: string }
 * Behavior:
 *   1. Load the row. If raw_text is already set, skip extraction.
 *   2. Otherwise, fetch storage_path from the concierge-docs bucket and
 *      extract text based on mime_type:
 *        - text/*, application/json, application/xml  → decode utf-8
 *        - application/pdf                            → unpdf (Deno-safe)
 *        - anything else                              → fail with clear msg
 *   3. Ask Claude for a JSON payload: { summary, stakeholders[], technologies[],
 *      initiatives[], risks[], opportunities[] }.
 *   4. Persist back to the row: ai_status='done', ai_summary, ai_topics.
 *
 * On any failure sets ai_status='failed' + ai_error so the UI can show it.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);
// @ts-expect-error esm.sh runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const CLAUDE_MODEL = 'claude-sonnet-4-5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface DocRow {
  id: string;
  account_id: string;
  kind: string;
  title: string;
  filename: string | null;
  storage_path: string | null;
  mime_type: string | null;
  raw_text: string | null;
}

async function extractText(row: DocRow, supabase: ReturnType<typeof createClient>): Promise<string> {
  if (row.raw_text && row.raw_text.trim().length > 0) return row.raw_text;
  if (!row.storage_path) throw new Error('No storage_path and no raw_text — nothing to extract.');

  const { data: blob, error } = await supabase.storage.from('concierge-docs').download(row.storage_path);
  if (error || !blob) throw new Error(`Storage download failed: ${error?.message ?? 'no data'}`);

  const mime = (row.mime_type || '').toLowerCase();
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || mime === 'application/x-ndjson') {
    return await blob.text();
  }
  if (mime === 'application/pdf') {
    // unpdf ships pdf.js pre-bundled for Deno.
    // @ts-expect-error esm.sh
    const { extractText: unpdfExtract, getDocumentProxy } = await import('https://esm.sh/unpdf@0.12.1');
    const buf = new Uint8Array(await blob.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const result = await unpdfExtract(pdf, { mergePages: true });
    return typeof result.text === 'string' ? result.text : result.text.join('\n\n');
  }
  throw new Error(`Unsupported mime type: ${mime || 'unknown'} — upload PDF, txt, or paste transcript text.`);
}

async function askClaude(title: string, kind: string, text: string): Promise<{ summary: string; topics: Record<string, unknown> }> {
  const trimmed = text.length > 40000 ? text.slice(0, 40000) + '\n\n[...truncated at 40k chars]' : text;
  const isTranscript = kind === 'meeting_transcript' || kind === 'meeting_recording';
  const prompt = `You are analyzing a ${isTranscript ? 'meeting transcript' : 'document'} for a Salesforce consulting engagement.

TITLE: ${title}
CONTENT:
${trimmed}

Produce a JSON object with EXACTLY these keys — no prose outside the JSON:
{
  "summary": "3-6 sentence overview of what this ${isTranscript ? 'meeting covered' : 'document contains'} and its relevance to our Salesforce work",
  "stakeholders": [ { "name": "...", "role": "...", "notes": "..." } ],
  "technologies": [ "specific product / cloud / tool names mentioned" ],
  "initiatives": [ { "title": "short name", "description": "what we/they are doing or planning" } ],
  "risks": [ { "title": "...", "severity": "low|medium|high", "notes": "..." } ],
  "opportunities": [ { "title": "upsell/cross-sell idea", "cloud": "e.g. Marketing Cloud", "rationale": "why this fits based on the doc", "upsell_estimate_usd": 0 } ]
}

Rules:
- Only include items actually grounded in the content. Empty arrays are fine.
- upsell_estimate_usd is a rough annual value (0 if unknown).
- Do not invent stakeholders — only pull real names from the content.
- Return ONLY the JSON object.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Claude API ${resp.status}: ${body.slice(0, 400)}`);
  }
  const json = await resp.json();
  const raw = json.content?.[0]?.text ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude did not return JSON.');
  const parsed = JSON.parse(match[0]);
  return { summary: parsed.summary ?? '', topics: parsed };
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY missing' }), { status: 500, headers: corsHeaders });

  let documentId = '';
  try {
    const body = await req.json();
    documentId = body?.documentId;
    if (!documentId) throw new Error('documentId required');
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // Mark processing so the UI shows a spinner.
  await supabase.from('concierge_account_documents').update({ ai_status: 'processing', ai_error: null }).eq('id', documentId);

  try {
    const { data, error } = await supabase
      .from('concierge_account_documents')
      .select('id, account_id, kind, title, filename, storage_path, mime_type, raw_text')
      .eq('id', documentId)
      .single();
    if (error || !data) throw new Error(`Row not found: ${error?.message ?? 'no data'}`);
    const row = data as DocRow;

    const text = await extractText(row, supabase);
    if (!text.trim()) throw new Error('Extracted text was empty.');

    const { summary, topics } = await askClaude(row.title, row.kind, text);

    await supabase
      .from('concierge_account_documents')
      .update({
        raw_text: row.raw_text ?? text.slice(0, 200000),   // cache extracted text (cap 200k)
        ai_status: 'done',
        ai_summary: summary,
        ai_topics: topics,
        ai_error: null,
        processed_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    return new Response(JSON.stringify({ ok: true, summary, topics }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await supabase.from('concierge_account_documents').update({ ai_status: 'failed', ai_error: msg }).eq('id', documentId);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: corsHeaders });
  }
});
