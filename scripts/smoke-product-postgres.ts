import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { mock } from "node:test";
import { readPersonalTestEnvironment } from "./personal-test-env.mjs";

if (!process.argv.includes("--apply")) throw new Error("This test creates disposable fixtures in the isolated preview; pass --apply.");
const config = readPersonalTestEnvironment(process.cwd(), { requireAuth: false });
Object.assign(process.env, config.env);
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === "next/cache" ? "next/cache.js" : specifier, context);
} });
// Only bypass Next's request cache; publication queries use the real restricted database login.
mock.module("next/cache", { namedExports: { unstable_cache: (read: unknown) => read } });
const { getProductPool, reserveUsage, settleUsage, releaseUnstartedUsage, UsageDenied } = await import("../src/lib/product/store");
const { readPersonalFeed } = await import("../src/lib/product/feed-store");
const { closeDb } = await import("../src/lib/db/postgres");
const { getPersonalPreferences, savePersonalPreferences } = await import("../src/lib/product/preferences-store");
const db = getProductPool();
const ids: string[] = [];
const engineTables = ["raw_source_items", "processed_items", "briefings", "background_jobs"];
async function engineCounts() {
  const counts: Record<string, string> = {};
  for (const table of engineTables) counts[table] = (await db.query(`SELECT COUNT(*)::text AS count FROM ${table}`)).rows[0].count;
  return counts;
}
async function fixture(plan = "premium") {
  const id = randomUUID();
  await db.query(`INSERT INTO product_accounts
    (id, auth_subject, plan, premium_until, llm_monthly_budget_micros, social_monthly_budget_micros)
    VALUES ($1, $2, $3, now() + interval '1 day', 100, 100000)`, [id, `test-only:${id}`, plan]);
  ids.push(id);
  return id;
}
try {
  const permissions = await db.query(`SELECT
    pg_has_role(current_user, 'neon_superuser', 'MEMBER') AS is_admin,
    (SELECT rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname = current_user) AS can_administer,
    has_schema_privilege(current_user, 'public', 'CREATE') AS can_create,
    has_table_privilege(current_user, 'raw_source_items', 'INSERT,UPDATE,DELETE,TRUNCATE') AS can_write_sources,
    has_table_privilege(current_user, 'background_jobs', 'INSERT,UPDATE,DELETE,TRUNCATE') AS can_write_jobs`);
  assert.equal(permissions.rows[0].is_admin, false, "The app must not inherit administrator access");
  assert.equal(permissions.rows[0].can_administer, false, "The app must not create roles or databases");
  assert.equal(permissions.rows[0].can_create, false, "The app must not create schema objects");
  assert.equal(permissions.rows[0].can_write_sources, false, "The app must not change sources");
  assert.equal(permissions.rows[0].can_write_jobs, false, "The app must not change engine jobs");
  const before = await engineCounts();
  const feed = await readPersonalFeed("free");
  assert.ok(feed.items.length > 0 && feed.items.length <= 30, "The real public free feed must load within its plan limit");
  assert.equal(feed.briefings.length, 0, "Global briefings must not leak into the public feed");
  assert.equal(feed.activeSourceCount, 5);
  const free = await fixture("free");
  await assert.rejects(reserveUsage({ accountId: free, operationKey: "free-test", service: "llm", reservedMicros: 1 }), UsageDenied);
  const account = await fixture();
  assert.deepEqual(await getPersonalPreferences(free), { homeCountry: "SE", targetCountry: "MX", language: "sv" });
  const profile = { homeCountry: "NO", targetCountry: "MX", language: "nb" };
  assert.equal(await savePersonalPreferences(free, profile), true);
  assert.deepEqual(await getPersonalPreferences(free), profile);
  assert.deepEqual(await getPersonalPreferences(account), { homeCountry: "SE", targetCountry: "MX", language: "sv" }, "Preferences must not cross accounts");
  assert.equal(await savePersonalPreferences(free, { ...profile, plan: "premium" }), false);
  assert.equal((await db.query("SELECT plan FROM product_accounts WHERE id = $1", [free])).rows[0].plan, "free");
  await db.query("UPDATE product_accounts SET status = 'suspended' WHERE id = $1", [account]);
  assert.equal(await savePersonalPreferences(account, profile), false);
  await db.query("UPDATE product_accounts SET status = 'active' WHERE id = $1", [account]);
  const request = { accountId: account, operationKey: "first", service: "llm" as const, reservedMicros: 60 };
  const results = await Promise.allSettled([
    reserveUsage(request), reserveUsage({ ...request, operationKey: "second" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1, "Real row locks must prevent concurrent overspend");
  const success = results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<string>;
  assert.equal(await settleUsage(free, success.value, 40), false, "Another account cannot settle a reservation");
  assert.equal(await settleUsage(account, success.value, 40), true);
  assert.equal(await settleUsage(account, success.value, 50), false);
  const next = await reserveUsage({ ...request, operationKey: "third" });
  assert.equal(await releaseUnstartedUsage(free, next), false);
  assert.equal(await releaseUnstartedUsage(account, next), true);
  const social = await fixture();
  const socialRequest = { accountId: social, operationKey: "social-first", service: "social" as const,
    reservedMicros: 1, social: { accounts: 30, postsPerAccount: 20 } };
  const daily = await Promise.allSettled([
    reserveUsage(socialRequest), reserveUsage({ ...socialRequest, operationKey: "social-second" }),
  ]);
  assert.equal(daily.filter((result) => result.status === "fulfilled").length, 1, "Only one daily social run can be reserved");
  await assert.rejects(reserveUsage({ ...socialRequest, operationKey: "over-limit", social: { accounts: 31, postsPerAccount: 20 } }), UsageDenied);
  assert.deepEqual(await engineCounts(), before, "Account and budget tests must not modify engine data or jobs");
  console.log(`[smoke:product-postgres] Real Postgres: ${feed.items.length} public feed items, restricted DB permissions, free restrictions, account isolation, concurrent budgets and daily quota passed; engine counts unchanged.`);
} finally {
  // Only generated fixtures in the explicitly verified test branch are removed.
  if (ids.length) await db.query("DELETE FROM product_accounts WHERE id = ANY($1::uuid[])", [ids]);
  await db.end();
  await closeDb();
  hook.deregister();
}
