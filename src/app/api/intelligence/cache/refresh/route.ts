import { NextResponse } from "next/server";
import {
  enqueueDefaultBriefingJobs,
  startBriefingGenerationWorkerInBackground,
} from "@/lib/intelligence/briefing-worker";
import {
  enqueueSelectedNationalProcessingJobs,
  runNationalProcessingWorker,
} from "@/lib/intelligence/national-processing-worker";
import {
  enqueueTemporalSyncJobs,
  startTemporalSyncWorkerInBackground,
  temporalSyncJobType,
} from "@/lib/intelligence/temporal-sync-worker";
import { isNationalProcessingConfigured } from "@/lib/ai/national-processing";
import {
  claimBackgroundJobs,
  cancelBackgroundJobs,
  completeBackgroundJob,
  enqueueBackgroundJob,
  failBackgroundJob,
  getBackgroundJobById,
  getIngestionUpdateState,
  listBackgroundJobs,
  requeueBackgroundJob,
  updateIngestionUpdateState,
  updateBackgroundJobPayload,
} from "@/lib/intelligence/repository";
import { rankAndStoreCandidates } from "@/lib/intelligence/ranking";
import { ingestRawSourceItems } from "@/lib/ingestion/raw-source-ingestion";
import { getSources } from "@/lib/sources/store";
import { firstRunJobType } from "@/lib/intelligence/first-run";
import type { BackgroundJob } from "@/lib/intelligence/models";
import type { SourceDefinition } from "@/lib/types";
import { getProcessedItemByRawId } from "@/lib/intelligence/repository";

export const dynamic = "force-dynamic";

type RefreshScope = "national" | "briefings" | "all";

const manualRefreshJobType = "manual_source_refresh";
const processingJobType = "process_ranked_candidate";
const briefingJobType = "generate_briefing";
const STALE_MANUAL_REFRESH_MS_DEFAULT = 4 * 60 * 1000;
const STALE_MANUAL_REFRESH_MS_BY_PHASE: Record<string, number> = {
  queued: 90 * 1000,
  ingesting_sources: 4 * 60 * 1000,
  ranking_candidates: 3 * 60 * 1000,
  processing_items: 8 * 60 * 1000,
};
const MANUAL_REFRESH_REVISIT_WINDOW_HOURS = 48;
const manualRefreshCancelledMessage = "Uppdateringen avbröts av användaren.";
const refreshSteps = [
  "Skannar verifierade källor…",
  "Deduplicerar och prioriterar nya poster…",
  "Bearbetar nya relevanta signaler…",
  "Uppdaterar briefing vid behov…",
];

type RefreshFunnelCounts = {
  scannedSources: number;
  sourcesWithStoredItems: number;
  fetchedCount: number;
  rawInsertedCount: number;
  skippedCount: number;
  errorCount: number;
  rankedCount: number;
  selectedCount: number;
  candidateCount: number;
  rejectedCount: number;
  deferredCount: number;
  regionalHoldCount: number;
  processingJobsQueued: number;
  processedCount: number;
  processedMissingCount: number;
};

type RefreshSourceStageMetrics = RefreshFunnelCounts & {
  sourceId: string;
  sourceName: string;
  sourceCountry: string;
  sourceLanguage: string;
  sourceType: string;
  sourceCategory: string;
  family: string;
};

type ProcessingOutcomeCounts = {
  processed: number;
  cancelled: number;
  missing_payload: number;
  candidate_missing: number;
  candidate_invalid: number;
  fresh_cache_exists: number;
  stale_cache_reused: number;
  processing_failed: number;
};

type ManualRefreshBackgroundWork = {
  processedCount: number;
  processedRawSourceItemIds: string[];
  cacheHours?: number;
  observability: Awaited<ReturnType<typeof buildRefreshObservability>>;
  processingOutcomeCounts: ProcessingOutcomeCounts;
};

type ManualRefreshRunResult = {
  backgroundWork?: ManualRefreshBackgroundWork;
};

type PersistedIngestionItemRef = { id: string };

type PersistedIngestionSourceResult = {
  sourceId: string;
  sourceName: string;
  retrievalMethod: string;
  fetchedCount: number;
  storedCount: number;
  skippedCount: number;
  errorCount: number;
  items: PersistedIngestionItemRef[];
};

type PersistedIngestionSummary = {
  sourceCount: number;
  fetchedCount: number;
  storedCount: number;
  skippedCount: number;
  errorCount: number;
  results: PersistedIngestionSourceResult[];
};

type PersistedRankingCandidate = {
  raw_source_item_id: string;
  selection_status: string;
};

type PersistedRankingSummary = {
  scannedCount: number;
  selectedCount: number;
  candidateCount: number;
  rejectedCount: number;
  deferredCount: number;
  regionalHoldCount: number;
  candidates: PersistedRankingCandidate[];
};

function emptyFunnelCounts(): RefreshFunnelCounts {
  return {
    scannedSources: 0,
    sourcesWithStoredItems: 0,
    fetchedCount: 0,
    rawInsertedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    rankedCount: 0,
    selectedCount: 0,
    candidateCount: 0,
    rejectedCount: 0,
    deferredCount: 0,
    regionalHoldCount: 0,
    processingJobsQueued: 0,
    processedCount: 0,
    processedMissingCount: 0,
  };
}

function emptyProcessingOutcomeCounts(): ProcessingOutcomeCounts {
  return {
    processed: 0,
    cancelled: 0,
    missing_payload: 0,
    candidate_missing: 0,
    candidate_invalid: 0,
    fresh_cache_exists: 0,
    stale_cache_reused: 0,
    processing_failed: 0,
  };
}

function mergeProcessingOutcomeCounts(
  target: ProcessingOutcomeCounts,
  incoming: Partial<ProcessingOutcomeCounts>,
) {
  for (const key of Object.keys(target) as Array<keyof ProcessingOutcomeCounts>) {
    const value = incoming[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      target[key] += value;
    }
  }
}

