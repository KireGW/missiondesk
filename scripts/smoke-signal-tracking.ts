import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import type { RawSourceItem } from "@/lib/intelligence/models";
import type { SourceDefinition } from "@/lib/types";

const sources: SourceDefinition[] = [
  { id: "news", name: "News", url: "https://index.com/news", type: "website" },
  { id: "rss", name: "RSS", url: "https://example.org/feed", type: "rss" },
  { id: "x", name: "X account", url: "https://x.com/example", type: "website", retrievalMethod: "social_api", platform: "x" },
  { id: "legacy-x", name: "Legacy X", url: "https://twitter.com/legacy", type: "website" },
  { id: "facebook", name: "Facebook", url: "https://www.facebook.com/example", type: "social" },
  { id: "future", name: "Future platform", url: "https://social.example/account", type: "rss", platform: "future-social" },
  { id: "disabled", name: "Disabled X", url: "https://x.com/disabled", type: "social", enabled: false },
].map((source) => ({
  country: "Mexiko", language: "sv", trustTier: 1, categories: ["society"], enabled: true,
  ...source,
} as SourceDefinition));

const now = new Date().toISOString();
const rawItems: RawSourceItem[] = [
  { id: "news", source_name: "News", source_type: "news", url: "https://index.com/mexico" },
  { id: "cached-x", source_name: "X account", source_type: "social", url: "https://x.com/example/status/cached" },
  { id: "orphan", source_name: "Removed account", source_type: "social", url: "https://social.example/old" },
  { id: "orphan-url", source_name: "Unknown", source_type: "news", url: "https://mobile.twitter.com/old/status/cached" },
  { id: "mislabelled", source_name: "Facebook", source_type: "news", url: "https://example.org/cached-post" },
].map((item) => ({
  title_original: `Mexico ${item.id}`, source_country: "Mexiko", source_language: "sv",
  source_priority: 90, credibility_score: 90, crawl_status: "fetched",
  created_at: now, updated_at: now, published_at: now,
  ...item,
} as RawSourceItem));

const httpCalls: string[] = [];
const webCalls: string[] = [];
const stored: RawSourceItem[] = [];
const originalFetch = globalThis.fetch;
const originalBearer = process.env.X_API_BEARER_TOKEN;

// Only fake data and mocked dependencies: no production database or paid API calls.
mock.module(new URL("../src/lib/db/postgres.ts", import.meta.url), {
  namedExports: {
    getMigratedDb: () => ({
      prepare: () => ({
        run: async () => ({}),
        get: async () => ({ variants_json: '["Mexico"]' }),
      }),
    }),
  },
});
mock.module(new URL("../src/lib/sources/store.ts", import.meta.url), {
  namedExports: { getSources: async () => sources },
});
mock.module(new URL("../src/lib/intelligence/repository.ts", import.meta.url), {
  namedExports: {
    createRawSourceItemId: ({ url }: { url: string }) => url,
    getProcessedItemByRawId: async () => null,
    getRawSourceItemById: async () => null,
    getRawSourceItemByUrl: async () => null,
    listRawSourceItems: async () => rawItems,
    upsertRawSourceItem: async (item: RawSourceItem) => { stored.push(item); return item; },
  },
});
mock.module(new URL("../src/lib/ingestion/rss.ts", import.meta.url), {
  namedExports: { fetchRssSource: async (source: SourceDefinition) => { webCalls.push(source.id); return []; } },
});
mock.module(new URL("../src/lib/ingestion/website.ts", import.meta.url), {
  namedExports: { fetchWebsiteSource: async (source: SourceDefinition) => {
    webCalls.push(source.id);
    return { documents: [], errors: [] };
  } },
});
const nextServerHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context);
  },
});

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  httpCalls.push(url.href);
  if (url.hostname === "api.x.com") {
    if (url.pathname.includes("/by/username/")) {
      return Response.json({ data: { id: url.pathname.split("/").at(-1) } });
    }
    if (url.pathname.endsWith("/tweets")) {
      const account = url.pathname.split("/")[3];
      return Response.json({ data: [{ id: account, text: `Mexico ${account}`, created_at: now }] });
    }
  }
  if (["www.facebook.com", "social.example"].includes(url.hostname)) {
    return new Response("<title>Mexico social post</title>", { headers: { "content-type": "text/html" } });
  }
  throw new Error(`Unexpected network request: ${url.origin}${url.pathname}`);
}) as typeof fetch;
process.env.X_API_BEARER_TOKEN = "fake-test-token";

