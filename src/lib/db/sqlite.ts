import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { missiondeskDataDir } from "@/lib/runtime/paths";

let database: DatabaseSync | null = null;
let migrationsApplied = false;

export function getDatabasePath() {
  return process.env.MISSIONDESK_DB_PATH ?? path.join(missiondeskDataDir(), "missiondesk.sqlite");
}

export function getDb() {
  if (!database) {
    const dbPath = getDatabasePath();
    if (dbPath !== ":memory:") {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    database = new DatabaseSync(dbPath);
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA journal_mode = WAL");
  }

  return database;
}

export function closeDb() {
  if (!database) return;
  database.close();
  database = null;
  migrationsApplied = false;
}

export function runMigrations(db = getDb()) {
  if (migrationsApplied) return;

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const appliedRows = db
    .prepare("SELECT id FROM schema_migrations")
    .all() as Array<{ id: string }>;
  const applied = new Set(appliedRows.map((row) => row.id));
  const migrations = loadMigrations();

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    try {
      db.exec("BEGIN");
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(migration.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  migrationsApplied = true;
}

export function getMigratedDb() {
  const db = getDb();
  runMigrations(db);
  return db;
}

function loadMigrations() {
  const migrationsDir = path.join(process.cwd(), "src", "lib", "db", "migrations");
  if (!existsSync(migrationsDir)) return embeddedMigrations;

  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  return migrationFiles.map((file) => ({
    id: file,
    sql: readFileSync(path.join(migrationsDir, file), "utf8"),
  }));
}

const embeddedMigrations = [
  {
    id: "0001_source_intelligence.sql",
    sql: `
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
`,
  },
  {
    id: "0002_ranked_candidates.sql",
    sql: `
CREATE TABLE IF NOT EXISTS item_duplicate_clusters (
  id TEXT PRIMARY KEY,
  canonical_raw_source_item_id TEXT NOT NULL,
  duplicate_raw_source_item_ids TEXT NOT NULL DEFAULT '[]',
  duplicate_strategy TEXT NOT NULL,
  title_fingerprint TEXT,
  url_fingerprint TEXT,
  embedding_cluster_id TEXT,
  source_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (canonical_raw_source_item_id)
    REFERENCES raw_source_items(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS item_duplicate_clusters_canonical_idx
  ON item_duplicate_clusters(canonical_raw_source_item_id);

CREATE INDEX IF NOT EXISTS item_duplicate_clusters_title_fingerprint_idx
  ON item_duplicate_clusters(title_fingerprint);

CREATE INDEX IF NOT EXISTS item_duplicate_clusters_embedding_idx
  ON item_duplicate_clusters(embedding_cluster_id);

CREATE TABLE IF NOT EXISTS ranked_processing_candidates (
  raw_source_item_id TEXT PRIMARY KEY,
  rank_score INTEGER NOT NULL CHECK (rank_score >= 0 AND rank_score <= 100),
  selection_status TEXT NOT NULL DEFAULT 'candidate' CHECK (
    selection_status IN ('candidate', 'selected', 'deferred', 'rejected', 'regional_hold')
  ),
  selection_reason TEXT NOT NULL,
  freshness_score INTEGER NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 100),
  source_priority_score INTEGER NOT NULL CHECK (source_priority_score >= 0 AND source_priority_score <= 100),
  credibility_score INTEGER NOT NULL CHECK (credibility_score >= 0 AND credibility_score <= 100),
  keyword_relevance_score INTEGER NOT NULL CHECK (keyword_relevance_score >= 0 AND keyword_relevance_score <= 100),
  diplomatic_relevance_score INTEGER NOT NULL CHECK (diplomatic_relevance_score >= 0 AND diplomatic_relevance_score <= 100),
  sweden_relevance_score INTEGER NOT NULL CHECK (sweden_relevance_score >= 0 AND sweden_relevance_score <= 100),
  geographic_relevance_score INTEGER NOT NULL CHECK (geographic_relevance_score >= 0 AND geographic_relevance_score <= 100),
  category_relevance_score INTEGER NOT NULL CHECK (category_relevance_score >= 0 AND category_relevance_score <= 100),
  novelty_score INTEGER NOT NULL CHECK (novelty_score >= 0 AND novelty_score <= 100),
  cross_source_confirmation_score INTEGER NOT NULL CHECK (cross_source_confirmation_score >= 0 AND cross_source_confirmation_score <= 100),
  duplicate_cluster_id TEXT,
  duplicate_of_raw_source_item_id TEXT,
  embedding_similarity_hook TEXT,
  ranking_version TEXT NOT NULL,
  ranked_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (raw_source_item_id)
    REFERENCES raw_source_items(id)
    ON DELETE CASCADE,
  FOREIGN KEY (duplicate_cluster_id)
    REFERENCES item_duplicate_clusters(id)
    ON DELETE SET NULL,
  FOREIGN KEY (duplicate_of_raw_source_item_id)
    REFERENCES raw_source_items(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ranked_processing_candidates_score_idx
  ON ranked_processing_candidates(selection_status, rank_score DESC, ranked_at DESC);

CREATE INDEX IF NOT EXISTS ranked_processing_candidates_ranked_at_idx
  ON ranked_processing_candidates(ranked_at DESC);

CREATE INDEX IF NOT EXISTS ranked_processing_candidates_cluster_idx
  ON ranked_processing_candidates(duplicate_cluster_id);
`,
  },
  {
    id: "0003_source_intelligence_cache_indexes.sql",
    sql: `
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
`,
  },
];
