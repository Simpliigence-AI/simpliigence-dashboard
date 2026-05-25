# `zoho-people-sync` — Supabase Edge Function

Real-time proxy for the "Sync from Zoho People" button on the Actual Hours
page. Pulls year-to-date timesheet records from Zoho People's Timetracker API
with a server-side refresh token, normalises field-name drift across Zoho
plans, and returns JSON the dashboard can drop straight into the
`useActualHoursStore`.

## One-time setup

This function reuses the same OAuth `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET`
as `zoho-projects-sync` — but it needs its **own refresh token** with Zoho
People scopes (Projects and People are separate products, and Zoho doesn't
let you mix their scopes in one self-client without re-issuing the token).

### 1. Generate a Zoho People refresh token

1. Open the existing self-client at <https://api-console.zoho.in/> (the same
   one used for `zoho-projects-sync`).
2. Click **Generate Code** with:
   - **Scope**: `ZohoPeople.timetracker.READ,ZohoPeople.attendance.READ,ZohoPeople.employee.READ`
   - **Time Duration**: 10 minutes
   - **Scope Description**: `simpliigence-actual-hours-sync`
3. Copy the `code` that appears.

Within 10 minutes, swap the code for a refresh token:

```bash
curl -X POST "https://accounts.zoho.in/oauth/v2/token" \
  -d "grant_type=authorization_code" \
  -d "client_id=$ZOHO_CLIENT_ID" \
  -d "client_secret=$ZOHO_CLIENT_SECRET" \
  -d "code=<CODE_FROM_STEP_2>"
```

The JSON response contains `refresh_token` — **save it**. It doesn't expire
unless revoked.

### 2. Set Supabase secrets

```bash
cd ~/repos/simpliigence-dashboard

# Already linked? skip. Otherwise:
# supabase link --project-ref mhmxlubithnidopmkwgt

supabase secrets set \
  ZOHO_PEOPLE_REFRESH_TOKEN=<REFRESH_TOKEN_FROM_STEP_1>
```

`ZOHO_DC`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` are already set by the
Projects sync setup.

### 3. Apply the schema migration

Open the Supabase SQL editor and run the `CREATE TABLE actual_hours` block
from [`supabase/schema.sql`](../../schema.sql), plus its index / RLS / realtime statements.

### 4. Deploy the function

```bash
supabase functions deploy zoho-people-sync
```

## Calling it locally

```bash
curl "https://<your-supabase-url>/functions/v1/zoho-people-sync" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Response shape:

```json
{
  "entries": [
    {
      "id": "12345",
      "employee_id": "ZE-001",
      "employee_name": "Asha Kumar",
      "email": "asha@simpliigence.com",
      "project": "QUData",
      "work_date": "2026-04-12",
      "hours": 6.5,
      "billing": "Billable",
      "notes": "Sprint review prep"
    }
  ],
  "syncedAt": "2026-05-14T19:23:01.000Z",
  "range": { "from": "2026-01-01", "to": "2026-05-14" },
  "counts": { "fetched": 1842, "kept": 1842 }
}
```

## Notes

- Field names from Zoho People drift across tenants (`recordId` vs `RecordID`,
  `jobName` vs `Project`, etc.). `normaliseRow()` probes a handful of
  aliases — if your tenant returns something else, add aliases to the
  `pickStr` calls.
- Hours come back as either a decimal number or `"hh:mm"` strings. `parseHours`
  handles both.
- Pagination loops until Zoho returns an empty page; capped at 200 pages
  (40k rows) to avoid run-away requests.
- Rate limit: Zoho People is 60 req/min on most plans, so YTD for ~100
  people (≈5k–10k rows = 25–50 pages) is well within budget.
