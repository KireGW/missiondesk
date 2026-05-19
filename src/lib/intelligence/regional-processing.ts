import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import {
  isRegionalProcessingConfigured,
  processRegionalSourceItemWithOpenAI,
  regionalProcessingModel,
} from "@/lib/ai/regional-processing";
import {
  listProcessedItems,
  listRawSourceItems,
  upsertProcessedItem,
} from "@/lib/intelligence/repository";
import { cacheExpiresAtFor, cacheHoursFor } from "@/lib/intelligence/cache-policy";
import { rankRawSourceItems } from "@/lib/intelligence/ranking";
import type {
  NewRankedProcessingCandidate,
  ProcessedIntelligenceRecord,
  RawSourceItem,
} from "@/lib/intelligence/models";
import type { EmbassyConfig } from "@/lib/types";

export interface RegionalProcessingOptions {
  config?: EmbassyConfig;
  regionId: string;
  force?: boolean;
  limit?: number;
  ttlHours?: number;
  scanLimitPerDivision?: number;
}

export interface RegionalProcessingResult {
  status: "ready" | "empty" | "not_configured";
  regionId: string;
  regionLabel: string;
  divisionIds: string[];
  fromCache: boolean;
  reprocessed: boolean;
  processedCount: number;
  freshnessTimestamp?: string;
  cacheExpiresAt?: string;
  items: ProcessedIntelligenceRecord[];
  loadingSteps: string[];
}

const DEFAULT_TTL_HOURS = 18;

function uniqueById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function uniqueRecords(records: ProcessedIntelligenceRecord[]) {
  const seen = new Set<string>();
  return records.filter((record) => {
    if (seen.has(record.raw.id)) return false;
    seen.add(record.raw.id);
    return true;
  });
}

function latestTimestamp(values: Array<string | undefined>) {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value!).getTime())
    .filter(Number.isFinite);

  if (timestamps.length === 0) return undefined;
  return new Date(Math.max(...timestamps)).toISOString();
}

function sortRecords(records: ProcessedIntelligenceRecord[]) {
  return [...records].sort((a, b) => {
    const score =
      b.processed.urgency_score +
      b.processed.diplomatic_relevance_score +
      b.processed.sweden_relevance_score +
      b.processed.security_impact_score -
      (a.processed.urgency_score +
        a.processed.diplomatic_relevance_score +
        a.processed.sweden_relevance_score +
        a.processed.security_impact_score);
    if (score !== 0) return score;
    return (
      new Date(b.processed.processed_at).getTime() -
      new Date(a.processed.processed_at).getTime()
    );
  });
}

function resolveRegion(config: EmbassyConfig, regionId: string) {
  const group = config.geography.regions.find((region) => region.id === regionId);
  if (group) {
    return {
      regionLabel: group.displayName,
      divisionIds: group.divisionIds,
    };
  }

  const division = config.geography.administrativeDivisions.find(
    (item) => item.id === regionId,
  );

  if (division) {
    return {
      regionLabel: division.displayName,
      divisionIds: [division.id],
    };
  }

  return {
    regionLabel: regionId,
    divisionIds: [regionId],
  };
}

async function listFreshRegionalItems(divisionIds: string[], limit: number) {
  const records = await Promise.all(
    divisionIds.map((divisionId) =>
      listProcessedItems({
        geographicTag: divisionId,
        onlyFresh: true,
        limit,
      }),
    ),
  );
  return sortRecords(
    uniqueRecords(records.flat()),
  ).slice(0, limit);
}

async function listRegionalRawItems(divisionIds: string[], options: RegionalProcessingOptions) {
  const perDivisionLimit = options.scanLimitPerDivision ?? 90;
  const since = new Date(Date.now() - 14 * 24 * 36e5).toISOString();
  const records = await Promise.all(
    divisionIds.map((divisionId) =>
      listRawSourceItems({
        detectedRegion: divisionId,
        since,
        excludeProcessed: true,
        limit: perDivisionLimit,
      }),
    ),
  );

  return uniqueById(records.flat());
}

async function highPriorityNewItemExists(
  divisionIds: string[],
  freshnessTimestamp: string | undefined,
) {
  if (!freshnessTimestamp) return false;
  const since = new Date(freshnessTimestamp).getTime();
  if (!Number.isFinite(since)) return false;

  const records = await Promise.all(
    divisionIds.map((divisionId) =>
      listRawSourceItems({
        detectedRegion: divisionId,
        since: freshnessTimestamp,
        excludeProcessed: true,
        limit: 25,
      }),
    ),
  );
  const rawItems = uniqueById(records.flat());

  return rawItems.some((item) => {
    const itemTime = new Date(item.published_at ?? item.created_at).getTime();
    return (
      Number.isFinite(itemTime) &&
      itemTime >= since &&
      (item.source_priority >= 85 || item.credibility_score >= 95)
    );
  });
}

function candidateSignal(candidate: NewRankedProcessingCandidate) {
  return {
    rank_score: candidate.rank_score,
    selection_reason: candidate.selection_reason,
    freshness_score: candidate.freshness_score,
    diplomatic_relevance_score: candidate.diplomatic_relevance_score,
    sweden_relevance_score: candidate.sweden_relevance_score,
    geographic_relevance_score: candidate.geographic_relevance_score,
    cross_source_confirmation_score: candidate.cross_source_confirmation_score,
  };
}

