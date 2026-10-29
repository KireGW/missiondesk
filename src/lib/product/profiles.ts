import type { IntelligenceCategory, IntelligenceItem } from "@/lib/types";

export type PersonalLanguage = "sv" | "nb" | "es" | "en";
export type InterfaceLanguageProfile = "standard" | "norwegian";
export const interfaceLanguageNames: Readonly<Record<PersonalLanguage, string>> = {
  sv: "Svenska", nb: "Norsk (bokmål)", es: "Español", en: "English",
};
const standardLanguages: readonly PersonalLanguage[] = ["en", "sv", "nb"];
const norwegianLanguages: readonly PersonalLanguage[] = ["en", "nb", "es"];
export function interfaceLanguagesForProfile(profile?: InterfaceLanguageProfile) {
  return profile === "norwegian" ? norwegianLanguages : standardLanguages;
}
export type SignalTextLanguage = "original" | "sv";
export type HomeCountry = "SE" | "NO";
export interface PersonalPreferences {
  homeCountry: HomeCountry;
  targetCountry: "MX";
  language: PersonalLanguage;
  contentLanguage: SignalTextLanguage;
}

export type MonitoredCountry = "MX" | "NI" | "CR" | "GT" | "HN" | "SV" | "BZ";
export const personalStations = {
  SE: { id: "sweden-mexico-city", homeCountry: "SE", countries: ["MX"] },
  NO: { id: "norway-mexico-city", homeCountry: "NO", countries: ["MX", "NI", "CR", "GT", "HN", "SV", "BZ"] },
} as const satisfies Record<HomeCountry, { id: string; homeCountry: HomeCountry; countries: readonly MonitoredCountry[] }>;

export const defaultPersonalPreferences: Readonly<PersonalPreferences> = {
  homeCountry: "SE", targetCountry: "MX", language: "en", contentLanguage: "sv",
};

export function parsePersonalPreferences(value: unknown, previousContentLanguage?: SignalTextLanguage): PersonalPreferences | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const hasContentLanguage = Object.hasOwn(record, "contentLanguage");
  // Older forms may omit the new field; preserve its stored value rather than deriving it from the new UI language.
  if (Object.keys(record).length !== (hasContentLanguage ? 4 : 3) ||
      !Object.keys(record).every((key) => ["homeCountry", "targetCountry", "language", "contentLanguage"].includes(key))) return null;
  const contentLanguage = hasContentLanguage ? record.contentLanguage : previousContentLanguage;
  if ((record.homeCountry !== "SE" && record.homeCountry !== "NO") || record.targetCountry !== "MX" ||
      (typeof record.language !== "string" || !["sv", "nb", "es", "en"].includes(record.language)) || (contentLanguage !== "original" && contentLanguage !== "sv")) return null;
  return { homeCountry: record.homeCountry, targetCountry: record.targetCountry, language: record.language as PersonalLanguage, contentLanguage };
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

export function personalHomeConnection(item: IntelligenceItem, homeCountry: HomeCountry) {
  // Home-country evidence must be in the source, never in a Swedish AI explanation or URL.
  const sourceWords = words(`${item.title_original} ${item.original_excerpt}`);
  return personalProfiles[homeCountry].homeTerms.some((term) => sourceWords.has(term));
}

export function personalRelevance(item: IntelligenceItem, preferences: PersonalPreferences) {
  const profile = personalProfiles[preferences.homeCountry];
  const homeConnection = personalHomeConnection(item, preferences.homeCountry);
  if (item.workspace_relevance !== undefined) {
    return { score: Math.max(0, Math.min(100, Math.round(item.workspace_relevance))), homeConnection, basis: "public-rules-v3" };
  }
  const clamp = (score: number) => Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  const domain = Math.max(clamp(item.economic_impact_score), clamp(item.security_impact_score));
  const weights: Partial<Record<IntelligenceCategory, number>> = profile.categoryWeights;
  const base = (domain * 0.6 + clamp(item.urgency_score) * 0.25 + clamp(item.public_attention_score) * 0.15) *
    (weights[item.category] ?? 1);
  return { score: Math.round(Math.min(99, base + (homeConnection ? 15 : 0))), homeConnection, basis: profile.id };
}

export function personalRelevanceLevel(score: number): "high" | "medium" | "limited" {
  return score>=75?"high":score>=45?"medium":"limited";
}

export function personalContent(item: IntelligenceItem, preferences: PersonalPreferences) {
  // UI language never selects or translates signal text. Reuse only the explicitly chosen cached version.
  return preferences.contentLanguage === "sv" && item.title_sv && item.summary_sv
    ? { title: item.title_sv, summary: item.summary_sv, language: "sv" }
    : { title: item.title_original, summary: item.original_excerpt, language: item.source_language };
}

export function personalCategory(category: IntelligenceCategory): IntelligenceCategory {
  return category === "sweden_connection" ? "foreign_policy" : category;
}
