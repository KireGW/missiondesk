import nextEnv from "@next/env";
import { closeDb, getMigratedDb } from "../src/lib/db/postgres";
import { listBackgroundJobs, listProcessedItems, listRawSourceItems } from "../src/lib/intelligence/repository";
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

function publisherKeyForItem(item: RawSourceItem) {
  try {
    const hostname = new URL(item.url).hostname
      .toLowerCase()
      .replace(/^(www|m|amp)\./, "")
      .replace(/\.$/, "");
    return hostname || normalize(item.source_name);
  } catch {
    return normalize(item.source_name);
  }
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

async function main() {
  const limit = parseNumberArg("--limit", 12);
  const nearCutoff = parseNumberArg("--near-cutoff", 8);
  const db = getMigratedDb();
  const latestJob = (await listBackgroundJobs({ type: "manual_source_refresh", limit: 1 }, db))[0];

  if (!latestJob) {
    console.log(JSON.stringify({ message: "No manual_source_refresh jobs found." }, null, 2));
    return;
  }

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
      message: "No raw_source_items found in latest refresh window.",
      job: {
        id: latestJob.id,
        created_at: latestJob.created_at,
        updated_at: latestJob.updated_at,
      },
    }, null, 2));
    return;
  }

  const rawItems = await listRawSourceItems({ ids: rawIds, limit: Math.max(rawIds.length, 100) }, db);
  const processedRawItems = (await listProcessedItems({ limit: 250, onlyFresh: false }, db))
    .map((record) => record.raw)
    .filter((raw) => !rawIds.includes(raw.id));

  const ranked = rankRawSourceItems(rawItems, processedRawItems, {
    scanLimit: 500,
    targetMin: 25,
    targetMax: 60,
    hardCap: 100,
    minSelectedScore: 58,
    minCandidateScore: 50,
    allowRegionalAi: false,
    nationalOnly: true,
  });

  const rankedWithRaw = ranked.map((candidate) => ({
    candidate,
    raw: rawItems.find((item) => item.id === candidate.raw_source_item_id)!,
  }));

  const selected = rankedWithRaw.filter((row) => row.candidate.selection_status === "selected");
  const mexicanMedia = rankedWithRaw.filter((row) => sourceFamilyForItem(row.raw) === "mexican_media");
  const selectedMexicanMedia = mexicanMedia.filter((row) => row.candidate.selection_status === "selected");
  const notSelectedMexicanMedia = mexicanMedia.filter((row) => row.candidate.selection_status !== "selected");

  const selectedCutoffScore = selected[selected.length - 1]?.candidate.rank_score ?? null;
  const bestMissedMexicanMedia = notSelectedMexicanMedia
    .sort((a, b) => b.candidate.rank_score - a.candidate.rank_score)[0];

  console.log(JSON.stringify({
    job: {
      id: latestJob.id,
      created_at: latestJob.created_at,
      updated_at: latestJob.updated_at,
      rawCount: rawItems.length,
      rankedCount: ranked.length,
      selectedCount: selected.length,
      selectedCutoffScore,
    },
    rawBatch: {
      byFamily: countBy(rawItems, (item) => sourceFamilyForItem(item)),
      bySource: countBy(rawItems, (item) => item.source_name).slice(0, limit),
      byPublisher: countBy(rawItems, (item) => publisherKeyForItem(item)).slice(0, limit),
      mexicanMediaByPublisher: countBy(
        rawItems.filter((item) => sourceFamilyForItem(item) === "mexican_media"),
        (item) => publisherKeyForItem(item),
      ).slice(0, limit),
      mexicanMediaBySource: countBy(
        rawItems.filter((item) => sourceFamilyForItem(item) === "mexican_media"),
        (item) => item.source_name,
      ).slice(0, limit),
    },
    selectedBatch: {
      byFamily: countBy(selected, (row) => sourceFamilyForItem(row.raw)),
      bySource: countBy(selected, (row) => row.raw.source_name).slice(0, limit),
      byPublisher: countBy(selected, (row) => publisherKeyForItem(row.raw)).slice(0, limit),
      mexicanMediaByPublisher: countBy(selectedMexicanMedia, (row) => publisherKeyForItem(row.raw)).slice(0, limit),
      mexicanMediaBySource: countBy(selectedMexicanMedia, (row) => row.raw.source_name).slice(0, limit),
    },
    scoreView: {
      topSelectedMexicanMedia: selectedMexicanMedia
        .sort((a, b) => b.candidate.rank_score - a.candidate.rank_score)
        .slice(0, limit)
        .map((row) => ({
          source: row.raw.source_name,
          publisher: publisherKeyForItem(row.raw),
          rankScore: row.candidate.rank_score,
          title: row.raw.title_original,
        })),
      nearCutoffSelectedMexicanMedia: selectedMexicanMedia
        .sort((a, b) => b.candidate.rank_score - a.candidate.rank_score)
        .slice(Math.max(0, selectedMexicanMedia.length - nearCutoff), selectedMexicanMedia.length)
        .map((row) => ({
          source: row.raw.source_name,
          publisher: publisherKeyForItem(row.raw),
          rankScore: row.candidate.rank_score,
          title: row.raw.title_original,
        })),
      topMissedMexicanMedia: notSelectedMexicanMedia
        .sort((a, b) => b.candidate.rank_score - a.candidate.rank_score)
        .slice(0, nearCutoff)
        .map((row) => ({
          source: row.raw.source_name,
          publisher: publisherKeyForItem(row.raw),
          rankScore: row.candidate.rank_score,
          status: row.candidate.selection_status,
          title: row.raw.title_original,
          reason: row.candidate.selection_reason,
        })),
      bestMissedMexicanMedia: bestMissedMexicanMedia
        ? {
            source: bestMissedMexicanMedia.raw.source_name,
            publisher: publisherKeyForItem(bestMissedMexicanMedia.raw),
            rankScore: bestMissedMexicanMedia.candidate.rank_score,
            status: bestMissedMexicanMedia.candidate.selection_status,
            title: bestMissedMexicanMedia.raw.title_original,
            reason: bestMissedMexicanMedia.candidate.selection_reason,
            gapToSelectedCutoff:
              selectedCutoffScore == null
                ? null
                : Number((selectedCutoffScore - bestMissedMexicanMedia.candidate.rank_score).toFixed(2)),
          }
        : null,
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
