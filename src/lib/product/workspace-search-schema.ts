export const workspaceSearchSchemaSql = `
CREATE INDEX IF NOT EXISTS product_public_articles_search_idx ON product_public_articles
  USING gin(to_tsvector('simple',coalesce(title,'') || ' ' || coalesce(excerpt,'')));
CREATE TABLE IF NOT EXISTS product_workspace_search_limits (
  workspace_id uuid PRIMARY KEY REFERENCES product_workspaces(id),
  minute_started_at timestamptz NOT NULL DEFAULT date_trunc('minute',now()),
  day_key date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Mexico_City')::date,
  minute_requests integer NOT NULL DEFAULT 1 CHECK(minute_requests BETWEEN 1 AND 30),
  day_requests integer NOT NULL DEFAULT 1 CHECK(day_requests BETWEEN 1 AND 300)
);
ALTER TABLE product_workspace_search_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_search_read ON product_workspace_search_limits;
CREATE POLICY workspace_search_read ON product_workspace_search_limits FOR SELECT
  USING(EXISTS(SELECT 1 FROM product_workspaces w WHERE w.id=workspace_id));
DROP POLICY IF EXISTS workspace_search_insert ON product_workspace_search_limits;
CREATE POLICY workspace_search_insert ON product_workspace_search_limits FOR INSERT
  WITH CHECK(EXISTS(SELECT 1 FROM product_workspaces w WHERE w.id=workspace_id));
DROP POLICY IF EXISTS workspace_search_update ON product_workspace_search_limits;
CREATE POLICY workspace_search_update ON product_workspace_search_limits FOR UPDATE
  USING(EXISTS(SELECT 1 FROM product_workspaces w WHERE w.id=workspace_id));
GRANT SELECT,INSERT(workspace_id),UPDATE(minute_started_at,day_key,minute_requests,day_requests)
  ON product_workspace_search_limits TO missiondesk_personal_app;
`;
