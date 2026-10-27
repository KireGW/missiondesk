import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { Pool } from "pg";
import { readPersonalTestEnvironment } from "./personal-test-env.mjs";
import { productSchemaSql } from "../src/lib/product/schema";

const config = readPersonalTestEnvironment(process.cwd(), { requireAuth: false });
const configDir = process.env.MISSIONDESK_NEON_CONFIG_DIR;
const profile = process.env.MISSIONDESK_NEON_PROFILE;
if (!configDir || !profile) throw new Error("Set the explicitly authenticated Neon test config directory and profile.");
const projectId = config.values.MISSIONDESK_TEST_PROJECT_ID;
const branchId = config.values.MISSIONDESK_TEST_BRANCH_ID;
const appUrl = new URL(config.values.DATABASE_URL);
if (!projectId || appUrl.username !== "missiondesk_personal_app") throw new Error("The isolated app role and verified project are required.");
const legacy = parseEnv(readFileSync(".env.local", "utf8"));
if (!legacy.DATABASE_URL) throw new Error("The existing database owner configuration is required.");
const owner = decodeURIComponent(new URL(legacy.DATABASE_URL).username);

function neon(args: string[]) {
  let output: string;
  try {
    output = execFileSync("npx", ["--yes", "neonctl@8.13.1", "--config-dir", configDir!, ...args,
      "--profile", profile!, "--output", "json", "--no-analytics"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
    });
  } catch {
    throw new Error("Neon test migration setup failed; credential output is withheld.");
  }
  try { return JSON.parse(output); } catch {
    if (/^postgres(?:ql)?:\/\//.test(output.trim())) return output.trim();
    throw new Error("Unexpected Neon response; credential output is withheld.");
  }
}

const branch = neon(["branches", "get", branchId, "--project-id", projectId]);
const metadata = branch.branch ?? branch;
if (metadata.id !== branchId || metadata.default || metadata.primary || !metadata.parent_id ||
    metadata.name !== config.values.MISSIONDESK_TEST_BRANCH_NAME) throw new Error("Refusing to migrate an unverified or primary branch.");
const response = neon(["connection-string", branchId, "--project-id", projectId,
  "--role-name", owner, "--database-name", "neondb", "--pooled", "--ssl", "verify-full"]);
const uri = typeof response === "string" ? response : response.uri;
const adminUrl = new URL(uri);
if (adminUrl.hostname !== appUrl.hostname || adminUrl.pathname !== appUrl.pathname) {
  throw new Error("Administrator connection does not belong to the configured test database.");
}

// Administrator credentials stay in this short-lived process, never in the app environment.
const db = new Pool({ connectionString: adminUrl.toString(), max: 1 });
const client = await db.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(713492, 1)");
  await client.query(productSchemaSql);
  await client.query("GRANT USAGE ON SCHEMA public TO missiondesk_personal_app");
  await client.query("GRANT SELECT ON raw_source_items, processed_items, briefings, background_jobs TO missiondesk_personal_app");
  await client.query("GRANT SELECT, INSERT, UPDATE, DELETE ON product_accounts, product_usage TO missiondesk_personal_app");
  await client.query("COMMIT");
  console.log("Personal schema ready on the isolated branch. App role can manage accounts and usage, but only read engine tables; no schema creation privilege granted.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await db.end();
}
