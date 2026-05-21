import nextEnv from "@next/env";
import {
  auditRssQualityForSource,
  buildRssQualityReport,
  shouldAuditRssQuality,
  skippedRssQualityResult,
  sourceWithRssQualityMetadata,
} from "../src/lib/sources/rss-quality";
import { getSources, saveSources } from "../src/lib/sources/store";

nextEnv.loadEnvConfig(process.cwd());

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      results.push(await mapper(current));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sources = await getSources();
  const eligibleSources = sources.filter((source) => shouldAuditRssQuality(source).audit);
  const skippedResults = sources
    .filter((source) => !shouldAuditRssQuality(source).audit)
    .map((source) => {
      const eligibility = shouldAuditRssQuality(source);
      return skippedRssQualityResult(
        source,
        eligibility.reason ?? "RSS-audit är inte relevant för denna källa.",
      );
    });
  const auditResults = await mapWithConcurrency(eligibleSources, 4, async (source) => {
    const result = await auditRssQualityForSource(source);
    console.info(
      `[rss-audit] ${source.name}: ${result.status} (${result.itemCount} items, ${result.recentItemCount} recent)`,
    );
    return result;
  });
  const results = [...auditResults, ...skippedResults];
  skippedResults.forEach((result) =>
    console.info(`[rss-audit] ${result.sourceName}: skipped (${result.skippedReason})`),
  );

  if (!dryRun) {
    const byId = new Map(results.map((result) => [result.sourceId, result]));
    await saveSources(
      sources.map((source) => {
        const result = byId.get(source.id);
        return result ? sourceWithRssQualityMetadata(source, result) : source;
      }),
    );
  }

  console.log(JSON.stringify(buildRssQualityReport(results), null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
