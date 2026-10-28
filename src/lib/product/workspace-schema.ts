// Explicitly installed only on the verified personal pilot, never by the legacy engine.
export const workspaceSchemaSql = `
CREATE TABLE IF NOT EXISTS product_workspaces (
  id UUID PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  home_country TEXT NOT NULL CHECK (home_country IN ('SE', 'NO')),
  countries JSONB NOT NULL CHECK (jsonb_typeof(countries) = 'array' AND jsonb_array_length(countries) > 0
    AND countries <@ '["MX","NI","CR","GT","HN","SV","BZ"]'::jsonb),
  enabled BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS product_workspace_members (
  workspace_id UUID NOT NULL REFERENCES product_workspaces(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES product_accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  PRIMARY KEY (workspace_id, account_id)
);
CREATE TABLE IF NOT EXISTS product_public_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  article_host TEXT NOT NULL,
  language TEXT NOT NULL,
  last_success_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  truncated BOOLEAN NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS product_workspace_sources (
  workspace_id UUID NOT NULL REFERENCES product_workspaces(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES product_public_sources(id),
  PRIMARY KEY (workspace_id, source_id)
);
CREATE TABLE IF NOT EXISTS product_public_articles (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES product_public_sources(id),
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  content_hash TEXT NOT NULL,
  countries JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_id, url)
);
CREATE INDEX IF NOT EXISTS product_public_articles_source_date_idx
  ON product_public_articles(source_id, published_at DESC);
CREATE TABLE IF NOT EXISTS product_workspace_candidates (
  workspace_id UUID NOT NULL REFERENCES product_workspaces(id) ON DELETE CASCADE,
  article_id TEXT NOT NULL REFERENCES product_public_articles(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  policy_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('selected', 'held', 'rejected')),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  reason TEXT NOT NULL,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, article_id, content_hash, policy_key)
);
ALTER TABLE product_workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_workspace_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_workspace_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_public_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_public_articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_member_self ON product_workspace_members;
CREATE POLICY workspace_member_self ON product_workspace_members FOR SELECT USING (
  account_id::text = current_setting('missiondesk.account_id', true)
  AND EXISTS (SELECT 1 FROM product_accounts a WHERE a.id = account_id AND a.status = 'active')
);
DROP POLICY IF EXISTS workspace_member_read ON product_workspaces;
CREATE POLICY workspace_member_read ON product_workspaces FOR SELECT USING (
  enabled AND EXISTS (SELECT 1 FROM product_workspace_members m WHERE m.workspace_id = id)
);
DROP POLICY IF EXISTS workspace_source_read ON product_workspace_sources;
CREATE POLICY workspace_source_read ON product_workspace_sources FOR SELECT USING (
  EXISTS (SELECT 1 FROM product_workspaces w WHERE w.id = workspace_id)
);
DROP POLICY IF EXISTS workspace_candidate_read ON product_workspace_candidates;
CREATE POLICY workspace_candidate_read ON product_workspace_candidates FOR SELECT USING (
  EXISTS (SELECT 1 FROM product_workspace_sources s
    WHERE s.workspace_id = product_workspace_candidates.workspace_id
      AND s.source_id = (SELECT a.source_id FROM product_public_articles a WHERE a.id = article_id))
);
DROP POLICY IF EXISTS public_source_member_read ON product_public_sources;
CREATE POLICY public_source_member_read ON product_public_sources FOR SELECT USING (
  EXISTS (SELECT 1 FROM product_workspace_sources s WHERE s.source_id = id)
);
DROP POLICY IF EXISTS public_article_member_read ON product_public_articles;
CREATE POLICY public_article_member_read ON product_public_articles FOR SELECT USING (
  EXISTS (SELECT 1 FROM product_workspace_sources s WHERE s.source_id = product_public_articles.source_id)
);
GRANT SELECT ON product_workspaces, product_workspace_members, product_workspace_sources,
  product_public_sources, product_public_articles, product_workspace_candidates TO missiondesk_personal_app;
`;
