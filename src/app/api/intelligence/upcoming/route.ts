import { NextResponse } from "next/server";
import { listTemporalSignals } from "@/lib/intelligence/repository";
import {
  extractTemporalSignalsFromProcessedItems,
  isTemporalExtractionConfigured,
} from "@/lib/intelligence/temporal-signals";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 30);
  const minTemporalCertainty = Number(url.searchParams.get("minTemporalCertainty") ?? 45);
  const minStrategicImportance = Number(url.searchParams.get("minStrategicImportance") ?? 65);
  const minSwedenMexicoRelevance = Number(url.searchParams.get("minSwedenMexicoRelevance") ?? 35);
  const onlyUpcoming = url.searchParams.get("upcoming") !== "0";

  const records = await listTemporalSignals({
    limit: Number.isFinite(limit) ? limit : 30,
    onlyUpcoming,
    minTemporalCertainty: Number.isFinite(minTemporalCertainty) ? minTemporalCertainty : 45,
    minStrategicImportance: Number.isFinite(minStrategicImportance) ? minStrategicImportance : 65,
    minSwedenMexicoRelevance: Number.isFinite(minSwedenMexicoRelevance)
      ? minSwedenMexicoRelevance
      : 35,
  });

  return NextResponse.json({
    signals: records,
    cache: {
      itemCount: records.length,
      generatedAt: new Date().toISOString(),
      onlyUpcoming,
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
