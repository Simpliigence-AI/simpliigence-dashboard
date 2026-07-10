/**
 * Supabase Edge Function: seed-feature-catalog
 *
 * Uses Claude to enumerate a comprehensive Salesforce feature catalog per
 * cloud and upserts it into sf_feature_catalog. Idempotent — running twice
 * updates descriptions / industries but never duplicates by id.
 *
 * Each feature carries:
 *   - cloud (e.g. "Sales Cloud")
 *   - name (e.g. "Territory Management")
 *   - description (what it does, one sentence)
 *   - category (sub-grouping — Automation / AI / Data Model / etc.)
 *   - industries_relevant[] — industries where this feature is typically
 *     used. Empty array = universal (applies to everyone).
 *   - upsell_hint — rough $ upsell we tag on it (0 if unknown)
 *
 * Request body: { clouds?: string[], force?: boolean }
 *   - clouds: optional filter to only seed specific clouds
 *   - force: if true, will regenerate seed rows even if they already exist
 *
 * Response: { ok, upserted, cloudBreakdown, sample: [...] }
 *
 * Requires ANTHROPIC_API_KEY secret.
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
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

/** Salesforce clouds we know about. Feature enumeration happens per-cloud so
 *  each call to Claude is bounded (~15-30 features rather than 200+ at once). */
const CLOUDS = [
  { key: 'Sales Cloud',       hint: 'lead-to-cash automation, opportunity management, forecasting, territory, AE tooling' },
  { key: 'Service Cloud',     hint: 'case management, omnichannel, knowledge, digital engagement (chat, messaging), workforce engagement' },
  { key: 'Field Service',     hint: 'scheduling, dispatch, mobile, work orders, IoT (also known as FSL / ServiceMax)' },
  { key: 'Health Cloud',      hint: 'patient management, care plans, provider relationship management' },
  { key: 'Revenue Cloud',     hint: 'CPQ, Billing, contracts, subscription management, product configurator' },
  { key: 'Commerce Cloud',    hint: 'B2C and B2B storefronts (SFCC / Demandware), catalog, checkout, order management' },
  { key: 'Marketing Cloud',   hint: 'journeys, email, SMS, push, MobileConnect, MobileStudio, personalization, Account Engagement / Pardot' },
  { key: 'Data Cloud',        hint: 'CDP, data lakes, identity resolution, calculated insights, activations' },
  { key: 'Experience Cloud',  hint: 'partner/customer/community portals, LWR templates, gated content' },
  { key: 'MuleSoft',          hint: 'API-led integration, Anypoint, IDP, RPA' },
  { key: 'Einstein / AI',     hint: 'Einstein Prediction Builder, Agentforce, Copilot, Prompt Builder, Bots' },
  { key: 'CRM Analytics',     hint: 'Tableau CRM / Einstein Analytics — dashboards, apps, dataflows, prediction' },
  { key: 'OmniStudio',        hint: 'FlexCards, OmniScripts, DataRaptors, Integration Procedures (formerly Vlocity)' },
  { key: 'Platform',          hint: 'Flow, Apex, LWC, Objects/Fields, Permissions, Shield, Encryption, Sandboxes, DevOps Center' },
];

const INDUSTRIES = [
  'Financial Services', 'Insurance', 'Healthcare', 'Life Sciences / Pharma',
  'Manufacturing', 'Retail', 'Consumer Goods', 'Automotive',
  'Communications', 'Media / Entertainment', 'Energy / Utilities',
  'Technology / SaaS', 'Professional Services', 'Public Sector',
  'Education', 'Non-Profit', 'Real Estate', 'Travel / Hospitality',
];

interface CatalogEntry {
  name: string;
  description: string;
  category: string;
  industries_relevant: string[];
  upsell_hint: number;
  license_tier?: string;
}

