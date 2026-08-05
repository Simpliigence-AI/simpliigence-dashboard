-- Fix: new users could not sign in ("Database error saving new user").
--
-- Root cause. Migration 020 created an AFTER INSERT trigger on
-- authorized_users (trg_grant_new_employee_leave -> grant_new_employee_leave)
-- that grants opening leave balances the moment a row is added. The live
-- auth->authorized_users provisioning inserts that row on a new user's FIRST
-- sign-in, firing the trigger. But grant_new_employee_leave() (and the monthly
-- accrue_monthly_al() cron function) referenced leave types by the literal ids
-- 'annual' / 'casual'. In the live catalog those types do NOT have those ids:
-- migration 018 seeded the catalog with ON CONFLICT (code), so the pre-existing
-- rows kept their app-assigned nanoid ids and only carry codes AL / CL. The
-- INSERT into leave_allocations therefore hit a NOT NULL FK
-- (leave_allocations.leave_type_id -> leave_types(id), 017), the whole
-- transaction rolled back INCLUDING the auth user creation, and GoTrue returned
-- "Database error saving new user" -- blocking every first-time sign-in.
--
-- Fix. Make both functions resilient and code-aware:
--   1. Resolve the real leave_types.id by matching EITHER id OR code
--      (id='annual' OR upper(code)='AL'; id='casual' OR upper(code)='CL'),
--      so they work whether the catalog uses id='annual' or a nanoid+code='AL'.
--   2. Only INSERT when a matching leave type is found (skip gracefully).
--   3. grant_new_employee_leave() additionally wraps its body in an
--      EXCEPTION WHEN OTHERS guard (RAISE WARNING; RETURN NEW) so a leave-grant
--      failure can NEVER again roll back user creation -- the grant is
--      best-effort and must not block sign-in.
--
-- Quota/cap logic is preserved exactly: Casual flat 12; Annual +1.25 capped at
-- a 30-day total balance (quota + carried_forward) and never reduced.
--
-- Idempotent (CREATE OR REPLACE FUNCTION). The trigger is re-asserted identical
-- to 020. leave_allocations.id is TEXT (017), so the existing id-string shape is
-- kept unchanged.

-- ---------------------------------------------------------------------------
-- 1. Monthly Annual-Leave accrual -- now resolves Annual by id OR code.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accrue_monthly_al()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year      INT := EXTRACT(YEAR  FROM now())::int;
  v_month     INT := EXTRACT(MONTH FROM now())::int;
  v_inserted  INT;
  v_annual_id TEXT;
BEGIN
  -- Guard: claim this month. If the row already exists we've already run.
  INSERT INTO leave_accrual_runs (year, month)
  VALUES (v_year, v_month)
  ON CONFLICT (year, month) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN;  -- already accrued for this month; do nothing.
  END IF;

  -- Resolve the real Annual leave type by id OR code. Prefer id='annual' when
  -- both exist, then prefer an active type.
  SELECT id INTO v_annual_id
  FROM leave_types
  WHERE id = 'annual' OR upper(code) = 'AL'
  ORDER BY (id = 'annual') DESC, active DESC
  LIMIT 1;

  -- No Annual type in the catalog -> nothing to accrue.
  IF v_annual_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO leave_allocations (
    id, employee_email, leave_type_id, year,
    quota, carried_forward, source, created_by, updated_by
  )
  SELECT
    'accrual-annual-' || lower(u.email) || '-' || v_year::text,
    lower(u.email), v_annual_id, v_year,
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
-- 2. New-joiner grant -- resolves types by id OR code, guarded so it can never
--    roll back user creation.
--      * Casual/Sick: 12 days  (keep existing if a row is present)
--      * Annual:      first +1.25 (capped at 30 total, never reduce)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_new_employee_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year      INT  := EXTRACT(YEAR FROM now())::int;
  v_email     TEXT := lower(NEW.email);
  v_casual_id TEXT;
  v_annual_id TEXT;
BEGIN
  -- Defensive: only active employees get an opening balance. The trigger's
  -- WHEN clause already enforces this, so this is belt-and-suspenders.
  IF NEW.active IS FALSE THEN
    RETURN NEW;
  END IF;

  -- Resolve the real leave types by id OR code. Prefer the literal id when both
  -- exist, then prefer an active type.
  SELECT id INTO v_casual_id
  FROM leave_types
  WHERE id = 'casual' OR upper(code) = 'CL'
  ORDER BY (id = 'casual') DESC, active DESC
  LIMIT 1;

  SELECT id INTO v_annual_id
  FROM leave_types
  WHERE id = 'annual' OR upper(code) = 'AL'
  ORDER BY (id = 'annual') DESC, active DESC
  LIMIT 1;

  -- Casual/Sick: flat 12 days. Keep any existing allocation untouched.
  IF v_casual_id IS NOT NULL THEN
    INSERT INTO leave_allocations (
      id, employee_email, leave_type_id, year,
      quota, carried_forward, source, created_by, updated_by
    )
    VALUES (
      'accrual-casual-' || v_email || '-' || v_year::text,
      v_email, v_casual_id, v_year,
      12, 0, 'accrual', 'system', 'system'
    )
    ON CONFLICT (employee_email, leave_type_id, year) DO NOTHING;
  END IF;

  -- Annual: first month's +1.25, capped at 30 total, never reduce.
  IF v_annual_id IS NOT NULL THEN
    INSERT INTO leave_allocations (
      id, employee_email, leave_type_id, year,
      quota, carried_forward, source, created_by, updated_by
    )
    VALUES (
      'accrual-annual-' || v_email || '-' || v_year::text,
      v_email, v_annual_id, v_year,
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
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Best-effort grant: a leave-grant failure must NEVER roll back the
  -- authorized_users insert (and thus the auth user creation / sign-in).
  RAISE WARNING 'grant_new_employee_leave skipped for %: %', v_email, SQLERRM;
  RETURN NEW;
END;
$$;

-- Re-assert the trigger identical to 020 (function replacement above already
-- takes effect; this is kept for a clean `supabase db reset`).
DROP TRIGGER IF EXISTS trg_grant_new_employee_leave ON authorized_users;
CREATE TRIGGER trg_grant_new_employee_leave
  AFTER INSERT ON authorized_users
  FOR EACH ROW
  WHEN (NEW.active IS NOT FALSE)
  EXECUTE FUNCTION public.grant_new_employee_leave();
