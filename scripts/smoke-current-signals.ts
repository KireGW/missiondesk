import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mock } from "node:test";
import type { IntelligenceItem } from "../src/lib/types";
import type { PersonalFeed } from "../src/lib/product/feed";
import { aggregatePersonalSearchItems, personalSelectionItems } from "../src/lib/product/feed";
import { selectCurrentSignalItems } from "../src/lib/product/current-signals";
import { orderCurrentSignalItems } from "../src/lib/product/current-signals-order";
import { selectBalancedWorkspaceItems } from "../src/lib/product/workspace-selection";
import { workspaceArticleToItem, type WorkspaceArticleRow } from "../src/lib/product/workspace-items";
import type { WorkspacePolicy } from "../src/lib/product/workspace-candidates";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/current-signals-2026-11-12.json", import.meta.url), "utf8")) as {
  now: string; policy: WorkspacePolicy; rows: Array<Omit<WorkspaceArticleRow, "published_at"> & { published_at: string }>;
  expectedOriginalIds: string[]; keptThreatId: string; responseId: string; suppressedIds: string[];
};
const now = Date.parse(fixture.now);
const rows = fixture.rows.map(row => ({ ...row, published_at: new Date(row.published_at) }));
const items = rows.map(row => workspaceArticleToItem(row, fixture.policy));
const before = JSON.stringify(items);
const original = selectBalancedWorkspaceItems(items, fixture.policy, 30, now);
assert.deepEqual(original.map(item => item.id), fixture.expectedOriginalIds, "Freeze the existing 30-signal selection before adding presentation filtering");
const ordered = selectBalancedWorkspaceItems(items, fixture.policy, items.length, now);
assert.deepEqual(ordered.slice(0, 30), original, "Extending the existing ordering must preserve its original prefix");
const current = selectCurrentSignalItems(ordered, 30);
const presentation = selectCurrentSignalItems(orderCurrentSignalItems(ordered,fixture.policy,now,
  new Map(rows.map(row=>[`workspace:${row.id}`,row.source_id!]))),30);
assert.equal(current.length, 30, "Backfill the two freed slots from the same ordered pool");
assert.ok(current.some(item => item.id === fixture.responseId), "Sheinbaum's response is a separate development and must survive");
assert.ok(current.some(item => item.id === fixture.keptThreatId), "The first existing representative remains Reforma");
for (const id of fixture.suppressedIds) {
  assert.ok(original.some(item => item.id === id));
  assert.ok(!current.some(item => item.id === id));
}
const suppressed = new Set(fixture.suppressedIds);
assert.deepEqual(current.slice(0, 28), original.filter(item => !suppressed.has(item.id)), "All 28 remaining signals keep their exact relative order");
const expectedBackfill = ordered.slice(30, 32);
assert.deepEqual(current.slice(28), expectedBackfill, "Only the next two existing candidates are added");
assert.equal(JSON.stringify(items), before, "Never mutate source material, category, score, IDs or evidence");
assert.deepEqual(selectCurrentSignalItems(ordered, 30), current, "Repeated selection is deterministic");
assert.deepEqual(selectCurrentSignalItems(ordered, 0), []);
for (const item of current) assert.equal(item, items.find(originalItem => originalItem.id === item.id), "Preserve the original article objects");

const threat = items.find(item => item.id === fixture.keptThreatId)!;
const response = items.find(item => item.id === fixture.responseId)!;
let variantId = 0;
function variant(change: Partial<IntelligenceItem>): IntelligenceItem {
  const id = `variant-${variantId++}`;
  return { ...threat, id, source_url: `https://fixture.example/${id}`, ...change };
}
const protectedCases = [
  response,
  variant({ title_original: `${threat.title_original}; Sheinbaum responde al presidente` }),
  variant({ title_original: `Trump duplica aranceles a México si no detiene caravanas` }),
  variant({ title_original: `Trump retira amenaza de duplicar aranceles a México si no detiene caravanas` }),
  variant({ title_original: `Trump niega que vaya a duplicar aranceles a México si no detiene caravanas` }),
  variant({ original_excerpt: `${threat.original_excerpt} La medida entra en vigor.` }),
  variant({ original_excerpt: `${threat.original_excerpt} Se alcanza un acuerdo.` }),
  variant({ original_excerpt: `${threat.original_excerpt} Habrá un plazo de tres días.` }),
  variant({ original_excerpt: `${threat.original_excerpt} El plazo vence antes del 15 de noviembre.` }),
  variant({ original_excerpt: `${threat.original_excerpt} Se habla de un arancel del 25%.` }),
  variant({ title_original: threat.title_original.replace("Trump", "Biden") }),
  variant({ title_original: threat.title_original.replace("México", "Guatemala"), geographic_tags: ["GT"] }),
  variant({ title_original: threat.title_original.replace("caravanas", "contrabando") }),
  variant({ geographic_tags: ["MX", "GT"] }),
  variant({ published_at: new Date(now + 86_400_000).toISOString() }),
  variant({ published_at: "" }),
  variant({ source_language: "en" }),
  variant({ content_kind: "reference" }),
];
for (const item of protectedCases) assert.equal(selectCurrentSignalItems([threat, item], 5).length, 2, `Keep uncertain or distinct developments: ${item.title_original}`);
assert.equal(selectCurrentSignalItems([threat, variant({ category: "migration" })], 5).length, 1, "A category difference is not a different development");
assert.equal(selectCurrentSignalItems([
  variant({ original_excerpt: `${threat.original_excerpt} 25%.` }),
  variant({ original_excerpt: `${threat.original_excerpt} 25 días.` }),
], 5).length, 2, "The same number with different units is not the same reported detail");

