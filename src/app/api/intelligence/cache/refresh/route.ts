import { NextResponse } from "next/server";
import {
  enqueueDefaultBriefingJobs,
  runBriefingGenerationWorker,
} from "@/lib/intelligence/briefing-worker";
import {
  enqueueSelectedNationalProcessingJobs,
  runNationalProcessingWorker,
} from "@/lib/intelligence/national-processing-worker";
import { isNationalProcessingConfigured } from "@/lib/ai/national-processing";
import {
  claimBackgroundJobs,
  completeBackgroundJob,
  enqueueBackgroundJob,
  failBackgroundJob,
  getBackgroundJobById,
  listBackgroundJobs,
  updateBackgroundJobPayload,
} from "@/lib/intelligence/repository";
import { rankAndStoreCandidates } from "@/lib/intelligence/ranking";
import { ingestRawSourceItems } from "@/lib/ingestion/raw-source-ingestion";
import { getSourcesSync } from "@/lib/sources/store";
import type { BackgroundJob } from "@/lib/intelligence/models";

export const dynamic = "force-dynamic";

type RefreshScope = "national" | "briefings" | "all";

const manualRefreshJobType = "manual_source_refresh";
const refreshSteps = [
  "Skannar verifierade källor…",
  "Deduplicerar och prioriterar nya poster…",
  "Bearbetar nya relevanta signaler…",
  "Uppdaterar briefing vid behov…",
];

let manualRefreshInFlight: Promise<unknown> | null = null;

function activeManualRefreshJob() {
  return listBackgroundJobs({ type: manualRefreshJobType, limit: 10 }).find((job) =>
    ["pending", "running"].includes(job.status),
  );
}

function latestManualRefreshJob() {
  return listBackgroundJobs({ type: manualRefreshJobType, limit: 1 })[0];
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

function statusFromRefreshJob(job: BackgroundJob | undefined) {
  const active = Boolean(job && ["pending", "running"].includes(job.status));
  const progressPercent =
    job?.status === "completed" ? 100 : payloadNumber(job, "progressPercent", active ? 8 : 0);
  const message =
    job?.status === "failed"
      ? (job.error_message ?? "Uppdateringen misslyckades.")
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
  };
}

function updateManualRefreshPhase(
  jobId: string,
  phase: string,
  progressPercent: number,
  activeStepIndex: number,
  extra: Record<string, unknown> = {},
) {
  return updateBackgroundJobPayload(jobId, {
    phase,
    phaseLabel: refreshSteps[activeStepIndex] ?? phase,
    progressPercent,
    activeStepIndex,
    ...extra,
  });
}

