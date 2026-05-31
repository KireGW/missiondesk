import nextEnv from "@next/env";
import { closeDb, getMigratedDb } from "../src/lib/db/postgres";
import { listBackgroundJobs, listProcessedItems, listRankedCandidates, listRawSourceItems } from "../src/lib/intelligence/repository";
import { rankRawSourceItems } from "../src/lib/intelligence/ranking";
import type { RawSourceItem } from "../src/lib/intelligence/models";

nextEnv.loadEnvConfig(process.cwd());

function getArgValue(flag: string) {
  const raw = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  return raw ? raw.slice(flag.length + 1) : undefined;
}

function parseNumberArg(flag: string, fallback: number) {
  const raw = getArgValue(flag);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function sourceFamilyForItem(item: RawSourceItem) {
  const country = normalize(item.source_country);
  const social = item.source_type === "social";
  const official = ["government", "institution", "advisory"].includes(item.source_type);
  const media = item.source_type === "news";

  if (social && country.includes("sverige")) return "swedish_social";
  if (social && country.includes("mexiko")) return "mexican_social";
  if (social) return "international_social";
  if (country.includes("sverige") && official) return "swedish_official";
  if (country.includes("sverige") && media) return "swedish_media";
  if (country.includes("mexiko") && official) return "mexican_official";
  if (country.includes("mexiko") && media) return "mexican_media";
  if (official) return "international_official";
  if (media) return "international_media";
  return "other";
}

function countBy<T>(items: T[], keyFn: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function diffCounts(
  before: Array<{ key: string; count: number }>,
  after: Array<{ key: string; count: number }>,
) {
  const keys = new Set([...before.map((row) => row.key), ...after.map((row) => row.key)]);
  const beforeMap = new Map(before.map((row) => [row.key, row.count]));
  const afterMap = new Map(after.map((row) => [row.key, row.count]));
  return [...keys]
    .map((key) => ({
      key,
      before: beforeMap.get(key) ?? 0,
      after: afterMap.get(key) ?? 0,
      delta: (afterMap.get(key) ?? 0) - (beforeMap.get(key) ?? 0),
    }))
    .filter((row) => row.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.key.localeCompare(b.key));
}

async function main() {
  const limit = parseNumberArg("--limit", 10);
  const db = getMigratedDb();
  const latestJob = (await listBackgroundJobs({ type: "manual_source_refresh", limit: 1 }, db))[0];

  if (!latestJob) {
    console.log(JSON.stringify({ message: "No manual_source_refresh jobs found." }, null, 2));
    return;
  }

  const payload = latestJob.payload as Record<string, unknown>;
  const expectedRawInserted =
    typeof (payload.observability as Record<string, unknown> | undefined)?.totals === "object"
      ? Number((((payload.observability as Record<string, unknown>).totals as Record<string, unknown>)?.rawInsertedCount ?? 0))
      : 0;

  const rawRows = await db.prepare(`
    SELECT id
    FROM raw_source_items
    WHERE datetime(created_at) >= datetime(?)
      AND datetime(created_at) <= datetime(?)
    ORDER BY created_at ASC
  `).all(latestJob.created_at, latestJob.updated_at) as Array<{ id: string }>;

  const rawIds = rawRows.map((row) => row.id);
  if (rawIds.length === 0) {
    console.log(JSON.stringify({
      jobId: latestJob.id,
      message: "No raw_source_items found in latest refresh window.",
      window: { created_at: latestJob.created_at, updated_at: latestJob.updated_at },
    }, null, 2));
    return;
  }

  const mappedRawItems = await listRawSourceItems({ ids: rawIds, limit: Math.max(rawIds.length, 100) }, db);

  const priorRanked = await listRankedCandidates({ rawSourceItemIds: rawIds, limit: Math.max(rawIds.length, 100) }, db);
  const priorSelected = priorRanked.filter((record) => record.candidate.selection_status === "selected");

  const processedRawItems = (await listProcessedItems({ limit: 250, onlyFresh: false }, db))
    .map((record) => record.raw)
    .filter((raw) => !rawIds.includes(raw.id));

  const replayRanked = rankRawSourceItems(mappedRawItems, processedRawItems, {
    scanLimit: 500,
    targetMin: 25,
    targetMax: 60,
    hardCap: 100,
    minSelectedScore: 58,
    minCandidateScore: 50,
    allowRegionalAi: false,
    nationalOnly: true,
  });
  const replaySelected = replayRanked.filter((candidate) => candidate.selection_status === "selected");

  const priorSelectedIds = new Set(priorSelected.map((record) => record.raw.id));
  const replaySelectedIds = new Set(replaySelected.map((candidate) => candidate.raw_source_item_id));

  const entered = replaySelected
    .filter((candidate) => !priorSelectedIds.has(candidate.raw_source_item_id))
    .map((candidate) => {
      const raw = mappedRawItems.find((item) => item.id === candidate.raw_source_item_id)!;
      return {
        rawSourceItemId: raw.id,
        sourceName: raw.source_name,
        family: sourceFamilyForItem(raw),
        title: raw.title_original,
        rankScore: candidate.rank_score,
        reason: candidate.selection_reason,
      };
    });

  const left = priorSelected
    .filter((record) => !replaySelectedIds.has(record.raw.id))
    .map((record) => ({
      rawSourceItemId: record.raw.id,
      sourceName: record.raw.source_name,
      family: sourceFamilyForItem(record.raw),
      title: record.raw.title_original,
      rankScore: record.candidate.rank_score,
      reason: record.candidate.selection_reason,
    }));

  const priorBySource = countBy(priorSelected, (record) => record.raw.source_name);
  const replayBySource = countBy(replaySelected, (candidate) => {
    const raw = mappedRawItems.find((item) => item.id === candidate.raw_source_item_id)!;
    return raw.source_name;
  });
  const priorByFamily = countBy(priorSelected, (record) => sourceFamilyForItem(record.raw));
  const replayByFamily = countBy(replaySelected, (candidate) => {
    const raw = mappedRawItems.find((item) => item.id === candidate.raw_source_item_id)!;
    return sourceFamilyForItem(raw);
  });

  console.log(JSON.stringify({
    job: {
      id: latestJob.id,
      created_at: latestJob.created_at,
      updated_at: latestJob.updated_at,
      expectedRawInserted,
      rawIdsInWindow: rawIds.length,
    },
    previous: {
      rankedCount: priorRanked.length,
      selectedCount: priorSelected.length,
      bySource: priorBySource.slice(0, limit),
      byFamily: priorByFamily,
    },
    replay: {
      rankedCount: replayRanked.length,
      selectedCount: replaySelected.length,
      bySource: replayBySource.slice(0, limit),
      byFamily: replayByFamily,
    },
    deltas: {
      bySource: diffCounts(priorBySource, replayBySource).slice(0, limit),
      byFamily: diffCounts(priorByFamily, replayByFamily),
      entered: entered.slice(0, limit),
      left: left.slice(0, limit),
    },
  }, null, 2));
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
