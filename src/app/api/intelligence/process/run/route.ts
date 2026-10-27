import { NextResponse } from "next/server";
import { legacyEngineBoundary } from "@/lib/product/api-boundary";
import { runNationalProcessingWorker } from "@/lib/intelligence/national-processing-worker";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blocked = legacyEngineBoundary();
  if (blocked) return blocked;
  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    enqueueMissingJobs?: boolean;
    cacheHours?: number;
    force?: boolean;
    reprocessStale?: boolean;
  };

  const result = await runNationalProcessingWorker({
    limit: body.limit,
    enqueueMissingJobs: body.enqueueMissingJobs,
    cacheHours: body.cacheHours,
    force: body.force,
    reprocessStale: body.reprocessStale,
  });

  return NextResponse.json(result);
}
