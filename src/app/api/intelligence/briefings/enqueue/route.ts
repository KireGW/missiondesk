import { NextResponse } from "next/server";
import {
  enqueueBriefingGenerationJob,
  enqueueDefaultBriefingJobs,
} from "@/lib/intelligence/briefing-worker";
import type { BriefingType } from "@/lib/ai/briefing-generation";
import type { GeographicScope, ProfileMode } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    type?: BriefingType;
    profile?: ProfileMode;
    geographicScope?: GeographicScope;
    region?: string;
    minItems?: number;
    maxItems?: number;
    cacheHours?: number;
    force?: boolean;
    defaults?: boolean;
  };

  const jobs = body.defaults || !body.type
    ? enqueueDefaultBriefingJobs({
        force: body.force,
        cacheHours: body.cacheHours,
      })
    : [
        enqueueBriefingGenerationJob({
          type: body.type,
          profile: body.profile,
          geographicScope: body.geographicScope,
          region: body.region,
          minItems: body.minItems,
          maxItems: body.maxItems,
          cacheHours: body.cacheHours,
          force: body.force,
        }),
      ];

  return NextResponse.json({
    enqueuedCount: jobs.length,
    jobs,
  });
}
