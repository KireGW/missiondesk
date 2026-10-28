import assert from "node:assert/strict";
import { mock } from "node:test";
import type { IntelligenceItem } from "../src/lib/types";
import { defaultPersonalPreferences, interfaceLanguagesForProfile, parsePersonalPreferences, personalCategory, personalContent, personalRelevance, personalStations, type PersonalPreferences } from "../src/lib/product/profiles";
import { personalDate, personalMessages } from "../src/lib/product/messages";
import type { Pool } from "pg";

assert.equal(defaultPersonalPreferences.language,"en","New personal profiles must default to an English interface");
assert.equal(defaultPersonalPreferences.contentLanguage,"sv","The UI default must not change the separate signal-text setting");
const norwegian = { homeCountry: "NO", targetCountry: "MX", language: "nb", contentLanguage: "original" } as const;
assert.deepEqual(parsePersonalPreferences(norwegian), norwegian);
assert.deepEqual(parsePersonalPreferences({ ...norwegian, language: "sv" }), { ...norwegian, language: "sv" });
for (const value of [null, [], {}, { ...norwegian, plan: "premium" }, { ...norwegian, accountId: "other" },
  { ...norwegian, targetCountry: "US" }, { ...norwegian, language: "de" }, { ...norwegian, language: ["en"] }, { ...norwegian, homeCountry: "DE" },
  { ...norwegian, contentLanguage: "nb" }, { ...norwegian, contentLanguage: "en" },
  { homeCountry: "NO", targetCountry: "MX", language: "nb" }]) {
  assert.equal(parsePersonalPreferences(value), null);
}
const item = {
  id: "fixture", title_original: "México anuncia medidas comerciales", original_excerpt: "Medidas para la economía mexicana.",
  title_sv: "Sverige och Mexiko", summary_sv: "En svensk sammanfattning med Sverigekoppling.",
  source_language: "es", category: "trade", economic_impact_score: 80, security_impact_score: 20,
  urgency_score: 50, public_attention_score: 60, diplomatic_relevance_score: 99, sweden_relevance_score: 99,
} as IntelligenceItem;
const baseline = personalRelevance(item, norwegian);
assert.equal(baseline.homeConnection, false, "Swedish AI text is not source evidence for Norway");
assert.deepEqual(personalRelevance({ ...item, sweden_relevance_score: 0, diplomatic_relevance_score: 0 }, norwegian), baseline,
  "Norwegian relevance cannot reuse Swedish or embassy-specific scores");
const norwayItem = { ...item, title_original: "Noruega y México anuncian un acuerdo comercial" };
assert.equal(personalRelevance(norwayItem, norwegian).homeConnection, true);
assert.ok(personalRelevance(norwayItem, norwegian).score > baseline.score);
assert.equal(personalRelevance(norwayItem, defaultPersonalPreferences).homeConnection, false);
assert.equal(personalRelevance({ ...item, title_original: "Suecia y México" }, defaultPersonalPreferences).homeConnection, true);
assert.equal(personalRelevance({ ...item, title_original: "Noruegalandia" }, norwegian).homeConnection, false);
assert.deepEqual(personalContent(item, norwegian), { title: item.title_original, summary: item.original_excerpt, language: "es" });
assert.equal(personalContent(item, defaultPersonalPreferences).language, "sv");
assert.equal(personalContent({ ...item, title_sv: "" }, defaultPersonalPreferences).language, "es");
assert.equal(personalContent({ ...item, summary_sv: "" }, defaultPersonalPreferences).language, "es");
for (const language of ["sv", "nb", "es", "en"] as const) {
  assert.deepEqual(parsePersonalPreferences({ ...norwegian, language }), { ...norwegian, language });
  assert.deepEqual(personalContent(item, { ...norwegian, language, contentLanguage: "original" }),
    { title: item.title_original, summary: item.original_excerpt, language: "es" }, "Changing UI language must not translate original content");
  assert.deepEqual(personalContent(item, { ...norwegian, language, contentLanguage: "sv" }),
    { title: item.title_sv, summary: item.summary_sv, language: "sv" }, "Cached Swedish text can be read in either interface language");
  assert.deepEqual(personalRelevance(item, { ...norwegian, language, contentLanguage: "sv" }), baseline,
    "Neither language setting changes the monitoring perspective");
}
const oldForm = { homeCountry: "NO", targetCountry: "MX", language: "nb" };
assert.deepEqual(parsePersonalPreferences(oldForm, "sv"), { ...norwegian, contentLanguage: "sv" },
  "Older forms must retain stored content choice, not derive it from UI language");
