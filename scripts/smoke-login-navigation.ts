import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mock } from "node:test";
import { defaultPersonalPreferences } from "@/lib/product/profiles";
import { getUsernameLogin } from "@/lib/product/username-login";

const env = {
  MISSIONDESK_ACCESS_MODE: "personal", MISSIONDESK_PILOT_INVITE_ONLY: "true",
  MISSIONDESK_USERNAME_CONNECTION: "Managed-Users", AUTH0_DOMAIN: "example.auth0.com",
  AUTH0_CLIENT_ID: "test", AUTH0_CLIENT_SECRET: "test", AUTH0_SECRET: "ab".repeat(32),
  APP_BASE_URL: "https://pilot.example",
};
const before = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(["next/navigation", "next/link"].includes(specifier) ? `${specifier}.js` : specifier, context);
  },
});
let identity: { accessVerified: boolean; managedUsername?: boolean; invitationRequired?: boolean } | null = null;
let account: { id: string; status: string; plan: string; premiumUntil: null } | null = null;
let feedReads = 0;
const dashboard = () => null;
const moduleAt = (path: string) => pathToFileURL(resolve(path));
const redirect = (location: string): never => { throw Object.assign(new Error("test redirect"), { location }); };
const expectRedirect = async (action: () => Promise<unknown>, location: string) => {
  await assert.rejects(action, error => (error as { location?: string }).location === location);
};
try {
  Object.assign(process.env, env);
  globalThis.fetch = async () => { throw new Error("Navigation tests must never call live services"); };
  mock.module(moduleAt("node_modules/next/navigation.js"), { namedExports: { redirect } });
  mock.module(moduleAt("node_modules/next/link.js"), { defaultExport: () => null });
  for (const [path, exports] of [
    ["src/lib/product/auth.ts", { getPersonalSessionIdentity: async () => identity }],
    ["src/lib/product/account.ts", { getPersonalAccount: async () => account }],
    ["src/lib/product/preferences-store.ts", { getPersonalPreferences: async () => defaultPersonalPreferences }],
    ["src/lib/product/feed-store.ts", { getPersonalFeed: async () => { feedReads++; return { items: [], briefings: [] }; } }],
    ["src/lib/product/workspace-feed.ts", { addWorkspaceFeed: async (_id: unknown, _prefs: unknown, feed: unknown) => feed }],
    ["src/components/product/PersonalDashboard.tsx", { PersonalDashboard: dashboard }],
    ["src/components/dashboard/MissionDashboard.tsx", { MissionDashboard: () => null }],
    ["src/components/product/BrandLogo.tsx", { BrandLogo: () => null }],
    ["src/components/product/ProductFooter.tsx", { ProductFooter: () => null }],
    ["src/components/product/ProfileSettings.tsx", { ProfileSettings: () => null }],
    ["src/lib/intelligence/repository.ts", { listBriefings: async () => { throw new Error("Unexpected legacy read"); }, listProcessedItems: async () => [] }],
    ["src/lib/intelligence/dashboard-view.ts", { earliestCacheExpiry: () => null, latestCacheTimestamp: () => null, processedRecordsToIntelligenceItems: () => [] }],
    ["src/lib/intelligence/dashboard-status-store.ts", { getDashboardUpdateStatus: async () => null }],
    ["src/lib/sources/store.ts", { getSources: async () => [] }],
  ] as const) mock.module(moduleAt(path), { namedExports: exports });
  const { default: home } = await import("@/app/page");
  const { default: settings } = await import("@/app/account/page");
  const { default: signedOut } = await import("@/app/signed-out/page");
  const login = getUsernameLogin()!.loginUrl;
  await expectRedirect(home, login);
  await expectRedirect(settings, login);
  assert.ok(await signedOut(), "The confirmation must remain public and must not start a new login");
  assert.equal(feedReads, 0);

  for (const denied of [{ accessVerified: false, invitationRequired: true }, { accessVerified: false, managedUsername: true }]) {
    identity = denied;
    await expectRedirect(home, "/account");
    assert.ok(await settings(), "Denied sessions must see an explanation instead of a redirect loop");
  }
  identity = { accessVerified: true };
  account = { id: "existing", status: "suspended", plan: "free", premiumUntil: null };
  await expectRedirect(home, "/account");
  assert.ok(await settings());
  assert.equal(feedReads, 0, "Inactive users must never read the feed");
  account.status = "active";
  assert.equal((await home()).type, dashboard);
  assert.ok(await settings(), "Active users must retain their account settings");
  await expectRedirect(signedOut, "/");
  assert.equal(feedReads, 1);

  identity = null; account = null;
  process.env.MISSIONDESK_PILOT_INVITE_ONLY = "false";
  await expectRedirect(home, "/account");
  assert.ok(await settings(), "Standard mode retains its existing login choices");
  process.env.MISSIONDESK_PILOT_INVITE_ONLY = "true";
  process.env.AUTH0_SECRET = "";
  await expectRedirect(home, "/account");
  assert.ok(await settings(), "Missing configuration must not cause automatic redirect loops");
  process.env.MISSIONDESK_PILOT_INVITE_ONLY = "false";
  process.env.MISSIONDESK_ACCESS_MODE = "legacy";
  await expectRedirect(settings, "/");
  await expectRedirect(signedOut, "/");
  console.log("[smoke-login-navigation] Direct pilot login, public confirmation, active/denied/revoked/suspended sessions, missing config and unchanged standard choices passed. No live services.");
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  mock.restoreAll();
  hook.deregister();
}
