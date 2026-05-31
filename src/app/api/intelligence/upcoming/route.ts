import { NextResponse } from "next/server";
import { listBackgroundJobs, listTemporalSignals } from "@/lib/intelligence/repository";
import {
  extractTemporalSignalsFromProcessedItems,
  isTemporalExtractionConfigured,
} from "@/lib/intelligence/temporal-signals";
import type { TemporalSignalRecord } from "@/lib/intelligence/models";
import { temporalSyncJobType } from "@/lib/intelligence/temporal-sync-worker";
import { detectSwedenMexicoRelevance } from "@/lib/intelligence/sweden-relevance";

export const dynamic = "force-dynamic";

function isMissionDeskUpcomingRelevant(record: TemporalSignalRecord) {
  const relevance = detectSwedenMexicoRelevance(record.raw);
  if (
    relevance.isSwedishSource &&
    relevance.mexicanEntities.length === 0 &&
    relevance.crossRegionalScore < 35
  ) {
    return false;
  }

  return true;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 30);
  const minTemporalCertainty = Number(url.searchParams.get("minTemporalCertainty") ?? 45);
  const minStrategicImportance = Number(url.searchParams.get("minStrategicImportance") ?? 65);
  const minSwedenMexicoRelevance = Number(url.searchParams.get("minSwedenMexicoRelevance") ?? 35);
  const onlyUpcoming = url.searchParams.get("upcoming") !== "0";

  const records = (await listTemporalSignals({
    limit: Number.isFinite(limit) ? limit : 30,
    onlyUpcoming,
    minTemporalCertainty: Number.isFinite(minTemporalCertainty) ? minTemporalCertainty : 45,
    minStrategicImportance: Number.isFinite(minStrategicImportance) ? minStrategicImportance : 65,
    minSwedenMexicoRelevance: Number.isFinite(minSwedenMexicoRelevance)
      ? minSwedenMexicoRelevance
      : 35,
  }))
    .filter(isMissionDeskUpcomingRelevant)
    .slice(0, Number.isFinite(limit) ? limit : 30);

  const backgroundJobs = (await listBackgroundJobs({ type: temporalSyncJobType, limit: 50 })).filter((job) =>
    ["pending", "running"].includes(job.status),
  );
  const runningCount = backgroundJobs.filter((job) => job.status === "running").length;
  const queuedCount = backgroundJobs.filter((job) => job.status === "pending").length;

  return NextResponse.json({
    signals: records,
    cache: {
      itemCount: records.length,
      generatedAt: new Date().toISOString(),
      onlyUpcoming,
    },
    background: {
      active: backgroundJobs.length > 0,
      runningCount,
      queuedCount,
      message:
        runningCount > 0
          ? "Framåtblick uppdateras i bakgrunden."
          : queuedCount > 0
            ? "Framåtblick köad för bakgrundsuppdatering."
            : "",
    },
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    scanLimit?: number;
    attemptLimit?: number;
    minStrategicImportance?: number;
  };

  if (!isTemporalExtractionConfigured()) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is required for temporal extraction." },
      { status: 400 },
    );
  }

  const result = await extractTemporalSignalsFromProcessedItems({
    scanLimit: body.scanLimit,
    attemptLimit: body.attemptLimit,
    minStrategicImportance: body.minStrategicImportance,
  });

  return NextResponse.json(result);
}
