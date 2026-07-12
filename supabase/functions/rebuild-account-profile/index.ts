/**
 * rebuild-account-profile
 *
 * Synthesizes a Concierge account profile from every AI-processed document,
 * existing feature list, industry, billing history, and open opportunities.
 * Writes/upserts concierge_account_profile.
 *
 * Input: { accountId: string }
 * Output: { ok, profile }
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

async function askClaude(prompt: string): Promise<Record<string, unknown>> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY!,
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
  return JSON.parse(match[0]);
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ ok: false, error: 'ANTHROPIC_API_KEY missing' }), { status: 500, headers: corsHeaders });

  let accountId = '';
  try {
    const body = await req.json();
    accountId = body?.accountId;
    if (!accountId) throw new Error('accountId required');
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const [acct, docs, feats, opps, existingProfile] = await Promise.all([
      supabase.from('concierge_accounts').select('id, name, industry, tech_stack, current_work, previous_work, notes').eq('id', accountId).single(),
      supabase.from('concierge_account_documents').select('id, kind, title, ai_summary, ai_topics, meeting_date, uploaded_at').eq('account_id', accountId).eq('ai_status', 'done').order('uploaded_at', { ascending: false }).limit(50),
      supabase.from('concierge_features').select('name, category, status, priority, upsell_estimate').eq('account_id', accountId),
      supabase.from('account_opportunities').select('name, stage_name, amount, close_date').eq('account_id', accountId).limit(20),
      supabase.from('concierge_account_profile').select('refinement_notes').eq('account_id', accountId).maybeSingle(),
    ]);

    if (acct.error || !acct.data) throw new Error(`Account not found: ${acct.error?.message}`);

    const account = acct.data;
    const documents = docs.data ?? [];
    const features = feats.data ?? [];
    const opportunities = opps.data ?? [];
    // Refinements are AUTHORITATIVE user overrides; preserve them across rebuilds.
    const refinementNotes: Array<{ id?: string; note: string; author?: string | null; addedAt?: string }> =
      Array.isArray(existingProfile.data?.refinement_notes) ? existingProfile.data!.refinement_notes : [];

    if (documents.length === 0 && features.length === 0) {
      // Nothing to synthesize from — bail with a friendly empty profile
      await supabase.from('concierge_account_profile').upsert({
        account_id: accountId,
        what_we_do: null,
        key_stakeholders: [],
        technologies: [],
        current_initiatives: [],
        risks: [],
        upsell_opportunities: [],
        cross_sell_opportunities: [],
        source_doc_ids: [],
        refinement_notes: refinementNotes,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ ok: true, profile: null, note: 'No documents or features — upload some to build a profile.' }), { headers: corsHeaders });
    }

    const refinementsBlock = refinementNotes.length === 0
      ? '(none)'
      : refinementNotes.map((r, i) => `${i + 1}. ${r.note}${r.author ? ` — ${r.author}` : ''}${r.addedAt ? ` (${r.addedAt.slice(0, 10)})` : ''}`).join('\n');

    const prompt = `You are Simpliigence's Salesforce consulting AI. Build a synthesized profile for the account below by combining EVERY source. Ground every claim in one of the sources.

USER REFINEMENTS (AUTHORITATIVE — these OVERRIDE any conflicting content from documents, features, or opportunities. Documents may be outdated; these notes represent the current truth as of today.)
${refinementsBlock}

ACCOUNT
Name: ${account.name}
Industry: ${account.industry ?? 'unset'}
Tech Stack (declared): ${(account.tech_stack ?? []).join(', ') || 'none declared'}
Current Work Notes: ${account.current_work ?? '—'}
Previous Work: ${account.previous_work ?? '—'}
Manager Notes: ${account.notes ?? '—'}

FEATURES WE'VE TRACKED (${features.length}):
${features.map((f) => `- [${f.status}] ${f.name} (${f.category ?? 'n/a'}, priority=${f.priority ?? '—'})`).join('\n') || 'none'}

OPEN OPPORTUNITIES (from Salesforce, ${opportunities.length}):
${opportunities.map((o) => `- ${o.name} · ${o.stage_name ?? '—'} · $${o.amount ?? 0} · closes ${o.close_date ?? '—'}`).join('\n') || 'none'}

DOCUMENTS + MEETINGS (${documents.length}):
${documents.map((d) => `### [${d.kind}] ${d.title}${d.meeting_date ? ' — ' + d.meeting_date : ''}
Summary: ${d.ai_summary ?? '(no summary)'}
Topics: ${JSON.stringify(d.ai_topics ?? {}).slice(0, 2000)}`).join('\n\n')}

Return ONLY a JSON object with these keys (empty arrays are fine):
{
  "what_we_do": "3-8 sentence narrative of what Simpliigence is delivering for this account today, grounded in the evidence above",
  "key_stakeholders": [ { "name": "...", "role": "...", "notes": "why they matter" } ],
  "technologies": [ "Salesforce Sales Cloud", "Marketing Cloud Engagement", "..." ],
  "current_initiatives": [ { "title": "short", "description": "what & why" } ],
  "risks": [ { "title": "...", "severity": "low|medium|high", "notes": "..." } ],
  "upsell_opportunities": [ { "title": "...", "cloud": "Sales Cloud|Service Cloud|...", "rationale": "why now, tied to evidence", "upsell_estimate_usd": 0 } ],
  "cross_sell_opportunities": [ { "title": "...", "cloud": "...", "rationale": "...", "upsell_estimate_usd": 0 } ]
}

Rules:
- USER REFINEMENTS above are ground truth. If a document says X but a refinement says "X is no longer the priority" or "we've moved to Y", trust the refinement and reflect it. Do NOT include contradictory items just because they appear in older documents.
- Dedupe: don't repeat the same stakeholder/technology across documents.
- Never invent people or budgets. If unknown, omit.
- upsell_opportunities are for products the account already uses (deeper adoption).
- cross_sell_opportunities are for products NOT yet in their stack (new clouds/features).
- upsell_estimate_usd is annual, best-effort, 0 if unknown.
- Do NOT wrap the JSON in code fences.`;

    const profile = await askClaude(prompt);

    const row = {
      account_id: accountId,
      what_we_do: profile.what_we_do ?? null,
      key_stakeholders: profile.key_stakeholders ?? [],
      technologies: profile.technologies ?? [],
      current_initiatives: profile.current_initiatives ?? [],
      risks: profile.risks ?? [],
      upsell_opportunities: profile.upsell_opportunities ?? [],
      cross_sell_opportunities: profile.cross_sell_opportunities ?? [],
      source_doc_ids: documents.map((d) => d.id),
      refinement_notes: refinementNotes,   // preserve across rebuild
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error: upErr } = await supabase.from('concierge_account_profile').upsert(row);
    if (upErr) throw new Error(`Upsert failed: ${upErr.message}`);

    return new Response(JSON.stringify({ ok: true, profile: row }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message.slice(0, 500) }), { status: 500, headers: corsHeaders });
  }
});
