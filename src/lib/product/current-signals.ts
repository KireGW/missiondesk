import type { IntelligenceItem } from "@/lib/types";
import { canonicalSignalUrl } from "@/lib/product/workspace-selection";
import { normalizeWorkspaceText } from "@/lib/product/workspace-text";

const mexicoCityDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
});

function reportedDevelopmentKey(item: IntelligenceItem): string | null {
  // Deliberately narrow first rule: Spanish reports of the same conditional
  // tariff-doubling threat. Unknown events keep their existing presentation.
  if (item.source_language !== "es" || item.content_kind === "reference" || !item.geographic_tags?.includes("MX")) return null;
  const published = Date.parse(item.published_at);
  if (!Number.isFinite(published)) return null;
  const headline = normalizeWorkspaceText(item.title_original ?? "");
  const text = `${headline} ${normalizeWorkspaceText(item.original_excerpt ?? "")}`;
  if (!/\btrump\b/.test(headline) || !/\bmexico\b/.test(headline) || !/\bduplicar(?:ia)?\b/.test(headline)
    || !/\b(?:arancel(?:es)?|araranceles)\b/.test(headline) || !/\bamenaz(?:a|o|ar|aria)\b/.test(text)
    || !/\b(?:detiene|detener|frenar)\b[^.!?;]{0,100}\bcaravanas?\b/.test(headline)
    || !/\bmigrantes?\b/.test(text)) return null;

  // A response, agreement, withdrawal, implementation, denial or explicit new
  // deadline is a separate development, even if it repeats the original threat.
  if (/\b(?:respond\w*|respuesta\w*|reaccion\w*|replic\w*|rechaz\w*|desactiv\w*|cancel\w*|suspend\w*|retir\w*|acuerd\w*|negoci\w*|aplic\w*|implement\w*|impus\w*|impon\w*|niega|nego|desmiente|desmintio|descarta)\b/.test(text)
    || /\bentr\w*\s+en\s+vigor\b|\bno\s+(?:amenaz\w*|duplic\w*)\b|\b(?:a partir de|antes del?|plazo de|hasta el)\b/.test(text)) return null;

  // Different figures or geographic context must not disappear into a match.
  const figures = [...new Set((text.match(/\d+(?:[.,]\d+)?(?:\s*(?:%|por ciento|dias?|horas?|semanas?|mes(?:es)?|millones?))?/g) ?? [])
    .map(figure => figure.replace(/\s+/g, "")))].sort();
  return JSON.stringify(["conditional-tariff-doubling:trump:MX:migrant-caravans",
    mexicoCityDay.format(new Date(published)), [...new Set(item.geographic_tags)].sort(), figures]);
}

/** Presentation only: preserve existing order and objects; never alter stored decisions or search material. */
export function selectCurrentSignalItems(orderedItems: readonly IntelligenceItem[], limit: number): IntelligenceItem[] {
  const result: IntelligenceItem[] = [];
  const urls = new Set<string>();
  const developments = new Set<string>();
  for (const item of orderedItems) {
    if (result.length >= limit) break;
    const url = canonicalSignalUrl(item);
    if (urls.has(url)) continue;
    const development = reportedDevelopmentKey(item);
    if (development && developments.has(development)) continue;
    result.push(item);
    urls.add(url);
    if (development) developments.add(development);
  }
  return result;
}
