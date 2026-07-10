-- Add dormant flag to concierge_accounts — marks a customer as inactive
-- concierge relationship worth re-engaging. The UI renders dormant cards
-- in red and floats them to the top of the Overview so re-engagement
-- targets are visually prominent.
ALTER TABLE concierge_accounts
  ADD COLUMN IF NOT EXISTS is_dormant BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_concierge_accounts_dormant
  ON concierge_accounts(is_dormant) WHERE is_dormant = TRUE;