assert.equal(personalCategory("sweden_connection"), "foreign_policy", "Do not rename old Swedish classifications as Norwegian connections");
assert.equal(personalMessages("nb").meeting, "Møteunderlag");
assert.equal(personalMessages("sv").meeting, "Mötesunderlag");
assert.equal(personalMessages("en").account, "My account");
assert.equal(personalMessages("es").account, "Mi cuenta");
assert.equal(personalMessages("en").current, "Current signals");
assert.equal(personalMessages("es").current, "Señales actuales");
assert.deepEqual(personalStations.NO, { id: "norway-mexico-city", homeCountry: "NO", countries: ["MX", "NI", "CR", "GT", "HN", "SV", "BZ"] });
assert.deepEqual(personalStations.SE, { id: "sweden-mexico-city", homeCountry: "SE", countries: ["MX"] });
assert.equal(personalMessages("en").station, "Station");
assert.equal(personalMessages("en").monitoredCountries, "Countries monitored");
assert.equal(personalMessages("en").stationNames.NO, "Embassy of Norway in Mexico City");
for (const language of ["sv", "nb", "es", "en"] as const) {
  const messages = personalMessages(language);
  assert.ok(messages.stationNames.NO);
  assert.ok(messages.stationNames.SE);
  assert.ok(messages.coverageInfo);
  for (const country of personalStations.NO.countries) assert.ok(messages.monitoredCountryNames[country]);
  assert.equal("DO" in messages.monitoredCountryNames, false, "The complete Norwegian country list excludes the Dominican Republic");
}
assert.deepEqual(interfaceLanguagesForProfile(), ["en", "sv", "nb"]);
assert.deepEqual(interfaceLanguagesForProfile("norwegian"), ["en", "nb", "es"]);
assert.match(personalDate("2026-10-27T20:12:00Z", "nb"), /14:12/);

const {getPersonalPreferences:readPreferences}=await import("../src/lib/product/preferences-store");
let storedPreferences: PersonalPreferences[]=[];
const preferencesDb={query:async(sql:string,values:unknown[])=>{
  assert.match(sql,/^SELECT /,"Reading a default or saved language must not write profile data");
  assert.deepEqual(values,["current-account"]);
  return {rows:storedPreferences};
}} as unknown as Pool;
const fallback=await readPreferences("current-account",preferencesDb);
assert.deepEqual(fallback,defaultPersonalPreferences);
fallback.language="nb";
assert.equal((await readPreferences("current-account",preferencesDb)).language,"en","Defaults must be returned as independent copies");
for(const language of ["sv","nb","es","en"] as const) {
  storedPreferences=[{...norwegian,language}];
  assert.deepEqual(await readPreferences("current-account",preferencesDb),{...norwegian,language},"Every saved language choice must override the English default");
}

