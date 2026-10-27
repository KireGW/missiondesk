import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { NextRequest } from "next/server.js";

const values = parseEnv(readFileSync(".env.personal.local", "utf8"));
assert.equal(values.MISSIONDESK_ACCESS_MODE, "personal");
assert.equal(values.APP_BASE_URL, "http://localhost:3001");
Object.assign(process.env, values);
const { getPersonalAuth } = await import("../src/lib/product/auth");
const auth = getPersonalAuth();
assert.ok(auth, "Auth0 must be genuinely configured");

// This fetches real Auth0 discovery metadata, but never supplies a user's credentials or calls the database.
const response = await auth.middleware(new NextRequest(`${values.APP_BASE_URL}/auth/login`));
assert.ok([302, 303, 307].includes(response.status), "Login must produce an authorization redirect");
const redirect = new URL(response.headers.get("location")!);
assert.equal(redirect.hostname, values.AUTH0_DOMAIN);
assert.equal(redirect.searchParams.get("client_id"), values.AUTH0_CLIENT_ID);
assert.equal(redirect.searchParams.get("response_type"), "code");
assert.equal(redirect.searchParams.get("code_challenge_method"), "S256");
assert.equal(redirect.searchParams.get("redirect_uri"), `${values.APP_BASE_URL}/auth/callback`);
assert.ok(redirect.searchParams.get("state"));
assert.ok(redirect.searchParams.get("nonce"));
const cookie = response.headers.get("set-cookie") ?? "";
assert.match(cookie, /httponly/i);
assert.match(cookie, /samesite=lax/i);
assert.equal(await auth.getSession(new NextRequest(values.APP_BASE_URL, {
  headers: { cookie: "missiondesk_session=forged-premium-session" },
})), null, "A forged session must never authenticate a user");
console.log("[smoke:auth0-setup] Real Auth0 discovery, authorization-code redirect, PKCE, nonce, callback, cookie flags and forged-cookie rejection passed. No user login or database call was performed.");
