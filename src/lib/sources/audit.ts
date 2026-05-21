import type { RetrievalMethod, SourceCategory, SourceDefinition, SourceType } from "@/lib/types";

export type SourceAuditDetectedType =
  | "rss_feed"
  | "website"
  | "government_page"
  | "official_social_account"
  | "market_reference_page";

export interface SourceAuditResult {
  sourceId: string;
  currentType: SourceType;
  currentCategory: SourceCategory;
  currentRetrievalMethod: RetrievalMethod;
  currentPlatform?: string;
  detectedType: SourceAuditDetectedType;
  recommendedType: string;
  recommendedClass: string;
  recommendedCategory: SourceCategory;
  recommendedRetrievalMethod: RetrievalMethod;
  recommendedPlatform?: string;
  confidence: number;
  issues: string[];
  warnings: string[];
  suggestedAction: string;
}

const labels: Record<SourceAuditDetectedType, string> = {
  rss_feed: "RSS feed",
  website: "Webbplats",
  government_page: "Myndighetssida",
  official_social_account: "Officiellt socialt konto",
  market_reference_page: "Marknads-/referenssida",
};

const sourceCategoryLabels: Record<SourceCategory, string> = {
  government: "Myndighet",
  media: "Media",
  market: "Marknad",
  website: "Webbplats",
};

const retrievalMethodLabels: Record<RetrievalMethod, string> = {
  rss: "RSS",
  website: "Website",
  api: "API",
  social_api: "Social API",
};

const socialHosts = new Set([
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "t.me",
]);

function normalizeHost(host: string) {
  return host.toLowerCase().replace(/^www\./, "").replace(/^mobile\./, "").replace(/^m\./, "");
}

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function includesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function retrievalMethodFor(source: SourceDefinition): RetrievalMethod {
  if (source.retrieval?.primary) return source.retrieval.primary;
  if (source.retrievalMethod) return source.retrievalMethod;
  if (source.type === "rss") return "rss";
  if (source.type === "api" || source.type === "calendar") return "api";
  if (source.type === "social") return "social_api";
  return "website";
}

function hasSeparateRssRetrieval(source: SourceDefinition) {
  return retrievalMethodFor(source) === "rss" && Boolean(source.rssUrl);
}

function fallbackRetrievalMethodFor(
  source: SourceDefinition,
  primary: RetrievalMethod,
): RetrievalMethod | undefined {
  if (source.retrieval?.fallback && source.retrieval.fallback !== primary) {
    return source.retrieval.fallback;
  }

  if (primary === "rss") return "website";
  return undefined;
}

function platformFor(source: SourceDefinition) {
  if (source.platform) return source.platform;
  const url = parseUrl(source.url);
  if (!url) return undefined;
  const host = normalizeHost(url.hostname);
  if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com") return "x";
  if (host === "youtube.com" || host.endsWith(".youtube.com")) return "youtube";
  if (host === "t.me" || host.endsWith(".t.me")) return "telegram";
  return undefined;
}

function normalizeSourceCategory(
  value: SourceDefinition["sourceCategory"] | "social" | undefined,
  source: SourceDefinition,
): SourceCategory | undefined {
  if (!value) return undefined;
  if (value !== "social") return value;
  return isGovernmentLikeSource(source) ? "government" : "website";
}

function isGovernmentLikeSource(source: SourceDefinition) {
  const text = `${source.name} ${source.url} ${source.notes ?? ""} ${source.sourceType ?? ""}`.toLowerCase();
  return includesAny(text, [
    /\bgob\.mx\b/,
    /\bgov\b/,
    /\bsre\b/,
    /embajada/,
    /sweden abroad/,
    /regeringen/,
    /utrikesdepartement/,
    /state department/,
    /trade representative/,
    /banxico/,
    /inegi/,
    /secretar[ií]a/,
    /instituto nacional/,
    /diario oficial/,
    /suprema corte/,
  ]);
}

