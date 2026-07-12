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

/** Sentinel value returned when the file is stored but has no text to
 *  summarize (audio/video). The caller treats this as a soft-success. */
const NO_TEXT_AVAILABLE = '__NO_TEXT_AVAILABLE__';

function isAudioOrVideo(mime: string, filename: string): boolean {
  if (mime.startsWith('audio/') || mime.startsWith('video/')) return true;
  const lower = filename.toLowerCase();
  return /\.(mp3|mp4|m4a|wav|mov|webm|mkv|avi|aac|flac|ogg|opus)$/.test(lower);
}
function isDocx(mime: string, filename: string): boolean {
  return mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || filename.toLowerCase().endsWith('.docx');
}
function isXlsx(mime: string, filename: string): boolean {
  return mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || filename.toLowerCase().endsWith('.xlsx')
      || filename.toLowerCase().endsWith('.xlsm');
}
function isCsv(mime: string, filename: string): boolean {
  return mime === 'text/csv' || filename.toLowerCase().endsWith('.csv');
}
function isPptx(mime: string, filename: string): boolean {
  return mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      || filename.toLowerCase().endsWith('.pptx');
}

async function extractText(row: DocRow, supabase: ReturnType<typeof createClient>): Promise<string> {
  if (row.raw_text && row.raw_text.trim().length > 0) return row.raw_text;
  if (!row.storage_path) throw new Error('No storage_path and no raw_text — nothing to extract.');

  const { data: blob, error } = await supabase.storage.from('concierge-docs').download(row.storage_path);
  if (error || !blob) throw new Error(`Storage download failed: ${error?.message ?? 'no data'}`);

  const mime = (row.mime_type || '').toLowerCase();
  const fname = row.filename || '';

  // Plain text formats
  if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || mime === 'application/x-ndjson' || isCsv(mime, fname)) {
    return await blob.text();
  }

  // PDF via unpdf (pdf.js pre-bundled for Deno)
  if (mime === 'application/pdf' || fname.toLowerCase().endsWith('.pdf')) {
    // @ts-expect-error esm.sh
    const { extractText: unpdfExtract, getDocumentProxy } = await import('https://esm.sh/unpdf@0.12.1');
    const buf = new Uint8Array(await blob.arrayBuffer());
    const pdf = await getDocumentProxy(buf);
    const result = await unpdfExtract(pdf, { mergePages: true });
    return typeof result.text === 'string' ? result.text : result.text.join('\n\n');
  }

  // DOCX via mammoth
  if (isDocx(mime, fname)) {
    // @ts-expect-error esm.sh
    const mammoth = (await import('https://esm.sh/mammoth@1.8.0?bundle')).default;
    const buf = await blob.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    return (result?.value ?? '').toString();
  }

  // XLSX via SheetJS — flatten every sheet to CSV so the summary can reason over content
  if (isXlsx(mime, fname)) {
    // @ts-expect-error esm.sh
    const XLSX = await import('https://esm.sh/xlsx@0.18.5');
    const buf = new Uint8Array(await blob.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'array' });
    const parts: string[] = [];
    for (const sheetName of wb.SheetNames as string[]) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) parts.push(`## Sheet: ${sheetName}\n${csv}`);
    }
    return parts.join('\n\n');
  }

  // PPTX — extract slide text using a lightweight ZIP walk (jszip)
  if (isPptx(mime, fname)) {
    // @ts-expect-error esm.sh
    const JSZip = (await import('https://esm.sh/jszip@3.10.1')).default;
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const slideFiles = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort();
    const parts: string[] = [];
    for (const name of slideFiles) {
      const xml = await zip.files[name].async('string');
      const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) parts.push(text);
    }
    return parts.join('\n\n');
  }

  // Audio / video — store raw, don't fail. Transcription is deferred until we wire a provider.
  if (isAudioOrVideo(mime, fname)) {
    return NO_TEXT_AVAILABLE;
  }

  throw new Error(`Unsupported file type: ${mime || fname} — supported: PDF, DOCX, XLSX, PPTX, CSV, TXT. For audio/video, paste a transcript.`);
}

/** Simpliigence's full delivery portfolio. The AI is told to look for
 *  opportunities across ALL of these, not just Salesforce, so a document
 *  that mentions e.g. a stuck manual invoicing process can surface as an
 *  RPA opportunity even if the account is primarily a Salesforce customer. */
