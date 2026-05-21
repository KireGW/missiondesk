import type { RawSourceDocument } from "@/lib/ingestion/types";
import type { SourceDefinition } from "@/lib/types";

const USER_AGENT = "MissionDesk/0.1 diplomatic briefing ingestion";
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_ARTICLE_TIMEOUT_MS = 7_000;
const MAX_CANDIDATE_LINKS_PER_SOURCE = 20;

export interface WebsiteFetchStats {
  websiteSourcesScanned: number;
  pagesFetched: number;
  newUrlsFound: number;
  duplicatesSkipped: number;
  extractionFailures: number;
  candidatesSentToAnalysis: number;
  robotsSkipped: number;
}

export interface WebsiteFetchResult {
  documents: RawSourceDocument[];
  stats: WebsiteFetchStats;
  errors: Array<{ message: string; url?: string }>;
}

interface WebsiteCandidateLink {
  title: string;
  url: string;
  score: number;
  publishedAt?: string;
  excerpt?: string;
  text?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

const stripHtml = (value: string) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const decodeEntities = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

const STATE_GOV_BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const OECD_CRAWLER_HEADERS = {
  "User-Agent": "Spacecat/1.0",
};

const firstMatch = (html: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = html.match(pattern)?.[1];
    if (match) return decodeEntities(match.replace(/\s+/g, " "));
  }
  return "";
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

function sourcePageUrl(source: SourceDefinition) {
  return source.websiteUrl ?? source.url;
}

function sameRegistrableHost(left: string, right: string) {
  try {
    const leftHost = new URL(left).hostname.toLowerCase().replace(/^www\./, "");
    const rightHost = new URL(right).hostname.toLowerCase().replace(/^www\./, "");
    return leftHost === rightHost;
  } catch {
    return false;
  }
}

function extractAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
  return match ? decodeEntities(match) : "";
}

const articleNoiseTerms = [
  "iniciar sesion",
  "suscribete",
  "suscríbete",
  "newsletter",
  "privacy",
  "politica de privacidad",
  "politica de cookies",
  "cookies",
  "contacto",
  "about",
  "acerca de",
  "home",
  "inicio",
  "menu",
  "search",
  "buscar",
  "leer mas",
  "leer más",
  "ver mas",
  "ver más",
  "más información",
  "more",
  "read more",
  "seguir leyendo",
];

function scoreArticleLink(title: string, href: string) {
  const normalizedTitle = normalize(title);
  const normalizedHref = normalize(href);
  if (
    !normalizedTitle ||
    articleNoiseTerms.some((term) => normalizedTitle.includes(normalize(term)))
  ) {
    return -100;
  }

  let score = 0;
  const titleLength = normalizedTitle.length;
  if (titleLength >= 70) score += 22;
  else if (titleLength >= 40) score += 18;
  else if (titleLength >= 24) score += 12;
  else if (titleLength >= 12) score += 6;
  else score -= 10;

  if (/\b(20\d{2}|19\d{2})\b/.test(normalizedHref)) score += 18;
  if (
    /(politica|economia|economy|security|seguridad|migracion|migration|trade|negocios|news|noticias|prensa|comunicado|boletin|reportaje|article|articulo|estados|mexico|internacional)/.test(
      normalizedHref,
    )
  ) {
    score += 14;
  }
  if (href.split("/").filter(Boolean).length >= 3) score += 6;
  if (/[?&](p|page|article|id)=/.test(normalizedHref)) score += 4;
  return score;
}

function extractArticleLinks(
  html: string,
  source: SourceDefinition,
  limit: number,
): WebsiteCandidateLink[] {
  const baseUrl = sourcePageUrl(source);
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const candidates = anchors
    .map((match) => {
      const attrs = match[1] ?? "";
      const innerHtml = match[2] ?? "";
      const href = extractAttribute(attrs, "href");
      if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("#")) {
        return null;
      }

      let resolvedUrl: string;
      try {
        resolvedUrl = canonicalUrl(new URL(href, baseUrl).toString());
      } catch {
        return null;
      }

      if (!sameRegistrableHost(resolvedUrl, baseUrl)) return null;

      const title =
        stripHtml(innerHtml) ||
        extractAttribute(attrs, "aria-label") ||
        extractAttribute(attrs, "title");
      const score = scoreArticleLink(title, resolvedUrl);
      if (!title || score < 0) return null;

      return {
        title: title.slice(0, 220),
        url: resolvedUrl,
        score,
      };
    })
    .filter((item): item is WebsiteCandidateLink => Boolean(item))
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  return candidates
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, limit);
}

