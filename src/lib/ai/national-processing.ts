import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import type {
  GeographicScope,
  IntelligenceCategory,
  ProfileMode,
} from "@/lib/types";
import type { RawSourceItem, RankedCandidateRecord } from "@/lib/intelligence/models";

const categories: IntelligenceCategory[] = [
  "economy",
  "trade",
  "domestic_politics",
  "foreign_policy",
  "sweden_connection",
  "security",
  "markets",
  "investment_climate",
  "migration",
  "society",
  "energy",
  "technology",
  "culture_soft_power",
];

const profiles: ProfileMode[] = [
  "daily_overview",
  "ambassador_briefing",
  "trade_business",
  "political_risk",
  "sweden_connection",
  "security",
  "weekly_summary",
  "upcoming_events",
];

const scopes: GeographicScope[] = [
  "national",
  "region",
  "administrative_division",
  "city",
  "cross_border",
  "international",
];

export interface NationalProcessingAnalysis {
  title_sv: string;
  summary_sv: string;
  category: IntelligenceCategory;
  urgency_score: number;
  diplomatic_relevance_score: number;
  sweden_relevance_score: number;
  economic_impact_score: number;
  security_impact_score: number;
  geographic_scope: GeographicScope;
  geographic_tags: string[];
  profile_tags: ProfileMode[];
  why_it_may_matter_sv: string;
}

interface ResponsesApiResult {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      refusal?: string;
    }>;
  }>;
  error?: { message?: string };
}

const nationalProcessingSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title_sv",
    "summary_sv",
    "category",
    "urgency_score",
    "diplomatic_relevance_score",
    "sweden_relevance_score",
    "economic_impact_score",
    "security_impact_score",
    "geographic_scope",
    "geographic_tags",
    "profile_tags",
    "why_it_may_matter_sv",
  ],
  properties: {
    title_sv: { type: "string" },
    summary_sv: { type: "string" },
    category: { type: "string", enum: categories },
    urgency_score: { type: "integer", minimum: 0, maximum: 100 },
    diplomatic_relevance_score: { type: "integer", minimum: 0, maximum: 100 },
    sweden_relevance_score: { type: "integer", minimum: 0, maximum: 100 },
    economic_impact_score: { type: "integer", minimum: 0, maximum: 100 },
    security_impact_score: { type: "integer", minimum: 0, maximum: 100 },
    geographic_scope: { type: "string", enum: scopes },
    geographic_tags: {
      type: "array",
      maxItems: 6,
      items: { type: "string" },
    },
    profile_tags: {
      type: "array",
      maxItems: 4,
      items: { type: "string", enum: profiles },
    },
    why_it_may_matter_sv: { type: "string" },
  },
};

export function nationalProcessingModel() {
  return (
    process.env.MISSIONDESK_PROCESSING_MODEL ??
    process.env.OPENAI_PROCESSING_MODEL ??
    process.env.OPENAI_MODEL ??
    "gpt-5-mini"
  );
}

export function isNationalProcessingConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function extractResponseText(payload: ResponsesApiResult) {
  if (payload.output_text) return payload.output_text;

  return (
    payload.output
      ?.flatMap((output) => output.content ?? [])
      .map((content) => content.text ?? "")
      .find(Boolean) ?? ""
  );
}

function sanitizeAnalysis(value: NationalProcessingAnalysis): NationalProcessingAnalysis {
  return {
    title_sv: value.title_sv.slice(0, 140),
    summary_sv: value.summary_sv.slice(0, 420),
    category: categories.includes(value.category) ? value.category : "domestic_politics",
    urgency_score: clampScore(value.urgency_score),
    diplomatic_relevance_score: clampScore(value.diplomatic_relevance_score),
    sweden_relevance_score: clampScore(value.sweden_relevance_score),
    economic_impact_score: clampScore(value.economic_impact_score),
    security_impact_score: clampScore(value.security_impact_score),
    geographic_scope: scopes.includes(value.geographic_scope)
      ? value.geographic_scope
      : "national",
    geographic_tags: value.geographic_tags.filter(Boolean).slice(0, 6),
    profile_tags: value.profile_tags.filter((tag) => profiles.includes(tag)).slice(0, 4),
    why_it_may_matter_sv: value.why_it_may_matter_sv.slice(0, 240),
  };
}

