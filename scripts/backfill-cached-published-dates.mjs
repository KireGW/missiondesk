import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("data/missiondesk.sqlite");
db.exec("PRAGMA busy_timeout=5000");

const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const months = new Map(
  Object.entries({
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12,
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
    januari: 1,
    februari: 2,
    mars: 3,
    maj: 5,
    juni: 6,
    juli: 7,
    augusti: 8,
    oktober: 10,
  }),
);

const dateOnly = (year, month, day) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const stripHtml = (html) =>
  String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ");

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text ?? "").match(pattern)?.[1];
    if (match) return match.trim();
  }
  return "";
}

function parseDate(raw) {
  if (!raw) return undefined;
  const clean = String(raw).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;

  if (
    /^\d{4}-\d{2}-\d{2}t/i.test(clean) ||
    /^\d{4}-\d{2}-\d{2}[ t]\d{2}:\d{2}/i.test(clean) ||
    /^\d{1,2}\s+[a-z]+\s+\d{4}/i.test(clean) ||
    /^[a-z]+\s+\d{1,2},?\s+\d{4}/i.test(clean)
  ) {
    const timestamp = Date.parse(clean);
    if (Number.isFinite(timestamp)) {
      const date = new Date(timestamp);
      const year = date.getUTCFullYear();
      if (year >= 2000 && year <= 2027) return date.toISOString();
    }
  }

  const normalized = normalize(clean);
  let match = normalized.match(/\b(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})\b/);
  if (match && months.has(match[2])) {
    return dateOnly(Number(match[3]), months.get(match[2]), Number(match[1]));
  }

  match = normalized.match(/\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/);
  if (match && months.has(match[2])) {
    return dateOnly(Number(match[3]), months.get(match[2]), Number(match[1]));
  }

  match = normalized.match(/\b([a-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (match && months.has(match[1])) {
    return dateOnly(Number(match[3]), months.get(match[1]), Number(match[2]));
  }

  return undefined;
}

function extractFromUrl(url) {
  const value = String(url ?? "");
  let match = value.match(/\b(20\d{2})[/-](\d{1,2})[/-](\d{1,2})\b/);
  if (match) return dateOnly(Number(match[1]), Number(match[2]), Number(match[3]));

  match = value.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (match) return dateOnly(Number(match[1]), Number(match[2]), Number(match[3]));

  match = value.match(/\b(\d{1,2})[.](\d{1,2})[.](20\d{2})\b/);
  if (match) return dateOnly(Number(match[3]), Number(match[2]), Number(match[1]));

  return undefined;
}

function extractFromTitle(title) {
  return parseDate(
    firstMatch(normalize(title), [
      /as of (\d{1,2}\s+[a-z]+\s+\d{4})/i,
      /as of ([a-z]+\s+\d{1,2}\s+\d{4})/i,
      /(\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4})/i,
    ]),
  );
}

function extractFromHtml(html) {
  const metaDate = firstMatch(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["'][^>]*>/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']date["'][^>]*>/i,
    /<meta[^>]+name=["']dc\.date["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']dc\.date["'][^>]*>/i,
    /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
    /"dateCreated"\s*:\s*"([^"]+)"/i,
  ]);
  const parsedMetaDate = parseDate(metaDate);
  if (parsedMetaDate) return parsedMetaDate;

  const normalizedText = normalize(stripHtml(html));
  return parseDate(
    firstMatch(normalizedText, [
      /(?:publicado|actualizado|fecha|published|updated).{0,120}?(\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4})/i,
      /(\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4})/i,
      /(\d{1,2}\s+[a-z]+\s+\d{4})/i,
      /([a-z]+\s+\d{1,2}\s+\d{4})/i,
    ]),
  );
}

function isSuspicious(row) {
  if (!row.published_at) return true;

  const published = Date.parse(row.published_at);
  const created = Date.parse(String(row.created_at).replace(" ", "T") + "Z");
  if (!Number.isFinite(published) || !Number.isFinite(created)) return true;

  return Math.abs(published - created) < 5 * 60 * 1000;
}

