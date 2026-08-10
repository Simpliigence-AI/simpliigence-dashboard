-- 022_leave_requests_manager_read.sql
--
-- Additive: lets admins/managers read ALL leave requests (for the new Team
-- Leave view). Before this, the leave_requests SELECT policy limited a
-- non-admin to (own requests | requests where they are the manager_email), so
-- a manager could not see the full team's leave.
--
-- IMPORTANT — why this is ADDITIVE rather than a DROP/replace: the existing
-- per-user/per-manager SELECT policy on leave_requests lives ONLY in the
-- live-applied DB (migration 016 documents "see live-applied migration" and
-- does NOT create the policies on disk), so its exact name is unknown here.
-- PostgreSQL ORs multiple PERMISSIVE SELECT policies together, so adding a new
-- permissive policy grants the extra access WITHOUT needing to touch — or even
-- know the name of — the existing one. The existing policy is left intact.
--
-- Self-contained / idempotent, matching the style of migrations 018 / 021:
-- the helper (and its prereq column) are re-created verbatim from schema.sql
-- with CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS, since the leave RLS lives
-- only in the live DB.

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

-- ---------------------------------------------------------------------------
-- RLS already enabled by 016; re-assert idempotently to be safe.
-- ---------------------------------------------------------------------------
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- The additive permissive read-all policy.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "leave_requests: admin/manager read all" ON leave_requests;
CREATE POLICY "leave_requests: admin/manager read all" ON leave_requests
  FOR SELECT TO authenticated
  USING (current_user_role() IN ('admin','manager'));
