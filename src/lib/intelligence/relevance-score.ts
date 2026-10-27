import type { EmbassyConfig, IntelligenceItem, ProfileMode, ScoreKey } from "@/lib/types";

const domainKeys = ["sweden_relevance_score", "economic_impact_score", "security_impact_score"] as const;
const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
const clamp = (score: number) => Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;

export function hasMissionCountryAnchor(item: IntelligenceItem, config: EmbassyConfig) {
  const divisionIds = new Set(config.geography.administrativeDivisions.map((division) => division.id));
  if (item.geographic_tags.some((tag) => divisionIds.has(tag))) return true;
  const text = normalize([item.title_original, item.title_sv, item.summary_sv, item.original_excerpt].join(" "));
  if (config.countryCode === "MX") {
    return /\b(mexik(?:o|ansk[a-z]*)|mexic(?:o|an[a-z]*)|cdmx|monterrey|guadalajara|banxico|pemex|sheinbaum|usmca|t[ -]?mec)\b/.test(text);
  }
  return text.split(/[^a-z0-9]+/).includes(normalize(config.country));
}

export function getMissionRelevanceScore(item: IntelligenceItem, config: EmbassyConfig, profile: ProfileMode) {
  const definition = config.profileModes.find((mode) => mode.id === profile);
  const weight = (key: ScoreKey) => Math.max(0,
    (config.scoringWeights[key] ?? 1) * (definition?.scoreWeights[key] ?? 1),
  );
  // Use the strongest relevant domain instead of averaging unrelated zero-valued dimensions.
  const focus = domainKeys.reduce((best, key) =>
    clamp(item[key]) * weight(key) > clamp(item[best]) * weight(best) ? key : best,
  );
  const dimensions = [
    { key: "diplomatic_relevance_score" as const, weight: 0.55 * weight("diplomatic_relevance_score") },
    { key: focus, weight: 0.35 * weight(focus) },
    { key: "urgency_score" as const, weight: 0.1 * weight("urgency_score") },
  ];
  const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  const base = totalWeight > 0
    ? dimensions.reduce((sum, dimension) => sum + clamp(item[dimension.key]) * dimension.weight, 0) / totalWeight
    : 0;
  const categoryWeight = Math.max(0.85, Math.min(1.12, definition?.categoryWeights[item.category] ?? 1));
  const score = clamp(base * categoryWeight);
  const countryAnchor = hasMissionCountryAnchor(item, config);
  // Sweden-focused research can include foreign Swedish interests; the national view needs a mission-country link.
  const ceiling = countryAnchor || profile === "sweden_connection" ? 99 : 44;
  return Math.round(Math.min(ceiling, score));
}
