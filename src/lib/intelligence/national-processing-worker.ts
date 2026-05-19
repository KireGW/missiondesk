import {
  claimBackgroundJobs,
  completeBackgroundJob,
  enqueueBackgroundJob,
  failBackgroundJob,
  getProcessedItemByRawId,
  listPendingBackgroundJobs,
  listRankedCandidates,
  upsertProcessedItem,
} from "@/lib/intelligence/repository";
import { cacheExpiresAtFor, cacheHoursFor, isCacheFresh } from "@/lib/intelligence/cache-policy";
import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import {
  isNationalProcessingConfigured,
  nationalProcessingModel,
  processNationalSourceItemWithOpenAI,
} from "@/lib/ai/national-processing";
import { detectGeographicDivisionIds } from "@/lib/ingestion/geography";
import type {
  BackgroundJob,
  NewProcessedItem,
  RankedCandidateRecord,
} from "@/lib/intelligence/models";

export interface NationalProcessingOptions {
  limit?: number;
  workerId?: string;
  enqueueMissingJobs?: boolean;
  cacheHours?: number;
  force?: boolean;
  reprocessStale?: boolean;
}

export interface NationalProcessingRunResult {
  model: string;
  claimedCount: number;
  processedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: Array<{ jobId: string; message: string }>;
}

const processingJobType = "process_ranked_candidate";

function payloadString(job: BackgroundJob, key: string) {
  const value = job.payload[key];
  return typeof value === "string" ? value : undefined;
}

