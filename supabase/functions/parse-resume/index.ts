/**
 * Supabase Edge Function: parse-resume
 *
 * Called by the dashboard's Candidates page on single-file upload AND on
 * bulk import. Downloads the resume PDF/text from Supabase Storage, sends
 * it to Claude (Anthropic Messages API), and writes the parsed identity
 * + skills + summary back onto the india_staffing_candidates row.
 *
 * Required secrets (set with `supabase secrets set ...`):
 *   ANTHROPIC_API_KEY   — claude.ai console key with messages access
 *
 * Request body:
 *   { candidateId: string }
 *
 * Response (success):
 *   {
 *     ok: true,
 *     skills: string[],
 *     summary: string,
 *     firstName?: string,
 *     lastName?: string,
 *     email?: string,
 *     phone?: string,
 *     linkedinUrl?: string,
 *     currentTitle?: string,
 *     yearsExperience?: number,
 *     parsedAt: string,
 *   }
 *
 * Identity fields (firstName/lastName/email/phone/linkedin/currentTitle)
 * are written back to the candidate row ONLY if that column is currently
 * empty — never overwrite a TA's hand-typed values. Skills + summary
 * always update (parser is the source of truth there).
 *
 * Supported file types: PDF (application/pdf), plain text (text/plain).
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
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  currentTitle?: string;
  /** Current location — city + state/country if present. Used for sourcing/search. */
  location?: string;
  yearsExperience?: number;
  skills: string[];
  summary: string;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  // @ts-expect-error btoa is globally available
  return btoa(binary);
}

