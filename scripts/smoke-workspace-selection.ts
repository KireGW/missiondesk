import assert from "node:assert/strict";
import { mexicoStates, detectWorkspaceCountries } from "@/lib/product/workspace-geography";
import { assessWorkspaceText } from "@/lib/product/workspace-assessment";
import { evaluateCandidate, publicCandidate, type WorkspacePolicy } from "@/lib/product/workspace-candidates";
import { workspaceArticleToItem } from "@/lib/product/workspace-items";
import { selectBalancedWorkspaceItems } from "@/lib/product/workspace-selection";
import { personalMessages, personalRelevanceExplanation } from "@/lib/product/messages";
import type { IntelligenceItem } from "@/lib/types";

const policy: WorkspacePolicy = { id: "no", homeCountry: "NO", countries: ["MX", "NI", "CR", "GT", "HN", "SV", "BZ"] };
const now = Date.parse("2026-11-04T14:00:00Z");
assert.equal(mexicoStates.length, 32);
for (const state of mexicoStates) {
  assert.ok(detectWorkspaceCountries(`Nueva inversión en el estado de ${state}`, "").includes("MX"), state);
}
for (const title of ["Nuevo León anuncia inversión extranjera", "Querétaro aumenta exportaciones", "Monterrey impulsa el comercio",
  "Banxico anticipa un repunte de inflación", "Pemex presenta resultados financieros", "Revisión del T–MEC: nuevos aranceles",
  "Sheinbaum anuncia inversiones", "El gobierno de Guerrero aprueba una reforma"]) {
  assert.ok(detectWorkspaceCountries(title, "").includes("MX"), title);
}
for (const title of ["New Mexico approves investment legislation", "Nuevo México aprueba una reforma", "Guerrero visita Honduras",
  "Carlos Hidalgo comenta las exportaciones", "Durango, Colorado announces investment", "Tabasco sauce exports rise",
  "Chihuahua puppies win competition", "New investment and nearshoring opportunities", "Company sat through a trade meeting",
  "Guadalajara, Spain approves investment", "Toluca, Illinois reports growth", "Saltillo, Mississippi trade fair"]) {
  assert.ok(!detectWorkspaceCountries(title, "", "el-financiero").includes("MX"), title);
}
assert.ok(detectWorkspaceCountries("Nuevas inversiones en Hidalgo", "", "el-financiero").includes("MX"));
assert.ok(!detectWorkspaceCountries("Nuevas inversiones en Hidalgo", "", "unknown").includes("MX"));
assert.ok(detectWorkspaceCountries("CFE anuncia inversiones en electricidad", "", "el-financiero").includes("MX"));
assert.ok(!detectWorkspaceCountries("CFE anuncia inversiones en electricidad", "", "unknown").includes("MX"));
assert.ok(!detectWorkspaceCountries("SAT anuncia nuevos impuestos en Guatemala", "", "el-financiero").includes("MX"));

function item(id: string, title: string, excerpt = "", source = "el-financiero", ageHours = 0): IntelligenceItem {
  const candidate = publicCandidate({ sourceId: source, title, excerpt, url: `https://fixture.example/${id}`,
    publishedAt: new Date(now - ageHours * 3_600_000).toISOString() }, "fixture.example");
  const decision = evaluateCandidate(candidate, policy, now);
  return workspaceArticleToItem({ id, source_id: source, title, excerpt, url: candidate.url, name: source, language: "en",
    published_at: new Date(candidate.publishedAt!), countries: candidate.countries, score: decision.score }, policy);
}
const trade = item("trade", "Nuevo León revisa aranceles al comercio exterior", "Nuevos aranceles y revisión del T-MEC.");
const murder = item("crime", "Belize police investigate a murder", "A man was arrested in connection with the shooting.", "belize-source");
assert.ok(trade.workspace_relevance! > murder.workspace_relevance!);
assert.ok(murder.workspace_relevance_reasons!.includes("local_crime"));
assert.ok(trade.workspace_relevance_reasons!.includes("local_geography"));
assert.ok(trade.workspace_relevance_reasons!.includes("economic_policy"));
for (const title of ["Mujer asesinada en Culiacán", "Investigan un feminicidio en Jalisco", "Belize investigates two murders", "Lokalt mord i Belize", "Mann drept i Belize"]) {
  assert.ok(assessWorkspaceText(title, "", policy).evidence.includes("local_crime"), title);
}
for (const [title, excerpt] of [
  ["Belize declares a state of public emergency after shootings", "New security measures take effect."],
  ["Norwegian tourist murdered in Belize", "Police investigate the shooting."],
  ["Guatemala journalist murdered after exposing corruption", "Human rights groups demand an investigation."],
  ["Honduras reports five people killed in an attack", "Police report a massacre."],
  ["Belize murder rate surges", "The homicide rate rises across the country."],
  ["Norsk turist drept i Belize", "Politiet etterforsker saken."],
]) {
  const result = assessWorkspaceText(title, excerpt, policy);
  assert.ok(!result.evidence.includes("local_crime"), title);
  assert.ok(result.score >= 45, title);
}
const emergency = item("emergency", "Belize declares a state of public emergency after shootings", "Police respond to the emergency.", "belize-source");
assert.ok(emergency.workspace_relevance! >= 75);
const anniversary = assessWorkspaceText("Mitch, el huracán que hizo retroceder Honduras: a 28 años de la tragedia", "Un recuerdo de la tragedia.", policy);
assert.ok(anniversary.evidence.includes("low_priority"));

