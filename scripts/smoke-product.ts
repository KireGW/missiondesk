import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mock } from "node:test";
import ts from "typescript";
import type { Pool } from "pg";
import type { MissionDeskDb } from "@/lib/db/postgres";
import type { ProcessedIntelligenceRecord } from "@/lib/intelligence/models";
import { getAccessMode, authConfigurationReady } from "@/lib/product/config";
import { effectivePlan, productPlans } from "@/lib/product/plans";
import { searchPersonalSignals } from "@/lib/product/feed";
import { reserveUsage, settleUsage, releaseUnstartedUsage, UsageDenied } from "@/lib/product/store";
import { productSchemaSql } from "@/lib/product/schema";
import { getReadOnlyDb } from "@/lib/db/postgres";

assert.equal(getAccessMode({}), "legacy");
assert.equal(getAccessMode({ MISSIONDESK_ACCESS_MODE: "legacy" }), "legacy");
assert.equal(getAccessMode({ MISSIONDESK_ACCESS_MODE: "personal" }), "personal");
assert.equal(getAccessMode({ MISSIONDESK_ACCESS_MODE: "premuim" }), "invalid");
assert.equal(authConfigurationReady({}), false);
const authEnv = {
  AUTH0_DOMAIN: "example.auth0.com", AUTH0_CLIENT_ID: "test", AUTH0_CLIENT_SECRET: "test",
  AUTH0_SECRET: "ab".repeat(32), APP_BASE_URL: "http://localhost:3000",
};
assert.equal(authConfigurationReady(authEnv), true);
for (const base of ["https://user:pass@example.com", "https://example.com/path", "http://public.example.com", "https://example.com?query=1"]) {
  assert.equal(authConfigurationReady({ ...authEnv, APP_BASE_URL: base }), false);
}
assert.equal(authConfigurationReady({ ...authEnv, AUTH0_SECRET: "short" }), false);
assert.equal(effectivePlan({ plan: "premium", premiumUntil: "2000-01-01" }).id, "free");
assert.equal(effectivePlan({ plan: "premium", premiumUntil: null }).id, "free");
assert.equal(effectivePlan({ plan: "premium", premiumUntil: "invalid" }).id, "free");
assert.equal(effectivePlan({ plan: "unknown", premiumUntil: "2099-01-01" }).id, "free");
assert.equal(effectivePlan({ plan: "premium", premiumUntil: "2099-01-01" }).id, "premium");
assert.deepEqual(productPlans.premium.social, { accounts: 30, postsPerAccount: 20, runsPerDay: 1 });
assert.deepEqual(productPlans.free.social, { accounts: 0, postsPerAccount: 0, runsPerDay: 0 });
assert.equal(productPlans.free.onDemandAi, false);
assert.doesNotMatch(productSchemaSql, /(?:^|;)\s*(?:ALTER|DROP|TRUNCATE|DELETE|UPDATE)\b/i);
assert.match(productSchemaSql, /UNIQUE \(account_id, operation_key\)/);
const readOnlyDb = getReadOnlyDb();
await assert.rejects(readOnlyDb.prepare("UPDATE processed_items SET title_sv = 'test'").run(), /read-only/);
await assert.rejects(readOnlyDb.exec("CREATE TABLE test (id text)"), /read-only/);
await assert.rejects(readOnlyDb.prepare("DELETE FROM raw_source_items").all(), /Only publication SELECT/);

