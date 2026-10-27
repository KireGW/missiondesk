import { unstable_cache } from "next/cache";
import { getReadOnlyDb, type MissionDeskDb } from "@/lib/db/postgres";
import { defaultSources } from "@/lib/sources/default-sources";
import { listProcessedItems } from "@/lib/intelligence/repository";
import { latestCacheTimestamp, processedRecordsToIntelligenceItems } from "@/lib/intelligence/dashboard-view";
import { productPlans, type PlanId } from "@/lib/product/plans";
import type { PersonalFeed } from "@/lib/product/feed";
import { mexicoPublication } from "@/lib/product/profiles";

// Explicit public-news publication set, not a copy of every source in the engine.
export const personalFeedSourceIds = mexicoPublication.sourceIds;

export async function readPersonalFeed(planId: PlanId, db: MissionDeskDb = getReadOnlyDb()): Promise<PersonalFeed> {
  const plan = productPlans[planId];
  const sources = defaultSources.filter((source) => personalFeedSourceIds.some((id) => id === source.id));
  const since = new Date(Date.now() - plan.archiveDays * 86_400_000).toISOString();
  const countryNames = mexicoPublication.countryAliases;
  const allowed = await db.prepare(`
    SELECT r.id FROM processed_items p
    JOIN raw_source_items r ON r.id = p.raw_source_item_id
    WHERE r.source_type = 'news'
      AND r.source_name IN (${sources.map(() => "?").join(", ")})
      AND COALESCE(r.published_at, '') >= ?
      AND LOWER(COALESCE(NULLIF(r.detected_country, ''), r.source_country)) IN (${countryNames.map(() => "?").join(", ")})
    ORDER BY r.published_at DESC, r.id ASC LIMIT ?
  `).all(...sources.map((source) => source.name), since, ...countryNames, plan.feedLimit);
  const ids = allowed.map((row) => String(row.id));
  // An empty ID filter in the legacy repository means "all"; never pass one through.
  const records = ids.length
    ? await listProcessedItems({ rawSourceItemIds: ids, onlyFresh: false, limit: plan.feedLimit }, db)
    : [];
  const safeRecords = records.filter((record) => {
    const source = sources.find((candidate) => candidate.name === record.raw.source_name);
    if (!source || record.raw.source_type !== "news") return false;
    try {
      const url = new URL(record.raw.url);
      const sourceUrl = new URL(source.websiteUrl ?? source.url);
      const allowedHosts = source.id === "bbc-latin-america"
        ? ["www.bbc.com", "www.bbc.co.uk", sourceUrl.hostname]
        : [sourceUrl.hostname];
      return url.protocol === "https:" && allowedHosts.includes(url.hostname) && !url.username && !url.password;
    } catch {
      return false;
    }
  });
  const updatedAt = latestCacheTimestamp([], safeRecords);
  return {
    items: processedRecordsToIntelligenceItems(safeRecords).slice(0, plan.feedLimit),
    // Existing global briefings can mix paid social or unapproved sources. Do not publish them here.
    briefings: [],
    activeSourceCount: sources.length,
    updatedAt,
    updates: { signalsProcessedAt: updatedAt },
  };
}

// Only the public publication set is shared. Never put sessions, account data or queries in this cache.
export const getPersonalFeed = unstable_cache(readPersonalFeed, ["personal-public-feed-v1"], {
  revalidate: 900,
});
