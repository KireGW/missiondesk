import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { Pool } from "pg";

const [projectId, parentId] = process.argv.slice(2);
if (!projectId || !parentId?.startsWith("br-")) throw new Error("Pass the verified project ID and parent branch ID.");
const envPath = ".env.personal.local";
execFileSync("git", ["check-ignore", "-q", envPath], { stdio: "pipe" });
const current = parseEnv(readFileSync(envPath, "utf8"));
const legacy = parseEnv(readFileSync(".env.local", "utf8"));
const legacyHost = new URL(legacy.DATABASE_URL).hostname.replace(/-pooler(?=\.)/, "");
const configDir = process.env.MISSIONDESK_NEON_CONFIG_DIR;
const profile = process.env.MISSIONDESK_NEON_PROFILE;
if (!configDir || !profile) throw new Error("An explicitly authenticated Neon test profile is required.");

function neon(args, { raw = false } = {}) {
  let output;
  try {
    output = execFileSync("npx", ["--yes", "neonctl@8.13.1", "--config-dir", configDir, ...args,
      "--profile", profile, "--output", "json", "--no-analytics"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
    });
  } catch {
    throw new Error(`Neon ${args[0]} ${args[1] ?? ""} failed; provider output is withheld because it can include credentials.`);
  }
  try { return JSON.parse(output); } catch {
    if (raw && /^postgres(?:ql)?:\/\//.test(output.trim())) return output.trim();
    throw new Error("Neon returned an unexpected response; credentials are withheld.");
  }
}

const endpoints = neon(["api", `/projects/${projectId}/endpoints`]).endpoints;
if (!endpoints.some((endpoint) => endpoint.branch_id === parentId && endpoint.host === legacyHost)) {
  throw new Error("The selected parent is not the existing MissionDesk database endpoint.");
}
const branches = neon(["branches", "list", "--project-id", projectId]);
const name = current.MISSIONDESK_TEST_BRANCH_NAME || `missiondesk-personal-test-${new Date().toISOString().slice(0, 10)}`;
let branch = branches.find((candidate) => candidate.name === name);
if (!branch) {
  console.log("Creating isolated personal test branch with a small compute and seven-day expiry.");
  const created = neon(["branches", "create", "--project-id", projectId, "--parent", parentId, "--name", name,
    "--no-secrets", "--cu", "0.25", "--expires-at", new Date(Date.now() + 7 * 86_400_000).toISOString()]);
  branch = created.branch ?? created;
}
if (!branch.id || branch.id === parentId || branch.default || branch.primary || branch.parent_id !== parentId) {
  throw new Error("Refusing to configure a primary, unrelated or unverified branch.");
}
const roleName = "missiondesk_personal_app";
const ownerName = decodeURIComponent(new URL(legacy.DATABASE_URL).username);
const response = neon(["connection-string", branch.id, "--project-id", projectId, "--role-name", ownerName,
  "--database-name", "neondb", "--pooled", "--ssl", "verify-full"], { raw: true });
const connection = typeof response === "string" ? response : response.uri;
if (typeof connection !== "string") throw new Error("Neon did not return a connection URI.");
const url = new URL(connection);
const testHost = url.hostname.replace(/-pooler(?=\.)/, "");
const verifiedEndpoints = neon(["api", `/projects/${projectId}/endpoints`]).endpoints;
if (testHost === legacyHost || !verifiedEndpoints.some((endpoint) => endpoint.branch_id === branch.id && endpoint.host === testHost)) {
  throw new Error("The connection URI does not belong to the isolated test branch.");
}
if (current.DATABASE_URL && new URL(current.DATABASE_URL).hostname !== url.hostname) {
  throw new Error("The personal environment already points to another database; refusing to overwrite it.");
}
const existingAppUrl = current.DATABASE_URL ? new URL(current.DATABASE_URL) : null;
const password = existingAppUrl?.username === roleName ? decodeURIComponent(existingAppUrl.password) : randomBytes(32).toString("hex");
const admin = new Pool({ connectionString: connection, max: 1 });
try {
  const exists = (await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [roleName])).rowCount;
  if (exists && existingAppUrl?.username !== roleName) throw new Error("An app role already exists without matching local credentials; refusing to replace it.");
  if (!exists) {
    console.log("Creating a restricted SQL login on the test branch, without Neon's CLI administrator inheritance.");
    const statement = await admin.query("SELECT format('CREATE ROLE %I WITH LOGIN PASSWORD %L', $1::text, $2::text) AS sql", [roleName, password]);
    await admin.query(statement.rows[0].sql);
  }
} finally {
  await admin.end();
}
url.username = roleName;
url.password = password;
const values = { ...current, DATABASE_URL: url.toString(), MISSIONDESK_TEST_BRANCH_ID: branch.id,
  MISSIONDESK_TEST_PROJECT_ID: projectId, MISSIONDESK_TEST_BRANCH_NAME: name,
  MISSIONDESK_TEST_BRANCH_EXPIRES_AT: branch.expires_at ?? "" };
writeFileSync(envPath, Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log(JSON.stringify({ projectId, branchId: branch.id, name, roleName, host: url.hostname, expiresAt: branch.expires_at,
  configWritten: envPath, legacyEnvironmentPreserved: true }));