const SIMPLIIGENCE_SERVICES = `
Simpliigence delivers ALL of the following. Look for upsell/cross-sell across every service area:

- Salesforce Consulting — Sales Cloud, Service Cloud, Marketing Cloud, Data Cloud, Commerce Cloud, Experience Cloud, Field Service, Health Cloud, Revenue Cloud (CPQ), MuleSoft, Einstein / Agentforce, CRM Analytics / Tableau, OmniStudio, Platform / custom Apex
- AI & Automation — AI business assistants (chatbots, copilots, in-app agents), custom AI integrations (LLM APIs, RAG, agentic workflows), intelligent document processing, prompt engineering
- Robotic Process Automation (RPA) — automating repetitive manual back-office work (data entry, reconciliations, ticket triage, invoicing, report generation), workflow automation across systems
- Custom Application Development — full-stack web apps, custom internal tools / portals, SaaS product engineering, backend microservices, API development, system integrations
- Mobile — iOS / Android native, React Native / cross-platform, mobile UX/UI redesign
- Website & Digital — website design, website development, hosting & website maintenance, SEO / SEM, marketing automation, email campaign management, analytics & tracking
- Data & Analytics — data engineering, data migration, BI dashboards, custom reporting
- Cloud & DevOps — cloud infra (AWS / Azure / GCP), CI/CD, DevOps, monitoring
- Managed Services — ongoing support retainers, admin-as-a-service, 24×7 monitoring
`;

async function askClaude(title: string, kind: string, text: string): Promise<{ summary: string; topics: Record<string, unknown> }> {
  const trimmed = text.length > 40000 ? text.slice(0, 40000) + '\n\n[...truncated at 40k chars]' : text;
  const isTranscript = kind === 'meeting_transcript' || kind === 'meeting_recording';
  const prompt = `You are analyzing a ${isTranscript ? 'meeting transcript' : 'document'} for Simpliigence, a delivery firm serving mid-market and enterprise customers.

${SIMPLIIGENCE_SERVICES}

TITLE: ${title}
CONTENT:
${trimmed}

Produce a JSON object with EXACTLY these keys — no prose outside the JSON:
{
  "summary": "3-6 sentence overview of what this ${isTranscript ? 'meeting covered' : 'document contains'} and its relevance to our delivery work",
  "stakeholders": [ { "name": "...", "role": "...", "notes": "..." } ],
  "technologies": [ "specific product / platform / tool names mentioned (Salesforce clouds, AWS, Zoho, SAP, custom stack, etc.)" ],
  "initiatives": [ { "title": "short name", "description": "what we/they are doing or planning" } ],
  "risks": [ { "title": "...", "severity": "low|medium|high", "notes": "..." } ],
  "opportunities": [ { "title": "upsell/cross-sell idea", "service_area": "one of: Salesforce | AI & Automation | RPA | Custom Development | Mobile | Website & Digital | Data & Analytics | Cloud & DevOps | Managed Services", "cloud": "sub-area if applicable (e.g. Marketing Cloud, chatbot assistant, invoicing RPA, iOS app)", "rationale": "why this fits based on the doc", "upsell_estimate_usd": 0 } ]
}

Rules:
- Look for opportunities ACROSS ALL Simpliigence service areas, not just Salesforce. Examples of non-Salesforce signals:
    * Manual repetitive process mentioned → RPA opportunity
    * People asking about a chatbot / self-service / AI helper → AI assistant opportunity
    * Website looks dated, no analytics, poor lead capture → Website & Digital opportunity
    * "We built this ourselves and can't maintain it" → Managed Services opportunity
    * Mobile-first customer base, no app yet → Mobile opportunity
    * Data siloed across systems, reporting is painful → Data & Analytics + Integration opportunity
- Only include items actually grounded in the content. Empty arrays are fine.
- upsell_estimate_usd is a rough annual value in USD (0 if unknown).
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

    // Audio / video: stored raw. Mark done with an explanatory note so the row
    // isn't red, but skip Claude — transcription provider isn't wired yet.
    if (text === NO_TEXT_AVAILABLE) {
      await supabase
        .from('concierge_account_documents')
        .update({
          ai_status: 'done',
          ai_summary: '🎥 Audio/video stored. Paste or upload a transcript to unlock AI insights.',
          ai_topics: {},
          ai_error: null,
          processed_at: new Date().toISOString(),
        })
        .eq('id', documentId);
      return new Response(JSON.stringify({ ok: true, note: 'stored, no transcript' }), { headers: corsHeaders });
    }

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
