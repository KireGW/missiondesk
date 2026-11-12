// Additive personal-account storage. No engine table, candidate or policy is changed.
export const personalSelectionsSchemaSql = `
CREATE TABLE IF NOT EXISTS product_account_selection_state (
  account_id UUID PRIMARY KEY REFERENCES product_accounts(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS product_account_selections (
  account_id UUID NOT NULL REFERENCES product_accounts(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 180),
  kind TEXT NOT NULL CHECK (kind IN ('priority','meeting')),
  bookmark JSONB NOT NULL CHECK (jsonb_typeof(bookmark)='object' AND pg_column_size(bookmark) <= 16384),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id,item_id,kind)
);
ALTER TABLE product_account_selection_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_account_selection_state FORCE ROW LEVEL SECURITY;
ALTER TABLE product_account_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_account_selections FORCE ROW LEVEL SECURITY;
DO $policies$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_account_selection_state' AND policyname='selection_state_self') THEN
    CREATE POLICY selection_state_self ON product_account_selection_state FOR ALL TO missiondesk_personal_app
      USING (account_id::text=current_setting('missiondesk.account_id',true)
        AND EXISTS(SELECT 1 FROM product_accounts a WHERE a.id=account_id AND a.status='active'))
      WITH CHECK (account_id::text=current_setting('missiondesk.account_id',true)
        AND EXISTS(SELECT 1 FROM product_accounts a WHERE a.id=account_id AND a.status='active'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_account_selections' AND policyname='account_selection_self') THEN
    CREATE POLICY account_selection_self ON product_account_selections FOR ALL TO missiondesk_personal_app
      USING (account_id::text=current_setting('missiondesk.account_id',true)
        AND EXISTS(SELECT 1 FROM product_accounts a WHERE a.id=account_id AND a.status='active'))
      WITH CHECK (account_id::text=current_setting('missiondesk.account_id',true)
        AND EXISTS(SELECT 1 FROM product_accounts a WHERE a.id=account_id AND a.status='active'));
  END IF;
END $policies$;
REVOKE ALL ON product_account_selection_state,product_account_selections FROM PUBLIC,missiondesk_personal_app;
GRANT SELECT,INSERT,UPDATE ON product_account_selection_state TO missiondesk_personal_app;
GRANT SELECT,INSERT,DELETE ON product_account_selections TO missiondesk_personal_app;
`;
