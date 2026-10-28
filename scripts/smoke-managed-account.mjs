import assert from "node:assert/strict";
import { mock } from "node:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";

const cwd = process.cwd();
const savedArgs = process.argv;
const savedEnv = { ...process.env };
const savedLog = console.log;
const root = mkdtempSync(join(tmpdir(), "missiondesk-managed-account-"));
const subject = `auth0|${"a".repeat(24)}`;
const connection = "MissionDesk-Daniel-Dev";
const tenant = "test.us.auth0.com";
const roleUri = "postgresql://missiondesk_personal_app:test@ep-test.example/neondb";
const ownerUri = "postgresql://owner:test@ep-test.example/neondb";
const account = { id: "same-account", status: "active", plan: "free" };
const profile = { home_country: "NO", target_country: "MX", language: "nb", content_language: "original" };
let user = { user_id: subject, username: "daniel", app_metadata: { purpose: "missiondesk-daniel-local-demo" },
  identities: [{ connection }] };
let failProvider = false;
let approved = true;
let expiresAt = null;
let enabledClients = ["client"];
let onlinePurpose = "missiondesk-online-pilot";
const events = [];
function writeEnv(path, data) {
  writeFileSync(join(root, path), Object.entries(data).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600 });
  chmodSync(join(root, path), 0o600);
}
function credentials() { return parseEnv(readFileSync(join(root, ".env.daniel-demo.local"), "utf8")); }
writeEnv(".env.local", { DATABASE_URL: "postgresql://owner:test@ep-live.example/neondb" });
writeEnv(".env.personal.local", { MISSIONDESK_ACCESS_MODE: "personal", MISSIONDESK_LOCAL_PREVIEW: "true",
  MISSIONDESK_TEST_BRANCH_ID: "br-pilot", MISSIONDESK_TEST_PROJECT_ID: "project", MISSIONDESK_TEST_BRANCH_NAME: "missiondesk-personal-pilot",
  MISSIONDESK_PERSONAL_DATA_MODE: "pilot", MISSIONDESK_DANIEL_AUTH0_USER_ID: subject,
  DATABASE_URL: roleUri, APP_BASE_URL: "http://localhost:3001", AUTH0_DOMAIN: tenant,
  AUTH0_CLIENT_ID: "client", AUTH0_CLIENT_SECRET: "test", AUTH0_SECRET: "a".repeat(64) });
writeEnv(".env.daniel-demo.local", { AUTH0_DOMAIN: tenant, AUTH0_CONNECTION: connection,
  AUTH0_USER_ID: subject, USERNAME: "daniel", PASSWORD: "TEST-ONLY-SECRET-OLD" });