const SYSTEM_PROMPT = `You are a recruitment resume parser. The user message contains a candidate's resume (either as a PDF document or plain text).

# Output contract

Extract these fields and return ONLY valid JSON. If a field is not present, OMIT it (do not return null or empty string).

## Field rules

  - "firstName" / "lastName": split the candidate's name. If only a single name is present, put it in firstName and omit lastName. For names with three or more parts (e.g. "Anil Kumar Sharma"), put the first word in firstName and the remainder in lastName. Strip honorifics ("Mr.", "Ms.", "Dr.").

  - "fullName": optional convenience field with the full name verbatim from the resume (as it appears at the top), including any honorifics or middle initials.

  - "email": the candidate's primary email if shown. Lowercase, no spaces. If multiple emails appear, prefer the one in the contact header (top of resume) over any in employment history. Reject obvious placeholders ("email@example.com").

  - "phone": phone number as it appears (preserve country code, parens, and dashes if shown). If multiple phones, prefer the one labeled "mobile" or "cell"; else the first one in the contact header.

  - "linkedinUrl": the LinkedIn profile URL if present. Always normalize to start with "https://" (add it if missing). Accept formats: "linkedin.com/in/jane-doe", "www.linkedin.com/in/jane-doe", or full URL.

  - "currentTitle": the candidate's CURRENT job title — the most recent role. Examples: "Senior Salesforce Developer", "Lead Data Engineer", "Principal SDET". If the most recent role is "Present" / undated, that's the current one. Skip historical titles.

  - "location": the candidate's CURRENT location (city + state/country). Examples: "Bangalore, India", "Pune, MH, India", "New York, NY, USA", "Remote — IST". If only a city is visible, just return the city. Skip historical/past locations. If the resume says "willing to relocate to X", the CURRENT location is still wherever they currently live — record that, not the relocation target.

  - "yearsExperience": integer total years of professional experience if inferable. Look for an explicit statement ("8+ years of experience") first; otherwise compute from earliest professional-role start year to now. Cap at 40.

  - "skills": array of 8–25 distinct technical skills, tools, languages, frameworks, methodologies, certifications. Each item must be a short noun phrase ("TypeScript", "AWS Lambda", "PMP", "Stakeholder management"). Deduplicate aggressively — "JavaScript" and "JS" → "JavaScript". Skip generic soft skills (Communication, Teamwork, Leadership) unless the candidate has a specific cert or specialty there. Prefer canonical product names: "Salesforce Service Cloud" over "Service Cloud"; "AWS Lambda" over "Lambda"; "Apache Kafka" over "Kafka". Preserve case for proper nouns. Order by prominence (skills mentioned in current role first).

  - "summary": 2–4 sentence third-person professional summary. Cover: total years of experience, primary specialization (e.g. "Salesforce platform", "data engineering on AWS"), notable strengths or recent achievements, and seniority level if inferable. Plain text, no markdown, no first-person, no quotation marks around the summary itself.

# Worked examples

## Example 1 — Indian Salesforce developer

Resume input (excerpted):
  Priya Sharma
  priya.sharma@gmail.com  |  +91 98765 43210  |  Bangalore, KA
  https://linkedin.com/in/priya-sharma-sf
  Senior Salesforce Developer at Infosys (Jun 2020–Present)
  Salesforce Developer at Wipro (Aug 2017–May 2020)
  Skills: Apex, LWC, Visualforce, SOQL, Salesforce Service Cloud, Field Service Lightning, Salesforce Marketing Cloud, REST APIs, Jenkins, Git

Expected JSON:
  {
    "firstName": "Priya",
    "lastName": "Sharma",
    "fullName": "Priya Sharma",
    "email": "priya.sharma@gmail.com",
    "phone": "+91 98765 43210",
    "linkedinUrl": "https://linkedin.com/in/priya-sharma-sf",
    "currentTitle": "Senior Salesforce Developer",
    "location": "Bangalore, KA, India",
    "yearsExperience": 7,
    "skills": ["Apex", "Lightning Web Components", "Visualforce", "SOQL", "Salesforce Service Cloud", "Field Service Lightning", "Salesforce Marketing Cloud", "REST APIs", "Jenkins", "Git"],
    "summary": "Senior Salesforce developer with 7+ years across Infosys and Wipro, specializing in Service Cloud and Field Service Lightning. Strong on Apex, LWC, and integration work. Currently based in Bangalore."
  }

## Example 2 — Single-name profile, US-based

Resume input (excerpted):
  Akash
  akash@protonmail.com  ·  (415) 555-2200  ·  San Francisco, CA
  Principal Data Engineer · Snowflake Inc. (2021–Present)
  Lead Data Engineer · Airbnb (2017–2021)
  10+ years experience.
  Stack: Snowflake, Spark, Airflow, dbt, Kafka, Python, SQL, AWS

Expected JSON:
  {
    "firstName": "Akash",
    "fullName": "Akash",
    "email": "akash@protonmail.com",
    "phone": "(415) 555-2200",
    "currentTitle": "Principal Data Engineer",
    "location": "San Francisco, CA, USA",
    "yearsExperience": 10,
    "skills": ["Snowflake", "Apache Spark", "Apache Airflow", "dbt", "Apache Kafka", "Python", "SQL", "AWS"],
    "summary": "Principal data engineer with 10+ years at top-tier data-heavy companies including Snowflake and Airbnb. Deep expertise in modern data-stack tooling — Snowflake, Spark, Airflow, dbt, Kafka. Currently based in San Francisco."
  }

## Example 3 — Sparse contact info

Resume input (excerpted):
  Karthik R
  karthik.r@yahoo.com
  Salesforce Admin at TCS (3 yrs)
  Skills: Salesforce CRM, reports & dashboards, validation rules, flows

Expected JSON:
  {
    "firstName": "Karthik",
    "lastName": "R",
    "email": "karthik.r@yahoo.com",
    "currentTitle": "Salesforce Admin",
    "yearsExperience": 3,
    "skills": ["Salesforce CRM", "Salesforce Reports & Dashboards", "Validation Rules", "Salesforce Flow"],
    "summary": "Salesforce administrator with 3 years at TCS focused on declarative configuration — flows, validation rules, reports, and dashboards."
  }

# Final notes

  - Response MUST be a single JSON object. No prose before or after. No markdown code fences.
  - When unsure between two interpretations, prefer the more specific one (e.g. "Salesforce Service Cloud" over plain "Salesforce").
  - Never hallucinate a value. If the field genuinely isn't in the resume, OMIT it.`;

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

    // 1. Look up candidate row (full row so we know what's blank)
    const { data: cand, error: candErr } = await supabase
      .from('india_staffing_candidates')
      .select('id, name, email, phone, linkedin_url, location, resume_url, resume_filename, experience')
      .eq('id', candidateId)
      .single();
    if (candErr || !cand) {
      return new Response(JSON.stringify({ error: 'Candidate not found', detail: candErr?.message }), { status: 404, headers: corsHeaders });
    }
    if (!cand.resume_url) {
      return new Response(JSON.stringify({ error: 'Candidate has no resume uploaded yet' }), { status: 400, headers: corsHeaders });
    }

    // 2. Download resume
    const { data: file, error: fileErr } = await supabase.storage
      .from('candidate-resumes')
      .download(cand.resume_url);
    if (fileErr || !file) {
      return new Response(JSON.stringify({ error: 'Could not download resume', detail: fileErr?.message }), { status: 500, headers: corsHeaders });
    }

    const fileName = (cand.resume_filename || cand.resume_url).toLowerCase();
    const isPdf = file.type === 'application/pdf' || fileName.endsWith('.pdf');
    const isText = file.type.startsWith('text/') || fileName.endsWith('.txt');

    // 3. Build Claude message
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
        max_tokens: 1500,
        // System prompt as a structured block with cache_control: ephemeral —
        // Anthropic caches the prefix for 5 min, so any subsequent parse-resume
        // call within that window pays ~10% of the input cost on the cached
        // portion (~30–40% saving for typical resume bulk imports).
        // Note: caching needs ≥1024 tokens to activate; the expanded prompt
        // above is sized to clear that threshold.
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      return new Response(JSON.stringify({ error: 'Claude API failed', detail: text.slice(0, 500) }), { status: 502, headers: corsHeaders });
    }
    const claudeJson = await claudeRes.json() as { content?: Array<{ type: string; text?: string }> };
    const reply = claudeJson.content?.find((b) => b.type === 'text')?.text?.trim() || '';

    // 5. Parse JSON
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
    const firstName = typeof parsed.firstName === 'string' ? parsed.firstName.trim() : '';
    const lastName = typeof parsed.lastName === 'string' ? parsed.lastName.trim() : '';
    const fullName = typeof parsed.fullName === 'string' ? parsed.fullName.trim() : [firstName, lastName].filter(Boolean).join(' ').trim();
    const email = typeof parsed.email === 'string' ? parsed.email.trim().toLowerCase() : '';
    const phone = typeof parsed.phone === 'string' ? parsed.phone.trim() : '';
    const linkedinUrl = typeof parsed.linkedinUrl === 'string' ? parsed.linkedinUrl.trim() : '';
    const currentTitle = typeof parsed.currentTitle === 'string' ? parsed.currentTitle.trim() : '';
    const location = typeof parsed.location === 'string' ? parsed.location.trim() : '';
    const yearsExperience = typeof parsed.yearsExperience === 'number' ? parsed.yearsExperience : undefined;

    // 6. Write back — skills + summary always; identity fields only when blank.
    const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    // Treat "placeholder" candidate names from bulk-import (e.g. the filename
    // we inserted before parsing) as blank so the parser overwrites them.
    const namePlaceholder = (() => {
      const n = (cand.name || '').trim().toLowerCase();
      if (!n) return true;
      if (n.endsWith('.pdf') || n.endsWith('.txt') || n.endsWith('.docx')) return true;
      if (n.startsWith('imported resume') || n.startsWith('candidate ')) return true;
      return false;
    })();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {
      skills,
      profile_summary: summary,
      parsed_at: new Date().toISOString(),
    };
    if (fullName && namePlaceholder) updates.name = fullName;
    if (email && blank(cand.email)) updates.email = email;
    if (phone && blank(cand.phone)) updates.phone = phone;
    if (linkedinUrl && blank(cand.linkedin_url)) updates.linkedin_url = linkedinUrl;
    if (location && blank(cand.location)) updates.location = location;
    // Use "experience" column to hold the current title if it's a placeholder
    // (it's free-text, originally for years). Only fill when blank.
    if (currentTitle && blank(cand.experience)) updates.experience = currentTitle;

    const parsedAt = updates.parsed_at;
    const { error: updErr } = await supabase
      .from('india_staffing_candidates')
      .update(updates)
      .eq('id', candidateId);
    if (updErr) {
      return new Response(JSON.stringify({ error: 'DB update failed', detail: updErr.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({
      ok: true,
      skills,
      summary,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      fullName: fullName || undefined,
      email: email || undefined,
      phone: phone || undefined,
      linkedinUrl: linkedinUrl || undefined,
      currentTitle: currentTitle || undefined,
      location: location || undefined,
      yearsExperience,
      parsedAt,
    }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[parse-resume]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