try {
  const { searchSignalsAcrossSources } = await import("@/lib/intelligence/signal-tracking");
  const { POST } = await import("@/app/api/intelligence/signal-tracking/route");
  const post = async (body: object) => {
    httpCalls.length = 0;
    webCalls.length = 0;
    stored.length = 0;
    const response = await POST(new Request("http://localhost/api/intelligence/signal-tracking", {
      method: "POST", body: JSON.stringify({ query: "Mexico", aiEnabled: false, ...body }),
      headers: { "Content-Type": "application/json" },
    }));
    assert.equal(response.status, 200);
    return response.json() as ReturnType<typeof searchSignalsAcrossSources>;
  };

  for (const body of [
    {},
    { mode: "deep" },
    { mode: "deep", deepSearchOptions: { includeWebRss: true, includeSocialMedia: false } },
    { mode: "deep", deepSearchOptions: { includeSocialMedia: "false" } },
    { mode: "deep", deepSearchOptions: { includeSocialMedia: "true" } },
    { mode: "deep", deepSearchOptions: { includeSocialMedia: 1 } },
    { mode: "deep", deepSearchOptions: { includeSocialX: true } },
  ]) {
    const result = await post(body);
    assert.deepEqual(httpCalls, [], "Social HTTP requests require explicit opt-in");
    assert.deepEqual(result.results.map((item) => item.url), ["https://index.com/mexico"]);
    assert.equal(result.sourceCount, 2);
    assert.equal(result.report.xAccountsQueried, 0);
    assert.equal(result.report.estimatedApiReads, 0);
    assert.deepEqual(webCalls, "mode" in body && body.mode === "deep" ? ["news", "rss"] : []);
  }

  const optedIn = await post({ mode: "deep", deepSearchOptions: { includeWebRss: false, includeSocialMedia: true } });
  assert.deepEqual(webCalls, [], "Social opt-in does not enable web/RSS scans");
  assert.equal(httpCalls.length, 6, "Two X accounts (lookup + timeline), Facebook and future platform");
  assert.equal(optedIn.report.xAccountsQueried, 2);
  assert.equal(optedIn.report.xPostsFetched, 2);
  assert.equal(stored.length, 4);
  assert.ok(stored.every((item) => item.source_type === "social"));
  assert.equal(optedIn.errors.length, 0);
  assert.ok(optedIn.results.some((item) => item.url === "https://social.example/old"));
  assert.ok(!httpCalls.some((url) => url.includes("disabled")));

  const localOptIn = await post({ mode: "local", deepSearchOptions: { includeSocialMedia: true } });
  assert.equal(localOptIn.resultCount, rawItems.length);
  assert.deepEqual(httpCalls, [], "Local mode never fetches social accounts");

  const afterOptOut = await post({ mode: "deep", deepSearchOptions: { includeWebRss: false, includeSocialMedia: false } });
  assert.deepEqual(httpCalls, []);
  assert.deepEqual(webCalls, []);
  assert.equal(afterOptOut.resultCount, 1);
  console.info("[smoke:signal-tracking] 10 scenarios passed: social API requests and cached hits require explicit opt-in.");
} finally {
  globalThis.fetch = originalFetch;
  if (originalBearer === undefined) delete process.env.X_API_BEARER_TOKEN;
  else process.env.X_API_BEARER_TOKEN = originalBearer;
  nextServerHook.deregister();
  mock.restoreAll();
}