function sourceFamily(source: Pick<SourceDefinition, "country" | "sourceCategory" | "sourceType" | "type">) {
  const country = (source.country ?? "").toLowerCase();
  const sourceCategory = source.sourceCategory ?? "";
  const sourceType = source.sourceType ?? "";
  const social = sourceType === "social";
  const official =
    sourceCategory === "government" ||
    sourceType === "government" ||
    sourceType === "institution" ||
    sourceType === "advisory";
  const media = sourceCategory === "media" || sourceType === "news" || source.type === "rss";

  if (social && country.includes("sverige")) return "swedish_social";
  if (social && country.includes("mexiko")) return "mexican_social";
  if (social) return "international_social";
  if (country.includes("sverige") && official) return "swedish_official";
  if (country.includes("sverige") && media) return "swedish_media";
  if (country.includes("mexiko") && official) return "mexican_official";
  if (country.includes("mexiko") && media) return "mexican_media";
  if (official) return "international_official";
  if (media) return "international_media";
  return "other";
}

function sourceMetricsSeed(source: SourceDefinition): RefreshSourceStageMetrics {
  return {
    sourceId: source.id,
    sourceName: source.name,
    sourceCountry: source.country,
    sourceLanguage: source.language,
    sourceType: source.sourceType ?? source.type,
    sourceCategory: source.sourceCategory ?? "unspecified",
    family: sourceFamily(source),
    ...emptyFunnelCounts(),
  };
}

function incrementMetric(
  target: RefreshFunnelCounts,
  field: keyof RefreshFunnelCounts,
  value = 1,
) {
  target[field] += value;
}

function selectionStatusField(status: string): keyof RefreshFunnelCounts {
  switch (status) {
    case "selected":
      return "selectedCount";
    case "candidate":
      return "candidateCount";
    case "rejected":
      return "rejectedCount";
    case "deferred":
      return "deferredCount";
    case "regional_hold":
      return "regionalHoldCount";
    default:
      return "candidateCount";
  }
}

function compactStageMetrics(metrics: RefreshSourceStageMetrics[], sortField: keyof RefreshFunnelCounts) {
  return metrics
    .filter((metric) =>
      Object.entries(metric).some(([key, value]) =>
        key in emptyFunnelCounts() && typeof value === "number" && value > 0,
      ),
    )
    .sort((a, b) => (b[sortField] as number) - (a[sortField] as number) || a.sourceName.localeCompare(b.sourceName));
}

function manualRefreshSince(lastIngestedAt?: string | null) {
  if (!lastIngestedAt) return undefined;

  const revisitWindowMs = MANUAL_REFRESH_REVISIT_WINDOW_HOURS * 60 * 60 * 1000;
  return new Date(new Date(lastIngestedAt).getTime() - revisitWindowMs).toISOString();
}

