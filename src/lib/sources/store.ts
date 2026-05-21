import { getMigratedDb } from "@/lib/db/postgres";
import { defaultSources } from "@/lib/sources/default-sources";
import { auditSource, sourceWithAuditMetadata } from "@/lib/sources/audit";
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

function preserveSourceUserState(
  source: SourceDefinition,
  existing: SourceDefinition | undefined,
): SourceDefinition {
  if (!existing) return source;

  return {
    ...source,
    enabled: existing.enabled,
    notes: existing.notes ?? source.notes,
    sourceCategory: existing.sourceCategory ?? source.sourceCategory,
    retrieval: existing.retrieval ?? source.retrieval,
    retrievalMethod: existing.retrievalMethod ?? source.retrievalMethod,
    platform: existing.platform ?? source.platform,
    rssUrl: existing.rssUrl ?? source.rssUrl,
    websiteUrl: existing.websiteUrl ?? source.websiteUrl,
    rssHealthStatus: existing.rssHealthStatus ?? source.rssHealthStatus,
    rssHealthCheckedAt: existing.rssHealthCheckedAt ?? source.rssHealthCheckedAt,
    rssHealthConfidence: existing.rssHealthConfidence ?? source.rssHealthConfidence,
    rssHealthItemCount: existing.rssHealthItemCount ?? source.rssHealthItemCount,
    rssHealthRecentItemCount:
      existing.rssHealthRecentItemCount ?? source.rssHealthRecentItemCount,
    rssHealthLatestPublishedAt:
      existing.rssHealthLatestPublishedAt ?? source.rssHealthLatestPublishedAt,
    rssHealthMetadataScore:
      existing.rssHealthMetadataScore ?? source.rssHealthMetadataScore,
    rssHealthIssues: existing.rssHealthIssues ?? source.rssHealthIssues,
    rssHealthWarnings: existing.rssHealthWarnings ?? source.rssHealthWarnings,
    rssHealthSuggestedAction:
      existing.rssHealthSuggestedAction ?? source.rssHealthSuggestedAction,
    auditReviewState: existing.auditReviewState,
    auditReviewedAt: existing.auditReviewedAt,
    auditConfirmedRecommendedType: existing.auditConfirmedRecommendedType,
    auditConfirmedCategory: existing.auditConfirmedCategory,
    auditConfirmedRetrievalMethod: existing.auditConfirmedRetrievalMethod,
    auditConfirmedPlatform: existing.auditConfirmedPlatform,
  };
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
  const auditedAt = new Date().toISOString();
  const auditedSources = sources.map((source) => sourceWithAuditMetadata(source, auditedAt));

  await db.prepare("DELETE FROM source_definitions").run();

  for (const [index, source] of auditedSources.entries()) {
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

  return auditedSources;
}

function sourceNeedsAuditMetadataRefresh(source: SourceDefinition) {
  const audit = auditSource(source);
  const auditedSource = sourceWithAuditMetadata(source);
  return (
    source.auditDetectedType !== audit.detectedType ||
    source.sourceCategory !== auditedSource.sourceCategory ||
    source.retrieval?.primary !== auditedSource.retrieval?.primary ||
    source.retrieval?.fallback !== auditedSource.retrieval?.fallback ||
    source.retrievalMethod !== auditedSource.retrievalMethod ||
    source.rssUrl !== auditedSource.rssUrl ||
    source.websiteUrl !== auditedSource.websiteUrl ||
    source.platform !== auditedSource.platform ||
    source.recommendedSourceType !== audit.recommendedType ||
    source.auditRecommendedType !== audit.recommendedType ||
    source.auditRecommendedClass !== audit.recommendedClass ||
    source.auditRecommendedCategory !== audit.recommendedCategory ||
    source.auditRecommendedRetrievalMethod !== audit.recommendedRetrievalMethod ||
    source.auditRecommendedPlatform !== audit.recommendedPlatform ||
    source.auditConfidence !== audit.confidence ||
    JSON.stringify(source.auditIssues ?? []) !== JSON.stringify(audit.issues) ||
    JSON.stringify(source.auditWarnings ?? []) !== JSON.stringify(audit.warnings) ||
    source.auditSuggestedAction !== audit.suggestedAction ||
    source.auditReviewState !== auditedSource.auditReviewState ||
    source.auditConfirmedCategory !== auditedSource.auditConfirmedCategory ||
    source.auditConfirmedRetrievalMethod !== auditedSource.auditConfirmedRetrievalMethod ||
    source.auditConfirmedPlatform !== auditedSource.auditConfirmedPlatform
  );
}

function migrateLegacySeedSources(sources: SourceDefinition[]) {
  const existingByKey = new Map(sources.map((source) => [sourceKey(source), source]));
  const migratedDefaults = defaultSources.map((source) => {
    const existing = existingByKey.get(sourceKey(source));
    return preserveSourceUserState(source, existing);
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
    return preserveSourceUserState(source, existing);
  });

  const customSources = sources.filter(
    (source) => !defaultSources.some((item) => sourceKey(item) === sourceKey(source)),
  );
  return [...mergedDefaults, ...customSources];
}

export async function getSources(): Promise<SourceDefinition[]> {
  const stored = await readStoredSources();
  if (!stored) {
    return writeSources(defaultSources);
  }

  const isLegacySeed =
    stored.length === legacySeedIds.size &&
    stored.every((source) => legacySeedIds.has(source.id));

  if (isLegacySeed) {
    const migrated = migrateLegacySeedSources(stored);
    return writeSources(migrated);
  }

  const merged = mergeDefaultSources(stored);
  const needsRewrite =
    merged.length !== stored.length ||
    merged.some((source, index) => sourceKey(source) !== sourceKey(stored[index] ?? source)) ||
    merged.some(sourceNeedsAuditMetadataRefresh);

  if (needsRewrite) {
    return writeSources(merged);
  }

  return stored;
}

export async function saveSources(sources: SourceDefinition[]) {
  return writeSources(sources);
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
  return writeSources(defaultSources);
}
