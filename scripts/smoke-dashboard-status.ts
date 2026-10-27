import assert from "node:assert/strict";
import { mock } from "node:test";
import type { MissionDeskDb } from "@/lib/db/postgres";
import type { SourceDefinition } from "@/lib/types";
import type { IngestibleSourceDefinition } from "@/lib/ingestion/types";
import {
  formatUpdateTimestamp, isSourceCheckFresh, REFRESH_RECEIPT_MS,
  showRefreshReceipt, SOURCE_FRESHNESS_MS, latestDashboardUpdateAt,
} from "@/lib/intelligence/dashboard-status";
import { getDashboardUpdateStatus, recordSourcesCheckedAt } from "@/lib/intelligence/dashboard-status-store";

const checkedAt = "2026-10-27T14:12:00.000Z";
const processedAt = "2026-10-27T14:59:06.871Z";
const generatedAt = "2026-10-27T14:59:42.671Z";
const now = Date.parse("2026-10-27T15:33:00.000Z");
const queryCalls: Array<{ sql: string; params: unknown[] }> = [];
const writes: Array<{ sql: string; params: unknown[] }> = [];
let row: Record<string, string | null> | undefined = {
  sources_checked_at: checkedAt,
  signals_processed_at: "2026-10-27 14:59:06.871+00",
  briefings_generated_at: generatedAt,
  refresh_completed_at: checkedAt,
  processed_count: "60",
  new_source_item_count: "511",
};
const db: MissionDeskDb = {
  prepare: (sql) => ({
    get: async (...params) => {
      queryCalls.push({ sql, params });
      return row as never;
    },
    all: async () => [],
    run: async (...params) => { writes.push({ sql, params }); },
  }),
  exec: async () => { throw new Error("Status reads must not run migrations or jobs"); },
};

