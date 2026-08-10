-- Gender-gated leave types.
--
-- Requirement: Maternity Leave is visible/allocatable ONLY to female employees
-- (flat 182 days); Paternity Leave ONLY to male employees (flat 15 days).
-- The standard types (AL / CL / COF) stay visible to everyone.
--
-- Two new columns drive the gate:
--   * authorized_users.gender  ('female' | 'male'; NULL = show no gendered types)
--   * leave_types.eligibility  ('all' | 'female' | 'male'; default 'all')
-- The UI shows a type to a user when eligibility = 'all' OR eligibility = gender.
--
-- This is the FORWARD migration an admin applies to the LIVE project. It is
-- idempotent & self-contained: only ADD COLUMN IF NOT EXISTS + INSERT ... ON
-- CONFLICT, so it can be re-applied safely and never touches RLS helper
-- functions (those live only in schema.sql).
--
-- ⚠️ Applying this migration alone changes nothing visible until each
-- employee's authorized_users.gender is set (via the Users admin screen or SQL).

-- A. Gender on the employee directory.
ALTER TABLE authorized_users
  ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('female','male'));

-- B. Eligibility on leave types + the two gendered types.
ALTER TABLE leave_types
  ADD COLUMN IF NOT EXISTS eligibility TEXT NOT NULL DEFAULT 'all'
    CHECK (eligibility IN ('all','female','male'));

-- Maternity (female-only, 182 days) and Paternity (male-only, 15 days).
-- Sort after COF (sort_order 30). Distinct colors from the standard types.
-- ON CONFLICT (code) DO UPDATE also re-applies eligibility/quota so a re-run
-- repairs rows that predate this migration.
INSERT INTO leave_types (id, name, code, annual_quota, color, active, sort_order, eligibility) VALUES
  ('maternity', 'Maternity Leave', 'MAT', 182, '#db2777', TRUE, 40, 'female'),
  ('paternity', 'Paternity Leave', 'PAT',  15, '#0d9488', TRUE, 50, 'male')
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      active = TRUE,
      annual_quota = EXCLUDED.annual_quota,
      eligibility = EXCLUDED.eligibility;
