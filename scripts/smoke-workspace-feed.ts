import assert from "node:assert/strict";
import { mock } from "node:test";
import type { PersonalFeed } from "../src/lib/product/feed";
import type { PersonalPreferences } from "../src/lib/product/profiles";
import type { IntelligenceItem } from "../src/lib/types";
import { productPlans } from "../src/lib/product/plans";

const preferences: PersonalPreferences = { homeCountry: "NO", targetCountry: "MX", language: "en", contentLanguage: "original" };
const feed: PersonalFeed = { items: Array.from({ length: 30 }, (_, i) => ({ id: `baseline:${i}` } as IntelligenceItem)),
  briefings: [], updates: {}, activeSourceCount: 5, updatedAt: "2026-10-26T12:00:00Z" };
const workspace = { id: "trusted-workspace", home_country: "NO", countries: ["MX", "GT"] };
const calls: Array<{ sql: string; values?: unknown[] }> = [];
let memberships = [workspace];
let connects = 0;
let releases = 0;
let fail = false;
let sourceRows = [{ id: "fixture", fetch_mode: "rss", last_success_at: new Date("2026-10-27T11:00:00Z"), truncated: true, last_error: null as string | null, changed_at: null as Date | null }];
mock.module(new URL("../src/lib/product/store.ts", import.meta.url), { namedExports: {
  getProductPool: () => ({ connect: async () => {
    connects++;
    return { release: () => { releases++; }, query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes("JOIN product_workspace_members")) return { rows: memberships };
      if (sql.includes("c.status='selected'")) {
        if (fail) throw new Error("Fixture query failure");
        assert.match(sql, /c\.content_hash=a\.content_hash/);
        assert.match(sql, /c\.policy_key=\$2/);
        assert.match(sql,/ORDER BY \(c\.score - LEAST/);
        assert.ok(sql.indexOf("c.score -")<sql.lastIndexOf("LIMIT"),"Ranking must happen in SQL before the plan limit");
        assert.equal(values?.[0], workspace.id);
        return { rows: [{ id: "public-article", title: "Costa Rica&#8217;s Government", excerpt: "Nicaragua [&#8230;] &amp; M&eacute;xico", name: "Fixture source",
          language: "es", url: "https://fixture.example/a", score: 65, published_at: new Date("2026-10-27T10:00:00Z"), countries: ["GT"] }] };
      }
      if (sql.includes("COUNT(*)")) return { rows: [{ count: 3 }] };
      if (sql.includes("FROM product_public_sources")) return { rows: sourceRows };
      return { rows: [] };
    } };
  } }),
} });
const { addWorkspaceFeed } = await import("../src/lib/product/workspace-feed");
const savedFlag = process.env.MISSIONDESK_WORKSPACE_PILOT;
const savedFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => { throw new Error("Reading the workspace feed must not fetch sources or call paid APIs"); };
  process.env.MISSIONDESK_WORKSPACE_PILOT = "false";
  assert.equal(await addWorkspaceFeed("server-account", preferences, feed), feed);
  assert.equal(connects, 0, "Legacy mode must not query workspace tables");
  process.env.MISSIONDESK_WORKSPACE_PILOT = "true";
  for (const rows of [[], [workspace, { ...workspace, id: "other" }]]) {
    memberships = rows;
    calls.length = 0;
    assert.equal(await addWorkspaceFeed("server-account", preferences, feed), feed);
    assert.equal(calls.some(call => call.sql.includes("product_public_articles")), false);
    assert.equal(calls.at(-1)?.sql, "COMMIT");
  }
  memberships = [workspace];
  for (const plan of ["free", "premium"] as const) {
    calls.length = 0;
    const result = await addWorkspaceFeed("server-account", preferences, feed, plan);
    assert.deepEqual(calls[1], { sql: "SELECT set_config('missiondesk.account_id', $1, true)", values: ["server-account"] });
    assert.equal(calls.find(call => call.sql.includes("c.status='selected'"))?.values?.[2], productPlans[plan].feedLimit);
    assert.equal(result.items.length, Math.min(31, productPlans[plan].feedLimit));
    assert.equal(result.items[0].workspace_relevance, 65);
    assert.equal(result.items[0].category,"domestic_politics","RSS items must be classified rather than assigned Society");
    assert.ok(result.items[0].workspace_relevance_reasons?.includes("country_in_excerpt"),"Evidence must follow this workspace's countries, not another country's label");
    assert.equal(result.items[0].title_sv, "");
    assert.equal(result.items[0].summary_sv, "");
    assert.equal(result.items[0].title_original, "Costa Rica’s Government");
    assert.equal(result.items[0].original_excerpt, "Nicaragua […] & México", "Previously stored entity text must be readable without a rescan");
    assert.equal(result.updatedAt, "2026-10-27T11:00:00.000Z");
    assert.deepEqual(result.workspacePilot, { connectedSourceIds: ["fixture"], heldCount: 3, attentionNeeded: true });
    assert.equal(calls.at(-1)?.sql, "COMMIT");
  }
  const duplicateFeed = { ...feed, items: [
    { id: "old-copy", source_url: "https://fixture.example/a?utm_source=old#section" } as IntelligenceItem,
    { id: "unique", source_url: "https://fixture.example/other" } as IntelligenceItem,
  ] };
  const merged = await addWorkspaceFeed("server-account", preferences, duplicateFeed);
  assert.deepEqual(merged.items.map(item=>item.id),["workspace:public-article","unique"],
    "A directly fetched RSS item must replace, not duplicate, its older cached copy");
  for (const mode of ["mismatch", "failure"]) {
    calls.length = 0;
    fail = mode === "failure";
    await assert.rejects(() => addWorkspaceFeed("server-account", mode === "mismatch" ? { ...preferences, homeCountry: "SE" } : preferences, feed));
    assert.equal(calls.at(-1)?.sql, "ROLLBACK");
  }
  const { readWorkspaceSourceStatus }=await import("../src/lib/product/workspace-source-status");
  sourceRows=[...sourceRows,{id:"no-mx-ud-advisory",fetch_mode:"page",last_success_at:new Date("2026-10-26T10:00:00Z"),truncated:false,last_error:"Source HTTP 403",changed_at:new Date("2026-10-26T10:00:00Z")}];
  calls.length=0;
  const statuses=await readWorkspaceSourceStatus("server-account");
  assert.deepEqual(statuses.find(source=>source.id==="no-mx-ud-advisory"),{id:"no-mx-ud-advisory",connected:true,attention:true,mode:"paused",changed:false},"The source list must reflect the scanner's effective pause without discarding diagnostic history");
  assert.deepEqual(calls[1],{sql:"SELECT set_config('missiondesk.account_id',$1,true)",values:["server-account"]});
  assert.equal(connects, releases, "Every pooled connection must be released");
  assert.equal(feed.items.length, 30, "The shared baseline must not be mutated");
} finally {
  globalThis.fetch = savedFetch;
  if (savedFlag === undefined) delete process.env.MISSIONDESK_WORKSPACE_PILOT; else process.env.MISSIONDESK_WORKSPACE_PILOT = savedFlag;
  mock.restoreAll();
}
console.log("[smoke:workspace-feed] Feature gate, trusted membership, profile mismatch denial, current content/policy, plan limits, original text and transaction cleanup passed; no network calls.");