// A transaction/row-lock model exercises reservation concurrency without any live database.
function usagePool(options: { plan?: string; budget?: number; status?: string; expires?: string } = {}) {
  const rows: Array<{ id: string; key: string; service: string; period: string; reserved: number; actual?: number; status: string }> = [];
  const queries: string[] = [];
  let tail = Promise.resolve();
  const query = async (sql: string, args: unknown[] = []) => {
    queries.push(sql);
    if (sql.includes("SELECT id, status FROM product_usage")) return { rows: rows.filter((row) => row.key === args[1]) };
    if (sql.includes("AS total")) return { rows: [{ total: String(rows.filter((row) => row.service === args[1] && row.period === args[2])
      .reduce((sum, row) => sum + (row.status === "released" ? 0 : row.actual ?? row.reserved), 0)) }] };
    if (sql.includes("COUNT(*)")) return { rows: [{ count: String(rows.filter((row) => row.service === "social" && row.status !== "released").length) }] };
    if (sql.includes("INSERT INTO product_usage")) {
      rows.push({ id: String(args[0]), key: String(args[2]), service: String(args[3]), period: String(args[4]), reserved: Number(args[5]), status: "reserved" });
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE product_usage")) {
      const row = args[0] === "account" ? rows.find((candidate) => candidate.id === args[1] && candidate.status === "reserved") : undefined;
      if (!row) return { rows: [], rowCount: 0 };
      row.status = sql.includes("'settled'") ? "settled" : "released";
      if (row.status === "settled") row.actual = Number(args[2]);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    throw new Error(`Unexpected test SQL: ${sql}`);
  };
  const db = {
    query,
    connect: async () => {
      let unlock: (() => void) | undefined;
      return {
        release() { unlock?.(); },
        async query(sql: string, args: unknown[] = []) {
          if (sql === "BEGIN") return { rows: [] };
          if (sql === "COMMIT" || sql === "ROLLBACK") { unlock?.(); unlock = undefined; return { rows: [] }; }
          if (sql.includes("FOR UPDATE")) {
            queries.push(sql);
            const previous = tail;
            tail = new Promise<void>((resolveLock) => { unlock = resolveLock; });
            await previous;
            return { rows: args[0] !== "account" ? [] : [{
              plan: options.plan ?? "premium", status: options.status ?? "active",
              premium_until: new Date(options.expires ?? "2099-01-01"),
              llm_monthly_budget_micros: String(options.budget ?? 100), social_monthly_budget_micros: String(options.budget ?? 100),
            }] };
          }
          return query(sql, args);
        },
      };
    },
  } as unknown as Pool;
  return { db, rows, queries };
}

const request = { accountId: "account", operationKey: "analysis-1", service: "llm" as const, reservedMicros: 60 };
for (const options of [{ plan: "free" }, { status: "suspended" }, { expires: "2000-01-01" }, { budget: 0 }]) {
  const { db, rows } = usagePool(options);
  await assert.rejects(reserveUsage(request, db), UsageDenied);
  assert.equal(rows.length, 0);
}
const budget = usagePool();
const competing = await Promise.allSettled([
  reserveUsage(request, budget.db), reserveUsage({ ...request, operationKey: "analysis-2" }, budget.db),
]);
assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
assert.equal(budget.rows.length, 1, "Concurrent reservations cannot spend the same balance");
assert.ok(budget.queries.some((sql) => sql.includes("FOR UPDATE")));
const reservation = budget.rows[0].id;
assert.equal(await settleUsage("other-account", reservation, 40, budget.db), false);
assert.equal(await settleUsage("account", reservation, 40, budget.db), true);
assert.equal(await settleUsage("account", reservation, 99, budget.db), false, "Settlement is idempotent");
await assert.rejects(reserveUsage(request, budget.db), UsageDenied, "A replay cannot start another paid operation");
const second = await reserveUsage({ ...request, operationKey: "analysis-3" }, budget.db);
assert.equal(await releaseUnstartedUsage("other-account", second, budget.db), false);
assert.equal(await releaseUnstartedUsage("account", second, budget.db), true);
await assert.rejects(reserveUsage({ ...request, reservedMicros: NaN }, budget.db), UsageDenied);
const social = usagePool();
await reserveUsage({ ...request, service: "social", social: { accounts: 30, postsPerAccount: 20 } }, social.db);
await assert.rejects(reserveUsage({ ...request, operationKey: "social-again", service: "social", reservedMicros: 1,
  social: { accounts: 30, postsPerAccount: 20 } }, social.db), UsageDenied);
for (const units of [{ accounts: 31, postsPerAccount: 20 }, { accounts: 30, postsPerAccount: 21 }, { accounts: 1.5, postsPerAccount: 1 }]) {
  const test = usagePool();
  await assert.rejects(reserveUsage({ ...request, service: "social", social: units }, test.db), UsageDenied);
}

const savedMode = process.env.MISSIONDESK_ACCESS_MODE;
const savedFetch = globalThis.fetch;
const savedAuth = Object.fromEntries(Object.keys(authEnv).map((key) => [key, process.env[key]]));
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/server" ? "next/server.js" : specifier === "next/cache" ? "next/cache.js" : specifier, context);
} });
globalThis.fetch = async () => { throw new Error("Product tests must never call paid APIs or other live services"); };

const routeRoot = resolve("src/app/api");
const routeFiles = (await readdir(routeRoot, { recursive: true })).filter((path) => path.endsWith("route.ts") && !path.startsWith("personal/"));
const modules = new Map<string, Set<string>>();
for (const file of routeFiles) {
  const source = ts.createSourceFile(file, await readFile(resolve(routeRoot, file), "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const path = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!path.startsWith("@/lib/") || path.startsWith("@/lib/product/") || clause?.isTypeOnly || !clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    const names = modules.get(path) ?? new Set();
    for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) names.add((element.propertyName ?? element.name).text);
    modules.set(path, names);
  }
}

