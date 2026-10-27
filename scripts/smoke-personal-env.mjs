import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPersonalTestEnvironment } from "./personal-test-env.mjs";

const root = mkdtempSync(join(tmpdir(), "missiondesk-personal-env-"));
const path = join(root, ".env.personal.local");
const env = {
  MISSIONDESK_ACCESS_MODE: "personal", MISSIONDESK_LOCAL_PREVIEW: "true", MISSIONDESK_TEST_BRANCH_ID: "br-test-only",
  DATABASE_URL: "postgresql://test:test@ep-test.example/neondb", APP_BASE_URL: "http://localhost:3001",
  AUTH0_DOMAIN: "test.us.auth0.com", AUTH0_CLIENT_ID: "test", AUTH0_CLIENT_SECRET: "test", AUTH0_SECRET: "a".repeat(64),
};
function write(values) {
  writeFileSync(path, Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n"), { mode: 0o600 });
}
try {
  writeFileSync(join(root, ".env.local"), 'DATABASE_URL="postgresql://test:test@ep-live-pooler.example/neondb"\n');
  write(env);
  const config = readPersonalTestEnvironment(root);
  assert.equal(config.port, 3001);
  for (const key of ["OPENAI_API_KEY", "X_API_BEARER_TOKEN", "X_BEARER_TOKEN", "TWITTER_BEARER_TOKEN", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]) {
    assert.equal(config.env[key], "");
  }
  for (const url of ["postgresql://test:test@ep-live.example/neondb", "postgresql://test:test@ep-live-pooler.example/anotherdb"]) {
    write({ ...env, DATABASE_URL: url });
    assert.throws(() => readPersonalTestEnvironment(root), /live database endpoint/);
  }
  write({ ...env, APP_BASE_URL: "http://localhost:3000" });
  assert.throws(() => readPersonalTestEnvironment(root), /isolated local preview/);
  write({ ...env, MISSIONDESK_TEST_BRANCH_ID: "" });
  assert.throws(() => readPersonalTestEnvironment(root), /branch ID/);
  write({ ...env, AUTH0_CLIENT_SECRET: "" });
  assert.throws(() => readPersonalTestEnvironment(root), /Configure Auth0/);
  assert.doesNotThrow(() => readPersonalTestEnvironment(root, { requireAuth: false }));
  write(env);
  chmodSync(path, 0o644);
  assert.throws(() => readPersonalTestEnvironment(root), /0600/);
  console.log("[smoke:personal-env] Production endpoint, port, branch identity, secret-file permissions and paid-provider isolation passed.");
} finally {
  rmSync(root, { recursive: true });
}
