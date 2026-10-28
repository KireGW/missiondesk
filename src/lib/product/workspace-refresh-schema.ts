// Explicit migration on the isolated pilot; no schema changes during a web request.
export const workspaceRefreshSchemaSql = `
ALTER TABLE product_public_sources ADD COLUMN IF NOT EXISTS fetch_mode text NOT NULL DEFAULT 'rss' CHECK(fetch_mode IN ('rss','page','paused'));
ALTER TABLE product_public_sources ADD COLUMN IF NOT EXISTS last_content_hash text;
ALTER TABLE product_public_sources ADD COLUMN IF NOT EXISTS changed_at timestamptz;
ALTER TABLE product_public_articles ADD COLUMN IF NOT EXISTS content_kind text NOT NULL DEFAULT 'news' CHECK(content_kind IN ('news','reference'));
CREATE TABLE IF NOT EXISTS product_workspace_scan_runs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES product_workspaces(id),
  run_day date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Mexico_City')::date,
  source_ids jsonb NOT NULL CHECK(jsonb_typeof(source_ids)='array' AND jsonb_array_length(source_ids)<=33),
  completed_source_ids jsonb NOT NULL DEFAULT '[]',
  report jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','completed','partial')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(workspace_id,run_day)
);
ALTER TABLE product_workspace_scan_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_scan_read ON product_workspace_scan_runs;
CREATE POLICY workspace_scan_read ON product_workspace_scan_runs FOR SELECT USING(EXISTS(SELECT 1 FROM product_workspaces w WHERE w.id=workspace_id));
DROP POLICY IF EXISTS workspace_scan_insert ON product_workspace_scan_runs;
CREATE POLICY workspace_scan_insert ON product_workspace_scan_runs FOR INSERT WITH CHECK(EXISTS(SELECT 1 FROM product_workspaces w WHERE w.id=workspace_id));
DROP POLICY IF EXISTS workspace_scan_update ON product_workspace_scan_runs;
CREATE POLICY workspace_scan_update ON product_workspace_scan_runs FOR UPDATE USING(status='running' AND EXISTS(SELECT 1 FROM product_workspaces w WHERE w.id=workspace_id))
  WITH CHECK(EXISTS(SELECT 1 FROM product_workspaces w WHERE w.id=workspace_id));
DROP POLICY IF EXISTS public_source_state_write ON product_public_sources;
CREATE POLICY public_source_state_write ON product_public_sources FOR UPDATE USING(fetch_mode<>'paused' AND EXISTS(SELECT 1 FROM product_workspace_sources s WHERE s.source_id=id));
DROP POLICY IF EXISTS public_article_insert ON product_public_articles;
CREATE POLICY public_article_insert ON product_public_articles FOR INSERT WITH CHECK(EXISTS(SELECT 1 FROM product_public_sources p WHERE p.id=source_id AND p.fetch_mode='rss'));
DROP POLICY IF EXISTS public_article_update ON product_public_articles;
CREATE POLICY public_article_update ON product_public_articles FOR UPDATE USING(EXISTS(SELECT 1 FROM product_public_sources p WHERE p.id=source_id AND p.fetch_mode='rss'));
DROP POLICY IF EXISTS workspace_candidate_insert ON product_workspace_candidates;
CREATE POLICY workspace_candidate_insert ON product_workspace_candidates FOR INSERT WITH CHECK(EXISTS(SELECT 1 FROM product_workspace_sources s
  WHERE s.workspace_id=product_workspace_candidates.workspace_id AND s.source_id=(SELECT a.source_id FROM product_public_articles a WHERE a.id=article_id)));
DROP POLICY IF EXISTS workspace_candidate_update ON product_workspace_candidates;
CREATE POLICY workspace_candidate_update ON product_workspace_candidates FOR UPDATE USING(EXISTS(SELECT 1 FROM product_workspace_sources s
  WHERE s.workspace_id=product_workspace_candidates.workspace_id AND s.source_id=(SELECT a.source_id FROM product_public_articles a WHERE a.id=article_id)));
GRANT SELECT ON product_workspace_scan_runs TO missiondesk_personal_app;
GRANT INSERT(id,workspace_id,source_ids),UPDATE(completed_source_ids,report,status,finished_at) ON product_workspace_scan_runs TO missiondesk_personal_app;
GRANT UPDATE(last_success_at,last_attempt_at,last_error,truncated,last_content_hash,changed_at) ON product_public_sources TO missiondesk_personal_app;
GRANT INSERT(id,source_id,url,title,excerpt,published_at,content_hash,countries,content_kind),
  UPDATE(title,excerpt,published_at,content_hash,countries,content_kind,fetched_at) ON product_public_articles TO missiondesk_personal_app;
GRANT INSERT(workspace_id,article_id,content_hash,policy_key,status,score,reason),UPDATE(status,score,reason,evaluated_at)
  ON product_workspace_candidates TO missiondesk_personal_app;
`;
