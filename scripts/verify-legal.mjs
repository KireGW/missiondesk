import assert from "node:assert/strict";
import { load } from "cheerio";

const base = new URL(process.argv[2] ?? "https://missiondesk-pilot.vercel.app");
assert.ok(["localhost", "127.0.0.1", "missiondesk-pilot.vercel.app"].includes(base.hostname));
assert.ok(!base.username && !base.password && base.pathname === "/" && !base.search && !base.hash);
assert.equal(base.protocol, base.hostname === "missiondesk-pilot.vercel.app" ? "https:" : "http:");

for (const [query, language] of [["", "en"], ["?lang=en", "en"], ["?lang=nb", "nb"], ["?lang=es", "es"], ["?lang=sv", "sv"], ["?lang=invalid", "en"], ["?lang=en&lang=nb", "en"]]) {
  const response = await fetch(new URL(`/legal${query}`, base), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, "Legal information must be available without signing in");
  assert.ok(response.headers.get("content-security-policy"), "Keep the enforced security policy");
  const $ = load(await response.text());
  assert.equal($("main").attr("lang"), language);
  assert.equal($("article h1").length, 1);
  assert.ok($("article").text().includes("Tone Tension Productions AB"));
  assert.ok($("article").text().includes("Båstad, Sweden"));
  assert.equal($("#copyright h2").length, 1);
  const footer = $("footer");
  assert.equal(footer.length, 1);
  assert.ok(footer.hasClass("missiondesk-print-screen-only"));
  assert.match(footer.find("p").text(), /© \d{4} Tone Tension Productions AB/);
  const links = footer.find("nav a").toArray();
  assert.equal(links.length, 2);
  for (const element of links) {
    const href = new URL($(element).attr("href"), base);
    assert.equal(href.origin, base.origin);
    assert.equal(href.pathname, "/legal");
    assert.equal(href.searchParams.get("lang"), language);
    if (href.hash) assert.equal($(href.hash).length, 1);
    assert.ok($(element).text().trim());
  }
  assert.equal($("a[href^='mailto:'], a[href^='tel:'], form").length, 0, "Do not expose contact details or an unconnected form");
}
const accountResponse = await fetch(new URL("/account", base), { redirect: "manual", signal: AbortSignal.timeout(20_000) });
assert.equal(accountResponse.status, 200);
const account = load(await accountResponse.text());
assert.equal(account("footer nav a").length, 2, "Show legal links before sign-in too");
console.log("[verify-legal] Anonymous legal page, four languages, fallback, copyright anchors, company notice, login footer and enforced CSP passed. No login, scans or database mutations.");
