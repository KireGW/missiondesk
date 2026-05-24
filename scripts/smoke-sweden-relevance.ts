import assert from "node:assert/strict";
import { rankRawSourceItems } from "../src/lib/intelligence/ranking";
import { detectSwedenMexicoRelevance } from "../src/lib/intelligence/sweden-relevance";
import type { RawSourceItem, SourceIntelligenceType } from "../src/lib/intelligence/models";

function item({
  title,
  snippet,
  sourceName = "Example Source",
  sourceCountry = "Internationell",
  sourceLanguage = "en",
  sourceType = "news",
  publishedAt = "2026-05-24T10:00:00.000Z",
  detectedCountry,
  url = "https://example.com/story",
  sourcePriority = 82,
  credibilityScore = 90,
}: {
  title: string;
  snippet?: string;
  sourceName?: string;
  sourceCountry?: string;
  sourceLanguage?: string;
  sourceType?: SourceIntelligenceType;
  publishedAt?: string;
  detectedCountry?: string;
  url?: string;
  sourcePriority?: number;
  credibilityScore?: number;
}): RawSourceItem {
  return {
    id: title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32),
    source_type: sourceType,
    title_original: title,
    url,
    source_name: sourceName,
    source_country: sourceCountry,
    source_language: sourceLanguage,
    published_at: publishedAt,
    detected_country: detectedCountry,
    detected_region: undefined,
    detected_city: undefined,
    snippet,
    raw_content: undefined,
    source_priority: sourcePriority,
    credibility_score: credibilityScore,
    crawl_status: "fetched",
    created_at: "2026-05-24T10:00:00.000Z",
    updated_at: "2026-05-24T10:00:00.000Z",
  };
}

const ericssonIndia = detectSwedenMexicoRelevance(
  item({
    title: "Ericsson signs 5G network deal in India",
    snippet: "The telecom contract expands foreign 5G infrastructure exposure.",
  }),
);
assert.equal(ericssonIndia.swedenRelevanceLevel, "high");
assert(ericssonIndia.swedishEntities.includes("Ericsson"));

const saabPoland = detectSwedenMexicoRelevance(
  item({
    title: "Saab wins defence contract in Poland",
    snippet: "The aerospace and defence procurement deal comes amid NATO security concerns.",
  }),
);
assert.equal(saabPoland.swedenRelevanceLevel, "high");
assert(saabPoland.swedishEntities.includes("Saab"));

const balticRussia = detectSwedenMexicoRelevance(
  item({
    title: "Russia increases GPS jamming near Finland and the Baltic Sea",
    snippet: "NATO members investigate air navigation disruptions and undersea cable risks.",
  }),
);
assert.equal(balticRussia.swedenRelevanceLevel, "high");

const volvoMexico = detectSwedenMexicoRelevance(
  item({
    title: "Volvo expands manufacturing in Monterrey",
    snippet: "The automotive investment strengthens Mexican nearshoring supply chains.",
    detectedCountry: "Mexiko",
  }),
);
assert.equal(volvoMexico.mexicoCrossRelevanceLevel, "high");
assert(volvoMexico.swedishEntities.includes("Volvo"));
assert(volvoMexico.mexicanEntities.includes("Monterrey"));

const swedishMediaMexico = item({
  title: "Mexiko skärper säkerheten inför valet",
  snippet: "Svensk rapportering beskriver organiserad brottslighet och politisk risk.",
  sourceName: "Dagens Nyheter Varlden",
  sourceCountry: "Sverige",
  sourceLanguage: "sv",
  detectedCountry: "Mexiko",
});
const swedishMediaMexicoSignal = detectSwedenMexicoRelevance(swedishMediaMexico);
assert.equal(swedishMediaMexicoSignal.mexicoCrossRelevanceLevel, "medium");
assert(swedishMediaMexicoSignal.reasons.includes("swedish_media_mentions_mexico"));

const staticTravelAdvice = detectSwedenMexicoRelevance(
  item({
    title: "Reseinformation Mexiko",
    snippet: "Generell information om Mexiko för svenska medborgare.",
    sourceName: "Sweden Abroad Mexico reseinformation",
    sourceCountry: "Sverige",
    sourceLanguage: "sv",
    sourceType: "advisory",
    publishedAt: "",
    detectedCountry: "Mexiko",
    url: "https://www.swedenabroad.se/sv/om-utlandet-for-svenska-medborgare/mexiko/",
  }),
);
assert(["none", "low"].includes(staticTravelAdvice.mexicoCrossRelevanceLevel));
assert(staticTravelAdvice.reasons.includes("static_swedish_institutional_page_capped"));

const genericMexicanEnergy = item({
  title: "Pemex and CFE face new energy reform debate",
  snippet: "Mexico's government weighs regulation, investment and electricity market changes.",
  sourceName: "El Financiero",
  sourceCountry: "Mexiko",
  sourceLanguage: "es",
  detectedCountry: "Mexiko",
});
const rankedGenericMexico = rankRawSourceItems([genericMexicanEnergy], [], { scanLimit: 200 })[0];
assert(rankedGenericMexico.rank_score >= 50);
assert.notEqual(rankedGenericMexico.selection_status, "rejected");

const rankedSwedishMediaMexico = rankRawSourceItems([swedishMediaMexico], [], { scanLimit: 200 })[0];
assert(rankedSwedishMediaMexico.sweden_relevance_score >= 50);
assert(rankedSwedishMediaMexico.selection_reason.includes("swedish_media_mentions_mexico"));
assert.notEqual(rankedSwedishMediaMexico.selection_status, "rejected");

const nordicBrand = detectSwedenMexicoRelevance(
  item({
    title: "Nordic Ware launches new pan in the US",
    snippet: "A kitchenware brand expands retail distribution.",
  }),
);
assert.equal(nordicBrand.swedenRelevanceLevel, "none");
assert(nordicBrand.falsePositiveFlags.includes("uncontextual_nordic"));
const rankedNordicBrand = rankRawSourceItems([
  item({
    title: "Nordic Ware launches new pan in the US",
    snippet: "A kitchenware brand expands retail distribution.",
    sourcePriority: 60,
    credibilityScore: 70,
  }),
], [], { scanLimit: 200 })[0];
assert.equal(rankedNordicBrand.sweden_relevance_score, 0);

const stockholmSyndrome = detectSwedenMexicoRelevance(
  item({
    title: "Markets show Stockholm syndrome after rate decision",
    snippet: "Analysts used the phrase metaphorically.",
  }),
);
assert.equal(stockholmSyndrome.swedenRelevanceLevel, "none");
assert(stockholmSyndrome.falsePositiveFlags.includes("stockholm_syndrome_metaphor"));

console.info("[smoke:sweden-relevance] Sweden and Sweden-Mexico relevance checks passed.");
