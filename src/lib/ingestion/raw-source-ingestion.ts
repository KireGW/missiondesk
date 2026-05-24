import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import { detectGeography } from "@/lib/ingestion/geography";
import { fetchMarketSource } from "@/lib/ingestion/market";
import { sanitizePublishedAt } from "@/lib/ingestion/published-at";
import { ingestionAdapters } from "@/lib/ingestion/registry";
import { fetchWebsiteSource, type WebsiteFetchStats } from "@/lib/ingestion/website";
import { getSources } from "@/lib/sources/store";
import type {
  IngestibleSourceDefinition,
  RawSourceDocument,
} from "@/lib/ingestion/types";
import {
  enqueueBackgroundJob,
  createRawSourceItemId,
  getRawSourceItemById,
  getRawSourceItemByUrl,
  listRawSourceItems,
  listBackgroundJobs,
  upsertRawSourceItem,
} from "@/lib/intelligence/repository";
import type {
  NewRawSourceItem,
  RawIngestionJobPayload,
  RawSourceItem,
} from "@/lib/intelligence/models";
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
  retrievalMethod: string;
  fetchedCount: number;
  storedCount: number;
  skippedCount: number;
  items: RawSourceItem[];
  errors: Array<{ message: string; url?: string }>;
  websiteStats?: WebsiteFetchStats;
}

export interface SkippedIngestionSource {
  sourceId: string;
  sourceName: string;
  retrievalMethod?: string;
  reason: string;
}