let databaseRows = rows;
const queries: string[] = [];
mock.module(new URL("../src/lib/product/store.ts", import.meta.url), { namedExports: {
  getProductPool: () => ({ connect: async () => ({ release: () => {}, query: async (sql: string) => {
    queries.push(sql);
    if (sql.includes("JOIN product_workspace_members")) return { rows: [{ id: fixture.policy.id, home_country: fixture.policy.homeCountry, countries: fixture.policy.countries }] };
    if (sql.includes("c.status='selected'")) return { rows: databaseRows };
    if (sql.includes("COUNT(*)")) return { rows: [{ count: 0 }] };
    if (sql.includes("FROM product_public_sources")) return { rows: [] };
    return { rows: [] };
  } }) }),
} });
const { addWorkspaceFeed } = await import("../src/lib/product/workspace-feed");
const originalFlag = process.env.MISSIONDESK_WORKSPACE_PILOT;
const originalFetch = globalThis.fetch;
const clock = mock.method(Date, "now", () => now);
const feed: PersonalFeed = { items: [], briefings: [], activeSourceCount: 0, updates: {} };
try {
  globalThis.fetch = async () => { throw new Error("Presentation filtering must not fetch sources or call external APIs"); };
  process.env.MISSIONDESK_WORKSPACE_PILOT = "false";
  assert.equal(await addWorkspaceFeed("fixture-account", { homeCountry: "NO", targetCountry: "MX", language: "en", contentLanguage: "original" }, feed), feed);
  assert.equal(queries.length, 0, "The legacy path must not change");
  process.env.MISSIONDESK_WORKSPACE_PILOT = "true";
  const preferences = { homeCountry: "NO", targetCountry: "MX", language: "en", contentLanguage: "original" } as const;
  const result = await addWorkspaceFeed("fixture-account", preferences, feed);
  assert.deepEqual(result.items, original, "The API's original search/selection material remains byte-for-byte equivalent");
  assert.deepEqual(result.currentItems, presentation, "Only the optional Current signals presentation is filtered and reordered");
  assert.deepEqual(aggregatePersonalSearchItems(result.items, [], "Trump"), aggregatePersonalSearchItems(original, [], "Trump"), "Signal search retains all original variants");
  const allFourIds = [fixture.keptThreatId, fixture.responseId, ...fixture.suppressedIds];
  assert.equal(aggregatePersonalSearchItems(result.items, [], "Trump").filter(item => allFourIds.includes(item.id)).length, 4);
  for (const ids of [fixture.suppressedIds, [fixture.responseId], allFourIds]) {
    assert.deepEqual(personalSelectionItems(result.items, {}, ids), personalSelectionItems(original, {}, ids), "Prioritized and Meeting brief continue to use the original material");
  }
  const retained = Object.fromEntries([...original, ...expectedBackfill].map(item => [item.id, item]));
  assert.deepEqual(personalSelectionItems([], retained, allFourIds).map(item => item.id).sort(), [...allFourIds].sort(), "Already-selected variants survive even after the feed changes");
  assert.ok(personalSelectionItems(result.items, retained, [expectedBackfill[0].id]).some(item => item.id === expectedBackfill[0].id), "Newly backfilled stories can also be retained for a meeting");

  // A variant must not return through the older cached feed after RSS selection.
  databaseRows = rows.filter(row => `workspace:${row.id}` === fixture.keptThreatId);
  const fallback = items.filter(item => fixture.suppressedIds.includes(item.id) || item.id === fixture.responseId);
  const merged = await addWorkspaceFeed("fixture-account", preferences, { ...feed, items: fallback });
  assert.equal(merged.items.length, 4, "The original combined material is preserved");
  assert.deepEqual(merged.currentItems?.map(item => item.id), [fixture.keptThreatId, fixture.responseId]);
  const unchanged = await addWorkspaceFeed("fixture-account", preferences, feed);
  assert.equal(unchanged.currentItems, undefined, "Do not add a second presentation when nothing changes");
  assert.ok(queries.every(sql => !/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i.test(sql)), "No database writes are introduced");
  const reportPath = process.env.MISSIONDESK_CURRENT_SIGNALS_REPORT;
  if (reportPath) writeFileSync(reportPath, JSON.stringify({
    fixtureTime: fixture.now, candidateCount: items.length, originalCount: original.length, currentCount: current.length,
    responseRetained: true, originalMaterialUnchanged: true, other28OrderUnchanged: true,
    suppressed: original.filter(item => suppressed.has(item.id)).map(item => ({ id: item.id, source: item.source_name, title: item.title_original })),
    added: expectedBackfill.map(item => ({ id: item.id, source: item.source_name, title: item.title_original })),
    searchVariants: 4, protectedCases: protectedCases.length,
  }, null, 2) + "\n");
} finally {
  globalThis.fetch = originalFetch;
  if (originalFlag === undefined) delete process.env.MISSIONDESK_WORKSPACE_PILOT; else process.env.MISSIONDESK_WORKSPACE_PILOT = originalFlag;
  clock.mock.restore();
  mock.restoreAll();
}
console.log("[smoke:current-signals] Frozen 85-item replay: Sheinbaum retained, exactly two variants hidden, 28 unchanged, two backfilled; search, saved selections, cached merge, protected developments and no writes passed.");