async function buildRefreshObservability(input: {
  sources: SourceDefinition[];
  ingestion: {
    sourceCount: number;
    fetchedCount: number;
    storedCount: number;
    skippedCount: number;
    errors: Array<unknown>;
    results: Array<{
      sourceId: string;
      sourceName: string;
      retrievalMethod: string;
      fetchedCount: number;
      storedCount: number;
      skippedCount: number;
      errors: Array<unknown>;
      items: Array<{ id: string }>;
    }>;
  };
  ranking?: {
    scannedCount: number;
    selectedCount: number;
    candidateCount: number;
    rejectedCount: number;
    deferredCount: number;
    regionalHoldCount: number;
    candidates: Array<{
      raw_source_item_id: string;
      selection_status: string;
    }>;
  };
  processingJobs?: Array<{ payload: { rawSourceItemId?: string } }>;
  processedRawIds?: string[];
}) {
  const sourceMap = new Map(input.sources.map((source) => [source.id, source]));
  const stageBySource = new Map<string, RefreshSourceStageMetrics>();
  const familyCounts = new Map<string, RefreshFunnelCounts>();

  const ensureSourceMetrics = (sourceId: string, fallback?: {
    sourceName: string;
    sourceCountry: string;
    sourceLanguage: string;
    sourceType: string;
    sourceCategory: string;
    family: string;
  }) => {
    let current = stageBySource.get(sourceId);
    if (!current) {
      const source = sourceMap.get(sourceId);
      current = source
        ? sourceMetricsSeed(source)
        : {
            sourceId,
            sourceName: fallback?.sourceName ?? sourceId,
            sourceCountry: fallback?.sourceCountry ?? "",
            sourceLanguage: fallback?.sourceLanguage ?? "",
            sourceType: fallback?.sourceType ?? "unknown",
            sourceCategory: fallback?.sourceCategory ?? "unknown",
            family: fallback?.family ?? "other",
            ...emptyFunnelCounts(),
          };
      stageBySource.set(sourceId, current);
    }
    return current;
  };

  const ensureFamilyCounts = (family: string) => {
    let current = familyCounts.get(family);
    if (!current) {
      current = emptyFunnelCounts();
      familyCounts.set(family, current);
    }
    return current;
  };

  for (const result of input.ingestion.results) {
    const source = sourceMap.get(result.sourceId);
    const family = source ? sourceFamily(source) : "other";
    const sourceMetrics = ensureSourceMetrics(result.sourceId, {
      sourceName: result.sourceName,
      sourceCountry: source?.country ?? "",
      sourceLanguage: source?.language ?? "",
      sourceType: source?.sourceType ?? source?.type ?? result.retrievalMethod,
      sourceCategory: source?.sourceCategory ?? "unspecified",
      family,
    });
    const familyMetric = ensureFamilyCounts(sourceMetrics.family);

    incrementMetric(sourceMetrics, "scannedSources");
    incrementMetric(sourceMetrics, "fetchedCount", result.fetchedCount);
    incrementMetric(sourceMetrics, "rawInsertedCount", result.storedCount);
    incrementMetric(sourceMetrics, "skippedCount", result.skippedCount);
    incrementMetric(sourceMetrics, "errorCount", result.errors.length);
    if (result.storedCount > 0) incrementMetric(sourceMetrics, "sourcesWithStoredItems");

    incrementMetric(familyMetric, "scannedSources");
    incrementMetric(familyMetric, "fetchedCount", result.fetchedCount);
    incrementMetric(familyMetric, "rawInsertedCount", result.storedCount);
    incrementMetric(familyMetric, "skippedCount", result.skippedCount);
    incrementMetric(familyMetric, "errorCount", result.errors.length);
    if (result.storedCount > 0) incrementMetric(familyMetric, "sourcesWithStoredItems");
  }

  const rankingCandidates = input.ranking?.candidates ?? [];
  const processingJobs = input.processingJobs ?? [];
  const rankedByRawId = new Map(rankingCandidates.map((candidate) => [candidate.raw_source_item_id, candidate]));
  for (const result of input.ingestion.results) {
    const sourceMetrics = ensureSourceMetrics(result.sourceId);
    const familyMetric = ensureFamilyCounts(sourceMetrics.family);
    for (const item of result.items) {
      const ranked = rankedByRawId.get(item.id);
      if (!ranked) continue;
      incrementMetric(sourceMetrics, "rankedCount");
      incrementMetric(familyMetric, "rankedCount");
      incrementMetric(sourceMetrics, selectionStatusField(ranked.selection_status));
      incrementMetric(familyMetric, selectionStatusField(ranked.selection_status));
    }
  }

  const selectedRawIds = rankingCandidates
    .filter((candidate) => candidate.selection_status === "selected")
    .map((candidate) => candidate.raw_source_item_id);
  const queuedRawIds = new Set(
    processingJobs
      .map((job) => job.payload.rawSourceItemId)
      .filter((value): value is string => typeof value === "string"),
  );

  for (const result of input.ingestion.results) {
    const sourceMetrics = ensureSourceMetrics(result.sourceId);
    const familyMetric = ensureFamilyCounts(sourceMetrics.family);
    for (const item of result.items) {
      if (queuedRawIds.has(item.id)) {
        incrementMetric(sourceMetrics, "processingJobsQueued");
        incrementMetric(familyMetric, "processingJobsQueued");
      }
    }
  }

  const processedStates = input.processedRawIds
    ? selectedRawIds.map((rawId) => ({
        rawId,
        processed: input.processedRawIds?.includes(rawId) ?? false,
      }))
    : await Promise.all(
        selectedRawIds.map(async (rawId) => ({
          rawId,
          processed: Boolean(await getProcessedItemByRawId(rawId)),
        })),
      );
  const processedByRawId = new Map(processedStates.map((item) => [item.rawId, item.processed]));

  for (const result of input.ingestion.results) {
    const sourceMetrics = ensureSourceMetrics(result.sourceId);
    const familyMetric = ensureFamilyCounts(sourceMetrics.family);
    for (const item of result.items) {
      if (!processedByRawId.has(item.id)) continue;
      if (processedByRawId.get(item.id)) {
        incrementMetric(sourceMetrics, "processedCount");
        incrementMetric(familyMetric, "processedCount");
      } else {
        incrementMetric(sourceMetrics, "processedMissingCount");
        incrementMetric(familyMetric, "processedMissingCount");
      }
    }
  }

  const sourceMetrics = compactStageMetrics([...stageBySource.values()], "rawInsertedCount");
  const familyMetrics = [...familyCounts.entries()]
    .map(([family, counts]) => ({ family, ...counts }))
    .sort((a, b) => b.rawInsertedCount - a.rawInsertedCount || a.family.localeCompare(b.family));

  return {
    totals: {
      sourcesAttempted: input.ingestion.sourceCount,
      rawInsertedCount: input.ingestion.storedCount,
      rankedCount: rankingCandidates.length,
      selectedCount: input.ranking?.selectedCount ?? 0,
      processingJobsQueued: processingJobs.length,
      processedCount: processedStates.filter((item) => item.processed).length,
      processedMissingCount: processedStates.filter((item) => !item.processed).length,
    },
    bySource: sourceMetrics,
    byFamily: familyMetrics,
  };
}

function persistIngestionSummary(
  ingestion: Awaited<ReturnType<typeof ingestRawSourceItems>>,
): PersistedIngestionSummary {
  return {
    sourceCount: ingestion.sourceCount,
    fetchedCount: ingestion.fetchedCount,
    storedCount: ingestion.storedCount,
    skippedCount: ingestion.skippedCount,
    errorCount: ingestion.errors.length,
    results: ingestion.results.map((result) => ({
      sourceId: result.sourceId,
      sourceName: result.sourceName,
      retrievalMethod: result.retrievalMethod,
      fetchedCount: result.fetchedCount,
      storedCount: result.storedCount,
      skippedCount: result.skippedCount,
      errorCount: result.errors.length,
      items: result.items.map((item) => ({ id: item.id })),
    })),
  };
}

function hydrateIngestionSummary(summary: PersistedIngestionSummary) {
  return {
    sourceCount: summary.sourceCount,
    fetchedCount: summary.fetchedCount,
    storedCount: summary.storedCount,
    skippedCount: summary.skippedCount,
    errors: Array.from({ length: summary.errorCount }, () => null),
    results: summary.results.map((result) => ({
      sourceId: result.sourceId,
      sourceName: result.sourceName,
      retrievalMethod: result.retrievalMethod,
      fetchedCount: result.fetchedCount,
      storedCount: result.storedCount,
      skippedCount: result.skippedCount,
      errors: Array.from({ length: result.errorCount }, () => null),
      items: result.items.map((item) => ({ id: item.id })),
    })),
  };
}

