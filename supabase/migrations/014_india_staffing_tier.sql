-- Strategic segmentation on India staffing accounts.
-- Tier 1 = named / must-serve strategic accounts (Persistent, Ciklum today);
-- Tier 2 = everything else. The demand page shows Tier 1 first in a louder,
-- always-open card and folds Tier 2 into a collapsible section.
ALTER TABLE india_staffing_accounts
  ADD COLUMN IF NOT EXISTS tier SMALLINT NOT NULL DEFAULT 2 CHECK (tier IN (1, 2));

CREATE INDEX IF NOT EXISTS idx_india_staffing_accounts_tier ON india_staffing_accounts(tier);

-- Seed the initial Tier 1 set. Case-insensitive prefix match so variants
-- like "Persistent Systems Limited" or "Ciklum Operations UK" both catch.
UPDATE india_staffing_accounts
   SET tier = 1
 WHERE lower(name) LIKE 'persistent%'
    OR lower(name) LIKE 'ciklum%';
