/**
 * sync-india-roster-planning
 *
 * Pulls active India roster positions from the Sales Planning 2026 app
 * (simpliigence-sales-planning-2026.vercel.app/api/inputs) and upserts them
 * into india_roster. Only touches rows with source='planning-2026' — bench
 * rows and anything else stay untouched.
 *
 * "Active" heuristic: position.sowEnd (month code jan..dec) >= current month.
 * A person whose SOW ends in the past is considered rolled off and removed
 * from the roster (but only if they were previously planning-2026 sourced).
 *
 * Auth to planning-2026: HTTP Basic via PLANNING_2026_USER / PLANNING_2026_PASS
 * secrets. Reuses the same creds the finance-dashboard is already using.
 *
 * Request:  POST (empty body; option: { dryRun?: boolean })
 * Response: { ok, added, updated, removed, kept, active, source, dryRun }
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);
// @ts-expect-error esm.sh runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;
const PLANNING_2026_URL = env('PLANNING_2026_URL') || 'https://simpliigence-sales-planning-2026.vercel.app';
const PLANNING_2026_USER = env('PLANNING_2026_USER');
const PLANNING_2026_PASS = env('PLANNING_2026_PASS');

const SOURCE = 'planning-2026';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

interface PlanningPosition {
  id: number;
  rankId?: number;
  role: string;               // person's name in this dataset
  location: string;           // 'India' | 'USA' | ...
  count: number;
  rate?: number;              // bill rate in USD/hr
  cost?: number;              // cost rate in USD/hr
  hours?: number;
  sowEnd?: string;            // month code
  startMonth?: string;        // month code
  safeEnd?: string;
  createdAt?: string;
}

/** Strip to lowercase alphanumeric only. Handles whitespace and punctuation
 *  variants like "Ravi Kumar" ↔ "Ravikumar", "A / B" ↔ "A/B". */
