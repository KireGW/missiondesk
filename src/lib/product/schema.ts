// Deliberately separate from the engine's lazy migrations. Apply explicitly on a preview database.
export const productSchemaSql = `
CREATE TABLE IF NOT EXISTS product_accounts (
  id UUID PRIMARY KEY,
  auth_subject TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'premium')),
  premium_until TIMESTAMPTZ,
  llm_monthly_budget_micros BIGINT NOT NULL DEFAULT 0 CHECK (llm_monthly_budget_micros >= 0),
  social_monthly_budget_micros BIGINT NOT NULL DEFAULT 0 CHECK (social_monthly_budget_micros >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_usage (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES product_accounts(id) ON DELETE CASCADE,
  operation_key TEXT NOT NULL,
  service TEXT NOT NULL CHECK (service IN ('llm', 'social')),
  period TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'settled', 'released')),
  reserved_micros BIGINT NOT NULL CHECK (reserved_micros > 0),
  actual_micros BIGINT CHECK (actual_micros >= 0),
  units JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ,
  UNIQUE (account_id, operation_key),
  CHECK ((status = 'settled' AND actual_micros IS NOT NULL) OR
         (status <> 'settled' AND actual_micros IS NULL))
);

CREATE INDEX IF NOT EXISTS product_usage_account_period_idx
  ON product_usage(account_id, service, period);

CREATE TABLE IF NOT EXISTS product_account_preferences (
  account_id UUID PRIMARY KEY REFERENCES product_accounts(id) ON DELETE CASCADE,
  home_country TEXT NOT NULL CHECK (home_country IN ('SE', 'NO')),
  target_country TEXT NOT NULL CHECK (target_country = 'MX'),
  language TEXT NOT NULL CHECK (language IN ('sv', 'nb')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
