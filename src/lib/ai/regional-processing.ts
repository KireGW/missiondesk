import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import { normalizeSwedishUserFacingText } from "@/lib/ai/swedish-normalization";
import { ensureSwedishSignalTitle } from "@/lib/ai/title-guardrail";
import { normalizeEventDate } from "@/lib/intelligence/event-dates";
import type { RawSourceItem } from "@/lib/intelligence/models";
import type {
  GeographicScope,
  IntelligenceCategory,
  ProfileMode,
} from "@/lib/types";

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

export interface RegionalProcessingAnalysis {
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
  event_date?: string;
}

export interface RegionalRankingSignal {
  rank_score: number;
  selection_reason: string;
  freshness_score: number;
  diplomatic_relevance_score: number;
  sweden_relevance_score: number;
  geographic_relevance_score: number;
  cross_source_confirmation_score: number;
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

const regionalProcessingSchema = {
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
    "event_date",
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
    event_date: { type: ["string", "null"] },
  },
};

export function regionalProcessingModel() {
  return (
    process.env.MISSIONDESK_REGIONAL_MODEL ??
    process.env.MISSIONDESK_PROCESSING_MODEL ??
    process.env.OPENAI_PROCESSING_MODEL ??
    process.env.OPENAI_MODEL ??
    "gpt-5-mini"
  );
}

export function isRegionalProcessingConfigured() {
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

function sanitizeAnalysis(
  value: RegionalProcessingAnalysis,
  requiredGeographicTags: string[],
): RegionalProcessingAnalysis {
  return {
    title_sv: normalizeSwedishUserFacingText(value.title_sv).slice(0, 140),
    summary_sv: normalizeSwedishUserFacingText(value.summary_sv).slice(0, 360),
    category: categories.includes(value.category) ? value.category : "domestic_politics",
    urgency_score: clampScore(value.urgency_score),
    diplomatic_relevance_score: clampScore(value.diplomatic_relevance_score),
    sweden_relevance_score: clampScore(value.sweden_relevance_score),
    economic_impact_score: clampScore(value.economic_impact_score),
    security_impact_score: clampScore(value.security_impact_score),
    geographic_scope: scopes.includes(value.geographic_scope)
      ? value.geographic_scope
      : "administrative_division",
    geographic_tags: [...new Set([...requiredGeographicTags, ...value.geographic_tags.filter(Boolean)])].slice(0, 6),
    profile_tags: value.profile_tags.filter((tag) => profiles.includes(tag)).slice(0, 4),
    why_it_may_matter_sv: normalizeSwedishUserFacingText(value.why_it_may_matter_sv).slice(
      0,
      220,
    ),
    event_date: normalizeEventDate(value.event_date),
  };
}

function inputForModel(raw: RawSourceItem, ranking?: RegionalRankingSignal) {
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
      raw_content_excerpt: raw.raw_content?.slice(0, 2200),
      detected_country: raw.detected_country,
      detected_region: raw.detected_region,
      detected_city: raw.detected_city,
    },
    ranking,
  };
}

export async function processRegionalSourceItemWithOpenAI({
  raw,
  regionLabel,
  requiredGeographicTags,
  ranking,
}: {
  raw: RawSourceItem;
  regionLabel: string;
  requiredGeographicTags: string[];
  ranking?: RegionalRankingSignal;
}): Promise<RegionalProcessingAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = regionalProcessingModel();
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
      max_output_tokens: 440,
      input: [
        {
          role: "system",
          content: [
            "Du arbetar för MissionDesk, ett svenskt diplomatiskt morgonbriefingsystem.",
            "Bearbeta endast regionala källobjekt som användaren uttryckligen har begärt.",
            "Gör ett regionalt signalobjekt, inte en analysartikel.",
            "Prioritera kort översättning, klassificering och relevans för svensk ambassadbevakning.",
            "Fokusera på praktisk situationsförståelse: säkerhet, politik, ekonomi, investeringar, migration, institutionella uppdateringar och svensk närvaro.",
            "Undvik essästil, långa analyser, spekulation och autonom geopolitisk rådgivning.",
            "Använd bara information som stöds av rubrik, utdrag och källmetadata.",
            "Om underlaget är tunt: var försiktig, skriv kort och överdriv inte betydelsen.",
            "Skriv kompakt nog för snabb regional lägesbild.",
            "Alla användarvända fält ska vara på svenska.",
            "Skriv idiomatisk svensk nyhetssvenska: översätt betydelse, inte ord för ord, och lämna inte engelska fraser kvar i svenska rubriker.",
            "Använd EU eller Europeiska unionen, inte Europeiska Unionen; skriv Mexiko på svenska och använd Mexiko-EU eller Mexiko och EU i rubriker.",
            "Använd svensk stavning i användartext: skriv fentanyl, inte fentanil.",
            "Översätt joint declaration/declaración conjunta som gemensam deklaration eller gemensamt uttalande beroende på källans innebörd; använd inte kumulativ deklaration.",
            "Skriv Mexiko och EU som aktörer; skriv inte länderna i Mexiko om underlaget avser Mexiko som land.",
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
            requestedRegion: {
              label: regionLabel,
              requiredGeographicTags,
            },
            allowedCategories: categories,
            allowedProfiles: profiles,
            allowedGeographyIds: divisions,
            instruction: {
              summaryLength: "1 kort mening, max cirka 35 ord",
              whyItMayMatterLength: "1 kort mening, max cirka 22 ord",
              title: "kort svensk regional signalrubrik, max cirka 12 ord",
            },
            item: inputForModel(raw, ranking),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "missiondesk_regional_processing",
          strict: true,
          schema: regionalProcessingSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI regional processing failed with ${response.status}: ${message}`);
  }

  const payload = (await response.json()) as ResponsesApiResult;
  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const text = extractResponseText(payload);
  if (!text) return null;

  const analysis = sanitizeAnalysis(
    JSON.parse(text) as RegionalProcessingAnalysis,
    requiredGeographicTags,
  );
  analysis.title_sv = await ensureSwedishSignalTitle({
    apiKey,
    model,
    sourceLanguage: raw.source_language,
    titleSv: analysis.title_sv,
    titleOriginal: raw.title_original,
    snippetOriginal: raw.snippet,
    summarySv: analysis.summary_sv,
  });

  return analysis;
}