function categoryFor(source: SourceDefinition, detectedType?: SourceAuditDetectedType): SourceCategory {
  const storedCategory = normalizeSourceCategory(
    source.sourceCategory as SourceDefinition["sourceCategory"] | "social" | undefined,
    source,
  );
  if (storedCategory) return storedCategory;
  if (detectedType === "market_reference_page") return "market";
  if (source.sourceType === "government" || source.sourceType === "advisory") return "government";
  if (source.sourceType === "news") return "media";
  if (isGovernmentLikeSource(source)) return "government";
  if (detectedType === "official_social_account" || source.sourceType === "social") return "website";
  if (source.type === "rss") return "media";
  return "website";
}

function isLikelyRss(url: URL, source: SourceDefinition) {
  const text = `${url.href} ${source.name} ${source.notes ?? ""}`.toLowerCase();
  return (
    source.type === "rss" ||
    includesAny(text, [
      /\brss\b/,
      /\batom\b/,
      /\bfeed\b/,
      /outboundfeeds/,
      /format=rss/,
      /\/xml\b/,
      /\.xml(\?|$)/,
    ])
  );
}

function isOfficialSocial(url: URL, source: SourceDefinition) {
  const host = normalizeHost(url.hostname);
  return (
    source.type === "social" ||
    source.sourceType === "social" ||
    socialHosts.has(host) ||
    [...socialHosts].some((candidate) => host.endsWith(`.${candidate}`))
  );
}

function isMarketReference(url: URL, source: SourceDefinition) {
  const text = `${url.href} ${source.name} ${source.notes ?? ""}`.toLowerCase();
  return includesAny(text, [
    /bloomberg\.com\/quote/,
    /finance\.yahoo\.com\/quote/,
    /markets\.businessinsider\.com/,
    /investing\.com\/(indices|currencies|rates-bonds|commodities)/,
    /marketwatch\.com\/investing/,
    /\/quote\//,
  ]);
}

function isGovernmentPage(url: URL, source: SourceDefinition) {
  const text = `${url.href} ${source.name} ${source.notes ?? ""} ${source.sourceType ?? ""}`.toLowerCase();
  return (
    source.sourceType === "government" ||
    includesAny(text, [
      /(^|\.)gob\.mx\b/,
      /(^|\.)gov\b/,
      /(^|\.)gov\./,
      /\/prensa\b/,
      /comunicado/,
      /secretar[ií]a/,
      /ministerio/,
      /embajada/,
      /banxico\.org\.mx/,
      /inegi\.org\.mx/,
      /scb\.se/,
      /riksbank\.se/,
      /regeringen\.se/,
    ])
  );
}

function detectedFor(source: SourceDefinition): {
  detectedType: SourceAuditDetectedType;
  confidence: number;
} {
  if (hasSeparateRssRetrieval(source)) {
    return { detectedType: "rss_feed", confidence: 98 };
  }

  const url = parseUrl(source.url);
  if (!url) return { detectedType: "website", confidence: 35 };

  if (isOfficialSocial(url, source)) {
    return { detectedType: "official_social_account", confidence: 94 };
  }

  if (isLikelyRss(url, source)) {
    return { detectedType: "rss_feed", confidence: source.type === "rss" ? 98 : 88 };
  }

  if (isMarketReference(url, source)) {
    return { detectedType: "market_reference_page", confidence: 90 };
  }

  if (isGovernmentPage(url, source)) {
    return { detectedType: "government_page", confidence: source.sourceType === "government" ? 92 : 84 };
  }

  return { detectedType: "website", confidence: 72 };
}

function recommendedFor(detectedType: SourceAuditDetectedType) {
  if (detectedType === "rss_feed") return "rss";
  if (detectedType === "official_social_account") return "social_api";
  if (detectedType === "government_page") return "website + sourceType: government";
  if (detectedType === "market_reference_page") return "website + sourceType: other/reference";
  return "website";
}

