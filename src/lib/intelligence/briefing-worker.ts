import { randomUUID } from "node:crypto";
import {
  briefingModel,
  type BriefingType,
  generateBriefingWithOpenAI,
  isBriefingGenerationConfigured,
} from "@/lib/ai/briefing-generation";
import { cacheExpiresAtFor, cacheHoursFor } from "@/lib/intelligence/cache-policy";
import {
  claimBackgroundJobs,
  completeBackgroundJob,
  enqueueBackgroundJob,
  failBackgroundJob,
  getFreshBriefing,
  listProcessedItems,
  upsertBriefing,
} from "@/lib/intelligence/repository";
import type {
  BackgroundJob,
  NewBriefing,
  ProcessedIntelligenceRecord,
} from "@/lib/intelligence/models";
import type { GeographicScope, ProfileMode } from "@/lib/types";

export interface BriefingSelectionOptions {
  type: BriefingType;
  profile?: ProfileMode;
  geographicScope?: GeographicScope;
  region?: string;
  minItems?: number;
  maxItems?: number;
  cacheHours?: number;
  force?: boolean;
}

export interface BriefingWorkerOptions {
  limit?: number;
  workerId?: string;
  cacheHours?: number;
}

export interface BriefingWorkerRunResult {
  model: string;
  claimedCount: number;
  generatedCount: number;
  skippedCount: number;
  failedCount: number;
  skipped: Array<{ jobId: string; reason: string }>;
  errors: Array<{ jobId: string; message: string }>;
}

const briefingJobType = "generate_briefing";

const defaultProfiles: Record<BriefingType, ProfileMode> = {
  morning_brief: "daily_overview",
  ambassador_brief: "ambassador_briefing",
  top_national_developments: "daily_overview",
  urgent_developments: "security",
  upcoming_events_advisories: "upcoming_events",
};

function payloadString(job: BackgroundJob, key: string) {
  const value = job.payload[key];
  return typeof value === "string" ? value : undefined;
}

