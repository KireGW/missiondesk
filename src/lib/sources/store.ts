import { getMigratedDb } from "@/lib/db/postgres";
import { defaultSources } from "@/lib/sources/default-sources";
import type { SourceDefinition } from "@/lib/types";

const legacySeedIds = new Set([
  "el-universal",
  "el-financiero",
  "la-jornada",
  "expansion",
  "el-sol-de-mexico",
  "diario-de-yucatan",
  "am-guanajuato",
  "el-sol-de-puebla",
  "el-occidental",
  "el-sol-de-tijuana",
  "el-sol-de-san-luis",
  "riksbanken-press",
  "riksbanken-news",
  "bbc-latin-america",
]);

interface SourceDefinitionRow {
  id: string;
  data: SourceDefinition | string;
  sort_order: number;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourceKey(source: Pick<SourceDefinition, "name" | "url">) {
  return `${normalize(source.name)}|${normalize(source.url)}`;
}

function mapSourceRow(row: SourceDefinitionRow): SourceDefinition {
  const data =
    typeof row.data === "string"
      ? (JSON.parse(row.data) as SourceDefinition)
      : row.data;
  return { ...data, id: row.id };
}

async function readStoredSources(): Promise<SourceDefinition[] | null> {
  const rows = await getMigratedDb()
    .prepare(`
      SELECT id, data, sort_order
      FROM source_definitions
      ORDER BY sort_order ASC, id ASC
    `)
    .all<SourceDefinitionRow>();

  return rows.length > 0 ? rows.map(mapSourceRow) : null;
}

async function writeSources(sources: SourceDefinition[]) {
  const db = getMigratedDb();
  await db.prepare("DELETE FROM source_definitions").run();

  for (const [index, source] of sources.entries()) {
    await db
      .prepare(`
        INSERT INTO source_definitions (id, data, sort_order)
        VALUES (?, ?::jsonb, ?)
        ON CONFLICT(id) DO UPDATE SET
          data = excluded.data,
          sort_order = excluded.sort_order,
          updated_at = datetime('now')
      `)
      .run(source.id, JSON.stringify(source), index);
  }
}

function migrateLegacySeedSources(sources: SourceDefinition[]) {
  const existingByKey = new Map(sources.map((source) => [sourceKey(source), source]));
  const migratedDefaults = defaultSources.map((source) => {
    const existing = existingByKey.get(sourceKey(source));
    return {
      ...source,
      enabled: existing?.enabled ?? source.enabled,
      notes: existing?.notes ?? source.notes,
    };
  });

  const customSources = sources.filter(
    (source) => !defaultSources.some((item) => sourceKey(item) === sourceKey(source)),
  );
  return [...migratedDefaults, ...customSources];
}

function mergeDefaultSources(sources: SourceDefinition[]) {
  const existingByKey = new Map(sources.map((source) => [sourceKey(source), source]));
  const mergedDefaults = defaultSources.map((source) => {
    const existing = existingByKey.get(sourceKey(source));
    return {
      ...source,
      enabled: existing?.enabled ?? source.enabled,
      notes: existing?.notes ?? source.notes,
    };
  });

  const customSources = sources.filter(
    (source) => !defaultSources.some((item) => sourceKey(item) === sourceKey(source)),
  );
  return [...mergedDefaults, ...customSources];
}

export async function getSources(): Promise<SourceDefinition[]> {
  const stored = await readStoredSources();
  if (!stored) {
    await writeSources(defaultSources);
    return defaultSources;
  }

  const isLegacySeed =
    stored.length === legacySeedIds.size &&
    stored.every((source) => legacySeedIds.has(source.id));

  if (isLegacySeed) {
    const migrated = migrateLegacySeedSources(stored);
    await writeSources(migrated);
    return migrated;
  }

  const merged = mergeDefaultSources(stored);
  const needsRewrite =
    merged.length !== stored.length ||
    merged.some((source, index) => sourceKey(source) !== sourceKey(stored[index] ?? source));

  if (needsRewrite) {
    await writeSources(merged);
    return merged;
  }

  return stored;
}

export async function saveSources(sources: SourceDefinition[]) {
  await writeSources(sources);
}

export function sourceIdFromName(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64);
}

export async function resetSources() {
  await writeSources(defaultSources);
  return defaultSources;
}
