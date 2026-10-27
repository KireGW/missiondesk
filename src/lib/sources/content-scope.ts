import { defaultSources } from "@/lib/sources/default-sources";
import type { SourceDefinition } from "@/lib/types";

const normalize = (value: string) => value.toLowerCase().normalize("NFD")
  .replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ");

export function matchesSourceContentScope(
  source: Pick<SourceDefinition, "id" | "contentKeywords">,
  title: string,
  url: string,
) {
  const keywords = source.contentKeywords ?? defaultSources.find((candidate) => candidate.id === source.id)?.contentKeywords;
  if (!keywords?.length) return true;
  // Source names, page navigation and default country metadata are not article evidence.
  const content = ` ${normalize(`${title} ${url}`)} `;
  return keywords.some((keyword) => content.includes(` ${normalize(keyword).trim()} `));
}

export function matchesConfiguredSourceScope(item: { source_name: string; title_original: string; url: string }) {
  const source = defaultSources.find((candidate) => candidate.name === item.source_name);
  return !source || matchesSourceContentScope(source, item.title_original, item.url);
}
