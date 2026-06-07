/**
 * Supabase Edge Function: format-resume
 *
 * Sends a candidate resume (PDF base64, raw text, or a prior formatted
 * markdown draft) to Claude with the Simpliigence house format + any
 * user-supplied refinement instructions, and returns formatted markdown
 * the TA can preview / save-as-PDF / copy / download.
 *
 * Optional `targetFormatPdfBase64` lets the TA upload a SAMPLE resume
 * that shows the desired format — Claude is instructed to match that
 * layout instead of the default Simpliigence template.
 *
 * Required secrets:
 *   ANTHROPIC_API_KEY
 *
 * Request body:
 *   {
 *     pdfBase64?: string,             // base64 of a PDF (no data: prefix)
 *     resumeText?: string,            // plain text resume
 *     priorDraft?: string,            // prior formatted markdown to refine
 *     targetFormatPdfBase64?: string, // base64 PDF showing the target format
 *     instructions?: string,
 *   }
 *
 * Response:
 *   { ok: true, markdown: string }
 *   { error: string, detail?: string }
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

const SIMPLIIGENCE_SYSTEM_PROMPT = `You are a professional recruitment resume editor for Simpliigence. Your job is to take an incoming candidate resume and rewrite it into the Simpliigence house format — a clean, recruiter-friendly markdown document a hiring manager can scan in 30 seconds.

# The Simpliigence house format

Output exactly these sections, in this order, using markdown. Skip any section if the source has no content for it (do NOT invent).

  # {SPECIALIZATION HEADLINE IN ALL CAPS}
    A single \`#\` H1 line: the candidate's primary specialization in ALL CAPS, e.g. "SENIOR LEAD ANALYTICS", "PRINCIPAL SALESFORCE DEVELOPER", "STAFF DATA ENGINEER". This is the resume's headline — NOT the candidate's name.

  ## Professional Summary
    1–2 paragraphs in third person, italicized via blockquote (\`> *…*\`). Cover years of experience, primary specialization, and 1–2 standout strengths.

  ## Highlights
    Bullet list of 6–10 items. Each item starts with a **bold theme phrase**, followed by a colon and a 1-line achievement.
    Examples:
      - **Insights-powered strategy:** Led a data-to-strategy initiative that quantified 30% increase in customer engagement rate.
      - **Customer-centric analytics:** Built a customer-centric analytics program integrating behavior, market trends, and risk of redemption.
      - **Value creation:** Identified revenue streams that drove a 10% inflow increase.

  ## Technical Skills
    Categorized bullet list. Use **bold category labels** followed by a dash and comma-separated items:
      - **Languages —** SQL, Python, R
      - **BI & Data Visualization —** Tableau, Power BI, Qlik
      - **Cloud —** AWS (Athena, QuickSight), Hadoop, Spark
      - **Machine Learning —** Supervised (Classification, Regression), Unsupervised (Clustering)

  ## Current Role
    A single role-title line, then a 3–6 bullet list of what the candidate does in that role.

  ## Selected Projects
    Grouped sub-sections. Each group is a bold sub-heading followed by 3–5 bullets:
      **Advanced Analytics, Business Intelligence and Product Optimization:**
      - Deep-dive exploration to understand advisor clusters impacted by market conditions; drove proactive outreach that improved CSAT.
      - Cohort comparisons + descriptive/prescriptive analytics that improved customer retention by 10%.

  ## Work History
    Bullet list, most-recent first. Each item:
      \`- {Job Title} — *{Company} ({Month YYYY – Month YYYY or Present})*\`

  ## Education
    For each degree:
      \`{Degree} — {YYYY}\`
      \`> *{Institution}*\`
    (Institution on its own indented italic line via blockquote.)

# Rules — every time

  1. **Strip personal details inappropriate for Western hiring**: date of birth, marital status, father's name, religion, blood group, photograph, full home address (city / state / country is fine). NEVER include these.
  2. **Third person throughout.** No "I" / "my".
  3. **Concise bullets** — 12–22 words each, starting with strong action verbs (Led, Built, Designed, Migrated, Reduced, Owned, Shipped, Drove).
  4. **No emoji, no decorative characters, no horizontal rules.**
  5. **Quantify when the source gives numbers.** Don't fabricate metrics.
  6. **The H1 title is the specialization headline in ALL CAPS** — not the candidate's full name. Do NOT include name, email, phone, or LinkedIn in the body (those go on a cover sheet, not in this profile).
  7. **Italicized blockquotes (\`> *…*\`)** for: the Professional Summary paragraph, the Education institution line. Nothing else.
  8. **Bold (\`**…**\`)** for: Highlights theme phrases, Technical Skills category labels, Selected Projects sub-headings.
  9. Output MUST be valid Markdown only. No prose introduction, no closing remark, no \`\`\`fences\`\`\`.

# Target-format override

The user may attach a TARGET-FORMAT sample PDF showing the layout they want. When present, that takes priority: study the section order, headings, italic/bold usage, and bullet style in the sample, and rewrite the source resume to match THAT layout instead of the default Simpliigence template above. The "Rules — every time" still apply.

# User refinement instructions

The user message may include free-form instructions ("emphasize Salesforce platform expertise", "drop the customer-service roles", "tighten to 1 page"). Follow them faithfully on top of the format above.

# If you're given a prior formatted draft

The user may pass an already-formatted markdown draft instead of a raw resume. In that case, refine THAT draft per the new instructions — don't re-extract from scratch, just edit.`;

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
      targetFormatPdfBase64?: string;
      instructions?: string;
    };

    const { pdfBase64, resumeText, priorDraft, targetFormatPdfBase64, instructions } = body;
    const sources = [pdfBase64, resumeText, priorDraft].filter(Boolean).length;
    if (sources === 0) {
      return new Response(
        JSON.stringify({ error: 'Provide one of: pdfBase64, resumeText, priorDraft' }),
        { status: 400, headers: corsHeaders },
      );
    }

    // Build user message content
    const userContent: unknown[] = [];

    // If a target-format sample was uploaded, attach it first with a label
    if (targetFormatPdfBase64) {
      userContent.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: targetFormatPdfBase64 },
      });
      userContent.push({
        type: 'text',
        text: 'The PDF above is a TARGET-FORMAT SAMPLE — study its layout, section order, headings, italics, bold, and bullet style. Rewrite the candidate resume below to match THIS format. The Simpliigence default in your system prompt is a fallback only.',
      });
    }

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
          'Rewrite the resume above into the Simpliigence house format' +
          (targetFormatPdfBase64 ? ' (matching the target-format sample)' : '') +
          ' per the system instructions. Return ONLY the formatted markdown.',
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
        system: SIMPLIIGENCE_SYSTEM_PROMPT,
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
