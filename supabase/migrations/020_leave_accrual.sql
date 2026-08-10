-- Monthly Annual-Leave accrual + new-joiner leave grants.
--
-- Before this migration leave balances were static: an admin (or the Zoho /
-- CSV import) set `quota` / `carried_forward` once and nothing moved them.
-- This migration makes Annual Leave accrue automatically at +1.25 days per
-- month (capped at a 30-day total balance) and gives every new active
-- employee their opening balances the moment they are added to the directory.
--
-- Balance shown in the UI = quota + carried_forward (see computeBalances in
-- src/types/leave.ts). The "cap at 30" therefore caps quota + carried_forward,
-- and accrual must never *reduce* an existing balance (someone already at or
-- above 30 stays put).
--
-- Self-contained + idempotent: safe to re-apply. It does NOT reference any RLS
-- helper functions (those live only in schema.sql). Year-end rollover
-- (50%/30-day carry-forward for Annual, Casual/Sick lapse) is intentionally
-- OUT OF SCOPE here and ships as a separate upcoming migration.

-- ---------------------------------------------------------------------------
-- 1. Allow 'accrual' as an allocation source.
--    The source CHECK on leave_allocations was created inline (unnamed) in
--    017, so Postgres auto-named it `leave_allocations_source_check`. To stay
--    robust against any renamed/duplicate variant in the live DB, drop EVERY
--    check constraint on the table that references `source`, then re-add a
--    single canonical one that includes 'accrual'.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.leave_allocations'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source%'
  LOOP
    EXECUTE format('ALTER TABLE leave_allocations DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE leave_allocations
  ADD CONSTRAINT leave_allocations_source_check
  CHECK (source IN ('zoho_import','admin','rollover','csv_import','accrual'));

-- ---------------------------------------------------------------------------
-- 2. Idempotency guard: one row per (year, month) that accrual actually ran.
--    accrue_monthly_al() refuses to run twice for the same month, so a
--    double-scheduled cron tick can never double-credit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_accrual_runs (
  year   INT NOT NULL,
  month  INT NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (year, month)
);

-- ---------------------------------------------------------------------------
-- 3. Monthly Annual-Leave accrual.
--    Credits +1.25 days of Annual (leave_type_id = 'annual') to every active
--    employee for the current year, capped so quota + carried_forward never
--    exceeds 30 and never decreases.
--
--    Cap/never-reduce formula for an existing row:
--      quota := GREATEST(quota,                              -- never reduce
--                        LEAST(quota + 1.25,                 -- add the month
--                              30 - carried_forward));       -- cap total at 30
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accrue_monthly_al()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year     INT := EXTRACT(YEAR  FROM now())::int;
  v_month    INT := EXTRACT(MONTH FROM now())::int;
  v_inserted INT;
BEGIN
  -- Guard: claim this month. If the row already exists we've already run.
  INSERT INTO leave_accrual_runs (year, month)
  VALUES (v_year, v_month)
  ON CONFLICT (year, month) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN;  -- already accrued for this month; do nothing.
  END IF;

  INSERT INTO leave_allocations (
    id, employee_email, leave_type_id, year,
    quota, carried_forward, source, created_by, updated_by
  )
  SELECT
    'accrual-annual-' || lower(u.email) || '-' || v_year::text,
    lower(u.email), 'annual', v_year,
    1.25, 0, 'accrual', 'system', 'system'
  FROM authorized_users u
  WHERE u.active IS NOT FALSE
  ON CONFLICT (employee_email, leave_type_id, year) DO UPDATE
  SET quota = GREATEST(
                leave_allocations.quota,
                LEAST(leave_allocations.quota + 1.25,
                      30 - leave_allocations.carried_forward)
              ),
      source     = leave_allocations.source,  -- keep original source label
      updated_by = 'system',
      updated_at = now();
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. New-joiner grant.
--    When an active employee is added to authorized_users, grant their opening
--    balances for the current year:
--      * Casual/Sick ('casual'): 12 days  (keep existing if a row is present)
--      * Annual      ('annual'): first +1.25 (capped at 30 total, never reduce)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_new_employee_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year  INT  := EXTRACT(YEAR FROM now())::int;
  v_email TEXT := lower(NEW.email);
BEGIN
  -- Defensive: only active employees get an opening balance. The trigger's
  -- WHEN clause already enforces this, so this is belt-and-suspenders.
  IF NEW.active IS FALSE THEN
    RETURN NEW;
  END IF;

  -- Casual/Sick: flat 12 days. Keep any existing allocation untouched.
  INSERT INTO leave_allocations (
    id, employee_email, leave_type_id, year,
    quota, carried_forward, source, created_by, updated_by
  )
  VALUES (
    'accrual-casual-' || v_email || '-' || v_year::text,
    v_email, 'casual', v_year,
    12, 0, 'accrual', 'system', 'system'
  )
  ON CONFLICT (employee_email, leave_type_id, year) DO NOTHING;

  -- Annual: first month's +1.25, capped at 30 total, never reduce.
  INSERT INTO leave_allocations (
    id, employee_email, leave_type_id, year,
    quota, carried_forward, source, created_by, updated_by
  )
  VALUES (
    'accrual-annual-' || v_email || '-' || v_year::text,
    v_email, 'annual', v_year,
    1.25, 0, 'accrual', 'system', 'system'
  )
  ON CONFLICT (employee_email, leave_type_id, year) DO UPDATE
  SET quota = GREATEST(
                leave_allocations.quota,
                LEAST(leave_allocations.quota + 1.25,
                      30 - leave_allocations.carried_forward)
              ),
      source     = leave_allocations.source,
      updated_by = 'system',
      updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grant_new_employee_leave ON authorized_users;
CREATE TRIGGER trg_grant_new_employee_leave
  AFTER INSERT ON authorized_users
  FOR EACH ROW
  WHEN (NEW.active IS NOT FALSE)
  EXECUTE FUNCTION public.grant_new_employee_leave();

-- ---------------------------------------------------------------------------
-- 5. Cron registration (ADMIN, run ONCE in the live DB — NOT executed here).
--    cron.schedule statements are applied live and are deliberately NOT
--    committed (see the daily-backup / presales-owner-reminder edge funcs).
--    pg_cron is already enabled on the project. Run this once:
--
--    SELECT cron.schedule('leave-al-accrual', '0 0 1 * *', $$ SELECT public.accrue_monthly_al(); $$);
--
--    ('0 0 1 * *' = 00:00 UTC on the 1st of every month.)
-- ---------------------------------------------------------------------------
