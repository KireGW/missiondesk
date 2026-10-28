import assert from "node:assert/strict";
import { defaultSources } from "../src/lib/sources/default-sources";
import { interfaceLanguagesForProfile, mexicoPublication, defaultPersonalPreferences, personalStations } from "../src/lib/product/profiles";
import { getProfileSourceCatalog, sourceCatalogPreview } from "../src/lib/product/source-catalog";

const before = JSON.stringify(defaultSources);
const swedish = getProfileSourceCatalog("SE");
const norwegian = getProfileSourceCatalog("NO");
assert.equal(swedish.sources.length, 5);
assert.equal(norwegian.sources.length, 53);
assert.notEqual(swedish.id, norwegian.id);
assert.deepEqual(norwegian.countries, [...personalStations.NO.countries]);
assert.deepEqual(swedish.countries, ["MX"]);
assert.equal(new Set(norwegian.sources.map((source) => source.id)).size, 53);
assert.deepEqual(norwegian.sources.filter((source) => source.publication === "existing").map((source) => source.id), [...mexicoPublication.sourceIds]);
assert.equal(norwegian.sources.filter((source) => source.publication === "proposed").length, 28);
for (const country of ["NI", "CR", "GT", "HN", "SV", "BZ"] as const) {
  const sources = norwegian.sources.filter((source) => source.group === country);
  assert.equal(sources.length, 3, `${country} must have three public proposals`);
  assert.ok(sources.some((source) => source.kind === "news"));
  assert.equal(sources.filter((source) => source.kind === "advisory").length, 1);
  assert.ok(sources.every((source) => source.publication === "proposed"));
  assert.equal(swedish.sources.some((source) => source.group === country), false);
}
const social = norwegian.sources.filter((source) => source.kind === "social");
assert.equal(social.length, 20);
assert.equal(norwegian.sources.filter((source) => source.publication === "premium_locked").length, 20);
assert.ok(social.every((source) => source.publication === "premium_locked" && source.group === "social"));
assert.equal(swedish.sources.some((source) => source.kind === "social"), false, "Norwegian Premium proposals must not change the Swedish catalog");
const handles = social.map((source) => {
  const url = new URL(source.url);
  assert.ok(["x.com", "twitter.com"].includes(url.hostname));
  return url.pathname.slice(1).toLowerCase();
});
assert.equal(new Set(handles).size, 20, "The existing embassy account must not be duplicated");
assert.deepEqual(handles.sort(), [
  "Claudiashein", "m_ebrard", "OHarfuch", "r_velascoa", "ClaraBrugadaM", "samuel_garcias", "MaraLezama",
  "rocionahle", "salomonj", "BArevalodeLeon", "JohnBricenoBZE", "CRcancilleria", "CancilleriaHN", "CancilleriaSV",
  "CIDH", "JozefSikela", "MarosSefcovic", "UEenMexico", "EspenBarthEide", "NoruegaMexCA",
].map((handle) => handle.toLowerCase()).sort(), "Exactly the 20 approved accounts must appear");
for (const source of norwegian.sources) {
  const url = new URL(source.url);
  assert.equal(url.protocol, "https:");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  for (const language of ["sv", "nb", "es", "en"] as const) assert.ok(source.purpose[language] && source.review[language]);
  assert.equal("enabled" in source, false, "A proposal must not become an executable engine source");
  if (source.group !== "baseline") {
    assert.ok(source.id.startsWith("no-"));
    assert.notEqual(source.publication, "existing", "Norwegian proposals must not appear as live ingestion");
  }
}
for (const id of ["no-mx-sre", "no-mx-economy"]) assert.match(norwegian.sources.find((source) => source.id === id)!.review.sv, /403/);
const embassy = norwegian.sources.find((source) => source.id === "no-mx-embassy-news")!;
assert.equal(embassy.reviewedOn, "2026-10-28");
for (const language of ["sv", "nb", "es", "en"] as const) {
  assert.match(embassy.review[language], /HTTP 403/);
  assert.match(embassy.review[language], /RSS.*Atom/);
}
assert.match(embassy.review.en, /no signals are imported/);
assert.equal(embassy.discoveredFeedUrl, undefined, "An official page link does not establish a working feed");
assert.match(norwegian.sources.find((source) => source.id === "no-mx-ud-news")!.review.sv, /kalenderposter/);
assert.equal(norwegian.sources.find((source) => source.id === "no-mx-ssb-trade")!.kind, "reference");
assert.equal(norwegian.sources.find((source) => source.id === "no-mx-efta")!.kind, "reference");
assert.equal(norwegian.sources.find((source) => source.id === "no-mx-ud-advisory")!.kind, "advisory");
assert.deepEqual(sourceCatalogPreview(defaultPersonalPreferences, {}), { home: "SE", language: "sv" });
assert.deepEqual(sourceCatalogPreview(defaultPersonalPreferences, { home: "NO", lang: "nb" }), { home: "SE", language: "nb" },
  "A URL must not switch a Swedish account to another source profile");
assert.deepEqual(sourceCatalogPreview(defaultPersonalPreferences, { home: "https://evil.example", lang: "unknown" }), { home: "SE", language: "sv" });
const daniel = { ...defaultPersonalPreferences, homeCountry: "NO" as const, language: "nb" as const, contentLanguage: "original" as const };
for (const lang of ["nb", "es", "en"]) {
  assert.deepEqual(sourceCatalogPreview(daniel, { lang }, interfaceLanguagesForProfile("norwegian")), { home: "NO", language: lang });
  assert.deepEqual(sourceCatalogPreview(daniel, { home: "SE", lang }, interfaceLanguagesForProfile("norwegian")), { home: "NO", language: lang },
    "Daniel's source profile must remain Norwegian in every interface language");
}
assert.deepEqual(sourceCatalogPreview(daniel, { lang: "sv" }, interfaceLanguagesForProfile("norwegian")), { home: "NO", language: "nb" });
norwegian.sources[0].name = "Changed preview";
norwegian.sources[0].review.sv = "Changed preview note";
assert.notEqual(getProfileSourceCatalog("SE").sources[0].name, "Changed preview");
assert.notEqual(getProfileSourceCatalog("NO").sources[0].review.sv, "Changed preview note");
const sheinbaum = social.find((source) => source.id === "no-mx-sheinbaum-x")!;
sheinbaum.review.en = "Changed social review";
assert.notEqual(social.find((source) => source.id === "no-mx-ebrard-x")!.review.en, "Changed social review");
assert.notEqual(getProfileSourceCatalog("NO").sources.find((source) => source.id === sheinbaum.id)!.review.en, "Changed social review");
assert.equal(JSON.stringify(defaultSources), before, "The existing engine source catalog must remain unchanged");
console.log("[smoke:profile-sources] Account-bound catalogs, 18 regional proposals across six countries, 20 locked social candidates, localization, review caveats and mutation isolation passed; no network or database used.");
