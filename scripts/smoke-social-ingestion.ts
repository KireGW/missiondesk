import assert from "node:assert/strict";
import { fetchSocialSource } from "@/lib/ingestion/social";
import type { SourceDefinition } from "@/lib/types";

const originalFetch = globalThis.fetch;
const originalBearer = process.env.X_API_BEARER_TOKEN;

const xSource: SourceDefinition = {
  id: "sre-x",
  name: "SRE Mexico X",
  country: "Mexiko",
  language: "es",
  type: "website",
  sourceCategory: "government",
  retrieval: { primary: "social_api" },
  retrievalMethod: "social_api",
  platform: "x",
  sourceType: "social",
  url: "https://x.com/SRE_mx",
  trustTier: 1,
  categories: ["foreign_policy", "domestic_politics"],
  enabled: true,
};

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (url.includes("/2/users/by/username/SRE_mx")) {
    return new Response(
      JSON.stringify({
        data: { id: "2244994945", name: "SRE México", username: "SRE_mx" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  if (url.includes("/2/users/2244994945/tweets")) {
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "1900000000000000001",
            text: "Comunicado sobre visita bilateral a Washington. https://t.co/demo1",
            created_at: "2026-05-21T08:00:00.000Z",
            lang: "es",
            public_metrics: { like_count: 10, retweet_count: 2, reply_count: 1, quote_count: 0 },
          },
          {
            id: "1900000000000000002",
            text: "México participa en reunión hemisférica de seguridad. https://t.co/demo2",
            created_at: "2026-05-21T07:30:00.000Z",
            lang: "es",
            public_metrics: { like_count: 9, retweet_count: 1, reply_count: 0, quote_count: 0 },
          },
          {
            id: "1900000000000000003",
            text: "Actualización consular para connacionales en la región. https://t.co/demo3",
            created_at: "2026-05-21T07:00:00.000Z",
            lang: "es",
            public_metrics: { like_count: 8, retweet_count: 0, reply_count: 0, quote_count: 0 },
          },
          {
            id: "1900000000000000004",
            text: "Extra post that should be trimmed by MissionDesk limit.",
            created_at: "2026-05-21T06:30:00.000Z",
            lang: "es",
            public_metrics: { like_count: 1, retweet_count: 0, reply_count: 0, quote_count: 0 },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  throw new Error(`Unexpected fetch URL in smoke test: ${url}`);
}) as typeof fetch;

process.env.X_API_BEARER_TOKEN = "smoke-test-token";

const documents = await fetchSocialSource(xSource, { limit: 3, preserveRawContent: true });

assert.equal(documents.length, 3);
assert.equal(documents[0].url, "https://x.com/SRE_mx/status/1900000000000000001");
assert.equal(documents[0].publishedAt, "2026-05-21T08:00:00.000Z");
assert.equal(documents[0].metadata?.username, "SRE_mx");
assert.equal(documents[0].text?.includes("https://t.co/"), false);
assert.equal(
  documents.some((document) => document.url.endsWith("/1900000000000000004")),
  false,
);

console.info("[smoke:social] X social API adapter limits monitored accounts to three recent posts.");

globalThis.fetch = originalFetch;
if (originalBearer === undefined) {
  delete process.env.X_API_BEARER_TOKEN;
} else {
  process.env.X_API_BEARER_TOKEN = originalBearer;
}
