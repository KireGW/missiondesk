import { NextResponse } from "next/server";
import { earliestCacheExpiry, latestCacheTimestamp } from "@/lib/intelligence/dashboard-view";
import { listBackgroundJobs, listBriefings } from "@/lib/intelligence/repository";
import type { GeographicScope, ProfileMode } from "@/lib/types";

export const dynamic = "force-dynamic";
const briefingJobType = "generate_briefing";

const profiles: ProfileMode[] = [
  "daily_overview",
  "ambassador_briefing",
  "trade_business",
  "political_risk",
  "sweden_connection",
  "security",
  "weekly_summary",
  "upcoming_events",
];

const scopes: GeographicScope[] = [
  "national",
  "region",
  "administrative_division",
  "city",
  "cross_border",
  "international",
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const profileParam = url.searchParams.get("profile");
  const scopeParam = url.searchParams.get("geographicScope");
  const typeParam = url.searchParams.get("type") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? 10);
  const onlyFresh = url.searchParams.get("fresh") !== "0";

  const briefings = await listBriefings({
    type: typeParam,
    profile: profiles.includes(profileParam as ProfileMode)
      ? (profileParam as ProfileMode)
      : undefined,
    geographicScope: scopes.includes(scopeParam as GeographicScope)
      ? (scopeParam as GeographicScope)
      : undefined,
    region: url.searchParams.get("region") ?? undefined,
    onlyFresh,
    limit: Number.isFinite(limit) ? limit : 10,
  });

  const backgroundJobs = (await listBackgroundJobs({ type: briefingJobType, limit: 25 })).filter((job) => {
    if (!["pending", "running"].includes(job.status)) return false;
    if (!typeParam) return true;
    return job.payload.type === typeParam;
  });
  const runningCount = backgroundJobs.filter((job) => job.status === "running").length;
  const queuedCount = backgroundJobs.filter((job) => job.status === "pending").length;

  return NextResponse.json({
    briefings,
    cache: {
      itemCount: briefings.length,
      latestGeneratedAt: latestCacheTimestamp(briefings, []),
      earliestExpiresAt: earliestCacheExpiry(briefings, []),
      onlyFresh,
    },
    background: {
      active: backgroundJobs.length > 0,
      runningCount,
      queuedCount,
      message:
        runningCount > 0
          ? "Briefing uppdateras i bakgrunden."
          : queuedCount > 0
            ? "Briefing köad för bakgrundsuppdatering."
            : "",
    },
  });
}
