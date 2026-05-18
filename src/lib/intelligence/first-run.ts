import { isNationalProcessingConfigured } from "@/lib/ai/national-processing";
import {
  enqueueBriefingGenerationJob,
  runBriefingGenerationWorker,
} from "@/lib/intelligence/briefing-worker";
import {
  enqueueSelectedNationalProcessingJobs,
  runNationalProcessingWorker,
} from "@/lib/intelligence/national-processing-worker";
import { rankAndStoreCandidates } from "@/lib/intelligence/ranking";
import {
  claimBackgroundJobs,
  completeBackgroundJob,
  enqueueBackgroundJob,
  failBackgroundJob,
  getBackgroundJobById,
  listBackgroundJobs,
  listBriefings,
  listProcessedItems,
  updateBackgroundJobPayload,
} from "@/lib/intelligence/repository";
import { ingestRawSourceItems } from "@/lib/ingestion/raw-source-ingestion";
import { getSourcesSync } from "@/lib/sources/store";
import type { BackgroundJob } from "@/lib/intelligence/models";

export const firstRunJobType = "first_run_ingestion";

export const firstRunSteps = [
  "Hämtar verifierade källor…",
  "Deduplicerar och prioriterar…",
  "Bearbetar relevanta items…",
  "Genererar briefing…",
];

export interface FirstRunStatus {
  cacheExists: boolean;
  job?: BackgroundJob;
  active: boolean;
  missingSources: boolean;
  missingApiKey: boolean;
  message: string;
  steps: string[];
  progressPercent: number;
  activeStepIndex: number;
  estimatedDurationLabel: string;
  longRunning: boolean;
  logs: FirstRunLogEntry[];
}

interface FirstRunLogEntry {
  at: string;
  message: string;
  data?: Record<string, unknown>;
}

const firstRunEstimatedDurationLabel = "Första körningen tar oftast 3-10 minuter.";

let firstRunWorkerInFlight: Promise<unknown> | null = null;

function freshCacheExists() {
  return (
    listBriefings({ onlyFresh: true, limit: 1 }).length > 0 ||
    listProcessedItems({ onlyFresh: true, limit: 1 }).length > 0
  );
}

function enabledSources() {
  return getSourcesSync().filter((source) => source.enabled);
}

function activeFirstRunJob() {
  return listBackgroundJobs({ type: firstRunJobType, limit: 5 }).find((job) =>
    ["pending", "running"].includes(job.status),
  );
}

function latestFirstRunJob() {
  return listBackgroundJobs({ type: firstRunJobType, limit: 1 })[0];
}

function payloadString(job: BackgroundJob | null | undefined, key: string) {
  const value = job?.payload[key];
  return typeof value === "string" ? value : undefined;
}

function payloadNumber(job: BackgroundJob | null | undefined, key: string) {
  const value = job?.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function payloadLogs(job: BackgroundJob | null | undefined): FirstRunLogEntry[] {
  const value = job?.payload.logs;
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is FirstRunLogEntry => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Record<string, unknown>;
      return typeof candidate.at === "string" && typeof candidate.message === "string";
    })
    .slice(-12);
}

function activeStepIndexFor(job: BackgroundJob | undefined) {
  const phase = payloadString(job, "phase");
  if (job?.status === "completed") return firstRunSteps.length - 1;
  if (job?.status === "failed") return Math.max(0, payloadNumber(job, "activeStepIndex") ?? 0);

  if (phase === "ranking_candidates") return 1;
  if (phase === "processing_items" || phase === "queued_processing") return 2;
  if (phase === "generating_briefings" || phase === "queued_briefings") return 3;
  return 0;
}

function progressPercentFor(job: BackgroundJob | undefined) {
  const explicit = payloadNumber(job, "progressPercent");
  if (explicit !== undefined) return Math.max(0, Math.min(100, Math.round(explicit)));
  if (!job) return 0;
  if (job.status === "completed") return 100;
  if (job.status === "failed") return 100;
  if (job.status === "pending") return 12;
  return [28, 48, 72, 88][activeStepIndexFor(job)] ?? 20;
}

function isLongRunning(job: BackgroundJob | undefined) {
  if (!job || !["pending", "running"].includes(job.status)) return false;
  const updatedAt = new Date(job.updated_at).getTime();
  if (!Number.isFinite(updatedAt)) return false;
  return Date.now() - updatedAt > 10 * 60 * 1000;
}