function inputForModel(raw: RawSourceItem, candidate?: RankedCandidateRecord["candidate"]) {
  return {
    source: {
      type: raw.source_type,
      name: raw.source_name,
      country: raw.source_country,
      language: raw.source_language,
      priority: raw.source_priority,
      credibility: raw.credibility_score,
      url: raw.url,
      published_at: raw.published_at,
    },
    raw_item: {
      title_original: raw.title_original,
      snippet: raw.snippet,
      raw_content_excerpt: raw.raw_content?.slice(0, 2500),
      detected_country: raw.detected_country,
      detected_region: raw.detected_region,
      detected_city: raw.detected_city,
    },
    ranking: candidate
      ? {
          rank_score: candidate.rank_score,
          selection_reason: candidate.selection_reason,
          freshness_score: candidate.freshness_score,
          diplomatic_relevance_score: candidate.diplomatic_relevance_score,
          sweden_relevance_score: candidate.sweden_relevance_score,
          geographic_relevance_score: candidate.geographic_relevance_score,
          cross_source_confirmation_score: candidate.cross_source_confirmation_score,
        }
      : undefined,
  };
}

export async function processNationalSourceItemWithOpenAI(
  raw: RawSourceItem,
  candidate?: RankedCandidateRecord["candidate"],
): Promise<NationalProcessingAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = nationalProcessingModel();
  const divisions = swedenMexicoEmbassyConfig.geography.administrativeDivisions.map(
    (division) => ({
      id: division.id,
      displayName: division.displayName,
      tags: division.tags ?? [],
    }),
  );

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 480,
      input: [
        {
          role: "system",
          content: [
            "Du arbetar för MissionDesk, ett svenskt diplomatiskt morgonbriefingsystem.",
            "Bearbeta endast högt rankade nationella källobjekt.",
            "Gör ett signalobjekt, inte en analysartikel.",
            "Prioritera översättning, kort sammanfattning, klassificering, prioritering, signalextraktion och relevansidentifiering.",
            "Skriv på svenska i ett professionellt, diplomatiskt och sakligt språk.",
            "Undvik essästil, långa analyser, spekulation, rådgivning och geopolitisk överförklaring.",
            "Använd bara information som stöds av rubrik, utdrag och källmetadata.",
            "Om underlaget är tunt: var försiktig och skriv kort.",
            "Skriv kompakt nog för en morgonbriefing som ska läsas på under fem minuter.",
            "Titel och sammanfattning ska vara korta, tydliga och neutrala.",
            "Alla användarvända fält ska vara på svenska.",
            "Returnera strikt JSON enligt schemat.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            embassy: {
              name: swedenMexicoEmbassyConfig.embassyName,
              country: swedenMexicoEmbassyConfig.country,
              city: swedenMexicoEmbassyConfig.city,
              priorityThemes: swedenMexicoEmbassyConfig.priorityThemes,
              swedenRelationPriorities:
                swedenMexicoEmbassyConfig.swedenRelationPriorities,
            },
            allowedCategories: categories,
            allowedProfiles: profiles,
            allowedGeographyIds: divisions,
            instruction: {
              summaryLength: "1-2 korta meningar, max cirka 45 ord",
              whyItMayMatterLength: "1 kort mening, max cirka 24 ord",
              title: "kort svensk signalrubrik, max cirka 12 ord",
            },
            item: inputForModel(raw, candidate),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "missiondesk_national_processing",
          strict: true,
          schema: nationalProcessingSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI national processing failed with ${response.status}: ${message}`);
  }

  const payload = (await response.json()) as ResponsesApiResult;
  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const text = extractResponseText(payload);
  if (!text) return null;

  return sanitizeAnalysis(JSON.parse(text) as NationalProcessingAnalysis);
}
