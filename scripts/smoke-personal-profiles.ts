import assert from "node:assert/strict";
import { mock } from "node:test";
import type { IntelligenceItem } from "../src/lib/types";
import { defaultPersonalPreferences, parsePersonalPreferences, personalCategory, personalContent, personalRelevance } from "../src/lib/product/profiles";
import { personalDate, personalMessages } from "../src/lib/product/messages";

const norwegian = { homeCountry: "NO", targetCountry: "MX", language: "nb" } as const;
assert.deepEqual(parsePersonalPreferences(norwegian), norwegian);
assert.deepEqual(parsePersonalPreferences({ ...norwegian, language: "sv" }), { ...norwegian, language: "sv" });
for (const value of [null, [], {}, { ...norwegian, plan: "premium" }, { ...norwegian, accountId: "other" },
  { ...norwegian, targetCountry: "US" }, { ...norwegian, language: "en" }, { ...norwegian, homeCountry: "DE" }]) {
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
assert.equal(personalCategory("sweden_connection"), "foreign_policy", "Do not rename old Swedish classifications as Norwegian connections");
assert.equal(personalMessages("nb").meeting, "Møteunderlag");
assert.equal(personalMessages("sv").meeting, "Mötesunderlag");
assert.match(personalDate("2026-10-27T20:12:00Z", "nb"), /14:12/);

let account: { id: string; status: string } | null = null;
const writes: Array<{ id: string; value: unknown }> = [];
mock.module(new URL("../src/lib/product/account.ts", import.meta.url), { namedExports: { getPersonalAccount: async () => account } });
mock.module(new URL("../src/lib/product/preferences-store.ts", import.meta.url), { namedExports: {
  savePersonalPreferences: async (id: string, value: unknown) => { writes.push({ id, value }); return true; },
} });
const { PATCH } = await import("../src/app/api/personal/profile/route");
const savedMode = process.env.MISSIONDESK_ACCESS_MODE;
const savedBase = process.env.APP_BASE_URL;
function request(body: unknown = norwegian, origin = "http://localhost:3001", type = "application/json") {
  return new Request("http://localhost:3001/api/personal/profile", {
    method: "PATCH", headers: { origin, "content-type": type }, body: JSON.stringify(body),
  });
}
try {
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
  for (const value of [{ ...norwegian, plan: "premium" }, { ...norwegian, accountId: "another-account" }, { ...norwegian, targetCountry: "US" }]) {
    assert.equal((await PATCH(request(value))).status, 400);
  }
  assert.equal(writes.length, 0);
  const response = await PATCH(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(writes, [{ id: "session-account", value: norwegian }]);
  assert.deepEqual(await response.json(), { preferences: norwegian });
} finally {
  if (savedMode === undefined) delete process.env.MISSIONDESK_ACCESS_MODE; else process.env.MISSIONDESK_ACCESS_MODE = savedMode;
  if (savedBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = savedBase;
  mock.restoreAll();
}
console.log("[smoke:personal-profiles] Profile validation, source-backed home relevance, language honesty, session ownership, CSRF and payload limits passed; no live services used.");
