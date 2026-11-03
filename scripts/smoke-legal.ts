import assert from "node:assert/strict";
import { format } from "node:url";
import { footerMessages, legalHref, legalLanguage } from "@/lib/product/footer";
import { legalMessages } from "@/lib/product/legal";
import type { PersonalLanguage } from "@/lib/product/profiles";

for (const language of ["en", "nb", "es", "sv"] satisfies PersonalLanguage[]) {
  assert.equal(legalLanguage(language), language);
  const copy = legalMessages[language];
  assert.ok(copy.title && copy.operator && footerMessages[language].navigation);
  const ids = copy.sections.map(section => section.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("copyright"));
  for (const section of copy.sections) {
    assert.ok(section.title && section.paragraphs.length);
    assert.ok(section.paragraphs.every(paragraph => paragraph.trim().length > 40));
  }
  const url = new URL(format(legalHref(language, "copyright")), "https://missiondesk-pilot.vercel.app");
  assert.equal(url.origin, "https://missiondesk-pilot.vercel.app");
  assert.equal(url.pathname, "/legal");
  assert.equal(url.searchParams.get("lang"), language);
  assert.ok(ids.includes(url.hash.slice(1) as typeof ids[number]));
  assert.equal(format(legalHref(language)), `/legal?lang=${language}`);
}
for (const invalid of [undefined, "", "de", "EN", "__proto__", "constructor", ["en", "sv"], "<script>"]) {
  assert.equal(legalLanguage(invalid), "en");
}
console.log("[smoke-legal] Four languages, valid footer links/anchors and safe locale fallback passed. No network or database access.");
