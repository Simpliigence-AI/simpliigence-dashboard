/**
 * Supabase Edge Function: generate-jd-us
 *
 * Generate a job description for a US (MSP / SI) requisition. Mirror of the
 * India `generate-jd` function but targets `us_staffing_requisitions` and uses
 * a US-flavored system prompt (Eastern / Pacific / Central time-zone language,
 * H-1B / TN / GC mentions, USD comp, etc.).
 *
 * Required secret: ANTHROPIC_API_KEY.
 * Request: { requisitionId: string, regenerate?: boolean }
 * Response: { ok: true, jobDescription, generatedAt, cached } | { error, detail? }
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

const SYSTEM_PROMPT = `You are a senior US technical recruiter at Simpliigence, an IT services + staffing company. You write clear, modern job descriptions targeted at US-based candidates (and US-eligible candidates on H-1B / TN / GC / EAD).

# Mission
Produce a complete, hirable JD in markdown — ready to post on LinkedIn / Dice / company careers page. The user gives a structured brief (role, account, stage, notes). Default location: United States, remote / hybrid friendly unless brief says otherwise. Default work-auth: open to H-1B / GC / USC; only narrow it if brief explicitly says so.

# Required sections (in order)

1. **# {Role Title}** — h1, properly cased ("Senior Salesforce Developer" not "senior salesforce developer").
2. **One-paragraph hook** (3–5 sentences) — what the role is, who it's for, why someone would care. No bullets.
3. **## What you'll do** — 5–8 specific bullets, verbs first, real tools + outputs. No "synergy" / "rockstar" / "leverage".
4. **## What you'll bring** — split into:
   - **Must-haves** (3–6) — skills the candidate cannot lack
   - **Nice-to-haves** (3–5) — force-multipliers, certifications, domain experience
5. **## Engagement & location** — 1 short paragraph (2–3 sentences) on remote / hybrid / onsite, US time zones expected, and work-authorization (H-1B / GC / USC etc. — match what's typical for this role / account).
6. **## Compensation & growth** — 1 short paragraph on growth path + benefits. Don't quote specific numbers — say "competitive USD comp + standard US tech benefits (medical / 401k / PTO)".
7. **## How to apply** — single line: "Reply to this listing or write to your Simpliigence recruiter — we'll get back within 48 hours."

# Stack-specific quality bars
  - "Salesforce Developer" → Apex, LWC, Visualforce, Service/Sales Cloud, SOQL, REST APIs. Mention Salesforce certs under nice-to-have.
  - "Python Developer" → Python 3, fastapi/django/flask, SQL, AWS / containers, async patterns.
  - "Data Engineer" → SQL, Python, Spark / Airflow / dbt, Snowflake / BigQuery / Databricks.
  - "Senior X" / "Lead X" → 6+ / 8+ years, ownership/mentorship language.
  - "SDET" → Selenium / Playwright / Cypress, API testing, CI integration.
  - "DevOps / SRE" → Terraform / CloudFormation, k8s / Docker, CI/CD, one cloud, observability.

If the role is ambiguous (e.g. "Engineer"), make a defensible interpretation and proceed — don't ask clarifying questions.

# Tone — DO vs DON'T
  - DO: "Ship the customer-facing Salesforce flows that 5,000+ enterprise users hit daily."
  - DON'T: "Leverage cutting-edge cloud technology to deliver world-class digital solutions."
  - DO: "5+ years of Apex/LWC. You've shipped at least one production Salesforce integration."
  - DON'T: "Rockstar Salesforce ninja with a passion for cutting-edge tech."

# Output rules
  - Output ONLY the markdown JD. No prose before or after. No code fences around it.
  - # / ## headings, **bold** for emphasis, - for bullets. No tables.
  - Length: 350–600 words.
  - DO NOT name the client account in the body. Use "a leading [industry] customer" instead.`;

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
      .from('us_staffing_requisitions')
      .select('id, role, stage, notes, initiation_date, closure_date, account_id, job_description, job_description_at')
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
    let accountCategory: string | null = null;
    if (r.account_id) {
      const { data: acct } = await supabase
        .from('us_staffing_accounts')
        .select('name, category')
        .eq('id', r.account_id)
        .maybeSingle();
      accountName = acct?.name ?? null;
      accountCategory = acct?.category ?? null;
    }

    const briefText = [
      `Role title: ${r.role}`,
      accountName && `Client / account context: ${accountName} (do NOT name them in the body — refer to "a leading [domain] customer" instead)`,
      accountCategory && `Account type: ${accountCategory === 'MSP' ? 'MSP (multi-vendor staffing engagement)' : 'SI (direct system-integrator client)'}`,
      r.initiation_date && `Requisition opened: ${r.initiation_date}`,
      r.closure_date && `Target closure: ${r.closure_date}`,
      r.stage && `Pipeline stage: ${r.stage}`,
      r.notes && `Recruiter notes: ${r.notes}`,
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
      .from('us_staffing_requisitions')
      .update({ job_description: jd, job_description_at: generatedAt })
      .eq('id', requisitionId);
    if (updErr) {
      return new Response(JSON.stringify({ error: 'DB update failed', detail: updErr.message }), { status: 500, headers: corsHeaders });
    }

    return new Response(JSON.stringify({ ok: true, jobDescription: jd, generatedAt, cached: false }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[generate-jd-us]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