const SYSTEM_PROMPT = `You are a Salesforce solution architect. When given a Salesforce cloud, enumerate its MAJOR, DISTINCT capabilities that a customer implementation project would call out separately. Focus on capabilities implementation teams would score independently — not marketing bundles or fine-grained UI features.

Rules:
  1. 15–30 items per cloud. Bias toward comprehensive but not exhaustive — miss a niche add-on before repeating things.
  2. Each item is a single capability at "you either have it or you don't" granularity. Good: "Territory Management", "Einstein Opportunity Scoring", "Case Auto-Assignment Rules". Bad: "Sales Cloud" (too broad), "The subject field on the Case object" (too granular).
  3. Use the industries_relevant array to indicate industries where this feature actually gets deployed. Rules:
     - Empty array = universal (applies to virtually everyone using this cloud).
     - Populated array = feature is typically industry-specific. Include ALL applicable industries.
     - Example: "Utilization Management" is Healthcare-only. "Territory Management" is universal (empty array). "Distributor Management" applies to Manufacturing + Consumer Goods + Automotive.
  4. upsell_hint = rough USD an implementation typically bills to configure this feature. Small features: 5000-15000. Medium: 20000-60000. Large/complex (e.g. Field Service Scheduler, CPQ product config): 75000-200000. If unsure, use 25000.
  5. license_tier — only fill if the feature requires a specific SKU or add-on (e.g. "Sales Engagement", "Einstein 1"). Leave empty otherwise.

Return ONLY JSON in this exact shape (no prose, no markdown fences):
{
  "cloud": "<cloud name verbatim>",
  "features": [
    { "name":"...", "description":"...", "category":"...", "industries_relevant":[], "upsell_hint": 25000, "license_tier":"" },
    ...
  ]
}`;

async function seedCloud(cloudName: string, cloudHint: string): Promise<CatalogEntry[]> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const userPrompt = `Cloud: ${cloudName}
Scope hint: ${cloudHint}

Reference list of industries you may use in industries_relevant:
${INDUSTRIES.join(', ')}

Enumerate the major capabilities of ${cloudName}. Return the JSON.`;

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude (${res.status}): ${(await res.text()).slice(0, 400)}`);
  const j = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const reply = j.content?.find((b) => b.type === 'text')?.text?.trim() || '';
  const cleaned = reply.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned) as { cloud: string; features: CatalogEntry[] };
  return Array.isArray(parsed.features) ? parsed.features : [];
}

/** Deterministic id so re-runs update instead of duplicating. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({})) as { clouds?: string[]; force?: boolean };
    const targetClouds = body.clouds && body.clouds.length > 0
      ? CLOUDS.filter((c) => body.clouds!.includes(c.key))
      : CLOUDS;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let totalUpserted = 0;
    const breakdown: Record<string, number> = {};
    const sample: Array<{ id: string; cloud: string; name: string; industries_relevant: string[] }> = [];

    for (const cloud of targetClouds) {
      let features: CatalogEntry[] = [];
      try {
        features = await seedCloud(cloud.key, cloud.hint);
      } catch (e) {
        console.error(`[seed] failed for ${cloud.key}:`, (e as Error).message);
        breakdown[cloud.key] = 0;
        continue;
      }
      const rows = features.map((f) => ({
        id: `${slug(cloud.key)}--${slug(f.name)}`,
        cloud: cloud.key,
        name: f.name,
        description: f.description || null,
        category: f.category || null,
        industries_relevant: Array.isArray(f.industries_relevant) ? f.industries_relevant : [],
        upsell_hint: typeof f.upsell_hint === 'number' && f.upsell_hint > 0 ? f.upsell_hint : 25000,
        license_tier: f.license_tier || null,
        is_seed: true,
        is_active: true,
        updated_at: new Date().toISOString(),
        updated_by: 'seed-feature-catalog',
      }));
      if (rows.length === 0) { breakdown[cloud.key] = 0; continue; }
      const { error, count } = await supabase
        .from('sf_feature_catalog')
        .upsert(rows, { onConflict: 'id', count: 'exact' });
      if (error) {
        console.error(`[seed] upsert failed for ${cloud.key}:`, error.message);
        breakdown[cloud.key] = 0;
        continue;
      }
      breakdown[cloud.key] = count ?? rows.length;
      totalUpserted += count ?? rows.length;
      for (const r of rows.slice(0, 2)) sample.push({ id: r.id, cloud: r.cloud, name: r.name, industries_relevant: r.industries_relevant });
    }

    return new Response(JSON.stringify({
      ok: true,
      upserted: totalUpserted,
      cloudBreakdown: breakdown,
      sample,
    }, null, 2), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});
