/**
 * Supabase Edge Function: parse-resume
 *
 * Called by the dashboard's "Parse" button on the Candidates page. Downloads
 * the resume PDF/text from Supabase Storage, sends it to Claude (Anthropic
 * Messages API), and writes the parsed skills + profile_summary back onto the
 * india_staffing_candidates row.
 *
 * Required secrets (set with `supabase secrets set ...`):
 *   ANTHROPIC_API_KEY   — claude.ai console key with messages access
 *
 * Request body:
 *   { candidateId: string }
 *
 * Response (success):
 *   { ok: true, skills: string[], summary: string, parsedAt: string }
 *
 * Response (error): HTTP 4xx/5xx with { error: string, detail?: string }.
 *
 * Supported file types: PDF (application/pdf), plain text (text/plain).
 * Word docs (.docx) currently land as opaque uploads — user gets a clear error
 * asking them to convert to PDF.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global provided by edge runtime
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh resolves at runtime in Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;

const CLAUDE_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

interface ParsedResult {
  skills: string[];
  summary: string;
}

/** Convert an ArrayBuffer to a base64 string in Deno (no Buffer). */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // btoa is available in the Deno runtime
  // @ts-expect-error btoa is globally available
  return btoa(binary);
}

const SYSTEM_PROMPT = `You are a recruitment resume parser. The user message contains a candidate's resume (either as a PDF document or plain text).

Extract two things and return ONLY valid JSON:

1. "skills" — an array of distinct technical skills, tools, languages, frameworks, methodologies, certifications. 8–25 items. Each item must be a short noun phrase (e.g. "TypeScript", "AWS Lambda", "PMP", "Stakeholder management"). Deduplicate. Do not include "Communication" or other generic soft skills unless they're explicitly emphasized.

2. "summary" — a 2–4 sentence professional summary in third person describing the candidate's experience, primary specialization, years of experience, and standout strengths. Plain text, no markdown.

Response MUST be a single JSON object with exactly these two keys: {"skills": [...], "summary": "..."}. No prose, no markdown fences.`;

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY secret is not set on this Supabase project');
    }

    const { candidateId } = await req.json() as { candidateId?: string };
    if (!candidateId) {
      return new Response(JSON.stringify({ error: 'candidateId is required' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Look up the candidate row
    const { data: cand, error: candErr } = await supabase
      .from('india_staffing_candidates')
      .select('id, name, resume_url, resume_filename')
      .eq('id', candidateId)
      .single();
    if (candErr || !cand) {
      return new Response(JSON.stringify({ error: 'Candidate not found', detail: candErr?.message }), { status: 404, headers: corsHeaders });
    }
    if (!cand.resume_url) {
      return new Response(JSON.stringify({ error: 'Candidate has no resume uploaded yet' }), { status: 400, headers: corsHeaders });
    }

    // 2. Download the resume from storage
    //    resume_url is the object path within the candidate-resumes bucket.
    const { data: file, error: fileErr } = await supabase.storage
      .from('candidate-resumes')
      .download(cand.resume_url);
    if (fileErr || !file) {
      return new Response(JSON.stringify({ error: 'Could not download resume', detail: fileErr?.message }), { status: 500, headers: corsHeaders });
    }

    const fileName = (cand.resume_filename || cand.resume_url).toLowerCase();
    const isPdf = file.type === 'application/pdf' || fileName.endsWith('.pdf');
    const isText = file.type.startsWith('text/') || fileName.endsWith('.txt');

    // 3. Build the Claude message — PDF goes as a document block, text goes inline
    let userContent: unknown;
    if (isPdf) {
      const b64 = toBase64(await file.arrayBuffer());
      userContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text: 'Parse this resume per the instructions and return the JSON.' },
      ];
    } else if (isText) {
      const text = await file.text();
      userContent = [
        { type: 'text', text: `Resume text follows. Parse per the instructions and return the JSON.\n\n---\n${text}` },
      ];
    } else {
      return new Response(JSON.stringify({
        error: `Unsupported file type "${file.type || 'unknown'}". Please upload PDF or .txt.`,
      }), { status: 400, headers: corsHeaders });
    }

    // 4. Call Claude
    const claudeRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      return new Response(JSON.stringify({ error: 'Claude API failed', detail: text.slice(0, 500) }), { status: 502, headers: corsHeaders });
    }
    const claudeJson = await claudeRes.json() as { content?: Array<{ type: string; text?: string }> };
    const reply = claudeJson.content?.find((b) => b.type === 'text')?.text?.trim() || '';

    // 5. Parse JSON out of Claude's response (strip code fences just in case)
    const cleaned = reply
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    let parsed: ParsedResult;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return new Response(JSON.stringify({
        error: 'Claude returned non-JSON',
        detail: reply.slice(0, 500),
      }), { status: 502, headers: corsHeaders });
    }
    const skills = Array.isArray(parsed.skills) ? parsed.skills.filter((s) => typeof s === 'string').slice(0, 30) : [];
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';

    // 6. Write back to the candidate row
    const parsedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('india_staffing_candidates')
      .update({ skills, profile_summary: summary, parsed_at: parsedAt })
      .eq('id', candidateId);
    if (updErr) {
      return new Response(JSON.stringify({ error: 'DB update failed', detail: updErr.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true, skills, summary, parsedAt }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[parse-resume]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