function payloadBoolean(job: BackgroundJob, key: string) {
  const value = job.payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function isNationalCandidate(record: RankedCandidateRecord) {
  if (record.candidate.selection_status !== "selected") return false;
  if (record.candidate.duplicate_of_raw_source_item_id) return false;
  return true;
}

function hasPendingProcessingJob(rawSourceItemId: string) {
  return listPendingBackgroundJobs(250).some(
    (job) =>
      job.type === processingJobType &&
      typeof job.payload.rawSourceItemId === "string" &&
      job.payload.rawSourceItemId === rawSourceItemId,
  );
}

export function enqueueSelectedNationalProcessingJobs(
  input: number | { limit?: number; force?: boolean; reprocessStale?: boolean } = 100,
) {
  const limit = typeof input === "number" ? input : input.limit ?? 100;
  const force = typeof input === "number" ? false : input.force ?? false;
  const reprocessStale =
    typeof input === "number" ? false : input.reprocessStale ?? false;
  const selected = listRankedCandidates({ status: "selected", limit })
    .filter(isNationalCandidate)
    .filter((record) => {
      if (force) return true;

      const existing = getProcessedItemByRawId(record.raw.id);
      if (!existing) return true;

      return reprocessStale && !isCacheFresh(existing.cache_expires_at);
    })
    .filter((record) => !hasPendingProcessingJob(record.raw.id));

  return selected.map((record) =>
    enqueueBackgroundJob({
      type: processingJobType,
      priority: record.candidate.rank_score,
      payload: {
        rawSourceItemId: record.raw.id,
        rankingVersion: record.candidate.ranking_version,
        nationalOnly: true,
        force,
        reprocessStale,
      },
    }),
  );
}

function findCandidate(rawSourceItemId: string) {
  return listRankedCandidates({ status: "selected", limit: 250 }).find(
    (record) => record.raw.id === rawSourceItemId,
  );
}

async function processJob(
  job: BackgroundJob,
  options: Required<
    Pick<NationalProcessingOptions, "cacheHours" | "force" | "reprocessStale">
  >,
) {
  const rawSourceItemId = payloadString(job, "rawSourceItemId");
  if (!rawSourceItemId) {
    throw new Error("Missing rawSourceItemId in processing job payload");
  }
  const force = payloadBoolean(job, "force") ?? options.force;
  const reprocessStale =
    payloadBoolean(job, "reprocessStale") ?? options.reprocessStale;

  const record = findCandidate(rawSourceItemId);
  if (!record) {
    return { skipped: true, reason: "candidate not selected or no longer available" };
  }

  if (!isNationalCandidate(record)) {
    return { skipped: true, reason: "candidate is duplicate or no longer selected" };
  }

  const existing = getProcessedItemByRawId(rawSourceItemId);
  if (existing && !force) {
    if (isCacheFresh(existing.cache_expires_at)) {
      return { skipped: true, reason: "fresh processed cache already exists" };
    }

    if (!reprocessStale) {
      return { skipped: true, reason: "stale processed cache reused" };
    }
  }

  const analysis = await processNationalSourceItemWithOpenAI(record.raw, record.candidate);
  if (!analysis) {
    throw new Error("National processing returned no analysis");
  }

  const processedAt = new Date().toISOString();
  const cacheScope =
    analysis.urgency_score >= 90 || analysis.security_impact_score >= 90
      ? "breaking"
      : "national_dashboard";
  const explicitGeographicTags = detectGeographicDivisionIds(
    [
      record.raw.title_original,
      record.raw.snippet,
      record.raw.raw_content?.slice(0, 5000),
    ]
      .filter(Boolean)
      .join(" "),
    swedenMexicoEmbassyConfig,
  );
  const geographicTags = [
    ...new Set([
      ...analysis.geographic_tags,
      ...explicitGeographicTags,
    ]),
  ];
  const geographicScope =
    geographicTags.length > 0 ? "administrative_division" : analysis.geographic_scope;
  const processed: NewProcessedItem = {
    raw_source_item_id: rawSourceItemId,
    title_sv: analysis.title_sv,
    summary_sv: analysis.summary_sv,
    category: analysis.category,
    urgency_score: analysis.urgency_score,
    diplomatic_relevance_score: analysis.diplomatic_relevance_score,
    sweden_relevance_score: analysis.sweden_relevance_score,
    economic_impact_score: analysis.economic_impact_score,
    security_impact_score: analysis.security_impact_score,
    geographic_scope: geographicScope,
    geographic_tags: geographicTags,
    why_it_may_matter_sv: analysis.why_it_may_matter_sv,
    profile_tags: analysis.profile_tags,
    processed_model: nationalProcessingModel(),
    processed_at: processedAt,
    cache_expires_at: cacheExpiresAtFor(cacheScope, options.cacheHours),
  };

  upsertProcessedItem(processed);
  return { skipped: false };
}

export async function runNationalProcessingWorker(
  options: NationalProcessingOptions = {},
): Promise<NationalProcessingRunResult> {
  if (!isNationalProcessingConfigured()) {
    throw new Error("OPENAI_API_KEY is required for national background processing");
  }

  if (options.enqueueMissingJobs) {
    enqueueSelectedNationalProcessingJobs({
      limit: options.limit ?? 100,
      force: options.force ?? false,
      reprocessStale: options.reprocessStale ?? false,
    });
  }

  const jobs = claimBackgroundJobs({
    type: processingJobType,
    limit: options.limit ?? 10,
    workerId: options.workerId,
  });
  let processedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const errors: NationalProcessingRunResult["errors"] = [];

  for (const job of jobs) {
    try {
      const result = await processJob(job, {
        cacheHours: cacheHoursFor("national_dashboard", options.cacheHours),
        force: options.force ?? false,
        reprocessStale: options.reprocessStale ?? false,
      });

      if (result.skipped) {
        skippedCount += 1;
      } else {
        processedCount += 1;
      }

      completeBackgroundJob(job.id);
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : "Unknown processing error";
      errors.push({ jobId: job.id, message });
      failBackgroundJob(job.id, message);
    }
  }

  return {
    model: nationalProcessingModel(),
    claimedCount: jobs.length,
    processedCount,
    skippedCount,
    failedCount,
    errors,
  };
}
