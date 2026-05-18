import { XMLParser } from "fast-xml-parser";
import type { RawSourceDocument } from "@/lib/ingestion/types";
import type { SourceDefinition } from "@/lib/types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  textNodeName: "text",
  cdataPropName: "text",
});

const asArray = <T>(value: T | T[] | undefined): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const textValue = (value: unknown): string => {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => textValue(entry)).find(Boolean) ?? "";
  }
  if (value && typeof value === "object" && "text" in value) {
    return textValue((value as { text?: unknown }).text);
  }
  return "";
};

const stripHtml = (value: string) =>
  value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const firstText = (...values: unknown[]) => {
  for (const value of values) {
    const text = stripHtml(textValue(value));
    if (text) return text;
  }
  return "";
};

const firstLink = (item: Record<string, unknown>) => {
  const link = item.link;
  if (typeof link === "string") return link;
  if (link && typeof link === "object") {
    const linkObject = link as { href?: unknown; text?: unknown };
    return firstText(linkObject.href, linkObject.text);
  }
  return firstText(item.guid);
};

const parseDate = (...values: unknown[]) => {
  const raw = firstText(...values);
  if (!raw) return undefined;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? undefined : new Date(timestamp).toISOString();
};

export async function fetchRssSource(
  source: SourceDefinition,
  options: { limit?: number; signal?: AbortSignal; preserveRawContent?: boolean } = {},
): Promise<RawSourceDocument[]> {
  const response = await fetch(source.url, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.7",
      "User-Agent": "MissionDesk/0.1 diplomatic briefing prototype",
    },
    next: { revalidate: 900 },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed with ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml) as {
    rss?: { channel?: { item?: Array<Record<string, unknown>> | Record<string, unknown> } };
    feed?: { entry?: Array<Record<string, unknown>> | Record<string, unknown> };
  };

  const rssItems = asArray(parsed.rss?.channel?.item);
  const atomItems = asArray(parsed.feed?.entry);
  const entries = rssItems.length > 0 ? rssItems : atomItems;
  const now = new Date().toISOString();

  return entries.slice(0, options.limit ?? 12).map((item, index) => {
    const title = firstText(item.title);
    const url = firstLink(item);
    const publishedAt = parseDate(
      item.pubDate,
      item.published,
      item.updated,
      item["dc:date"],
    );
    const excerpt = firstText(item.description, item.summary);
    const content = firstText(item.content, item["content:encoded"], item.description);
    const rawHtml = firstText(item["content:encoded"], item.content, item.description);

    return {
      id: `${source.id}:${publishedAt ?? now}:${index}:${title.slice(0, 32)}`,
      sourceId: source.id,
      title,
      url: url || source.url,
      language: source.language,
      country: source.country,
      publishedAt,
      retrievedAt: now,
      excerpt,
      html: options.preserveRawContent ? rawHtml : undefined,
      text: options.preserveRawContent ? content : excerpt,
      metadata: {
        sourceType: source.type,
      },
    };
  });
}