function payloadNumber(job: BackgroundJob, key: string) {
  const value = job.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function payloadBoolean(job: BackgroundJob, key: string) {
  const value = job.payload[key];
  return typeof value === "boolean" ? value : undefined;
}

function compositeScore(record: ProcessedIntelligenceRecord, type: BriefingType) {
  const processed = record.processed;
  const base =
    processed.urgency_score * 0.22 +
    processed.diplomatic_relevance_score * 0.28 +
    processed.sweden_relevance_score * 0.2 +
    processed.economic_impact_score * 0.14 +
    processed.security_impact_score * 0.16;
  const officialBoost = ["government", "institution", "advisory", "event", "report"].includes(
    record.raw.source_type,
  )
    ? 6
    : 0;
  const typeBoost =
    type === "urgent_developments"
      ? processed.urgency_score * 0.18 + processed.security_impact_score * 0.12
      : type === "ambassador_brief"
        ? processed.diplomatic_relevance_score * 0.16 + processed.sweden_relevance_score * 0.1
        : type === "upcoming_events_advisories" &&
            ["advisory", "event"].includes(record.raw.source_type)
          ? 18
          : 0;

  return base + officialBoost + typeBoost;
}

function sourceTypeMatches(type: BriefingType, record: ProcessedIntelligenceRecord) {
  if (type !== "upcoming_events_advisories") return true;
  return ["advisory", "event", "government", "institution"].includes(record.raw.source_type);
}

function thresholdFor(type: BriefingType) {
  if (type === "urgent_developments") return 78;
  if (type === "ambassador_brief") return 72;
  if (type === "upcoming_events_advisories") return 64;
  return 68;
}

export function selectBriefingItems(
  options: BriefingSelectionOptions,
): ProcessedIntelligenceRecord[] {
  const profile = options.profile ?? defaultProfiles[options.type];
  const maxItems = Math.max(4, Math.min(9, options.maxItems ?? 7));
  const minItems = Math.max(1, options.minItems ?? 5);
  const threshold = options.minItems && options.minItems <= 1
    ? Math.max(50, thresholdFor(options.type) - 14)
    : thresholdFor(options.type);
  const profileRecords = listProcessedItems({
    profile,
    onlyFresh: true,
    limit: 120,
  });
  const fallbackRecords = listProcessedItems({
    onlyFresh: true,
    limit: 120,
  });
  const sourceRecords = profileRecords.length >= minItems ? profileRecords : fallbackRecords;
  const candidates = sourceRecords.filter((record) => {
    if (!sourceTypeMatches(options.type, record)) return false;
    if (
      options.geographicScope &&
      options.geographicScope !== "national" &&
      record.processed.geographic_scope !== options.geographicScope
    ) {
      return false;
    }
    if (options.region && !record.processed.geographic_tags.includes(options.region)) {
      return false;
    }
    return compositeScore(record, options.type) >= threshold;
  });

  const uniqueByCategory = new Map<string, ProcessedIntelligenceRecord>();

  for (const record of candidates.sort(
    (a, b) => compositeScore(b, options.type) - compositeScore(a, options.type),
  )) {
    const key = `${record.processed.category}:${record.raw.source_name}`;
    if (!uniqueByCategory.has(key)) {
      uniqueByCategory.set(key, record);
    }
  }

  return [...uniqueByCategory.values()]
    .sort((a, b) => compositeScore(b, options.type) - compositeScore(a, options.type))
    .slice(0, maxItems);
}

export function briefingIdFor(options: Required<Pick<BriefingSelectionOptions, "type" | "profile" | "geographicScope">> & { region?: string }) {
  const date = new Date().toISOString().slice(0, 10);
  return [
    "briefing",
    date,
    options.type,
    options.profile,
    options.geographicScope,
    options.region ?? "national",
  ].join(":");
}

export function enqueueBriefingGenerationJob(options: BriefingSelectionOptions) {
  const profile = options.profile ?? defaultProfiles[options.type];
  const geographicScope = options.geographicScope ?? "national";

  return enqueueBackgroundJob({
    type: briefingJobType,
    priority:
      options.type === "morning_brief"
        ? 92
        : options.type === "ambassador_brief"
          ? 88
          : 76,
    payload: {
      type: options.type,
      profile,
      geographicScope,
      region: options.region,
      minItems: options.minItems ?? 5,
      maxItems: options.maxItems ?? 10,
      cacheHours: options.cacheHours,
      force: options.force ?? false,
    },
  });
}

export function enqueueDefaultBriefingJobs(options: { force?: boolean; cacheHours?: number } = {}) {
  return [
    enqueueBriefingGenerationJob({
      type: "morning_brief",
      minItems: 4,
      maxItems: 7,
      force: options.force,
      cacheHours: options.cacheHours,
    }),
    enqueueBriefingGenerationJob({
      type: "ambassador_brief",
      minItems: 3,
      maxItems: 6,
      force: options.force,
      cacheHours: options.cacheHours,
    }),
    enqueueBriefingGenerationJob({
      type: "top_national_developments",
      minItems: 4,
      maxItems: 8,
      force: options.force,
      cacheHours: options.cacheHours,
    }),
    enqueueBriefingGenerationJob({
      type: "urgent_developments",
      minItems: 1,
      maxItems: 6,
      force: options.force,
      cacheHours: options.cacheHours,
    }),
    enqueueBriefingGenerationJob({
      type: "upcoming_events_advisories",
      minItems: 1,
      maxItems: 6,
      force: options.force,
      cacheHours: options.cacheHours,
    }),
  ];
}

async function generateBriefingFromJob(
  job: BackgroundJob,
  options: Required<Pick<BriefingWorkerOptions, "cacheHours">>,
) {
  const type = payloadString(job, "type") as BriefingType | undefined;
  if (!type || !defaultProfiles[type]) {
    throw new Error("Missing or invalid briefing type");
  }

  const profile = (payloadString(job, "profile") as ProfileMode | undefined) ?? defaultProfiles[type];
  const geographicScope =
    (payloadString(job, "geographicScope") as GeographicScope | undefined) ?? "national";
  const region = payloadString(job, "region");
  const force = payloadBoolean(job, "force") ?? false;
  const minItems = payloadNumber(job, "minItems") ?? 5;
  const maxItems = payloadNumber(job, "maxItems") ?? 10;
  const cacheHours = payloadNumber(job, "cacheHours") ?? options.cacheHours;

  if (!force) {
    const fresh = getFreshBriefing({
      type,
      profile,
      geographic_scope: geographicScope,
      region,
    });
    if (fresh) {
      return { skipped: true, reason: "fresh briefing already exists" };
    }
  }

  const items = selectBriefingItems({
    type,
    profile,
    geographicScope,
    region,
    minItems,
    maxItems,
  });

  if (items.length < minItems) {
    return { skipped: true, reason: `not enough high-signal processed items (${items.length})` };
  }

  if (items.length === 0) {
    return { skipped: true, reason: "no matching processed items" };
  }

  const generated = await generateBriefingWithOpenAI({
    type,
    profile,
    geographicScope,
    region,
    items,
  });

  if (!generated) {
    throw new Error("Briefing generation returned no content");
  }

  const generatedAt = new Date().toISOString();
  const cacheScope = type === "urgent_developments" ? "breaking" : "briefing";
  const briefing: NewBriefing = {
    id:
      force
        ? `${briefingIdFor({ type, profile, geographicScope, region })}:${randomUUID()}`
        : briefingIdFor({ type, profile, geographicScope, region }),
    type,
    profile,
    geographic_scope: geographicScope,
    region,
    content_sv: generated.content_sv,
    source_item_ids: items.map((item) => item.raw.id),
    generated_model: briefingModel(),
    generated_at: generatedAt,
    cache_expires_at: cacheExpiresAtFor(cacheScope, cacheHours),
  };

  upsertBriefing(briefing);
  return { skipped: false };
}

export async function runBriefingGenerationWorker(
  options: BriefingWorkerOptions = {},
): Promise<BriefingWorkerRunResult> {
  if (!isBriefingGenerationConfigured()) {
    throw new Error("OPENAI_API_KEY is required for briefing generation");
  }

  const jobs = claimBackgroundJobs({
    type: briefingJobType,
    limit: options.limit ?? 5,
    workerId: options.workerId,
  });
  let generatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  const skipped: BriefingWorkerRunResult["skipped"] = [];
  const errors: BriefingWorkerRunResult["errors"] = [];

  for (const job of jobs) {
    try {
      const result = await generateBriefingFromJob(job, {
        cacheHours: cacheHoursFor("briefing", options.cacheHours),
      });

      if (result.skipped) {
        skippedCount += 1;
        skipped.push({ jobId: job.id, reason: result.reason ?? "skipped" });
      } else {
        generatedCount += 1;
      }

      completeBackgroundJob(job.id);
    } catch (error) {
      failedCount += 1;
      const message = error instanceof Error ? error.message : "Unknown briefing error";
      errors.push({ jobId: job.id, message });
      failBackgroundJob(job.id, message);
    }
  }

  return {
    model: briefingModel(),
    claimedCount: jobs.length,
    generatedCount,
    skippedCount,
    failedCount,
    skipped,
    errors,
  };
}
