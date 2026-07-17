-- Add onboarding_date to India staffing requisitions.
-- A Closed Won requisition isn't fully "done" until the candidate joins;
-- this column lets us split the Closed Won archive into two buckets:
--   - Onboarded         (onboarding_date IS NOT NULL)
--   - Not yet Onboarded (onboarding_date IS NULL)
-- so we can chase the still-awaiting-join ones without them getting lost
-- in the general win pile.
ALTER TABLE india_staffing_requisitions
  ADD COLUMN IF NOT EXISTS onboarding_date TEXT;

CREATE INDEX IF NOT EXISTS idx_india_staffing_reqs_onboarding_date
  ON india_staffing_requisitions(onboarding_date)
  WHERE onboarding_date IS NOT NULL;
