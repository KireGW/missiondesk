import type { RawSourceDocument } from "@/lib/ingestion/types";
import { fetchRssSource } from "@/lib/ingestion/rss";
import type { RssHealthStatus, SourceDefinition } from "@/lib/types";

const commonFeedPaths = [
  "/rss",
  "/feed",
  "/feeds",
  "/rss.xml",
  "/atom.xml",
  "/index.xml",
];

const rssHealthLabels: Record<RssHealthStatus, string> = {
  verified: "RSS verifierad",
  recommended: "RSS rekommenderad",
  unusable: "Ingen fungerande RSS",
  low_quality: "RSS låg kvalitet",
  inactive: "RSS inaktiv",
  missing: "RSS saknas",
  rejected: "RSS avvisad",
  unknown: "RSS ej validerad",
};

export function normalizeRssHealthStatus(
  status?: RssHealthStatus | "found" | string,
): RssHealthStatus | undefined {
  if (!status) return undefined;
  if (status === "found") return "unusable";
  if (status in rssHealthLabels) return status as RssHealthStatus;
  return "unknown";
}

export interface RssQualityAuditResult {
  sourceId: string;
  sourceName: string;
  skipped: boolean;
  skippedReason?: string;
  status: RssHealthStatus;
  confidence: number;
  checkedAt: string;
  rssUrl?: string;
  websiteUrl?: string;
  discoveredUrls: string[];
  itemCount: number;
  recentItemCount: number;
  latestPublishedAt?: string;
  metadataScore: number;
  issues: string[];
  warnings: string[];
  suggestedAction: string;
  shouldPromoteToPrimary: boolean;
  shouldRejectAsPrimary: boolean;
}

export function rssHealthLabel(status: RssHealthStatus) {
  return rssHealthLabels[status];
}

export function primaryRetrievalFor(source: SourceDefinition) {
  return source.retrieval?.primary ?? source.retrievalMethod ?? source.type;
}

export function sourceWebsiteUrl(source: SourceDefinition) {
  if (source.websiteUrl) return source.websiteUrl;
  if (primaryRetrievalFor(source) !== "rss") return source.url;
  return undefined;
}

export function sourceRssUrl(source: SourceDefinition) {
  if (source.rssUrl) return source.rssUrl;
  if (primaryRetrievalFor(source) === "rss") return source.url;
  return undefined;
}

export function shouldAuditRssQuality(source: SourceDefinition) {
  const primary = primaryRetrievalFor(source);
  if (source.rssUrl) return { audit: true };
  if (primary === "rss" || primary === "website") return { audit: true };

  return {
    audit: false,
    reason:
      primary === "social_api"
        ? "Social API-källa – RSS-kvalitet är inte relevant."
        : primary === "api"
          ? "API-källa – RSS-kvalitet är inte relevant utan explicit rssUrl."
          : "Källtypen lämpar sig inte för RSS-audit utan explicit rssUrl.",
  };
}

export function skippedRssQualityResult(
  source: SourceDefinition,
  reason: string,
): RssQualityAuditResult {
  return {
    sourceId: source.id,
    sourceName: source.name,
    skipped: true,
    skippedReason: reason,
    status: source.rssHealthStatus ?? "unknown",
    confidence: source.rssHealthConfidence ?? 0,
    checkedAt: new Date().toISOString(),
    rssUrl: source.rssUrl,
    websiteUrl: sourceWebsiteUrl(source),
    discoveredUrls: [],
    itemCount: source.rssHealthItemCount ?? 0,
    recentItemCount: source.rssHealthRecentItemCount ?? 0,
    latestPublishedAt: source.rssHealthLatestPublishedAt,
    metadataScore: source.rssHealthMetadataScore ?? 0,
    issues: [],
    warnings: [],
    suggestedAction: reason,
    shouldPromoteToPrimary: false,
    shouldRejectAsPrimary: false,
  };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function sameOriginUrl(path: string, baseUrl: string) {
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "text" in value) {
    return textValue((value as { text?: unknown }).text);
  }
  return "";
}

