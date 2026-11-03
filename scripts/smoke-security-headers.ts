import assert from "node:assert/strict";
import { mock } from "node:test";
import { NextRequest, NextResponse } from "next/server.js";
import { personalSecurityHeaders, securePersonalResponse } from "../src/lib/product/security-headers";

const request = new NextRequest("https://pilot.example/account", { headers: { "x-nonce": "attacker", "content-security-policy": "attacker" } });
const originalEnvironment = process.env.NODE_ENV;
try {
  Object.assign(process.env, { NODE_ENV: "production" });
  const security = personalSecurityHeaders(request, "test.us.auth0.com");
  const nonce = security.forwarded.get("x-nonce")!;
  assert.match(nonce, /^[A-Za-z0-9+/]{24}$/);
  assert.notEqual(nonce, personalSecurityHeaders(request).forwarded.get("x-nonce"));
  const report = security.headers.get("Content-Security-Policy-Report-Only")!;
  assert.ok(report.includes(`'nonce-${nonce}'`));
  assert.ok(!report.includes("unsafe-eval") && !report.includes("ws://"));
  assert.match(report, /upgrade-insecure-requests/);
  assert.equal(security.headers.get("Content-Security-Policy"), null, "CSP stays report-only until signed-in browser verification");
  assert.equal(security.forwarded.get("content-security-policy"), null);
  assert.match(report, /frame-ancestors 'none'/);
  assert.match(report, /form-action 'self' https:\/\/test.us.auth0.com/);
  assert.ok(!personalSecurityHeaders(request, "attacker.example; script-src *").headers.get("Content-Security-Policy-Report-Only")!.includes("attacker"));
  const response = NextResponse.next();
  response.cookies.set("test-auth-cookie", "preserved", { httpOnly: true, sameSite: "lax", secure: true });
  response.headers.set("Cache-Control", "private, no-store");
  assert.equal(securePersonalResponse(response, security), response);
  assert.match(response.headers.get("set-cookie")!, /test-auth-cookie=preserved/);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("x-middleware-request-x-nonce"), nonce);
  assert.equal(response.headers.get("x-middleware-request-content-security-policy-report-only"), report);
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(response.headers.get("X-Frame-Options"), "DENY");
  assert.match(response.headers.get("Permissions-Policy")!, /camera=\(\)/);
  const redirect = NextResponse.redirect("https://test.us.auth0.com/authorize");
  securePersonalResponse(redirect, security);
  assert.equal(redirect.headers.get("location"), "https://test.us.auth0.com/authorize");
  assert.equal(redirect.headers.get("x-middleware-next"), null);
  Object.assign(process.env, { NODE_ENV: "development" });
  assert.match(personalSecurityHeaders(request).headers.get("Content-Security-Policy-Report-Only")!, /unsafe-eval/);
} finally {
  if (originalEnvironment === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Object.assign(process.env, { NODE_ENV: originalEnvironment });
}

let authCalls = 0;
mock.module(new URL("../src/lib/product/auth.ts", import.meta.url), { namedExports: {
  getPersonalAuth: () => process.env.TEST_MISSING_AUTH ? null : { middleware: async () => { authCalls++; return NextResponse.next(); } },
} });
const { proxy } = await import("../src/proxy");
const keys = ["MISSIONDESK_ACCESS_MODE", "MISSIONDESK_PILOT_INVITE_ONLY", "TEST_MISSING_AUTH"];
const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
try {
  delete process.env.MISSIONDESK_PILOT_INVITE_ONLY;
  process.env.MISSIONDESK_ACCESS_MODE = "legacy";
  assert.equal((await proxy(request)).headers.get("X-Frame-Options"), null, "Legacy engine is unchanged");
  assert.equal(authCalls, 0);
  process.env.MISSIONDESK_ACCESS_MODE = "personal";
  assert.equal((await proxy(request)).headers.get("X-Frame-Options"), "DENY");
  assert.equal(authCalls, 1);
  process.env.TEST_MISSING_AUTH = "true";
  assert.equal((await proxy(request)).status, 503);
  process.env.MISSIONDESK_ACCESS_MODE = "invalid";
  const denied = await proxy(request);
  assert.equal(denied.status, 503);
  assert.equal(denied.headers.get("X-Content-Type-Options"), "nosniff");
} finally {
  for (const [key, value] of Object.entries(before)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  mock.restoreAll();
}
console.log("[smoke:security-headers] Personal-only headers, independent nonces, forged header overwrite, Auth0 cookies/redirects, production/development policies and fail-closed configuration passed; no external services.");
