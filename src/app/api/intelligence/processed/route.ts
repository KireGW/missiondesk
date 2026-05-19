import { NextResponse } from "next/server";
import { earliestCacheExpiry, latestCacheTimestamp } from "@/lib/intelligence/dashboard-view";
import { signalDisplaySince } from "@/lib/intelligence/cache-policy";
import { listProcessedItems } from "@/lib/intelligence/repository";
import type { IntelligenceCategory, ProfileMode } from "@/lib/types";

export const dynamic = "force-dynamic";

const categories: IntelligenceCategory[] = [
  "economy",
  "trade",
  "domestic_politics",
  "foreign_policy",
  "sweden_connection",
  "security",
  "markets",
  "investment_climate",
  "migration",
  "society",
  "energy",
  "technology",
  "culture_soft_power",
];

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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const categoryParam = url.searchParams.get("category");
  const profileParam = url.searchParams.get("profile");
  const limit = Number(url.searchParams.get("limit") ?? 60);
  const onlyFresh = url.searchParams.get("fresh") !== "0";
  const recentDays = Number(url.searchParams.get("recentDays") ?? undefined);

  const items = await listProcessedItems({
    category: categories.includes(categoryParam as IntelligenceCategory)
      ? (categoryParam as IntelligenceCategory)
      : undefined,
    profile: profiles.includes(profileParam as ProfileMode)
      ? (profileParam as ProfileMode)
      : undefined,
    geographicTag: url.searchParams.get("geographicTag") ?? undefined,
    onlyFresh,
    publishedSince: onlyFresh ? signalDisplaySince(recentDays) : undefined,
    limit: Number.isFinite(limit) ? limit : 60,
  });

  return NextResponse.json({
    items,
    cache: {
      itemCount: items.length,
      latestProcessedAt: latestCacheTimestamp([], items),
      earliestExpiresAt: earliestCacheExpiry([], items),
      onlyFresh,
    },
  });
}
