-- Concierge accounts: industry, website, logo_url.
-- All optional and free-text. `logo_url` falls back to a Clearbit-derived
-- URL from `website` at render time — no periodic sync needed.
ALTER TABLE concierge_accounts
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT;
