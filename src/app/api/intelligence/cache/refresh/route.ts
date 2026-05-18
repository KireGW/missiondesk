import { NextResponse } from "next/server";
import { enqueueDefaultBriefingJobs } from "@/lib/intelligence/briefing-worker";
import { enqueueSelectedNationalProcessingJobs } from "@/lib/intelligence/national-processing-worker";

export const dynamic = "force-dynamic";

type RefreshScope = "national" | "briefings" | "all";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    scope?: RefreshScope;
    force?: boolean;
    limit?: number;
    cacheHours?: number;
  };

  const scope = body.scope ?? "all";
  const force = body.force ?? false;
  const limit = Number.isFinite(body.limit) ? body.limit : 100;

  const nationalJobs =
    scope === "national" || scope === "all"
      ? enqueueSelectedNationalProcessingJobs({ limit, force })
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