let selectedIds: string[] = [];
let processedRecords: ProcessedIntelligenceRecord[] = [];
let repositoryReads = 0;
const feedQueries: Array<{ sql: string; params: unknown[] }> = [];
const feedDb: MissionDeskDb = { prepare: (sql) => ({
  all: async (...params) => { feedQueries.push({ sql, params }); return selectedIds.map((id) => ({ id })) as never; },
  get: async () => { throw new Error("No unexpected reads"); },
  run: async () => { throw new Error("Personal feed must never write"); },
}), exec: async () => { throw new Error("Personal feed must never migrate"); } };
let identity: { user: { sub: string; email_verified?: boolean } } | null = null;
let personalAccount: { id: string; status: string; plan: string; premiumUntil: string | null } | null = null;
let personalFeedReads = 0;
try {
  for (const [path, names] of modules) {
    const exports = Object.fromEntries([...names].map((name) => [name, () => { throw new Error(`Blocked route reached engine: ${path}:${name}`); }]));
    if (path === "@/lib/intelligence/repository") exports.listProcessedItems = (async () => { repositoryReads++; return processedRecords; }) as never;
    if (path === "@/lib/intelligence/dashboard-view") {
      modules.delete(path);
      continue;
    }
    mock.module(pathToFileURL(resolve("src", `${path.slice(2)}.ts`)), { namedExports: exports });
  }
  mock.module(new URL("../src/lib/db/postgres.ts", import.meta.url), { namedExports: { getReadOnlyDb: () => feedDb } });
  mock.module("next/cache", { namedExports: { unstable_cache: (fn: unknown, _key: unknown, options: { revalidate: number }) => {
    assert.equal(options.revalidate, 900); return fn;
  } } });
  mock.module("@auth0/nextjs-auth0/server", { namedExports: { Auth0Client: class {
    async getSession() { return identity; }
    async middleware() { return new Response("auth-handler"); }
  } } });
  mock.module(new URL("../src/lib/product/account.ts", import.meta.url), { namedExports: { getPersonalAccount: async () => personalAccount } });
  mock.module(new URL("../src/lib/product/preferences-store.ts", import.meta.url), { namedExports: {
    getPersonalPreferences: async () => ({ homeCountry: "SE", targetCountry: "MX", language: "sv" }),
  } });

  // Every existing handler must reject personal mode before parsing bodies or calling the engine.
  let handlers = 0;
  for (const mode of ["personal", "typo"]) {
    process.env.MISSIONDESK_ACCESS_MODE = mode;
    for (const file of routeFiles) {
      const route = await import(pathToFileURL(resolve(routeRoot, file)).href);
      for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
        if (typeof route[method] !== "function") continue;
        const response = await route[method](new Request("http://localhost/api/test", {
          method, ...(method === "GET" ? {} : { body: JSON.stringify({ plan: "premium", aiEnabled: true, force: true, action: "cancel" }) }),
        }), { params: Promise.resolve({ id: "test" }) });
        assert.equal(response.status, 403, `${file}:${method} must isolate the global engine`);
        handlers++;
      }
    }
  }
  const { legacyEngineBoundary } = await import("@/lib/product/api-boundary");
  delete process.env.MISSIONDESK_ACCESS_MODE;
  assert.equal(legacyEngineBoundary(), null);
  process.env.MISSIONDESK_ACCESS_MODE = "legacy";
  assert.equal(legacyEngineBoundary(), null);
  Object.assign(process.env, authEnv);
  const { getPersonalIdentity, getPersonalAuth } = await import("@/lib/product/auth");
  assert.equal(getPersonalAuth(), null, "Legacy mode never initializes authentication");
  const { proxy } = await import("@/proxy");
  const proxyRequest = new Request("http://localhost/") as Parameters<typeof proxy>[0];
  assert.equal((await proxy(proxyRequest)).status, 200);
  process.env.MISSIONDESK_ACCESS_MODE = "invalid";
  assert.equal((await proxy(proxyRequest)).status, 503);
  process.env.MISSIONDESK_ACCESS_MODE = "personal";
  delete process.env.AUTH0_SECRET;
  assert.equal((await proxy(proxyRequest)).status, 503, "Missing credentials never open the old engine");
  process.env.AUTH0_SECRET = authEnv.AUTH0_SECRET;
  assert.equal(await (await proxy(proxyRequest)).text(), "auth-handler");
  assert.equal(await getPersonalIdentity(), null);
  identity = { user: { sub: "user", email_verified: false } };
  assert.equal(await getPersonalIdentity(), null);
  identity = { user: { sub: "user", email_verified: true } };
  assert.deepEqual(await getPersonalIdentity(), { subject: "example.auth0.com|user" });

  const { readPersonalFeed } = await import("@/lib/product/feed-store");
  const empty = await readPersonalFeed("free", feedDb);
  assert.deepEqual(empty.items, []);
  assert.equal(repositoryReads, 0, "Empty publication IDs must not become an unfiltered engine query");
  assert.equal(feedQueries[0].params.at(-1), 30);
  assert.match(feedQueries[0].sql, /source_type = 'news'/);
  assert.ok(feedQueries[0].params.includes("mexiko"), "The engine stores Swedish country names, not just ISO codes");
  assert.match(feedQueries[0].sql, /COALESCE\(NULLIF\(r.detected_country/);
  assert.doesNotMatch(feedQueries[0].sql, /raw_content|\bUPDATE\b|\bINSERT\b/);
  const raw: ProcessedIntelligenceRecord["raw"] = {
    id: "public", source_type: "news", source_name: "El Universal", url: "https://www.eluniversal.com.mx/mexico",
    title_original: "Mexico comercio", source_country: "Mexiko", detected_country: "Mexiko", source_language: "es", published_at: new Date().toISOString(),
    source_priority: 80, credibility_score: 80, crawl_status: "fetched", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const processed: ProcessedIntelligenceRecord["processed"] = {
    title_sv: "Handel i Mexiko", summary_sv: "En ny handelsregel", why_it_may_matter_sv: "Handel", category: "trade",
    geographic_scope: "national", geographic_tags: [], profile_tags: [], processed_at: new Date().toISOString(),
    urgency_score: 10, diplomatic_relevance_score: 60,
    raw_source_item_id: "public", sweden_relevance_score: 0, economic_impact_score: 50, security_impact_score: 0,
    processed_model: "test", cache_expires_at: "2099-01-01", created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  processedRecords = [
    { raw, processed },
    { raw: { ...raw, id: "mislabelled", url: "https://x.com/account/status/1" }, processed },
    { raw: { ...raw, id: "social", source_type: "social" }, processed },
    { raw: { ...raw, id: "other", source_name: "Unapproved source" }, processed },
  ];
  selectedIds = processedRecords.map((record) => record.raw.id);
  const published = await readPersonalFeed("free", feedDb);
  assert.equal(published.items.length, 1);
  assert.deepEqual(published.briefings, [], "Mixed global briefings must not leak premium/social content");
  const search = searchPersonalSignals(published.items, "handel");
  assert.equal(search.resultCount, 1);
  assert.equal(search.aiEnabled, false);
  assert.equal(search.report.estimatedApiReads, 0);
  assert.equal(search.report.estimatedTokenUsage, 0);
  assert.equal(searchPersonalSignals(published.items, "unmatched").resultCount, 0);
  processedRecords = [{ raw: { ...raw, source_name: "BBC Latin America", url: "https://www.bbc.com/news/articles/example" }, processed }];
  assert.equal((await readPersonalFeed("free", feedDb)).items.length, 1, "RSS and article hosts can differ for an explicitly approved source");

  // Read endpoint checks the account server-side; no plan or account ID can be supplied by the caller.
  mock.module(new URL("../src/lib/product/feed-store.ts", import.meta.url), { namedExports: { getPersonalFeed: async () => {
    personalFeedReads++; return published;
  } } });
  const { GET } = await import("@/app/api/personal/feed/route");
  assert.equal((await GET()).status, 401);
  personalAccount = { id: "test", status: "suspended", plan: "premium", premiumUntil: "2099-01-01" };
  assert.equal((await GET()).status, 403);
  assert.equal(personalFeedReads, 0);
  personalAccount.status = "active";
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  process.env.MISSIONDESK_ACCESS_MODE = "legacy";
  assert.equal((await GET()).status, 404);
  console.log(`[smoke:product] Passed: ${handlers} blocked handler calls, legacy compatibility, auth gates, public feed, local search, quotas and concurrent budget reservations. No live services used.`);
} finally {
  globalThis.fetch = savedFetch;
  if (savedMode === undefined) delete process.env.MISSIONDESK_ACCESS_MODE;
  else process.env.MISSIONDESK_ACCESS_MODE = savedMode;
  for (const [key, value] of Object.entries(savedAuth)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  hook.deregister();
  mock.restoreAll();
}