const crimes = Array.from({ length: 14 }, (_, i) => item(`crime-${i}`, `Belize police investigate murder case ${i}`, "A local shooting is under investigation.", "belize-source"));
const alternatives = [
  trade, item("energy", "Pemex announces investment in renewable energy", "", "mexico-energy"),
  item("guatemala", "Guatemala congress approves election reform", "", "guatemala-source"),
  item("costa-rica", "Costa Rica announces new foreign investment", "", "costa-rica-source"),
  item("nicaragua", "Nicaragua defends press freedom and human rights", "", "nicaragua-source"),
  item("honduras", "Honduras approves new refugee asylum law", "", "honduras-source"),
];
const input = [...crimes, ...alternatives, emergency];
const before = JSON.stringify(input);
const selected = selectBalancedWorkspaceItems(input, policy, 8, now);
assert.equal(selected.length, 8);
assert.ok(selected.some(row => row.id === trade.id));
assert.ok(selected.some(row => row.id === emergency.id));
assert.ok(selected.filter(row => row.workspace_relevance_reasons?.includes("local_crime")).length <= 1);
assert.equal(JSON.stringify(input), before, "Selection must never mutate raw material or assessment evidence");
assert.deepEqual(selectBalancedWorkspaceItems([...input].reverse(), policy, 8, now), selected, "Input order must not decide the selected countries");

const syndicated = { ...trade, id: "syndicated", source_name: "other", source_url: "https://other.example/copy" };
assert.equal(selectBalancedWorkspaceItems([trade, syndicated], policy, 5, now).length, 1);
const sameGenericHeading = { ...emergency, id: "another-country", geographic_tags: ["MX"], source_url: "https://other.example/emergency" };
assert.equal(selectBalancedWorkspaceItems([emergency, sameGenericHeading], policy, 5, now).length, 2, "Identical generic headlines in different countries are not the same event");
const allMexico = alternatives.map((row, i) => ({ ...row, id: `important-${i}`, source_name: `source-${i}`, source_url: `https://source-${i}.example/a`,
  title_original: `Important Mexican trade reform ${i}`, geographic_tags: ["MX"], workspace_relevance: 90 }));
assert.equal(selectBalancedWorkspaceItems([...allMexico, { ...murder, workspace_relevance: 45 }], policy, allMexico.length, now)
  .filter(row => row.geographic_tags.includes("MX")).length, allMexico.length, "No country quota may displace materially stronger news");
assert.deepEqual(selectBalancedWorkspaceItems(input, policy, 0, now), []);
for (const language of ["sv", "nb", "en", "es"] as const) {
  const messages = personalMessages(language);
  for (const reason of ["local_geography", "local_crime", "economic_policy"] as const) assert.ok(messages.relevanceReasons[reason]);
  assert.ok(personalRelevanceExplanation(trade, language, "NO").every(text => !text.includes("undefined")));
}
console.log("[smoke:workspace-selection] All 32 Mexican entities, ambiguous names/acronyms, local crime versus crises and trade, diversity, syndicated copies, country isolation, deterministic selection and no hard country quotas passed; no live services.");