mock.module("node:child_process", { namedExports: { execFileSync(command, args, options) {
  if (command === "git") return "";
  const json = (value) => JSON.stringify(value);
  if (command === "fake-auth0") {
    const [, method, path] = args;
    if (method === "patch") {
      const body = JSON.parse(options.input);
      events.push({ type: "provider-update", body });
      if (failProvider) throw new Error("Simulated uncertain provider response");
      if (body.username) user = { ...user, username: body.username };
      return json(user);
    }
    if (path === "clients/online-pilot") return json({ client_id: "online-pilot", app_type: "regular_web", callbacks: ["https://pilot.example/auth/callback"], client_metadata: { purpose: onlinePurpose } });
    if (path.startsWith("clients/")) return json({ client_id: "client", app_type: "regular_web", callbacks: ["http://localhost:3001/auth/callback"], client_metadata: { purpose: "missiondesk-personal-test" } });
    if (path.startsWith("users/")) return json(user);
    if (path.startsWith("connections?")) return json([{ name: connection, id: "conn" }]);
    if (path.endsWith("/clients")) return json(enabledClients.map(client_id=>({client_id})));
    if (path === "connections/conn") return json({ strategy: "auth0", metadata: { purpose: "missiondesk-daniel-local-demo" },
      options: { disable_signup: true, brute_force_protection: true, attributes: { username: { identifier: { active: true } } } } });
  }
  if (command === "npx") {
    if (args.includes("get")) return json({ id: "br-pilot", parent_id: "br-main", name: "missiondesk-personal-pilot", expires_at: expiresAt });
    if (args.includes("connection-string")) return json({ uri: ownerUri });
    if (args.some((arg) => arg.endsWith("/endpoints"))) return json({ endpoints: [
      { branch_id: "br-main", host: "ep-live.example" }, { branch_id: "br-pilot", host: "ep-test.example" },
    ] });
  }
  throw new Error("Unexpected external command in managed-account tests");
} } });
mock.module("pg", { defaultExport: { Pool: class {
  async query(sql) {
    if (sql.includes("FROM product_accounts")) return { rows: [account] };
    if (sql.includes("FROM product_account_preferences")) return { rows: [{ ...profile }] };
    if (sql.includes("SELECT enabled")) return { rows: [{ enabled: approved }] };
    if (sql.startsWith("UPDATE product_username_logins")) {
      events.push({ type: sql.includes("interface_profile") ? "configure-interface" : "revoke-sessions" }); return { rowCount: 1 };
    }
    if (sql.startsWith("UPDATE product_account_preferences")) {
      assert.match(sql,/SET language = 'en'/);
      assert.match(sql,/AND language = 'sv'/,"A valid saved Norwegian-profile language must not be reset");
      if(profile.language!=="sv") return {rowCount:0};
      profile.language="en";
      return {rowCount:1};
    }
    throw new Error("Credential updates must not write accounts, profiles or engine tables");
  }
  async end() {}
} } });
let run = 0;
async function invoke(...args) {
  process.argv = ["node", "manage-daniel-account.mjs", ...args];
  await import(new URL(`./manage-daniel-account.mjs?test=${run++}`, import.meta.url));
}
try {
  process.chdir(root);
  delete process.env.VERCEL;
  process.env.AUTH0_CLI_PATH = "fake-auth0";
  process.env.MISSIONDESK_NEON_CONFIG_DIR = "fake-config";
  process.env.MISSIONDESK_NEON_PROFILE = "fake-profile";
  console.log = () => {};
  await assert.rejects(invoke("rename", "not/an/identifier"), /Use status/);
  assert.equal(events.length, 0);
  const initialCredentials = credentials();
  await invoke("norwegian-interface");
  assert.deepEqual(credentials(), initialCredentials, "Changing interface options must not change authentication credentials");
  assert.deepEqual(events, [{ type: "configure-interface" }]);
  for(const language of ["en","nb","es"]) {
    profile.language=language;
    await invoke("norwegian-interface");
    assert.equal(profile.language,language,"Existing valid preferences must survive profile setup");
  }
  profile.language="sv";
  await invoke("norwegian-interface");
  assert.equal(profile.language,"en","An unavailable language must fall back to English, not force Norwegian");
  profile.language="nb";
  events.length = 0;
  await invoke("rename", "daniel-new");
  assert.equal(credentials().AUTH0_USER_ID, subject);
  assert.equal(credentials().USERNAME, "daniel-new");
  assert.equal(credentials().PASSWORD, "TEST-ONLY-SECRET-OLD");
  assert.equal(events[0].type, "revoke-sessions");
  assert.deepEqual(events[1].body, { connection, username: "daniel-new" });
  events.length = 0;
  await invoke("rotate-password");
  const rotated = credentials();
  assert.equal(rotated.AUTH0_USER_ID, subject);
  assert.equal(rotated.USERNAME, "daniel-new");
  assert.equal(rotated.PASSWORD.length, 15);
  assert.match(rotated.PASSWORD, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(events[0].type, "revoke-sessions");
  assert.equal(events[1].body.password, rotated.PASSWORD);
  assert.equal(events[1].body.username, undefined, "Username and password are separate provider operations");
  assert.equal(existsSync(join(root, ".env.daniel-account.pending.local")), false);
  events.length = 0;
  failProvider = true;
  await assert.rejects(invoke("rotate-password"), /private provider output withheld/);
  const pending = parseEnv(readFileSync(join(root, ".env.daniel-account.pending.local"), "utf8"));
  assert.equal(credentials().PASSWORD, rotated.PASSWORD, "An uncertain provider response must not overwrite current credentials");
  assert.equal(events[0].type, "revoke-sessions");
  failProvider = false;
  await invoke("rotate-password");
  assert.equal(credentials().PASSWORD, pending.PASSWORD, "Retries must recover the same pending password");
  assert.equal(existsSync(join(root, ".env.daniel-account.pending.local")), false);
  events.length = 0;
  approved = false;
  await assert.rejects(invoke("rename", "unauthorized"), /not been approved/);
  assert.equal(events.length, 0);
  approved = true;
  expiresAt = "2099-01-01";
  await assert.rejects(invoke("rotate-password"), /Promote the account/);
  assert.equal(events.length, 0);
  expiresAt = null;
  writeEnv(".env.pilot.local", { PILOT_PURPOSE: "missiondesk-online-pilot", AUTH0_DOMAIN: tenant,
    AUTH0_CLIENT_ID: "online-pilot", APP_BASE_URL: "https://pilot.example", DATABASE_URL: roleUri, MISSIONDESK_PILOT_INVITE_ONLY: "true" });
  enabledClients = ["client", "online-pilot"];
  await invoke("status");
  assert.equal(events.length, 0, "The verified online client must not require credential changes or affect local access");
  enabledClients = ["client", "unexpected-client"];
  await assert.rejects(invoke("status"), /not safely isolated/);
  enabledClients = ["client", "online-pilot"];
  onlinePurpose = "untrusted";
  await assert.rejects(invoke("status"), /Unexpected online pilot/);
  assert.equal(events.length, 0);
} finally {
  process.chdir(cwd);
  process.argv = savedArgs;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  console.log = savedLog;
  mock.restoreAll();
  rmSync(root, { recursive: true });
}
console.log("[smoke:managed-account] Stable identity, separate username/password changes, session revocation, private recovery and authorization checks passed. No live services called.");
