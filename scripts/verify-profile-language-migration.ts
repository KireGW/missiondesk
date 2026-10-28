import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { readPersonalTestEnvironment } from "./personal-test-env.mjs";
import { productPreferencesMigrationSql } from "../src/lib/product/preferences-migration";
import { productInterfaceLanguageMigrationSql } from "../src/lib/product/interface-language-migration";

const { values } = readPersonalTestEnvironment(process.cwd(), { requireAuth: false });
const configDir = process.env.MISSIONDESK_NEON_CONFIG_DIR;
const profile = process.env.MISSIONDESK_NEON_PROFILE;
if (!process.argv.includes("--apply") || !configDir || !profile) throw new Error("Pass --apply and an explicitly authenticated Neon profile.");
const projectId = values.MISSIONDESK_TEST_PROJECT_ID;
const parentId = values.MISSIONDESK_TEST_BRANCH_ID;
if (!projectId) throw new Error("A verified personal project is required.");
const ownerDatabaseUrl = parseEnv(readFileSync(".env.local", "utf8")).DATABASE_URL;
if (!ownerDatabaseUrl) throw new Error("The existing owner configuration is required.");
function neon(args: string[]) {
  try {
    const output = execFileSync("npx", ["--yes", "neonctl@8.13.1", "--config-dir", configDir!, ...args,
      "--profile", profile!, "--output", "json", "--no-analytics"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
    try { return JSON.parse(output); } catch {
      if (/^postgres(?:ql)?:\/\//.test(output.trim())) return output.trim();
      throw new Error();
    }
  } catch { throw new Error("Neon migration rehearsal failed; private credential output withheld."); }
}
const parentResponse = neon(["branches", "get", parentId, "--project-id", projectId]);
const parent = parentResponse.branch ?? parentResponse;
const appUrl = new URL(values.DATABASE_URL);
const endpoints = neon(["api", `/projects/${projectId}/endpoints`]).endpoints;
if (parent.default || parent.primary || parent.id !== parentId || parent.name !== values.MISSIONDESK_TEST_BRANCH_NAME ||
    !endpoints.some((endpoint: { branch_id: string; host: string }) => endpoint.branch_id === parentId &&
      endpoint.host === appUrl.hostname.replace(/-pooler(?=\.)/, ""))) throw new Error("The parent is not the verified personal branch.");
const name = `verify-profile-language-${randomUUID().slice(0, 8)}`;
const response = neon(["branches", "create", "--project-id", projectId, "--parent", parentId, "--name", name,
  "--no-secrets", "--cu", "0.25", "--expires-at", new Date(Date.now() + 60 * 60_000).toISOString()]);
const branch = response.branch ?? response;
if (!branch.id || branch.id === parentId || branch.parent_id !== parentId || branch.name !== name || branch.default || branch.primary) {
  throw new Error("Unexpected rehearsal branch; refusing to write or delete it.");
}
console.log(`Testing migration on disposable child branch ${branch.id}. The pilot branch is not modified.`);
let db: Pool | undefined;
try {
  const owner = new URL(ownerDatabaseUrl).username;
  const connection = neon(["connection-string", branch.id, "--project-id", projectId, "--role-name", decodeURIComponent(owner),
    "--database-name", "neondb", "--pooled", "--ssl", "verify-full"]);
  const url = new URL(typeof connection === "string" ? connection : connection.uri);
  const childEndpoints = neon(["api", `/projects/${projectId}/endpoints`]).endpoints;
  if (url.hostname === appUrl.hostname || !childEndpoints.some((endpoint: { branch_id: string; host: string }) =>
    endpoint.branch_id === branch.id && endpoint.host === url.hostname.replace(/-pooler(?=\.)/, ""))) throw new Error("Wrong rehearsal endpoint.");
  db = new Pool({ connectionString: url.toString(), max: 1 });
  const existingColumn = (await db.query(`SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_account_preferences' AND column_name = 'content_language'`)).rowCount;
  for (const language of ["sv", "nb"]) {
    const id = randomUUID();
    await db.query("INSERT INTO product_accounts (id, auth_subject) VALUES ($1, $2)", [id, `rehearsal:${id}`]);
    await db.query(`INSERT INTO product_account_preferences (account_id, home_country, target_country, language)
      VALUES ($1, 'NO', 'MX', $2)`, [id, language]);
  }
  const before = (await db.query(`SELECT account_id, home_country, target_country, language, updated_at${existingColumn ? ", content_language" : ""}
    FROM product_account_preferences ORDER BY account_id`)).rows;
  await db.query(productPreferencesMigrationSql);
  await db.query(productInterfaceLanguageMigrationSql);
  const after = (await db.query("SELECT account_id, home_country, target_country, language, updated_at, content_language FROM product_account_preferences ORDER BY account_id")).rows;
  assert.deepEqual(after, before.map((row) => ({ ...row, content_language: row.content_language ?? (row.language === "sv" ? "sv" : "original") })));
  const id = after[0].account_id;
  await db.query("UPDATE product_account_preferences SET content_language = 'original' WHERE account_id = $1", [id]);
  const selected = (await db.query("SELECT account_id, content_language FROM product_account_preferences ORDER BY account_id")).rows;
  await db.query(productPreferencesMigrationSql);
  await db.query(productInterfaceLanguageMigrationSql);
  assert.deepEqual((await db.query("SELECT account_id, content_language FROM product_account_preferences ORDER BY account_id")).rows, selected,
    "A repeated migration must not overwrite independent choices");
  await assert.rejects(db.query("UPDATE product_account_preferences SET content_language = 'nb' WHERE account_id = $1", [id]),
    (error: unknown) => (error as { code?: string }).code === "23514");
  for (const language of ["sv", "nb", "es", "en"]) {
    await db.query("UPDATE product_account_preferences SET language = $2 WHERE account_id = $1", [id, language]);
  }
  await assert.rejects(db.query("UPDATE product_account_preferences SET language = 'fr' WHERE account_id = $1", [id]),
    (error: unknown) => (error as { code?: string }).code === "23514");
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM product_username_logins WHERE interface_profile NOT IN ('standard', 'norwegian')")).rows[0].count, 0);
  console.log(`[verify:profile-language] Existing profiles preserved, ${existingColumn ? "existing split" : "legacy backfill"} verified, repeat migration preserves choices and unsupported processing languages rejected.`);
} finally {
  await db?.end();
  neon(["api", `/projects/${projectId}/branches/${branch.id}`, "--method", "DELETE"]);
  console.log("Disposable rehearsal branch removed; pilot and primary branches retained.");
}
