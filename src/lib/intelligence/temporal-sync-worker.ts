import {
  claimBackgroundJobs,
  completeBackgroundJob,
  enqueueBackgroundJob,
  failBackgroundJob,
  getBackgroundJobById,
  listBackgroundJobs,
  listProcessedItems,
  updateBackgroundJobPayload,
} from "@/lib/intelligence/repository";
import { isTemporalExtractionConfigured, storeTemporalSignalForProcessedRecord } from "@/lib/intelligence/temporal-signals";
import type { BackgroundJob, ProcessedIntelligenceRecord } from "@/lib/intelligence/models";

export const temporalSyncJobType = "sync_temporal_signal";
const temporalSyncCancelledMessage = "Framåtblicksuppdateringen avbröts av användaren.";

export interface TemporalSyncWorkerOptions {
  limit?: number;
  workerId?: string;
}

export interface TemporalSyncWorkerRunResult {
  claimedCount: number;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: Array<{ jobId: string; message: string }>;
}

export interface TemporalSyncDrainResult extends TemporalSyncWorkerRunResult {
  batchesRun: number;
}

function payloadString(job: BackgroundJob, key: string) {
  const value = job.payload[key];
  return typeof value === "string" ? value : undefined;
}

async function isCancelled(jobId: string) {
  const current = await getBackgroundJobById(jobId);
  return current?.status === "cancelled";
}

async function hasPendingTemporalSyncJob(rawSourceItemId: string) {
  return (await listBackgroundJobs({ type: temporalSyncJobType, limit: 250 })).some(
    (job) =>
      ["pending", "running"].includes(job.status) &&
      typeof job.payload.rawSourceItemId === "string" &&
      job.payload.rawSourceItemId === rawSourceItemId,
  );
}

async function loadProcessedRecord(rawSourceItemId: string): Promise<ProcessedIntelligenceRecord | undefined> {
  return (
    await listProcessedItems({
      rawSourceItemIds: [rawSourceItemId],
      onlyFresh: false,
      limit: 1,
    })
  )[0];
}

export async function enqueueTemporalSyncJobs(rawSourceItemIds: string[]) {
  if (!isTemporalExtractionConfigured()) return [];

  const uniqueIds = [...new Set(rawSourceItemIds.filter(Boolean))];
  const queued: BackgroundJob[] = [];

  for (const rawSourceItemId of uniqueIds) {
    if (await hasPendingTemporalSyncJob(rawSourceItemId)) continue;

    queued.push(
      await enqueueBackgroundJob({
        type: temporalSyncJobType,
        priority: 70,
        payload: {
          rawSourceItemId,
        },
      }),
    );
  }

  return queued;
}

async function processJob(job: BackgroundJob) {
  const rawSourceItemId = payloadString(job, "rawSourceItemId");
  if (!rawSourceItemId) {
    return { skipped: false, failed: true, reason: "Missing rawSourceItemId in temporal sync job payload" };
  }

  const record = await loadProcessedRecord(rawSourceItemId);
  if (!record) {
    return { skipped: true, failed: false, reason: "processed record not found" };
  }

  const outcome = await storeTemporalSignalForProcessedRecord(record);
  await updateBackgroundJobPayload(job.id, {
    temporalOutcome: outcome.outcome,
    temporalSkipReason: outcome.skipReason,
    temporalContext: outcome.temporalContext,
  });

  return { skipped: false, failed: false, reason: undefined };
}

export async function runTemporalSyncWorker(
  options: TemporalSyncWorkerOptions = {},
): Promise<TemporalSyncWorkerRunResult> {
  if (!isTemporalExtractionConfigured()) {
    throw new Error("OPENAI_API_KEY is required for temporal extraction");
  }

  const jobs = await claimBackgroundJobs({
    type: temporalSyncJobType,
    limit: options.limit ?? 8,
    workerId: options.workerId,
  });
  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const errors: TemporalSyncWorkerRunResult["errors"] = [];

  for (const job of jobs) {
    try {
      if (await isCancelled(job.id)) {
        skippedCount += 1;
        continue;
      }

      const result = await processJob(job);

      if (result.failed) {
        failedCount += 1;
        errors.push({ jobId: job.id, message: result.reason ?? "Unknown temporal sync error" });
        await failBackgroundJob(job.id, result.reason ?? "Unknown temporal sync error");
        continue;
      }

      if (result.skipped) {
        skippedCount += 1;
      } else {
        processedCount += 1;
      }

      if (await isCancelled(job.id)) {
        skippedCount += 1;
        await updateBackgroundJobPayload(job.id, {
          temporalOutcome: "cancelled",
          temporalSkipReason: temporalSyncCancelledMessage,
        });
        continue;
      }

      await completeBackgroundJob(job.id);
    } catch (error) {
      if (await isCancelled(job.id)) {
        skippedCount += 1;
        await updateBackgroundJobPayload(job.id, {
          temporalOutcome: "cancelled",
          temporalSkipReason: temporalSyncCancelledMessage,
        });
        continue;
      }

      failedCount += 1;
      const message = error instanceof Error ? error.message : "Unknown temporal sync error";
      errors.push({ jobId: job.id, message });
      await failBackgroundJob(job.id, message);
    }
  }

  return {
    claimedCount: jobs.length,
    processedCount,
    skippedCount,
    failedCount,
    errors,
  };
}

export async function runTemporalSyncWorkerUntilIdle(
  options: TemporalSyncWorkerOptions = {},
): Promise<TemporalSyncDrainResult> {
  let claimedCount = 0;
  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let batchesRun = 0;
  const errors: Array<{ jobId: string; message: string }> = [];

  while (true) {
    const result = await runTemporalSyncWorker(options);
    batchesRun += 1;
    claimedCount += result.claimedCount;
    processedCount += result.processedCount;
    skippedCount += result.skippedCount;
    failedCount += result.failedCount;
    errors.push(...result.errors);

    if (result.claimedCount === 0) break;
  }

  return {
    claimedCount,
    processedCount,
    skippedCount,
    failedCount,
    errors,
    batchesRun,
  };
}

let temporalSyncInFlight: Promise<unknown> | null = null;

export function startTemporalSyncWorkerInBackground(limit = 8) {
  if (temporalSyncInFlight || !isTemporalExtractionConfigured()) return false;

  temporalSyncInFlight = runTemporalSyncWorkerUntilIdle({ limit })
    .catch((error) => {
      console.error("[temporal] background worker crashed", error);
    })
    .finally(() => {
      temporalSyncInFlight = null;
    });

  return true;
}
