import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

const tenant = process.argv[2];
if (!tenant || !/^[a-z0-9.-]+\.auth0\.com$/.test(tenant)) throw new Error("Pass the verified Auth0 development tenant domain.");
const cli = process.env.AUTH0_CLI_PATH ?? "auth0";
const envPath = resolve(".env.personal.local");
execFileSync("git", ["check-ignore", "-q", envPath], { stdio: "pipe" });

function auth0(args) {
  try {
    const output = execFileSync(cli, [...args, "--tenant", tenant, "--json", "--no-input"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(output);
  } catch {
    throw new Error("Auth0 configuration failed. Provider output is withheld because it can contain credentials.");
  }
}

const name = "MissionDesk Personal Dev";
const baseUrl = "http://localhost:3001";
const apps = auth0(["apps", "list"]);
const existing = apps.find((app) => app.name === name);
if (existing && existing.client_metadata?.purpose !== "missiondesk-personal-test") {
  throw new Error("An application with this name exists without our test marker. Refusing to modify it.");
}
const app = existing
  ? auth0(["apps", "show", existing.client_id, "--reveal-secrets"])
  : auth0(["apps", "create", "--name", name, "--type", "regular", "--auth-method", "Post",
    "--grants", "code", "--callbacks", `${baseUrl}/auth/callback`, "--logout-urls", baseUrl,
    "--organization-usage", "deny", "--metadata", "purpose=missiondesk-personal-test", "--reveal-secrets"]);
if (!app.client_id || !app.client_secret || !app.callbacks?.includes(`${baseUrl}/auth/callback`)) {
  throw new Error("The Auth0 test application's credentials or callback URL could not be verified.");
}
const old = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
const values = {
  ...old,
  MISSIONDESK_ACCESS_MODE: "personal",
  MISSIONDESK_LOCAL_PREVIEW: "true",
  MISSIONDESK_TEST_BRANCH_ID: old.MISSIONDESK_TEST_BRANCH_ID ?? "",
  DATABASE_URL: old.DATABASE_URL ?? "",
  AUTH0_DOMAIN: tenant,
  AUTH0_CLIENT_ID: app.client_id,
  AUTH0_CLIENT_SECRET: app.client_secret,
  AUTH0_SECRET: old.AUTH0_DOMAIN === tenant && old.AUTH0_CLIENT_ID === app.client_id && /^[a-f\d]{64}$/i.test(old.AUTH0_SECRET ?? "")
    ? old.AUTH0_SECRET : randomBytes(32).toString("hex"),
  APP_BASE_URL: baseUrl,
};
writeFileSync(envPath, Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { mode: 0o600 });
chmodSync(envPath, 0o600);
console.log(JSON.stringify({ application: name, tenant, baseUrl, credentialsWritten: ".env.personal.local", databaseConfigured: Boolean(values.DATABASE_URL) }));
