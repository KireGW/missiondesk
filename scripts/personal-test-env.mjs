import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export function readPersonalTestEnvironment(root = process.cwd(), { requireAuth = true } = {}) {
  const path = resolve(root, ".env.personal.local");
  const values = parseEnv(readFileSync(path, "utf8"));
  if ((statSync(path).mode & 0o077) !== 0) throw new Error("The personal test env file must have permissions 0600.");
  if (values.MISSIONDESK_ACCESS_MODE !== "personal" || values.MISSIONDESK_LOCAL_PREVIEW !== "true") {
    throw new Error("A separately configured personal preview is required.");
  }
  function databaseUrl(value) {
    try {
      const url = new URL(value);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
      return url;
    } catch {
      throw new Error("A valid Postgres URL is required; its value is withheld.");
    }
  }
  const database = databaseUrl(values.DATABASE_URL);
  const legacy = parseEnv(readFileSync(resolve(root, ".env.local"), "utf8"));
  const legacyDatabase = databaseUrl(legacy.DATABASE_URL);
  const endpoint = (url) => url.hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
  if (endpoint(database) === endpoint(legacyDatabase)) throw new Error("Refusing to use the live database endpoint for personal tests.");
  if (!/^br-[a-z0-9-]+$/.test(values.MISSIONDESK_TEST_BRANCH_ID ?? "")) throw new Error("A verified test branch ID is required.");
  const baseUrl = new URL(values.APP_BASE_URL);
  if (baseUrl.origin !== "http://localhost:3001" || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash || baseUrl.username || baseUrl.password) {
    throw new Error("The isolated local preview must use http://localhost:3001.");
  }
  if (requireAuth && !["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET"].every((key) => values[key])) {
    throw new Error("Configure Auth0 before starting the personal preview.");
  }
  if (requireAuth && !/^[a-f\d]{64}$/i.test(values.AUTH0_SECRET)) throw new Error("The session secret must be 32 random bytes encoded as hex.");
  return {
    values,
    env: { ...process.env, ...values, NEXT_TELEMETRY_DISABLED: "1", OPENAI_API_KEY: "", AI_GATEWAY_API_KEY: "",
      X_API_BEARER_TOKEN: "", X_BEARER_TOKEN: "", TWITTER_BEARER_TOKEN: "", VERCEL_OIDC_TOKEN: "" },
    port: 3001,
  };
}
