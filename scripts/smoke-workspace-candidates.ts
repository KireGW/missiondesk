import assert from "node:assert/strict";
import { evaluateCandidate, publicCandidate, workspacePolicyKey, type WorkspacePolicy } from "../src/lib/product/workspace-candidates";
import { parsePilotFeed } from "../src/lib/product/workspace-ingestion";
import { sourcePlainText } from "../src/lib/product/source-text";

const no: WorkspacePolicy = { id: "norway", homeCountry: "NO", countries: ["MX", "NI", "CR", "GT", "HN", "SV", "BZ"] };
const se: WorkspacePolicy = { id: "sweden", homeCountry: "SE", countries: ["MX"] };
const now = Date.now();
const candidate = (title: string, url = "https://fixture.example/a") => publicCandidate({ sourceId: "fixture", url, title, excerpt: "", publishedAt: new Date(now).toISOString() }, "fixture.example");
const norway = candidate("Norway and Mexico meet today");
assert.equal(evaluateCandidate(norway, no, now).status, "selected");
assert.equal(evaluateCandidate(norway, se, now).status, "held");
for (const order of [[no,se],[se,no]]) {
  const results = Object.fromEntries(order.map(p => [p.id, evaluateCandidate(norway,p,now)]));
  assert.deepEqual(results.norway, evaluateCandidate(norway,no,now));
  assert.deepEqual(results.sweden, evaluateCandidate(norway,se,now));
}
assert.equal(evaluateCandidate(candidate("Sin referencias geográficas"), no, now).status, "held");
assert.equal(evaluateCandidate({ ...norway, publishedAt: null },no,now).reason, "missing_date");
assert.equal(evaluateCandidate({ ...norway, publishedAt: new Date(now + 86_400_000).toISOString() },no,now).reason, "future_date");
assert.equal(evaluateCandidate(candidate("Guatemala comercio con Mexico"),no,now).status, "selected");
assert.deepEqual(candidate("Norge og Nicaragua møtes").countries.sort(), ["NI","NO"]);
assert.equal(candidate("Noruegalandia Mexicox").countries.length, 0);
assert.equal(candidate("Original", "https://fixture.example/a?utm_source=test#x").id, candidate("Original").id);
assert.notEqual(candidate("New title").contentHash, candidate("Original").contentHash);
assert.notEqual(workspacePolicyKey(no),workspacePolicyKey(se));
assert.notEqual(workspacePolicyKey(no),workspacePolicyKey({...no,countries:["MX"]}));
assert.throws(()=>candidate("Bad", "https://other.example/a"));
assert.throws(()=>candidate("Bad", "http://fixture.example/a"));
assert.throws(()=>candidate("Bad", "https://user:secret@fixture.example/a"));
const source = { id:"fixture", feedUrl:"https://fixture.example/feed", host:"fixture.example" };
const item = (n: number) => `<item><title>Norway and Mexico ${n}</title><link>https://fixture.example/${n}</link><pubDate>${new Date(now).toUTCString()}</pubDate></item>`;
assert.equal(parsePilotFeed(`<rss><channel>${Array.from({length:21},(_,i)=>item(i)).join("")}</channel></rss>`,source).truncated,true);
assert.equal(parsePilotFeed(`<rss><channel>${item(1)}</channel></rss>`,source).items.length,1);
assert.throws(()=>parsePilotFeed('<html>Not a feed</html>',source));
assert.throws(()=>parsePilotFeed('<!DOCTYPE rss [<!ENTITY boom "x">]><rss/>',source));
assert.throws(()=>parsePilotFeed('<rss><channel><item><title>Missing link</title></item></channel></rss>',source));
assert.equal(parsePilotFeed('<feed><entry><title>Norway and Mexico</title><link href="https://fixture.example/atom" rel="alternate"/><updated>2026-10-27T00:00:00Z</updated></entry></feed>',source).items[0].publishedAt,null,
  "An update timestamp is not evidence of the original publication date");
for (const [raw, expected] of [
  ["Costa Rica&#8217;s Government", "Costa Rica’s Government"],
  ["Nicaragua [&#8230;]", "Nicaragua […]"],
  ["M&#xE9;xico &amp; Noruega", "México & Noruega"],
  ["&ldquo;Imposible&rdquo; &mdash; &eacute;xito &ntilde; &oslash; &aring; &auml;", "“Imposible” — éxito ñ ø å ä"],
  ["&amp;#8217; &amp;hellip; &amp;amp;", "’ … &"],
  ["<p>México&nbsp; y <b>Noruega</b></p>", "México y Noruega"],
  ["&lt;b&gt;Guatemala&lt;/b&gt; &amp; Belize", "Guatemala & Belize"],
  ["Ålesund, México, Nicaragua, ₡30, 🇳🇴", "Ålesund, México, Nicaragua, ₡30, 🇳🇴"],
  ["&#x1F1F3;&#x1F1F4;", "🇳🇴"],
  ["2 < 3 > 1 &not-a-reference &unknown;", "2 < 3 > 1 &not-a-reference &unknown;"],
]) assert.equal(sourcePlainText(raw), expected);
assert.doesNotThrow(() => sourcePlainText("&#1114112; &#xD800; &#0; &broken;"));
assert.equal(candidate("Mexico&#8217;s trade").contentHash, candidate("Mexico’s trade").contentHash,
  "Equivalent source characters must not create different content versions");
const encoded = parsePilotFeed(`<rss><channel><item>
  <title><![CDATA[For the First Time, Women Lead Costa Rica&#8217;s Government]]></title>
  <link>https://fixture.example/entities</link><pubDate>${new Date(now).toUTCString()}</pubDate>
  <description><![CDATA[<p>Nicaragua [&#8230;] &amp; M&eacute;xico &#x1F1F3;&#x1F1F4;</p>]]></description>
</item></channel></rss>`,source).items[0];
assert.equal(encoded.title, "For the First Time, Women Lead Costa Rica’s Government");
assert.equal(encoded.excerpt, "Nicaragua […] & México 🇳🇴");
assert.ok(encoded.countries.includes("MX"), "Country hints must use decoded original text");
assert.equal(parsePilotFeed(`<rss><channel><item><title>Costa Rica&amp;#8217;s Government</title><link>https://fixture.example/plain</link></item></channel></rss>`,source).items[0].title, "Costa Rica’s Government");
console.log("[smoke:workspace] Independent decisions, versioned policies, host boundaries, bounded RSS parsing and HTML entities in CDATA/plain XML passed.");