function isDofSource(source: SourceDefinition) {
  try {
    const url = new URL(sourcePageUrl(source));
    return url.hostname.toLowerCase().replace(/^www\./, "") === "dof.gob.mx";
  } catch {
    return false;
  }
}

function isFtMexicoSource(source: SourceDefinition) {
  try {
    const url = new URL(sourcePageUrl(source));
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "ft.com" && /^\/mexico\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isStateGovMexicoSource(source: SourceDefinition) {
  try {
    const url = new URL(sourcePageUrl(source));
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "state.gov" && /^\/countries-areas\/mexico\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isOecdMexicoSource(source: SourceDefinition) {
  try {
    const url = new URL(sourcePageUrl(source));
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const pathname = url.pathname.replace(/\/+$/, "");
    return (
      hostname === "oecd.org" &&
      (pathname === "/mexico" || pathname === "/en/countries/mexico.html")
    );
  } catch {
    return false;
  }
}

function oecdContentTypeScore(label: string) {
  const normalized = normalize(label);
  if (normalized === "press release") return 36;
  if (normalized === "report") return 30;
  if (normalized === "country note") return 26;
  if (normalized === "working paper") return 18;
  if (normalized === "video") return 6;
  return 10;
}

function extractOecdCardsFromSection(
  sectionHtml: string,
  source: SourceDefinition,
  sectionLabel: "related_publications" | "latest_insights",
) {
  const baseUrl = sourcePageUrl(source);
  const matches = [
    ...sectionHtml.matchAll(
      /<div class="card[\s\S]*?<div class="card__content">[\s\S]*?<div class="card__tags">[\s\S]*?<div class="tag tag--small">([\s\S]*?)<\/div>[\s\S]*?<a class="card__title-link" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<div class="card__metadata">[\s\S]*?<div class="card__date">([\s\S]*?)<\/div>(?:[\s\S]*?<div class="card__pages">([\s\S]*?)<\/div>)?/gi,
    ),
  ];

  const seen = new Set<string>();
  const candidates: WebsiteCandidateLink[] = [];

  for (const match of matches) {
    const contentType = decodeEntities(stripHtml(match[1] ?? "")).trim();
    const href = decodeEntities(match[2] ?? "").trim();
    const title = decodeEntities(stripHtml(match[3] ?? "")).trim();
    const rawDate = decodeEntities(stripHtml(match[4] ?? "")).trim();
    const pages = decodeEntities(stripHtml(match[5] ?? "")).trim();
    if (!href || !title || !contentType || !rawDate) continue;

    let resolvedUrl: string;
    try {
      resolvedUrl = canonicalUrl(new URL(href, baseUrl).toString());
    } catch {
      continue;
    }

    if (seen.has(resolvedUrl)) continue;
    seen.add(resolvedUrl);

    const publishedAt = parseHumanDate(rawDate);
    const contentTypeLabel = contentType.slice(0, 80);
    const sectionScore = sectionLabel === "latest_insights" ? 8 : 4;

    candidates.push({
      title: title.slice(0, 240),
      url: resolvedUrl,
      score: scoreArticleLink(title, resolvedUrl) + oecdContentTypeScore(contentTypeLabel) + sectionScore,
      publishedAt,
      excerpt: [contentTypeLabel, pages].filter(Boolean).join(" · "),
      text: title,
      metadata: {
        sourceType: "website",
        retrievalMethod: "website",
        extractionMode: "oecd_country_cards",
        oecdSection: sectionLabel,
        oecdContentType: contentTypeLabel,
        metadataOnly: normalize(contentTypeLabel) === "video",
        pageCount: pages || null,
      },
    });
  }

  return candidates;
}

function extractOecdMexicoCards(html: string, source: SourceDefinition, limit: number) {
  const relatedSection =
    html.match(/<h2 class="cmp-title__text">\s*Related publications[\s\S]*?<ul class="cmp-list cmp-list--carousel-layout cmp-list--card-rendition swiper-wrapper">([\s\S]*?)<\/ul>/i)?.[1] ??
    "";
  const insightsSection =
    html.match(/<h2 class="cmp-title__text">\s*Latest insights[\s\S]*?<ul class="cmp-list cmp-list--carousel-layout cmp-list--card-rendition swiper-wrapper">([\s\S]*?)<\/ul>/i)?.[1] ??
    "";

  const candidates = [
    ...extractOecdCardsFromSection(relatedSection, source, "related_publications"),
    ...extractOecdCardsFromSection(insightsSection, source, "latest_insights"),
  ];

  const seen = new Set<string>();
  return candidates
    .sort(
      (left, right) =>
        (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") || right.score - left.score,
    )
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    })
    .slice(0, limit);
}

function extractStateGovHighlights(html: string, source: SourceDefinition, limit: number) {
  const baseUrl = sourcePageUrl(source);
  const entries = [
    ...html.matchAll(
      /<span class="state-content-feed__article-eyebrow "\s*>([\s\S]*?)<\/span>[\s\S]*?<p class="state-content-feed__article-headline">\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/p>/gi,
    ),
  ];

  const candidates: WebsiteCandidateLink[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const eyebrow = decodeEntities(stripHtml(entry[1] ?? "")).trim();
    const href = decodeEntities(entry[2] ?? "").trim();
    const title = decodeEntities(stripHtml(entry[3] ?? "")).trim();
    if (!href || !title) continue;

    let resolvedUrl: string;
    try {
      resolvedUrl = canonicalUrl(new URL(href, baseUrl).toString());
    } catch {
      continue;
    }

    if (seen.has(resolvedUrl)) continue;
    seen.add(resolvedUrl);

    const publishedAt = parseHumanDate(eyebrow);
    candidates.push({
      title: title.slice(0, 220),
      url: resolvedUrl,
      score: scoreArticleLink(title, resolvedUrl) + 28,
      publishedAt,
      metadata: {
        sourceType: "website",
        retrievalMethod: "website",
        extractionMode: "state_gov_highlights",
      },
    });
  }

  return candidates
    .sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") || right.score - left.score)
    .slice(0, limit);
}

function extractFtNewsSitemapCandidates(xml: string, limit: number) {
  const entries = [...xml.matchAll(/<url>\s*<loc>([^<]+)<\/loc>[\s\S]*?<news:publication_date>([^<]+)<\/news:publication_date>[\s\S]*?<news:title>([\s\S]*?)<\/news:title>[\s\S]*?<news:keywords>([\s\S]*?)<\/news:keywords>[\s\S]*?<\/url>/gi)];
  const terms = [
    "mexico",
    "mexican",
    "sheinbaum",
    "peso",
    "nearshoring",
    "sinaloa",
    "jalisco",
    "nuevo leon",
    "nuevo león",
    "latin america",
    "latin american",
    "latam",
    "americas",
    "trade war",
    "tariffs",
    "usmca",
    "tmec",
    "t-mec",
  ].map((term) => normalize(term));

  const candidates: WebsiteCandidateLink[] = [];

  for (const entry of entries) {
    const url = canonicalUrl(decodeEntities(entry[1] ?? "").trim());
    if (!/ft\.com\/content\//i.test(url)) continue;

    const publishedAtRaw = decodeEntities(entry[2] ?? "").trim();
    const publishedAt = publishedAtRaw ? new Date(publishedAtRaw).toISOString() : undefined;
    const title = decodeEntities(stripHtml(entry[3] ?? "")).trim();
    const keywordsRaw = decodeEntities(stripHtml(entry[4] ?? "")).trim();
    if (!title) continue;

    const haystack = normalize([title, keywordsRaw].filter(Boolean).join(" "));
    const hits = terms.filter((term) => haystack.includes(term)).length;
    if (hits === 0) continue;

    const keywords = keywordsRaw
      .split(/\s*,\s*/)
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .slice(0, 8);
    const excerpt = keywords.length > 0 ? `FT-nyckelord: ${keywords.join(", ")}.` : undefined;
    const score = 24 + hits * 18 + Math.min(keywords.length, 5) * 2;

    candidates.push({
      title: title.slice(0, 220),
      url,
      score,
      publishedAt,
      excerpt,
      text: [title, keywords.join(", ")].filter(Boolean).join(". "),
      metadata: {
        sourceType: "website",
        retrievalMethod: "website",
        extractionMode: "ft_news_sitemap",
        sitemapUrl: "https://www.ft.com/sitemaps/news.xml",
        metadataOnly: true,
        keywordCount: keywords.length,
      },
    });
  }

  const seen = new Set<string>();
  return candidates
    .sort((left, right) => right.score - left.score)
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, limit);
}

function extractDofEditionDate(html: string) {
  const raw = firstMatch(html, [
    /Fecha:\s*(\d{2}\/\d{2}\/\d{4})\s*-\s*Edici[oó]n/i,
  ]);
  if (!raw) return undefined;

  const match = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return undefined;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function normalizeDofCandidateUrl(candidateUrl: string, editionDate?: string) {
  if (!editionDate) return candidateUrl;

  try {
    const url = new URL(candidateUrl);
    if (!/nota_detalle\.php$/i.test(url.pathname)) return candidateUrl;

    const fecha = url.searchParams.get("fecha");
    if (!fecha) return candidateUrl;

    const parsed = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!parsed) return candidateUrl;

    const [, day, month, year] = parsed;
    const expected = editionDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!expected) return candidateUrl;

    const [, expectedYear, expectedMonth, expectedDay] = expected;
    if (day === expectedDay && month === expectedMonth && year !== expectedYear) {
      url.searchParams.set("fecha", `${expectedDay}/${expectedMonth}/${expectedYear}`);
    }

    return canonicalUrl(url.toString());
  } catch {
    return candidateUrl;
  }
}

function extractDofIndexCandidates(html: string, source: SourceDefinition, limit: number) {
  const baseUrl = sourcePageUrl(source);
  const editionDate = extractDofEditionDate(html);
  const daySection =
    html.match(/<div id="dia_lateral"[\s\S]*?<\/div>\s*<\/div>/i)?.[0] ??
    html.match(/<div id="semana_lateral"[\s\S]*?<\/div>\s*<\/div>/i)?.[0] ??
    html;
  const anchors = [...daySection.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)];
  const seen = new Set<string>();
  const candidates: WebsiteCandidateLink[] = [];

  for (const match of anchors) {
    const attrs = match[1] ?? "";
    const innerHtml = match[2] ?? "";
    const href = extractAttribute(attrs, "href");
    if (!href || !/nota_detalle\.php/i.test(href)) continue;

    let resolvedUrl: string;
    try {
      resolvedUrl = normalizeDofCandidateUrl(new URL(href, baseUrl).toString(), editionDate);
    } catch {
      continue;
    }

    if (seen.has(resolvedUrl)) continue;
    seen.add(resolvedUrl);

    const title = stripHtml(innerHtml);
    if (!title) continue;

    candidates.push({
      title: title.slice(0, 240),
      url: resolvedUrl,
      score: scoreArticleLink(title, resolvedUrl) + 20,
      publishedAt: editionDate,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function extractTitle(html: string) {
  return firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
  ]);
}

function extractDescription(html: string) {
  return firstMatch(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i,
  ]);
}

const spanishMonths: Record<string, number> = {
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
};

const englishMonths: Record<string, number> = {
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

const dateOnly = (year: number, month: number, day: number) =>
  `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function parseHumanDate(value: string) {
  const normalized = normalize(value);
  const spanish = normalized.match(/\b(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})\b/);
  if (spanish) {
    const day = Number(spanish[1]);
    const month = spanishMonths[spanish[2]];
    const year = Number(spanish[3]);
    if (month !== undefined) return dateOnly(year, month, day);
  }

  const english = normalized.match(/\b([a-z]+)\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (english) {
    const month = englishMonths[english[1]];
    const day = Number(english[2]);
    const year = Number(english[3]);
    if (month !== undefined) return dateOnly(year, month, day);
  }

  return undefined;
}

function extractPublishedAt(html: string) {
  const raw = firstMatch(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["'][^>]*>/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']date["'][^>]*>/i,
    /<meta[^>]+name=["']dc\.date["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']dc\.date["'][^>]*>/i,
    /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
  ]);
  const humanDate =
    parseHumanDate(
      firstMatch(html, [
        /(?:publicado|actualizado)[^<]{0,80}?(\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4})/i,
        /(\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4})/i,
        /([a-z]+\s+\d{1,2},?\s+\d{4})/i,
      ]),
    );

  if (!raw) return humanDate;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();

  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? humanDate : new Date(timestamp).toISOString();
}

function isLikelyHtmlUrl(value: string) {
  try {
    const url = new URL(value);
    const pathname = url.pathname.toLowerCase();
    return !/\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|jpg|jpeg|png|gif|webp|svg|mp3|mp4|mov)$/i.test(
      pathname,
    );
  } catch {
    return true;
  }
}

function isLikelyRelevantDocument(title: string, excerpt?: string) {
  const text = normalize([title, excerpt].filter(Boolean).join(" "));
  if (text.length < 16) return false;
  if (articleNoiseTerms.some((term) => text === normalize(term))) return false;
  return true;
}

function signalWithTimeout(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function fetchText(url: string, options: {
  accept: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}) {
  const timeout = signalWithTimeout(options.signal, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: options.accept,
        "User-Agent": USER_AGENT,
        ...(options.headers ?? {}),
      },
      signal: timeout.signal,
    });

    if (!response.ok) {
      throw new Error(`Website fetch failed with ${response.status}`);
    }

    return response.text();
  } finally {
    timeout.clear();
  }
}

async function fetchHtml(url: string, signal?: AbortSignal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  return fetchText(url, {
    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
    signal,
    timeoutMs,
  });
}

const robotsCache = new Map<string, Promise<string | null>>();

function parseRobotsAllows(robotsText: string, targetUrl: string) {
  let pathname = "/";
  try {
    pathname = new URL(targetUrl).pathname || "/";
  } catch {
    return true;
  }

  let applies = false;
  const disallowRules: string[] = [];

  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;

    const [keyPart, ...valueParts] = line.split(":");
    const key = keyPart?.trim().toLowerCase();
    const value = valueParts.join(":").trim();

    if (key === "user-agent") {
      const agent = value.toLowerCase();
      applies = agent === "*" || agent.includes("missiondesk");
      continue;
    }

    if (applies && key === "disallow" && value) {
      disallowRules.push(value);
    }
  }

  return !disallowRules.some((rule) => pathname.startsWith(rule));
}

async function robotsAllows(url: string, signal?: AbortSignal) {
  let robotsUrl: string;
  try {
    const parsed = new URL(url);
    robotsUrl = `${parsed.origin}/robots.txt`;
  } catch {
    return true;
  }

  if (!robotsCache.has(robotsUrl)) {
    robotsCache.set(
      robotsUrl,
      fetchText(robotsUrl, {
        accept: "text/plain,*/*;q=0.7",
        signal,
        timeoutMs: 3_000,
      }).catch(() => null),
    );
  }

  const robotsText = await robotsCache.get(robotsUrl);
  if (!robotsText) return true;
  return parseRobotsAllows(robotsText, url);
}

function emptyStats(): WebsiteFetchStats {
  return {
    websiteSourcesScanned: 1,
    pagesFetched: 0,
    newUrlsFound: 0,
    duplicatesSkipped: 0,
    extractionFailures: 0,
    candidatesSentToAnalysis: 0,
    robotsSkipped: 0,
  };
}

export async function fetchWebsiteSource(
  source: SourceDefinition,
  options: {
    signal?: AbortSignal;
    preserveRawContent?: boolean;
    limit?: number;
    isKnownUrl?: (url: string) => Promise<boolean>;
  } = {},
): Promise<WebsiteFetchResult> {
  const stats = emptyStats();
  const errors: WebsiteFetchResult["errors"] = [];
  const documents: RawSourceDocument[] = [];
  const rootUrl = canonicalUrl(sourcePageUrl(source));
  const retrievedAt = new Date().toISOString();
  const sourceHeaders = isStateGovMexicoSource(source)
    ? STATE_GOV_BROWSER_HEADERS
    : isOecdMexicoSource(source)
      ? OECD_CRAWLER_HEADERS
      : undefined;
  const limit = Math.max(
    1,
    Math.min(MAX_CANDIDATE_LINKS_PER_SOURCE, options.limit ?? source.maxItemsPerRun ?? 12),
  );

  try {
    if (isFtMexicoSource(source)) {
      const sitemapUrl = "https://www.ft.com/sitemaps/news.xml";

      if (!(await robotsAllows(sitemapUrl, options.signal))) {
        stats.robotsSkipped += 1;
        return { documents, stats, errors };
      }

      const sitemapXml = await fetchText(sitemapUrl, {
        accept: "application/xml,text/xml;q=0.9,*/*;q=0.7",
        signal: options.signal,
        timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      });
      stats.pagesFetched += 1;

      const candidates = extractFtNewsSitemapCandidates(sitemapXml, limit);

      for (const [index, candidate] of candidates.entries()) {
        const candidateUrl = canonicalUrl(candidate.url);
        if (options.isKnownUrl && (await options.isKnownUrl(candidateUrl))) {
          stats.duplicatesSkipped += 1;
          continue;
        }

        stats.newUrlsFound += 1;
        documents.push({
          id: `${source.id}:${candidateUrl}:${index}`,
          sourceId: source.id,
          title: candidate.title,
          url: candidateUrl,
          language: source.language,
          country: source.country,
          publishedAt: candidate.publishedAt,
          retrievedAt,
          excerpt: candidate.excerpt,
          html: undefined,
          text: candidate.text,
          metadata: {
            sourceType: source.type,
            retrievalMethod: "website",
            sourceRootUrl: rootUrl,
            extractionMode: "ft_news_sitemap",
            metadataOnly: true,
            ...(candidate.metadata ?? {}),
          },
        });
        stats.candidatesSentToAnalysis += 1;
      }

      return { documents, stats, errors };
    }

    if (!(await robotsAllows(rootUrl, options.signal))) {
      stats.robotsSkipped += 1;
      return { documents, stats, errors };
    }

    const html = await fetchText(rootUrl, {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
      signal: options.signal,
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      headers: sourceHeaders,
    });
    stats.pagesFetched += 1;
    const candidates = (isDofSource(source)
      ? extractDofIndexCandidates(html, { ...source, url: rootUrl }, limit)
      : isStateGovMexicoSource(source)
        ? extractStateGovHighlights(html, { ...source, url: rootUrl }, limit)
        : isOecdMexicoSource(source)
          ? extractOecdMexicoCards(html, { ...source, url: rootUrl }, limit)
        : extractArticleLinks(html, { ...source, url: rootUrl }, limit))
      .filter((entry) => isLikelyHtmlUrl(entry.url))
      .slice(0, limit);

    for (const [index, candidate] of candidates.entries()) {
      const candidateUrl = canonicalUrl(candidate.url);

      if (options.isKnownUrl && (await options.isKnownUrl(candidateUrl))) {
        stats.duplicatesSkipped += 1;
        continue;
      }

      stats.newUrlsFound += 1;

      if (!(await robotsAllows(candidateUrl, options.signal))) {
        stats.robotsSkipped += 1;
        continue;
      }

      try {
        const articleHtml = candidateUrl === rootUrl
          ? html
          : await fetchText(candidateUrl, {
            accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
            signal: options.signal,
            timeoutMs: DEFAULT_ARTICLE_TIMEOUT_MS,
            headers: sourceHeaders,
          });
        if (candidateUrl !== rootUrl) stats.pagesFetched += 1;

        const title = extractTitle(articleHtml) || candidate.title;
        const description = extractDescription(articleHtml);
        const articleText = stripHtml(articleHtml).slice(0, 5000);

        if (!isLikelyRelevantDocument(title, description || articleText.slice(0, 240))) {
          stats.extractionFailures += 1;
          continue;
        }

        const extractedPublishedAt = extractPublishedAt(articleHtml);
        const publishedAt = isDofSource(source)
          ? candidate.publishedAt ?? extractedPublishedAt
          : extractedPublishedAt ?? candidate.publishedAt;

        documents.push({
          id: `${source.id}:${candidateUrl}:${index}`,
          sourceId: source.id,
          title,
          url: candidateUrl,
          language: source.language,
          country: source.country,
          publishedAt,
          retrievedAt,
          excerpt: candidate.excerpt || description || articleText.slice(0, 500),
          html: options.preserveRawContent ? articleHtml.slice(0, 50000) : undefined,
          text:
            candidate.text ||
            (options.preserveRawContent
              ? articleText
              : [title, description].filter(Boolean).join(". ")),
          metadata: {
            sourceType: source.type,
            retrievalMethod: "website",
            sourceRootUrl: rootUrl,
            extractionMode: isDofSource(source)
              ? "dof_index"
              : isStateGovMexicoSource(source)
                ? "state_gov_highlights"
                : isOecdMexicoSource(source)
                  ? "oecd_country_cards"
                : "generic_website",
            ...(candidate.metadata ?? {}),
          },
        });
        stats.candidatesSentToAnalysis += 1;
      } catch (error) {
        stats.extractionFailures += 1;
        errors.push({
          message: error instanceof Error ? error.message : "Website extraction failed",
          url: candidateUrl,
        });
      }
    }

    return { documents, stats, errors };
  } catch (error) {
    errors.push({
      message: error instanceof Error ? error.message : "Website source fetch failed",
      url: rootUrl,
    });
    return { documents, stats, errors };
  }
}

function homepageDocumentFromHtml(
  source: SourceDefinition,
  html: string,
  options: { preserveRawContent?: boolean } = {},
) {
  const pageUrl = sourcePageUrl(source);
  const retrievedAt = new Date().toISOString();
  const title = extractTitle(html) || source.name;
  const description = extractDescription(html);
  const text = stripHtml(html).slice(0, 5000);

  return {
    id: `${source.id}:${pageUrl}`,
    sourceId: source.id,
    title,
    url: pageUrl,
    language: source.language,
    country: source.country,
    publishedAt: extractPublishedAt(html),
    retrievedAt,
    excerpt: description || text.slice(0, 500),
    html: options.preserveRawContent ? html.slice(0, 50000) : undefined,
    text: options.preserveRawContent ? text : undefined,
    metadata: {
      sourceType: source.type,
      retrievalMethod: "website",
    },
  } satisfies RawSourceDocument;
}

async function fetchHtmlLegacy(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
      "User-Agent": USER_AGENT,
    },
    next: { revalidate: 900 },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Website fetch failed with ${response.status}`);
  }

  return response.text();
}

