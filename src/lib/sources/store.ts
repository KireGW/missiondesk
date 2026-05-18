import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defaultSources } from "@/lib/sources/default-sources";
import type { SourceDefinition } from "@/lib/types";

const dataDir = path.join(process.cwd(), "data");
const sourceFile = path.join(dataDir, "sources.json");
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

function readStoredSources(): SourceDefinition[] | null {
  if (!existsSync(sourceFile)) return null;
  try {
    const raw = readFileSync(sourceFile, "utf8");
    return JSON.parse(raw) as SourceDefinition[];
  } catch {
    return null;
  }
}

function writeSources(sources: SourceDefinition[]) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(sourceFile, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
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

  const customSources = sources.filter((source) => !defaultSources.some((item) => sourceKey(item) === sourceKey(source)));
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

export function getSourcesSync(): SourceDefinition[] {
  const stored = readStoredSources();
  if (!stored) {
    writeSources(defaultSources);
    return defaultSources;
  }

  const isLegacySeed =
    stored.length === legacySeedIds.size &&
    stored.every((source) => legacySeedIds.has(source.id));

  if (isLegacySeed) {
    const migrated = migrateLegacySeedSources(stored);
    writeSources(migrated);
    return migrated;
  }

  const merged = mergeDefaultSources(stored);
  const needsRewrite =
    merged.length !== stored.length ||
    merged.some((source, index) => sourceKey(source) !== sourceKey(stored[index] ?? source));

  if (needsRewrite) {
    writeSources(merged);
    return merged;
  }

  return stored;
}

export async function getSources(): Promise<SourceDefinition[]> {
  return getSourcesSync();
}

export async function saveSources(sources: SourceDefinition[]) {
  writeSources(sources);
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
  writeSources(defaultSources);
  return defaultSources;
}
