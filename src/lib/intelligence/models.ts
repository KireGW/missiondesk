import type { GeographicScope, IntelligenceCategory, ProfileMode } from "@/lib/types";

export type SourceIntelligenceType =
  | "news"
  | "government"
  | "institution"
  | "social"
  | "report"
  | "advisory"
  | "event"
  | "other";

export type CrawlStatus = "pending" | "fetched" | "failed" | "skipped" | "stale";

export type BackgroundJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type CandidateSelectionStatus =
  | "candidate"
  | "selected"
  | "deferred"
  | "rejected"
  | "regional_hold";

export type RawIngestionJobType = "ingest_raw_source";

export interface RawSourceItem {
  id: string;
  source_type: SourceIntelligenceType;
  title_original: string;
  url: string;
  source_name: string;
  source_country: string;
  source_language: string;
  published_at?: string;
  detected_country?: string;
  detected_region?: string;
  detected_city?: string;
  snippet?: string;
  raw_content?: string;
  source_priority: number;
  credibility_score: number;
  crawl_status: CrawlStatus;
  created_at: string;
  updated_at: string;
}

export interface ProcessedItem {
  raw_source_item_id: string;
  title_sv: string;
  summary_sv: string;
  category: IntelligenceCategory;
  urgency_score: number;
  diplomatic_relevance_score: number;
  sweden_relevance_score: number;
  economic_impact_score: number;
  security_impact_score: number;
  geographic_scope: GeographicScope;
  geographic_tags: string[];
  why_it_may_matter_sv: string;
  profile_tags: ProfileMode[];
  event_date?: string;
  processed_model: string;
  processed_at: string;
  cache_expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface Briefing {
  id: string;
  type: string;
  profile: ProfileMode;
  geographic_scope: GeographicScope;
  region?: string;
  content_sv: string;
  source_item_ids: string[];
  generated_model: string;
  generated_at: string;
  cache_expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface BackgroundJob {
  id: string;
  type: string;
  status: BackgroundJobStatus;
  priority: number;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_at?: string;
  locked_by?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export type TemporalDateType =
  | "exact"
  | "range"
  | "relative"
  | "deadline"
  | "estimated"
  | "implicit";

export type TemporalContext =
  | "upcoming_event"
  | "ongoing_process"
  | "future_risk"
  | "scheduled_vote"
  | "earnings"
  | "summit"
  | "policy_deadline"
  | "regulatory_change"
  | "security_window"
  | "market_window";

export interface TemporalSignal {
  id: string;
  raw_source_item_id: string;
  date_start?: string;
  date_end?: string;
  extracted_date_type: TemporalDateType;
  temporal_context: TemporalContext;
  temporal_certainty_score: number;
  strategic_importance_score: number;
  sweden_mexico_relevance_score: number;
  extraction_confidence_score: number;
  source_sentence: string;
  normalized_summary: string;
  extraction_reason?: string;
  extraction_model: string;
  created_at: string;
  updated_at: string;
}

export type NewTemporalSignal = Omit<TemporalSignal, "created_at" | "updated_at">;

export interface TemporalSignalRecord {
  signal: TemporalSignal;
  raw: RawSourceItem;
  processed: ProcessedItem;
}

export type IngestionUpdateStatus = "idle" | "pending" | "running" | "completed" | "failed";

export interface IngestionUpdateState {
  id: string;
  status: IngestionUpdateStatus;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  last_ingested_at?: string;
  created_at: string;
  updated_at: string;
}

export interface RawIngestionJobPayload {
  sourceId?: string;
  sourceIds?: string[];
  sourceType?: SourceIntelligenceType;
  limitPerSource?: number;
  concurrency?: number;
  preserveRawContent?: boolean;
  since?: string;
}

export interface ItemDuplicateCluster {
  id: string;
  canonical_raw_source_item_id: string;
  duplicate_raw_source_item_ids: string[];
  duplicate_strategy: string;
  title_fingerprint?: string;
  url_fingerprint?: string;
  embedding_cluster_id?: string;
  source_count: number;
  created_at: string;
  updated_at: string;
}

export interface RankedProcessingCandidate {
  raw_source_item_id: string;
  rank_score: number;
  selection_status: CandidateSelectionStatus;
  selection_reason: string;
  freshness_score: number;
  source_priority_score: number;
  credibility_score: number;
  keyword_relevance_score: number;
  diplomatic_relevance_score: number;
  sweden_relevance_score: number;
  geographic_relevance_score: number;
  category_relevance_score: number;
  novelty_score: number;
  cross_source_confirmation_score: number;
  duplicate_cluster_id?: string;
  duplicate_of_raw_source_item_id?: string;
  embedding_similarity_hook?: string;
  ranking_version: string;
  ranked_at: string;
  created_at: string;
  updated_at: string;
}

export type NewRawSourceItem = Omit<RawSourceItem, "id" | "created_at" | "updated_at"> & {
  id?: string;
  created_at?: string;
  updated_at?: string;
};

export type NewProcessedItem = Omit<ProcessedItem, "created_at" | "updated_at"> & {
  created_at?: string;
  updated_at?: string;
};

export type NewBriefing = Omit<Briefing, "created_at" | "updated_at"> & {
  created_at?: string;
  updated_at?: string;
};

export type NewBackgroundJob = Omit<
  BackgroundJob,
  | "id"
  | "status"
  | "priority"
  | "attempts"
  | "max_attempts"
  | "run_after"
  | "created_at"
  | "updated_at"
> & {
  id?: string;
  status?: BackgroundJobStatus;
  priority?: number;
  attempts?: number;
  max_attempts?: number;
  run_after?: string;
  created_at?: string;
  updated_at?: string;
};

export type NewItemDuplicateCluster = Omit<
  ItemDuplicateCluster,
  "created_at" | "updated_at"
> & {
  created_at?: string;
  updated_at?: string;
};

export type NewRankedProcessingCandidate = Omit<
  RankedProcessingCandidate,
  "created_at" | "updated_at"
> & {
  created_at?: string;
  updated_at?: string;
};

export interface ProcessedIntelligenceRecord {
  raw: RawSourceItem;
  processed: ProcessedItem;
}

export interface RankedCandidateRecord {
  raw: RawSourceItem;
  candidate: RankedProcessingCandidate;
}

export interface RawSourceItemFilters {
  sourceType?: SourceIntelligenceType;
  crawlStatus?: CrawlStatus;
  sourceName?: string;
  detectedCountry?: string;
  detectedRegion?: string;
  since?: string;
  excludeProcessed?: boolean;
  excludeFreshProcessed?: boolean;
  ids?: string[];
  limit?: number;
}

export interface ProcessedItemFilters {
  category?: IntelligenceCategory;
  profile?: ProfileMode;
  geographicTag?: string;
  rawSourceItemIds?: string[];
  onlyFresh?: boolean;
  publishedSince?: string;
  limit?: number;
  offset?: number;
}

export interface RankedCandidateFilters {
  status?: CandidateSelectionStatus;
  since?: string;
  rawSourceItemIds?: string[];
  limit?: number;
}

export interface BriefingFilters {
  type?: string;
  profile?: ProfileMode;
  geographicScope?: GeographicScope;
  region?: string;
  onlyFresh?: boolean;
  limit?: number;
}

export interface BackgroundJobFilters {
  type?: string;
  status?: BackgroundJobStatus;
  limit?: number;
}
