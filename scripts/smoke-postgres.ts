import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

const { closeDb } = await import("../src/lib/db/postgres");
const {
  getMigratedDb,
} = await import("../src/lib/db/postgres");
const {
  listBriefings,
  listProcessedItems,
  listRankedCandidates,
  listRawSourceItems,
  getBriefingById,
  getProcessedItemByRawId,
  getRankedCandidateByRawId,
  getRawSourceItemById,
  upsertBriefing,
  upsertProcessedItem,
  upsertRankedCandidate,
  upsertRawSourceItem,
} = await import("../src/lib/intelligence/repository");
const { getSources } = await import("../src/lib/sources/store");

const db = getMigratedDb();
const testId = `missiondesk-smoke-${Date.now()}`;
const now = new Date().toISOString();
const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

try {
  await upsertRawSourceItem({
    id: testId,
    source_type: "news",
    title_original: "MissionDesk smoke test source item",
    url: `https://example.com/missiondesk-smoke/${testId}`,
    source_name: "MissionDesk Smoke",
    source_country: "Sweden",
    source_language: "en",
    published_at: now,
    detected_country: "Mexico",
    snippet: "Temporary smoke test record.",
    raw_content: "Temporary smoke test record.",
    source_priority: 100,
    credibility_score: 100,
    crawl_status: "fetched",
  });

  await upsertRankedCandidate({
    raw_source_item_id: testId,
    rank_score: 100,
    selection_status: "selected",
    selection_reason: "Smoke test candidate",
    freshness_score: 100,
    source_priority_score: 100,
    credibility_score: 100,
    keyword_relevance_score: 100,
    diplomatic_relevance_score: 100,
    sweden_relevance_score: 100,
    geographic_relevance_score: 100,
    category_relevance_score: 100,
    novelty_score: 100,
    cross_source_confirmation_score: 0,
    ranking_version: "smoke-test",
    ranked_at: now,
  });

  await upsertProcessedItem({
    raw_source_item_id: testId,
    title_sv: "MissionDesk smoke-test",
    summary_sv: "Tillfällig verifiering av Postgres-lagring.",
    category: "foreign_policy",
    urgency_score: 50,
    diplomatic_relevance_score: 50,
    sweden_relevance_score: 50,
    economic_impact_score: 0,
    security_impact_score: 0,
    geographic_scope: "national",
    geographic_tags: ["Mexico"],
    why_it_may_matter_sv: "Verifierar att processade signaler kan sparas och läsas.",
    profile_tags: ["daily_overview"],
    processed_model: "smoke-test",
    processed_at: now,
    cache_expires_at: expiresAt,
  });

  await upsertBriefing({
    id: testId,
    type: "smoke_test",
    profile: "daily_overview",
    geographic_scope: "national",
    content_sv: "Tillfällig smoke-briefing.",
    source_item_ids: [testId],
    generated_model: "smoke-test",
    generated_at: now,
    cache_expires_at: expiresAt,
  });

  const sources = await getSources();
  const rawItems = await listRawSourceItems({ limit: 5 });
  const ranked = await listRankedCandidates({ limit: 5 });
  const processed = await listProcessedItems({ onlyFresh: false, limit: 5 });
  const briefings = await listBriefings({ onlyFresh: false, limit: 5 });
  const smokeRaw = Boolean(await getRawSourceItemById(testId));
  const smokeRanked = Boolean(await getRankedCandidateByRawId(testId));
  const smokeProcessed = Boolean(await getProcessedItemByRawId(testId));
  const smokeBriefing = Boolean(await getBriefingById(testId));

  console.log(
    JSON.stringify(
      {
        sources: sources.length,
        rawItems: rawItems.length,
        rankedCandidates: ranked.length,
        processedItems: processed.length,
        briefings: briefings.length,
        repositoryWriteRead: {
          raw: smokeRaw,
          rankedCandidate: smokeRanked,
          processedItem: smokeProcessed,
          briefing: smokeBriefing,
        },
        rankingOrderPreserved: ranked.every(
          (record, index) =>
            index === 0 || ranked[index - 1].candidate.rank_score >= record.candidate.rank_score,
        ),
        topProcessedTitles: processed.map((record) => record.processed.title_sv),
      },
      null,
      2,
    ),
  );
} finally {
  await db.prepare("DELETE FROM briefings WHERE id = ?").run(testId);
  await db.prepare("DELETE FROM processed_items WHERE raw_source_item_id = ?").run(testId);
  await db.prepare("DELETE FROM ranked_processing_candidates WHERE raw_source_item_id = ?").run(testId);
  await db.prepare("DELETE FROM raw_source_items WHERE id = ?").run(testId);

  await closeDb();
}
