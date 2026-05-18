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
