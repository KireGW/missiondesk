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

async function fetchHtml(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
      "User-Agent": "MissionDesk/0.1 diplomatic briefing ingestion",
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
  const html = await fetchHtml(source.url, options.signal);
  const retrievedAt = new Date().toISOString();
  const title = extractTitle(html) || source.name;
  const description = extractDescription(html);
  const text = stripHtml(html).slice(0, 5000);
  const limit = Math.max(1, Math.min(20, options.limit ?? source.maxItemsPerRun ?? 8));
  const articleLinks = extractArticleLinks(html, source, limit);

  if (articleLinks.length > 0) {
    const documents: RawSourceDocument[] = [];

    for (const [index, entry] of articleLinks.entries()) {
      let articleHtml: string | undefined;
      try {
        articleHtml = entry.url === source.url ? html : await fetchHtml(entry.url, options.signal);
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