const status = await getDashboardUpdateStatus(db);
assert.equal(status.sourcesCheckedAt, checkedAt);
assert.equal(status.signalsProcessedAt, processedAt);
assert.equal(status.briefingsGeneratedAt, generatedAt);
assert.equal(latestDashboardUpdateAt(status), generatedAt);
assert.equal(latestDashboardUpdateAt({ sourcesCheckedAt: checkedAt, signalsProcessedAt: processedAt }), processedAt);
assert.equal(latestDashboardUpdateAt({ sourcesCheckedAt: checkedAt }), checkedAt);
assert.equal(latestDashboardUpdateAt({ sourcesCheckedAt: "invalid", signalsProcessedAt: processedAt }), processedAt);
assert.equal(latestDashboardUpdateAt({}), undefined);
assert.deepEqual(status.lastRefresh, { completedAt: checkedAt, processedCount: 60, newSourceItemCount: 511 });
assert.equal(queryCalls.length, 1);
assert.equal(writes.length, 0, "Reading status must never update freshness or start work");
assert.match(queryCalls[0].sql, /MAX\(NULLIF\(processed_at/);
assert.match(queryCalls[0].sql, /MAX\(NULLIF\(generated_at/);
assert.match(queryCalls[0].sql, /status = 'completed'/);
assert.ok(!queryCalls[0].sql.includes("raw_content"), "Status transfers timestamps and counts, not article bodies");

// A later revision changes processing, never the source-check time.
row!.signals_processed_at = "2026-10-27T16:15:00.000Z";
const revised = await getDashboardUpdateStatus(db);
assert.equal(revised.sourcesCheckedAt, checkedAt);
assert.equal(revised.signalsProcessedAt, row!.signals_processed_at);
assert.equal(latestDashboardUpdateAt(revised), row!.signals_processed_at);
assert.equal(revised.lastRefresh?.processedCount, 60, "The previous run remains dated history, not the revision's count");

assert.equal(isSourceCheckFresh(checkedAt, now), true);
assert.equal(isSourceCheckFresh(checkedAt, Date.parse(checkedAt) + SOURCE_FRESHNESS_MS - 1), true);
assert.equal(isSourceCheckFresh(checkedAt, Date.parse(checkedAt) + SOURCE_FRESHNESS_MS), false);
assert.equal(isSourceCheckFresh(undefined, now), false);
assert.equal(isSourceCheckFresh("invalid", now), false);
assert.equal(isSourceCheckFresh(new Date(now + 60_000).toISOString(), now), false);
assert.equal(isSourceCheckFresh(checkedAt, now + SOURCE_FRESHNESS_MS), false);
assert.equal(showRefreshReceipt(checkedAt, now), false, "Reloading cannot resurrect an old receipt");
assert.equal(showRefreshReceipt(checkedAt, Date.parse(checkedAt)), true);
assert.equal(showRefreshReceipt(checkedAt, Date.parse(checkedAt) + REFRESH_RECEIPT_MS - 1), true);
assert.equal(showRefreshReceipt(checkedAt, Date.parse(checkedAt) + REFRESH_RECEIPT_MS), false);
assert.equal(showRefreshReceipt(undefined, now), false);
assert.equal(showRefreshReceipt("invalid", now), false);
assert.equal(showRefreshReceipt(new Date(now + 1).toISOString(), now), false);

const originalTimezone = process.env.TZ;
try {
  process.env.TZ = "Europe/Stockholm";
  assert.match(formatUpdateTimestamp(checkedAt), /08:12/);
  assert.match(formatUpdateTimestamp(processedAt), /08:59/);
  assert.equal(formatUpdateTimestamp(undefined), "Ej registrerat");
  assert.equal(formatUpdateTimestamp("invalid"), "Ej registrerat");
} finally {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}

await recordSourcesCheckedAt(processedAt, db);
assert.deepEqual(writes[0].params, ["source-check", processedAt, processedAt]);
assert.match(writes[0].sql, /ON CONFLICT\(id\) DO UPDATE/);
assert.match(writes[0].sql, /last_ingested_at::timestamptz < excluded.last_ingested_at::timestamptz/);
await assert.rejects(recordSourcesCheckedAt("invalid", db), /Invalid source-check/);
assert.equal(writes.length, 1);

row = undefined;
assert.deepEqual(await getDashboardUpdateStatus(db), {
  sourcesCheckedAt: undefined, signalsProcessedAt: undefined,
  briefingsGeneratedAt: undefined, lastRefresh: undefined,
});
row = {
  sources_checked_at: "invalid", signals_processed_at: null, briefings_generated_at: null,
  refresh_completed_at: checkedAt, processed_count: "-1", new_source_item_count: "NaN",
};
const invalid = await getDashboardUpdateStatus(db);
assert.equal(invalid.sourcesCheckedAt, undefined);
assert.equal(invalid.lastRefresh?.processedCount, 0);
assert.equal(invalid.lastRefresh?.newSourceItemCount, 0);

const sources: IngestibleSourceDefinition[] = ["one", "two"].map((id) => ({
  id, name: id, url: `https://example.org/${id}/feed`, type: "rss",
  retrievalMethod: "rss", country: "Mexiko", language: "sv",
  trustTier: 1, categories: ["society"], enabled: true,
  sourceType: "news", sourcePriority: 90, credibilityScore: 90,
}));
let failAll = false;
let failOne = false;
const sourceChecks: string[] = [];
const fetchedSources: string[] = [];
mock.module(new URL("../src/lib/sources/store.ts", import.meta.url), {
  namedExports: { getSources: async () => sources },
});
mock.module(new URL("../src/lib/intelligence/dashboard-status-store.ts", import.meta.url), {
  namedExports: { recordSourcesCheckedAt: async (timestamp: string) => {
    assert.equal(fetchedSources.length, 2, "Record freshness only after the whole source pass");
    sourceChecks.push(timestamp);
  } },
});
mock.module(new URL("../src/lib/ingestion/registry.ts", import.meta.url), {
  namedExports: { ingestionAdapters: [{ type: "rss", fetch: async (source: SourceDefinition) => {
    fetchedSources.push(source.id);
    if (failAll || (failOne && source.id === "one")) throw new Error("Simulated source failure");
    return [];
  } }] },
});
const savedDatabaseUrl = process.env.DATABASE_URL;
const savedFetch = globalThis.fetch;
const mutedLogs = mock.method(console, "info", () => {});
delete process.env.DATABASE_URL;
globalThis.fetch = async () => { throw new Error("No live API calls are allowed in status tests"); };
try {
  const { ingestRawSourceItems } = await import("@/lib/ingestion/raw-source-ingestion");
  const reset = () => { sourceChecks.length = 0; fetchedSources.length = 0; };
  await ingestRawSourceItems();
  assert.equal(sourceChecks.length, 1, "A full check counts even when it finds no new posts");
  assert.ok(Number.isFinite(Date.parse(sourceChecks[0])));
  reset();
  await ingestRawSourceItems({ sourceIds: ["one"] });
  assert.equal(sourceChecks.length, 0, "A chunk does not refresh the entire feed");
  reset();
  await ingestRawSourceItems({ sources: [sources[0]] });
  assert.equal(sourceChecks.length, 0, "A selected-source worker does not refresh the entire feed");
  reset();
  failAll = true;
  await ingestRawSourceItems();
  assert.equal(sourceChecks.length, 0, "An entirely failed check does not mark the feed fresh");
  reset();
  failAll = false;
  failOne = true;
  await ingestRawSourceItems();
  assert.equal(sourceChecks.length, 1);
  reset();
  await ingestRawSourceItems({ sources: [] });
  assert.equal(sourceChecks.length, 0, "An empty scan does not mark the feed fresh");
} finally {
  mutedLogs.mock.restore();
  globalThis.fetch = savedFetch;
  if (savedDatabaseUrl !== undefined) process.env.DATABASE_URL = savedDatabaseUrl;
  mock.restoreAll();
}
console.info("[smoke:dashboard-status] Independent event times, Mexico City formatting, source freshness, receipt expiry and read-only summaries passed.");
