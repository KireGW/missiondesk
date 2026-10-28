import assert from "node:assert/strict";
import { defaultSources } from "../src/lib/sources/default-sources";
import { mexicoPublication, defaultPersonalPreferences } from "../src/lib/product/profiles";
import { getProfileSourceCatalog, sourceCatalogPreview } from "../src/lib/product/source-catalog";

const before = JSON.stringify(defaultSources);
const swedish = getProfileSourceCatalog("SE");
const norwegian = getProfileSourceCatalog("NO");
assert.equal(swedish.sources.length, 5);
assert.equal(norwegian.sources.length, 16);
assert.notEqual(swedish.id, norwegian.id);
assert.equal(norwegian.targetCountry, "MX");
assert.equal(new Set(norwegian.sources.map((source) => source.id)).size, 16);
assert.deepEqual(norwegian.sources.filter((source) => source.publication === "existing").map((source) => source.id), [...mexicoPublication.sourceIds]);
assert.equal(norwegian.sources.filter((source) => source.publication === "proposed").length, 10);
assert.equal(norwegian.sources.filter((source) => source.publication === "premium_locked").length, 1);
assert.equal(norwegian.sources.find((source) => source.kind === "social")?.publication, "premium_locked");
for (const source of norwegian.sources) {
  const url = new URL(source.url);
  assert.equal(url.protocol, "https:");
  assert.equal(url.username, "");
  assert.equal(url.password, "");
  assert.ok(source.purpose.sv && source.purpose.nb && source.review.sv && source.review.nb);
  assert.equal("enabled" in source, false, "A proposal must not become an executable engine source");
  if (source.group !== "baseline") {
    assert.ok(source.id.startsWith("no-mx-"));
    assert.notEqual(source.publication, "existing", "Norwegian proposals must not appear as live ingestion");
  }
}
for (const id of ["no-mx-sre", "no-mx-economy"]) assert.match(norwegian.sources.find((source) => source.id === id)!.review.sv, /403/);
assert.match(norwegian.sources.find((source) => source.id === "no-mx-ud-news")!.review.sv, /kalenderposter/);
assert.equal(norwegian.sources.find((source) => source.id === "no-mx-ssb-trade")!.kind, "reference");
assert.equal(norwegian.sources.find((source) => source.id === "no-mx-efta")!.kind, "reference");
assert.equal(norwegian.sources.find((source) => source.id === "no-mx-ud-advisory")!.kind, "advisory");
assert.deepEqual(sourceCatalogPreview(defaultPersonalPreferences, {}), { home: "SE", language: "sv" });
assert.deepEqual(sourceCatalogPreview(defaultPersonalPreferences, { home: "NO", lang: "nb" }), { home: "NO", language: "nb" });
assert.deepEqual(sourceCatalogPreview(defaultPersonalPreferences, { home: "https://evil.example", lang: "unknown" }), { home: "SE", language: "sv" });
norwegian.sources[0].name = "Changed preview";
norwegian.sources[0].review.sv = "Changed preview note";
assert.notEqual(getProfileSourceCatalog("SE").sources[0].name, "Changed preview");
assert.notEqual(getProfileSourceCatalog("NO").sources[0].review.sv, "Changed preview note");
assert.equal(JSON.stringify(defaultSources), before, "The existing engine source catalog must remain unchanged");
console.log("[smoke:profile-sources] Separate catalogs, 5 shared publication sources, 10 proposals, locked social candidate, review caveats and mutation isolation passed; no network or database used.");
