/**
 * Supabase Edge Function: zoho-recruit-fetch-resume
 *
 * For ONE candidate (by our internal id), looks up zoho_candidate_id, calls
 * Zoho Recruit's Attachments API to download the latest resume, uploads it to
 * the candidate-resumes Supabase Storage bucket, and updates the candidate
 * row with resume_url / resume_filename / resume_uploaded_at.
 *
 * Idempotent: if the candidate already has a resume_url and `force` isn't
 * passed, we no-op.
 *
 * Required secrets (shared with zoho-recruit-sync-metadata):
 *   ZOHO_CLIENT_ID
 *   ZOHO_CLIENT_SECRET
 *   ZOHO_RECRUIT_REFRESH_TOKEN  — scope: ZohoRecruit.modules.candidates.READ +
 *                                       ZohoRecruit.modules.attachments.READ
 *
 * Request body:
 *   { candidateId: string, force?: boolean }
 *
 * Response:
 *   { ok: true, resumeUrl, filename, size, skipped?: boolean }
 *   { ok: false, error: string }
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ZOHO_DC = env('ZOHO_DC') || 'in';
const ZOHO_CLIENT_ID = env('ZOHO_CLIENT_ID');
const ZOHO_CLIENT_SECRET = env('ZOHO_CLIENT_SECRET');
const ZOHO_RECRUIT_REFRESH_TOKEN = env('ZOHO_RECRUIT_REFRESH_TOKEN');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;

const ACCOUNTS_BASE = `https://accounts.zoho.${ZOHO_DC}`;
const RECRUIT_BASE  = `https://recruit.zoho.${ZOHO_DC}/recruit/v2`;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

async function getAccessToken(): Promise<string> {
  if (!ZOHO_CLIENT_ID || !ZOHO_CLIENT_SECRET || !ZOHO_RECRUIT_REFRESH_TOKEN) {
    throw new Error('Missing Zoho Recruit OAuth secrets');
  }
  const params = new URLSearchParams({
    refresh_token: ZOHO_RECRUIT_REFRESH_TOKEN,
    client_id: ZOHO_CLIENT_ID,
    client_secret: ZOHO_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch(`${ACCOUNTS_BASE}/oauth/v2/token?${params.toString()}`, { method: 'POST' });
  if (!res.ok) throw new Error(`Zoho OAuth failed (${res.status}): ${await res.text()}`);
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Zoho OAuth returned no access_token');
  return data.access_token;
}

/** Sanitize a filename for object-storage paths. Keeps the extension. */
function safeName(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'resume.pdf';
}

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    const { candidateId, force } = await req.json() as { candidateId?: string; force?: boolean };
    if (!candidateId) {
      return new Response(JSON.stringify({ error: 'candidateId is required' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Look up candidate — must have zoho_candidate_id
    const { data: cand, error: candErr } = await supabase
      .from('india_staffing_candidates')
      .select('id, name, zoho_candidate_id, resume_url')
      .eq('id', candidateId)
      .single();
    if (candErr || !cand) {
      return new Response(JSON.stringify({ error: 'Candidate not found', detail: candErr?.message }), { status: 404, headers: corsHeaders });
    }
    if (!cand.zoho_candidate_id) {
      return new Response(JSON.stringify({ error: 'Candidate has no zoho_candidate_id — not synced from Zoho Recruit' }), { status: 400, headers: corsHeaders });
    }
    if (cand.resume_url && !force) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: 'resume_url already set; pass force=true to refresh' }), { headers: corsHeaders });
    }

    const token = await getAccessToken();

    // 2. List attachments — pick the most recent one that looks like a resume
    const listRes = await fetch(`${RECRUIT_BASE}/Candidates/${cand.zoho_candidate_id}/Attachments`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (listRes.status === 204) {
      return new Response(JSON.stringify({ error: 'No attachments on this Zoho candidate' }), { status: 404, headers: corsHeaders });
    }
    if (!listRes.ok) {
      return new Response(JSON.stringify({ error: 'Zoho list attachments failed', detail: (await listRes.text()).slice(0, 300) }), { status: 502, headers: corsHeaders });
    }
    const listJson = await listRes.json() as { data?: Array<{ id: string; File_Name?: string; Category?: string; Modified_Time?: string; Size?: number }> };
    const attachments = listJson.data || [];
    if (attachments.length === 0) {
      return new Response(JSON.stringify({ error: 'No attachments on this Zoho candidate' }), { status: 404, headers: corsHeaders });
    }
    // Prefer Category === "Resume"; else the most recent attachment.
    const sorted = [...attachments].sort((a, b) =>
      (a.Modified_Time || '') < (b.Modified_Time || '') ? 1 : -1,
    );
    const chosen = sorted.find((a) => /resume|cv/i.test(a.Category || ''))
      || sorted.find((a) => /\.(pdf|docx?|txt)$/i.test(a.File_Name || ''))
      || sorted[0];
    if (!chosen?.id) {
      return new Response(JSON.stringify({ error: 'Could not pick an attachment from the candidate' }), { status: 404, headers: corsHeaders });
    }

    // 3. Download the chosen attachment binary
    const fileRes = await fetch(`${RECRUIT_BASE}/Candidates/${cand.zoho_candidate_id}/Attachments/${chosen.id}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (!fileRes.ok) {
      return new Response(JSON.stringify({ error: 'Zoho download failed', detail: (await fileRes.text()).slice(0, 300) }), { status: 502, headers: corsHeaders });
    }
    const bytes = new Uint8Array(await fileRes.arrayBuffer());
    if (bytes.byteLength === 0) {
      return new Response(JSON.stringify({ error: 'Zoho returned empty file' }), { status: 502, headers: corsHeaders });
    }

    const filename = chosen.File_Name || `resume-${cand.zoho_candidate_id}.pdf`;
    const contentType = fileRes.headers.get('content-type')
      || (filename.endsWith('.pdf') ? 'application/pdf'
        : filename.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : filename.endsWith('.doc') ? 'application/msword'
        : 'application/octet-stream');

    // 4. Upload to Supabase Storage
    const objectPath = `${cand.id}/${Date.now()}-${safeName(filename)}`;
    const { error: upErr } = await supabase.storage
      .from('candidate-resumes')
      .upload(objectPath, bytes, { contentType, upsert: true });
    if (upErr) {
      return new Response(JSON.stringify({ error: 'Storage upload failed', detail: upErr.message }), { status: 500, headers: corsHeaders });
    }

    // 5. Update candidate row
    const now = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('india_staffing_candidates')
      .update({
        resume_url: objectPath,
        resume_filename: filename,
        resume_uploaded_at: now,
        updated_by: 'zoho-recruit-sync',
      })
      .eq('id', cand.id);
    if (updErr) {
      return new Response(JSON.stringify({ error: 'DB update failed', detail: updErr.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      ok: true,
      resumeUrl: objectPath,
      filename,
      size: bytes.byteLength,
    }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[zoho-recruit-fetch-resume]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
