import assert from "node:assert/strict";
import { swedenMexicoEmbassyConfig as config } from "../src/lib/config/embassies/sweden-mexico";
import { getMissionRelevanceScore } from "../src/lib/intelligence/relevance-score";
import { matchesConfiguredSourceScope } from "../src/lib/sources/content-scope";
import { defaultSources } from "../src/lib/sources/default-sources";
import { fetchWebsiteSource } from "../src/lib/ingestion/website";
import { fetchRssSource } from "../src/lib/ingestion/rss";
import { detectGeography } from "../src/lib/ingestion/geography";
import { rankRawSourceItems } from "../src/lib/intelligence/ranking";
import { processNationalSourceItemWithOpenAI } from "../src/lib/ai/national-processing";
import { processRegionalSourceItemWithOpenAI } from "../src/lib/ai/regional-processing";
import { assertSignalScoreScale, signalScoreProperties } from "../src/lib/ai/signal-scoring";
import { compactResponseSettings } from "../src/lib/ai/model-settings";
import { contentKindForRaw, referenceYearForRaw } from "../src/lib/intelligence/content-kind";
import type { IntelligenceItem } from "../src/lib/types";
import type { RawSourceItem } from "../src/lib/intelligence/models";

const item: IntelligenceItem = {
  id: "test", title_original: "Mexico introduces new national trade rules", title_sv: "Mexiko inför nya handelsregler",
  summary_sv: "Nya handelsregler påverkar exporten i Mexiko.", source_name: "Test", source_url: "https://example.com/mexico",
  source_country: "Mexiko", source_language: "sv", published_at: new Date().toISOString(),
  category: "trade", country: "Mexiko", region: "Nationellt", subregion: "news", geographic_scope: "national", geographic_tags: [],
  urgency_score: 50, diplomatic_relevance_score: 85, sweden_relevance_score: 0,
  economic_impact_score: 90, security_impact_score: 0, public_attention_score: 0,
  profile_tags: ["daily_overview", "trade_business"], why_it_matters_sv: "Ändrade exportvillkor.",
  suggested_talking_points_sv: [], original_excerpt: "New rules for Mexico's exporters.",
};
assert(getMissionRelevanceScore(item, config, "daily_overview") >= 70);
assert(getMissionRelevanceScore(item, config, "trade_business") >= 75);
assert.equal(getMissionRelevanceScore({ ...item, public_attention_score: 100 }, config, "daily_overview"), getMissionRelevanceScore(item, config, "daily_overview"));
assert(getMissionRelevanceScore({ ...item, urgency_score: 7, diplomatic_relevance_score: 7, economic_impact_score: 8 }, config, "daily_overview") < 15);
const foreign = { ...item, title_original: "German housing policy", title_sv: "Tyska bostadsregler",
  summary_sv: "Tyska bostadsregler ändras.", original_excerpt: "German housing policy changes.",
  country: "Mexiko", region: "Mexiko", source_name: "Business Sweden Mexico", source_country: "Sverige",
};
assert(getMissionRelevanceScore(foreign, config, "daily_overview") <= 44);
assert.equal(detectGeography("AMX reports its results", config).detectedCountry, undefined);
assert.equal(detectGeography("Mexico publishes a policy update", config).detectedCountry, "Mexiko");

const business = defaultSources.find((s) => s.id === "business-sweden-mexico")!;
const raw: RawSourceItem = {
  id: "raw", source_type: "institution", title_original: "Germany fiscal policy", url: "https://www.business-sweden.com/insights/articles/germany-fiscal-policy/",
  source_name: business.name, source_country: "Sverige", source_language: "sv", published_at: new Date().toISOString(),
  detected_country: "Mexiko", snippet: "Germany changes its fiscal policy.", source_priority: 90, credibility_score: 95,
  crawl_status: "fetched", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
};
assert.equal(matchesConfiguredSourceScope(raw), false);
assert.equal(contentKindForRaw({ ...raw, published_at: undefined, title_original: "Mexico Business Climate Survey 2024" }), "reference");
assert.equal(referenceYearForRaw({ title_original: "Mexico Business Climate Survey 2024", url: "https://example.com/report-2024" }), 2024);
assert.equal(contentKindForRaw({ ...raw, title_original: "Mexico publishes a new report today" }), "news");
assert.equal(rankRawSourceItems([raw]).length, 0);
const ordinary = rankRawSourceItems([{ ...raw, source_name: "Test News", source_type: "news", title_original: "Una noticia que comenta cambios", snippet: "Una noticia corriente.", url: "https://example.com/ordinary" }])[0];
assert.equal(ordinary.diplomatic_relevance_score, 0);
assert.equal(ordinary.category_relevance_score, 0);
assert(matchesConfiguredSourceScope({ ...raw, title_original: "Mexico Business Climate Survey", url: "https://www.business-sweden.com/insights/reports/mexico/" }));
assert.equal(compactResponseSettings("gpt-6-luna", 800).reasoning?.effort, "low");
assert.equal(compactResponseSettings("gpt-5-mini", 800).reasoning?.effort, "minimal");
assert.equal(compactResponseSettings("gpt-4o-mini", 800).reasoning, undefined);

