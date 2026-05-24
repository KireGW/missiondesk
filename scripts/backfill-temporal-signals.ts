import nextEnv from "@next/env";
import { closeDb } from "../src/lib/db/postgres";
import { extractTemporalSignalsFromProcessedItems } from "../src/lib/intelligence/temporal-signals";

nextEnv.loadEnvConfig(process.cwd());

function parseNumberArg(flag: string) {
  const raw = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (!raw) return undefined;
  const value = Number(raw.slice(flag.length + 1));
  return Number.isFinite(value) ? value : undefined;
}

async function main() {
  const scanLimit = parseNumberArg("--limit");
  const progressEvery = parseNumberArg("--progress-every") ?? 10;

  console.info(
    `[temporal-backfill] starting historical backfill${scanLimit ? ` with limit=${scanLimit}` : ""}${progressEvery > 0 ? ` (progress every ${progressEvery})` : ""}`,
  );

  const result = await extractTemporalSignalsFromProcessedItems({
    onlyFresh: false,
    excludeExistingTemporalSignals: true,
    scanLimit,
    progressLabel: "temporal-backfill",
    progressEvery,
  });

  console.log(JSON.stringify(result, null, 2));
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