export async function fetchWebsiteMetadataSource(
  source: SourceDefinition,
  options: { signal?: AbortSignal; preserveRawContent?: boolean; limit?: number } = {},
): Promise<RawSourceDocument[]> {
  const html = await fetchHtmlLegacy(source.url, options.signal);
  const retrievedAt = new Date().toISOString();
  const description = extractDescription(html);
  const limit = Math.max(1, Math.min(20, options.limit ?? source.maxItemsPerRun ?? 8));
  const articleLinks = extractArticleLinks(html, source, limit);

  if (articleLinks.length > 0) {
    const documents: RawSourceDocument[] = [];

    for (const [index, entry] of articleLinks.entries()) {
      let articleHtml: string | undefined;
      try {
        articleHtml = entry.url === source.url ? html : await fetchHtmlLegacy(entry.url, options.signal);
      } catch {
        articleHtml = undefined;
      }

      const articleDescription = articleHtml ? extractDescription(articleHtml) : undefined;
      const articleText = articleHtml ? stripHtml(articleHtml).slice(0, 5000) : undefined;

      documents.push({
        id: `${source.id}:${entry.url}:${index}`,
        sourceId: source.id,
        title: articleHtml ? extractTitle(articleHtml) || entry.title : entry.title,
        url: entry.url,
        language: source.language,
        country: source.country,
        publishedAt: articleHtml ? extractPublishedAt(articleHtml) : undefined,
        retrievedAt,
        excerpt: articleDescription || description || entry.title,
        html: options.preserveRawContent ? articleHtml?.slice(0, 50000) : undefined,
        text: options.preserveRawContent
          ? articleText
          : [entry.title, articleDescription || description].filter(Boolean).join(". "),
        metadata: {
          sourceType: source.type,
        },
      });
    }

    return documents;
  }

  return [homepageDocumentFromHtml(source, html, options)];
}
