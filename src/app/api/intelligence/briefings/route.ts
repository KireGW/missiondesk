import { NextResponse } from "next/server";
import { earliestCacheExpiry, latestCacheTimestamp } from "@/lib/intelligence/dashboard-view";
import { listBriefings } from "@/lib/intelligence/repository";
import type { GeographicScope, ProfileMode } from "@/lib/types";

export const dynamic = "force-dynamic";

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
  const limit = Number(url.searchParams.get("limit") ?? 10);
  const onlyFresh = url.searchParams.get("fresh") !== "0";

  const briefings = await listBriefings({
    type: url.searchParams.get("type") ?? undefined,
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

  return NextResponse.json({
    briefings,
    cache: {
      itemCount: briefings.length,
      latestGeneratedAt: latestCacheTimestamp(briefings, []),
      earliestExpiresAt: earliestCacheExpiry(briefings, []),
      onlyFresh,
    },
  });
}
