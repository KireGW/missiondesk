import { createHash, randomUUID } from "node:crypto";
import type { MissionDeskDb } from "@/lib/db/postgres";
import { getMigratedDb } from "@/lib/db/postgres";
import { cacheFreshnessState } from "@/lib/intelligence/cache-policy";
import type {
  BackgroundJob,
  BackgroundJobFilters,
  Briefing,
  BriefingFilters,
  IngestionUpdateState,
  IngestionUpdateStatus,
  ItemDuplicateCluster,
  NewBackgroundJob,
  NewBriefing,
  NewItemDuplicateCluster,
  NewProcessedItem,
  NewRankedProcessingCandidate,
  NewRawSourceItem,
  ProcessedIntelligenceRecord,
  ProcessedItem,
  ProcessedItemFilters,
  RankedCandidateRecord,
  RankedCandidateFilters,
  RankedProcessingCandidate,
  RawSourceItem,
  RawSourceItemFilters,
} from "@/lib/intelligence/models";
import type { CacheFreshnessState } from "@/lib/intelligence/cache-policy";

type DbValue = string | number | null;

type RawSourceItemRow = Omit<
  RawSourceItem,
  | "published_at"
  | "detected_country"
  | "detected_region"
  | "detected_city"
  | "snippet"
  | "raw_content"
> & {
  published_at: string | null;
  detected_country: string | null;
  detected_region: string | null;
  detected_city: string | null;
  snippet: string | null;
  raw_content: string | null;
};

type ProcessedItemRow = Omit<ProcessedItem, "geographic_tags" | "profile_tags" | "event_date"> & {
  geographic_tags: string;
  profile_tags: string;
  event_date: string | null;
};

type BriefingRow = Omit<Briefing, "region" | "source_item_ids"> & {
  region: string | null;
  source_item_ids: string;
};

export interface RawSourceItemCacheStatus {
  freshness: CacheFreshnessState;
  item: RawSourceItem | null;
}

export interface ProcessedItemCacheStatus {
  freshness: CacheFreshnessState;
  item: ProcessedItem | null;
}

export interface BriefingCacheStatus {
  freshness: CacheFreshnessState;
  item: Briefing | null;
}

type BackgroundJobRow = Omit<
  BackgroundJob,
  "payload" | "locked_at" | "locked_by" | "error_message"
> & {
  payload: string;
  locked_at: string | null;
  locked_by: string | null;
  error_message: string | null;
};

type ItemDuplicateClusterRow = Omit<
  ItemDuplicateCluster,
  | "duplicate_raw_source_item_ids"
  | "title_fingerprint"
  | "url_fingerprint"
  | "embedding_cluster_id"
> & {
  duplicate_raw_source_item_ids: string;
  title_fingerprint: string | null;
  url_fingerprint: string | null;
  embedding_cluster_id: string | null;
};

type RankedProcessingCandidateRow = Omit<
  RankedProcessingCandidate,
  "duplicate_cluster_id" | "duplicate_of_raw_source_item_id" | "embedding_similarity_hook"
> & {
  duplicate_cluster_id: string | null;
  duplicate_of_raw_source_item_id: string | null;
  embedding_similarity_hook: string | null;
};

type IngestionUpdateStateRow = Omit<
  IngestionUpdateState,
  "started_at" | "completed_at" | "error_message" | "last_ingested_at"
> & {
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  last_ingested_at: string | null;
};

interface JoinedRankedCandidateRow extends RankedProcessingCandidateRow {
  raw_id: string;
  raw_source_type: RawSourceItem["source_type"];
  raw_title_original: string;
  raw_url: string;
  raw_source_name: string;
  raw_source_country: string;
  raw_source_language: string;
  raw_published_at: string | null;
  raw_detected_country: string | null;
  raw_detected_region: string | null;
  raw_detected_city: string | null;
  raw_snippet: string | null;
  raw_raw_content: string | null;
  raw_source_priority: number;
  raw_credibility_score: number;
  raw_crawl_status: RawSourceItem["crawl_status"];
  raw_created_at: string;
  raw_updated_at: string;
}

interface JoinedProcessedRow extends ProcessedItemRow {
  raw_id: string;
  raw_source_type: RawSourceItem["source_type"];
  raw_title_original: string;
  raw_url: string;
  raw_source_name: string;
  raw_source_country: string;
  raw_source_language: string;
  raw_published_at: string | null;
  raw_detected_country: string | null;
  raw_detected_region: string | null;
  raw_detected_city: string | null;
  raw_snippet: string | null;
  raw_raw_content: string | null;
  raw_source_priority: number;
  raw_credibility_score: number;
  raw_crawl_status: RawSourceItem["crawl_status"];
  raw_created_at: string;
  raw_updated_at: string;
}

const optional = (value: string | null | undefined) => value ?? undefined;
const nullable = (value: string | undefined) => value ?? null;
const nowIso = () => new Date().toISOString();

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function stringifyArray(value: readonly string[]) {
  return JSON.stringify([...new Set(value)]);
}

