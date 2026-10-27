import nextEnv from "@next/env";
import pg from "pg";
import { fetchRssSource } from "../src/lib/ingestion/rss";
import { fetchWebsiteSource } from "../src/lib/ingestion/website";
import type { SourceDefinition } from "../src/lib/types";

nextEnv.loadEnvConfig(process.cwd());

async function main() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL?.replace("sslmode=require", "sslmode=verify-full"),
    connectionTimeoutMillis: 15_000,
    statement_timeout: 20_000,
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const queries = {
      scoringByDay: `SELECT LEFT(processed_at, 10) AS day, processed_model, COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE GREATEST(urgency_score, diplomatic_relevance_score,
          sweden_relevance_score, economic_impact_score, security_impact_score) <= 10)::int AS all_scores_at_most_10,
        ROUND(AVG(diplomatic_relevance_score)) AS avg_diplomatic
        FROM processed_items GROUP BY 1,2 ORDER BY 1 DESC LIMIT 12`,
      recentSources: `SELECT r.source_name, r.source_country, COUNT(*)::int AS processed,
        ROUND(AVG(p.diplomatic_relevance_score)) AS avg_diplomatic
        FROM processed_items p JOIN raw_source_items r ON r.id=p.raw_source_item_id
        WHERE p.processed_at::timestamptz > now()-interval '7 days'
        GROUP BY 1,2 ORDER BY processed DESC`,
      rawCoverage: `SELECT source_name, COUNT(*)::int AS count,
        MAX(published_at) AS newest_published, MAX(created_at) AS newest_ingested
        FROM raw_source_items GROUP BY 1 ORDER BY count DESC`,
      latestRefresh: `SELECT id, status, updated_at, error_message,
        payload::jsonb->'observability' AS observability,
        payload::jsonb->'processingOutcomeCounts' AS processing
        FROM background_jobs WHERE type='manual_source_refresh' ORDER BY updated_at DESC LIMIT 1`,
      jobs: `SELECT type, status, COUNT(*)::int AS count, MIN(updated_at) AS oldest,
        MAX(updated_at) AS newest FROM background_jobs
        WHERE status IN ('pending','running','failed') GROUP BY 1,2 ORDER BY 1,2`,
      businessSwedenSamples: `SELECT r.id, r.title_original, r.url, r.published_at,
        r.detected_country, LEFT(r.snippet, 220) AS snippet,
        p.title_sv, p.diplomatic_relevance_score, p.sweden_relevance_score
        FROM raw_source_items r LEFT JOIN processed_items p ON p.raw_source_item_id=r.id
        WHERE r.source_name='Business Sweden Mexico' ORDER BY r.created_at DESC LIMIT 10`,
    };
    const report: Record<string, unknown> = { checkedAt: new Date().toISOString() };
    for (const [name, sql] of Object.entries(queries)) {
      report[name] = (await client.query(sql)).rows;
    }
    const sourceRows = (await client.query("SELECT id, data FROM source_definitions ORDER BY sort_order, id")).rows;
    const sources: SourceDefinition[] = sourceRows.map((row) => ({
      ...(typeof row.data === "string" ? JSON.parse(row.data) : row.data), id: row.id,
    }));
    report.sources = sources.map((s) => ({
      id: s.id, name: s.name, enabled: s.enabled,
      method: s.sourceCategory === "market" ? "market" : s.retrieval?.primary ?? s.retrievalMethod ?? s.type,
      url: s.rssUrl ?? s.websiteUrl ?? s.url,
      rssHealthStatus: s.rssHealthStatus, rssHealthCheckedAt: s.rssHealthCheckedAt,
    }));
    await client.query("ROLLBACK");

    const sourceId = process.argv.find((arg) => arg.startsWith("--check-source="))?.slice(15);
    if (process.argv.includes("--check-sources") || sourceId) {
      const results: unknown[] = [];
      const queue = sources.filter((s) => s.enabled && (!sourceId || s.id === sourceId));
      async function worker() {
        while (queue.length > 0) {
          const source = queue.shift()!;
          const method = source.sourceCategory === "market" ? "market" : source.retrieval?.primary ?? source.retrievalMethod ?? source.type;
          if (!["rss", "website"].includes(method)) {
            results.push({ id: source.id, method, status: "not_checked" });
            continue;
          }
          try {
            const options = { limit: 3, preserveRawContent: true, signal: AbortSignal.timeout(20_000) };
            const result = method === "rss"
              ? { documents: await fetchRssSource(source, options), errors: [] }
              : await fetchWebsiteSource(source, options);
            results.push({
              id: source.id, method, count: result.documents.length, errors: result.errors,
              samples: result.documents.map((d) => ({ title: d.title, url: d.url, publishedAt: d.publishedAt })),
            });
          } catch (error) {
            results.push({ id: source.id, method, error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
      await Promise.all(Array.from({ length: 4 }, worker));
      report.sourceChecks = results;
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