function emptyIngestionSummary(): PersistedIngestionSummary {
  return {
    sourceCount: 0,
    fetchedCount: 0,
    storedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    results: [],
  };
}

function mergeIngestionSummary(
  current: PersistedIngestionSummary,
  incoming: PersistedIngestionSummary,
): PersistedIngestionSummary {
  return {
    sourceCount: current.sourceCount + incoming.sourceCount,
    fetchedCount: current.fetchedCount + incoming.fetchedCount,
    storedCount: current.storedCount + incoming.storedCount,
    skippedCount: current.skippedCount + incoming.skippedCount,
    errorCount: current.errorCount + incoming.errorCount,
    results: [...current.results, ...incoming.results],
  };
}

function persistRankingSummary(
  ranking: Awaited<ReturnType<typeof rankAndStoreCandidates>>,
): PersistedRankingSummary {
  return {
    scannedCount: ranking.scannedCount,
    selectedCount: ranking.selectedCount,
    candidateCount: ranking.candidateCount,
    rejectedCount: ranking.rejectedCount,
    deferredCount: ranking.deferredCount,
    regionalHoldCount: ranking.regionalHoldCount,
    candidates: ranking.candidates.map((candidate) => ({
      raw_source_item_id: candidate.raw_source_item_id,
      selection_status: candidate.selection_status,
    })),
  };
}

function uniqueStringValues(values: string[]) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

async function activeManualRefreshJob() {
  const jobs = await listBackgroundJobs({ type: manualRefreshJobType, limit: 10 });
  const now = Date.now();

  for (const job of jobs) {
    if (job.status !== "running") continue;
    const phase = payloadString(job, "phase", "queued");
    const staleAfterMs =
      STALE_MANUAL_REFRESH_MS_BY_PHASE[phase] ?? STALE_MANUAL_REFRESH_MS_DEFAULT;
    const lockedAt = job.locked_at ? new Date(job.locked_at).getTime() : 0;
    const updatedAt = job.updated_at ? new Date(job.updated_at).getTime() : 0;
    const lastActivityAt = Math.max(lockedAt, updatedAt);
    if (lastActivityAt > 0 && now - lastActivityAt > staleAfterMs) {
      await logManualRefresh(job.id, "manual source rescan marked stale and requeued", {
        staleAfterMs,
        phase,
      });
      await requeueBackgroundJob(job.id, {
        errorMessage: "Manual source refresh step became stale and was requeued.",
      });
    }
  }

  return (await listBackgroundJobs({ type: manualRefreshJobType, limit: 10 })).find((job) =>
    ["pending", "running"].includes(job.status),
  );
}

async function latestManualRefreshJob() {
  await activeManualRefreshJob();
  return (await listBackgroundJobs({ type: manualRefreshJobType, limit: 1 }))[0];
}

