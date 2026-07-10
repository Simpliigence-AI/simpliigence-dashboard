/**
 * Supabase Edge Function: salesforce-sync-account
 *
 * Given a dashboard account that's already linked to a Salesforce Account
 * (via salesforce_account_link), pull the latest Contacts + OPEN Opportunities
 * from Salesforce and upsert them into account_client_contacts and
 * account_opportunities with source='salesforce'.
 *
 * NEVER touches source='manual' rows — those are hand-typed by the team and
 * stay intact. Prunes stale SF rows that are no longer returned (either
 * deleted in SF or the Opportunity closed).
 *
 * Required secrets: SF_CLIENT_ID, SF_CLIENT_SECRET, SF_INSTANCE_URL.
 *
 * Request body: { dashboardAccountId: string }
 * Response: { ok, contacts: {upserted, pruned}, opportunities: {upserted, pruned}, syncedAt }
 */

// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="deno.ns" />

// @ts-expect-error Deno global
const env = (name: string) => Deno.env.get(name);
// @ts-expect-error esm.sh runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SF_CLIENT_ID = env('SF_CLIENT_ID');
const SF_CLIENT_SECRET = env('SF_CLIENT_SECRET');
const SF_INSTANCE_URL = (env('SF_INSTANCE_URL') || '').replace(/\/$/, '');
const SUPABASE_URL = env('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

async function getSalesforceToken(): Promise<{ accessToken: string; instanceUrl: string }> {
  if (!SF_CLIENT_ID || !SF_CLIENT_SECRET || !SF_INSTANCE_URL) {
    throw new Error('Missing SF_CLIENT_ID / SF_CLIENT_SECRET / SF_INSTANCE_URL secrets');
  }
  const res = await fetch(`${SF_INSTANCE_URL}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: SF_CLIENT_ID, client_secret: SF_CLIENT_SECRET }),
  });
  if (!res.ok) throw new Error(`SF OAuth (${res.status}): ${(await res.text()).slice(0, 400)}`);
  const j = await res.json() as { access_token: string; instance_url?: string };
  return { accessToken: j.access_token, instanceUrl: (j.instance_url || SF_INSTANCE_URL).replace(/\/$/, '') };
}

async function soql<T>(instanceUrl: string, accessToken: string, query: string): Promise<T[]> {
  const res = await fetch(`${instanceUrl}/services/data/v60.0/query?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`SOQL (${res.status}): ${(await res.text()).slice(0, 400)}`);
  const j = await res.json() as { records: T[] };
  return j.records;
}

// @ts-expect-error Deno global
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const syncedAt = new Date().toISOString();
  try {
    const { dashboardAccountId } = await req.json() as { dashboardAccountId?: string };
    if (!dashboardAccountId) {
      return new Response(JSON.stringify({ error: 'dashboardAccountId required' }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Look up the SF account id we're linked to
    const { data: link, error: linkErr } = await supabase
      .from('salesforce_account_link')
      .select('sf_account_id, sf_account_name')
      .eq('dashboard_account_id', dashboardAccountId)
      .maybeSingle();
    if (linkErr) throw linkErr;
    if (!link) {
      return new Response(JSON.stringify({
        error: 'This account is not linked to Salesforce yet. Run salesforce-match-account first.',
      }), { status: 400, headers: corsHeaders });
    }

    const { accessToken, instanceUrl } = await getSalesforceToken();
    const sfId = link.sf_account_id.replace(/'/g, '');

    // 2. Fetch Contacts
    const contacts = await soql<{
      Id: string; FirstName: string | null; LastName: string | null; Name: string;
      Email: string | null; Phone: string | null; Title: string | null; Department: string | null;
      LastModifiedDate: string;
    }>(instanceUrl, accessToken, `
      SELECT Id, FirstName, LastName, Name, Email, Phone, Title, Department, LastModifiedDate
      FROM Contact
      WHERE AccountId = '${sfId}'
      ORDER BY LastModifiedDate DESC
      LIMIT 500
    `);

    // 3. Fetch OPEN Opportunities
    const opps = await soql<{
      Id: string; Name: string; StageName: string; Amount: number | null;
      CloseDate: string | null; Probability: number | null;
      Description: string | null; Owner?: { Name: string | null; Email?: string | null };
      LastModifiedDate: string;
    }>(instanceUrl, accessToken, `
      SELECT Id, Name, StageName, Amount, CloseDate, Probability, Description,
             Owner.Name, Owner.Email, LastModifiedDate
      FROM Opportunity
      WHERE AccountId = '${sfId}' AND IsClosed = false
      ORDER BY CloseDate ASC NULLS LAST
      LIMIT 500
    `);

    // 4. Upsert Contacts — one row per SF Contact, keyed by salesforce_id
    let contactUpserts = 0;
    const contactRows = contacts.map((c) => ({
      id: `sf-${c.Id}`,                       // synthetic dashboard id, stable across syncs
      account_id: dashboardAccountId,
      name: c.Name || `${c.FirstName || ''} ${c.LastName || ''}`.trim(),
      email: c.Email,
      phone: c.Phone,
      title: c.Title,                         // account_client_contacts uses `title`, not `role`
      notes: c.Department ? `Department: ${c.Department}` : null,
      source: 'salesforce',
      salesforce_id: c.Id,
      synced_at: syncedAt,
      updated_by: 'sf-sync',
      updated_at: syncedAt,
    }));
    if (contactRows.length > 0) {
      const { error, count } = await supabase.from('account_client_contacts')
        .upsert(contactRows, { onConflict: 'id', count: 'exact' });
      if (error) throw new Error(`Contact upsert failed: ${error.message}`);
      contactUpserts = count ?? contactRows.length;
    }

    // 5. Upsert Opportunities
    let oppUpserts = 0;
    const oppRows = opps.map((o) => ({
      id: `sf-${o.Id}`,
      account_id: dashboardAccountId,
      opp_type: 'cross_sell',                 // best-effort; user can re-classify manually
      title: o.Name,
      description: o.Description || '',
      value_estimate: o.Amount,
      owner_email: o.Owner?.Email || null,
      status: mapStageToStatus(o.StageName),
      target_date: o.CloseDate,
      notes: `Salesforce Stage: ${o.StageName}${o.Owner?.Name ? ` · Owner: ${o.Owner.Name}` : ''}`,
      stage_name: o.StageName,
      close_date: o.CloseDate,
      probability: o.Probability,
      source: 'salesforce',
      salesforce_id: o.Id,
      synced_at: syncedAt,
      updated_by: 'sf-sync',
      updated_at: syncedAt,
    }));
    if (oppRows.length > 0) {
      const { error, count } = await supabase.from('account_opportunities')
        .upsert(oppRows, { onConflict: 'id', count: 'exact' });
      if (error) throw new Error(`Opportunity upsert failed: ${error.message}`);
      oppUpserts = count ?? oppRows.length;
    }

    // 6. Prune SF-sourced rows that are no longer in SF for this account
    //    (contact was deleted in SF, or opp was closed). NEVER touches
    //    source='manual' — that's the whole point of the source column.
    const sfContactIds = contacts.map((c) => c.Id);
    const { count: contactPruned } = await supabase.from('account_client_contacts')
      .delete({ count: 'exact' })
      .eq('account_id', dashboardAccountId)
      .eq('source', 'salesforce')
      .not('salesforce_id', 'in', `(${sfContactIds.map((i) => `"${i}"`).join(',') || '""'})`);

    const sfOppIds = opps.map((o) => o.Id);
    const { count: oppPruned } = await supabase.from('account_opportunities')
      .delete({ count: 'exact' })
      .eq('account_id', dashboardAccountId)
      .eq('source', 'salesforce')
      .not('salesforce_id', 'in', `(${sfOppIds.map((i) => `"${i}"`).join(',') || '""'})`);

    // 7. Update link metadata
    await supabase.from('salesforce_account_link').update({
      last_synced_at: syncedAt,
      last_sync_status: 'ok',
      last_sync_error: null,
    }).eq('dashboard_account_id', dashboardAccountId);

    return new Response(JSON.stringify({
      ok: true,
      sfAccountName: link.sf_account_name,
      contacts: { upserted: contactUpserts, pruned: contactPruned || 0, total: contacts.length },
      opportunities: { upserted: oppUpserts, pruned: oppPruned || 0, total: opps.length },
      syncedAt,
    }, null, 2), { headers: corsHeaders });
  } catch (e) {
    // Best-effort record of the failure so the UI can surface it
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { dashboardAccountId } = await req.clone().json().catch(() => ({ dashboardAccountId: null }));
      if (dashboardAccountId) {
        await supabase.from('salesforce_account_link').update({
          last_sync_status: 'error',
          last_sync_error: (e as Error).message,
        }).eq('dashboard_account_id', dashboardAccountId);
      }
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: corsHeaders });
  }
});

/** Map SF Opportunity stages to our internal status enum
 *  (identified | pursuing | proposed | won | lost | paused). */
function mapStageToStatus(stage: string): string {
  const s = (stage || '').toLowerCase();
  if (s.includes('closed won') || s.includes('won')) return 'won';
  if (s.includes('closed lost') || s.includes('lost')) return 'lost';
  if (s.includes('propos') || s.includes('quote') || s.includes('negoti')) return 'proposed';
  if (s.includes('qualif') || s.includes('discovery') || s.includes('demo') || s.includes('value') || s.includes('perception')) return 'pursuing';
  if (s.includes('hold') || s.includes('paus')) return 'paused';
  return 'identified';
}
