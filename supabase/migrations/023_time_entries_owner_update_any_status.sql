-- 023_time_entries_owner_update_any_status.sql
--
-- Employees could previously NOT edit their own SUBMITTED (pending-approval)
-- time entries: the live time_entries UPDATE policy's owner branch is
--
--   LOWER(employee_email) = current_user_email()
--     AND status IN ('draft','rejected','approved')
--
-- so a submitted entry was locked for its owner until a manager approved or
-- rejected it. This migration lets owners edit their OWN entries in ANY
-- status. The WITH CHECK keeps them from reassigning the row to someone else
-- (note: WITH CHECK only constrains the NEW row's employee_email to still be
-- their own — other columns, e.g. status, remain governed by the table's
-- CHECK constraints and the client's re-open-for-approval logic).
--
-- ADDITIVE, like migrations 018 / 022: PostgreSQL ORs multiple PERMISSIVE
-- policies for the same command together, so this new policy widens access
-- without touching (or needing the exact live shape of) the existing
-- "Update: own (draft/rejected/approved) or admin" policy, which is left
-- intact for the manager/admin branches.
--
-- Self-contained / idempotent per house style: the helper is re-created
-- verbatim from schema.sql with CREATE OR REPLACE, EXECUTE is granted, and
-- RLS is re-asserted idempotently.

-- ---------------------------------------------------------------------------
-- Prereq: current_user_email() helper. Verbatim from schema.sql §14.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION current_user_email() RETURNS TEXT
  LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT LOWER(u.email) FROM auth.users u WHERE u.id = auth.uid();
  $$;

GRANT EXECUTE ON FUNCTION current_user_email() TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS already enabled by schema.sql; re-assert idempotently to be safe.
-- ---------------------------------------------------------------------------
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- The additive permissive owner-update policy.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "time_entries: owner update any status" ON time_entries;
CREATE POLICY "time_entries: owner update any status" ON time_entries
  FOR UPDATE TO authenticated
  USING (LOWER(employee_email) = current_user_email())
  WITH CHECK (LOWER(employee_email) = current_user_email());