function payloadNumber(job: BackgroundJob | null | undefined, key: string, fallback = 0) {
  const value = job?.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function payloadOptionalNumber(job: BackgroundJob | null | undefined, key: string) {
  const value = job?.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function payloadString(job: BackgroundJob | null | undefined, key: string, fallback = "") {
  const value = job?.payload[key];
  return typeof value === "string" ? value : fallback;
}

function payloadStringArray(job: BackgroundJob | null | undefined, key: string) {
  const value = job?.payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function payloadIngestionSummary(job: BackgroundJob | null | undefined) {
  const value = job?.payload.ingestionSummary;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyIngestionSummary();
  }

  const summary = value as PersistedIngestionSummary;
  return {
    sourceCount: typeof summary.sourceCount === "number" ? summary.sourceCount : 0,
    fetchedCount: typeof summary.fetchedCount === "number" ? summary.fetchedCount : 0,
    storedCount: typeof summary.storedCount === "number" ? summary.storedCount : 0,
    skippedCount: typeof summary.skippedCount === "number" ? summary.skippedCount : 0,
    errorCount: typeof summary.errorCount === "number" ? summary.errorCount : 0,
    results: Array.isArray(summary.results) ? summary.results : [],
  };
}

function payloadRankingSummary(job: BackgroundJob | null | undefined) {
  const value = job?.payload.rankingSummary;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const summary = value as PersistedRankingSummary;
  return {
    scannedCount: typeof summary.scannedCount === "number" ? summary.scannedCount : 0,
    selectedCount: typeof summary.selectedCount === "number" ? summary.selectedCount : 0,
    candidateCount: typeof summary.candidateCount === "number" ? summary.candidateCount : 0,
    rejectedCount: typeof summary.rejectedCount === "number" ? summary.rejectedCount : 0,
    deferredCount: typeof summary.deferredCount === "number" ? summary.deferredCount : 0,
    regionalHoldCount: typeof summary.regionalHoldCount === "number" ? summary.regionalHoldCount : 0,
    candidates: Array.isArray(summary.candidates) ? summary.candidates : [],
  };
}

function payloadLogs(job: BackgroundJob | null | undefined) {
  const value = job?.payload.logs;
  return Array.isArray(value) ? value.slice(-20) : [];
}

function manualRefreshFailureMessage(job: BackgroundJob | undefined, stateErrorMessage?: string | null) {
  if (stateErrorMessage?.trim()) {
    return stateErrorMessage.trim();
  }

  if (job?.status === "cancelled") {
    return manualRefreshCancelledMessage;
  }

  if (
    job?.error_message === "Manual source refresh became stale before completing." ||
    job?.error_message === "Manual source refresh step became stale and was requeued."
  ) {
    const phase = payloadString(job, "phase", "");
    if (phase === "ingesting_sources") {
      return "Uppdateringen fastnade under källskanningen och markerades som avbruten. Försök igen.";
    }
    return "Uppdateringen fastnade innan den blev klar och markerades som avbruten. Försök igen.";
  }

  return job?.error_message ?? "Uppdateringen misslyckades.";
}

async function statusFromRefreshJob(job: BackgroundJob | undefined) {
  const state = await getIngestionUpdateState();
  const active = Boolean(job && ["pending", "running"].includes(job.status));
  const phase = payloadString(job, "phase", active ? "queued" : "");
  const processedCount = payloadNumber(job, "processedCount", 0);
  const processingJobs = payloadNumber(job, "processingJobs", 0);
  const progressPercent =
    job?.status === "completed"
      ? 100
      : job?.status === "cancelled"
        ? 0
        : payloadNumber(job, "progressPercent", active ? 8 : 0);
  const message =
    job?.status === "failed"
      ? manualRefreshFailureMessage(job, state?.error_message)
      : job?.status === "cancelled"
        ? manualRefreshCancelledMessage
      : job?.status === "completed"
        ? payloadNumber(job, "processedCount") > 0
          ? `Uppdatering klar. ${payloadNumber(job, "processedCount")} nya signaler bearbetades.`
          : "Uppdatering klar. Inga nya relevanta signaler hittades."
        : phase === "processing_items" && processingJobs > 0
          ? `${payloadString(job, "phaseLabel", refreshSteps[2])} (${processedCount}/${processingJobs})`
        : payloadString(job, "phaseLabel", active ? refreshSteps[0] : "Ingen uppdatering körs.");

  return {
    active,
    job,
    message,
    progressPercent,
    activeStepIndex: payloadNumber(job, "activeStepIndex", 0),
    steps: refreshSteps,
    logs: payloadLogs(job),
    lastIngestedAt: state?.last_ingested_at,
    updateStartedAt: state?.started_at,
    updateCompletedAt: state?.completed_at,
    updateErrorMessage: state?.error_message,
    updateStatus: state?.status ?? "idle",
  };
}

async function updateManualRefreshPhase(
  jobId: string,
  phase: string,
  progressPercent: number,
  activeStepIndex: number,
  extra: Record<string, unknown> = {},
) {
  const sourceCount =
    typeof extra.sourceCount === "number" && Number.isFinite(extra.sourceCount)
      ? extra.sourceCount
      : undefined;
  const completedSourceCount =
    typeof extra.completedSourceCount === "number" && Number.isFinite(extra.completedSourceCount)
      ? extra.completedSourceCount
      : undefined;
  const baseLabel = refreshSteps[activeStepIndex] ?? phase;
  const phaseLabel =
    phase === "ingesting_sources" && sourceCount && completedSourceCount !== undefined
      ? `${baseLabel} (${completedSourceCount}/${sourceCount})`
      : baseLabel;

  return updateBackgroundJobPayload(jobId, {
    phase,
    phaseLabel,
    progressPercent,
    activeStepIndex,
    ...extra,
  });
}

async function logManualRefresh(jobId: string, message: string, data?: Record<string, unknown>) {
  const current = await getBackgroundJobById(jobId);
  const logs = payloadLogs(current);
  await updateBackgroundJobPayload(jobId, {
    logs: [
      ...logs,
      {
        at: new Date().toISOString(),
        message,
        data,
      },
    ].slice(-20),
  });
  console.info("[MissionDesk refresh]", message, data ?? {});
}

async function ensureManualRefreshNotCancelled(jobId: string) {
  const current = await getBackgroundJobById(jobId);
  if (current?.status === "cancelled") {
    throw new Error(manualRefreshCancelledMessage);
  }
}

function ingestionChunkProgressPercent(completedSources: number, totalSources: number) {
  const sourceProgress = totalSources > 0 ? completedSources / totalSources : 0;
  return completedSources >= totalSources
    ? 34
    : Math.min(33, 12 + Math.floor(sourceProgress * 21));
}

function processingProgressPercent(
  queuedCount: number,
  completedCount: number,
) {
  const ratio = queuedCount > 0 ? Math.min(1, completedCount / queuedCount) : 1;
  return 68 + Math.floor(ratio * 26);
}

function shouldContinueBackgroundWork(job: BackgroundJob | undefined) {
  return Boolean(job && ["pending", "running"].includes(job.status));
}

async function finishManualRefreshJob(
  jobId: string,
  input: {
    startedAt: string;
    processedCount: number;
    processedRawSourceItemIds: string[];
    cacheHours?: number;
    observability: Awaited<ReturnType<typeof buildRefreshObservability>>;
    processingOutcomeCounts: ProcessingOutcomeCounts;
  },
) {
  const completedAt = new Date().toISOString();
  await updateManualRefreshPhase(jobId, "completed", 100, 3, {
    processedCount: input.processedCount,
    completedAt,
    lastIngestedAt: completedAt,
    observability: input.observability,
    processingOutcomeCounts: input.processingOutcomeCounts,
  });
  await updateIngestionUpdateState({
    status: "completed",
    started_at: input.startedAt,
    completed_at: completedAt,
    error_message: null,
    last_ingested_at: completedAt,
  });
  await completeBackgroundJob(jobId);

  if (input.processedRawSourceItemIds.length === 0) {
    await logManualRefresh(jobId, "manual source rescan completed", {
      processedCount: 0,
      observability: input.observability.totals,
    });
    return;
  }

  try {
    const temporalSyncJobs = await enqueueTemporalSyncJobs(input.processedRawSourceItemIds);
    if (temporalSyncJobs.length > 0) {
      startTemporalSyncWorkerInBackground();
    }

    const briefingJobs = await enqueueDefaultBriefingJobs({
      force: true,
      cacheHours: input.cacheHours,
    });
    startBriefingGenerationWorkerInBackground(5, input.cacheHours);

    await updateBackgroundJobPayload(jobId, {
      briefingQueuedCount: briefingJobs.length,
      temporalSyncQueuedCount: temporalSyncJobs.length,
      backgroundStatusDetached: true,
    });
    await logManualRefresh(jobId, "background updates queued", {
      processedCount: input.processedCount,
      briefingQueuedCount: briefingJobs.length,
      temporalSyncQueuedCount: temporalSyncJobs.length,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Okänt fel när bakgrundsuppdateringar köades.";
    await updateBackgroundJobPayload(jobId, {
      backgroundQueueError: message,
      backgroundStatusDetached: true,
    });
    await logManualRefresh(jobId, "background updates queue failed", {
      error: message,
    });
  }
}

async function advanceManualRefreshIngestion(job: BackgroundJob) {
  const allSources = (await getSources()).filter((source) => source.enabled);
  const sourceIds =
    payloadStringArray(job, "sourceIds").length > 0
      ? payloadStringArray(job, "sourceIds")
      : allSources.map((source) => source.id);
  const sourceChunkSize = payloadNumber(job, "sourceChunkSize", 8);
  const sourceCursor = payloadNumber(job, "sourceCursor", 0);
  const startedAt = payloadString(job, "startedAt", job.created_at);
  const previousState = await getIngestionUpdateState();
  const since =
    payloadString(job, "since", "") || manualRefreshSince(previousState?.last_ingested_at);

  if (sourceCursor === 0) {
    await updateIngestionUpdateState({
      status: "running",
      started_at: startedAt,
      completed_at: null,
      error_message: null,
    });
    await logManualRefresh(job.id, "manual source rescan started");
  }

  const chunkSourceIds = sourceIds.slice(sourceCursor, sourceCursor + sourceChunkSize);
  const totalSources = sourceIds.length;
  await updateManualRefreshPhase(
    job.id,
    "ingesting_sources",
    ingestionChunkProgressPercent(sourceCursor, totalSources),
    0,
    {
      sourceCount: totalSources,
      completedSourceCount: sourceCursor,
      sourceIds,
      sourceCursor,
      sourceChunkSize,
      since,
    },
  );

  const chunkIngestion = await ingestRawSourceItems({
    sourceIds: chunkSourceIds,
    limitPerSource: payloadNumber(job, "limitPerSource", 12),
    concurrency: 4,
    preserveRawContent: true,
    sourceTimeoutMs: 25_000,
    since: since || undefined,
    onSourceProgress: async (progress) => {
      await ensureManualRefreshNotCancelled(job.id);
      const completedSourceCount = sourceCursor + progress.completedSources;
      await updateManualRefreshPhase(
        job.id,
        "ingesting_sources",
        ingestionChunkProgressPercent(completedSourceCount, totalSources),
        0,
        {
          sourceCount: totalSources,
          completedSourceCount,
          latestSourceName: progress.latestResult.sourceName,
          latestSourceMethod: progress.latestResult.retrievalMethod,
          fetchedCount: progress.totals.fetchedCount,
          rawInsertedCount: progress.totals.storedCount,
          skippedCount: progress.totals.skippedCount,
          ingestionErrorCount: progress.totals.errorCount,
        },
      );
    },
  });

  const mergedSummary = mergeIngestionSummary(
    payloadIngestionSummary(job),
    persistIngestionSummary(chunkIngestion),
  );
  const newRawSourceItemIds = uniqueStringValues([
    ...payloadStringArray(job, "newRawSourceItemIds"),
    ...chunkIngestion.results.flatMap((result) => result.items.map((item) => item.id)),
  ]);
  const nextSourceCursor = sourceCursor + chunkSourceIds.length;

  await logManualRefresh(job.id, "source ingestion chunk finished", {
    completedSourceCount: nextSourceCursor,
    totalSources,
    fetchedCount: mergedSummary.fetchedCount,
    storedCount: mergedSummary.storedCount,
    skippedCount: mergedSummary.skippedCount,
    errorCount: mergedSummary.errorCount,
    revisitWindowHours: MANUAL_REFRESH_REVISIT_WINDOW_HOURS,
  });

  if (nextSourceCursor < totalSources) {
    await updateBackgroundJobPayload(job.id, {
      ingestionSummary: mergedSummary,
      newRawSourceItemIds,
      sourceIds,
      sourceCursor: nextSourceCursor,
      since,
      sourceChunkSize,
      fetchedCount: mergedSummary.fetchedCount,
      rawInsertedCount: mergedSummary.storedCount,
      skippedCount: mergedSummary.skippedCount,
      ingestionErrorCount: mergedSummary.errorCount,
    });
    await requeueBackgroundJob(job.id);
    return;
  }

  const sources = allSources.filter((source) => sourceIds.includes(source.id));
  if (newRawSourceItemIds.length === 0) {
    const observability = await buildRefreshObservability({
      sources,
      ingestion: hydrateIngestionSummary(mergedSummary),
      processedRawIds: [],
    });
    await logManualRefresh(job.id, "no newly discovered source items; ranking and AI skipped", {
      observability: observability.totals,
    });
    await finishManualRefreshJob(job.id, {
      startedAt,
      processedCount: 0,
      processedRawSourceItemIds: [],
      cacheHours: payloadOptionalNumber(job, "cacheHours"),
      observability,
      processingOutcomeCounts: emptyProcessingOutcomeCounts(),
    });
    return;
  }

  await updateBackgroundJobPayload(job.id, {
    ingestionSummary: mergedSummary,
    newRawSourceItemIds,
    sourceIds,
    sourceCursor: nextSourceCursor,
    since,
    sourceChunkSize,
  });
  await updateManualRefreshPhase(job.id, "ranking_candidates", 46, 1);
  await requeueBackgroundJob(job.id);
}

async function advanceManualRefreshRanking(job: BackgroundJob) {
  const newRawSourceItemIds = payloadStringArray(job, "newRawSourceItemIds");
  const ranking = await rankAndStoreCandidates({
    rawSourceItemIds: newRawSourceItemIds,
    scanLimit: 500,
    targetMin: 25,
    targetMax: 60,
    hardCap: 100,
    minSelectedScore: 58,
    minCandidateScore: 50,
    allowRegionalAi: false,
    nationalOnly: true,
    enqueueAiJobs: false,
  });
  const rankingSummary = persistRankingSummary(ranking);

  await logManualRefresh(job.id, "ranking finished", {
    scannedCount: ranking.scannedCount,
    selectedCount: ranking.selectedCount,
    candidateCount: ranking.candidateCount,
    regionalHoldCount: ranking.regionalHoldCount,
  });
  await updateManualRefreshPhase(job.id, "ranking_candidates", 58, 1, {
    scannedCount: ranking.scannedCount,
    selectedCount: ranking.selectedCount,
    candidateCount: ranking.candidateCount,
    regionalHoldCount: ranking.regionalHoldCount,
  });
  await ensureManualRefreshNotCancelled(job.id);

  const processingJobs = await enqueueSelectedNationalProcessingJobs({
    limit: payloadNumber(job, "limit", 100),
    force: false,
    reprocessStale: false,
    rawSourceItemIds: newRawSourceItemIds,
  });
  const processingQueuedRawIds = uniqueStringValues(
    processingJobs
      .map((processingJob) => processingJob.payload.rawSourceItemId)
      .filter((value): value is string => typeof value === "string"),
  );
  const sources = (await getSources()).filter((source) =>
    payloadStringArray(job, "sourceIds").includes(source.id),
  );
  const observability = await buildRefreshObservability({
    sources,
    ingestion: hydrateIngestionSummary(payloadIngestionSummary(job)),
    ranking: rankingSummary,
    processingJobs: processingQueuedRawIds.map((rawSourceItemId) => ({
      payload: { rawSourceItemId },
    })),
    processedRawIds: [],
  });

  await logManualRefresh(job.id, "national processing jobs queued", {
    count: processingJobs.length,
    observability: observability.totals,
  });

  await updateBackgroundJobPayload(job.id, {
    rankingSummary,
    processingQueuedRawIds,
    processingJobs: processingJobs.length,
    observability,
  });

  if (processingJobs.length === 0) {
    await finishManualRefreshJob(job.id, {
      startedAt: payloadString(job, "startedAt", job.created_at),
      processedCount: 0,
      processedRawSourceItemIds: [],
      cacheHours: payloadOptionalNumber(job, "cacheHours"),
      observability,
      processingOutcomeCounts: emptyProcessingOutcomeCounts(),
    });
    return;
  }

  await updateManualRefreshPhase(job.id, "processing_items", 68, 2, {
    processingJobs: processingJobs.length,
    observability,
  });
  await requeueBackgroundJob(job.id);
}

async function advanceManualRefreshProcessing(job: BackgroundJob) {
  const result = await runNationalProcessingWorker({
    limit: 12,
    force: false,
    deferTemporalSync: true,
  });

  const processedRawSourceItemIds = uniqueStringValues([
    ...payloadStringArray(job, "processedRawSourceItemIds"),
    ...result.processedRawSourceItemIds,
  ]);
  const processingFailedCount =
    payloadNumber(job, "processingFailedCount", 0) + result.failedCount;
  const processingOutcomeCounts = emptyProcessingOutcomeCounts();
  mergeProcessingOutcomeCounts(
    processingOutcomeCounts,
    job.payload.processingOutcomeCounts as Partial<ProcessingOutcomeCounts> ?? {},
  );
  mergeProcessingOutcomeCounts(processingOutcomeCounts, result.outcomeCounts);
  const processingErrors = uniqueStringValues([
    ...payloadStringArray(job, "processingErrors"),
    ...result.errors.map((error) => error.message),
  ]).slice(0, 10);
  const processedCount = processedRawSourceItemIds.length;
  const processingJobs = payloadNumber(job, "processingJobs", 0);

  await logManualRefresh(job.id, "national processing batch finished", {
    claimedCount: result.claimedCount,
    processedCount: result.processedCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    outcomeCounts: result.outcomeCounts,
  });

  await updateBackgroundJobPayload(job.id, {
    processedCount,
    processedRawSourceItemIds,
    processingFailedCount,
    processingOutcomeCounts,
    processingErrors,
  });
  await updateManualRefreshPhase(
    job.id,
    "processing_items",
    processingProgressPercent(processingJobs, processedCount),
    2,
    {
      processedCount,
      processingFailedCount,
      processingOutcomeCounts,
    },
  );

  if (result.claimedCount > 0) {
    await requeueBackgroundJob(job.id);
    return;
  }

  if (processedCount === 0 && processingFailedCount > 0) {
    throw new Error(
      processingErrors[0] ??
        "AI-bearbetningen misslyckades innan några nya signaler kunde skapas.",
    );
  }

  const sources = (await getSources()).filter((source) =>
    payloadStringArray(job, "sourceIds").includes(source.id),
  );
  const observability = await buildRefreshObservability({
    sources,
    ingestion: hydrateIngestionSummary(payloadIngestionSummary(job)),
    ranking: payloadRankingSummary(job),
    processingJobs: payloadStringArray(job, "processingQueuedRawIds").map((rawSourceItemId) => ({
      payload: { rawSourceItemId },
    })),
    processedRawIds: processedRawSourceItemIds,
  });

  await finishManualRefreshJob(job.id, {
    startedAt: payloadString(job, "startedAt", job.created_at),
    processedCount,
    processedRawSourceItemIds,
    cacheHours: payloadOptionalNumber(job, "cacheHours"),
    observability,
    processingOutcomeCounts,
  });
}

async function advanceManualRefreshJob(job: BackgroundJob) {
  try {
    await ensureManualRefreshNotCancelled(job.id);
    const phase = payloadString(job, "phase", "queued");

    if (phase === "queued" || phase === "ingesting_sources") {
      await advanceManualRefreshIngestion(job);
      return;
    }

    if (phase === "ranking_candidates") {
      await advanceManualRefreshRanking(job);
      return;
    }

    if (phase === "processing_items") {
      await advanceManualRefreshProcessing(job);
      return;
    }

    throw new Error(`Okänd refresh-fas: ${phase}`);
  } catch (error) {
    const current = await getBackgroundJobById(job.id);
    if (current?.status === "cancelled") {
      return;
    }
    const message = error instanceof Error ? error.message : "Okänt uppdateringsfel";
    await logManualRefresh(job.id, "manual source rescan failed", { error: message });
    const startedAt = payloadString(job, "startedAt", job.created_at);
    await updateIngestionUpdateState({
      status: "failed",
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error_message: message,
    });
    await failBackgroundJob(job.id, message);
  }
}

async function advanceManualRefreshWorker(maxSteps = 1) {
  let steps = 0;

  while (steps < maxSteps) {
    const jobs = await claimBackgroundJobs({ type: manualRefreshJobType, limit: 1 });
    const job = jobs[0];
    if (!job) break;
    await advanceManualRefreshJob(job);
    steps += 1;
  }

  return steps;
}

export async function GET() {
  const activeJob = await activeManualRefreshJob();
  if (activeJob?.status === "pending") {
    try {
      await advanceManualRefreshWorker(1);
    } catch (error) {
      console.error("[MissionDesk refresh] synchronous status advance failed", error);
    }
  }
  return NextResponse.json(await statusFromRefreshJob(await latestManualRefreshJob()));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    scope?: RefreshScope;
    force?: boolean;
    limit?: number;
    cacheHours?: number;
    rescanSources?: boolean;
    limitPerSource?: number;
    reprocessStale?: boolean;
    cancelAll?: boolean;
  };

  if (body.cancelAll) {
    const completedAt = new Date().toISOString();
    await cancelBackgroundJobs({
      types: [
        manualRefreshJobType,
        processingJobType,
        briefingJobType,
        temporalSyncJobType,
        firstRunJobType,
      ],
      errorMessage: manualRefreshCancelledMessage,
    });
    await updateIngestionUpdateState({
      status: "failed",
      started_at: (await getIngestionUpdateState())?.started_at ?? completedAt,
      completed_at: completedAt,
      error_message: manualRefreshCancelledMessage,
    });
    const latestJob = await latestManualRefreshJob();
    return NextResponse.json({
      ...(await statusFromRefreshJob(latestJob)),
      cancelled: true,
    });
  }

  const scope = body.scope ?? "all";
  const force = body.force ?? false;
  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 100;
  const rescanSources = body.rescanSources ?? false;

  if (rescanSources) {
    const activeSourceCount = (await getSources()).filter((source) => source.enabled).length;
    if (activeSourceCount === 0) {
      await updateIngestionUpdateState({
        status: "failed",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_message: "Inga källor är konfigurerade ännu.",
      });
      return NextResponse.json(
        { error: "Inga källor är konfigurerade ännu." },
        { status: 400 },
      );
    }

    if (!isNationalProcessingConfigured()) {
      await updateIngestionUpdateState({
        status: "failed",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_message: "Kan inte bearbeta källor: OPENAI_API_KEY saknas.",
      });
      return NextResponse.json(
        { error: "Kan inte bearbeta källor: OPENAI_API_KEY saknas." },
        { status: 400 },
      );
    }

    const activeJob = await activeManualRefreshJob();
    if (activeJob) {
      return NextResponse.json({
        ...(await statusFromRefreshJob(activeJob)),
        started: false,
        alreadyRunning: true,
      });
    }

    const startedAt = new Date().toISOString();
    await updateIngestionUpdateState({
      status: "pending",
      started_at: startedAt,
      completed_at: null,
      error_message: null,
    });

    const job = await enqueueBackgroundJob({
      type: manualRefreshJobType,
      priority: 95,
      max_attempts: 3,
      payload: {
        phase: "queued",
        phaseLabel: refreshSteps[0],
        progressPercent: 5,
        activeStepIndex: 0,
        limit,
        cacheHours: body.cacheHours,
        limitPerSource: body.limitPerSource ?? 12,
        sourceCount: activeSourceCount,
        sourceIds: (await getSources())
          .filter((source) => source.enabled)
          .map((source) => source.id),
        sourceCursor: 0,
        sourceChunkSize: 8,
        newRawSourceItemIds: [],
        processedRawSourceItemIds: [],
        processingFailedCount: 0,
        processingOutcomeCounts: emptyProcessingOutcomeCounts(),
        processingErrors: [],
        startedAt,
        logs: [],
      },
    });

    return NextResponse.json({
      ...(await statusFromRefreshJob(job)),
      started: true,
      alreadyRunning: false,
    });
  }

  const nationalJobs =
    scope === "national" || scope === "all"
      ? await enqueueSelectedNationalProcessingJobs({
          limit,
          force,
          reprocessStale: body.reprocessStale ?? false,
        })
      : [];
  const briefingJobs =
    scope === "briefings" || scope === "all"
      ? await enqueueDefaultBriefingJobs({ force, cacheHours: body.cacheHours })
      : [];

  return NextResponse.json({
    scope,
    force,
    enqueuedCount: nationalJobs.length + briefingJobs.length,
    jobs: {
      national: nationalJobs,
      briefings: briefingJobs,
    },
    note:
      "Refresh enqueues background work only. The dashboard remains cache-first and does not run live AI during page load.",
  });
}
