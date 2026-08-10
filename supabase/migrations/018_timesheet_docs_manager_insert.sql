-- Allow managers/admins to UPLOAD timesheet documents for their team.
--
-- Background: 016_timesheet_documents.sql created the timesheet_documents table
-- and the 'timesheet-documents' storage bucket policies. Their SELECT/UPDATE
-- policies already allow own + reports_to + admin/manager, but the two INSERT
-- policies were locked to "own" only. That blocks the Team Time page from
-- attaching a client-approved timesheet on an employee's behalf.
--
-- This migration loosens BOTH INSERT policies (table + storage object) to mirror
-- the SELECT/UPDATE policies: own row/folder, a direct report's, or any when the
-- caller is admin/manager. No table/data/bucket changes.
--
-- SELF-CONTAINED & idempotent, matching 016: (re)creates the authorized_users
-- identity columns and the current_user_email / current_user_role / reports_to
-- helper functions (verbatim from schema.sql) before referencing them, then
-- DROP POLICY IF EXISTS ... ; CREATE POLICY ... for each policy.

-- ────────────────────────────────────────────────────────────────────
-- 0. Identity model prerequisites (idempotent). Copied verbatim from
--    supabase/schema.sql / migration 016 so prod matches the tracked schema.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE authorized_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'manager', 'employee')),
  ADD COLUMN IF NOT EXISTS employee_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS manager_email TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

CREATE OR REPLACE FUNCTION current_user_email() RETURNS TEXT
  LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT LOWER(u.email) FROM auth.users u WHERE u.id = auth.uid();
  $$;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT
  LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT role FROM authorized_users WHERE LOWER(email) = current_user_email();
  $$;

CREATE OR REPLACE FUNCTION reports_to(target_email TEXT) RETURNS BOOLEAN
  LANGUAGE SQL SECURITY DEFINER STABLE AS $$
    SELECT EXISTS (
      SELECT 1 FROM authorized_users
      WHERE LOWER(email) = LOWER(target_email)
        AND LOWER(manager_email) = current_user_email()
    );
  $$;

GRANT EXECUTE ON FUNCTION current_user_email()        TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_role()         TO authenticated;
GRANT EXECUTE ON FUNCTION reports_to(TEXT)            TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 1. timesheet_documents INSERT policy — own, report's, or admin/manager.
-- ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Insert: own" ON timesheet_documents;
CREATE POLICY "Insert: own" ON timesheet_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    LOWER(employee_email) = current_user_email()
    OR reports_to(employee_email)
    OR current_user_role() IN ('admin','manager')
  );

-- ────────────────────────────────────────────────────────────────────
-- 2. storage.objects INSERT policy for the 'timesheet-documents' bucket —
--    own folder, report's folder, or admin/manager.
-- ────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "timesheet-documents: insert own" ON storage.objects;
CREATE POLICY "timesheet-documents: insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'timesheet-documents' AND (
      (storage.foldername(name))[1] = current_user_email()
      OR reports_to((storage.foldername(name))[1])
      OR current_user_role() IN ('admin','manager')
    )
  );
