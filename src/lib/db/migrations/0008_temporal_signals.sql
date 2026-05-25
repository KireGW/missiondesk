CREATE TABLE IF NOT EXISTS temporal_signals (
  id TEXT PRIMARY KEY,
  raw_source_item_id TEXT NOT NULL REFERENCES raw_source_items(id) ON DELETE CASCADE,
  date_start TEXT,
  date_end TEXT,
  extracted_date_type TEXT NOT NULL CHECK (
    extracted_date_type IN ('exact', 'range', 'relative', 'deadline', 'estimated', 'implicit')
  ),
  temporal_context TEXT NOT NULL CHECK (
    temporal_context IN (
      'upcoming_event',
      'ongoing_process',
      'future_risk',
      'scheduled_vote',
      'earnings',
      'summit',
      'policy_deadline',
      'regulatory_change',
      'security_window',
      'market_window'
    )
  ),
  temporal_certainty_score INTEGER NOT NULL CHECK (temporal_certainty_score >= 0 AND temporal_certainty_score <= 100),
  strategic_importance_score INTEGER NOT NULL CHECK (strategic_importance_score >= 0 AND strategic_importance_score <= 100),
  sweden_mexico_relevance_score INTEGER NOT NULL CHECK (sweden_mexico_relevance_score >= 0 AND sweden_mexico_relevance_score <= 100),
  extraction_confidence_score INTEGER NOT NULL CHECK (extraction_confidence_score >= 0 AND extraction_confidence_score <= 100),
  source_sentence TEXT NOT NULL,
  normalized_summary TEXT NOT NULL,
  extraction_reason TEXT,
  extraction_model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS temporal_signals_raw_idx
  ON temporal_signals(raw_source_item_id);

CREATE INDEX IF NOT EXISTS temporal_signals_date_idx
  ON temporal_signals(date_start ASC);

CREATE INDEX IF NOT EXISTS temporal_signals_relevance_idx
  ON temporal_signals(strategic_importance_score DESC, sweden_mexico_relevance_score DESC, temporal_certainty_score DESC);
