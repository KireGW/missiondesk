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
  getIngestionUpdateState,
  listBackgroundJobs,
  updateIngestionUpdateState,
  updateBackgroundJobPayload,
} from "@/lib/intelligence/repository";
import { rankAndStoreCandidates } from "@/lib/intelligence/ranking";
import { ingestRawSourceItems } from "@/lib/ingestion/raw-source-ingestion";
import { getSources } from "@/lib/sources/store";
import type { BackgroundJob } from "@/lib/intelligence/models";

export const dynamic = "force-dynamic";

type RefreshScope = "national" | "briefings" | "all";

const manualRefreshJobType = "manual_source_refresh";
const STALE_MANUAL_REFRESH_MS = 15 * 60 * 1000;
const refreshSteps = [
  "Skannar verifierade källor…",
  "Deduplicerar och prioriterar nya poster…",
  "Bearbetar nya relevanta signaler…",
  "Uppdaterar briefing vid behov…",
];

let manualRefreshInFlight: Promise<unknown> | null = null;

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

async function statusFromRefreshJob(job: BackgroundJob | undefined) {
  const state = await getIngestionUpdateState();
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
  return updateBackgroundJobPayload(jobId, {
    phase,
    phaseLabel: refreshSteps[activeStepIndex] ?? phase,
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

async function runManualFullRescan(options: {
  jobId: string;
  limit: number;
  cacheHours?: number;
  limitPerSource?: number;
}) {
  const startedAt = new Date().toISOString();
  const previousState = await getIngestionUpdateState();
  const since = previousState?.last_ingested_at ?? undefined;
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
  });

  await logManualRefresh(options.jobId, "source rescan finished", {
    sourceCount: ingestion.sourceCount,
    fetchedCount: ingestion.fetchedCount,
    storedCount: ingestion.storedCount,
    skippedCount: ingestion.skippedCount,
    errorCount: ingestion.errors.length,
    since,
  });
  await updateManualRefreshPhase(options.jobId, "ingesting_sources", 34, 0, {
    sourceCount: ingestion.sourceCount,
    fetchedCount: ingestion.fetchedCount,
    rawInsertedCount: ingestion.storedCount,
    skippedCount: ingestion.skippedCount,
    ingestionErrorCount: ingestion.errors.length,
  });

  const newRawSourceItemIds = ingestion.results.flatMap((result) =>
    result.items.map((item) => item.id),
  );

  if (newRawSourceItemIds.length === 0) {
    const completedAt = new Date().toISOString();
    await logManualRefresh(options.jobId, "no newly discovered source items; ranking and AI skipped");
    await updateManualRefreshPhase(options.jobId, "completed", 100, 3, {
      processedCount: 0,
      completedAt,
      lastIngestedAt: completedAt,
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
  });
  await updateManualRefreshPhase(options.jobId, "ranking_candidates", 58, 1, {
    scannedCount: ranking.scannedCount,
    selectedCount: ranking.selectedCount,
    candidateCount: ranking.candidateCount,
    regionalHoldCount: ranking.regionalHoldCount,
  });

  const processingJobs = await enqueueSelectedNationalProcessingJobs({
    limit: options.limit,
    force: false,
    reprocessStale: false,
    rawSourceItemIds: newRawSourceItemIds,
  });
  await logManualRefresh(options.jobId, "national processing jobs queued", {
    count: processingJobs.length,
  });
  await updateManualRefreshPhase(options.jobId, "processing_items", 68, 2, {
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
    await logManualRefresh(options.jobId, "national processing batch finished", {
      batch: batch + 1,
      claimedCount: result.claimedCount,
      processedCount: result.processedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
    });
    await updateManualRefreshPhase(options.jobId, "processing_items", 78, 2, {
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
    const completedAt = new Date().toISOString();
    await logManualRefresh(options.jobId, "no new processed items; briefing regeneration skipped");
    await updateManualRefreshPhase(options.jobId, "completed", 100, 3, {
      processedCount,
      completedAt,
      lastIngestedAt: completedAt,
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

  await updateManualRefreshPhase(options.jobId, "generating_briefings", 84, 3, {
    processedCount,
  });
  const briefingJobs = await enqueueDefaultBriefingJobs({
    force: true,
    cacheHours: options.cacheHours,
  });
  await logManualRefresh(options.jobId, "briefing jobs queued", {
    count: briefingJobs.length,
  });

  let generatedCount = 0;
  for (let batch = 0; batch < 10; batch += 1) {
    const result = await runBriefingGenerationWorker({ limit: 5 });
    generatedCount += result.generatedCount;
    await logManualRefresh(options.jobId, "briefing batch finished", {
      batch: batch + 1,
      claimedCount: result.claimedCount,
      generatedCount: result.generatedCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
    });
    if (result.claimedCount === 0) break;
  }

  const completedAt = new Date().toISOString();
  await updateManualRefreshPhase(options.jobId, "completed", 100, 3, {
    processedCount,
    briefingGeneratedCount: generatedCount,
    completedAt,
    lastIngestedAt: completedAt,
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
    generatedCount,
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
      await completeBackgroundJob(job.id);
    } catch (error) {
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
  };

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
