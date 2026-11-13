// One active meeting document per account; existing selection/engine tables are untouched.
export const meetingBriefSchemaSql=`
CREATE TABLE IF NOT EXISTS product_account_meeting_briefs (
  account_id UUID PRIMARY KEY REFERENCES product_accounts(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '' CHECK(length(title)<=160),
  meeting_date DATE CHECK(meeting_date BETWEEN DATE '1000-01-01' AND DATE '9999-12-31'),
  article_order JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(article_order)='array' AND pg_column_size(article_order)<=1048576)
);
ALTER TABLE product_account_meeting_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_account_meeting_briefs FORCE ROW LEVEL SECURITY;
DO $policies$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='product_account_meeting_briefs' AND policyname='meeting_brief_self') THEN
    CREATE POLICY meeting_brief_self ON product_account_meeting_briefs FOR ALL TO missiondesk_personal_app
      USING(account_id::text=current_setting('missiondesk.account_id',true)
        AND EXISTS(SELECT 1 FROM product_accounts a WHERE a.id=account_id AND a.status='active'))
      WITH CHECK(account_id::text=current_setting('missiondesk.account_id',true)
        AND EXISTS(SELECT 1 FROM product_accounts a WHERE a.id=account_id AND a.status='active'));
  END IF;
END $policies$;
REVOKE ALL ON product_account_meeting_briefs FROM PUBLIC,missiondesk_personal_app;
GRANT SELECT,INSERT,UPDATE ON product_account_meeting_briefs TO missiondesk_personal_app;
`;
