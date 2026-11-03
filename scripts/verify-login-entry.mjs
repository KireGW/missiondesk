import assert from "node:assert/strict";
import { load } from "cheerio";

const [baseUrl = "https://missiondesk-pilot.vercel.app", mode = "pilot"] = process.argv.slice(2);
const base = new URL(baseUrl);
assert.ok(["pilot", "standard"].includes(mode), "Use pilot or standard login presentation");
assert.ok(["localhost", "127.0.0.1", "missiondesk-pilot.vercel.app"].includes(base.hostname));
assert.ok(!base.username && !base.password && base.pathname === "/" && !base.search && !base.hash);
assert.equal(base.protocol, base.hostname === "missiondesk-pilot.vercel.app" ? "https:" : "http:");

const response = await fetch(new URL("/account", base), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
assert.equal(response.status, 200);
assert.match(response.headers.get("cache-control") ?? "", /private/);
const $ = load(await response.text());
assert.equal($("h2").text(), "Sign in", "Verify an anonymous English login page, not an authenticated session");
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
} else {
  assert.equal(links.length, 2, "Keep standard login and the optional username path outside the pilot");
  assert.ok(links.some(link => !link.url.search));
}
console.log(`[verify-login-entry] ${mode}: anonymous page, login count/label, same-origin managed connection, reauthentication and home return passed. No user login or source scan.`);
