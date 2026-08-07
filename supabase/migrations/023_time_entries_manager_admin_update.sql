-- 023_time_entries_manager_admin_update.sql
--
-- Additive: lets admins/managers UPDATE any time_entries row (edits on the
-- Team Time page, plus approve/reject writes). Before this, manager/admin
-- edits to a timesheet entry silently updated 0 rows.
--
-- WHY (confirmed against the live DB): the UPDATE policy that is actually
-- applied to prod is named "Update: own (draft/rejected) or admin" and only
-- permits the OWNER updating their own draft/rejected row; its "admin" branch
-- does NOT recognize role-based admins/managers, so even a user whose
-- authorized_users.role='admin' matches zero rows on UPDATE. Meanwhile the
-- READ policy uses `current_user_role() IN ('admin','manager')` and DOES
-- recognize them (they can see every entry). Read and update therefore check
-- "admin" differently, which is why viewing works but editing silently fails.
-- The tracked schema (supabase/schema.sql §15) already has the correct
-- `... OR current_user_role() IN ('admin','manager')` branch in its UPDATE
-- policy, but schema.sql is not a migration and that branch was never applied
-- to the live DB — committed SQL drifted from prod.
--
-- This ALSO fixes manager approve/reject on Team Time: those are UPDATE writes
-- (setting status='approved'/'rejected'), so they were failing the same silent
-- zero-row way.
--
-- WHY ADDITIVE rather than DROP/replace: PostgreSQL ORs multiple PERMISSIVE
-- policies for the same command, so adding a new permissive UPDATE policy
-- grants the extra access WITHOUT needing to touch — or even know the exact
-- text/name of — the existing live-only, drifted policy. The existing policy
-- is left intact. This is the same additive approach migrations 018 and 022
-- used. The new policy uses the SAME role check as the read policy, which is
-- proven to recognize admins/managers.
--
-- Self-contained / idempotent, matching the style of
-- 022_leave_requests_manager_read.sql / 018_timesheet_docs_manager_insert.sql:
-- the authorized_users.role column and the current_user_email/current_user_role
-- helpers are re-created verbatim from schema.sql §14 with
-- ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE, so current_user_role() resolves
-- regardless of prior migration state.

-- ---------------------------------------------------------------------------
-- Prereqs: authorized_users.role column + current_user_email/role helpers.
-- Verbatim from schema.sql §14. Idempotent.
-- ---------------------------------------------------------------------------
ALTER TABLE authorized_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'manager', 'employee'));

CREATE OR REPLACE FUNCTION current_user_email() RETURNS TEXT
  LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT LOWER(u.email) FROM auth.users u WHERE u.id = auth.uid();
  $$;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT
  LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT role FROM authorized_users WHERE LOWER(email) = current_user_email();
  $$;

GRANT EXECUTE ON FUNCTION current_user_email() TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_role()  TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS already enabled by schema.sql §15; re-assert idempotently to be safe.
-- ---------------------------------------------------------------------------
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- The additive permissive UPDATE policy — same role check as the read policy.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "time_entries: admin/manager update" ON time_entries;
CREATE POLICY "time_entries: admin/manager update" ON time_entries
  FOR UPDATE TO authenticated
  USING (current_user_role() IN ('admin','manager'))
  WITH CHECK (current_user_role() IN ('admin','manager'));