function shouldPreferUrlDate(row) {
  return Boolean(extractFromUrl(row.url)) && !row.published_at;
}

function shouldClearLikelySiteWideDate(row, duplicateCount) {
  if (!row.published_at || duplicateCount < 3) return false;
  const source = normalize(row.source_name);
  const title = normalize(row.title_original);
  const url = normalize(row.url);

  if (source.includes("business sweden") && !extractFromUrl(row.url) && !/\bas of\b/.test(title)) {
    return true;
  }

  if (source.includes("eu external action") && !extractFromUrl(row.url)) {
    return true;
  }

  if (source.includes("la jornada") && extractFromUrl(row.url)) {
    return false;
  }

  return duplicateCount >= 5 && !extractFromUrl(row.url) && !url.includes("rss");
}

const rows = db
  .prepare(`
    SELECT r.id, r.title_original, r.url, r.source_name, r.published_at, r.created_at
    FROM processed_items p
    JOIN raw_source_items r ON r.id = p.raw_source_item_id
    ORDER BY p.processed_at DESC
  `)
  .all();

const duplicateCounts = new Map();
for (const row of rows) {
  if (!row.published_at) continue;
  const key = `${row.source_name}|${row.published_at}`;
  duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
}

const candidates = rows.filter((row) => {
  const duplicateCount = duplicateCounts.get(`${row.source_name}|${row.published_at}`) ?? 0;
  const dateOnlyWithoutTime = /^\d{4}-\d{2}-\d{2}$/.test(row.published_at ?? "");
  return (
    isSuspicious(row) ||
    shouldPreferUrlDate(row) ||
    shouldClearLikelySiteWideDate(row, duplicateCount) ||
    dateOnlyWithoutTime ||
    duplicateCount >= 2
  );
});
const update = db.prepare(
  "UPDATE raw_source_items SET published_at = ?, updated_at = datetime('now') WHERE id = ?",
);
const clear = db.prepare(
  "UPDATE raw_source_items SET published_at = NULL, updated_at = datetime('now') WHERE id = ?",
);

let fetched = 0;
let updated = 0;
let cleared = 0;
let failed = 0;
let urlDerived = 0;
const sample = [];

for (const row of candidates) {
  const duplicateCount = duplicateCounts.get(`${row.source_name}|${row.published_at}`) ?? 0;
  const siteWideDateShouldClear = shouldClearLikelySiteWideDate(row, duplicateCount);
  const urlDate = extractFromUrl(row.url);
  const shouldUseUrlDateFirst =
    urlDate && normalize(row.source_name).includes("la jornada") && duplicateCount >= 3;
  const titleDate = extractFromTitle(row.title_original);
  let extracted = shouldUseUrlDateFirst ? urlDate : titleDate;

  if (!extracted && !siteWideDateShouldClear && /^https?:\/\//i.test(row.url) && !/localhost|127\.0\.0\.1/i.test(row.url)) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch(row.url, {
        headers: { "User-Agent": "MissionDesk/0.1 cache date backfill" },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      fetched += 1;

      if (response.ok) extracted = extractFromHtml(await response.text());
    } catch {
      failed += 1;
    }
  }

  if (!extracted) {
    extracted = urlDate;
    if (extracted) urlDerived += 1;
  }

  if (siteWideDateShouldClear && !extracted) {
    clear.run(row.id);
    cleared += 1;
  } else if (extracted) {
    update.run(extracted, row.id);
    updated += 1;
    if (sample.length < 25) {
      sample.push({
        id: row.id,
        source: row.source_name,
        title: row.title_original,
        published_at: extracted,
      });
    }
  } else if (row.published_at) {
    clear.run(row.id);
    cleared += 1;
  }
}

console.log(
  JSON.stringify(
    {
      processed: rows.length,
      candidates: candidates.length,
      fetched,
      updated,
      cleared,
      failed,
      urlDerived,
      sample,
    },
    null,
    2,
  ),
);
