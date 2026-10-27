import nextEnv from "@next/env";
import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { closeDb } from "../src/lib/db/postgres";
import { matchesConfiguredSourceScope } from "../src/lib/sources/content-scope";
import { contentKindForRaw } from "../src/lib/intelligence/content-kind";
import { enqueueSelectedNationalProcessingJobs, runNationalProcessingWorker } from "../src/lib/intelligence/national-processing-worker";
import { enqueueDefaultBriefingJobs, runBriefingGenerationWorker } from "../src/lib/intelligence/briefing-worker";
import { listBackgroundJobs, requeueBackgroundJob } from "../src/lib/intelligence/repository";

nextEnv.loadEnvConfig(process.cwd());
process.env.MISSIONDESK_PROCESSING_MODEL = "gpt-6-luna";
process.env.MISSIONDESK_BRIEFING_MODEL = "gpt-6.1-sol";

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL?.replace("sslmode=require", "sslmode=verify-full") });
  try {
    await client.connect();
    const result = await client.query(`SELECT r.*, to_jsonb(p) AS previous FROM raw_source_items r
      JOIN processed_items p ON p.raw_source_item_id=r.id
      JOIN ranked_processing_candidates c ON c.raw_source_item_id=r.id AND c.selection_status='selected'
      WHERE p.processed_at::timestamptz > now()-interval '4 days'
      ORDER BY p.processed_at DESC LIMIT 60`);
    const rows = result.rows.filter((r) => matchesConfiguredSourceScope(r) && contentKindForRaw(r) !== "reference");
    console.log(JSON.stringify({ candidateCount: rows.length, excluded: result.rows.length - rows.length, apply: process.argv.includes("--apply") }));
    if (!process.argv.includes("--apply")) return;
    await mkdir("reports", { recursive: true });
    await writeFile("reports/pre-reprocess-2026-10-27.json", JSON.stringify(rows.map((r) => r.previous), null, 2), { flag: "wx" });
    const jobs = await enqueueSelectedNationalProcessingJobs({ force: true, rawSourceItemIds: rows.map((r) => r.id), limit: 60 });
    let processed = 0;
    for (let batch = 0; batch < 30; batch++) {
      const outcome = await runNationalProcessingWorker({ limit: 3, force: true, deferTemporalSync: true });
      processed += outcome.processedCount;
      console.log(JSON.stringify({ phase: "signals", processed, queued: jobs.length, outcome }));
      if (outcome.failedCount > 0) throw new Error("Signal reprocessing failed; inspect the retained backup and queued jobs before retrying");
      if (outcome.claimedCount === 0) break;
    }
    if (processed !== jobs.length) throw new Error(`Expected ${jobs.length} processed signals; got ${processed}`);
    const existing = (await listBackgroundJobs({ type: "generate_briefing", limit: 50 })).filter((job) =>
      ["pending", "running"].includes(job.status) && new Date(job.created_at).getTime() >= Date.parse("2026-10-27T00:00:00Z"),
    );
    for (const job of existing.filter((job) => job.status === "running")) {
      if (Date.now() - Date.parse(job.updated_at) < 20 * 60_000) throw new Error("A recent briefing worker may still be active");
      await requeueBackgroundJob(job.id, { errorMessage: "Resuming interrupted briefing after model calibration" });
    }
    if (existing.length === 0) await enqueueDefaultBriefingJobs({ force: true });
    let generated = 0;
    for (let batch = 0; batch < 10; batch++) {
      const outcome = await runBriefingGenerationWorker({ limit: 1 });
      generated += outcome.generatedCount;
      console.log(JSON.stringify({ phase: "briefings", generated, outcome }));
      if (outcome.failedCount > 0) throw new Error("Briefing regeneration failed");
      if (outcome.claimedCount === 0) break;
    }
    const after = await client.query(`SELECT processed_model, COUNT(*)::int AS count,
      COUNT(*) FILTER(WHERE GREATEST(urgency_score,diplomatic_relevance_score,sweden_relevance_score,economic_impact_score,security_impact_score)<=10)::int AS all_scores_at_most_10
      FROM processed_items WHERE raw_source_item_id=ANY($1::text[]) GROUP BY processed_model`, [rows.map((r) => r.id)]);
    const report = { checkedAt: new Date().toISOString(), processed, generated, scoring: after.rows };
    await writeFile("reports/reprocess-2026-10-27.json", JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await client.end(); await closeDb(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