function recommendedClassFor(detectedType: SourceAuditDetectedType) {
  if (detectedType === "official_social_account") return "Officiellt socialt konto";
  if (detectedType === "government_page") return "Myndighet";
  if (detectedType === "market_reference_page") return "Marknad/referens";
  if (detectedType === "rss_feed") return "RSS-hämtning";
  return "Webbplats";
}

function recommendedRetrievalMethodFor(
  detectedType: SourceAuditDetectedType,
  current: RetrievalMethod,
): RetrievalMethod {
  if (detectedType === "rss_feed") return "rss";
  if (detectedType === "official_social_account") return "social_api";
  if (current === "api") return "api";
  return "website";
}

function recommendedCategoryFor(
  source: SourceDefinition,
  detectedType: SourceAuditDetectedType,
  current: SourceCategory,
): SourceCategory {
  if (detectedType === "market_reference_page") return "market";
  if (detectedType === "government_page") return "government";
  if (detectedType === "official_social_account") {
    return isGovernmentLikeSource(source) ? "government" : "website";
  }
  if (source.sourceType === "news") return "media";
  return current;
}

function issuesFor(source: SourceDefinition, detectedType: SourceAuditDetectedType) {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!parseUrl(source.url)) {
    issues.push("URL:en kunde inte tolkas som en giltig webbadress.");
  }

  if (detectedType === "rss_feed" && retrievalMethodFor(source) !== "rss") {
    issues.push("Ser ut som RSS/XML men nuvarande hämtmetod är inte RSS.");
  }

  if (
    detectedType !== "rss_feed" &&
    retrievalMethodFor(source) === "rss" &&
    !source.rssUrl
  ) {
    issues.push("Hämtas via RSS men URL:en ser inte tydligt ut som ett RSS/XML-flöde.");
  }

  if (detectedType === "official_social_account" && retrievalMethodFor(source) !== "social_api") {
    warnings.push("Kan markeras med social API som rekommenderad hämtmetod i metadata.");
  }

  if (detectedType === "government_page" && categoryFor(source) !== "government") {
    warnings.push("Kan markeras som myndighet i källkategorin.");
  }

  if (detectedType === "market_reference_page") {
    warnings.push("Kan hanteras som marknads-/referenskälla i en senare källstrategi.");
  }

  return { issues, warnings };
}

function suggestedAction(
  source: SourceDefinition,
  detectedType: SourceAuditDetectedType,
  issues: string[],
  warnings: string[],
) {
  if (issues.length === 0 && warnings.length === 0) {
    return "Ingen åtgärd föreslås. Behåll befintlig konfiguration.";
  }

  if (detectedType === "rss_feed" && retrievalMethodFor(source) !== "rss") {
    return "Godkänn som metadataförslag om källan bör beskrivas som RSS-hämtning.";
  }

  if (detectedType === "official_social_account") {
    return "Godkänn som metadataförslag om källan ska beskrivas som social hämtning.";
  }

  if (detectedType === "government_page") {
    return "Godkänn som metadataförslag om källan ska beskrivas som myndighet.";
  }

  if (detectedType === "market_reference_page") {
    return "Godkänn som metadataförslag och behåll befintlig hämtning tills marknadslogik införs.";
  }

  return "Bedöm klassificeringen manuellt vid behov.";
}

export function auditSource(source: SourceDefinition): SourceAuditResult {
  const { detectedType, confidence } = detectedFor(source);
  const { issues, warnings } = issuesFor(source, detectedType);
  const currentRetrievalMethod = retrievalMethodFor(source);
  const currentCategory = categoryFor(source);
  const recommendedRetrievalMethod = recommendedRetrievalMethodFor(
    detectedType,
    currentRetrievalMethod,
  );
  const recommendedCategory = recommendedCategoryFor(source, detectedType, currentCategory);
  const recommendedPlatform =
    detectedType === "official_social_account" ? platformFor(source) : undefined;

  return {
    sourceId: source.id,
    currentType: source.type,
    currentCategory,
    currentRetrievalMethod,
    currentPlatform: platformFor(source),
    detectedType,
    recommendedType: recommendedFor(detectedType),
    recommendedClass: recommendedClassFor(detectedType),
    recommendedCategory,
    recommendedRetrievalMethod,
    recommendedPlatform,
    confidence,
    issues,
    warnings,
    suggestedAction: suggestedAction(source, detectedType, issues, warnings),
  };
}

