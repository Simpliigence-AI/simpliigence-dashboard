/**
 * Supabase Edge Function: generate-jd
 *
 * Generate a job description for a single requisition. Called from the
 * India Demand page's "Generate JD" button next to each open requisition.
 *
 * Required secrets:
 *   ANTHROPIC_API_KEY   — claude.ai console key with messages access
 *
 * Request body:
 *   { requisitionId: string, regenerate?: boolean }
 *     - regenerate=true forces a fresh Claude call even if the requisition
 *       already has a job_description on file.
 *
 * Response (success):
 *   { ok: true, jobDescription: string, generatedAt: string, cached: boolean }
 *
 * Response (error):
 *   { error: string, detail?: string } with HTTP 4xx/5xx.
 *
 * The generated markdown is written back to
 * india_staffing_requisitions.job_description (+ job_description_at) so a
 * second open of the same req does NOT re-spend tokens. Pass `regenerate=true`
 * to override that cache.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno runtime
const env = (name: string) => Deno.env.get(name);

// @ts-expect-error esm.sh
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

const SYSTEM_PROMPT = `You are a senior technical recruiter at Simpliigence, an IT services + staffing company. You write clear, modern job descriptions that hiring managers and candidates both actually read.

# Mission
The user gives you a structured brief (role title, client/account, department, optional notes). Produce a complete, hirable job description in markdown — ready to post on LinkedIn / Naukri / company careers page.

# Audience
Indian tech professionals (Bangalore / Hyderabad / Pune / Chennai / Mumbai / NCR / Remote-India) reading JDs alongside dozens of others. Be specific, modern, and avoid recruiter jargon. Use plain English, scan-able bullets, no "rockstar" / "ninja" / "synergy".

# Required sections (in this order)

1. **# {Role Title}** — h1 with the canonical role title, capitalized properly.
2. **Brief one-paragraph hook** (3–5 sentences) — what the role is, who it's for, why someone would care. No bullets here; this is the elevator pitch.
3. **## What you'll do** — 5–8 specific bullets describing real work, not vague platitudes. Each bullet starts with a verb. Mention real tools, real outputs.
4. **## What you'll bring** — bullets of required skills + experience. Split into:
   - **Must-haves** (skills the candidate cannot lack)
   - **Nice-to-haves** (force-multipliers, certifications, domain experience)
   Be honest: 3–6 must-haves, 3–5 nice-to-haves. If the role doesn't need 10 years of X, don't ask for 10 years.
5. **## How we work** — 1 short paragraph (2–3 sentences) on the team, hybrid/remote setup if known, project type (T&M / SI / product / consulting). Inference allowed: if the account is a known SI client, say "client-facing consulting engagement".
6. **## Compensation & growth** — 1 short paragraph (2–3 sentences) on growth path, training, and what makes Simpliigence a good place. Don't quote specific numbers — say "competitive comp + standard India tech benefits".
7. **## How to apply** — single line: "Reply to this listing or write to your Simpliigence recruiter — we'll get back within 48 hours."

# Stack-specific quality bars

Match the depth of skills to the stated title:
  - "Salesforce Developer" → Apex, LWC, Visualforce, Service/Sales Cloud (pick by clues), SOQL, REST APIs. Mention Salesforce certifications under nice-to-have.
  - "Python Developer" → Python 3, fastapi/django/flask (pick by clues), SQL, basic AWS / containers, async patterns.
  - "Data Engineer" → SQL, Python, Spark / Airflow / dbt, one cloud warehouse (Snowflake / BigQuery), data modeling.
  - "Senior X" / "Lead X" → add 6+ / 8+ years, ownership/mentorship language.
  - "SDET" / "Test Engineer" → Selenium / Playwright / Cypress, API testing, CI integration.
  - "DevOps / SRE" → Terraform / CloudFormation, k8s / Docker, CI/CD, one cloud, observability stack.

If the title is ambiguous (e.g. "Engineer"), make a defensible interpretation and proceed — don't ask clarifying questions.

# Examples of tone — DO vs DON'T

  - DO: "Build the customer-facing Salesforce flows that 2,000+ end users hit every day."
  - DON'T: "Leverage cutting-edge Salesforce technology to deliver world-class solutions."

  - DO: "5+ years of Apex/LWC. You've shipped at least one production Salesforce integration."
  - DON'T: "Rockstar Salesforce ninja with a passion for excellence."

# Output rules

  - Output ONLY the markdown JD. No prose before or after. No code fences around it.
  - Use # / ## headings, **bold** for emphasis, and - for bullets. No tables, no images.
  - Keep total length to 350–600 words. Hiring managers will tweak; give them 90% of a good JD, not a wall of text.
  - DO NOT hallucinate the client name into the body unless explicitly told to mention them. "A leading [industry] customer" is fine.`;

// @ts-expect-error Deno
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY secret is not set on this Supabase project');
    }

    const { requisitionId, regenerate } = await req.json() as { requisitionId?: string; regenerate?: boolean };
    if (!requisitionId) {
      return new Response(JSON.stringify({ error: 'requisitionId is required' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: r, error: reqErr } = await supabase
      .from('india_staffing_requisitions')
      .select('id, title, department, stage, anticipation, start_date, close_by_date, new_positions, account_id, job_description, job_description_at')
      .eq('id', requisitionId)
      .single();
    if (reqErr || !r) {
      return new Response(JSON.stringify({ error: 'Requisition not found', detail: reqErr?.message }), { status: 404, headers: corsHeaders });
    }

    if (!regenerate && r.job_description && r.job_description.trim().length > 0) {
      return new Response(JSON.stringify({
        ok: true,
        jobDescription: r.job_description,
        generatedAt: r.job_description_at ?? new Date().toISOString(),
        cached: true,
      }), { headers: corsHeaders });
    }

    let accountName: string | null = null;
    if (r.account_id) {
      const { data: acct } = await supabase
        .from('india_staffing_accounts')
        .select('name')
        .eq('id', r.account_id)
        .maybeSingle();
      accountName = acct?.name ?? null;
    }

    const briefText = [
      `Role title: ${r.title}`,
      r.department && `Department: ${r.department}`,
      accountName && `Client / account context: ${accountName} (do NOT name them in the body — refer to "a leading [domain] customer" if needed)`,
      r.new_positions && `Number of open positions: ${r.new_positions}`,
      r.start_date && `Expected start date: ${r.start_date}`,
      r.close_by_date && `Target close-by date: ${r.close_by_date}`,
      r.stage && `Pipeline stage: ${r.stage}`,
      r.anticipation && `Recruiter notes: ${r.anticipation}`,
    ].filter(Boolean).join('\n');

    const claudeRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: `Brief:\n${briefText}\n\nGenerate the JD now.` }],
      }),
    });

    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      return new Response(JSON.stringify({ error: 'Claude API failed', detail: text.slice(0, 500) }), { status: 502, headers: corsHeaders });
    }
    const claudeJson = await claudeRes.json() as { content?: Array<{ type: string; text?: string }> };
    const jd = (claudeJson.content?.find((b) => b.type === 'text')?.text || '').trim();
    if (!jd) {
      return new Response(JSON.stringify({ error: 'Claude returned an empty JD' }), { status: 502, headers: corsHeaders });
    }

    const generatedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from('india_staffing_requisitions')
      .update({ job_description: jd, job_description_at: generatedAt })
      .eq('id', requisitionId);
    if (updErr) {
      return new Response(JSON.stringify({ error: 'DB update failed', detail: updErr.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true, jobDescription: jd, generatedAt, cached: false }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[generate-jd]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