function extractAlternateFeeds(html: string, baseUrl: string) {
  const candidates: string[] = [];
  const linkPattern = /<link\b[^>]*>/gi;
  const attrPattern = /([a-zA-Z:-]+)\s*=\s*["']([^"']+)["']/g;
  const links = html.match(linkPattern) ?? [];

  for (const link of links) {
    const attrs = new Map<string, string>();
    for (const match of link.matchAll(attrPattern)) {
      attrs.set(match[1].toLowerCase(), match[2]);
    }

    const rel = attrs.get("rel")?.toLowerCase() ?? "";
    const type = attrs.get("type")?.toLowerCase() ?? "";
    const href = attrs.get("href");

    if (
      href &&
      rel.includes("alternate") &&
      ["application/rss+xml", "application/atom+xml", "application/feed+json"].includes(type)
    ) {
      const resolved = sameOriginUrl(href, baseUrl);
      if (resolved) candidates.push(resolved);
    }
  }

  return candidates;
}

export async function discoverRssCandidates(
  source: SourceDefinition,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const websiteUrl = sourceWebsiteUrl(source) ?? source.url;
  const knownRssUrl = sourceRssUrl(source);
  const candidates: string[] = knownRssUrl ? [knownRssUrl] : [];

  try {
    const response = await fetchImpl(websiteUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
        "User-Agent": "MissionDesk/0.1 RSS quality audit",
      },
      signal: options.signal,
    });

    if (response.ok) {
      const html = await response.text();
      candidates.push(...extractAlternateFeeds(html, websiteUrl));
    }
  } catch {
    // Discovery is advisory; failed HTML checks should not block known RSS validation.
  }

  for (const path of commonFeedPaths) {
    const candidate = sameOriginUrl(path, websiteUrl);
    if (candidate) candidates.push(candidate);
  }

  return unique(candidates);
}

function metadataScoreFor(items: RawSourceDocument[]) {
  if (items.length === 0) return 0;
  const max = Math.min(items.length, 10);
  const score = items.slice(0, max).reduce((total, item) => {
    let itemScore = 0;
    if (item.title) itemScore += 25;
    if (item.url) itemScore += 25;
    if (item.publishedAt) itemScore += 25;
    if (item.excerpt || item.text) itemScore += 25;
    return total + itemScore;
  }, 0);
  return Math.round(score / max);
}