function stringifyPayload(value: Record<string, unknown>) {
  return JSON.stringify(value);
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function limitValue(value: number | undefined, fallback: number) {
  if (!value || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(250, Math.round(value)));
}

function placeholders(values: readonly unknown[]) {
  return values.map(() => "?").join(", ");
}

export function createRawSourceItemId(input: Pick<NewRawSourceItem, "url" | "title_original" | "source_name">) {
  const stableKey = input.url || `${input.source_name}:${input.title_original}`;
  return createHash("sha256").update(stableKey).digest("hex").slice(0, 32);
}

function mapRawSourceItem(row: RawSourceItemRow): RawSourceItem {
  return {
    ...row,
    published_at: optional(row.published_at),
    detected_country: optional(row.detected_country),
    detected_region: optional(row.detected_region),
    detected_city: optional(row.detected_city),
    snippet: optional(row.snippet),
    raw_content: optional(row.raw_content),
  };
}

function mapProcessedItem(row: ProcessedItemRow): ProcessedItem {
  return {
    ...row,
    geographic_tags: parseStringArray(row.geographic_tags),
    profile_tags: parseStringArray(row.profile_tags) as ProcessedItem["profile_tags"],
    event_date: optional(row.event_date),
  };
}

function mapBriefing(row: BriefingRow): Briefing {
  return {
    ...row,
    region: optional(row.region),
    source_item_ids: parseStringArray(row.source_item_ids),
  };
}

function mapBackgroundJob(row: BackgroundJobRow): BackgroundJob {
  return {
    ...row,
    payload: parsePayload(row.payload),
    locked_at: optional(row.locked_at),
    locked_by: optional(row.locked_by),
    error_message: optional(row.error_message),
  };
}

function mapDuplicateCluster(row: ItemDuplicateClusterRow): ItemDuplicateCluster {
  return {
    ...row,
    duplicate_raw_source_item_ids: parseStringArray(row.duplicate_raw_source_item_ids),
    title_fingerprint: optional(row.title_fingerprint),
    url_fingerprint: optional(row.url_fingerprint),
    embedding_cluster_id: optional(row.embedding_cluster_id),
  };
}

function mapRankedCandidate(row: RankedProcessingCandidateRow): RankedProcessingCandidate {
  return {
    ...row,
    duplicate_cluster_id: optional(row.duplicate_cluster_id),
    duplicate_of_raw_source_item_id: optional(row.duplicate_of_raw_source_item_id),
    embedding_similarity_hook: optional(row.embedding_similarity_hook),
  };
}

function mapIngestionUpdateState(row: IngestionUpdateStateRow): IngestionUpdateState {
  return {
    ...row,
    started_at: optional(row.started_at),
    completed_at: optional(row.completed_at),
    error_message: optional(row.error_message),
    last_ingested_at: optional(row.last_ingested_at),
  };
}

function mapJoinedProcessed(row: JoinedProcessedRow): ProcessedIntelligenceRecord {
  return {
    raw: mapRawSourceItem({
      id: row.raw_id,
      source_type: row.raw_source_type,
      title_original: row.raw_title_original,
      url: row.raw_url,
      source_name: row.raw_source_name,
      source_country: row.raw_source_country,
      source_language: row.raw_source_language,
      published_at: row.raw_published_at,
      detected_country: row.raw_detected_country,
      detected_region: row.raw_detected_region,
      detected_city: row.raw_detected_city,
      snippet: row.raw_snippet,
      raw_content: row.raw_raw_content,
      source_priority: row.raw_source_priority,
      credibility_score: row.raw_credibility_score,
      crawl_status: row.raw_crawl_status,
      created_at: row.raw_created_at,
      updated_at: row.raw_updated_at,
    }),
    processed: mapProcessedItem(row),
  };
}

function mapJoinedRankedCandidate(row: JoinedRankedCandidateRow): RankedCandidateRecord {
  return {
    raw: mapRawSourceItem({
      id: row.raw_id,
      source_type: row.raw_source_type,
      title_original: row.raw_title_original,
      url: row.raw_url,
      source_name: row.raw_source_name,
      source_country: row.raw_source_country,
      source_language: row.raw_source_language,
      published_at: row.raw_published_at,
      detected_country: row.raw_detected_country,
      detected_region: row.raw_detected_region,
      detected_city: row.raw_detected_city,
      snippet: row.raw_snippet,
      raw_content: row.raw_raw_content,
      source_priority: row.raw_source_priority,
      credibility_score: row.raw_credibility_score,
      crawl_status: row.raw_crawl_status,
      created_at: row.raw_created_at,
      updated_at: row.raw_updated_at,
    }),
    candidate: mapRankedCandidate(row),
  };
}

export async function upsertRawSourceItem(input: NewRawSourceItem, db: MissionDeskDb = getMigratedDb()) {
  const id = input.id || createRawSourceItemId(input);
  const item: NewRawSourceItem = {
    ...input,
    id,
    source_priority: clampScore(input.source_priority),
    credibility_score: clampScore(input.credibility_score),
  };

  await db.prepare(`
    INSERT INTO raw_source_items (
      id,
      source_type,
      title_original,
      url,
      source_name,
      source_country,
      source_language,
      published_at,
      detected_country,
      detected_region,
      detected_city,
      snippet,
      raw_content,
      source_priority,
      credibility_score,
      crawl_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_type = excluded.source_type,
      title_original = excluded.title_original,
      url = excluded.url,
      source_name = excluded.source_name,
      source_country = excluded.source_country,
      source_language = excluded.source_language,
      published_at = excluded.published_at,
      detected_country = excluded.detected_country,
      detected_region = excluded.detected_region,
      detected_city = excluded.detected_city,
      snippet = excluded.snippet,
      raw_content = excluded.raw_content,
      source_priority = excluded.source_priority,
      credibility_score = excluded.credibility_score,
      crawl_status = excluded.crawl_status,
      updated_at = datetime('now')
  `).run(
    id,
    item.source_type,
    item.title_original,
    item.url,
    item.source_name,
    item.source_country,
    item.source_language,
    nullable(item.published_at),
    nullable(item.detected_country),
    nullable(item.detected_region),
    nullable(item.detected_city),
    nullable(item.snippet),
    nullable(item.raw_content),
    item.source_priority,
    item.credibility_score,
    item.crawl_status,
  );

  return (await getRawSourceItemById(id, db))!;
}

export async function getRawSourceItemById(id: string, db: MissionDeskDb = getMigratedDb()) {
  const row = await db
    .prepare("SELECT * FROM raw_source_items WHERE id = ?")
    .get(id) as RawSourceItemRow | undefined;

  return row ? mapRawSourceItem(row) : null;
}

export async function getRawSourceItemByUrl(url: string, db: MissionDeskDb = getMigratedDb()) {
  const row = await db
    .prepare("SELECT * FROM raw_source_items WHERE url = ? LIMIT 1")
    .get(url) as RawSourceItemRow | undefined;

  return row ? mapRawSourceItem(row) : null;
}

export async function listRawSourceItems(filters: RawSourceItemFilters = {}, db: MissionDeskDb = getMigratedDb()) {
  const where: string[] = [];
  const params: DbValue[] = [];

  if (filters.sourceType) {
    where.push("source_type = ?");
    params.push(filters.sourceType);
  }

  if (filters.crawlStatus) {
    where.push("crawl_status = ?");
    params.push(filters.crawlStatus);
  }

  if (filters.sourceName) {
    where.push("source_name = ?");
    params.push(filters.sourceName);
  }

  if (filters.detectedCountry) {
    where.push("detected_country = ?");
    params.push(filters.detectedCountry);
  }

  if (filters.detectedRegion) {
    where.push("detected_region = ?");
    params.push(filters.detectedRegion);
  }

  if (filters.ids && filters.ids.length > 0) {
    where.push(`id IN (${placeholders(filters.ids)})`);
    params.push(...filters.ids);
  }

  if (filters.since) {
    where.push("datetime(COALESCE(published_at, created_at)) >= datetime(?)");
    params.push(filters.since);
  }

  if (filters.excludeProcessed) {
    where.push(`
      NOT EXISTS (
        SELECT 1
        FROM processed_items
        WHERE processed_items.raw_source_item_id = raw_source_items.id
      )
    `);
  }

  if (filters.excludeFreshProcessed) {
    where.push(`
      NOT EXISTS (
        SELECT 1
        FROM processed_items
        WHERE processed_items.raw_source_item_id = raw_source_items.id
          AND datetime(processed_items.cache_expires_at) > datetime(?)
      )
    `);
    params.push(nowIso());
  }

  // Signal tracking and deep source exploration need a wider search window than
  // the default repository clamp used by user-facing list endpoints.
  const rawListLimit = Math.max(1, Math.min(5000, Math.round(filters.limit ?? 100)));

  const rows = await db
    .prepare(`
      SELECT *
      FROM raw_source_items
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY
        COALESCE(published_at, created_at) DESC,
        source_priority DESC
      LIMIT ?
    `)
    .all(...params, rawListLimit) as unknown as RawSourceItemRow[];

  return rows.map(mapRawSourceItem);
}

export async function upsertDuplicateCluster(
  input: NewItemDuplicateCluster,
  db: MissionDeskDb = getMigratedDb(),
) {
  await db.prepare(`
    INSERT INTO item_duplicate_clusters (
      id,
      canonical_raw_source_item_id,
      duplicate_raw_source_item_ids,
      duplicate_strategy,
      title_fingerprint,
      url_fingerprint,
      embedding_cluster_id,
      source_count
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      canonical_raw_source_item_id = excluded.canonical_raw_source_item_id,
      duplicate_raw_source_item_ids = excluded.duplicate_raw_source_item_ids,
      duplicate_strategy = excluded.duplicate_strategy,
      title_fingerprint = excluded.title_fingerprint,
      url_fingerprint = excluded.url_fingerprint,
      embedding_cluster_id = excluded.embedding_cluster_id,
      source_count = excluded.source_count,
      updated_at = datetime('now')
  `).run(
    input.id,
    input.canonical_raw_source_item_id,
    stringifyArray(input.duplicate_raw_source_item_ids),
    input.duplicate_strategy,
    nullable(input.title_fingerprint),
    nullable(input.url_fingerprint),
    nullable(input.embedding_cluster_id),
    input.source_count,
  );

  return (await getDuplicateClusterById(input.id, db))!;
}

export async function getDuplicateClusterById(id: string, db: MissionDeskDb = getMigratedDb()) {
  const row = await db
    .prepare("SELECT * FROM item_duplicate_clusters WHERE id = ?")
    .get(id) as ItemDuplicateClusterRow | undefined;

  return row ? mapDuplicateCluster(row) : null;
}

export async function upsertRankedCandidate(
  input: NewRankedProcessingCandidate,
  db: MissionDeskDb = getMigratedDb(),
) {
  await db.prepare(`
    INSERT INTO ranked_processing_candidates (
      raw_source_item_id,
      rank_score,
      selection_status,
      selection_reason,
      freshness_score,
      source_priority_score,
      credibility_score,
      keyword_relevance_score,
      diplomatic_relevance_score,
      sweden_relevance_score,
      geographic_relevance_score,
      category_relevance_score,
      novelty_score,
      cross_source_confirmation_score,
      duplicate_cluster_id,
      duplicate_of_raw_source_item_id,
      embedding_similarity_hook,
      ranking_version,
      ranked_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(raw_source_item_id) DO UPDATE SET
      rank_score = excluded.rank_score,
      selection_status = excluded.selection_status,
      selection_reason = excluded.selection_reason,
      freshness_score = excluded.freshness_score,
      source_priority_score = excluded.source_priority_score,
      credibility_score = excluded.credibility_score,
      keyword_relevance_score = excluded.keyword_relevance_score,
      diplomatic_relevance_score = excluded.diplomatic_relevance_score,
      sweden_relevance_score = excluded.sweden_relevance_score,
      geographic_relevance_score = excluded.geographic_relevance_score,
      category_relevance_score = excluded.category_relevance_score,
      novelty_score = excluded.novelty_score,
      cross_source_confirmation_score = excluded.cross_source_confirmation_score,
      duplicate_cluster_id = excluded.duplicate_cluster_id,
      duplicate_of_raw_source_item_id = excluded.duplicate_of_raw_source_item_id,
      embedding_similarity_hook = excluded.embedding_similarity_hook,
      ranking_version = excluded.ranking_version,
      ranked_at = excluded.ranked_at,
      updated_at = datetime('now')
  `).run(
    input.raw_source_item_id,
    clampScore(input.rank_score),
    input.selection_status,
    input.selection_reason,
    clampScore(input.freshness_score),
    clampScore(input.source_priority_score),
    clampScore(input.credibility_score),
    clampScore(input.keyword_relevance_score),
    clampScore(input.diplomatic_relevance_score),
    clampScore(input.sweden_relevance_score),
    clampScore(input.geographic_relevance_score),
    clampScore(input.category_relevance_score),
    clampScore(input.novelty_score),
    clampScore(input.cross_source_confirmation_score),
    nullable(input.duplicate_cluster_id),
    nullable(input.duplicate_of_raw_source_item_id),
    nullable(input.embedding_similarity_hook),
    input.ranking_version,
    input.ranked_at,
  );

  return (await getRankedCandidateByRawId(input.raw_source_item_id, db))!;
}

export async function getRankedCandidateByRawId(
  rawSourceItemId: string,
  db: MissionDeskDb = getMigratedDb(),
) {
  const row = await db
    .prepare("SELECT * FROM ranked_processing_candidates WHERE raw_source_item_id = ?")
    .get(rawSourceItemId) as RankedProcessingCandidateRow | undefined;

  return row ? mapRankedCandidate(row) : null;
}

export async function listRankedCandidates(
  filters: RankedCandidateFilters = {},
  db: MissionDeskDb = getMigratedDb(),
) {
  const where: string[] = [];
  const params: DbValue[] = [];

  if (filters.status) {
    where.push("ranked_processing_candidates.selection_status = ?");
    params.push(filters.status);
  }

  if (filters.since) {
    where.push("datetime(ranked_processing_candidates.ranked_at) >= datetime(?)");
    params.push(filters.since);
  }

  if (filters.rawSourceItemIds && filters.rawSourceItemIds.length > 0) {
    where.push(`ranked_processing_candidates.raw_source_item_id IN (${placeholders(filters.rawSourceItemIds)})`);
    params.push(...filters.rawSourceItemIds);
  }

  const rows = await db
    .prepare(`
      SELECT
        ranked_processing_candidates.*,
        raw_source_items.id AS raw_id,
        raw_source_items.source_type AS raw_source_type,
        raw_source_items.title_original AS raw_title_original,
        raw_source_items.url AS raw_url,
        raw_source_items.source_name AS raw_source_name,
        raw_source_items.source_country AS raw_source_country,
        raw_source_items.source_language AS raw_source_language,
        raw_source_items.published_at AS raw_published_at,
        raw_source_items.detected_country AS raw_detected_country,
        raw_source_items.detected_region AS raw_detected_region,
        raw_source_items.detected_city AS raw_detected_city,
        raw_source_items.snippet AS raw_snippet,
        raw_source_items.raw_content AS raw_raw_content,
        raw_source_items.source_priority AS raw_source_priority,
        raw_source_items.credibility_score AS raw_credibility_score,
        raw_source_items.crawl_status AS raw_crawl_status,
        raw_source_items.created_at AS raw_created_at,
        raw_source_items.updated_at AS raw_updated_at
      FROM ranked_processing_candidates
      INNER JOIN raw_source_items
        ON raw_source_items.id = ranked_processing_candidates.raw_source_item_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY
        ranked_processing_candidates.rank_score DESC,
        ranked_processing_candidates.ranked_at DESC
      LIMIT ?
    `)
    .all(...params, limitValue(filters.limit, 100)) as unknown as JoinedRankedCandidateRow[];

  return rows.map(mapJoinedRankedCandidate);
}

export async function markRawSourceItemStatus(
  id: string,
  crawlStatus: RawSourceItem["crawl_status"],
  db: MissionDeskDb = getMigratedDb(),
) {
  await db.prepare(`
    UPDATE raw_source_items
    SET crawl_status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(crawlStatus, id);

  return getRawSourceItemById(id, db);
}

export async function upsertProcessedItem(input: NewProcessedItem, db: MissionDeskDb = getMigratedDb()) {
  await db.prepare(`
    INSERT INTO processed_items (
      raw_source_item_id,
      title_sv,
      summary_sv,
      category,
      urgency_score,
      diplomatic_relevance_score,
      sweden_relevance_score,
      economic_impact_score,
      security_impact_score,
      geographic_scope,
      geographic_tags,
      why_it_may_matter_sv,
      profile_tags,
      event_date,
      processed_model,
      processed_at,
      cache_expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(raw_source_item_id) DO UPDATE SET
      title_sv = excluded.title_sv,
      summary_sv = excluded.summary_sv,
      category = excluded.category,
      urgency_score = excluded.urgency_score,
      diplomatic_relevance_score = excluded.diplomatic_relevance_score,
      sweden_relevance_score = excluded.sweden_relevance_score,
      economic_impact_score = excluded.economic_impact_score,
      security_impact_score = excluded.security_impact_score,
      geographic_scope = excluded.geographic_scope,
      geographic_tags = excluded.geographic_tags,
      why_it_may_matter_sv = excluded.why_it_may_matter_sv,
      profile_tags = excluded.profile_tags,
      event_date = excluded.event_date,
      processed_model = excluded.processed_model,
      processed_at = excluded.processed_at,
      cache_expires_at = excluded.cache_expires_at,
      updated_at = datetime('now')
  `).run(
    input.raw_source_item_id,
    input.title_sv,
    input.summary_sv,
    input.category,
    clampScore(input.urgency_score),
    clampScore(input.diplomatic_relevance_score),
    clampScore(input.sweden_relevance_score),
    clampScore(input.economic_impact_score),
    clampScore(input.security_impact_score),
    input.geographic_scope,
    stringifyArray(input.geographic_tags),
    input.why_it_may_matter_sv,
    stringifyArray(input.profile_tags),
    nullable(input.event_date),
    input.processed_model,
    input.processed_at,
    input.cache_expires_at,
  );

  return (await getProcessedItemByRawId(input.raw_source_item_id, db))!;
}

export async function getProcessedItemByRawId(rawSourceItemId: string, db: MissionDeskDb = getMigratedDb()) {
  const row = await db
    .prepare("SELECT * FROM processed_items WHERE raw_source_item_id = ?")
    .get(rawSourceItemId) as ProcessedItemRow | undefined;

  return row ? mapProcessedItem(row) : null;
}

export async function getFreshProcessedItemByRawId(
  rawSourceItemId: string,
  db: MissionDeskDb = getMigratedDb(),
) {
  const row = await db
    .prepare(`
      SELECT *
      FROM processed_items
      WHERE raw_source_item_id = ?
        AND datetime(cache_expires_at) > datetime(?)
      LIMIT 1
    `)
    .get(rawSourceItemId, nowIso()) as ProcessedItemRow | undefined;

  return row ? mapProcessedItem(row) : null;
}

export async function listProcessedItems(
  filters: ProcessedItemFilters = {},
  db: MissionDeskDb = getMigratedDb(),
) {
  const where: string[] = [];
  const params: DbValue[] = [];
  const now = nowIso();

  if (filters.category) {
    where.push("processed_items.category = ?");
    params.push(filters.category);
  }

  if (filters.profile) {
    where.push("processed_items.profile_tags LIKE ?");
    params.push(`%"${filters.profile}"%`);
  }

  if (filters.geographicTag) {
    where.push("processed_items.geographic_tags LIKE ?");
    params.push(`%"${filters.geographicTag}"%`);
  }

  if (filters.onlyFresh ?? true) {
    if (filters.publishedSince) {
      where.push(`
        (
          datetime(processed_items.cache_expires_at) > datetime(?)
          OR datetime(COALESCE(raw_source_items.published_at, raw_source_items.created_at)) >= datetime(?)
        )
      `);
      params.push(now, filters.publishedSince);
    } else {
      where.push("datetime(processed_items.cache_expires_at) > datetime(?)");
      params.push(now);
    }
  }

  const rows = await db
    .prepare(`
      SELECT
        processed_items.*,
        raw_source_items.id AS raw_id,
        raw_source_items.source_type AS raw_source_type,
        raw_source_items.title_original AS raw_title_original,
        raw_source_items.url AS raw_url,
        raw_source_items.source_name AS raw_source_name,
        raw_source_items.source_country AS raw_source_country,
        raw_source_items.source_language AS raw_source_language,
        raw_source_items.published_at AS raw_published_at,
        raw_source_items.detected_country AS raw_detected_country,
        raw_source_items.detected_region AS raw_detected_region,
        raw_source_items.detected_city AS raw_detected_city,
        raw_source_items.snippet AS raw_snippet,
        raw_source_items.raw_content AS raw_raw_content,
        raw_source_items.source_priority AS raw_source_priority,
        raw_source_items.credibility_score AS raw_credibility_score,
        raw_source_items.crawl_status AS raw_crawl_status,
        raw_source_items.created_at AS raw_created_at,
        raw_source_items.updated_at AS raw_updated_at
      FROM processed_items
      INNER JOIN raw_source_items
        ON raw_source_items.id = processed_items.raw_source_item_id
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY
        processed_items.urgency_score DESC,
        processed_items.diplomatic_relevance_score DESC,
        raw_source_items.source_priority DESC,
        COALESCE(raw_source_items.published_at, processed_items.processed_at) DESC
      LIMIT ?
    `)
    .all(...params, limitValue(filters.limit, 100)) as unknown as JoinedProcessedRow[];

  return rows.map(mapJoinedProcessed);
}

export async function listExpiredProcessedItems(limit = 100, db: MissionDeskDb = getMigratedDb()) {
  const rows = await db
    .prepare(`
      SELECT *
      FROM processed_items
      WHERE datetime(cache_expires_at) <= datetime(?)
      ORDER BY cache_expires_at ASC
      LIMIT ?
    `)
    .all(nowIso(), limitValue(limit, 100)) as unknown as ProcessedItemRow[];

  return rows.map(mapProcessedItem);
}

export async function getProcessedItemCacheStatus(
  rawSourceItemId: string,
  db: MissionDeskDb = getMigratedDb(),
): Promise<ProcessedItemCacheStatus> {
  const item = await getProcessedItemByRawId(rawSourceItemId, db);

  return {
    freshness: cacheFreshnessState(item?.cache_expires_at),
    item,
  };
}

export async function upsertBriefing(input: NewBriefing, db: MissionDeskDb = getMigratedDb()) {
  await db.prepare(`
    INSERT INTO briefings (
      id,
      type,
      profile,
      geographic_scope,
      region,
      content_sv,
      source_item_ids,
      generated_model,
      generated_at,
      cache_expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      profile = excluded.profile,
      geographic_scope = excluded.geographic_scope,
      region = excluded.region,
      content_sv = excluded.content_sv,
      source_item_ids = excluded.source_item_ids,
      generated_model = excluded.generated_model,
      generated_at = excluded.generated_at,
      cache_expires_at = excluded.cache_expires_at,
      updated_at = datetime('now')
  `).run(
    input.id,
    input.type,
    input.profile,
    input.geographic_scope,
    nullable(input.region),
    input.content_sv,
    stringifyArray(input.source_item_ids),
    input.generated_model,
    input.generated_at,
    input.cache_expires_at,
  );

  return (await getBriefingById(input.id, db))!;
}

export async function getBriefingById(id: string, db: MissionDeskDb = getMigratedDb()) {
  const row = await db
    .prepare("SELECT * FROM briefings WHERE id = ?")
    .get(id) as BriefingRow | undefined;

  return row ? mapBriefing(row) : null;
}

export async function getFreshBriefing(
  input: Pick<Briefing, "type" | "profile" | "geographic_scope"> & { region?: string },
  db: MissionDeskDb = getMigratedDb(),
) {
  const row = await db
    .prepare(`
      SELECT *
      FROM briefings
      WHERE type = ?
        AND profile = ?
        AND geographic_scope = ?
        AND COALESCE(region, '') = COALESCE(?, '')
        AND datetime(cache_expires_at) > datetime(?)
      ORDER BY generated_at DESC
      LIMIT 1
    `)
    .get(
      input.type,
      input.profile,
      input.geographic_scope,
      nullable(input.region),
      nowIso(),
    ) as BriefingRow | undefined;

  return row ? mapBriefing(row) : null;
}

export async function listBriefings(
  filters: BriefingFilters = {},
  db: MissionDeskDb = getMigratedDb(),
) {
  const where: string[] = [];
  const params: DbValue[] = [];

  if (filters.type) {
    where.push("type = ?");
    params.push(filters.type);
  }

  if (filters.profile) {
    where.push("profile = ?");
    params.push(filters.profile);
  }

  if (filters.geographicScope) {
    where.push("geographic_scope = ?");
    params.push(filters.geographicScope);
  }

  if (filters.region) {
    where.push("region = ?");
    params.push(filters.region);
  }

  if (filters.onlyFresh ?? true) {
    where.push("datetime(cache_expires_at) > datetime(?)");
    params.push(nowIso());
  }

  const rows = await db
    .prepare(`
      SELECT *
      FROM briefings
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY generated_at DESC
      LIMIT ?
    `)
    .all(...params, limitValue(filters.limit, 25)) as unknown as BriefingRow[];

  return rows.map(mapBriefing);
}

export async function listExpiredBriefings(limit = 25, db: MissionDeskDb = getMigratedDb()) {
  const rows = await db
    .prepare(`
      SELECT *
      FROM briefings
      WHERE datetime(cache_expires_at) <= datetime(?)
      ORDER BY cache_expires_at ASC
      LIMIT ?
    `)
    .all(nowIso(), limitValue(limit, 25)) as unknown as BriefingRow[];

  return rows.map(mapBriefing);
}

export async function getBriefingCacheStatus(
  input: Pick<Briefing, "type" | "profile" | "geographic_scope"> & { region?: string },
  db: MissionDeskDb = getMigratedDb(),
): Promise<BriefingCacheStatus> {
  const item = (await getFreshBriefing(input, db)) ?? (await getLatestBriefingByKey(input, db));

  return {
    freshness: cacheFreshnessState(item?.cache_expires_at),
    item,
  };
}

async function getLatestBriefingByKey(
  input: Pick<Briefing, "type" | "profile" | "geographic_scope"> & { region?: string },
  db: MissionDeskDb = getMigratedDb(),
) {
  const row = await db
    .prepare(`
      SELECT *
      FROM briefings
      WHERE type = ?
        AND profile = ?
        AND geographic_scope = ?
        AND COALESCE(region, '') = COALESCE(?, '')
      ORDER BY generated_at DESC
      LIMIT 1
    `)
    .get(
      input.type,
      input.profile,
      input.geographic_scope,
      nullable(input.region),
    ) as BriefingRow | undefined;

  return row ? mapBriefing(row) : null;
}

export async function enqueueBackgroundJob(input: NewBackgroundJob, db: MissionDeskDb = getMigratedDb()) {
  const job: Required<
    Pick<NewBackgroundJob, "id" | "status" | "priority" | "attempts" | "max_attempts" | "run_after">
  > &
    NewBackgroundJob = {
    ...input,
    id: input.id ?? randomUUID(),
    status: input.status ?? "pending",
    priority: input.priority ?? 50,
    attempts: input.attempts ?? 0,
    max_attempts: input.max_attempts ?? 3,
    run_after: input.run_after ?? nowIso(),
  };

  await db.prepare(`
    INSERT INTO background_jobs (
      id,
      type,
      status,
      priority,
      payload,
      attempts,
      max_attempts,
      run_after,
      locked_at,
      locked_by,
      error_message
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      status = excluded.status,
      priority = excluded.priority,
      payload = excluded.payload,
      attempts = excluded.attempts,
      max_attempts = excluded.max_attempts,
      run_after = excluded.run_after,
      locked_at = excluded.locked_at,
      locked_by = excluded.locked_by,
      error_message = excluded.error_message,
      updated_at = datetime('now')
  `).run(
    job.id,
    job.type,
    job.status,
    job.priority,
    stringifyPayload(job.payload),
    job.attempts,
    job.max_attempts,
    job.run_after,
    nullable(job.locked_at),
    nullable(job.locked_by),
    nullable(job.error_message),
  );

  return (await getBackgroundJobById(job.id, db))!;
}

export async function getBackgroundJobById(id: string, db: MissionDeskDb = getMigratedDb()) {
  const row = await db
    .prepare("SELECT * FROM background_jobs WHERE id = ?")
    .get(id) as BackgroundJobRow | undefined;

  return row ? mapBackgroundJob(row) : null;
}

export async function updateBackgroundJobPayload(
  id: string,
  payload: Record<string, unknown>,
  db: MissionDeskDb = getMigratedDb(),
) {
  const current = await getBackgroundJobById(id, db);
  if (!current) return null;

  await db.prepare(`
    UPDATE background_jobs
    SET
      payload = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(stringifyPayload({ ...current.payload, ...payload }), id);

  return getBackgroundJobById(id, db);
}

export async function listPendingBackgroundJobs(limit = 25, db: MissionDeskDb = getMigratedDb()) {
  const rows = await db
    .prepare(`
      SELECT *
      FROM background_jobs
      WHERE status = 'pending'
        AND datetime(run_after) <= datetime(?)
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `)
    .all(nowIso(), limitValue(limit, 25)) as unknown as BackgroundJobRow[];

  return rows.map(mapBackgroundJob);
}

export async function listBackgroundJobs(
  filters: BackgroundJobFilters = {},
  db: MissionDeskDb = getMigratedDb(),
) {
  const where: string[] = [];
  const params: DbValue[] = [];

  if (filters.type) {
    where.push("type = ?");
    params.push(filters.type);
  }

  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }

  const rows = await db
    .prepare(`
      SELECT *
      FROM background_jobs
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `)
    .all(...params, limitValue(filters.limit, 25)) as unknown as BackgroundJobRow[];

  return rows.map(mapBackgroundJob);
}

export async function claimBackgroundJobs(
  input: { type?: string; limit?: number; workerId?: string } = {},
  db: MissionDeskDb = getMigratedDb(),
) {
  const workerId = input.workerId ?? `missiondesk-worker-${randomUUID()}`;
  const where = ["status = 'pending'", "datetime(run_after) <= datetime(?)"];
  const params: DbValue[] = [nowIso()];

  if (input.type) {
    where.push("type = ?");
    params.push(input.type);
  }

  const rows = await db
    .prepare(`
      SELECT *
      FROM background_jobs
      WHERE ${where.join(" AND ")}
      ORDER BY priority DESC, created_at ASC
      LIMIT ?
    `)
    .all(...params, limitValue(input.limit, 10)) as unknown as BackgroundJobRow[];

  for (const row of rows) {
    await db.prepare(`
      UPDATE background_jobs
      SET
        status = 'running',
        attempts = attempts + 1,
        locked_at = datetime('now'),
        locked_by = ?,
        updated_at = datetime('now')
      WHERE id = ?
        AND status = 'pending'
    `).run(workerId, row.id);
  }

  const claimed = await Promise.all(rows.map((row) => getBackgroundJobById(row.id, db)));
  return claimed
    .filter((job): job is BackgroundJob => Boolean(job));
}

export async function completeBackgroundJob(id: string, db: MissionDeskDb = getMigratedDb()) {
  await db.prepare(`
    UPDATE background_jobs
    SET
      status = 'completed',
      locked_at = NULL,
      locked_by = NULL,
      error_message = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(id);

  return getBackgroundJobById(id, db);
}

export async function failBackgroundJob(
  id: string,
  errorMessage: string,
  db: MissionDeskDb = getMigratedDb(),
) {
  const current = await getBackgroundJobById(id, db);
  const shouldRetry = current ? current.attempts < current.max_attempts : false;
  const status = shouldRetry ? "pending" : "failed";

  await db.prepare(`
    UPDATE background_jobs
    SET
      status = ?,
      run_after = datetime('now', '+10 minutes'),
      locked_at = NULL,
      locked_by = NULL,
      error_message = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(status, errorMessage.slice(0, 1200), id);

  return getBackgroundJobById(id, db);
}

export async function getIngestionUpdateState(
  id = "feed",
  db: MissionDeskDb = getMigratedDb(),
) {
  const row = await db
    .prepare("SELECT * FROM ingestion_update_state WHERE id = ?")
    .get(id) as IngestionUpdateStateRow | undefined;

  if (row) return mapIngestionUpdateState(row);

  await db.prepare(`
    INSERT INTO ingestion_update_state (id, status)
    VALUES (?, 'idle')
    ON CONFLICT(id) DO NOTHING
  `).run(id);

  const created = await db
    .prepare("SELECT * FROM ingestion_update_state WHERE id = ?")
    .get(id) as IngestionUpdateStateRow | undefined;

  return created ? mapIngestionUpdateState(created) : null;
}

export async function updateIngestionUpdateState(
  input: {
    id?: string;
    status: IngestionUpdateStatus;
    started_at?: string | null;
    completed_at?: string | null;
    error_message?: string | null;
    last_ingested_at?: string | null;
  },
  db: MissionDeskDb = getMigratedDb(),
) {
  const id = input.id ?? "feed";
  await db.prepare(`
    INSERT INTO ingestion_update_state (
      id,
      status,
      started_at,
      completed_at,
      error_message,
      last_ingested_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status = excluded.status,
      started_at = excluded.started_at,
      completed_at = excluded.completed_at,
      error_message = excluded.error_message,
      last_ingested_at = COALESCE(excluded.last_ingested_at, ingestion_update_state.last_ingested_at),
      updated_at = datetime('now')
  `).run(
    id,
    input.status,
    nullable(input.started_at ?? undefined),
    nullable(input.completed_at ?? undefined),
    nullable(input.error_message ?? undefined),
    nullable(input.last_ingested_at ?? undefined),
  );

  return getIngestionUpdateState(id, db);
}
