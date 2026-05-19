export type ScoreKey =
  | "urgency_score"
  | "diplomatic_relevance_score"
  | "sweden_relevance_score"
  | "economic_impact_score"
  | "security_impact_score"
  | "public_attention_score";

export type SourceType =
  | "rss"
  | "website"
  | "social"
  | "structured_scrape"
  | "api"
  | "calendar";

export type IntelligenceCategory =
  | "economy"
  | "trade"
  | "domestic_politics"
  | "foreign_policy"
  | "sweden_connection"
  | "security"
  | "markets"
  | "investment_climate"
  | "migration"
  | "society"
  | "energy"
  | "technology"
  | "culture_soft_power";

export type ProfileMode =
  | "daily_overview"
  | "ambassador_briefing"
  | "trade_business"
  | "political_risk"
  | "sweden_connection"
  | "security"
  | "weekly_summary"
  | "upcoming_events";

export type GeographicScope =
  | "national"
  | "region"
  | "administrative_division"
  | "city"
  | "cross_border"
  | "international";

export type WeightedScores = Partial<Record<ScoreKey, number>>;
export type CategoryWeights = Partial<Record<IntelligenceCategory, number>>;

export interface ThemeCategory {
  id: IntelligenceCategory;
  label: string;
  description: string;
}

export interface ProfileDefinition {
  id: ProfileMode;
  label: string;
  shortLabel: string;
  description: string;
  emphasis: string[];
  categoryWeights: CategoryWeights;
  scoreWeights: WeightedScores;
}

export interface AdministrativeDivision {
  id: string;
  displayName: string;
  aliases?: string[];
  parentRegionId?: string;
  priority?: boolean;
  relevanceScore?: number;
  scoringWeights?: WeightedScores;
  tags?: string[];
}

export interface RegionGroup {
  id: string;
  displayName: string;
  description: string;
  divisionIds: string[];
  priority?: boolean;
  scoringWeights?: WeightedScores;
}

export interface GeographyConfig {
  geographicUnitLabel: string;
  geographicUnitPluralLabel: string;
  nationalLabel: string;
  mapLabel: string;
  regions: RegionGroup[];
  administrativeDivisions: AdministrativeDivision[];
  priorityDivisionIds: string[];
}

export interface SourceDefinition {
  id: string;
  name: string;
  country: string;
  language: string;
  type: SourceType;
  url: string;
  trustTier: 1 | 2 | 3;
  categories: IntelligenceCategory[];
  enabled: boolean;
  notes?: string;
  sourceType?: "news" | "government" | "institution" | "social" | "report" | "advisory" | "event" | "other";
  sourcePriority?: number;
  credibilityScore?: number;
  defaultDetectedCountry?: string;
  defaultDetectedRegion?: string;
  defaultDetectedCity?: string;
  regionalScope?: string[];
  preserveRawContent?: boolean;
  maxItemsPerRun?: number;
}

export interface EmbassyConfig {
  id: string;
  country: string;
  countryCode: string;
  city: string;
  embassyName: string;
  briefingLanguage: string;
  relevantLanguages: string[];
  briefingStyle: string;
  priorityThemes: IntelligenceCategory[];
  swedenRelationPriorities: string[];
  scoringWeights: Required<WeightedScores>;
  themeCategories: ThemeCategory[];
  profileModes: ProfileDefinition[];
  geography: GeographyConfig;
  sources: SourceDefinition[];
}

export interface IntelligenceItem {
  id: string;
  title_original: string;
  title_sv: string;
  summary_sv: string;
  source_name: string;
  source_url: string;
  source_country: string;
  source_language: string;
  published_at: string;
  category: IntelligenceCategory;
  country: string;
  region: string;
  subregion: string;
  city?: string;
  geographic_scope: GeographicScope;
  geographic_tags: string[];
  urgency_score: number;
  diplomatic_relevance_score: number;
  sweden_relevance_score: number;
  economic_impact_score: number;
  security_impact_score: number;
  public_attention_score: number;
  profile_tags: ProfileMode[];
  why_it_matters_sv: string;
  suggested_talking_points_sv: string[];
  original_excerpt: string;
  event_date?: string;
  actors?: string[];
  institutions?: string[];
  opportunity_sv?: string;
  risk_sv?: string;
}
