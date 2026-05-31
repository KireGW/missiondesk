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
const STALE_MANUAL_REFRESH_MS = 15 * 60 * 1000;
const MANUAL_REFRESH_REVISIT_WINDOW_HOURS = 48;
const manualRefreshCancelledMessage = "Uppdateringen avbröts av användaren.";
const refreshSteps = [
  "Skannar verifierade källor…",
  "Deduplicerar och prioriterar nya poster…",
  "Bearbetar nya relevanta signaler…",
  "Uppdaterar briefing vid behov…",
];

let manualRefreshInFlight: Promise<unknown> | null = null;

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
  ingestion: Awaited<ReturnType<typeof ingestRawSourceItems>>;
  ranking?: Awaited<ReturnType<typeof rankAndStoreCandidates>>;
  processingJobs?: Array<{ payload: Record<string, unknown> }>;
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

  const processedStates = await Promise.all(
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

async function activeManualRefreshJob() {
  const jobs = await listBackgroundJobs({ type: manualRefreshJobType, limit: 10 });
  const now = Date.now();

  for (const job of jobs) {
    if (job.status !== "running") continue;
    const lockedAt = job.locked_at ? new Date(job.locked_at).getTime() : 0;
    const updatedAt = job.updated_at ? new Date(job.updated_at).getTime() : 0;
    const lastActivityAt = Math.max(lockedAt, updatedAt);
    if (lastActivityAt > 0 && now - lastActivityAt > STALE_MANUAL_REFRESH_MS) {
      await logManualRefresh(job.id, "manual source rescan marked stale", {
        staleAfterMs: STALE_MANUAL_REFRESH_MS,
      });
      await updateIngestionUpdateState({
        status: "failed",
        started_at: payloadString(job, "startedAt", job.created_at),
        completed_at: new Date().toISOString(),
        error_message: "Uppdateringen fastnade och markerades som avbruten. Försök igen.",
      });
      await failBackgroundJob(
        job.id,
        "Manual source refresh became stale before completing.",
      );
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

  if (job?.error_message === "Manual source refresh became stale before completing.") {
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

async function runManualFullRescan(options: {
  jobId: string;
  limit: number;
  cacheHours?: number;
  limitPerSource?: number;
}) {
  const sources = (await getSources()).filter((source) => source.enabled);
  const startedAt = new Date().toISOString();
  const previousState = await getIngestionUpdateState();
  const since = manualRefreshSince(previousState?.last_ingested_at);
  await updateIngestionUpdateState({
    status: "running",
    started_at: startedAt,
    completed_at: null,
    error_message: null,
  });
  await logManualRefresh(options.jobId, "manual source rescan started");
  await updateManualRefreshPhase(options.jobId, "ingesting_sources", 12, 0);

  const ingestion = await ingestRawSourceItems({
    limitPerSource: options.limitPerSource ?? 12,
    concurrency: 4,
    preserveRawContent: true,
    sourceTimeoutMs: 25_000,
    since,
    onSourceProgress: async (progress) => {
      await ensureManualRefreshNotCancelled(options.jobId);
      const { completedSources, totalSources, latestResult, totals } = progress;
      const sourceProgress = totalSources > 0 ? completedSources / totalSources : 0;
      const progressPercent =
        completedSources >= totalSources
          ? 34
          : Math.min(33, 12 + Math.floor(sourceProgress * 21));
      await updateManualRefreshPhase(options.jobId, "ingesting_sources", progressPercent, 0, {
        sourceCount: totalSources,
        completedSourceCount: completedSources,
        latestSourceName: latestResult.sourceName,
        latestSourceMethod: latestResult.retrievalMethod,
        fetchedCount: totals.fetchedCount,
        rawInsertedCount: totals.storedCount,
        skippedCount: totals.skippedCount,
        ingestionErrorCount: totals.errorCount,
      });
    },
  });

  await logManualRefresh(options.jobId, "source rescan finished", {
    sourceCount: ingestion.sourceCount,
    fetchedCount: ingestion.fetchedCount,
    storedCount: ingestion.storedCount,
    skippedCount: ingestion.skippedCount,
    errorCount: ingestion.errors.length,
    since,
    revisitWindowHours: MANUAL_REFRESH_REVISIT_WINDOW_HOURS,
  });
  await updateManualRefreshPhase(options.jobId, "ingesting_sources", 34, 0, {
    sourceCount: ingestion.sourceCount,
    completedSourceCount: ingestion.sourceCount,
    fetchedCount: ingestion.fetchedCount,
    rawInsertedCount: ingestion.storedCount,
    skippedCount: ingestion.skippedCount,
    ingestionErrorCount: ingestion.errors.length,
  });
  await ensureManualRefreshNotCancelled(options.jobId);

  const newRawSourceItemIds = ingestion.results.flatMap((result) =>
    result.items.map((item) => item.id),
  );

  if (newRawSourceItemIds.length === 0) {
    const completedAt = new Date().toISOString();
    const observability = await buildRefreshObservability({
      sources,
      ingestion,
    });
    await logManualRefresh(options.jobId, "no newly discovered source items; ranking and AI skipped", {
      observability: observability.totals,
    });
    await updateManualRefreshPhase(options.jobId, "completed", 100, 3, {
      processedCount: 0,
      completedAt,
      lastIngestedAt: completedAt,
      observability,
    });
    await updateIngestionUpdateState({
      status: "completed",
      started_at: startedAt,
      completed_at: completedAt,
      error_message: null,
      last_ingested_at: completedAt,
    });
    await logManualRefresh(options.jobId, "manual source rescan completed", {
      processedCount: 0,
      newRawSourceItemCount: 0,
    });
    return;
  }

  await updateManualRefreshPhase(options.jobId, "ranking_candidates", 46, 1);
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

  await logManualRefresh(options.jobId, "ranking finished", {
    scannedCount: ranking.scannedCount,
    selectedCount: ranking.selectedCount,
    candidateCount: ranking.candidateCount,
    regionalHoldCount: ranking.regionalHoldCount,
    observability: {
      rankedCount: ranking.candidates.length,
      selectedCount: ranking.selectedCount,
      candidateCount: ranking.candidateCount,
      rejectedCount: ranking.rejectedCount,
      deferredCount: ranking.deferredCount,
    },
  });
  await updateManualRefreshPhase(options.jobId, "ranking_candidates", 58, 1, {
    scannedCount: ranking.scannedCount,
    selectedCount: ranking.selectedCount,
    candidateCount: ranking.candidateCount,
    regionalHoldCount: ranking.regionalHoldCount,
  });
  await ensureManualRefreshNotCancelled(options.jobId);

  const processingJobs = await enqueueSelectedNationalProcessingJobs({
    limit: options.limit,
    force: false,
    reprocessStale: false,
    rawSourceItemIds: newRawSourceItemIds,
  });
  const processingObservability = await buildRefreshObservability({
    sources,
    ingestion,
    ranking,
    processingJobs,
  });
  await logManualRefresh(options.jobId, "national processing jobs queued", {
    count: processingJobs.length,
    observability: processingObservability.totals,
  });
  await updateManualRefreshPhase(options.jobId, "processing_items", 68, 2, {
    processingJobs: processingJobs.length,
    observability: processingObservability,
  });

  let processedCount = 0;
  const processedRawSourceItemIds: string[] = [];
  let processingFailedCount = 0;
  const processingOutcomeCounts = emptyProcessingOutcomeCounts();
  const processingErrors: string[] = [];
  for (let batch = 0; batch < 20; batch += 1) {
    await ensureManualRefreshNotCancelled(options.jobId);
    const result = await runNationalProcessingWorker({
      limit: 12,
      force: false,
      deferTemporalSync: true,
    });
    processedCount += result.processedCount;
    processedRawSourceItemIds.push(...result.processedRawSourceItemIds);
    processingFailedCount += result.failedCount;
    mergeProcessingOutcomeCounts(processingOutcomeCounts, result.outcomeCounts);
    processingErrors.push(...result.errors.map((error) => error.message));
    await logManualRefresh(options.jobId, "national processing batch finished", {
      batch: batch + 1,
      claimedCount: result.claimedCount,
      processedCount: result.processedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
      outcomeCounts: result.outcomeCounts,
    });
    await updateManualRefreshPhase(options.jobId, "processing_items", 78, 2, {
      processedCount,
      processingFailedCount,
      processingOutcomeCounts,
    });
    if (result.claimedCount === 0) break;
  }
  await ensureManualRefreshNotCancelled(options.jobId);
  const refreshedObservability = await buildRefreshObservability({
    sources,
    ingestion,
    ranking,
    processingJobs,
  });

  if (processedCount === 0 && processingFailedCount > 0) {
    throw new Error(
      processingErrors[0] ??
        "AI-bearbetningen misslyckades innan några nya signaler kunde skapas.",
    );
  }

  if (processedCount === 0) {
    const completedAt = new Date().toISOString();
    await logManualRefresh(options.jobId, "no new processed items; briefing regeneration skipped", {
      observability: refreshedObservability.totals,
    });
    await updateManualRefreshPhase(options.jobId, "completed", 100, 3, {
      processedCount,
      completedAt,
      lastIngestedAt: completedAt,
      observability: refreshedObservability,
      processingOutcomeCounts,
    });
    await updateIngestionUpdateState({
      status: "completed",
      started_at: startedAt,
      completed_at: completedAt,
      error_message: null,
      last_ingested_at: completedAt,
    });
    await logManualRefresh(options.jobId, "manual source rescan completed");
    return;
  }

  const temporalSyncJobs = await enqueueTemporalSyncJobs(processedRawSourceItemIds);
  if (temporalSyncJobs.length > 0) {
    startTemporalSyncWorkerInBackground();
  }

  await updateManualRefreshPhase(options.jobId, "generating_briefings", 84, 3, {
    processedCount,
    observability: refreshedObservability,
    processingOutcomeCounts,
  });
  const briefingJobs = await enqueueDefaultBriefingJobs({
    force: true,
    cacheHours: options.cacheHours,
  });
  startBriefingGenerationWorkerInBackground(5, options.cacheHours);
  await logManualRefresh(options.jobId, "briefing jobs queued", {
    count: briefingJobs.length,
    temporalSyncJobs: temporalSyncJobs.length,
  });

  const completedAt = new Date().toISOString();
  await updateManualRefreshPhase(options.jobId, "completed", 100, 3, {
    processedCount,
    briefingQueuedCount: briefingJobs.length,
    completedAt,
    lastIngestedAt: completedAt,
    observability: refreshedObservability,
    processingOutcomeCounts,
  });
  await updateIngestionUpdateState({
    status: "completed",
    started_at: startedAt,
    completed_at: completedAt,
    error_message: null,
    last_ingested_at: completedAt,
  });
  await logManualRefresh(options.jobId, "manual source rescan completed", {
    processedCount,
    briefingQueuedCount: briefingJobs.length,
    temporalSyncQueuedCount: temporalSyncJobs.length,
    processingOutcomeCounts,
  });
}

async function runManualRefreshWorker(limit = 1) {
  const jobs = await claimBackgroundJobs({ type: manualRefreshJobType, limit });

  for (const job of jobs) {
    try {
      await runManualFullRescan({
        jobId: job.id,
        limit: payloadNumber(job, "limit", 100),
        cacheHours: payloadOptionalNumber(job, "cacheHours"),
        limitPerSource: payloadNumber(job, "limitPerSource", 12),
      });
      const current = await getBackgroundJobById(job.id);
      if (current?.status === "cancelled") {
        continue;
      }
      await completeBackgroundJob(job.id);
    } catch (error) {
      const current = await getBackgroundJobById(job.id);
      if (current?.status === "cancelled") {
        continue;
      }
      const message = error instanceof Error ? error.message : "Okänt uppdateringsfel";
      await logManualRefresh(job.id, "manual source rescan failed", { error: message });
      const startedAt = payloadString(job, "startedAt", undefined);
      await updateIngestionUpdateState({
        status: "failed",
        started_at: startedAt ?? job.created_at,
        completed_at: new Date().toISOString(),
        error_message: message,
      });
      await failBackgroundJob(job.id, message);
    }
  }

  return jobs.length;
}

function startManualRefreshWorkerInBackground() {
  if (manualRefreshInFlight) return false;

  manualRefreshInFlight = runManualRefreshWorker(1)
    .catch((error) => {
      console.error("[MissionDesk refresh] worker crashed", error);
    })
    .finally(() => {
      manualRefreshInFlight = null;
    });

  return true;
}

export async function GET() {
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
      startManualRefreshWorkerInBackground();
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
      max_attempts: 1,
      payload: {
        phase: "queued",
        phaseLabel: refreshSteps[0],
        progressPercent: 5,
        activeStepIndex: 0,
        limit,
        cacheHours: body.cacheHours,
        limitPerSource: body.limitPerSource ?? 12,
        sourceCount: activeSourceCount,
        startedAt,
        logs: [],
      },
    });

    const started = startManualRefreshWorkerInBackground();

    return NextResponse.json({
      ...(await statusFromRefreshJob(job)),
      started,
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
