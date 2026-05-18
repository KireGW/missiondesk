import type { RawSourceDocument } from "@/lib/ingestion/types";
import type { SourceDefinition } from "@/lib/types";

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

function extractArticleLinks(html: string, source: SourceDefinition, limit: number) {
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
        resolvedUrl = canonicalUrl(new URL(href, source.url).toString());
      } catch {
        return null;
      }

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
    .filter((item): item is { title: string; url: string; score: number } => Boolean(item))
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

function extractPublishedAt(html: string) {
  const raw = firstMatch(html, [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["'][^>]*>/i,
    /<time[^>]+datetime=["']([^"']+)["'][^>]*>/i,
    /"datePublished"\s*:\s*"([^"]+)"/i,
  ]);
  if (!raw) return undefined;

  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
}

export async function fetchWebsiteMetadataSource(
  source: SourceDefinition,
  options: { signal?: AbortSignal; preserveRawContent?: boolean; limit?: number } = {},
): Promise<RawSourceDocument[]> {
  const response = await fetch(source.url, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
      "User-Agent": "MissionDesk/0.1 diplomatic briefing ingestion",
    },
    next: { revalidate: 900 },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Website fetch failed with ${response.status}`);
  }

  const html = await response.text();
  const retrievedAt = new Date().toISOString();
  const title = extractTitle(html) || source.name;
  const description = extractDescription(html);
  const text = stripHtml(html).slice(0, 5000);
  const limit = Math.max(1, Math.min(20, options.limit ?? source.maxItemsPerRun ?? 8));
  const articleLinks = extractArticleLinks(html, source, limit);

  if (articleLinks.length > 0) {
    return articleLinks.map((entry, index) => ({
      id: `${source.id}:${entry.url}:${index}`,
      sourceId: source.id,
      title: entry.title,
      url: entry.url,
      language: source.language,
      country: source.country,
      publishedAt: extractPublishedAt(html) ?? retrievedAt,
      retrievedAt,
      excerpt: description || entry.title,
      html: options.preserveRawContent ? html.slice(0, 50000) : undefined,
      text: options.preserveRawContent ? text : [entry.title, description].filter(Boolean).join(". "),
      metadata: {
        sourceType: source.type,
      },
    }));
  }

  return [
    {
      id: `${source.id}:${source.url}`,
      sourceId: source.id,
      title,
      url: source.url,
      language: source.language,
      country: source.country,
      publishedAt: extractPublishedAt(html),
      retrievedAt,
      excerpt: description || text.slice(0, 500),
      html: options.preserveRawContent ? html.slice(0, 50000) : undefined,
      text: options.preserveRawContent ? text : undefined,
      metadata: {
        sourceType: source.type,
      },
    },
  ];
}
