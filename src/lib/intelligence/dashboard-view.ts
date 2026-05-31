import type {
  Briefing,
  ProcessedIntelligenceRecord,
} from "@/lib/intelligence/models";
import type { IntelligenceItem } from "@/lib/types";
import {
  decodeHtmlEntities,
  looksLikeForeignSummaryInSwedishField,
  normalizeSwedishTitle,
  normalizeSwedishUserFacingText,
} from "@/lib/ai/swedish-normalization";
import { countryNameSv } from "@/lib/i18n/countries";
import { normalizeEventDate } from "@/lib/intelligence/event-dates";

const scopeLabel = (record: ProcessedIntelligenceRecord) => {
  if (record.raw.detected_city) return record.raw.detected_city;
  if (record.raw.detected_region) return record.raw.detected_region;
  if (record.raw.detected_country) return countryNameSv(record.raw.detected_country);
  return "Nationellt";
};

export function processedRecordToIntelligenceItem(
  record: ProcessedIntelligenceRecord,
): IntelligenceItem {
  const titleSv = normalizeSwedishTitle(record.processed.title_sv);
  const whyItMattersSv = normalizeSwedishUserFacingText(record.processed.why_it_may_matter_sv);
  const summarySvRaw = normalizeSwedishUserFacingText(record.processed.summary_sv);
  const summarySv = looksLikeForeignSummaryInSwedishField(summarySvRaw)
    ? whyItMattersSv
    : summarySvRaw;

  return {
    id: `processed-${record.raw.id}`,
    title_original: record.raw.title_original,
    title_sv: titleSv,
    summary_sv: summarySv,
    source_name: record.raw.source_name,
    source_url: record.raw.url,
    source_country: countryNameSv(record.raw.source_country) ?? record.raw.source_country,
    source_language: record.raw.source_language,
    published_at: record.raw.published_at ?? "",
    category: record.processed.category,
    country: countryNameSv(record.raw.detected_country) ?? "Mexiko",
    region: scopeLabel(record),
    subregion: record.raw.source_type,
    city: record.raw.detected_city,
    geographic_scope: record.processed.geographic_scope,
    geographic_tags: record.processed.geographic_tags,
    urgency_score: record.processed.urgency_score,
    diplomatic_relevance_score: record.processed.diplomatic_relevance_score,
    sweden_relevance_score: record.processed.sweden_relevance_score,
    economic_impact_score: record.processed.economic_impact_score,
    security_impact_score: record.processed.security_impact_score,
    public_attention_score: Math.round(
      (record.processed.urgency_score + record.processed.diplomatic_relevance_score) / 2,
    ),
    profile_tags: record.processed.profile_tags,
    why_it_matters_sv: whyItMattersSv,
    suggested_talking_points_sv: [
      "Bedöm om signalen kräver intern uppföljning i dag.",
      "Kontrollera originalkällan före eventuell extern användning.",
    ],
    original_excerpt: decodeHtmlEntities(record.raw.snippet ?? record.raw.title_original),
    event_date: normalizeEventDate(record.processed.event_date),
  };
}

export function processedRecordsToIntelligenceItems(
  records: ProcessedIntelligenceRecord[],
) {
  return records.map(processedRecordToIntelligenceItem);
}

export function latestCacheTimestamp(
  briefings: Briefing[],
  records: ProcessedIntelligenceRecord[],
) {
  const timestamps = [
    ...briefings.map((briefing) => briefing.generated_at),
    ...records.map((record) => record.processed.processed_at),
  ]
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);

  if (timestamps.length === 0) return undefined;
  return new Date(Math.max(...timestamps)).toISOString();
}

export function earliestCacheExpiry(
  briefings: Briefing[],
  records: ProcessedIntelligenceRecord[],
) {
  const now = Date.now();
  const timestamps = [
    ...briefings.map((briefing) => briefing.cache_expires_at),
    ...records.map((record) => record.processed.cache_expires_at),
  ]
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value) && value > now);

  if (timestamps.length === 0) return undefined;
  return new Date(Math.min(...timestamps)).toISOString();
}
