import nextEnv from "@next/env";
import { closeDb } from "../src/lib/db/postgres";
import type { ProcessedIntelligenceRecord } from "../src/lib/intelligence/models";
import { listProcessedItems } from "../src/lib/intelligence/repository";
import { assessTemporalPrefilter } from "../src/lib/intelligence/temporal-signals";

nextEnv.loadEnvConfig(process.cwd());

function parseNumberArg(flag: string, fallback: number) {
  const raw = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (!raw) return fallback;
  const value = Number(raw.slice(flag.length + 1));
  return Number.isFinite(value) ? value : fallback;
}

function topEntries(counts: Map<string, number>, limit: number) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

async function loadAllProcessedItems(batchSize: number) {
  const records: ProcessedIntelligenceRecord[] = [];
  let offset = 0;

  while (true) {
    const page = await listProcessedItems({
      onlyFresh: false,
      limit: batchSize,
      offset,
    });
    records.push(...page);
    if (page.length < batchSize) break;
    offset += page.length;
  }

  return records;
}

async function main() {
  const batchSize = Math.min(250, Math.max(25, parseNumberArg("--batch", 250)));
  const minStrategicImportance = Math.max(0, Math.min(100, parseNumberArg("--min-strategic", 50)));
  const sampleLimit = Math.max(5, Math.min(100, parseNumberArg("--sample", 25)));

  console.info(
    `[temporal-prefilter-audit] scanning all processed items with batch=${batchSize}, minStrategic=${minStrategicImportance}`,
  );

  const records = await loadAllProcessedItems(batchSize);

  const passedSourceCounts = new Map<string, number>();
  const passedSourceTypeCounts = new Map<string, number>();
  const passedCueCounts = new Map<string, number>();
  const failedReasonCounts = new Map<string, number>();
  const passedSamples: Array<{
    title: string;
    source: string;
    sourceType: string;
    publishedAt?: string;
    category: string;
    baselineStrategicImportance: number;
    cueTags: string[];
    summary: string;
  }> = [];

  let passedCount = 0;

  for (const record of records) {
    const assessment = assessTemporalPrefilter(record, minStrategicImportance);
    if (assessment.passed) {
      passedCount += 1;
      passedSourceCounts.set(
        record.raw.source_name,
        (passedSourceCounts.get(record.raw.source_name) ?? 0) + 1,
      );
      passedSourceTypeCounts.set(
        record.raw.source_type,
        (passedSourceTypeCounts.get(record.raw.source_type) ?? 0) + 1,
      );
      for (const cue of assessment.cueTags) {
        passedCueCounts.set(cue, (passedCueCounts.get(cue) ?? 0) + 1);
      }
      passedSamples.push({
        title: record.processed.title_sv,
        source: record.raw.source_name,
        sourceType: record.raw.source_type,
        publishedAt: record.raw.published_at,
        category: record.processed.category,
        baselineStrategicImportance: assessment.baselineStrategicImportance,
        cueTags: assessment.cueTags,
        summary: record.processed.summary_sv,
      });
      continue;
    }

    for (const reason of assessment.failureReasons) {
      failedReasonCounts.set(reason, (failedReasonCounts.get(reason) ?? 0) + 1);
    }
  }

  const sortedSamples = passedSamples
    .sort((a, b) => {
      if (b.baselineStrategicImportance !== a.baselineStrategicImportance) {
        return b.baselineStrategicImportance - a.baselineStrategicImportance;
      }
      return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
    })
    .slice(0, sampleLimit);

  console.log(
    JSON.stringify(
      {
        audit: {
          scannedProcessedItems: records.length,
          passedPrefilterCount: passedCount,
          passedPrefilterShare: records.length > 0 ? Number((passedCount / records.length).toFixed(4)) : 0,
          minStrategicImportance,
          batchSize,
        },
        currentTemporalRuntimeDefaults: {
          onlyFresh: false,
          scanLimit: "all processed items unless a limit is explicitly provided",
          attemptLimit: "all eligible processed items unless a limit is explicitly provided",
          aiAttemptCap: "none in temporal module; caller may still choose a limit",
          temporalSyncTrigger: "runs best-effort after national processing of relevant items",
          historicalBackfill: "one-time via npm run backfill:temporal-signals",
          upcomingApiGetLimit: 30,
          upcomingPanelFetchLimit: 24,
        },
        topPassedSources: topEntries(passedSourceCounts, 15),
        passedBySourceType: topEntries(passedSourceTypeCounts, 10),
        passedByCueTag: topEntries(passedCueCounts, 20),
        failedReasonCounts: topEntries(failedReasonCounts, 10),
        passedSamples: sortedSamples,
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
