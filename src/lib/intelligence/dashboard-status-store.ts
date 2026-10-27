import { getMigratedDb, type MissionDeskDb } from "@/lib/db/postgres";
import type { DashboardUpdateStatus } from "@/lib/intelligence/dashboard-status";

const sourceCheckId = "source-check";

function iso(value: string | null | undefined) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return undefined;
  return new Date(value).toISOString();
}

export async function getDashboardUpdateStatus(
  db: MissionDeskDb = getMigratedDb(),
): Promise<DashboardUpdateStatus> {
  const row = await db.prepare(`
    WITH latest_refresh AS (
      SELECT payload::jsonb AS data, updated_at
      FROM background_jobs WHERE type = 'manual_source_refresh' AND status = 'completed'
      ORDER BY created_at DESC LIMIT 1
    )
    SELECT
      COALESCE(
        (SELECT last_ingested_at FROM ingestion_update_state WHERE id = ?),
        (SELECT last_ingested_at FROM ingestion_update_state WHERE id = 'feed')
      ) AS sources_checked_at,
      (SELECT MAX(NULLIF(processed_at, '')::timestamptz)::text FROM processed_items) AS signals_processed_at,
      (SELECT MAX(NULLIF(generated_at, '')::timestamptz)::text FROM briefings) AS briefings_generated_at,
      (SELECT COALESCE(NULLIF(data->>'completedAt', ''), updated_at) FROM latest_refresh) AS refresh_completed_at,
      (SELECT data->>'processedCount' FROM latest_refresh) AS processed_count,
      (SELECT COALESCE(data#>>'{observability,totals,rawInsertedCount}', data#>>'{ingestionSummary,storedCount}', data->>'rawInsertedCount') FROM latest_refresh) AS new_source_item_count
  `).get<{
    sources_checked_at: string | null;
    signals_processed_at: string | null;
    briefings_generated_at: string | null;
    refresh_completed_at: string | null;
    processed_count: string | null;
    new_source_item_count: string | null;
  }>(sourceCheckId);

  const completedAt = iso(row?.refresh_completed_at);
  const count = (value: string | null | undefined) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
  };
  return {
    sourcesCheckedAt: iso(row?.sources_checked_at),
    signalsProcessedAt: iso(row?.signals_processed_at),
    briefingsGeneratedAt: iso(row?.briefings_generated_at),
    lastRefresh: completedAt ? {
      completedAt,
      processedCount: count(row?.processed_count),
      newSourceItemCount: count(row?.new_source_item_count),
    } : undefined,
  };
}

// A completed source pass is independent of later ranking, AI work or deployments.
export async function recordSourcesCheckedAt(checkedAt: string, db: MissionDeskDb = getMigratedDb()) {
  const timestamp = iso(checkedAt);
  if (!timestamp) throw new Error("Invalid source-check timestamp");
  await db.prepare(`
    INSERT INTO ingestion_update_state (id, status, completed_at, last_ingested_at)
    VALUES (?, 'completed', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      completed_at = excluded.completed_at,
      last_ingested_at = excluded.last_ingested_at,
      updated_at = datetime('now')
    WHERE ingestion_update_state.last_ingested_at IS NULL
      OR ingestion_update_state.last_ingested_at::timestamptz < excluded.last_ingested_at::timestamptz
  `).run(sourceCheckId, timestamp, timestamp);
}