function failStaleRunningFirstRunJobs() {
  const staleThresholdMs = 30 * 60 * 1000;
  const now = Date.now();
  const stale = listBackgroundJobs({ type: firstRunJobType, status: "running", limit: 5 }).filter(
    (job) => {
      const updatedAt = new Date(job.updated_at).getTime();
      return Number.isFinite(updatedAt) && now - updatedAt > staleThresholdMs;
    },
  );

  for (const job of stale) {
    logFirstRun(job.id, "job failed", {
      reason: "status endpoint marked stale running job as failed",
    });
    failBackgroundJob(
      job.id,
      "Första insamlingen verkar ha fastnat. Starta om körningen eller kontrollera källor, nätverk och API-nyckel.",
    );
  }
}

function jobMessage(job: BackgroundJob | undefined, cacheExists: boolean) {
  if (cacheExists) return "Färsk cache finns.";
  if (!job) return "Ingen cachead briefing finns ännu.";
  if (job.status === "failed") return job.error_message ?? "Första insamlingen misslyckades.";
  if (job.status === "completed") return "Första insamlingen har slutförts.";
  if (job.status === "running") return "Första insamlingen körs.";
  return "Första insamlingen har startats automatiskt.";
}

function statusFromJob(job: BackgroundJob | undefined, cacheExists: boolean): FirstRunStatus {
  return {
    cacheExists,
    job,
    active: Boolean(job && ["pending", "running"].includes(job.status)),
    missingSources: enabledSources().length === 0,
    missingApiKey: !isNationalProcessingConfigured(),
    message: jobMessage(job, cacheExists),
    steps: firstRunSteps,
    progressPercent: cacheExists ? 100 : progressPercentFor(job),
    activeStepIndex: cacheExists ? firstRunSteps.length - 1 : activeStepIndexFor(job),
    estimatedDurationLabel: firstRunEstimatedDurationLabel,
    longRunning: isLongRunning(job),
    logs: payloadLogs(job),
  };
}

function logFirstRun(jobId: string, message: string, data: Record<string, unknown> = {}) {
  const current = getBackgroundJobById(jobId);
  const logs = payloadLogs(current);
  const entry = {
    at: new Date().toISOString(),
    message,
    ...(Object.keys(data).length > 0 ? { data } : {}),
  };

  console.info(`[MissionDesk first-run] ${message} ${JSON.stringify({ jobId, ...data })}`);
  updateBackgroundJobPayload(jobId, {
    logs: [...logs, entry].slice(-30),
  });
}

function updateFirstRunPhase(
  jobId: string,
  phase: string,
  progressPercent: number,
  activeStepIndex: number,
  data: Record<string, unknown> = {},
) {
  updateBackgroundJobPayload(jobId, {
    phase,
    progressPercent,
    activeStepIndex,
    ...data,
  });
}

function enqueueFailedValidationJob(message: string) {
  return enqueueBackgroundJob({
    type: firstRunJobType,
    status: "failed",
    priority: 100,
    attempts: 1,
    max_attempts: 1,
    error_message: message,
    payload: {
      phase: "validation_failed",
      steps: firstRunSteps,
      error: message,
    },
  });
}

export function getFirstRunStatus(): FirstRunStatus {
  failStaleRunningFirstRunJobs();
  return statusFromJob(latestFirstRunJob(), freshCacheExists());
}

export function ensureFirstRunIngestionJob(options: { force?: boolean } = {}) {
  const cacheExists = freshCacheExists();
  if (cacheExists) return statusFromJob(latestFirstRunJob(), true);

  const existingActive = activeFirstRunJob();
  if (existingActive) return statusFromJob(existingActive, false);

  const latest = latestFirstRunJob();

  const sources = enabledSources();
  if (sources.length === 0) {
    const message = "Inga källor är konfigurerade ännu.";
    if (!options.force && latest?.status === "failed" && latest.error_message === message) {
      return statusFromJob(latest, false);
    }
    const failed = enqueueFailedValidationJob(message);
    return statusFromJob(failed, false);
  }

  if (!isNationalProcessingConfigured()) {
    const message = "Kan inte bearbeta källor: OPENAI_API_KEY saknas.";
    if (!options.force && latest?.status === "failed" && latest.error_message === message) {
      return statusFromJob(latest, false);
    }
    const failed = enqueueFailedValidationJob(message);
    return statusFromJob(failed, false);
  }

  if (
    !options.force &&
    latest?.status === "failed" &&
    payloadString(latest, "phase") !== "validation_failed"
  ) {
    return statusFromJob(latest, false);
  }

  const job = enqueueBackgroundJob({
    type: firstRunJobType,
    priority: 100,
    max_attempts: 1,
    payload: {
      phase: "queued",
      reason: latest?.status === "completed" ? "empty_cache_after_completed_job" : "empty_cache",
      sourceCount: sources.length,
      steps: firstRunSteps,
    },
  });

  return statusFromJob(job, false);
}

