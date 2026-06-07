/**
 * Supabase Edge Function: format-resume
 *
 * Called by the dashboard's Profile Format page. Sends an incoming
 * candidate resume (PDF base64 OR raw text OR a prior formatted
 * markdown draft) to Claude with the Simpliigence house format
 * + any user-supplied refinement instructions, and returns formatted
 * markdown the TA can preview / copy / download.
 *
 * Required secrets:
 *   ANTHROPIC_API_KEY  — Anthropic console key with messages access
 *
 * Request body:
 *   {
 *     pdfBase64?: string,        // base64 of a PDF (no data: prefix)
 *     resumeText?: string,       // plain text resume
 *     priorDraft?: string,       // prior formatted markdown to refine
 *     instructions?: string,     // free-form additional guidance
 *   }
 *
 * Response:
 *   { ok: true, markdown: string }
 *   { error: string, detail?: string }  with 4xx/5xx
 *
 * Exactly one of pdfBase64 / resumeText / priorDraft must be set.
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global provided by edge runtime
const env = (name: string) => Deno.env.get(name);

const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const CLAUDE_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const SYSTEM_PROMPT = `You are a professional recruitment resume editor for Simpliigence. Your job is to take an incoming candidate resume and rewrite it into the Simpliigence house format — clean, professional, recruiter-friendly markdown that a hiring manager can scan in 30 seconds.

# House format

Use exactly these top-level sections, in this order, using \`##\` headings. Skip a section ENTIRELY if the source has no content for it — do not invent.

  ## Professional Summary
    3–4 sentences in third person. Cover: years of experience, primary specialization (e.g. "Salesforce platform", "data engineering on AWS"), seniority level, and 1–2 standout strengths or recent achievements. Plain text, no bullets, no quotation marks.

  ## Core Skills
    A clean bullet list of 8–20 distinct technical skills, tools, languages, frameworks, methodologies, certifications. Group similar items on the same line where it reads cleanly (e.g. "- **Cloud:** AWS Lambda, S3, EC2, CloudFormation"). Use **bold category labels** for groupings. Skip generic soft skills.

  ## Professional Experience
    For each role, most-recent first:
      \`### {Company Name} — {Job Title}\`
      \`*{Month YYYY} – {Month YYYY or Present}*  |  {Location}\`
      Then 3–6 bullet points starting with strong action verbs (Led, Built, Designed, Migrated, Reduced, Owned, Shipped). Each bullet should describe what they did + the business impact, ideally quantified ("reduced page load by 40%", "led a team of 8", "managed $1.2M in cloud spend").

  ## Education
    For each degree:
      \`- {Degree}, {Institution}  ·  {YYYY}\`

  ## Certifications
    Bullet list. Skip if none.

# Rules — apply EVERY time

  1. **Strip personal details** that aren't appropriate for a Western hiring process: date of birth, marital status, father's name, religion, blood group, photograph, full home address (city / state / country is fine). NEVER include these in the output even if the source has them.
  2. **Third person.** No "I" / "my".
  3. **Concise.** Each bullet is one short line, ideally 12–22 words. Cut filler ("responsible for", "tasked with") — start with the action verb.
  4. **No emoji, no decorative characters, no horizontal rules** (\`---\`) except the optional one between header and body.
  5. **Preserve specific product names** verbatim: "Salesforce Service Cloud", "AWS Lambda", "Apache Kafka". Don't shorten.
  6. **Quantify when the source gives you numbers.** When the source is vague ("improved performance"), keep the bullet but don't fabricate metrics.
  7. **Header block at the very top, before any section:**
       \`# {Full Name}\`
       \`{Job Title} · {City, Country}\`
       \`{email}  ·  {phone}  ·  {linkedinUrl}\`
     Omit any line whose source field is missing.
  8. Output MUST be valid Markdown only. No prose introduction, no closing remark, no \`\`\`fences\`\`\`.

# User-supplied refinements

The user message may include free-form instructions describing how to tailor the rewrite — e.g. "emphasize Salesforce platform expertise", "drop the customer-service roles", "add an Indianized salary expectation", "rewrite for a SaaS sales role rather than engineering". Follow them faithfully on top of the house format above.

# If you're given a prior formatted draft

The user may pass you an already-formatted markdown draft instead of a raw resume. In that case, refine THAT draft per the user's new instructions — don't re-extract from scratch, just edit it.`;

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: corsHeaders });
  }

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY secret is not set');
    }

    const body = await req.json() as {
      pdfBase64?: string;
      resumeText?: string;
      priorDraft?: string;
      instructions?: string;
    };

    const { pdfBase64, resumeText, priorDraft, instructions } = body;
    const sources = [pdfBase64, resumeText, priorDraft].filter(Boolean).length;
    if (sources === 0) {
      return new Response(
        JSON.stringify({ error: 'Provide one of: pdfBase64, resumeText, priorDraft' }),
        { status: 400, headers: corsHeaders },
      );
    }

    // Build user message content
    const userContent: unknown[] = [];

    if (pdfBase64) {
      userContent.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
      });
      userContent.push({
        type: 'text',
        text:
          (instructions && instructions.trim()
            ? `User refinement instructions:\n${instructions.trim()}\n\n`
            : '') +
          'Rewrite the above resume into the Simpliigence house format per the system instructions. Return ONLY the formatted markdown.',
      });
    } else if (priorDraft) {
      userContent.push({
        type: 'text',
        text:
          `Below is a prior formatted draft. Refine it per the new instructions, keeping the house format intact.\n\n` +
          (instructions && instructions.trim()
            ? `User refinement instructions:\n${instructions.trim()}\n\n`
            : '') +
          `--- BEGIN PRIOR DRAFT ---\n${priorDraft}\n--- END PRIOR DRAFT ---\n\n` +
          'Return ONLY the revised markdown.',
      });
    } else if (resumeText) {
      userContent.push({
        type: 'text',
        text:
          (instructions && instructions.trim()
            ? `User refinement instructions:\n${instructions.trim()}\n\n`
            : '') +
          `Resume text follows. Rewrite into the Simpliigence house format per the system instructions. Return ONLY the formatted markdown.\n\n` +
          `--- BEGIN RESUME ---\n${resumeText}\n--- END RESUME ---`,
      });
    }

    const claudeRes = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });
    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      return new Response(
        JSON.stringify({ error: 'Claude API failed', detail: text.slice(0, 500) }),
        { status: 502, headers: corsHeaders },
      );
    }
    const claudeJson = await claudeRes.json() as { content?: Array<{ type: string; text?: string }> };
    const reply = claudeJson.content?.find((b) => b.type === 'text')?.text?.trim() || '';
    // Strip accidental code fences
    const cleaned = reply
      .replace(/^```(?:markdown|md)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    return new Response(JSON.stringify({ ok: true, markdown: cleaned }), { headers: corsHeaders });
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error('[format-resume]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