let account: { id: string; status: string } | null = null;
let interfaceProfile: "standard" | "norwegian" = "standard";
const writes: Array<{ id: string; value: unknown }> = [];
mock.module(new URL("../src/lib/product/account.ts", import.meta.url), { namedExports: { getPersonalAccount: async () => account } });
mock.module(new URL("../src/lib/product/auth.ts", import.meta.url), { namedExports: {
  getPersonalSessionIdentity: async () => ({ interfaceProfile }),
} });
mock.module(new URL("../src/lib/product/preferences-store.ts", import.meta.url), { namedExports: {
  savePersonalPreferences: async (id: string, value: unknown) => { writes.push({ id, value }); return true; },
  getPersonalPreferences: async () => ({ ...norwegian, contentLanguage: "sv" }),
} });
const { PATCH } = await import("../src/app/api/personal/profile/route");
const savedMode = process.env.MISSIONDESK_ACCESS_MODE;
const savedBase = process.env.APP_BASE_URL;
const savedFetch = globalThis.fetch;
function request(body: unknown = norwegian, origin = "http://localhost:3001", type = "application/json") {
  return new Request("http://localhost:3001/api/personal/profile", {
    method: "PATCH", headers: { origin, "content-type": type }, body: JSON.stringify(body),
  });
}
try {
  globalThis.fetch = async () => { throw new Error("Changing profile languages must not call an external service"); };
  process.env.APP_BASE_URL = "http://localhost:3001";
  for (const mode of ["legacy", "invalid"]) {
    process.env.MISSIONDESK_ACCESS_MODE = mode;
    assert.equal((await PATCH(request())).status, 404);
  }
  process.env.MISSIONDESK_ACCESS_MODE = "personal";
  const unauthenticated = request();
  assert.equal((await PATCH(unauthenticated)).status, 401);
  assert.equal(unauthenticated.bodyUsed, false);
  account = { id: "session-account", status: "suspended" };
  assert.equal((await PATCH(request())).status, 403);
  account.status = "active";
  for (const origin of ["", "https://other.example", "http://localhost:3000"]) assert.equal((await PATCH(request(norwegian, origin))).status, 403);
  assert.equal((await PATCH(request(norwegian, undefined, "text/plain"))).status, 415);
  assert.equal((await PATCH(request("x".repeat(3000)))).status, 413);
  assert.equal((await PATCH(new Request("http://localhost:3001/api/personal/profile", {
    method: "PATCH", headers: { origin: "http://localhost:3001", "content-type": "application/json" }, body: "{invalid",
  }))).status, 400);
  for (const value of [{ ...norwegian, plan: "premium" }, { ...norwegian, accountId: "another-account" }, { ...norwegian, targetCountry: "US" },
    { ...norwegian, contentLanguage: "nb" }, { ...norwegian, contentLanguage: "en" }]) {
    assert.equal((await PATCH(request(value))).status, 400);
  }
  assert.equal(writes.length, 0);
  const response = await PATCH(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(writes, [{ id: "session-account", value: norwegian }]);
  assert.deepEqual(await response.json(), { preferences: norwegian });
  const mixed = { ...norwegian, contentLanguage: "sv" };
  const mixedResponse = await PATCH(request(mixed));
  assert.equal(mixedResponse.status, 200);
  assert.deepEqual(await mixedResponse.json(), { preferences: mixed });
  const legacyResponse = await PATCH(request(oldForm));
  assert.equal(legacyResponse.status, 200);
  assert.deepEqual(await legacyResponse.json(), { preferences: mixed });
  assert.deepEqual(writes.slice(1), [{ id: "session-account", value: mixed }, { id: "session-account", value: mixed }]);
  assert.equal((await PATCH(request({ ...norwegian, language:"es" }))).status,400,"Spanish remains restricted to the Norwegian interface profile");
  for(const language of ["en","sv","nb"]) {
    const updated={...norwegian,language};
    const result=await PATCH(request(updated));
    assert.equal(result.status,200);
    assert.deepEqual(await result.json(),{preferences:updated},"Standard accounts can save English or an existing language choice");
  }
  interfaceProfile = "norwegian";
  for (const language of ["nb", "es", "en"]) {
    const updated = { ...norwegian, language };
    const result = await PATCH(request(updated));
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { preferences: updated });
  }
  assert.equal((await PATCH(request({ ...norwegian, language: "sv" }))).status, 400, "Daniel cannot reintroduce Swedish via the API");
  assert.equal((await PATCH(request({ ...norwegian, language: "sv", interfaceProfile: "standard" }))).status, 400);
  const writesBeforeStationChanges = writes.length;
  const changedStation = await PATCH(request({ ...norwegian, language: "en", homeCountry: "SE" }));
  assert.equal(changedStation.status, 400, "Station is not editable via the profile API");
  assert.deepEqual(await changedStation.json(), { error: "station_read_only" });
  for (const extra of [
    { station: "sweden-mexico-city" }, { countries: ["MX"] },
    { monitoredCountries: ["MX"] }, { targetCountries: ["MX", "GT"] },
  ]) assert.equal((await PATCH(request({ ...norwegian, ...extra }))).status, 400);
  assert.equal((await PATCH(request({ ...norwegian, targetCountry: "GT" }))).status, 400);
  assert.equal(writes.length, writesBeforeStationChanges, "Rejected station and country changes must not be persisted");
} finally {
  globalThis.fetch = savedFetch;
  if (savedMode === undefined) delete process.env.MISSIONDESK_ACCESS_MODE; else process.env.MISSIONDESK_ACCESS_MODE = savedMode;
  if (savedBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = savedBase;
  mock.restoreAll();
}
console.log("[smoke:personal-profiles] Independent UI/content languages, fixed stations/country lists, legacy form preservation, honest fallbacks, profile validation, session ownership, CSRF and payload limits passed; no external calls.");
