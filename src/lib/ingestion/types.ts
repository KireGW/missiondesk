import type { EmbassyConfig, IntelligenceCategory, SourceDefinition } from "@/lib/types";
import type { SourceIntelligenceType } from "@/lib/intelligence/models";

export interface RawSourceDocument {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  language: string;
  country: string;
  publishedAt?: string;
  retrievedAt: string;
  excerpt?: string;
  html?: string;
  text?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface IngestionSourceMetadata {
  sourceType: SourceIntelligenceType;
  sourcePriority: number;
  credibilityScore: number;
  defaultDetectedCountry?: string;
  defaultDetectedRegion?: string;
  defaultDetectedCity?: string;
  regionalScope?: string[];
  preserveRawContent?: boolean;
  maxItemsPerRun?: number;
}

export type IngestibleSourceDefinition = SourceDefinition & IngestionSourceMetadata;

export interface LiveIngestionSummary {
  fetchedAt: string;
  itemCount: number;
  sourceCount: number;
  aiEnabled: boolean;
  aiEnhancedCount: number;
  errors: Array<{ source: string; message: string }>;
}

export interface NormalizedSourceDocument extends RawSourceDocument {
  detectedCategories: IntelligenceCategory[];
  detectedGeographyIds: string[];
  contentHash: string;
}

export interface IngestionContext {
  embassy: EmbassyConfig;
  since?: string;
  limit?: number;
  preserveRawContent?: boolean;
}

export interface IngestionAdapter {
  type: SourceDefinition["type"];
  canHandle(source: SourceDefinition): boolean;
  fetch(source: SourceDefinition, context: IngestionContext): Promise<RawSourceDocument[]>;
}

export interface IngestionRunResult {
  source: SourceDefinition;
  documents: RawSourceDocument[];
  errors: Array<{ message: string; url?: string }>;
}
