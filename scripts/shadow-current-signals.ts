import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import type { IntelligenceItem } from "../src/lib/types";
import { analyzeCurrentSignals } from "../src/lib/product/current-signals";
import { selectBalancedWorkspaceItems } from "../src/lib/product/workspace-selection";
import { workspaceArticleToItem, type WorkspaceArticleRow } from "../src/lib/product/workspace-items";
import type { WorkspacePolicy } from "../src/lib/product/workspace-candidates";

type Story = { title: string; excerpt: string };
type EventCase = { id: string; split: "calibration" | "holdout"; language: string; countries: string[];
  base: Story; duplicate: Story; distinct: Array<Partial<Story> & { reason: string }> };
const cases = JSON.parse(readFileSync(new URL("./fixtures/current-signals-general.json", import.meta.url), "utf8")) as { events: EventCase[] };
const captured = JSON.parse(readFileSync(new URL("./fixtures/current-signals-2026-11-12.json", import.meta.url), "utf8")) as {
  now: string; policy: WorkspacePolicy; rows: Array<Omit<WorkspaceArticleRow, "published_at"> & { published_at: string }>;
  expectedOriginalIds: string[]; responseId: string; keptThreatId: string; suppressedIds: string[];
};
const material = captured.rows.map(row => workspaceArticleToItem({ ...row, published_at: new Date(row.published_at) }, captured.policy));
const ordered = selectBalancedWorkspaceItems(material, captured.policy, material.length, Date.parse(captured.now));
const seed = material[0];
function item(event: EventCase, story: Story, suffix: string): IntelligenceItem {
  const id = `${event.id}-${suffix}`;
  return { ...seed, id, source_url: `https://shadow.example/${id}`, title_original: story.title, original_excerpt: story.excerpt,
    source_language: event.language as IntelligenceItem["source_language"], geographic_tags: event.countries,
    published_at: captured.now, source_name: `Fixture ${suffix}` };
}
const results: Array<{ event: string; split: string; expectation: string; result: "duplicate" | "retained"; titles: string[]; decisions: unknown[] }> = [];
function checkPair(event: EventCase, a: IntelligenceItem, b: IntelligenceItem, duplicate: boolean, expectation: string) {
  // Check both orders and with unrelated news present; no fixture-specific corpus weighting.
  for (const pair of [[a, b], [b, a], [...ordered, a, b]]) {
    const before = JSON.stringify(pair);
    const shadow = analyzeCurrentSignals(pair, pair.length, "shadow");
    assert.deepEqual(shadow.items, pair, "Shadow mode never changes the returned selection");
    const remaining = shadow.proposedItems.filter(entry => [a.id, b.id].includes(entry.id)).length;
    if (!duplicate || event.split === "calibration") assert.equal(remaining, duplicate ? 1 : 2,
      `${event.id}: ${expectation}, order ${pair.at(-2)?.id}/${pair.at(-1)?.id}`);
    else assert.ok(remaining === 1 || remaining === 2, "An uncertain held-out duplicate may be retained, never lost altogether");
    assert.equal(JSON.stringify(pair), before, "Shadow analysis never mutates the original objects");
  }
  const shadow = analyzeCurrentSignals([a, b], 2, "shadow");
  results.push({ event: event.id, split: event.split, expectation, result: shadow.proposedItems.length === 1 ? "duplicate" : "retained",
    titles: [a.title_original, b.title_original], decisions: shadow.decisions });
}
// Keep the held-out events separate: report calibration before evaluating holdout.
for (const split of ["calibration", "holdout"] as const) {
  for (const event of cases.events.filter(event => event.split === split)) {
    const base = item(event, event.base, "base");
    checkPair(event, base, item(event, event.duplicate, "copy"), true, "same development");
    event.distinct.forEach(({ reason, ...changes }, index) => checkPair(event, base, item(event, { ...event.base, ...changes }, `new-${index}`), false, reason));
    if (split === "calibration") {
      for (const [reason, change] of Object.entries({
        "different country": { geographic_tags: ["IS"] }, "missing country": { geographic_tags: [] },
        "different language": { source_language: "fr" }, "invalid time": { published_at: "" },
        "later event": { published_at: new Date(Date.parse(captured.now) + 25 * 3_600_000).toISOString() },
        "reference page": { content_kind: "reference" },
      })) checkPair(event, base, { ...item(event, event.base, reason), ...change } as IntelligenceItem, false, reason);
    }
  }
  const evaluated = results.filter(result => result.split === split);
  const duplicates = evaluated.filter(result => result.expectation === "same development");
  const caught = duplicates.filter(result => result.result === "duplicate").length;
  assert.ok(caught >= (split === "calibration" ? duplicates.length : 5), "Catch at least five of the six independent held-out event duplicates");
  console.log(`[shadow:current-signals] ${split}: ${caught}/${duplicates.length} duplicates caught; all ${evaluated.length - duplicates.length} distinct pairs retained. Both orders and captured corpus checked.`);
}

const chainEvent: EventCase = { ...cases.events[0], id: "chain", language: "en", countries: ["BZ"] };
const a = item(chainEvent, { title: "Acme announces coastal energy project in Belize", excerpt: "The company announced the project." }, "a");
const b = item(chainEvent, { title: "Acme announces coastal energy and transport project in Belize", excerpt: a.original_excerpt! }, "b");
const c = item(chainEvent, { title: "Acme announces coastal transport project in Belize", excerpt: a.original_excerpt! }, "c");
assert.equal(analyzeCurrentSignals([a, b], 5).proposedItems.length, 1);
assert.equal(analyzeCurrentSignals([b, c], 5).proposedItems.length, 1);
assert.equal(analyzeCurrentSignals([a, c], 5).proposedItems.length, 2);
assert.equal(analyzeCurrentSignals([b, a, c], 5).proposedItems.length, 2, "A bridge headline cannot swallow two separate developments");

