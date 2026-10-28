// Backfill only once, preserving each existing account's pre-split signal display.
export const productPreferencesMigrationSql = `
ALTER TABLE product_account_preferences ADD COLUMN IF NOT EXISTS content_language TEXT
  CHECK (content_language IN ('original', 'sv'));
UPDATE product_account_preferences
  SET content_language = CASE WHEN language = 'sv' THEN 'sv' ELSE 'original' END
  WHERE content_language IS NULL;
ALTER TABLE product_account_preferences
  ALTER COLUMN content_language SET DEFAULT 'sv',
  ALTER COLUMN content_language SET NOT NULL;
`;
