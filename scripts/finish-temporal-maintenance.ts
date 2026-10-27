import nextEnv from "@next/env";
import pg from "pg";
import { closeDb } from "../src/lib/db/postgres";
import { runTemporalSyncWorker } from "../src/lib/intelligence/temporal-sync-worker";

nextEnv.loadEnvConfig(process.cwd());
process.env.MISSIONDESK_TEMPORAL_MODEL = "gpt-5-mini";

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL?.replace("sslmode=require", "sslmode=verify-full") });
  try {
    await client.connect();
    await client.query("BEGIN");
    const old = await client.query(`SELECT id FROM background_jobs WHERE type='sync_temporal_signal'
      AND status='running' AND created_at::timestamptz < '2026-10-01'::timestamptz FOR UPDATE`);
    if (old.rows.length !== 8) throw new Error(`Expected the eight approved historical jobs, found ${old.rows.length}`);
    await client.query(`UPDATE background_jobs SET status='cancelled', locked_at=NULL, locked_by=NULL,
      error_message='User-approved cleanup 2026-10-27: historical June work with renewed October lock', updated_at=now()::text
      WHERE id=ANY($1::text[])`, [old.rows.map((row) => row.id)]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ cancelledHistoricalJobs: old.rows.length }));
    let processed = 0;
    let skipped = 0;
    for (let batch = 0; batch < 25; batch++) {
      const outcome = await runTemporalSyncWorker({ limit: 3 });
      processed += outcome.processedCount;
      skipped += outcome.skippedCount;
      console.log(JSON.stringify({ batch: batch + 1, processed, skipped, outcome }));
      if (outcome.failedCount > 0) throw new Error("Temporal extraction failed; retry jobs remain in the queue");
      if (outcome.claimedCount === 0) break;
    }
    const pending = await client.query("SELECT status,COUNT(*)::int AS count FROM background_jobs WHERE status IN ('pending','running') GROUP BY 1");
    console.log(JSON.stringify({ remainingActiveJobs: pending.rows, processed, skipped }));
    if (pending.rows.length) process.exitCode = 1;
  } finally { await client.end(); await closeDb(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