const savedFetch = globalThis.fetch;
const savedKey = process.env.OPENAI_API_KEY;
const savedModel = process.env.MISSIONDESK_PROCESSING_MODEL;
const savedRegionalModel = process.env.MISSIONDESK_REGIONAL_MODEL;
try {
  globalThis.fetch = async () => new Response("<html>Not a feed</html>", { status: 200 });
  await assert.rejects(fetchRssSource(business), /no feed items/);
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /\n");
    if (url === business.url) return new Response(`<a href="/insights/articles/germany-fiscal-policy/">Germany fiscal foundations and national policy update</a><a href="/insights/reports/mexico-business-climate/">Mexico Business Climate Survey</a>`);
    if (url.endsWith("/mexico-business-climate/")) return new Response(`<meta property="og:title" content="Mexico Business Climate Survey"/><meta name="description" content="Swedish companies report on Mexico's business climate."/>`);
    throw new Error(`Unexpected request ${url}`);
  };
  const fetched = await fetchWebsiteSource(business, { limit: 1 });
  assert.equal(fetched.documents.length, 1);
  assert.match(fetched.documents[0].title, /Mexico/);
  assert(!requests.some((url) => url.includes("germany-fiscal")));
  const legacyStoredSource = { ...business, contentKeywords: undefined };
  assert.equal((await fetchWebsiteSource(legacyStoredSource, { limit: 1 })).documents[0].title, "Mexico Business Climate Survey");

  process.env.OPENAI_API_KEY = "test-only-not-a-real-key";
  process.env.MISSIONDESK_PROCESSING_MODEL = "gpt-6-luna";
  process.env.MISSIONDESK_REGIONAL_MODEL = "gpt-6-luna";
  const analysis = {
    score_scale: "0-100", title_sv: "Mexiko inför nya handelsregler", summary_sv: "Nya handelsregler påverkar exporten i Mexiko.",
    category: "trade", urgency_score: 50, diplomatic_relevance_score: 85, sweden_relevance_score: 10,
    economic_impact_score: 90, security_impact_score: 0, geographic_scope: "national", geographic_tags: ["Tyskland", "jalisco"],
    profile_tags: ["trade_business"], why_it_may_matter_sv: "Reglerna ändrar villkoren för export till Mexiko.", event_date: null,
  };
  assertSignalScoreScale(analysis);
  assert.throws(() => assertSignalScoreScale({ ...analysis, score_scale: "0-10" }));
  assert.throws(() => assertSignalScoreScale({ ...analysis, diplomatic_relevance_score: 101 }));
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gpt-6-luna");
    assert.equal(body.reasoning.effort, "low");
    assert(body.max_output_tokens >= 2000);
    assert.equal(body.store, false);
    for (const key of Object.keys(signalScoreProperties)) assert.equal(body.text.format.schema.properties[key].maximum, 100);
    assert.deepEqual(body.text.format.schema.properties.score_scale.enum, ["0-100"]);
    return Response.json({ output_text: JSON.stringify(analysis) });
  };
  const processed = await processNationalSourceItemWithOpenAI({ ...raw, title_original: item.title_original });
  assert.equal(processed?.diplomatic_relevance_score, 85);
  assert.deepEqual(processed?.geographic_tags, ["jalisco"]);
  const regional = await processRegionalSourceItemWithOpenAI({ raw, regionLabel: "Jalisco", requiredGeographicTags: ["jalisco"] });
  assert.deepEqual(regional?.geographic_tags, ["jalisco"]);
} finally {
  globalThis.fetch = savedFetch;
  for (const [key, value] of Object.entries({ OPENAI_API_KEY: savedKey, MISSIONDESK_PROCESSING_MODEL: savedModel, MISSIONDESK_REGIONAL_MODEL: savedRegionalModel })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
console.info("[smoke:mission] Mission relevance, country scope and AI score contract checks passed.");
