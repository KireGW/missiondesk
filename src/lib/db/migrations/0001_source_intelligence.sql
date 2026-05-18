CREATE TABLE IF NOT EXISTS raw_source_items (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (
    source_type IN (
      'news',
      'government',
      'institution',
      'social',
      'report',
      'advisory',
      'event',
      'other'
    )
  ),
  title_original TEXT NOT NULL,
  url TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_country TEXT NOT NULL,
  source_language TEXT NOT NULL,
  published_at TEXT,
  detected_country TEXT,
  detected_region TEXT,
  detected_city TEXT,
  snippet TEXT,
  raw_content TEXT,
  source_priority INTEGER NOT NULL DEFAULT 50 CHECK (source_priority >= 0 AND source_priority <= 100),
  credibility_score INTEGER NOT NULL DEFAULT 50 CHECK (credibility_score >= 0 AND credibility_score <= 100),
  crawl_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    crawl_status IN ('pending', 'fetched', 'failed', 'skipped', 'stale')
  ),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS raw_source_items_url_unique
  ON raw_source_items(url)
  WHERE url <> '';

CREATE INDEX IF NOT EXISTS raw_source_items_source_type_idx
  ON raw_source_items(source_type);

CREATE INDEX IF NOT EXISTS raw_source_items_source_name_idx
  ON raw_source_items(source_name);

CREATE INDEX IF NOT EXISTS raw_source_items_published_at_idx
  ON raw_source_items(published_at DESC);

CREATE INDEX IF NOT EXISTS raw_source_items_crawl_status_idx
  ON raw_source_items(crawl_status);

CREATE INDEX IF NOT EXISTS raw_source_items_geography_idx
  ON raw_source_items(detected_country, detected_region, detected_city);

CREATE TABLE IF NOT EXISTS processed_items (
  raw_source_item_id TEXT PRIMARY KEY,
  title_sv TEXT NOT NULL,
  summary_sv TEXT NOT NULL,
  category TEXT NOT NULL CHECK (
    category IN (
      'economy',
      'trade',
      'domestic_politics',
      'foreign_policy',
      'sweden_connection',
      'security',
      'markets',
      'investment_climate',
      'migration',
      'society',
      'energy',
      'technology',
      'culture_soft_power'
    )
  ),
  urgency_score INTEGER NOT NULL CHECK (urgency_score >= 0 AND urgency_score <= 100),
  diplomatic_relevance_score INTEGER NOT NULL CHECK (diplomatic_relevance_score >= 0 AND diplomatic_relevance_score <= 100),
  sweden_relevance_score INTEGER NOT NULL CHECK (sweden_relevance_score >= 0 AND sweden_relevance_score <= 100),
  economic_impact_score INTEGER NOT NULL CHECK (economic_impact_score >= 0 AND economic_impact_score <= 100),
  security_impact_score INTEGER NOT NULL CHECK (security_impact_score >= 0 AND security_impact_score <= 100),
  geographic_scope TEXT NOT NULL CHECK (
    geographic_scope IN (
      'national',
      'region',
      'administrative_division',
      'city',
      'cross_border',
      'international'
    )
  ),
  geographic_tags TEXT NOT NULL DEFAULT '[]',
  why_it_may_matter_sv TEXT NOT NULL,
  profile_tags TEXT NOT NULL DEFAULT '[]',
  processed_model TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  cache_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (raw_source_item_id)
    REFERENCES raw_source_items(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS processed_items_category_idx
  ON processed_items(category);

CREATE INDEX IF NOT EXISTS processed_items_processed_at_idx
  ON processed_items(processed_at DESC);

CREATE INDEX IF NOT EXISTS processed_items_cache_expires_at_idx
  ON processed_items(cache_expires_at);

CREATE INDEX IF NOT EXISTS processed_items_relevance_idx
  ON processed_items(diplomatic_relevance_score DESC, urgency_score DESC, sweden_relevance_score DESC);

CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  profile TEXT NOT NULL CHECK (
    profile IN (
      'daily_overview',
      'ambassador_briefing',
      'trade_business',
      'political_risk',
      'sweden_connection',
      'security',
      'weekly_summary',
      'upcoming_events'
    )
  ),
  geographic_scope TEXT NOT NULL CHECK (
    geographic_scope IN (
      'national',
      'region',
      'administrative_division',
      'city',
      'cross_border',
      'international'
    )
  ),
  region TEXT,
  content_sv TEXT NOT NULL,
  source_item_ids TEXT NOT NULL DEFAULT '[]',
  generated_model TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  cache_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS briefings_lookup_idx
  ON briefings(type, profile, geographic_scope, region);

CREATE INDEX IF NOT EXISTS briefings_generated_at_idx
  ON briefings(generated_at DESC);

CREATE INDEX IF NOT EXISTS briefings_cache_expires_at_idx
  ON briefings(cache_expires_at);

CREATE TABLE IF NOT EXISTS background_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  ),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority >= 0 AND priority <= 100),
  payload TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  run_after TEXT NOT NULL DEFAULT (datetime('now')),
  locked_at TEXT,
  locked_by TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS background_jobs_claim_idx
  ON background_jobs(status, run_after, priority DESC, created_at);

CREATE INDEX IF NOT EXISTS background_jobs_type_idx
  ON background_jobs(type);
