import nextEnv from "@next/env";
import pg from "pg";
import { processNationalSourceItemWithOpenAI } from "../src/lib/ai/national-processing";
import type { RawSourceItem } from "../src/lib/intelligence/models";

nextEnv.loadEnvConfig(process.cwd());

async function main() {
  const model = process.argv.find((arg) => arg.startsWith("--model="))?.slice(8);
  if (!model) throw new Error("Pass --model=<model>. This evaluation makes up to five paid signal-processing calls, without database writes.");
  process.env.MISSIONDESK_PROCESSING_MODEL = model;
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL?.replace("sslmode=require", "sslmode=verify-full"),
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const samples: RawSourceItem[] = [];
    for (const pattern of ["%Paro de transportistas%", "%Germany%s fiscal foundations%", "%Metro CDMX: Caen%", "%México y la ONU reafirman%", "%Mexico Business Climate Survey 2026%"]) {
      const result = await client.query("SELECT * FROM raw_source_items WHERE title_original ILIKE $1 ORDER BY created_at DESC LIMIT 1", [pattern]);
      if (result.rows[0]) samples.push(result.rows[0]);
    }
    await client.query("ROLLBACK");
    const results: unknown[] = [];
    for (const raw of samples) {
      const start = Date.now();
      try {
        const analysis = await processNationalSourceItemWithOpenAI(raw);
        results.push({ title: raw.title_original, model, durationMs: Date.now() - start, analysis });
      } catch (error) {
        results.push({ title: raw.title_original, model, error: error instanceof Error ? error.message : String(error) });
      }
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
