import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import pg from "pg";
import { readPersonalTestEnvironment } from "./personal-test-env.mjs";

const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--rotate-password")) throw new Error("Only --rotate-password is supported.");
const rotatePassword = args[0] === "--rotate-password";
const { values } = readPersonalTestEnvironment();
if (values.MISSIONDESK_PERSONAL_DATA_MODE === "pilot") throw new Error("This account is now permanent. Use scripts/manage-daniel-account.mjs instead.");
const tenant = values.AUTH0_DOMAIN;
const cli = process.env.AUTH0_CLI_PATH ?? "auth0";
const connectionName = "MissionDesk-Daniel-Dev";
const purpose = "missiondesk-daniel-local-demo";
const credentialsPath = resolve(".env.daniel-demo.local");
const envPath = resolve(".env.personal.local");
if (process.env.VERCEL || !/^[a-z0-9.-]+\.auth0\.com$/.test(tenant)) throw new Error("Only the isolated local Auth0 preview is supported.");
execFileSync("git", ["check-ignore", "-q", credentialsPath], { stdio: "pipe" });

function auth0(method, path, body) {
  try {
    return JSON.parse(execFileSync(cli, ["api", method, path, ...(body ? ["--data", "@-"] : []),
      "--tenant", tenant, "--json", "--no-input"], {
      input: body ? JSON.stringify(body) : undefined, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }));
  } catch (error) {
    let status;
    try { status = JSON.parse(String(error.stdout)).error?.status; } catch { /* Do not log provider payloads or credentials. */ }
    throw new Error(`Auth0 ${method} ${path.split("?")[0]} failed${status ? ` (HTTP ${status})` : ""}. Provider output withheld.`);
  }
}

