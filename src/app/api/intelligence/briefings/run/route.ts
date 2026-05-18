import { NextResponse } from "next/server";
import { runBriefingGenerationWorker } from "@/lib/intelligence/briefing-worker";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    cacheHours?: number;
  };

  const result = await runBriefingGenerationWorker({
    limit: body.limit,
    cacheHours: body.cacheHours,
  });

  return NextResponse.json(result);
}
