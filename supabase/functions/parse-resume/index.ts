/**
 * Supabase Edge Function: parse-resume  (v41 — cost-optimised, contact-field hardened)
 *
 * Request:  { candidateId: string, forceIdentity?: boolean, forceReparse?: boolean }
 * Response: same shape as v39 ({ ok, skills, summary, firstName, … , parsedAt })
 *           plus { model, source, cached, costUsd } for visibility.
 *
 * Cost path (see core.ts header):
 *   1. sha256 of the file → resume_parse_cache hit? reuse, no Claude call.
 *   2. PDF → text (unpdf); scanned PDFs fall back to the PDF document block.
 *   3. Claude Haiku 4.5; escalate to Sonnet 4.5 only if Haiku's answer is unusable.
 *   4. Every call logged to resume_parse_log (tokens + USD).
 *   5. v41: phone / location / LinkedIn hardened — PDF & Word hyperlinks are fed to
 *      the model, long CVs keep their tail ("Personal Details"), and phone + LinkedIn
 *      have deterministic regex backstops if the model misses them.
 *
 * Write-back rules unchanged from v39: skills + summary always; identity fields
 * only when blank / placeholder, or when forceIdentity=true.
 */
// @ts-expect-error esm.sh resolves at runtime in Deno
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  buildInput, callClaude, acceptable, sha256Hex, UnreadableError, findLinkedIn, findPhone,
  HAIKU, SONNET, PARSER_VERSION, type ParsedResult, type CallResult,
} from './core.ts';

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);
const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // deno-lint-ignore no-explicit-any
  let supabase: any;
  let candidateId: string | undefined;
  try {
    if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY secret is not set on this Supabase project');
    const body = await req.json() as { candidateId?: string; forceIdentity?: boolean; forceReparse?: boolean };
    candidateId = body.candidateId;
    const { forceIdentity, forceReparse } = body;
    if (!candidateId) return json({ error: 'candidateId is required' }, 400);

    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: cand, error: candErr } = await supabase
      .from('india_staffing_candidates')
      .select('id, name, email, phone, linkedin_url, location, resume_url, resume_filename, experience')
      .eq('id', candidateId)
      .single();
    if (candErr || !cand) return json({ error: 'Candidate not found', detail: candErr?.message }, 404);
    if (!cand.resume_url) return json({ error: 'Candidate has no resume uploaded yet' }, 400);

    const { data: file, error: fileErr } = await supabase.storage.from('candidate-resumes').download(cand.resume_url);
    if (fileErr || !file) return json({ error: 'Could not download resume', detail: fileErr?.message }, 500);

    const fileName = (cand.resume_filename || cand.resume_url).toLowerCase();
    const buf = await file.arrayBuffer();
    const hash = await sha256Hex(buf);
    const cacheKey = `${hash}:${PARSER_VERSION}`;

    // ── 1. Content-hash cache ────────────────────────────────────────────────
    let parsed: ParsedResult | null = null;
    let model = 'cache';
    let source = 'cache';
    let cached = false;
    let costUsd = 0;
    let escalated = false;
    const calls: CallResult[] = [];

    if (!forceReparse) {
      const { data: hit } = await supabase.from('resume_parse_cache').select('parsed, model').eq('sha256', cacheKey).maybeSingle();
      if (hit?.parsed && acceptable(hit.parsed)) {
        parsed = hit.parsed as ParsedResult;
        cached = true;
        model = hit.model;
      }
    }

    // ── 2/3. Extract + Claude (Haiku → Sonnet fallback) ─────────────────────
    if (!parsed) {
      let input;
      try {
        input = await buildInput(buf, fileName, file.type, false);
      } catch (e) {
        if (e instanceof UnreadableError) {
          return json({ error: `Could not read text from this ${e.message} — it may be scanned, password-protected or corrupt. Re-save as PDF and re-upload.` }, 400);
        }
        return json({ error: (e as Error).message }, 400);
      }
      source = input.source;

      let haikuOk: ParsedResult | null = null;
      try {
        const h = await callClaude(ANTHROPIC_API_KEY, HAIKU, input.content);
        calls.push(h);
        if (acceptable(h.parsed)) {
          haikuOk = h.parsed!;
          applyBackstops(haikuOk, input.text, input.links);
          // Contact info is the point of parsing: if Haiku found neither phone nor
          // location, give Sonnet one try before accepting.
          if (haikuOk.phone || haikuOk.location) { parsed = haikuOk; model = HAIKU; }
        }
      } catch (e) {
        console.warn('[parse-resume] Haiku failed, escalating:', (e as Error).message);
      }
      if (!parsed) {
        escalated = true;
        let s: CallResult | null = null;
        let sErr = '';
        try {
          s = await callClaude(ANTHROPIC_API_KEY, SONNET, input.content);
          calls.push(s);
        } catch (e) {
          sErr = (e as Error).message;
        }
        if (s?.parsed) {
          parsed = s.parsed;
          applyBackstops(parsed, input.text, input.links);
          // Keep anything Haiku found that Sonnet didn't.
          if (haikuOk) for (const k of ['phone', 'location', 'linkedinUrl', 'email'] as const) if (!parsed[k] && haikuOk[k]) parsed[k] = haikuOk[k];
          model = SONNET;
        } else if (haikuOk) {
          parsed = haikuOk; // Sonnet failed or returned junk — Haiku's answer is still good.
          model = HAIKU;
        } else {
          const why = sErr || 'non-JSON';
          await logCalls(supabase, candidateId, hash, source, calls, false, true, why);
          return json({ error: sErr ? 'Claude API failed' : 'Claude returned non-JSON', detail: (sErr || s?.raw || '').slice(0, 500) }, 502);
        }
      }
      costUsd = calls.reduce((a, c) => a + c.cost, 0);
      if (acceptable(parsed)) {
        await supabase.from('resume_parse_cache').upsert({ sha256: cacheKey, parsed, model, source, created_at: new Date().toISOString() });
      }
    }
    await logCalls(supabase, candidateId, hash, source, calls, cached, escalated, null);

    // ── 4. Normalise + write back (unchanged from v39) ──────────────────────
    const p = parsed as ParsedResult;
    const str = (v: unknown) => { const t = typeof v === 'string' ? v.trim() : ''; return JUNK.test(t) ? '' : t; };
    const skills = Array.isArray(p.skills) ? p.skills.filter((s) => typeof s === 'string').slice(0, 30) : [];
    const summary = str(p.summary);
    // Resume headers are often ALL CAPS ("HIMANSHU MEHTA") — store as "Himanshu Mehta".
    const fixCaps = (v: string) => (v && v === v.toUpperCase() && /[A-Z]{2}/.test(v)
      ? v.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_m, a, b) => a + b.toUpperCase()) : v);
    const firstName = fixCaps(str(p.firstName));
    const lastName = fixCaps(str(p.lastName));
    const fullName = fixCaps(str(p.fullName) || [firstName, lastName].filter(Boolean).join(' ').trim());
    const email = str(p.email).toLowerCase();
    const phone = str(p.phone).replace(/\D/g, '').length >= 7 ? str(p.phone) : '';
    const linkedinUrl = /linkedin\.com\/in\//i.test(str(p.linkedinUrl)) ? str(p.linkedinUrl) : '';
    const currentTitle = str(p.currentTitle);
    const location = str(p.location);
    const yearsExperience = typeof p.yearsExperience === 'number' ? p.yearsExperience : undefined;

    const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    const filenameRoot = (fn: string | null | undefined): string => {
      if (!fn) return '';
      return fn.replace(/\.(pdf|txt|docx?|rtf)$/i, '').replace(/[._\-+]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    };
    const fileRoot = filenameRoot(cand.resume_filename);
    const isNamePlaceholder = (() => {
      const n = (cand.name || '').trim();
      if (!n) return true;
      const nl = n.toLowerCase();
      if (/\.(pdf|txt|docx?|rtf)$/.test(nl)) return true;
      if (nl.startsWith('imported resume') || nl.startsWith('candidate ') || nl === 'unnamed') return true;
      if (fileRoot && filenameRoot(n) === fileRoot) return true;
      if (/\b(resume|cv|profile|naukri|linkedin)\b/i.test(n)) return true;
      if (!/\s/.test(n) && /[._\-]/.test(n)) return true;
      return false;
    })();
    const shouldWrite = (existing: unknown) => forceIdentity || blank(existing);

    // deno-lint-ignore no-explicit-any
    const updates: Record<string, any> = { skills, profile_summary: summary, parsed_at: new Date().toISOString() };
    if (fullName && (forceIdentity || isNamePlaceholder)) updates.name = fullName;
    if (email && shouldWrite(cand.email)) updates.email = email;
    if (phone && shouldWrite(cand.phone)) updates.phone = phone;
    if (linkedinUrl && shouldWrite(cand.linkedin_url)) updates.linkedin_url = linkedinUrl;
    if (location && shouldWrite(cand.location)) updates.location = location;
    if (currentTitle && shouldWrite(cand.experience)) updates.experience = currentTitle;

    const { error: updErr } = await supabase.from('india_staffing_candidates').update(updates).eq('id', candidateId);
    if (updErr) return json({ error: 'DB update failed', detail: updErr.message }, 500);

    return json({
      ok: true,
      skills, summary,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      fullName: fullName || undefined,
      email: email || undefined,
      phone: phone || undefined,
      linkedinUrl: linkedinUrl || undefined,
      currentTitle: currentTitle || undefined,
      location: location || undefined,
      yearsExperience,
      parsedAt: updates.parsed_at,
      model, source, cached, costUsd: Number(costUsd.toFixed(5)),
    });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[parse-resume]', msg);
    return json({ error: msg }, 500);
  }
});

