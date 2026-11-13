// One bounded comparison point per account; no article or engine data is written.
export const currentReviewSchemaSql=`
CREATE TABLE IF NOT EXISTS product_account_current_review (
  account_id UUID PRIMARY KEY REFERENCES product_accounts(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0),
  baseline_ids JSONB NOT NULL CHECK(jsonb_typeof(baseline_ids)='array' AND jsonb_array_length(baseline_ids)<=100 AND pg_column_size(baseline_ids)<=32768),
  reviewed_at TIMESTAMPTZ
);
ALTER TABLE product_account_current_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_account_current_review FORCE ROW LEVEL SECURITY;
DO $policies$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_account_current_review' AND policyname='current_review_self') THEN
    CREATE POLICY current_review_self ON product_account_current_review FOR ALL TO missiondesk_personal_app
      USING(account_id::text=current_setting('missiondesk.account_id',true)
        AND EXISTS(SELECT 1 FROM product_accounts a WHERE a.id=account_id AND a.status='active'))
      WITH CHECK(account_id::text=current_setting('missiondesk.account_id',true)
        AND EXISTS(SELECT 1 FROM product_accounts a WHERE a.id=account_id AND a.status='active'));
  END IF;
END $policies$;
REVOKE ALL ON product_account_current_review FROM PUBLIC,missiondesk_personal_app;
GRANT SELECT,INSERT,UPDATE ON product_account_current_review TO missiondesk_personal_app;
`;
