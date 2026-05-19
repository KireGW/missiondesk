CREATE INDEX IF NOT EXISTS raw_source_items_priority_idx
  ON raw_source_items(source_priority DESC, published_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS processed_items_scope_cache_idx
  ON processed_items(geographic_scope, cache_expires_at DESC, processed_at DESC);

CREATE INDEX IF NOT EXISTS processed_items_category_cache_idx
  ON processed_items(category, cache_expires_at DESC, processed_at DESC);

CREATE INDEX IF NOT EXISTS briefings_key_cache_idx
  ON briefings(type, profile, geographic_scope, region, cache_expires_at DESC, generated_at DESC);

CREATE INDEX IF NOT EXISTS background_jobs_queue_idx
  ON background_jobs(type, status, run_after, priority DESC, created_at ASC);