function logManualRefresh(jobId: string, message: string, data?: Record<string, unknown>) {
  const current = getBackgroundJobById(jobId);
  const logs = payloadLogs(current);
  updateBackgroundJobPayload(jobId, {
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

async function runManualFullRescan(options: {
  jobId: string;
  limit: number;
  cacheHours?: number;
  limitPerSource?: number;
}) {
  logManualRefresh(options.jobId, "manual source rescan started");
  updateManualRefreshPhase(options.jobId, "ingesting_sources", 12, 0);

  const ingestion = await ingestRawSourceItems({
    limitPerSource: options.limitPerSource ?? 12,
    concurrency: 4,
    preserveRawContent: true,
  });

  logManualRefresh(options.jobId, "source rescan finished", {
    sourceCount: ingestion.sourceCount,
    fetchedCount: ingestion.fetchedCount,
    storedCount: ingestion.storedCount,
    skippedCount: ingestion.skippedCount,
    errorCount: ingestion.errors.length,
  });
  updateManualRefreshPhase(options.jobId, "ingesting_sources", 34, 0, {
    sourceCount: ingestion.sourceCount,
    fetchedCount: ingestion.fetchedCount,
    rawInsertedCount: ingestion.storedCount,
    skippedCount: ingestion.skippedCount,
    ingestionErrorCount: ingestion.errors.length,
  });

  updateManualRefreshPhase(options.jobId, "ranking_candidates", 46, 1);
  const ranking = await rankAndStoreCandidates({
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

  logManualRefresh(options.jobId, "ranking finished", {
    scannedCount: ranking.scannedCount,
    selectedCount: ranking.selectedCount,
    candidateCount: ranking.candidateCount,
    regionalHoldCount: ranking.regionalHoldCount,
  });
  updateManualRefreshPhase(options.jobId, "ranking_candidates", 58, 1, {
    scannedCount: ranking.scannedCount,
    selectedCount: ranking.selectedCount,
    candidateCount: ranking.candidateCount,
    regionalHoldCount: ranking.regionalHoldCount,
  });

  const processingJobs = enqueueSelectedNationalProcessingJobs({
    limit: options.limit,
    force: false,
    reprocessStale: false,
  });
  logManualRefresh(options.jobId, "national processing jobs queued", {
    count: processingJobs.length,
  });
  updateManualRefreshPhase(options.jobId, "processing_items", 68, 2, {
    processingJobs: processingJobs.length,
  });

  let processedCount = 0;
  let processingFailedCount = 0;
  const processingErrors: string[] = [];
  for (let batch = 0; batch < 20; batch += 1) {
    const result = await runNationalProcessingWorker({
      limit: 12,
      force: false,
    });
    processedCount += result.processedCount;
    processingFailedCount += result.failedCount;
    processingErrors.push(...result.errors.map((error) => error.message));
    logManualRefresh(options.jobId, "national processing batch finished", {
      batch: batch + 1,
      claimedCount: result.claimedCount,
      processedCount: result.processedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
    });
    updateManualRefreshPhase(options.jobId, "processing_items", 78, 2, {
      processedCount,
      processingFailedCount,
    });
    if (result.claimedCount === 0) break;
  }

  if (processedCount === 0 && processingFailedCount > 0) {
    throw new Error(
      processingErrors[0] ??
        "AI-bearbetningen misslyckades innan några nya signaler kunde skapas.",
    );
  }

  if (processedCount === 0) {
    logManualRefresh(options.jobId, "no new processed items; briefing regeneration skipped");
    updateManualRefreshPhase(options.jobId, "completed", 100, 3, {
      processedCount,
      completedAt: new Date().toISOString(),
    });
    logManualRefresh(options.jobId, "manual source rescan completed");
    return;
  }

  updateManualRefreshPhase(options.jobId, "generating_briefings", 84, 3, {
    processedCount,
  });
  const briefingJobs = enqueueDefaultBriefingJobs({
    force: true,
    cacheHours: options.cacheHours,
  });
  logManualRefresh(options.jobId, "briefing jobs queued", {
    count: briefingJobs.length,
  });

  let generatedCount = 0;
  for (let batch = 0; batch < 10; batch += 1) {
    const result = await runBriefingGenerationWorker({ limit: 5 });
    generatedCount += result.generatedCount;
    logManualRefresh(options.jobId, "briefing batch finished", {
      batch: batch + 1,
      claimedCount: result.claimedCount,
      generatedCount: result.generatedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
    });
    if (result.claimedCount === 0) break;
  }

  updateManualRefreshPhase(options.jobId, "completed", 100, 3, {
    processedCount,
    briefingGeneratedCount: generatedCount,
    completedAt: new Date().toISOString(),
  });
  logManualRefresh(options.jobId, "manual source rescan completed", {
    processedCount,
    generatedCount,
  });
}

async function runManualRefreshWorker(limit = 1) {
  const jobs = claimBackgroundJobs({ type: manualRefreshJobType, limit });

  for (const job of jobs) {
    try {
      await runManualFullRescan({
        jobId: job.id,
        limit: payloadNumber(job, "limit", 100),
        cacheHours: payloadOptionalNumber(job, "cacheHours"),
        limitPerSource: payloadNumber(job, "limitPerSource", 12),
      });
      completeBackgroundJob(job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Okänt uppdateringsfel";
      logManualRefresh(job.id, "manual source rescan failed", { error: message });
      failBackgroundJob(job.id, message);
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
  return NextResponse.json(statusFromRefreshJob(latestManualRefreshJob()));
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
  };

  const scope = body.scope ?? "all";
  const force = body.force ?? false;
  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 100;
  const rescanSources = body.rescanSources ?? false;

  if (rescanSources) {
    const activeSourceCount = getSourcesSync().filter((source) => source.enabled).length;
    if (activeSourceCount === 0) {
      return NextResponse.json(
        { error: "Inga källor är konfigurerade ännu." },
        { status: 400 },
      );
    }

    if (!isNationalProcessingConfigured()) {
      return NextResponse.json(
        { error: "Kan inte bearbeta källor: OPENAI_API_KEY saknas." },
        { status: 400 },
      );
    }

    const activeJob = activeManualRefreshJob();
    if (activeJob) {
      startManualRefreshWorkerInBackground();
      return NextResponse.json({
        ...statusFromRefreshJob(activeJob),
        started: false,
        alreadyRunning: true,
      });
    }

    const job = enqueueBackgroundJob({
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
        logs: [],
      },
    });

    const started = startManualRefreshWorkerInBackground();

    return NextResponse.json({
      ...statusFromRefreshJob(job),
      started,
      alreadyRunning: false,
    });
  }

  const nationalJobs =
    scope === "national" || scope === "all"
      ? enqueueSelectedNationalProcessingJobs({
          limit,
          force,
          reprocessStale: body.reprocessStale ?? false,
        })
      : [];
  const briefingJobs =
    scope === "briefings" || scope === "all"
      ? enqueueDefaultBriefingJobs({ force, cacheHours: body.cacheHours })
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