function enqueueFirstRunBriefingJobs() {
  return [
    enqueueBriefingGenerationJob({
      type: "morning_brief",
      minItems: 1,
      maxItems: 7,
      force: true,
    }),
    enqueueBriefingGenerationJob({
      type: "ambassador_brief",
      minItems: 1,
      maxItems: 6,
      force: true,
    }),
    enqueueBriefingGenerationJob({
      type: "top_national_developments",
      minItems: 1,
      maxItems: 8,
      force: true,
    }),
    enqueueBriefingGenerationJob({
      type: "urgent_developments",
      minItems: 1,
      maxItems: 6,
      force: true,
    }),
    enqueueBriefingGenerationJob({
      type: "upcoming_events_advisories",
      minItems: 1,
      maxItems: 6,
      force: true,
    }),
  ];
}

async function runNationalProcessingUntilIdle(jobId: string, limit = 10) {
  let claimedCount = 0;
  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const errors: Array<{ jobId: string; message: string }> = [];

  for (let batch = 0; batch < 20; batch += 1) {
    const result = await runNationalProcessingWorker({ limit });
    claimedCount += result.claimedCount;
    processedCount += result.processedCount;
    skippedCount += result.skippedCount;
    failedCount += result.failedCount;
    errors.push(...result.errors);

    logFirstRun(jobId, "processed_items batch finished", {
      batch: batch + 1,
      claimedCount: result.claimedCount,
      processedCount: result.processedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
    });

    updateFirstRunPhase(jobId, "processing_items", 72, 2, {
      processedCount,
      processingFailedCount: failedCount,
    });

    if (result.claimedCount === 0) break;
  }

  return { claimedCount, processedCount, skippedCount, failedCount, errors };
}

async function runBriefingGenerationUntilIdle(jobId: string, limit = 5) {
  let claimedCount = 0;
  let generatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const errors: Array<{ jobId: string; message: string }> = [];

  for (let batch = 0; batch < 10; batch += 1) {
    const result = await runBriefingGenerationWorker({ limit });
    claimedCount += result.claimedCount;
    generatedCount += result.generatedCount;
    skippedCount += result.skippedCount;
    failedCount += result.failedCount;
    errors.push(...result.errors);

    logFirstRun(jobId, "briefing batch finished", {
      batch: batch + 1,
      claimedCount: result.claimedCount,
      generatedCount: result.generatedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
    });

    updateFirstRunPhase(jobId, "generating_briefings", 88, 3, {
      briefingGeneratedCount: generatedCount,
      briefingFailedCount: failedCount,
    });

    if (result.claimedCount === 0) break;
  }

  return { claimedCount, generatedCount, skippedCount, failedCount, errors };
}

export function startFirstRunWorkerInBackground() {
  if (firstRunWorkerInFlight) return false;

  firstRunWorkerInFlight = runFirstRunIngestionWorker(1)
    .catch((error) => {
      console.error("[MissionDesk first-run] background worker crashed", error);
    })
    .finally(() => {
      firstRunWorkerInFlight = null;
    });

  return true;
}

