import { NextResponse } from "next/server";
import { enqueueSelectedNationalProcessingJobs } from "@/lib/intelligence/national-processing-worker";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    force?: boolean;
    reprocessStale?: boolean;
  };
  const jobs = await enqueueSelectedNationalProcessingJobs({
    limit: body.limit ?? 100,
    force: body.force ?? false,
    reprocessStale: body.reprocessStale ?? false,
  });

  return NextResponse.json({
    enqueuedCount: jobs.length,
    jobs,
  });
}
