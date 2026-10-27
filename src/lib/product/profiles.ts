import type { IntelligenceCategory, IntelligenceItem } from "@/lib/types";

export type PersonalLanguage = "sv" | "nb";
export type HomeCountry = "SE" | "NO";
export interface PersonalPreferences {
  homeCountry: HomeCountry;
  targetCountry: "MX";
  language: PersonalLanguage;
}

export const defaultPersonalPreferences: Readonly<PersonalPreferences> = {
  homeCountry: "SE", targetCountry: "MX", language: "sv",
};

export function parsePersonalPreferences(value: unknown): PersonalPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 3 || !Object.keys(record).every((key) => ["homeCountry", "targetCountry", "language"].includes(key))) return null;
  if ((record.homeCountry !== "SE" && record.homeCountry !== "NO") || record.targetCountry !== "MX" ||
      (record.language !== "sv" && record.language !== "nb")) return null;
  return { homeCountry: record.homeCountry, targetCountry: record.targetCountry, language: record.language };
}

export const mexicoPublication = {
  countryAliases: ["mexiko", "mx", "mexico", "méxico"],
  sourceIds: ["el-universal-national", "el-financiero", "la-jornada-politica", "expansion-mexico", "bbc-latin-america"],
} as const;

// Pilot defaults, independent of the engine's Swedish embassy configuration and scores.
export const personalProfiles = {
  SE: {
    id: "sweden-mexico-v1", homeTerms: ["sverige", "svensk", "svenska", "sweden", "swedish", "suecia", "sueco", "sueca", "suecos", "suecas"],
    categoryWeights: { trade: 1.1, technology: 1.1, security: 1.05 },
  },
  NO: {
    id: "norway-mexico-v1", homeTerms: ["norge", "norsk", "norske", "norway", "norwegian", "noruega", "noruego", "noruegos", "noruegas"],
    categoryWeights: { trade: 1.1, energy: 1.1, security: 1.05 },
  },
} as const;

function words(text: string) {
  return new Set(text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").split(/[^a-z0-9]+/).filter(Boolean));
}

export function personalRelevance(item: IntelligenceItem, preferences: PersonalPreferences) {
  const profile = personalProfiles[preferences.homeCountry];
  // Home-country evidence must be in the source, never in a Swedish AI explanation or URL.
  const sourceWords = words(`${item.title_original} ${item.original_excerpt}`);
  const homeConnection = profile.homeTerms.some((term) => sourceWords.has(term));
  const clamp = (score: number) => Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  const domain = Math.max(clamp(item.economic_impact_score), clamp(item.security_impact_score));
  const weights: Partial<Record<IntelligenceCategory, number>> = profile.categoryWeights;
  const base = (domain * 0.6 + clamp(item.urgency_score) * 0.25 + clamp(item.public_attention_score) * 0.15) *
    (weights[item.category] ?? 1);
  return { score: Math.round(Math.min(99, base + (homeConnection ? 15 : 0))), homeConnection, basis: profile.id };
}

export function personalContent(item: IntelligenceItem, preferences: PersonalPreferences) {
  // A Norwegian interface is not a Norwegian translation. Never relabel Swedish analysis.
  return preferences.language === "sv" && item.title_sv && item.summary_sv
    ? { title: item.title_sv, summary: item.summary_sv, language: "sv" }
    : { title: item.title_original, summary: item.original_excerpt, language: item.source_language };
}

export function personalCategory(category: IntelligenceCategory): IntelligenceCategory {
  return category === "sweden_connection" ? "foreign_policy" : category;
}
