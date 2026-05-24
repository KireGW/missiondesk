import { closeDb, getMigratedDb } from "@/lib/db/postgres";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());

type CandidateRow = {
  raw_source_item_id: string;
  title_sv: string;
  summary_sv: string;
  title_original: string;
  snippet: string | null;
  raw_content: string | null;
  published_at: string | null;
  event_date: string | null;
};

const MONTH_INDEX: Record<string, number> = {
  // Swedish
  januari: 0,
  februari: 1,
  mars: 2,
  april: 3,
  maj: 4,
  juni: 5,
  juli: 6,
  augusti: 7,
  september: 8,
  oktober: 9,
  november: 10,
  december: 11,
  // Spanish
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
  // English
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function toIsoUtcDay(year: number, monthZero: number, day: number) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthZero) ||
    !Number.isInteger(day) ||
    year < 2000 ||
    year > 2100 ||
    monthZero < 0 ||
    monthZero > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const date = new Date(Date.UTC(year, monthZero, day, 12, 0, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== monthZero ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString();
}

function extractDateCandidates(text: string): string[] {
  const out = new Set<string>();

  // ISO YYYY-MM-DD
  for (const match of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const iso = toIsoUtcDay(year, month, day);
    if (iso) out.add(iso);
  }

  // DD/MM/YYYY or DD-MM-YYYY
  for (const match of text.matchAll(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/g)) {
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    const iso = toIsoUtcDay(year, month, day);
    if (iso) out.add(iso);
  }

  // 25 maj 2026 / 25 de mayo de 2026 / May 25, 2026
  for (const match of text.matchAll(
    /\b(\d{1,2})(?:\s+de)?\s+([A-Za-zÀ-ÖØ-öø-ÿ]+)\s+(?:de\s+)?(20\d{2})\b/g,
  )) {
    const day = Number(match[1]);
    const monthWord = match[2].toLowerCase();
    const year = Number(match[3]);
    const month = MONTH_INDEX[monthWord];
    if (month === undefined) continue;
    const iso = toIsoUtcDay(year, month, day);
    if (iso) out.add(iso);
  }

  for (const match of text.matchAll(
    /\b([A-Za-zÀ-ÖØ-öø-ÿ]+)\s+(\d{1,2}),\s*(20\d{2})\b/g,
  )) {
    const monthWord = match[1].toLowerCase();
    const day = Number(match[2]);
    const year = Number(match[3]);
    const month = MONTH_INDEX[monthWord];
    if (month === undefined) continue;
    const iso = toIsoUtcDay(year, month, day);
    if (iso) out.add(iso);
  }

  return [...out];
}

function pickBestFutureDate(candidates: string[], publishedAt?: string | null): string | null {
  if (candidates.length === 0) return null;

  const now = Date.now();
  const maxFuture = now + 1000 * 60 * 60 * 24 * 365 * 3; // 3 years horizon
  const publishedTs = publishedAt ? new Date(publishedAt).getTime() : Number.NaN;

  const filtered = candidates
    .map((iso) => ({ iso, ts: new Date(iso).getTime() }))
    .filter((item) => Number.isFinite(item.ts))
    .filter((item) => item.ts >= now - 1000 * 60 * 60 * 24) // allow same-day
    .filter((item) => item.ts <= maxFuture)
    .filter((item) => !Number.isFinite(publishedTs) || item.ts >= publishedTs - 1000 * 60 * 60 * 24);

  if (filtered.length === 0) return null;
  filtered.sort((a, b) => a.ts - b.ts);
  return filtered[0].iso;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransientDnsError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message =
    "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  return code === "ENOTFOUND" || message.includes("ENOTFOUND") || message.includes("getaddrinfo");
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientDnsError(error) || attempt >= maxAttempts) {
        throw error;
      }
      const delayMs = 500 * 2 ** (attempt - 1);
      console.warn(
        `[backfill:event-dates] DNS/glapp vid databasanslutning (försök ${attempt}/${maxAttempts}). Nytt försök om ${delayMs} ms...`,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function main() {
  const shouldApply = process.argv.includes("--apply");
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Math.max(1, Math.min(10000, Number(limitArg.split("=")[1]) || 0)) : undefined;

  const db = getMigratedDb();
  const rows = await withRetry(() =>
    db
      .prepare(`
      SELECT
        processed_items.raw_source_item_id,
        processed_items.title_sv,
        processed_items.summary_sv,
        processed_items.event_date,
        raw_source_items.title_original,
        raw_source_items.snippet,
        raw_source_items.raw_content,
        raw_source_items.published_at
      FROM processed_items
      JOIN raw_source_items ON raw_source_items.id = processed_items.raw_source_item_id
      WHERE processed_items.event_date IS NULL OR processed_items.event_date = ''
      ORDER BY processed_items.processed_at DESC
      ${limit ? "LIMIT ?" : ""}
    `)
      .all<CandidateRow>(...(limit ? [limit] : [])),
  );

  const candidatesToUpdate: Array<{ id: string; eventDate: string }> = [];
  const sample: Array<{ id: string; eventDate: string; title: string }> = [];
  for (const row of rows) {
    const text = [
      row.title_sv,
      row.summary_sv,
      row.title_original,
      row.snippet ?? "",
      (row.raw_content ?? "").slice(0, 12000),
    ]
      .join("\n")
      .replace(/\s+/g, " ");

    const candidates = extractDateCandidates(text);
    const chosen = pickBestFutureDate(candidates, row.published_at);
    if (!chosen) continue;
    candidatesToUpdate.push({ id: row.raw_source_item_id, eventDate: chosen });
    if (sample.length < 10) {
      sample.push({ id: row.raw_source_item_id, eventDate: chosen, title: row.title_sv });
    }
  }

  let updated = 0;
  if (shouldApply && candidatesToUpdate.length > 0) {
    await withRetry(() => db.exec("BEGIN"));
    try {
      for (const item of candidatesToUpdate) {
        await withRetry(() =>
          db
            .prepare(`
          UPDATE processed_items
          SET event_date = ?, updated_at = datetime('now')
          WHERE raw_source_item_id = ?
            AND (event_date IS NULL OR event_date = '')
        `)
            .run(item.eventDate, item.id),
        );
        updated += 1;
      }
      await withRetry(() => db.exec("COMMIT"));
    } catch (error) {
      await withRetry(() => db.exec("ROLLBACK")).catch(() => undefined);
      throw error;
    }
  }

  const stats = await withRetry(() =>
    db.prepare(`
    SELECT
      COUNT(*)::int AS total_processed,
      COUNT(*) FILTER (WHERE event_date IS NOT NULL AND event_date <> '')::int AS with_event_date,
      COUNT(*) FILTER (WHERE event_date IS NOT NULL AND event_date::timestamptz > now())::int AS with_future_event_date
    FROM processed_items
  `).get<{
      total_processed: number;
      with_event_date: number;
      with_future_event_date: number;
    }>(),
  );

  console.log(
    JSON.stringify(
      {
        scanned_without_event_date: rows.length,
        mode: shouldApply ? "apply" : "dry-run",
        apply_hint: shouldApply
          ? undefined
          : "No writes performed. Re-run with --apply to persist event_date updates.",
        candidate_updates: candidatesToUpdate.length,
        updated,
        sample,
        stats,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
