import { randomInt } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";
import { readPersonalTestEnvironment } from "./personal-test-env.mjs";

const [action = "status", username, ...extra] = process.argv.slice(2);
if (!["status", "promote", "norwegian-interface", "rename", "rotate-password"].includes(action) || extra.length ||
    (action === "rename" ? !/^[a-z0-9][a-z0-9_-]{2,29}$/.test(username ?? "") : username !== undefined)) {
  throw new Error("Use status, promote, norwegian-interface, rename <lowercase-username>, or rotate-password.");
}
const { values } = readPersonalTestEnvironment();
if (process.env.VERCEL) throw new Error("Account administration is local only, not a web endpoint.");
const path = ".env.daniel-demo.local";
const pendingPath = ".env.daniel-account.pending.local";
for (const file of [path, pendingPath]) execFileSync("git", ["check-ignore", "-q", file], { stdio: "pipe" });
if ((statSync(path).mode & 0o077) !== 0) throw new Error("Credentials must be private (0600).");
const credentials = parseEnv(readFileSync(path, "utf8"));
const userId = values.MISSIONDESK_DANIEL_AUTH0_USER_ID ?? values.MISSIONDESK_LOCAL_DEMO_USER_ID;
if (!/^auth0\|[a-f\d]{24}$/.test(userId ?? "") || credentials.AUTH0_USER_ID !== userId ||
    credentials.AUTH0_DOMAIN !== values.AUTH0_DOMAIN || credentials.AUTH0_CONNECTION !== "MissionDesk-Daniel-Dev") {
  throw new Error("The stable Daniel identity could not be verified. No credentials were changed.");
}
function savePrivate(file, data) {
  writeFileSync(file, Object.entries(data).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
}
function auth0(method, endpoint, body) {
  try {
    return JSON.parse(execFileSync(process.env.AUTH0_CLI_PATH ?? "auth0", ["api", method, endpoint,
      ...(body ? ["--data", "@-"] : []), "--tenant", values.AUTH0_DOMAIN, "--json", "--no-input"], {
      input: body ? JSON.stringify(body) : undefined, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000,
    }));
  } catch { throw new Error(`Auth0 ${method} failed; private provider output withheld. Recovery credentials, if any, are retained.`); }
}
const cliConfig = process.env.MISSIONDESK_NEON_CONFIG_DIR;
const cliProfile = process.env.MISSIONDESK_NEON_PROFILE;
if (!cliConfig || !cliProfile) throw new Error("An explicitly authenticated Neon profile is required.");
function neon(args) {
  try {
    const result = execFileSync("npx", ["--yes", "neonctl@8.13.1", "--config-dir", cliConfig, ...args,
      "--profile", cliProfile, "--output", "json", "--no-analytics"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000,
    });
    try { return JSON.parse(result); } catch {
      if (/^postgres(?:ql)?:\/\//.test(result.trim())) return result.trim();
      throw new Error();
    }
  } catch { throw new Error("Neon administration failed; credential output withheld."); }
}

const app = auth0("get", `clients/${encodeURIComponent(values.AUTH0_CLIENT_ID)}`);
if (app.client_metadata?.purpose !== "missiondesk-personal-test" || app.app_type !== "regular_web" ||
    app.callbacks?.length !== 1 || app.callbacks[0] !== `${values.APP_BASE_URL}/auth/callback`) throw new Error("Unexpected Auth0 app.");
const userEndpoint = `users/${encodeURIComponent(userId)}`;
const user = auth0("get", userEndpoint);
if (user.user_id !== userId || user.blocked || user.app_metadata?.purpose !== "missiondesk-daniel-local-demo" ||
    !user.identities?.some((identity) => identity.connection === credentials.AUTH0_CONNECTION)) throw new Error("Unexpected Auth0 identity.");
const summary = auth0("get", `connections?name=${credentials.AUTH0_CONNECTION}`).find((item) => item.name === credentials.AUTH0_CONNECTION);
if (!summary) throw new Error("The managed connection is missing.");
const connection = auth0("get", `connections/${summary.id}`);
const enabled = auth0("get", `connections/${summary.id}/clients`);
const clients = Array.isArray(enabled) ? enabled : enabled.clients;
const allowedClients = new Set([app.client_id]);
if (existsSync(".env.pilot.local")) {
  if ((statSync(".env.pilot.local").mode & 0o077) !== 0) throw new Error("Online pilot credentials must be private (0600).");
  const pilot = parseEnv(readFileSync(".env.pilot.local", "utf8"));
  const online = auth0("get", `clients/${encodeURIComponent(pilot.AUTH0_CLIENT_ID ?? "")}`);
  const base = new URL(pilot.APP_BASE_URL);
  if (pilot.PILOT_PURPOSE !== "missiondesk-online-pilot" || pilot.AUTH0_DOMAIN !== values.AUTH0_DOMAIN ||
      pilot.DATABASE_URL !== values.DATABASE_URL || pilot.MISSIONDESK_PILOT_INVITE_ONLY !== "true" ||
      base.protocol !== "https:" || base.pathname !== "/" || base.search || base.hash || base.username || base.password ||
      online.client_id === app.client_id || online.app_type !== "regular_web" || online.client_metadata?.purpose !== "missiondesk-online-pilot" ||
      online.callbacks?.length !== 1 || online.callbacks[0] !== `${base.origin}/auth/callback`) throw new Error("Unexpected online pilot application.");
  allowedClients.add(online.client_id);
}
if (connection.metadata?.purpose !== "missiondesk-daniel-local-demo" || connection.strategy !== "auth0" ||
    connection.is_domain_connection || !connection.options?.disable_signup || !connection.options?.brute_force_protection ||
    !connection.options?.attributes?.username?.identifier?.active ||
    clients?.length !== allowedClients.size || clients.some((client) => !allowedClients.has(client.client_id))) throw new Error("The managed connection is not safely isolated.");

const projectId = values.MISSIONDESK_TEST_PROJECT_ID;
const branchId = values.MISSIONDESK_TEST_BRANCH_ID;
if (!projectId) throw new Error("A verified personal database project is required.");
const branchResponse = neon(["branches", "get", branchId, "--project-id", projectId]);
let branch = branchResponse.branch ?? branchResponse;
const appUrl = new URL(values.DATABASE_URL);
const legacyUrl = new URL(parseEnv(readFileSync(".env.local", "utf8")).DATABASE_URL);
const host = (url) => url.hostname.replace(/-pooler(?=\.)/, "");
const endpoints = neon(["api", `/projects/${projectId}/endpoints`]).endpoints;
if (branch.id !== branchId || branch.default || branch.primary || !branch.parent_id ||
    ![values.MISSIONDESK_TEST_BRANCH_NAME, "missiondesk-personal-pilot"].includes(branch.name) ||
    !endpoints.some((item) => item.branch_id === branchId && item.host === host(appUrl)) ||
    !endpoints.some((item) => item.branch_id === branch.parent_id && item.host === host(legacyUrl)) ||
    appUrl.username !== "missiondesk_personal_app") throw new Error("Refusing to administer the main or an unverified database.");
const uri = neon(["connection-string", branchId, "--project-id", projectId,
  "--role-name", decodeURIComponent(legacyUrl.username), "--database-name", "neondb", "--pooled", "--ssl", "verify-full"]);
const ownerUrl = new URL(typeof uri === "string" ? uri : uri.uri);
if (ownerUrl.hostname !== appUrl.hostname || ownerUrl.pathname !== appUrl.pathname) throw new Error("Wrong administrator endpoint.");
const db = new pg.Pool({ connectionString: ownerUrl.toString(), max: 1 });
try {
  const subject = `${values.AUTH0_DOMAIN.toLowerCase()}|${userId}`;
  const account = (await db.query(`SELECT id, status, plan, llm_monthly_budget_micros, social_monthly_budget_micros
    FROM product_accounts WHERE auth_subject = $1`, [subject])).rows[0];
  if (!account || account.status !== "active") throw new Error("The existing active account was not found; refusing to create a replacement.");
  const before = (await db.query(`SELECT home_country, target_country, language, content_language FROM product_account_preferences WHERE account_id = $1`, [account.id])).rows[0];
  if (action === "promote") {
    const updated = neon(["api", `/projects/${projectId}/branches/${branchId}`, "--method", "PATCH", "--data",
      JSON.stringify({ branch: { name: "missiondesk-personal-pilot", expires_at: null } })]);
    branch = updated.branch;
    if (branch.id !== branchId || branch.name !== "missiondesk-personal-pilot" || branch.expires_at != null || branch.default || branch.primary) {
      throw new Error("The branch's permanent status could not be verified.");
    }
    await db.query(`INSERT INTO product_username_logins (account_id, connection_name, display_name, enabled)
      VALUES ($1, $2, 'Daniel', true) ON CONFLICT (account_id) DO UPDATE
      SET connection_name = EXCLUDED.connection_name, display_name = EXCLUDED.display_name, enabled = true, updated_at = now()`,
    [account.id, credentials.AUTH0_CONNECTION]);
    auth0("patch", userEndpoint, { name: "Daniel", app_metadata: { missiondesk_account_state: "pilot" } });
    const nextEnv = { ...values, MISSIONDESK_PERSONAL_DATA_MODE: "pilot", MISSIONDESK_DANIEL_AUTH0_USER_ID: userId,
      MISSIONDESK_USERNAME_CONNECTION: credentials.AUTH0_CONNECTION, MISSIONDESK_TEST_BRANCH_NAME: branch.name,
      MISSIONDESK_TEST_BRANCH_EXPIRES_AT: "" };
    delete nextEnv.MISSIONDESK_LOCAL_DEMO_USER_ID;
    savePrivate(".env.personal.local", nextEnv);
  } else if (action === "norwegian-interface") {
    const updated = await db.query(`UPDATE product_username_logins SET interface_profile = 'norwegian', updated_at = now()
      WHERE account_id = $1 AND connection_name = $2 AND enabled = true RETURNING account_id`, [account.id, credentials.AUTH0_CONNECTION]);
    if (updated.rowCount !== 1) throw new Error("The existing managed login could not be configured.");
    await db.query("UPDATE product_account_preferences SET language = 'nb', updated_at = now() WHERE account_id = $1 AND language = 'sv'", [account.id]);
  } else if (action !== "status") {
    if (branch.expires_at || values.MISSIONDESK_PERSONAL_DATA_MODE !== "pilot") throw new Error("Promote the account before changing its permanent credentials.");
    const approval = (await db.query("SELECT enabled FROM product_username_logins WHERE account_id = $1 AND connection_name = $2", [account.id, credentials.AUTH0_CONNECTION])).rows[0];
    if (!approval?.enabled) throw new Error("The managed login has not been approved.");
    let next;
    if (existsSync(pendingPath)) {
      if ((statSync(pendingPath).mode & 0o077) !== 0) throw new Error("Pending credentials must be private (0600).");
      next = parseEnv(readFileSync(pendingPath, "utf8"));
      if (next.AUTH0_USER_ID !== userId || next.AUTH0_DOMAIN !== credentials.AUTH0_DOMAIN ||
          next.AUTH0_CONNECTION !== credentials.AUTH0_CONNECTION || next.ACTION !== action ||
          (action === "rename" && next.USERNAME !== username)) throw new Error("Resolve the pending credential change before another change.");
    } else {
      next = { ...credentials, USERNAME: user.username, ACTION: action };
      if (action === "rename") next.USERNAME = username;
      else {
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let token;
        do { token = Array.from({ length: 13 }, () => alphabet[randomInt(alphabet.length)]).join(""); }
        while (!/[A-Z]/.test(token) || !/[2-9]/.test(token));
        next.PASSWORD = `${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8)}`;
      }
      savePrivate(pendingPath, next);
    }
    if (typeof next.PASSWORD !== "string" || next.PASSWORD.length < 15 ||
        !/^[a-z0-9][a-z0-9_-]{2,29}$/.test(next.USERNAME)) throw new Error("Invalid pending credentials.");
    // Revoke application sessions before the provider request, including uncertain responses.
    await db.query("UPDATE product_username_logins SET sessions_valid_after = now(), updated_at = now() WHERE account_id = $1", [account.id]);
    const body = action === "rename" ? { username: next.USERNAME } : { password: next.PASSWORD };
    const changed = auth0("patch", userEndpoint, { connection: credentials.AUTH0_CONNECTION, ...body });
    if (changed.user_id !== userId || changed.username !== next.USERNAME) throw new Error("Unexpected identity update; recovery credentials retained.");
    delete next.ACTION;
    savePrivate(path, next);
    unlinkSync(pendingPath);
  }
  const after = (await db.query("SELECT home_country, target_country, language, content_language FROM product_account_preferences WHERE account_id = $1", [account.id])).rows[0];
  const expected = action === "norwegian-interface" && before?.language === "sv" ? { ...before, language: "nb" } : before;
  if (JSON.stringify(expected) !== JSON.stringify(after)) throw new Error("Unexpected profile change.");
  console.log(JSON.stringify({ action, username: action === "rename" ? username : user.username,
    sameAccountId: true, profilePreserved: true, plan: account.plan, expiresAt: branch.expires_at ?? null,
    credentialsFile: path, published: false }));
} finally { await db.end(); }