const before = JSON.stringify(ordered);
const shadow = analyzeCurrentSignals(ordered, 30, "shadow");
assert.deepEqual(shadow.items.map(entry => entry.id), captured.expectedOriginalIds, "The original 30 remain visible during shadow evaluation");
assert.deepEqual(shadow.decisions.map(decision => decision.id).sort(), [...captured.suppressedIds].sort(), "Review every proposed suppression in the captured 85-item pool");
assert.ok(shadow.proposedItems.some(entry => entry.id === captured.responseId), "Sheinbaum's response survives");
assert.ok(shadow.proposedItems.some(entry => entry.id === captured.keptThreatId));
assert.equal(JSON.stringify(ordered), before);
assert.deepEqual(analyzeCurrentSignals(ordered, 30, "off").items, shadow.items);
assert.deepEqual(analyzeCurrentSignals(ordered, 30, "off").decisions, []);
assert.deepEqual(analyzeCurrentSignals(ordered, 30, "apply").items, shadow.proposedItems, "Apply must exactly match the reviewed proposal");
assert.deepEqual(analyzeCurrentSignals(ordered, 30), shadow, "Deterministic results");
const canonicalCopy = { ...a, id: "tracking-copy", source_url: `${a.source_url}?utm_source=test#anchor` };
assert.equal(analyzeCurrentSignals([a, canonicalCopy], 5).items.length, 1, "Preserve existing canonical URL deduplication");
const hiddenUrlCopy = { ...b, id: "hidden-url-copy" };
const urlDecisions = analyzeCurrentSignals([a, b, hiddenUrlCopy], 5).decisions;
assert.ok(urlDecisions.every(decision => decision.representativeId === a.id), "Canonical copies always point to the visible representative");
const negated = [
  ["bank-rate", "Norges Bank does not cut policy rate to 4%"],
  ["bank-rate", "Norges Bank won't cut policy rate to 4%"],
  ["budget", "Riksdagen godkänner inte nytt stöd till järnvägen i Sverige"],
  ["arrest", "Politiet pågriper ikke tre mistenkte etter ranet i Bergen"],
  ["transport-strike", "Sindicato no anuncia huelga de transporte público en Monterrey"],
];
for (const [id, title] of negated) {
  const event = cases.events.find(event => event.id === id)!;
  checkPair(event, item(event, event.base, "base"), item(event, { ...event.base, title }, "negated"), false, "negated action");
}
for (const [left, right] of [["25%", "25 días"], ["25 toneladas", "25 barriles"], ["25 USD", "25 EUR"]]) {
  const event = cases.events[0];
  checkPair(event, item(event, { ...event.base, excerpt: left }, `unit-${left}`), item(event, { ...event.base, excerpt: right }, `unit-${right}`), false, "changed numeric unit");
}

// Upper bound used by the existing feed query; do not add a new query or scan.
const perfPool = Array.from({ length: 300 }, (_, index) => ({ ...ordered[index % ordered.length], id: `perf-${index}`, source_url: `https://perf.example/${index}` }));
const start = performance.now();
analyzeCurrentSignals(perfPool, 30);
const elapsedMs = Math.round(performance.now() - start);
assert.ok(elapsedMs < 3_000, `Bounded 300-item pool takes ${elapsedMs}ms`);
const report = {
  mode: "shadow", reviewedAt: new Date().toISOString(), syntheticCases: true,
  events: cases.events.length, labelledPairs: results.length,
  duplicatePairs: results.filter(result => result.expectation === "same development").length,
  caughtDuplicates: results.filter(result => result.expectation === "same development" && result.result === "duplicate").length,
  falseSuppressions: results.filter(result => result.expectation !== "same development" && result.result === "duplicate").length,
  missedDuplicates: results.filter(result => result.expectation === "same development" && result.result === "retained").map(result => result.event), results,
  capturedReplay: { capturedAt: captured.now, candidates: material.length, originalCount: shadow.items.length, proposedCount: shadow.proposedItems.length,
    sheinbaumResponseRetained: true, originalMaterialUnchanged: true,
    decisions: shadow.decisions.map(decision => ({ ...decision, title: material.find(entry => entry.id === decision.id)?.title_original,
      representative: material.find(entry => entry.id === decision.representativeId)?.title_original })),
    // Other actual multi-article events are intentionally retained: different actors, details or stages.
    protectedEventFamilies: ["Belize/Sarstoon response and deployment", "Mexico inflation with additional prior-period figure", "arrest coverage and background analysis"],
  },
  completeLinkChainProtected: true, deterministic: true, boundedPoolMs: elapsedMs,
};
if (process.env.MISSIONDESK_CURRENT_SIGNALS_REPORT) writeFileSync(process.env.MISSIONDESK_CURRENT_SIGNALS_REPORT, JSON.stringify(report, null, 2) + "\n");
console.log(`[shadow:current-signals] Captured 85 candidates: exactly two repeated reports proposed for suppression; Sheinbaum retained. 300-item analysis: ${elapsedMs}ms. No returned selection changed in shadow mode.`);
