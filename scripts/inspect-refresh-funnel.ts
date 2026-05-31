import nextEnv from "@next/env";
import { closeDb } from "../src/lib/db/postgres";
import { listBackgroundJobs } from "../src/lib/intelligence/repository";

nextEnv.loadEnvConfig(process.cwd());

type RefreshObservabilityCounts = {
  scannedSources?: number;
  sourcesWithStoredItems?: number;
  fetchedCount?: number;
  rawInsertedCount?: number;
  skippedCount?: number;
  errorCount?: number;
  rankedCount?: number;
  selectedCount?: number;
  candidateCount?: number;
  rejectedCount?: number;
  deferredCount?: number;
  regionalHoldCount?: number;
  processingJobsQueued?: number;
  processedCount?: number;
  processedMissingCount?: number;
};

type RefreshObservabilitySource = RefreshObservabilityCounts & {
  sourceId?: string;
  sourceName?: string;
  sourceCountry?: string;
  sourceLanguage?: string;
  sourceType?: string;
  sourceCategory?: string;
  family?: string;
};

type ProcessingOutcomeCounts = {
  processed?: number;
  cancelled?: number;
  missing_payload?: number;
  candidate_missing?: number;
  candidate_invalid?: number;
  fresh_cache_exists?: number;
  stale_cache_reused?: number;
  processing_failed?: number;
};

function getArgValue(flag: string) {
  const raw = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return raw ? raw.slice(flag.length + 1) : undefined;
}

function parseNumberArg(flag: string, fallback: number) {
  const raw = getArgValue(flag);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function takeTop<T extends RefreshObservabilityCounts>(
  rows: T[],
  field: keyof RefreshObservabilityCounts,
  limit: number,
) {
  return [...rows]
    .sort((a, b) => (Number(b[field] ?? 0) - Number(a[field] ?? 0)))
    .slice(0, limit);
}

function summarizeLogs(logs: unknown[]) {
  return logs.map((entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const row = entry as Record<string, unknown>;
    return {
      at: row.at,
      message: row.message,
      data: row.data,
    };
  });
}

async function main() {
  const limit = parseNumberArg("--limit", 10);
  const job = (await listBackgroundJobs({ type: "manual_source_refresh", limit: 1 }))[0];

  if (!job) {
    console.log(JSON.stringify({ message: "No manual_source_refresh jobs found." }, null, 2));
    return;
  }

  const payload = job.payload as Record<string, unknown>;
  const observability = (payload.observability ?? {}) as Record<string, unknown>;
  const totals = (observability.totals ?? {}) as RefreshObservabilityCounts;
  const bySource = Array.isArray(observability.bySource)
    ? (observability.bySource as RefreshObservabilitySource[])
    : [];
  const byFamily = Array.isArray(observability.byFamily)
    ? (observability.byFamily as RefreshObservabilitySource[])
    : [];
  const processingOutcomeCounts = (payload.processingOutcomeCounts ?? {}) as ProcessingOutcomeCounts;
  const logs = Array.isArray(payload.logs) ? payload.logs : [];

  console.log(
    JSON.stringify(
      {
        job: {
          id: job.id,
          status: job.status,
          created_at: job.created_at,
          updated_at: job.updated_at,
          error_message: job.error_message,
        },
        phase: {
          name: payload.phase,
          label: payload.phaseLabel,
          progressPercent: payload.progressPercent,
          activeStepIndex: payload.activeStepIndex,
        },
        totals,
        processingOutcomeCounts,
        topFamiliesByRawInserted: takeTop(byFamily, "rawInsertedCount", limit),
        topFamiliesByProcessed: takeTop(byFamily, "processedCount", limit),
        topSourcesByRawInserted: takeTop(bySource, "rawInsertedCount", limit),
        topSourcesBySelected: takeTop(bySource, "selectedCount", limit),
        topSourcesByProcessed: takeTop(bySource, "processedCount", limit),
        logs: summarizeLogs(logs),
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
