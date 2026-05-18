import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import { detectGeography } from "@/lib/ingestion/geography";
import { ingestionAdapters } from "@/lib/ingestion/registry";
import { getSourcesSync } from "@/lib/sources/store";
import type {
  IngestibleSourceDefinition,
  RawSourceDocument,
} from "@/lib/ingestion/types";
import {
  enqueueBackgroundJob,
  upsertRawSourceItem,
} from "@/lib/intelligence/repository";
import type { NewRawSourceItem, RawSourceItem } from "@/lib/intelligence/models";
import type { EmbassyConfig } from "@/lib/types";

export interface RawIngestionOptions {
  config?: EmbassyConfig;
  sources?: IngestibleSourceDefinition[];
  sourceIds?: string[];
  since?: string;
  limitPerSource?: number;
  concurrency?: number;
  preserveRawContent?: boolean;
}

export interface SourceIngestionResult {
  sourceId: string;
  sourceName: string;
  fetchedCount: number;
  storedCount: number;
  skippedCount: number;
  items: RawSourceItem[];
  errors: Array<{ message: string; url?: string }>;
}

export interface RawIngestionRunResult {
  startedAt: string;
  completedAt: string;
  sourceCount: number;
  fetchedCount: number;
  storedCount: number;
  skippedCount: number;
  errors: Array<{ source: string; message: string; url?: string }>;
  results: SourceIngestionResult[];
}

const canonicalUrl = (value: string) => {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
};

const scoreFromTrustTier = (trustTier: IngestibleSourceDefinition["trustTier"]) => {
  if (trustTier === 1) return 92;
  if (trustTier === 2) return 76;
  return 58;
};

function sourcePriority(source: IngestibleSourceDefinition) {
  return Math.max(0, Math.min(100, source.sourcePriority ?? scoreFromTrustTier(source.trustTier)));
}

function credibilityScore(source: IngestibleSourceDefinition) {
  return Math.max(0, Math.min(100, source.credibilityScore ?? scoreFromTrustTier(source.trustTier)));
}

function isDocumentAfterSince(document: RawSourceDocument, since?: string) {
  if (!since || !document.publishedAt) return true;
  return new Date(document.publishedAt).getTime() >= new Date(since).getTime();
}

function toRawSourceItem(
  source: IngestibleSourceDefinition,
  document: RawSourceDocument,
  config: EmbassyConfig,
): NewRawSourceItem | null {
  const title = document.title.trim();
  const url = canonicalUrl(document.url || source.url);

  if (!title || !url) return null;

  const textForDetection = [
    title,
    document.excerpt,
    document.text,
    source.name,
    source.defaultDetectedRegion,
    ...(source.regionalScope ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  const geography = detectGeography(textForDetection, config, {
    detectedCountry: source.defaultDetectedCountry,
    detectedRegion: source.defaultDetectedRegion,
    detectedCity: source.defaultDetectedCity,
  });

  return {
    source_type: source.sourceType,
    title_original: title,
    url,
    source_name: source.name,
    source_country: source.country,
    source_language: source.language,
    published_at: document.publishedAt ?? document.retrievedAt,
    detected_country: geography.detectedCountry,
    detected_region: geography.detectedRegion,
    detected_city: geography.detectedCity,
    snippet: document.excerpt?.slice(0, 1200),
    raw_content: (document.text || document.html)?.slice(0, 50000),
    source_priority: sourcePriority(source),
    credibility_score: credibilityScore(source),
    crawl_status: "fetched",
  };
}

async function ingestSource(
  source: IngestibleSourceDefinition,
  config: EmbassyConfig,
  options: RawIngestionOptions,
): Promise<SourceIngestionResult> {
  const adapter = ingestionAdapters.find((candidate) => candidate.canHandle(source));

  if (!adapter) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      fetchedCount: 0,
      storedCount: 0,
      skippedCount: 0,
      items: [],
      errors: [{ message: `No ingestion adapter registered for ${source.type}` }],
    };
  }

  try {
    const documents = await adapter.fetch(source, {
      embassy: config,
      limit: source.maxItemsPerRun ?? options.limitPerSource ?? 25,
      preserveRawContent: options.preserveRawContent ?? source.preserveRawContent,
    });
    const storedItems: RawSourceItem[] = [];
    let skippedCount = 0;

    for (const document of documents) {
      if (!isDocumentAfterSince(document, options.since)) {
        skippedCount += 1;
        continue;
      }

      const rawItem = toRawSourceItem(source, document, config);
      if (!rawItem) {
        skippedCount += 1;
        continue;
      }

      storedItems.push(upsertRawSourceItem(rawItem));
    }

    return {
      sourceId: source.id,
      sourceName: source.name,
      fetchedCount: documents.length,
      storedCount: storedItems.length,
      skippedCount,
      items: storedItems,
      errors: [],
    };
  } catch (error) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      fetchedCount: 0,
      storedCount: 0,
      skippedCount: 0,
      items: [],
      errors: [
        {
          message: error instanceof Error ? error.message : "Unknown ingestion error",
          url: source.url,
        },
      ],
    };
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < values.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(values[currentIndex]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, values.length)) }, () =>
      worker(),
    ),
  );

  return results;
}

export async function ingestRawSourceItems(
  options: RawIngestionOptions = {},
): Promise<RawIngestionRunResult> {
  const startedAt = new Date().toISOString();
  const config = options.config ?? swedenMexicoEmbassyConfig;
  const sourceIds = new Set(options.sourceIds ?? []);
  const sources = (options.sources ?? (getSourcesSync() as IngestibleSourceDefinition[])).filter(
    (source) => source.enabled && (sourceIds.size === 0 || sourceIds.has(source.id)),
  );
  const results = await mapWithConcurrency(
    sources,
    options.concurrency ?? 6,
    (source) => ingestSource(source, config, options),
  );

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    sourceCount: sources.length,
    fetchedCount: results.reduce((total, result) => total + result.fetchedCount, 0),
    storedCount: results.reduce((total, result) => total + result.storedCount, 0),
    skippedCount: results.reduce((total, result) => total + result.skippedCount, 0),
    errors: results.flatMap((result) =>
      result.errors.map((error) => ({
        source: result.sourceName,
        ...error,
      })),
    ),
    results,
  };
}

export function enqueueRawIngestionJobs(
  sources: IngestibleSourceDefinition[] = getSourcesSync() as IngestibleSourceDefinition[],
) {
  return sources
    .filter((source) => source.enabled)
    .map((source) =>
      enqueueBackgroundJob({
        type: "ingest_raw_source",
        priority: sourcePriority(source),
        payload: {
          sourceId: source.id,
          sourceType: source.sourceType,
          url: source.url,
        },
      }),
    );
}
