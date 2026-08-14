-- 028_leave_requests_decision_update.sql
--
-- Fix: a manager clicking Approve/Reject on /leave left the request pending.
-- The live "Update own or as manager or admin" UPDATE policy on leave_requests
-- (live-DB only — 016/017 do not create policies on disk) gates its admin
-- clause on authorized_users.is_admin, while the app assigns admin via
-- role='admin' (useAuthStore treats is_admin OR role='admin' as admin). A
-- role='admin' row with stale is_admin=false — and/or a manager clause that
-- doesn't match the request's manager_email snapshot — makes the approver's
-- UPDATE fail RLS, so the decision never lands.
--
-- ADDITIVE, like 022: PostgreSQL ORs permissive policies together, so this
-- grants the missing write access WITHOUT touching (or needing the exact text
-- of) the existing live policy. Idempotent; safe to re-run.

ALTER TABLE authorized_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'manager', 'employee'));
ALTER TABLE authorized_users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION current_user_email() RETURNS TEXT
  LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT LOWER(u.email) FROM auth.users u WHERE u.id = auth.uid();
  $$;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT
  LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT role FROM authorized_users WHERE LOWER(email) = current_user_email();
  $$;

-- One-time data heal: align legacy rows the live policy's admin clause would
-- reject (role='admin' assigned via the Users page without is_admin synced).
UPDATE authorized_users SET is_admin = TRUE WHERE role = 'admin' AND NOT is_admin;

ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leave_requests: routed manager or admin update" ON leave_requests;
CREATE POLICY "leave_requests: routed manager or admin update" ON leave_requests
  FOR UPDATE TO authenticated
  USING (
    LOWER(COALESCE(manager_email, '')) = current_user_email()
    OR current_user_role() = 'admin'
    OR EXISTS (SELECT 1 FROM authorized_users au
               WHERE LOWER(au.email) = current_user_email() AND au.is_admin)
  )
  WITH CHECK (
    LOWER(COALESCE(manager_email, '')) = current_user_email()
    OR current_user_role() = 'admin'
    OR EXISTS (SELECT 1 FROM authorized_users au
               WHERE LOWER(au.email) = current_user_email() AND au.is_admin)
  );
