/**
 * structure-gtm-notes
 *
 * Takes a GTM account's rough / dictated notes and reshapes them into
 * structured sections plus a list of suggested action items. Returns:
 *
 *   {
 *     summary: string,
 *     structured_notes: string  // Markdown with sections
 *     action_items: [{ title, description, due_date_hint }],
 *     stakeholders_mentioned: [{ name, role? }],
 *     next_steps: string[],
 *     open_questions: string[]
 *   }
 *
 * Caller decides whether to save the structured notes back onto the
 * gtm_accounts row and/or promote action_items into gtm_actions.
 *
 * Input:  { notes: string, accountName?: string, currentNextStep?: string,
 *           existingActionTitles?: string[] }
 * Output: { ok, structured, usage }
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);

const ANTHROPIC_API_KEY = env('ANTHROPIC_API_KEY');
const CLAUDE_MODEL = 'claude-sonnet-4-5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function repairTruncatedJson(s: string): Record<string, unknown> {
  let inString = false;
  let escape = false;
  let lastSafe = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === ',' || c === '}' || c === ']') lastSafe = i + (c === ',' ? 0 : 1);
  }
  let repaired = s.slice(0, lastSafe).replace(/,\s*$/, '');
  const closeStack: string[] = [];
  inString = false; escape = false;
  for (let i = 0; i < repaired.length; i++) {
    const c = repaired[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{' || c === '[') closeStack.push(c);
    else if (c === '}' && closeStack[closeStack.length - 1] === '{') closeStack.pop();
    else if (c === ']' && closeStack[closeStack.length - 1] === '[') closeStack.pop();
  }
  while (closeStack.length > 0) {
    const open = closeStack.pop();
    repaired += open === '{' ? '}' : ']';
  }
  return JSON.parse(repaired);
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY missing' }), { status: 500, headers: corsHeaders });

  let notes = '', accountName = '', currentNextStep = '';
  let existingActionTitles: string[] = [];
  try {
    const body = await req.json();
    notes = String(body?.notes ?? '').trim();
    accountName = String(body?.accountName ?? '').trim();
    currentNextStep = String(body?.currentNextStep ?? '').trim();
    existingActionTitles = Array.isArray(body?.existingActionTitles) ? body.existingActionTitles.map(String) : [];
    if (!notes) throw new Error('notes required');
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 400, headers: corsHeaders });
  }

  const prompt = `You are Simpliigence's GTM strategist. A partnership lead has dictated / typed rough notes about a strategic account. Reshape them into a clean, structured record + concrete action items.

ACCOUNT: ${accountName || '(unknown)'}
CURRENT NEXT STEP ON RECORD: ${currentNextStep || '(none)'}
EXISTING ACTION TITLES (do NOT propose these again as new): ${JSON.stringify(existingActionTitles)}

RAW NOTES:
"""
${notes}
"""

Return ONLY a JSON object with these keys (empty arrays/strings are fine):
{
  "summary": "1-3 sentence overview of what this note describes",
  "structured_notes": "Markdown-formatted rewrite of the notes with clear sections. Use ## headings like 'Discussion', 'Decisions', 'Concerns', 'Context'. Preserve every meaningful fact from the raw notes. Do NOT invent info. Use bullet points liberally.",
  "action_items": [
    { "title": "short, verb-first (e.g. 'Follow up with VP Alliances re: pricing tier')", "description": "one-sentence context", "due_date_hint": "e.g. 'this week' | '2026-08-15' | null" }
  ],
  "stakeholders_mentioned": [ { "name": "Person Name", "role": "if mentioned" } ],
  "next_steps": [ "1-line strings, most important first" ],
  "open_questions": [ "questions raised in the notes that don't have an answer yet" ]
}

Rules:
- Ground every claim in the raw notes; do not add facts the notes don't support.
- Action items should be CONCRETE, VERB-FIRST, and OWNABLE by one person.
- Skip action_items that duplicate anything in EXISTING ACTION TITLES.
- If the notes are very short, produce a short summary + few (or zero) items — don't pad.
- Do NOT wrap the JSON in code fences.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!resp.ok) throw new Error(`Claude ${resp.status}: ${(await resp.text()).slice(0, 400)}`);
    const json = await resp.json();
    const raw = json.content?.[0]?.text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude did not return JSON.');
    let structured: Record<string, unknown>;
    try { structured = JSON.parse(match[0]); }
    catch { structured = repairTruncatedJson(match[0]); }
    return new Response(JSON.stringify({ ok: true, structured, usage: json.usage ?? {} }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message.slice(0, 500) }), { status: 500, headers: corsHeaders });
  }
});