export function auditSources(sources: SourceDefinition[]) {
  return sources.map(auditSource);
}

export function sourceWithAuditMetadata(
  source: SourceDefinition,
  auditedAt = new Date().toISOString(),
): SourceDefinition {
  const result = auditSource(source);
  const officialSocialAccount = result.detectedType === "official_social_account";
  const sourceCategory =
    officialSocialAccount
      ? result.recommendedCategory
      : normalizeSourceCategory(
          source.sourceCategory as SourceDefinition["sourceCategory"] | "social" | undefined,
          source,
        ) ?? result.currentCategory;
  const retrievalMethod = officialSocialAccount
    ? result.recommendedRetrievalMethod
    : source.retrieval?.primary ?? source.retrievalMethod ?? result.currentRetrievalMethod;
  const fallbackRetrievalMethod = fallbackRetrievalMethodFor(source, retrievalMethod);
  const platform = officialSocialAccount
    ? result.recommendedPlatform ?? result.currentPlatform
    : source.platform ?? result.currentPlatform;
  const rssUrl = source.rssUrl ?? (retrievalMethod === "rss" ? source.url : undefined);
  const websiteUrl = source.websiteUrl ?? (retrievalMethod !== "rss" ? source.url : undefined);

  return {
    ...source,
    sourceCategory,
    retrieval: {
      primary: retrievalMethod,
      ...(fallbackRetrievalMethod ? { fallback: fallbackRetrievalMethod } : {}),
    },
    retrievalMethod,
    platform,
    rssUrl,
    websiteUrl,
    auditDetectedType: result.detectedType,
    recommendedSourceType: result.recommendedType,
    auditRecommendedType: result.recommendedType,
    auditRecommendedClass: result.recommendedClass,
    auditRecommendedCategory: result.recommendedCategory,
    auditRecommendedRetrievalMethod: result.recommendedRetrievalMethod,
    auditRecommendedPlatform: result.recommendedPlatform,
    auditConfidence: result.confidence,
    auditIssues: result.issues,
    auditWarnings: result.warnings,
    auditSuggestedAction: result.suggestedAction,
    auditUpdatedAt: auditedAt,
    auditReviewState:
      officialSocialAccount && source.auditReviewState !== "ignored"
        ? "confirmed"
        : source.auditReviewState,
    auditReviewedAt:
      officialSocialAccount && source.auditReviewState !== "ignored"
        ? source.auditReviewedAt ?? auditedAt
        : source.auditReviewedAt,
    auditConfirmedRecommendedType:
      officialSocialAccount && source.auditReviewState !== "ignored"
        ? result.recommendedType
        : source.auditConfirmedRecommendedType,
    auditConfirmedCategory:
      officialSocialAccount && source.auditReviewState !== "ignored"
        ? result.recommendedCategory
        : source.auditConfirmedCategory,
    auditConfirmedRetrievalMethod:
      officialSocialAccount && source.auditReviewState !== "ignored"
        ? result.recommendedRetrievalMethod
        : source.auditConfirmedRetrievalMethod,
    auditConfirmedPlatform:
      officialSocialAccount && source.auditReviewState !== "ignored"
        ? result.recommendedPlatform
        : source.auditConfirmedPlatform,
  };
}

export function sourceAuditTypeLabel(type: SourceAuditDetectedType) {
  return labels[type];
}

export function sourceCategoryLabel(category: SourceCategory) {
  return sourceCategoryLabels[category];
}

export function retrievalMethodLabel(method: RetrievalMethod) {
  return retrievalMethodLabels[method];
}
