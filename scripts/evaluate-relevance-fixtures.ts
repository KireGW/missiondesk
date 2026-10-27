import nextEnv from "@next/env";
import { mkdir, writeFile } from "node:fs/promises";
import { relevanceCases } from "./fixtures/relevance-cases";
import { processNationalSourceItemWithOpenAI } from "../src/lib/ai/national-processing";
import type { RawSourceItem } from "../src/lib/intelligence/models";

nextEnv.loadEnvConfig(process.cwd());
process.env.MISSIONDESK_PROCESSING_MODEL = "gpt-6-luna";
async function main() {
  if (!process.argv.includes("--run")) {
    console.log(JSON.stringify({ cases: relevanceCases.length, ids: relevanceCases.map((c) => c.id), note: "Pass --run for twelve synthetic, paid API evaluations; no database access." }, null, 2));
    return;
  }
  const results = [];
  for (const fixture of relevanceCases) {
    const now = new Date().toISOString();
    const raw: RawSourceItem = { id: fixture.id, title_original: fixture.title, snippet: fixture.snippet,
      url: `https://example.org/${fixture.id}`, source_name: "source" in fixture ? fixture.source : "Evaluation News",
      source_country: "source" in fixture ? "Sverige" : "Mexiko", source_language: fixture.id === "swedish-media-mexico" ? "sv" : "en",
      source_type: "news", detected_country: "Mexiko", source_priority: 90, credibility_score: 95,
      published_at: now, crawl_status: "fetched", created_at: now, updated_at: now };
    const analysis = await processNationalSourceItemWithOpenAI(raw);
    const passed = Boolean(analysis && analysis.diplomatic_relevance_score >= fixture.diplomatic[0]
      && analysis.diplomatic_relevance_score <= fixture.diplomatic[1] && analysis.sweden_relevance_score >= fixture.sweden[0]
      && analysis.sweden_relevance_score <= fixture.sweden[1]);
    const result = { id: fixture.id, passed, expected: { diplomatic: fixture.diplomatic, sweden: fixture.sweden }, analysis };
    results.push(result);
    console.log(JSON.stringify({ id: fixture.id, passed, diplomatic: analysis?.diplomatic_relevance_score, sweden: analysis?.sweden_relevance_score }));
  }
  await mkdir("reports", { recursive: true });
  const report = { model: "gpt-6-luna", evaluatedAt: new Date().toISOString(), passed: results.filter((r) => r.passed).length, total: results.length, results };
  await writeFile("reports/relevance-fixtures-2026-10-27.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, total: report.total }));
  if (report.passed !== report.total) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
