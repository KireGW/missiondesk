import assert from "node:assert/strict";
import { load } from "cheerio";

const [baseUrl = "https://missiondesk-pilot.vercel.app", mode = "pilot"] = process.argv.slice(2);
const base = new URL(baseUrl);
assert.ok(["pilot", "standard"].includes(mode), "Use pilot or standard login presentation");
assert.ok(["localhost", "127.0.0.1", "missiondesk-pilot.vercel.app"].includes(base.hostname));
assert.ok(!base.username && !base.password && base.pathname === "/" && !base.search && !base.hash);
assert.equal(base.protocol, base.hostname === "missiondesk-pilot.vercel.app" ? "https:" : "http:");

const request = (path, options = {}) => fetch(new URL(path, base), { ...options, redirect: "manual", signal: AbortSignal.timeout(20_000) });
let directLogin;
if (mode === "pilot") {
  for (const path of ["/", "/account"]) {
    const response = await request(path);
    assert.equal(response.status, 307, "An anonymous pilot visit should skip the intermediary page");
    assert.match(response.headers.get("cache-control") ?? "", /private/);
    const destination = new URL(response.headers.get("location"), base);
    assert.equal(destination.origin, base.origin);
    assert.equal(destination.pathname, "/auth/login");
    assert.ok(destination.searchParams.get("connection"));
    directLogin = destination;
  }
}
const response = await request(mode === "pilot" ? "/signed-out" : "/account");
assert.equal(response.status, 200);
assert.match(response.headers.get("cache-control") ?? "", /private/);
const $ = load(await response.text());
assert.equal($("h2").text(), mode === "pilot" ? "Signed out" : "Sign in", "Verify the anonymous state without creating a login loop");
assert.equal($("h1 a").text(), "MissionDesk");
const logo = $("h1 img");
assert.equal(logo.length, 1, "The brand symbol must accompany the accessible wordmark");
assert.equal(logo.attr("alt"), "", "The decorative symbol must not duplicate the link's accessible name");
assert.ok(logo.attr("src").includes("missiondesk-mark-v2.png"));
assert.equal(logo.attr("width"), "36");
assert.equal(logo.attr("height"), "36");
const links = $("a").toArray().map(element => ({
  url: new URL($(element).attr("href"), base), label: $(element).text().trim(),
})).filter(link => link.url.pathname === "/auth/login");
assert.ok(links.every(link => link.url.origin === base.origin));
const usernameLinks = links.filter(link => link.url.searchParams.has("connection"));
assert.equal(usernameLinks.length, 1);
const username = usernameLinks[0].url;
assert.match(username.searchParams.get("connection"), /^[a-zA-Z0-9][a-zA-Z0-9-]{0,126}[a-zA-Z0-9]$/);
assert.equal(username.searchParams.get("prompt"), "login");
assert.equal(username.searchParams.get("max_age"), "0");
assert.equal(username.searchParams.get("returnTo"), "/");
if (mode === "pilot") {
  assert.equal(links.length, 1, "The invite-only pilot must have one login entry");
  assert.equal(links[0].label, "Sign in");
  assert.equal(username.href, directLogin.href);
  assert.equal($("footer nav a").length, 2);
  const authorization = await request(username.href);
  assert.ok([302, 303, 307].includes(authorization.status));
  const auth0 = new URL(authorization.headers.get("location"));
  assert.equal(auth0.origin, "https://dev-yddc40vbamddmuju.us.auth0.com");
  assert.equal(auth0.pathname, "/authorize");
  assert.equal(auth0.searchParams.get("connection"), username.searchParams.get("connection"));
  assert.equal(auth0.searchParams.get("prompt"), "login");
  assert.equal(auth0.searchParams.get("max_age"), "0");
  assert.equal(auth0.searchParams.get("code_challenge_method"), "S256");
  assert.ok(auth0.searchParams.get("state") && auth0.searchParams.get("nonce"));
  assert.match(authorization.headers.get("set-cookie") ?? "", /httponly/i);
  const logout = await request("/auth/logout?returnTo=https://attacker.invalid/", {
    headers: { Cookie: "missiondesk_session=invalid-test-cookie" },
  });
  assert.ok([302, 303, 307].includes(logout.status));
  const provider = new URL(logout.headers.get("location"));
  assert.equal(provider.origin, auth0.origin);
  assert.ok(["/oidc/logout", "/v2/logout"].includes(provider.pathname));
  const origin = base.hostname === "127.0.0.1" ? base.origin.replace("127.0.0.1", "localhost") : base.origin;
  assert.equal(provider.searchParams.get("post_logout_redirect_uri") ?? provider.searchParams.get("returnTo"), `${origin}/signed-out`);
  assert.match(logout.headers.get("set-cookie") ?? "", /missiondesk_session=;.*Max-Age=0/i);
} else {
  assert.equal(links.length, 2, "Keep standard login and the optional username path outside the pilot");
  assert.ok(links.some(link => !link.url.search));
}
console.log(`[verify-login-entry] ${mode}: login presentation, managed connection, reauthentication and home return passed${mode === "pilot" ? "; direct entry, PKCE, nonces, logout target and cookie clearing verified" : ""}. No Auth0 page followed, user login or source scan.`);
