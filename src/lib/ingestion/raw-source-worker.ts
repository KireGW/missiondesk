import { getSources } from "@/lib/sources/store";
import {
  claimBackgroundJobs,
  completeBackgroundJob,
  failBackgroundJob,
} from "@/lib/intelligence/repository";
import { ingestRawSourceItems, enqueueRawIngestionJobs } from "@/lib/ingestion/raw-source-ingestion";
import type {
  BackgroundJob,
  RawIngestionJobType,
  RawSourceItem,
} from "@/lib/intelligence/models";
import type { SourceIntelligenceType } from "@/lib/intelligence/models";
import type { IngestibleSourceDefinition } from "@/lib/ingestion/types";
import type { EmbassyConfig } from "@/lib/types";
import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";

export interface RawIngestionWorkerOptions {
  limit?: number;
  workerId?: string;
  sourceIds?: string[];
  sourceTypes?: SourceIntelligenceType[];
  concurrency?: number;
  preserveRawContent?: boolean;
  limitPerSource?: number;
  since?: string;
  enqueueMissingJobs?: boolean;
  config?: EmbassyConfig;
}

export interface RawIngestionWorkerResult {
  claimedCount: number;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  storedCount: number;
  fetchedCount: number;
  items: RawSourceItem[];
  errors: Array<{ jobId: string; message: string }>;
}

const rawIngestionJobType: RawIngestionJobType = "ingest_raw_source";

function payloadString(job: BackgroundJob, key: string) {
  const value = job.payload[key];
  return typeof value === "string" ? value : undefined;
}

function payloadBoolean(job: BackgroundJob, key: string) {
  const value = job.payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function payloadNumber(job: BackgroundJob, key: string) {
  const value = job.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function payloadSource(job: BackgroundJob): Promise<IngestibleSourceDefinition | null> {
  const sourceId = payloadString(job, "sourceId");
  if (!sourceId) return null;

  return (
    ((await getSources()) as IngestibleSourceDefinition[]).find((source) => source.id === sourceId) ??
    null
  );
}

async function processJob(
  job: BackgroundJob,
  options: Required<
    Pick<
      RawIngestionWorkerOptions,
      "config" | "concurrency" | "limitPerSource" | "preserveRawContent"
    >
  >,
): Promise<
  | { skipped: true; reason: string }
  | { skipped: false; result: Awaited<ReturnType<typeof ingestRawSourceItems>> }
> {
  const source = await payloadSource(job);
  if (!source) {
    return { skipped: true, reason: "source missing or deleted" };
  }

  const limitPerSource = payloadNumber(job, "limitPerSource") ?? options.limitPerSource;
  const preserveRawContent = payloadBoolean(job, "preserveRawContent") ?? options.preserveRawContent;
  const since = payloadString(job, "since");

  const result = await ingestRawSourceItems({
    config: options.config,
    sources: [source],
    concurrency: Math.max(1, options.concurrency),
    limitPerSource,
    preserveRawContent,
    since,
  });

  return {
    skipped: false,
    result,
  };
}

export async function runRawIngestionWorker(
  options: RawIngestionWorkerOptions = {},
): Promise<RawIngestionWorkerResult> {
  if (options.enqueueMissingJobs) {
    await enqueueRawIngestionJobs({
      sourceIds: options.sourceIds,
      sourceTypes: options.sourceTypes,
      limitPerSource: options.limitPerSource,
      preserveRawContent: options.preserveRawContent,
      since: options.since,
    });
  }

  const jobs = await claimBackgroundJobs({
    type: rawIngestionJobType,
    limit: options.limit ?? 10,
    workerId: options.workerId,
  });

  const result: RawIngestionWorkerResult = {
    claimedCount: jobs.length,
    processedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    storedCount: 0,
    fetchedCount: 0,
    items: [],
    errors: [],
  };

  for (const job of jobs) {
    try {
      const processed = await processJob(job, {
        config: options.config ?? swedenMexicoEmbassyConfig,
        concurrency: options.concurrency ?? 6,
        limitPerSource: options.limitPerSource ?? 25,
        preserveRawContent: options.preserveRawContent ?? true,
      });

      if (processed.skipped) {
        result.skippedCount += 1;
      } else {
        result.processedCount += 1;
        result.fetchedCount += processed.result.fetchedCount;
        result.storedCount += processed.result.storedCount;
        result.items.push(...processed.result.results.flatMap((entry) => entry.items));
      }

      await completeBackgroundJob(job.id);
    } catch (error) {
      result.failedCount += 1;
      const message = error instanceof Error ? error.message : "Unknown ingestion error";
      result.errors.push({ jobId: job.id, message });
      await failBackgroundJob(job.id, message);
    }
  }

  return result;
}
