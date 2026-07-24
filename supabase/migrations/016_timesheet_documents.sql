-- Timesheet documents — client-approved timesheet attachments at the WEEK level.
-- Contractors attach the approved timesheet file (PDF, image, Word, Excel) for a
-- given week (period_start = Monday, period_end = Sunday) to their portal.
-- Additive only. Idempotent. Mirrors the time_entries RLS model (008 lockdown +
-- current_user_email / current_user_role / reports_to helpers).
--
-- SELF-CONTAINED: the current_user_email / current_user_role / reports_to helper
-- functions (and the authorized_users role/manager identity columns they read)
-- live in supabase/schema.sql but were never captured in a numbered migration, so
-- they may be ABSENT from a database that was built up purely from 002–015. This
-- migration therefore (re)creates the authorized_users columns and the three
-- helper functions itself, BEFORE any policy references them, so it runs cleanly
-- top-to-bottom in the Supabase SQL Editor. All statements are idempotent
-- (ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE FUNCTION / IF NOT EXISTS guards /
-- DROP POLICY IF EXISTS). Definitions are copied verbatim from schema.sql so this
-- stays consistent with how time_entries is secured.
--
-- STORAGE: the files live in a PRIVATE Supabase Storage bucket named
--   'timesheet-documents'. Storage buckets are NOT declarable in tracked SQL
--   here (same limitation as 'concierge-docs' / 'candidate-resumes'), so the
--   bucket must be created once in the Supabase console/CLI, e.g.:
--     insert into storage.buckets (id, name, public) values
--       ('timesheet-documents', 'timesheet-documents', false)
--     on conflict (id) do nothing;
--   Access to objects is via short-lived signed URLs (createSignedUrl), so no
--   public policy is required.

-- ────────────────────────────────────────────────────────────────────
-- 0. Identity model prerequisites (idempotent). The authorized_users
--    allowlist table itself is created in 008; here we add the role /
--    manager / employee_code / active columns the time-entry module relies
--    on, then (re)create the RLS helper functions. Copied verbatim from
--    supabase/schema.sql so prod matches the tracked schema.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE authorized_users
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'admin'
    CHECK (role IN ('admin', 'manager', 'employee')),
  ADD COLUMN IF NOT EXISTS employee_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS manager_email TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true;

-- Helper functions used by RLS and the client.
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

-- SECURITY DEFINER helpers read auth.users, so the authenticated role needs
-- EXECUTE. (New functions grant EXECUTE to PUBLIC by default; this is explicit
-- and harmless if already present.)
GRANT EXECUTE ON FUNCTION current_user_email()        TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_role()         TO authenticated;
GRANT EXECUTE ON FUNCTION reports_to(TEXT)            TO authenticated;

-- ────────────────────────────────────────────────────────────────────
-- 1. timesheet_documents table
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS timesheet_documents (
  id             TEXT PRIMARY KEY,
  employee_email TEXT NOT NULL,
  period_start   DATE NOT NULL,          -- Monday of the week
  period_end     DATE NOT NULL,          -- Sunday of the week
  filename       TEXT NOT NULL,
  storage_path   TEXT NOT NULL,
  mime_type      TEXT,
  size_bytes     BIGINT,
  uploaded_by    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tsdoc_emp_period ON timesheet_documents(employee_email, period_start);

ALTER TABLE timesheet_documents ENABLE ROW LEVEL SECURITY;

-- RLS mirrors time_entries: user manages their own rows; managers read reports'
-- rows; admins read/manage everything.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='timesheet_documents' AND policyname='Read: own, team, or admin') THEN
    CREATE POLICY "Read: own, team, or admin" ON timesheet_documents
      FOR SELECT TO authenticated
      USING (
        LOWER(employee_email) = current_user_email()
        OR reports_to(employee_email)
        OR current_user_role() IN ('admin','manager')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='timesheet_documents' AND policyname='Insert: own') THEN
    CREATE POLICY "Insert: own" ON timesheet_documents
      FOR INSERT TO authenticated
      WITH CHECK (LOWER(employee_email) = current_user_email());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='timesheet_documents' AND policyname='Update: own, team, or admin') THEN
    CREATE POLICY "Update: own, team, or admin" ON timesheet_documents
      FOR UPDATE TO authenticated
      USING (
        LOWER(employee_email) = current_user_email()
        OR reports_to(employee_email)
        OR current_user_role() IN ('admin','manager')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='timesheet_documents' AND policyname='Delete: own or admin') THEN
    CREATE POLICY "Delete: own or admin" ON timesheet_documents
      FOR DELETE TO authenticated
      USING (
        LOWER(employee_email) = current_user_email()
        OR current_user_role() = 'admin'
      );
  END IF;
END$$;

-- updated_at trigger reuse (same guard pattern as 011)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='touch_updated_at') THEN
    DROP TRIGGER IF EXISTS timesheet_documents_touch ON timesheet_documents;
    CREATE TRIGGER timesheet_documents_touch BEFORE UPDATE ON timesheet_documents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END$$;

-- Storage object RLS for the private 'timesheet-documents' bucket. Object paths
-- are `${email}/${period_start}/...`, so the top folder ((storage.foldername(name))[1])
-- is the owner's email. These policies mirror the timesheet_documents table RLS:
-- a user reaches only their OWN folder, managers read their reports' folders, and
-- admins reach everything. (The bucket itself is still created in the console/CLI,
-- see the STORAGE note above.) Idempotent (drop-if-exists then create).
DROP POLICY IF EXISTS "timesheet-documents: read own, team, or admin" ON storage.objects;
CREATE POLICY "timesheet-documents: read own, team, or admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'timesheet-documents' AND (
      (storage.foldername(name))[1] = current_user_email()
      OR reports_to((storage.foldername(name))[1])
      OR current_user_role() IN ('admin','manager')
    )
  );

DROP POLICY IF EXISTS "timesheet-documents: insert own" ON storage.objects;
CREATE POLICY "timesheet-documents: insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'timesheet-documents'
    AND (storage.foldername(name))[1] = current_user_email()
  );

DROP POLICY IF EXISTS "timesheet-documents: update own, team, or admin" ON storage.objects;
CREATE POLICY "timesheet-documents: update own, team, or admin" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'timesheet-documents' AND (
      (storage.foldername(name))[1] = current_user_email()
      OR reports_to((storage.foldername(name))[1])
      OR current_user_role() IN ('admin','manager')
    )
  );

DROP POLICY IF EXISTS "timesheet-documents: delete own or admin" ON storage.objects;
CREATE POLICY "timesheet-documents: delete own or admin" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'timesheet-documents' AND (
      (storage.foldername(name))[1] = current_user_email()
      OR current_user_role() = 'admin'
    )
  );
