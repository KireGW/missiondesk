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

const firstMatch = (value: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = value.match(pattern)?.[1];
    if (match) return stripHtml(match);
  }
  return "";
};

const canonicalUrl = (value: string) => {
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
};

function extractProfileTitle(html: string, source: SourceDefinition) {
  return firstMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
  ]) || source.name;
}

function extractProfileDescription(html: string) {
  return firstMatch(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ]);
}

function extractSocialPosts(html: string, source: SourceDefinition, limit: number) {
  const articles = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)];
  const now = new Date().toISOString();
  const items = articles
    .map((match, index) => {
      const block = match[1] ?? "";
      const text = firstMatch(block, [
        /data-testid=["']tweetText["'][^>]*>([\s\S]*?)<\/div>/i,
        /data-testid=["']tweetText["'][^>]*>([\s\S]*?)<\/span>/i,
        /lang=["'][^"']+["'][^>]*>([\s\S]*?)<\/span>/i,
      ]);
      const link = firstMatch(block, [/href=["']([^"']*\/status\/[^"']+)["']/i]);
      const publishedAt = firstMatch(block, [/time[^>]+datetime=["']([^"']+)["']/i]);
      const cleanedText = stripHtml(text);

      if (!cleanedText) return null;

      return {
        id: `${source.id}:${canonicalUrl(link || source.url)}:${index}`,
        sourceId: source.id,
        title: cleanedText.slice(0, 220),
        url: canonicalUrl(link || source.url),
        language: source.language,
        country: source.country,
        publishedAt: publishedAt || now,
        retrievedAt: now,
        excerpt: cleanedText.slice(0, 600),
        html: html.slice(0, 50000),
        text: cleanedText,
        metadata: {
          sourceType: source.sourceType ?? "social",
          profileTitle: extractProfileTitle(html, source),
        },
      } satisfies RawSourceDocument;
    })
    .filter(Boolean) as RawSourceDocument[];

  const limitedItems = items.slice(0, limit);

  if (limitedItems.length > 0) return limitedItems;

  const profileTitle = extractProfileTitle(html, source);
  const description = extractProfileDescription(html);

  return [
    {
      id: `${source.id}:${canonicalUrl(source.url)}`,
      sourceId: source.id,
      title: profileTitle,
      url: canonicalUrl(source.url),
      language: source.language,
      country: source.country,
      publishedAt: undefined,
      retrievedAt: now,
      excerpt: description || profileTitle,
      html: html.slice(0, 50000),
      text: description || stripHtml(html).slice(0, 5000),
      metadata: {
        sourceType: source.sourceType ?? "social",
        profileTitle,
      },
    },
  ];
}

export async function fetchSocialSource(
  source: SourceDefinition,
  options: { limit?: number; signal?: AbortSignal; preserveRawContent?: boolean } = {},
): Promise<RawSourceDocument[]> {
  const response = await fetch(source.url, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
      "User-Agent": "MissionDesk/0.1 diplomatic briefing ingestion",
    },
    next: { revalidate: 600 },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Social fetch failed with ${response.status}`);
  }

  const html = await response.text();
  const limit = Math.max(1, Math.min(10, options.limit ?? 6));
  const items = extractSocialPosts(html, source, limit);

  return items.map((item) => ({
    ...item,
    html: options.preserveRawContent ? item.html : undefined,
    text: options.preserveRawContent ? item.text : item.excerpt,
  }));
}