export interface RawIngestionRunResult {
  startedAt: string;
  completedAt: string;
  totalSourceCount: number;
  rssActiveSourceCount: number;
  websiteActiveSourceCount: number;
  socialActiveSourceCount: number;
  skippedSourceCount: number;
  skippedSources: SkippedIngestionSource[];
  sourceCount: number;
  fetchedCount: number;
  storedCount: number;
  skippedCount: number;
  websiteStats: WebsiteFetchStats;
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

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const socialHosts = new Set([
  "x.com",
  "twitter.com",
  "www.x.com",
  "www.twitter.com",
  "linkedin.com",
  "www.linkedin.com",
  "facebook.com",
  "www.facebook.com",
  "instagram.com",
  "www.instagram.com",
  "youtube.com",
  "www.youtube.com",
  "t.me",
  "www.t.me",
]);

function looksLikeRssUrl(value: string) {
  try {
    const url = new URL(value);
    const text = `${url.pathname} ${url.search}`.toLowerCase();
    return (
      /\brss\b/.test(text) ||
      /\batom\b/.test(text) ||
      /\bfeed\b/.test(text) ||
      /outboundfeeds/.test(text) ||
      /format=rss/.test(text) ||
      /\/xml\b/.test(text) ||
      /\.xml($|\?)/.test(`${url.pathname}${url.search}`)
    );
  } catch {
    return /\b(rss|atom|feed)\b|\.xml($|\?)/i.test(value);
  }
}

function retrievalMethodForIngestion(source: IngestibleSourceDefinition) {
  if (source.retrieval?.primary) return source.retrieval.primary;
  if (source.retrievalMethod) return source.retrievalMethod;
  if (source.type === "rss" || looksLikeRssUrl(source.url)) return "rss";
  if (source.type === "api" || source.type === "calendar") return "api";
  if (source.type === "social" || isSocialSource(source)) return "social_api";
  return "website";
}

function ingestionEligibility(source: IngestibleSourceDefinition): {
  eligible: boolean;
  retrievalMethod: string;
  reason?: string;
} {
  const retrievalMethod = retrievalMethodForIngestion(source);
  if (retrievalMethod === "rss" || retrievalMethod === "website" || retrievalMethod === "social_api") {
    return { eligible: true, retrievalMethod };
  }

  return {
    eligible: false,
    retrievalMethod,
    reason:
      retrievalMethod === "api"
        ? "metadata klar – API-hämtning ej implementerad"
        : "metadata klar – hämtning ej implementerad",
  };
}

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

function isSocialSource(source: IngestibleSourceDefinition) {
  try {
    const host = new URL(source.url).hostname.toLowerCase();
    return socialHosts.has(host) || socialHosts.has(host.replace(/^m\./, ""));
  } catch {
    return false;
  }
}

function resolvedSourceType(source: IngestibleSourceDefinition) {
  if (source.sourceType) return source.sourceType;
  if (isSocialSource(source)) return "social";
  if (source.type === "calendar") return "event";
  if (source.type === "rss") return "news";
  if (/(advisory|travel|alert|warning)/i.test(`${source.name} ${source.url}`)) return "advisory";
  if (/(report|working paper|policy brief|white paper)/i.test(`${source.name} ${source.url}`)) {
    return "report";
  }
  if (/(gob\.mx|\.gov|minister|myndighet|agency|courts?|central bank|bank)/i.test(
    `${source.name} ${source.url}`,
  )) {
    return "government";
  }
  return "other";
}

function isMarketSource(source: IngestibleSourceDefinition) {
  return source.sourceCategory === "market";
}

function isDocumentAfterSince(document: RawSourceDocument, since?: string) {
  if (!since || !document.publishedAt) return true;
  return new Date(document.publishedAt).getTime() >= new Date(since).getTime();
}

function dedupeDocuments(source: IngestibleSourceDefinition, documents: RawSourceDocument[]) {
  const seen = new Set<string>();
  return documents.filter((document) => {
    const key = [
      canonicalUrl(document.url || source.url),
      normalize(document.title),
      document.publishedAt?.slice(0, 10) ?? "",
    ].join("|");

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    id: document.id,
    source_type: resolvedSourceType(source),
    title_original: title,
    url,
    source_name: source.name,
    source_country: source.country,
    source_language: source.language,
    published_at: sanitizePublishedAt(document.publishedAt, {
      allowFuture: source.type === "calendar",
    }),
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
  const retrievalMethod = isMarketSource(source) ? "market" : retrievalMethodForIngestion(source);

  try {
    const limit = source.maxItemsPerRun ?? options.limitPerSource ?? 25;
    const preserveRawContent = options.preserveRawContent ?? source.preserveRawContent;
    let documents: RawSourceDocument[] = [];
    let sourceErrors: Array<{ message: string; url?: string }> = [];
    let websiteStats: WebsiteFetchStats | undefined;

    if (retrievalMethod === "rss") {
      const adapter = ingestionAdapters.find((candidate) => candidate.type === "rss");

      if (!adapter) {
        return {
          sourceId: source.id,
          sourceName: source.name,
          retrievalMethod,
          fetchedCount: 0,
          storedCount: 0,
          skippedCount: 0,
          items: [],
          errors: [{ message: "No RSS ingestion adapter registered" }],
        };
      }

      documents = await adapter.fetch(source, {
        embassy: config,
        limit,
        preserveRawContent,
      });
    } else if (retrievalMethod === "market") {
      const recentItems = await listRawSourceItems({
        sourceName: source.name,
        limit: 10,
      });
      const result = await fetchMarketSource(source, {
        preserveRawContent,
        recentItems,
      });
      documents = result.documents;
      sourceErrors = result.errors;
    } else if (retrievalMethod === "website") {
      const result = await fetchWebsiteSource(source, {
        limit,
        preserveRawContent,
        isKnownUrl: async (url) => Boolean(await getRawSourceItemByUrl(canonicalUrl(url))),
      });
      documents = result.documents;
      sourceErrors = result.errors;
      websiteStats = result.stats;
    } else if (retrievalMethod === "social_api") {
      const adapter = ingestionAdapters.find((candidate) => candidate.type === "social");

      if (!adapter) {
        return {
          sourceId: source.id,
          sourceName: source.name,
          retrievalMethod,
          fetchedCount: 0,
          storedCount: 0,
          skippedCount: 0,
          items: [],
          errors: [{ message: "No social ingestion adapter registered" }],
        };
      }

      documents = await adapter.fetch(source, {
        embassy: config,
        limit,
        preserveRawContent,
        since: options.since,
      });
    } else {
      return {
        sourceId: source.id,
        sourceName: source.name,
        retrievalMethod,
        fetchedCount: 0,
        storedCount: 0,
        skippedCount: 0,
        items: [],
        errors: [{ message: `No ${retrievalMethod} ingestion adapter registered` }],
      };
    }

    const uniqueDocuments = dedupeDocuments(source, documents);
    const storedItems: RawSourceItem[] = [];
    let skippedCount = 0;

    for (const document of uniqueDocuments) {
      if (!isDocumentAfterSince(document, options.since)) {
        skippedCount += 1;
        continue;
      }

      const rawItem = toRawSourceItem(source, document, config);
      if (!rawItem) {
        skippedCount += 1;
        continue;
      }

      const rawItemId = createRawSourceItemId(rawItem);
      const existing = isMarketSource(source)
        ? await getRawSourceItemById(rawItemId)
        : (await getRawSourceItemById(rawItemId)) ?? (await getRawSourceItemByUrl(rawItem.url));
      if (existing) {
        skippedCount += 1;
        continue;
      }

      storedItems.push(await upsertRawSourceItem(rawItem));
    }

    return {
      sourceId: source.id,
      sourceName: source.name,
      retrievalMethod,
      fetchedCount: uniqueDocuments.length,
      storedCount: storedItems.length,
      skippedCount,
      items: storedItems,
      errors: sourceErrors,
      websiteStats,
    };
  } catch (error) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      retrievalMethod,
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

function emptyWebsiteStats(): WebsiteFetchStats {
  return {
    websiteSourcesScanned: 0,
    pagesFetched: 0,
    newUrlsFound: 0,
    duplicatesSkipped: 0,
    extractionFailures: 0,
    candidatesSentToAnalysis: 0,
    robotsSkipped: 0,
  };
}

function combineWebsiteStats(results: SourceIngestionResult[]) {
  return results.reduce((stats, result) => {
    if (!result.websiteStats) return stats;
    stats.websiteSourcesScanned += result.websiteStats.websiteSourcesScanned;
    stats.pagesFetched += result.websiteStats.pagesFetched;
    stats.newUrlsFound += result.websiteStats.newUrlsFound;
    stats.duplicatesSkipped += result.websiteStats.duplicatesSkipped;
    stats.extractionFailures += result.websiteStats.extractionFailures;
    stats.candidatesSentToAnalysis += result.websiteStats.candidatesSentToAnalysis;
    stats.robotsSkipped += result.websiteStats.robotsSkipped;
    return stats;
  }, emptyWebsiteStats());
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
  const candidateSources = (options.sources ?? ((await getSources()) as IngestibleSourceDefinition[])).filter(
    (source) => source.enabled && (sourceIds.size === 0 || sourceIds.has(source.id)),
  );
  const sourceEligibility = candidateSources.map((source) => ({
    source,
    eligibility: ingestionEligibility(source),
  }));
  const sources = sourceEligibility
    .filter((item) => item.eligibility.eligible)
    .map((item) => item.source);
  const rssActiveSourceCount = sourceEligibility.filter(
    (item) => item.eligibility.eligible && item.eligibility.retrievalMethod === "rss",
  ).length;
  const websiteActiveSourceCount = sourceEligibility.filter(
    (item) => item.eligibility.eligible && item.eligibility.retrievalMethod === "website",
  ).length;
  const socialActiveSourceCount = sourceEligibility.filter(
    (item) => item.eligibility.eligible && item.eligibility.retrievalMethod === "social_api",
  ).length;
  const skippedSources = sourceEligibility
    .filter((item) => !item.eligibility.eligible)
    .map((item): SkippedIngestionSource => ({
      sourceId: item.source.id,
      sourceName: item.source.name,
      retrievalMethod: item.eligibility.retrievalMethod,
      reason: item.eligibility.reason ?? "not eligible for ingestion",
    }));

  console.info("[MissionDesk ingestion] source selection", {
    totalSources: candidateSources.length,
    rssActiveSources: rssActiveSourceCount,
    websiteActiveSources: websiteActiveSourceCount,
    socialActiveSources: socialActiveSourceCount,
    skippedSourcesCount: skippedSources.length,
    skippedSources,
  });

  const results = await mapWithConcurrency(
    sources,
    options.concurrency ?? 6,
    (source) => ingestSource(source, config, options),
  );

  const websiteStats = combineWebsiteStats(results);

  console.info("[MissionDesk ingestion] website retrieval summary", websiteStats);

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    totalSourceCount: candidateSources.length,
    rssActiveSourceCount,
    websiteActiveSourceCount,
    socialActiveSourceCount,
    skippedSourceCount: skippedSources.length,
    skippedSources,
    sourceCount: sources.length,
    fetchedCount: results.reduce((total, result) => total + result.fetchedCount, 0),
    storedCount: results.reduce((total, result) => total + result.storedCount, 0),
    skippedCount: results.reduce((total, result) => total + result.skippedCount, 0),
    websiteStats,
    errors: results.flatMap((result) =>
      result.errors.map((error) => ({
        source: result.sourceName,
        ...error,
      })),
    ),
    results,
  };
}

export async function enqueueRawIngestionJobs(
  options: {
    sources?: IngestibleSourceDefinition[];
    sourceIds?: string[];
    sourceTypes?: Array<RawIngestionJobPayload["sourceType"]>;
    limitPerSource?: number;
    preserveRawContent?: boolean;
    since?: string;
  } = {},
) {
  const sourceIds = new Set(options.sourceIds ?? []);
  const sourceTypes = new Set(options.sourceTypes ?? []);
  const pendingSourceIds = new Set(
    (await listBackgroundJobs({ type: "ingest_raw_source", limit: 500 }))
      .filter((job) => job.status === "pending" || job.status === "running")
      .map((job) => job.payload.sourceId)
      .filter((value): value is string => typeof value === "string"),
  );
  const candidateSources = (options.sources ?? ((await getSources()) as IngestibleSourceDefinition[])).filter(
    (source) =>
      source.enabled &&
      (sourceIds.size === 0 || sourceIds.has(source.id)) &&
      (sourceTypes.size === 0 || sourceTypes.has(resolvedSourceType(source))),
  );
  const sourceEligibility = candidateSources.map((source) => ({
    source,
    eligibility: ingestionEligibility(source),
  }));
  const skippedSources = sourceEligibility
    .filter((item) => !item.eligibility.eligible)
    .map((item) => ({
      sourceId: item.source.id,
      sourceName: item.source.name,
      retrievalMethod: item.eligibility.retrievalMethod,
      reason: item.eligibility.reason ?? "not eligible for ingestion job",
    }));
  const sources = sourceEligibility
    .filter((item) => item.eligibility.eligible && !pendingSourceIds.has(item.source.id))
    .map((item) => item.source);

  console.info("[MissionDesk ingestion] job enqueue selection", {
    totalSources: candidateSources.length,
    rssActiveSources: sourceEligibility.filter(
      (item) => item.eligibility.eligible && item.eligibility.retrievalMethod === "rss",
    ).length,
    websiteActiveSources: sourceEligibility.filter(
      (item) => item.eligibility.eligible && item.eligibility.retrievalMethod === "website",
    ).length,
    socialActiveSources: sourceEligibility.filter(
      (item) => item.eligibility.eligible && item.eligibility.retrievalMethod === "social_api",
    ).length,
    skippedSourcesCount: skippedSources.length,
    skippedSources,
  });

  return Promise.all(
    sources.map((source) =>
      enqueueBackgroundJob({
        type: "ingest_raw_source",
        priority: sourcePriority(source),
        payload: {
          sourceId: source.id,
          sourceType: resolvedSourceType(source),
          url: source.url,
          limitPerSource: options.limitPerSource ?? source.maxItemsPerRun,
          preserveRawContent: options.preserveRawContent ?? source.preserveRawContent,
          since: options.since,
        },
      }),
    ),
  );
}