function latestPublishedAtFor(items: RawSourceDocument[]) {
  return items
    .map((item) => item.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function recentCountFor(items: RawSourceDocument[], now = Date.now()) {
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  return items.filter((item) => {
    if (!item.publishedAt) return false;
    const published = Date.parse(item.publishedAt);
    return !Number.isNaN(published) && published >= thirtyDaysAgo;
  }).length;
}

function classifyRssQuality(args: {
  source: SourceDefinition;
  rssUrl?: string;
  discoveredUrls: string[];
  items: RawSourceDocument[];
  errors: string[];
  checkedAt: string;
}): RssQualityAuditResult {
  const { source, rssUrl, discoveredUrls, items, errors, checkedAt } = args;
  const primary = primaryRetrievalFor(source);
  const metadataScore = metadataScoreFor(items);
  const latestPublishedAt = latestPublishedAtFor(items);
  const recentItemCount = recentCountFor(items);
  const issues = [...errors];
  const warnings: string[] = [];

  if (items.length === 0 && discoveredUrls.length === 0) {
    issues.push("Ingen RSS/Atom-feed hittades.");
  } else if (items.length === 0) {
    issues.push("Ingen fungerande RSS kunde läsas från testade feed-adresser.");
  }

  if (items.length > 0 && recentItemCount === 0) {
    warnings.push("RSS hittad men verkar sakna färska poster.");
  }

  if (items.length > 0 && metadataScore < 70) {
    warnings.push("RSS hittad men metadata är ofullständig.");
  }

  const highQuality = items.length >= 3 && recentItemCount > 0 && metadataScore >= 70;
  const lowQuality = items.length > 0 && !highQuality;
  const missing = discoveredUrls.length === 0 && items.length === 0;
  const inactive = items.length > 0 && recentItemCount === 0;

  let status: RssHealthStatus = "unknown";
  if (highQuality && primary === "rss") status = "verified";
  else if (highQuality) status = "recommended";
  else if (inactive) status = "inactive";
  else if (lowQuality) status = "low_quality";
  else if (missing) status = "missing";
  else if (discoveredUrls.length > 0) status = "unusable";

  const shouldPromoteToPrimary = status === "recommended";
  const shouldRejectAsPrimary = primary === "rss" && ["low_quality", "inactive", "missing"].includes(status);

  if (shouldRejectAsPrimary) {
    issues.push("RSS hittad men ej lämplig som primär hämtning.");
  }

  return {
    sourceId: source.id,
    sourceName: source.name,
    skipped: false,
    status,
    confidence: highQuality ? 92 : lowQuality ? 62 : missing ? 80 : 50,
    checkedAt,
    rssUrl,
    websiteUrl: sourceWebsiteUrl(source),
    discoveredUrls,
    itemCount: items.length,
    recentItemCount,
    latestPublishedAt,
    metadataScore,
    issues,
    warnings,
    suggestedAction: shouldPromoteToPrimary
      ? "RSS verkar tillräckligt bra för primär hämtning."
      : shouldRejectAsPrimary
        ? "Behåll eller flytta källan till website som primär hämtning tills bättre RSS finns."
        : status === "unusable"
          ? "Website är rätt metadata tills website-hämtning implementeras."
        : status === "missing"
          ? "Behåll website-metadata. Hämtning ej implementerad."
          : "Behåll nuvarande metadata och granska vid behov.",
    shouldPromoteToPrimary,
    shouldRejectAsPrimary,
  };
}

async function validateCandidate(
  source: SourceDefinition,
  rssUrl: string,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
) {
  const auditSource: SourceDefinition = {
    ...source,
    url: rssUrl,
    type: "rss",
    retrieval: { primary: "rss", fallback: "website" },
    retrievalMethod: "rss",
  };

  const items = await fetchRssSource(auditSource, {
    limit: 15,
    signal: options.signal,
  });

  return items;
}

export async function auditRssQualityForSource(
  source: SourceDefinition,
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RssQualityAuditResult> {
  const eligibility = shouldAuditRssQuality(source);
  if (!eligibility.audit) {
    return skippedRssQualityResult(
      source,
      eligibility.reason ?? "RSS-audit är inte relevant för denna källa.",
    );
  }

  const checkedAt = new Date().toISOString();
  const discoveredUrls = await discoverRssCandidates(source, options);
  const errors: string[] = [];

  for (const rssUrl of discoveredUrls) {
    try {
      const items = await validateCandidate(source, rssUrl, options);
      return classifyRssQuality({
        source,
        rssUrl,
        discoveredUrls,
        items,
        errors,
        checkedAt,
      });
    } catch (error) {
      errors.push(`${rssUrl}: ${error instanceof Error ? error.message : "Okänt fel"}`);
    }
  }

  return classifyRssQuality({
    source,
    discoveredUrls,
    items: [],
    errors,
    checkedAt,
  });
}

export function sourceWithRssQualityMetadata(
  source: SourceDefinition,
  result: RssQualityAuditResult,
): SourceDefinition {
  if (result.skipped) return source;

  const promoteToRss =
    result.shouldPromoteToPrimary && result.rssUrl
      ? {
          retrieval: { primary: "rss" as const, fallback: "website" as const },
          retrievalMethod: "rss" as const,
          rssUrl: result.rssUrl,
          websiteUrl: result.websiteUrl ?? source.websiteUrl ?? source.url,
        }
      : {};

  return {
    ...source,
    ...promoteToRss,
    rssUrl: result.rssUrl ?? source.rssUrl,
    websiteUrl: result.websiteUrl ?? source.websiteUrl,
    rssHealthStatus: result.status,
    rssHealthCheckedAt: result.checkedAt,
    rssHealthConfidence: result.confidence,
    rssHealthItemCount: result.itemCount,
    rssHealthRecentItemCount: result.recentItemCount,
    rssHealthLatestPublishedAt: result.latestPublishedAt,
    rssHealthMetadataScore: result.metadataScore,
    rssHealthIssues: result.issues,
    rssHealthWarnings: result.warnings,
    rssHealthSuggestedAction: result.suggestedAction,
  };
}

export function buildRssQualityReport(results: RssQualityAuditResult[]) {
  const audited = results.filter((item) => !item.skipped);
  return {
    generatedAt: new Date().toISOString(),
    skipped: results.filter((item) => item.skipped),
    existingRssPassed: audited.filter((item) => item.status === "verified"),
    existingRssWithProblems: audited.filter((item) => item.shouldRejectAsPrimary),
    websiteSourcesRecommendedForRss: audited.filter((item) => item.shouldPromoteToPrimary),
    rssFoundButRejected: audited.filter((item) =>
      ["low_quality", "inactive", "rejected"].includes(item.status),
    ),
    noRssFound: audited.filter((item) => item.status === "missing"),
    manualReview: audited.filter((item) =>
      ["unusable", "unknown"].includes(item.status) || item.confidence < 70,
    ),
  };
}