function savePrivate(path, data) {
  writeFileSync(path, Object.entries(data).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
  chmodSync(path, 0o600);
}

const app = auth0("get", `clients/${encodeURIComponent(values.AUTH0_CLIENT_ID)}`);
if (app.name !== "MissionDesk Personal Dev" || app.client_metadata?.purpose !== "missiondesk-personal-test" ||
    app.app_type !== "regular_web" || app.callbacks?.length !== 1 || app.callbacks[0] !== `${values.APP_BASE_URL}/auth/callback`) {
  throw new Error("Refusing to change an unverified or non-local Auth0 application.");
}

const found = auth0("get", `connections?name=${connectionName}`).find((item) => item.name === connectionName);
if (rotatePassword && !found) throw new Error("The existing demo connection is missing; refusing to create a replacement.");
const connection = found ? auth0("get", `connections/${found.id}`) : auth0("post", "connections", {
  name: connectionName, display_name: "MissionDesk Daniel (test)", strategy: "auth0", is_domain_connection: false,
  enabled_clients: [app.client_id], metadata: { purpose },
  options: {
    disable_signup: true, brute_force_protection: true, passwordPolicy: "good", password_complexity_options: { min_length: 15 },
    attributes: {
      username: { identifier: { active: true }, profile_required: true, signup: { status: "required" },
        validation: { min_length: 3, max_length: 30, allowed_types: { email: false, phone_number: false } } },
    },
  },
});
const clientsResult = auth0("get", `connections/${connection.id}/clients`);
const clients = Array.isArray(clientsResult) ? clientsResult : clientsResult.clients;
if (connection.metadata?.purpose !== purpose || connection.strategy !== "auth0" || connection.is_domain_connection ||
    connection.options?.disable_signup !== true || connection.options?.brute_force_protection !== true ||
    Object.keys(connection.options?.attributes ?? {}).join() !== "username" ||
    connection.options.attributes.username.identifier?.active !== true ||
    !Array.isArray(clients) || clients.length !== 1 || clients[0].client_id !== app.client_id) {
  throw new Error("The demo connection is not closed, username-only and exclusive to the local test app. No existing connection was changed.");
}

let credentials;
if (existsSync(credentialsPath)) {
  if ((statSync(credentialsPath).mode & 0o077) !== 0) throw new Error("The demo credentials file must be private (0600).");
  credentials = parseEnv(readFileSync(credentialsPath, "utf8"));
  if (credentials.AUTH0_DOMAIN !== tenant || credentials.AUTH0_CONNECTION !== connectionName ||
      credentials.USERNAME !== "daniel" || !credentials.PASSWORD || credentials.PASSWORD.length < 15 ||
      !/^auth0\|[a-f\d]{24}$/.test(credentials.AUTH0_USER_ID ?? "")) throw new Error("Unexpected demo credentials. Refusing to replace or reset them.");
} else {
  if (rotatePassword) throw new Error("Provision the demo account before rotating its password.");
  credentials = { AUTH0_DOMAIN: tenant, AUTH0_CONNECTION: connectionName,
    AUTH0_USER_ID: `auth0|${randomBytes(12).toString("hex")}`, USERNAME: "daniel", PASSWORD: `Md!7${randomBytes(24).toString("base64url")}` };
  // Persist before the request so retries can safely recover an uncertain provider response.
  savePrivate(credentialsPath, credentials);
}
const userId = credentials.AUTH0_USER_ID;
const users = auth0("get", `users?q=${encodeURIComponent(`identities.connection:"${connectionName}" AND username:"daniel"`)}&search_engine=v3`);
let user = users.find((candidate) => candidate.user_id === userId);
if (users.some((candidate) => candidate.user_id !== userId)) throw new Error("A different Daniel identity already exists; no password was changed.");
if (!user) {
  if (rotatePassword) throw new Error("The existing demo identity could not be verified; refusing to create a replacement.");
  user = auth0("post", "users", { connection: connectionName, user_id: userId.slice("auth0|".length),
    username: credentials.USERNAME, password: credentials.PASSWORD, name: "Daniel (test)", app_metadata: { purpose } });
}
if (user.user_id !== userId || user.username !== "daniel" || user.email || user.blocked ||
    user.app_metadata?.purpose !== purpose || !user.identities?.some((item) => item.connection === connectionName)) {
  throw new Error("Unexpected Auth0 identity; refusing to grant local demo access.");
}

if (rotatePassword) {
  const pendingPath = resolve(".env.daniel-demo.pending.local");
  execFileSync("git", ["check-ignore", "-q", pendingPath], { stdio: "pipe" });
  let next;
  if (existsSync(pendingPath)) {
    if ((statSync(pendingPath).mode & 0o077) !== 0) throw new Error("Pending credentials must be private (0600).");
    next = parseEnv(readFileSync(pendingPath, "utf8"));
    for (const key of ["AUTH0_DOMAIN", "AUTH0_CONNECTION", "AUTH0_USER_ID", "USERNAME"]) {
      if (next[key] !== credentials[key]) throw new Error("Pending credentials belong to a different identity.");
    }
  } else {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let token;
    do { token = Array.from({ length: 13 }, () => alphabet[randomInt(alphabet.length)]).join(""); }
    while (!/[A-Z]/.test(token) || !/[2-9]/.test(token));
    next = { ...credentials, PASSWORD: `${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8)}` };
    // Keep a private recovery copy if the provider succeeds but the local write is interrupted.
    savePrivate(pendingPath, next);
  }
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(next.PASSWORD ?? "") ||
      !/[A-Z]/.test(next.PASSWORD) || !/[2-9]/.test(next.PASSWORD)) throw new Error("Invalid pending demo password.");
  const changed = auth0("patch", `users/${encodeURIComponent(userId)}`, { connection: connectionName, password: next.PASSWORD });
  if (changed.user_id !== userId || changed.username !== "daniel") throw new Error("Unexpected password update response. Pending credentials retained.");
  savePrivate(credentialsPath, next);
  unlinkSync(pendingPath);
  console.log(JSON.stringify({ username: "daniel", passwordChanged: true, passwordLength: next.PASSWORD.length,
    credentialsFile: ".env.daniel-demo.local", passwordPolicyChanged: false, otherAccountsChanged: false }));
  process.exit(0);
}

const url = new URL(values.DATABASE_URL);
if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
const db = new pg.Pool({ connectionString: url.toString(), max: 1 });
try {
  const subject = `${tenant.toLowerCase()}|${userId}`;
  const result = await db.query(`INSERT INTO product_accounts (id, auth_subject) VALUES ($1, $2)
    ON CONFLICT (auth_subject) DO UPDATE SET auth_subject = EXCLUDED.auth_subject
    RETURNING id, status, plan, llm_monthly_budget_micros, social_monthly_budget_micros`, [randomUUID(), subject]);
  const account = result.rows[0];
  if (account.status !== "active" || account.plan !== "free" || account.llm_monthly_budget_micros !== "0" || account.social_monthly_budget_micros !== "0") {
    throw new Error("The demo account must remain active and free with zero paid-provider budgets.");
  }
  await db.query(`INSERT INTO product_account_preferences (account_id, home_country, target_country, language, content_language)
    VALUES ($1, 'NO', 'MX', 'en', 'original') ON CONFLICT (account_id) DO NOTHING`, [account.id]);
  savePrivate(envPath, { ...values, MISSIONDESK_LOCAL_DEMO_USER_ID: userId });
  console.log(JSON.stringify({ username: "daniel", profile: "NO/MX/en", plan: "free", connection: connectionName,
    credentialsFile: ".env.daniel-demo.local", appEnvUpdated: ".env.personal.local", existingLoginsChanged: false }));
} finally { await db.end(); }