function normName(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Iterative Levenshtein — O(n*m) memory-efficient. Used to catch spelling
 *  drift like "Samsheer" ↔ "Samsher" or "Geetanjali" ↔ "Gitanjali" that
 *  exact-normalized matching misses. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Match a candidate normalized name against a map by exact first, then
 *  fuzzy with Levenshtein ≤ 2 among names of similar length (guards against
 *  false positives — "Ravi" vs "Ravi Shah" would be dist=4 anyway). */
function findMatch(nNorm: string, map: Map<string, string>): string | null {
  const exact = map.get(nNorm);
  if (exact) return exact;
  let bestKey: string | null = null;
  let bestDist = 3;
  for (const [key, id] of map) {
    // Skip obvious length mismatches to keep cost sane
    if (Math.abs(key.length - nNorm.length) > 2) continue;
    const d = levenshtein(nNorm, key);
    if (d < bestDist) { bestDist = d; bestKey = key; if (d === 0) break; }
  }
  return bestKey ? map.get(bestKey)! : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!PLANNING_2026_USER || !PLANNING_2026_PASS) {
    return new Response(JSON.stringify({ ok: false, error: 'PLANNING_2026_USER / PLANNING_2026_PASS not configured' }), { status: 500, headers: corsHeaders });
  }

  // Parse optional dry-run flag
  let dryRun = false;
  try {
    const body = req.body ? await req.json() : null;
    dryRun = !!body?.dryRun;
  } catch { /* empty body is fine */ }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Fetch from planning-2026
    const auth = btoa(`${PLANNING_2026_USER}:${PLANNING_2026_PASS}`);
    const res = await fetch(`${PLANNING_2026_URL}/api/inputs`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) throw new Error(`planning-2026 /api/inputs → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const positions: PlanningPosition[] = Array.isArray(data?.positions) ? data.positions : [];

    // 2. Filter to India + active. Active = sowEnd month >= current month.
    const nowMonthIdx = new Date().getUTCMonth();  // 0..11
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const active = positions.filter((p: any) => {
      if ((p.location || '').toLowerCase() !== 'india') return false;
      const end = (p.sowEnd || '').toLowerCase();
      if (!end) return true;   // no SOW end declared → assume active
      const endIdx = MONTHS.indexOf(end as typeof MONTHS[number]);
      if (endIdx === -1) return true;
      return endIdx >= nowMonthIdx;
    });

    // 3. Load current planning-2026-tagged rows so we can diff.
    const { data: existingRows, error: exErr } = await supabase
      .from('india_roster')
      .select('id, name, source')
      .eq('source', SOURCE);
    if (exErr) throw new Error(`load existing: ${exErr.message}`);
    const existingByName = new Map<string, string>();  // name-lower → id
    for (const r of (existingRows ?? [])) existingByName.set(normName(r.name), r.id);

    // 4. Also load matching Billable rows from other sources so a first
    //    sync migrates them into planning-2026 ownership rather than
    //    duplicating people who already exist under source='manual'.
    const { data: manualBillable } = await supabase
      .from('india_roster')
      .select('id, name, source, status')
      .neq('source', SOURCE);
    const manualBillableByName = new Map<string, string>();  // normName → id
    for (const r of (manualBillable ?? [])) {
      manualBillableByName.set(normName(r.name), r.id);
    }

    // 5. Upsert each active position. touchedNames is populated in BOTH
    //    dry-run and live paths so the removal count is accurate for both.
    const now = new Date().toISOString();
    let added = 0, updated = 0;
    const touchedNames = new Set<string>();
    for (const p of active) {
      const key = normName(p.role);
      if (!key) continue;
      touchedNames.add(key);
      // In dry-run, do the classification (add vs update) without writing.
      if (dryRun) {
        const foundExisting = findMatch(key, existingByName);
        const foundManual = foundExisting ? null : findMatch(key, manualBillableByName);
        if (foundExisting || foundManual) updated += 1;
        else added += 1;
      }
    }
    if (!dryRun) {
      for (const p of active) {
        const key = normName(p.role);
        if (!key) continue;
        // Fields this sync OWNS (SOW-derived). Anything not listed here is
        // preserved on update so we don't destroy manually-entered data
        // (project assignments, role labels, skills, notes, etc.).
        const ownedPatch = {
          name: p.role.trim(),
          status: 'Billable',
          bill_rate: typeof p.rate === 'number' ? p.rate : null,
          cost_per_hour: typeof p.cost === 'number' ? p.cost : null,
          source: SOURCE,
          updated_at: now,
          updated_by: 'planning-2026-sync',
        };
        const sowNote = p.sowEnd ? `Planning-2026: SOW ends ${p.sowEnd}${p.safeEnd ? ` · safe end ${p.safeEnd}` : ''}` : null;

        const existingId = findMatch(key, existingByName);
        const conflictingManualId = existingId ? null : findMatch(key, manualBillableByName);
        if (existingId) {
          // Preserve existing project/role/skills/notes on an already-
          // synced row. Only update the SOW-owned fields.
          const { error } = await supabase.from('india_roster').update(ownedPatch).eq('id', existingId);
          if (error) throw new Error(`update ${p.role}: ${error.message}`);
          updated += 1;
        } else if (conflictingManualId) {
          // First time this person is being migrated to planning-2026
          // ownership. Update owned fields but do NOT touch project or
          // role — those are user-entered and precious.
          const { error } = await supabase.from('india_roster').update(ownedPatch).eq('id', conflictingManualId);
          if (error) throw new Error(`migrate ${p.role}: ${error.message}`);
          updated += 1;
        } else {
          // Brand-new person. project/role start blank — the user fills
          // them in on the India Roster page.
          const insertRow = {
            id: crypto.randomUUID(),
            ...ownedPatch,
            project: null as string | null,
            role: null as string | null,
            skills: [],
            notes: sowNote,
          };
          const { error } = await supabase.from('india_roster').insert(insertRow);
          if (error) throw new Error(`insert ${p.role}: ${error.message}`);
          added += 1;
        }
      }
    }

    // 6. Remove planning-2026 rows that weren't touched (rolled off).
    let removed = 0;
    const staleIds: string[] = [];
    for (const [name, id] of existingByName) {
      if (!touchedNames.has(name)) staleIds.push(id);
    }
    if (staleIds.length > 0 && !dryRun) {
      const { error } = await supabase.from('india_roster').delete().in('id', staleIds);
      if (error) throw new Error(`remove stale: ${error.message}`);
      removed = staleIds.length;
    } else if (dryRun) {
      removed = staleIds.length;   // would-be count
    }

    // 7. Report
    return new Response(JSON.stringify({
      ok: true,
      dryRun,
      source: SOURCE,
      active: active.length,
      added,
      updated,
      removed,
      kept: (existingRows ?? []).length - removed,
    }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message.slice(0, 500) }), { status: 500, headers: corsHeaders });
  }
});
