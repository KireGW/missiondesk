import assert from "node:assert/strict";
import { auditSource, sourceWithAuditMetadata } from "../src/lib/sources/audit";
import { fetchRssSource } from "../src/lib/ingestion/rss";
import {
  auditRssQualityForSource,
  shouldAuditRssQuality,
  sourceWithRssQualityMetadata,
} from "../src/lib/sources/rss-quality";
import type { SourceDefinition } from "../src/lib/types";

function source(patch: Partial<SourceDefinition>): SourceDefinition {
  return {
    ...patch,
    id: patch.id ?? "test-source",
    name: patch.name ?? "Test source",
    country: patch.country ?? "Mexiko",
    language: patch.language ?? "es",
    type: patch.type ?? "website",
    url: patch.url ?? "https://example.com",
    trustTier: patch.trustTier ?? 2,
    categories: patch.categories ?? ["domestic_politics"],
    enabled: patch.enabled ?? true,
  };
}

async function smokeRssParser() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>Mexico announces new trade measure</title>
            <link>https://example.com/news/trade</link>
            <pubDate>Tue, 19 May 2026 12:00:00 GMT</pubDate>
            <description>Short description.</description>
          </item>
        </channel>
      </rss>`,
      { status: 200, headers: { "content-type": "application/rss+xml" } },
    )) as typeof fetch;

  try {
    const docs = await fetchRssSource(source({ type: "rss", url: "https://example.com/rss.xml" }));
    assert.equal(docs.length, 1);
    assert.equal(docs[0].title, "Mexico announces new trade measure");
    assert.equal(docs[0].url, "https://example.com/news/trade");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function smokeRssQualityAudit() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://example.com/politica") {
      return new Response(
        `<html><head><link rel="alternate" type="application/rss+xml" href="/feed.xml" /></head></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      );
    }

    if (url === "https://example.com/feed.xml") {
      return new Response(
        `<?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <item>
              <title>Mexico announces new energy measure</title>
              <link>https://example.com/news/energy</link>
              <pubDate>${new Date().toUTCString()}</pubDate>
              <description>Short description.</description>
            </item>
            <item>
              <title>Mexico publishes trade update</title>
              <link>https://example.com/news/trade</link>
              <pubDate>${new Date().toUTCString()}</pubDate>
              <description>Short description.</description>
            </item>
            <item>
              <title>Mexico updates investment rules</title>
              <link>https://example.com/news/investment</link>
              <pubDate>${new Date().toUTCString()}</pubDate>
              <description>Short description.</description>
            </item>
          </channel>
        </rss>`,
        { status: 200, headers: { "content-type": "application/rss+xml" } },
      );
    }

    return new Response("", { status: 404 });
  }) as typeof fetch;

  try {
    const websiteSource = source({
      name: "Example Politics",
      type: "website",
      url: "https://example.com/politica",
      retrieval: { primary: "website" },
      retrievalMethod: "website",
    });
    const result = await auditRssQualityForSource(websiteSource);
    assert.equal(result.status, "recommended");
    assert.equal(result.shouldPromoteToPrimary, true);

    const promoted = sourceWithRssQualityMetadata(websiteSource, result);
    assert.equal(promoted.retrieval?.primary, "rss");
    assert.equal(promoted.retrieval?.fallback, "website");
    assert.equal(promoted.retrievalMethod, "rss");
    assert.equal(promoted.rssUrl, "https://example.com/feed.xml");
    assert.equal(promoted.websiteUrl, "https://example.com/politica");

    const socialSource = source({
      name: "SRE Mexico X",
      type: "website",
      url: "https://x.com/SRE_mx",
      retrieval: { primary: "social_api" },
      retrievalMethod: "social_api",
    });
    assert.equal(shouldAuditRssQuality(socialSource).audit, false);
    const socialResult = await auditRssQualityForSource(socialSource);
    assert.equal(socialResult.skipped, true);
    const unchangedSocialSource = sourceWithRssQualityMetadata(socialSource, socialResult);
    assert.deepEqual(unchangedSocialSource, socialSource);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function smokeAuditRules() {
  assert.equal(
    auditSource(source({ url: "https://x.com/SRE_mx", type: "website" })).detectedType,
    "official_social_account",
  );
  assert.equal(
    auditSource(source({ url: "https://www.bloomberg.com/quote/USDMXN:CUR" })).detectedType,
    "market_reference_page",
  );
  assert.equal(
    auditSource(source({ url: "https://www.gob.mx/sre/prensa", type: "website" })).detectedType,
    "government_page",
  );
  assert.equal(
    auditSource(source({ url: "https://example.com/feed.xml", type: "website" })).detectedType,
    "rss_feed",
  );
  assert.equal(
    auditSource(source({ url: "https://example.com/politica", type: "website" })).detectedType,
    "website",
  );
  assert.deepEqual(
    {
      category: auditSource(
        source({
          url: "https://www.gob.mx/sre/feed.xml",
          type: "rss",
          sourceType: "government",
        }),
      ).currentCategory,
      retrieval: auditSource(
        source({
          url: "https://www.gob.mx/sre/feed.xml",
          type: "rss",
          sourceType: "government",
        }),
      ).currentRetrievalMethod,
    },
    { category: "government", retrieval: "rss" },
  );
  assert.deepEqual(
    {
      category: auditSource(
        source({
          name: "Reuters Mexico",
          url: "https://example.com/reuters.xml",
          type: "rss",
          sourceType: "news",
        }),
      ).currentCategory,
      retrieval: auditSource(
        source({
          name: "Reuters Mexico",
          url: "https://example.com/reuters.xml",
          type: "rss",
          sourceType: "news",
        }),
      ).currentRetrievalMethod,
    },
    { category: "media", retrieval: "rss" },
  );
  const socialAudit = auditSource(
    source({
      name: "SRE Mexico X",
      url: "https://x.com/SRE_mx",
      type: "website",
      sourceType: "social",
    }),
  );
  assert.equal(socialAudit.currentCategory, "government");
  assert.equal(socialAudit.recommendedCategory, "government");
  assert.equal(socialAudit.recommendedRetrievalMethod, "social_api");
  assert.equal(socialAudit.recommendedPlatform, "x");

  const migratedSocialSource = sourceWithAuditMetadata(
    source({
      name: "SRE Mexico X",
      url: "https://x.com/SRE_mx",
      type: "website",
      sourceType: "social",
      sourceCategory: "website",
      retrievalMethod: "website",
    }),
  );
  assert.equal(migratedSocialSource.sourceCategory, "government");
  assert.equal(migratedSocialSource.retrievalMethod, "social_api");
  assert.deepEqual(migratedSocialSource.retrieval, { primary: "social_api" });
  assert.equal(migratedSocialSource.platform, "x");
  assert.equal(migratedSocialSource.auditReviewState, "confirmed");

  const migratedRssSource = sourceWithAuditMetadata(
    source({
      name: "Reuters Mexico",
      url: "https://example.com/reuters.xml",
      type: "rss",
      sourceType: "news",
    }),
  );
  assert.equal(migratedRssSource.retrievalMethod, "rss");
  assert.deepEqual(migratedRssSource.retrieval, {
    primary: "rss",
    fallback: "website",
  });

  const promotedWebsiteWithRss = auditSource(
    source({
      name: "Instituto Nacional Electoral",
      url: "https://centralelectoral.ine.mx/",
      websiteUrl: "https://centralelectoral.ine.mx/",
      rssUrl: "https://centralelectoral.ine.mx/feed/",
      sourceType: "government",
      sourceCategory: "government",
      retrieval: { primary: "rss", fallback: "website" },
      retrievalMethod: "rss",
    }),
  );
  assert.equal(promotedWebsiteWithRss.detectedType, "rss_feed");
  assert.equal(promotedWebsiteWithRss.currentRetrievalMethod, "rss");
  assert.equal(promotedWebsiteWithRss.recommendedRetrievalMethod, "rss");
  assert.deepEqual(promotedWebsiteWithRss.issues, []);
}

async function main() {
  smokeAuditRules();
  await smokeRssParser();
  await smokeRssQualityAudit();
  console.log("Source audit smoke check passed.");
}

void main();
