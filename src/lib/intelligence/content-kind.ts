import type { RawSourceItem } from "@/lib/intelligence/models";

export function contentKindForRaw(item: Pick<RawSourceItem, "source_type" | "published_at" | "title_original" | "url">): "news" | "reference" {
  if (item.published_at && Number.isFinite(Date.parse(item.published_at))) return "news";
  const text = `${item.title_original} ${item.url}`.toLowerCase();
  return item.source_type === "report" || /business.climate|survey|\/reports?\/|\/publications?\//.test(text)
    ? "reference" : "news";
}

export function referenceYearForRaw(item: Pick<RawSourceItem, "title_original" | "url">) {
  const years = `${item.title_original} ${item.url}`.match(/\b20\d{2}\b/g)?.map(Number) ?? [];
  return years.length > 0 ? Math.max(...years) : undefined;
}