function selectedRegionalCandidates(
  rawItems: RawSourceItem[],
  processedItems: ProcessedIntelligenceRecord[],
  options: RegionalProcessingOptions,
) {
  const limit = options.limit ?? 8;
  const ranked = rankRawSourceItems(
    rawItems,
    processedItems.map((record) => record.raw),
    {
      config: options.config ?? swedenMexicoEmbassyConfig,
      allowRegionalAi: true,
      targetMax: Math.max(limit, 4),
      hardCap: Math.max(limit * 3, 12),
    },
  );

  return ranked
    .filter((candidate) => !candidate.duplicate_of_raw_source_item_id)
    .filter(
      (candidate) =>
        candidate.selection_status === "selected" ||
        candidate.selection_status === "candidate" ||
        candidate.rank_score >= 55,
    )
    .sort((a, b) => b.rank_score - a.rank_score)
    .slice(0, limit)
    .map((candidate) => ({
      candidate,
      raw: rawItems.find((item) => item.id === candidate.raw_source_item_id),
    }))
    .filter((record): record is { candidate: NewRankedProcessingCandidate; raw: RawSourceItem } =>
      Boolean(record.raw),
    );
}

export async function processRegionalIntelligenceOnDemand(
  options: RegionalProcessingOptions,
): Promise<RegionalProcessingResult> {
  const config = options.config ?? swedenMexicoEmbassyConfig;
  const limit = Math.max(1, Math.min(24, options.limit ?? 8));
  const ttlHours = cacheHoursFor("regional", options.ttlHours ?? DEFAULT_TTL_HOURS);
  const { regionLabel, divisionIds } = resolveRegion(config, options.regionId);
  const loadingSteps = [
    `Läser in artiklar för ${regionLabel}...`,
    "Rankar regionala signaler...",
    "Komprimerar regionala signaler...",
    "Identifierar relevanta signaler...",
  ];

  const cachedItems = await listFreshRegionalItems(divisionIds, limit);
  const freshnessTimestamp = latestTimestamp(
    cachedItems.map((record) => record.processed.processed_at),
  );
  const cacheExpiresAt = latestTimestamp(
    cachedItems.map((record) => record.processed.cache_expires_at),
  );

  if (
    cachedItems.length > 0 &&
    !options.force &&
    !(await highPriorityNewItemExists(divisionIds, freshnessTimestamp))
  ) {
    return {
      status: "ready",
      regionId: options.regionId,
      regionLabel,
      divisionIds,
      fromCache: true,
      reprocessed: false,
      processedCount: cachedItems.length,
      freshnessTimestamp,
      cacheExpiresAt,
      items: cachedItems,
      loadingSteps,
    };
  }

  if (!isRegionalProcessingConfigured()) {
    return {
      status: cachedItems.length > 0 ? "ready" : "not_configured",
      regionId: options.regionId,
      regionLabel,
      divisionIds,
      fromCache: cachedItems.length > 0,
      reprocessed: false,
      processedCount: cachedItems.length,
      freshnessTimestamp,
      cacheExpiresAt,
      items: cachedItems,
      loadingSteps,
    };
  }

  const rawItems = await listRegionalRawItems(divisionIds, options);
  const selected = selectedRegionalCandidates(rawItems, cachedItems, { ...options, limit });

  if (selected.length === 0) {
    return {
      status: cachedItems.length > 0 ? "ready" : "empty",
      regionId: options.regionId,
      regionLabel,
      divisionIds,
      fromCache: cachedItems.length > 0,
      reprocessed: false,
      processedCount: cachedItems.length,
      freshnessTimestamp,
      cacheExpiresAt,
      items: cachedItems,
      loadingSteps,
    };
  }

  const processedAt = new Date();
  const model = regionalProcessingModel();

  for (const { raw, candidate } of selected) {
    const geographicTags = raw.detected_region
      ? [raw.detected_region]
      : divisionIds.length === 1
        ? [divisionIds[0]]
        : divisionIds;
    const analysis = await processRegionalSourceItemWithOpenAI({
      raw,
      regionLabel,
      requiredGeographicTags: geographicTags,
      ranking: candidateSignal(candidate),
    });

    if (!analysis) continue;
    const cacheScope =
      analysis.urgency_score >= 90 || analysis.security_impact_score >= 90
        ? "breaking"
        : "regional";
    const itemExpiresAt = cacheExpiresAtFor(cacheScope, ttlHours, processedAt);

    await upsertProcessedItem({
      raw_source_item_id: raw.id,
      title_sv: analysis.title_sv,
      summary_sv: analysis.summary_sv,
      category: analysis.category,
      urgency_score: analysis.urgency_score,
      diplomatic_relevance_score: analysis.diplomatic_relevance_score,
      sweden_relevance_score: analysis.sweden_relevance_score,
      economic_impact_score: analysis.economic_impact_score,
      security_impact_score: analysis.security_impact_score,
      geographic_scope:
        geographicTags.length === 1 ? "administrative_division" : analysis.geographic_scope,
      geographic_tags: [...new Set([...geographicTags, ...analysis.geographic_tags])],
      why_it_may_matter_sv: analysis.why_it_may_matter_sv,
      profile_tags: analysis.profile_tags,
      processed_model: model,
      processed_at: processedAt.toISOString(),
      cache_expires_at: itemExpiresAt,
    });
  }

  const items = await listFreshRegionalItems(divisionIds, limit);

  return {
    status: items.length > 0 ? "ready" : "empty",
    regionId: options.regionId,
    regionLabel,
    divisionIds,
    fromCache: false,
    reprocessed: true,
    processedCount: items.length,
    freshnessTimestamp: latestTimestamp(items.map((record) => record.processed.processed_at)),
    cacheExpiresAt: latestTimestamp(items.map((record) => record.processed.cache_expires_at)),
    items,
    loadingSteps,
  };
}