// Models sometimes fill a missing field with "Not provided" / "N/A" — treat as blank.
const JUNK = /^(not\s+(provided|available|mentioned|specified|given|disclosed)|n\/?a|nil|none|null|unknown|-+)$/i;

/** Drop placeholder values, fill phone / LinkedIn from regex when missing; normalise LinkedIn. */
function applyBackstops(p: ParsedResult, text: string, links: string[]) {
  if (p.phone && (JUNK.test(p.phone.trim()) || p.phone.replace(/\D/g, '').length < 7)) delete p.phone;
  if (p.location && JUNK.test(p.location.trim())) delete p.location;
  const li = findLinkedIn(text, links);
  if (li && (!p.linkedinUrl || !/linkedin\.com\/in\//i.test(p.linkedinUrl))) p.linkedinUrl = li;
  if (p.linkedinUrl) {
    const m = p.linkedinUrl.match(/linkedin\.com\/in\/([A-Za-z0-9\-_%.]+)/i);
    p.linkedinUrl = m ? `https://www.linkedin.com/in/${m[1].replace(/[.\/]+$/, '')}` : undefined;
  }
  if (!p.phone) { const ph = findPhone(text, links); if (ph) p.phone = ph; }
}

// deno-lint-ignore no-explicit-any
async function logCalls(sb: any, candidateId: string, hash: string, source: string, calls: CallResult[], cached: boolean, escalated: boolean, error: string | null) {
  try {
    const rows = calls.length
      ? calls.map((c) => ({
        candidate_id: candidateId, sha256: hash, source, model: c.model, cached: false, escalated,
        input_tokens: c.usage.input_tokens, output_tokens: c.usage.output_tokens,
        cache_read_tokens: c.usage.cache_read_input_tokens ?? 0, cache_write_tokens: c.usage.cache_creation_input_tokens ?? 0,
        cost_usd: c.cost, error,
      }))
      : [{ candidate_id: candidateId, sha256: hash, source, model: cached ? 'cache' : null, cached, escalated, input_tokens: 0, output_tokens: 0, cost_usd: 0, error }];
    await sb.from('resume_parse_log').insert(rows);
  } catch (e) {
    console.warn('[parse-resume] log failed:', (e as Error).message);
  }
}
