export const productInterfaceLanguageMigrationSql = `
ALTER TABLE product_account_preferences DROP CONSTRAINT IF EXISTS product_account_preferences_language_check;
ALTER TABLE product_account_preferences ADD CONSTRAINT product_account_preferences_language_check
  CHECK (language IN ('sv', 'nb', 'es', 'en'));
ALTER TABLE product_username_logins ADD COLUMN IF NOT EXISTS interface_profile TEXT NOT NULL DEFAULT 'standard'
  CHECK (interface_profile IN ('standard', 'norwegian'));
`;