export async function runFirstRunIngestionWorker(limit = 1) {
  const jobs = claimBackgroundJobs({ type: firstRunJobType, limit });
  const results: Array<{
    jobId: string;
    ingestedCount?: number;
    selectedCount?: number;
    processingJobs?: number;
    briefingJobs?: number;
    error?: string;
  }> = [];

  for (const job of jobs) {
    try {
      logFirstRun(job.id, "first-run job started", {
        sourceCount: enabledSources().length,
      });

      if (!isNationalProcessingConfigured()) {
        throw new Error("Kan inte bearbeta källor: OPENAI_API_KEY saknas.");
      }

      updateFirstRunPhase(job.id, "ingesting_sources", 28, 0);
      const ingestion = await ingestRawSourceItems({
        limitPerSource: 12,
        concurrency: 4,
        preserveRawContent: true,
      });

      if (ingestion.sourceCount === 0) {
        throw new Error("Inga källor är konfigurerade ännu.");
      }

      logFirstRun(job.id, "source count fetched", {
        sourceCount: ingestion.sourceCount,
        fetchedCount: ingestion.fetchedCount,
        errors: ingestion.errors.length,
      });
      logFirstRun(job.id, "raw_source_items inserted", {
        storedCount: ingestion.storedCount,
        skippedCount: ingestion.skippedCount,
      });
      updateFirstRunPhase(job.id, "ingesting_sources", 42, 0, {
        sourceCount: ingestion.sourceCount,
        fetchedCount: ingestion.fetchedCount,
        rawInsertedCount: ingestion.storedCount,
        ingestionErrorCount: ingestion.errors.length,
      });

      if (ingestion.fetchedCount === 0 && ingestion.storedCount === 0) {
        throw new Error("Inga relevanta källposter hittades vid senaste körningen.");
      }

      updateFirstRunPhase(job.id, "ranking_candidates", 50, 1);
      const ranking = await rankAndStoreCandidates({
        scanLimit: 600,
        targetMax: 60,
        hardCap: 120,
        minSelectedScore: 54,
        minCandidateScore: 45,
        allowRegionalAi: false,
        enqueueAiJobs: false,
      });

      logFirstRun(job.id, "dedupe result count", {
        scannedCount: ranking.scannedCount,
        clusterCount: ranking.clusterCount,
      });
      logFirstRun(job.id, "ranked candidate count", {
        selectedCount: ranking.selectedCount,
        candidateCount: ranking.candidateCount,
        regionalHoldCount: ranking.regionalHoldCount,
      });
      updateFirstRunPhase(job.id, "ranking_candidates", 60, 1, {
        scannedCount: ranking.scannedCount,
        dedupeClusterCount: ranking.clusterCount,
        rankedCandidateCount: ranking.candidates.length,
        selectedCount: ranking.selectedCount,
      });

      if (ranking.scannedCount === 0 || ranking.selectedCount === 0) {
        throw new Error("Inga relevanta källposter hittades vid senaste körningen.");
      }

      const processingJobs = enqueueSelectedNationalProcessingJobs({ limit: 120 });
      logFirstRun(job.id, "processing jobs queued", {
        processingJobs: processingJobs.length,
      });
      updateFirstRunPhase(job.id, "processing_items", 68, 2, {
        processingJobs: processingJobs.length,
      });

      const processing = await runNationalProcessingUntilIdle(job.id, 12);
      logFirstRun(job.id, "processed_items created", {
        processedCount: processing.processedCount,
        skippedCount: processing.skippedCount,
        failedCount: processing.failedCount,
      });

      if (processing.processedCount === 0 && listProcessedItems({ onlyFresh: true, limit: 1 }).length === 0) {
        throw new Error(
          processing.errors[0]?.message ??
            "Inga bearbetade källposter kunde skapas vid senaste körningen.",
        );
      }

      updateFirstRunPhase(job.id, "generating_briefings", 82, 3);
      const briefingJobs = enqueueFirstRunBriefingJobs();
      logFirstRun(job.id, "briefing jobs queued", {
        briefingJobs: briefingJobs.length,
      });

      const briefings = await runBriefingGenerationUntilIdle(job.id, 5);
      logFirstRun(job.id, "briefing generated", {
        generatedCount: briefings.generatedCount,
        skippedCount: briefings.skippedCount,
        failedCount: briefings.failedCount,
      });

      if (briefings.generatedCount === 0 && listBriefings({ onlyFresh: true, limit: 1 }).length === 0) {
        throw new Error(
          briefings.errors[0]?.message ??
            "Briefing kunde inte genereras från de bearbetade källposterna.",
        );
      }

      updateFirstRunPhase(job.id, "completed", 100, 3, {
        completedAt: new Date().toISOString(),
      });
      logFirstRun(job.id, "job completed", {
        processedCount: processing.processedCount,
        briefingGeneratedCount: briefings.generatedCount,
      });
      completeBackgroundJob(job.id);
      results.push({
        jobId: job.id,
        ingestedCount: ingestion.storedCount,
        selectedCount: ranking.selectedCount,
        processingJobs: processing.claimedCount,
        briefingJobs: briefings.claimedCount,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Okänt first-run-fel";
      logFirstRun(job.id, "job failed", { error: message });
      failBackgroundJob(job.id, message);
      results.push({ jobId: job.id, error: message });
    }
  }

  return {
    claimedCount: jobs.length,
    results,
  };
}
