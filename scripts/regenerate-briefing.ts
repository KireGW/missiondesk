import nextEnv from "@next/env";
import { closeDb } from "../src/lib/db/postgres";
import {
  enqueueBriefingGenerationJob,
  enqueueDefaultBriefingJobs,
  runBriefingGenerationWorker,
} from "../src/lib/intelligence/briefing-worker";
import { listBriefings } from "../src/lib/intelligence/repository";
import type { BriefingType } from "../src/lib/ai/briefing-generation";
import type { GeographicScope, ProfileMode } from "../src/lib/types";

nextEnv.loadEnvConfig(process.cwd());

const validTypes = new Set<BriefingType>([
  "morning_brief",
  "ambassador_brief",
  "top_national_developments",
  "urgent_developments",
  "upcoming_events_advisories",
]);

const defaultSelectionByType: Record<BriefingType, { minItems: number; maxItems: number }> = {
  morning_brief: { minItems: 4, maxItems: 7 },
  ambassador_brief: { minItems: 5, maxItems: 5 },
  top_national_developments: { minItems: 4, maxItems: 8 },
  urgent_developments: { minItems: 1, maxItems: 6 },
  upcoming_events_advisories: { minItems: 1, maxItems: 6 },
};

function getArgValue(flag: string) {
  const raw = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return raw ? raw.slice(flag.length + 1) : undefined;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

function parseNumberArg(flag: string) {
  const raw = getArgValue(flag);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseBriefingType(raw: string | undefined): BriefingType | undefined {
  if (!raw) return undefined;
  return validTypes.has(raw as BriefingType) ? (raw as BriefingType) : undefined;
}

function previewContent(content: string, maxLength = 700) {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength)}...`;
}

async function runWorkerUntilIdle(limit: number) {
  const runs = [];

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const result = await runBriefingGenerationWorker({ limit });
    runs.push(result);

    if (result.claimedCount === 0) {
      break;
    }
  }

  return runs;
}

async function main() {
  const regenerateDefaults = hasFlag("--defaults");
  const requestedType = parseBriefingType(getArgValue("--type")) ?? "ambassador_brief";
  const profile = getArgValue("--profile") as ProfileMode | undefined;
  const geographicScope = (getArgValue("--scope") as GeographicScope | undefined) ?? "national";
  const region = getArgValue("--region");
  const defaultsForType = defaultSelectionByType[requestedType];
  const minItems = parseNumberArg("--min-items") ?? defaultsForType.minItems;
  const maxItems = parseNumberArg("--max-items") ?? defaultsForType.maxItems;
  const workerLimit = parseNumberArg("--worker-limit") ?? 5;
  const cacheHours = parseNumberArg("--cache-hours");

  console.info(
    `[briefing-regenerate] starting ${regenerateDefaults ? "default briefing refresh" : `${requestedType} refresh`} from current processed state`,
  );

  const jobs = regenerateDefaults
    ? await enqueueDefaultBriefingJobs({ force: true, cacheHours })
    : [
        await enqueueBriefingGenerationJob({
          type: requestedType,
          profile,
          geographicScope,
          region,
          minItems,
          maxItems,
          cacheHours,
          force: true,
        }),
      ];

  console.info(`[briefing-regenerate] enqueued ${jobs.length} job(s)`);

  const runs = await runWorkerUntilIdle(workerLimit);
  const summary = runs.reduce(
    (acc, run) => {
      acc.claimedCount += run.claimedCount;
      acc.generatedCount += run.generatedCount;
      acc.skippedCount += run.skippedCount;
      acc.failedCount += run.failedCount;
      acc.skipped.push(...run.skipped);
      acc.errors.push(...run.errors);
      return acc;
    },
    {
      claimedCount: 0,
      generatedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      skipped: [] as Array<{ jobId: string; reason: string }>,
      errors: [] as Array<{ jobId: string; message: string }>,
    },
  );

  const filters = regenerateDefaults
    ? { limit: 5, onlyFresh: false as const }
    : {
        type: requestedType,
        profile,
        geographicScope,
        region,
        limit: 3,
        onlyFresh: false as const,
      };

  const latestBriefings = await listBriefings(filters);

  console.log(
    JSON.stringify(
      {
        enqueuedCount: jobs.length,
        summary,
        latestBriefings: latestBriefings.map((briefing) => ({
          id: briefing.id,
          type: briefing.type,
          profile: briefing.profile,
          geographic_scope: briefing.geographic_scope,
          region: briefing.region,
          generated_at: briefing.generated_at,
          source_item_count: briefing.source_item_ids.length,
          content_preview: previewContent(briefing.content_sv),
        })),
      },
      null,
      2,
    ),
  );
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
