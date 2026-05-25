import { closeDb, getMigratedDb } from "@/lib/db/postgres";
import { normalizeSwedishUserFacingText } from "@/lib/ai/swedish-normalization";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

async function main() {
  const db = getMigratedDb();

  const processedRows = await db
    .prepare(`
      SELECT raw_source_item_id, title_sv, summary_sv, why_it_may_matter_sv
      FROM processed_items
      WHERE
        title_sv ILIKE '%cumbre%'
        OR summary_sv ILIKE '%cumbre%'
        OR why_it_may_matter_sv ILIKE '%cumbre%'
        OR title_sv ILIKE '%cumbren%'
        OR summary_sv ILIKE '%cumbren%'
        OR why_it_may_matter_sv ILIKE '%cumbren%'
    `)
    .all<{
      raw_source_item_id: string;
      title_sv: string;
      summary_sv: string;
      why_it_may_matter_sv: string;
    }>();

  for (const row of processedRows) {
    await db
      .prepare(`
        UPDATE processed_items
        SET
          title_sv = ?,
          summary_sv = ?,
          why_it_may_matter_sv = ?,
          updated_at = now()
        WHERE raw_source_item_id = ?
      `)
      .run(
        normalizeSwedishUserFacingText(row.title_sv),
        normalizeSwedishUserFacingText(row.summary_sv),
        normalizeSwedishUserFacingText(row.why_it_may_matter_sv),
        row.raw_source_item_id,
      );
  }

  const briefingRows = await db
    .prepare(`
      SELECT id, content_sv
      FROM briefings
      WHERE content_sv ILIKE '%cumbre%' OR content_sv ILIKE '%cumbren%'
    `)
    .all<{ id: string; content_sv: string }>();

  for (const row of briefingRows) {
    await db
      .prepare(`
        UPDATE briefings
        SET
          content_sv = ?,
          updated_at = now()
        WHERE id = ?
      `)
      .run(normalizeSwedishUserFacingText(row.content_sv), row.id);
  }

  console.log(
    JSON.stringify(
      {
        processedPatched: processedRows.length,
        briefingsPatched: briefingRows.length,
        processedIds: processedRows.map((row) => row.raw_source_item_id),
        briefingIds: briefingRows.map((row) => row.id),
      },
      null,
      2,
    ),
  );

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
