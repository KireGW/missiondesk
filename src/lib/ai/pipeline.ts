import type {
  EmbassyConfig,
  GeographicScope,
  IntelligenceCategory,
  IntelligenceItem,
  ProfileMode,
} from "@/lib/types";
import type { NormalizedSourceDocument } from "@/lib/ingestion/types";
import { normalizeSwedishUserFacingText } from "@/lib/ai/swedish-normalization";
import { normalizeEventDate } from "@/lib/intelligence/event-dates";

export interface DiplomaticProcessingInput {
  embassy: EmbassyConfig;
  document: NormalizedSourceDocument;
  profileHints?: ProfileMode[];
}

export interface DiplomaticProcessingOutput
  extends Pick<
    IntelligenceItem,
    | "title_sv"
    | "summary_sv"
    | "category"
    | "geographic_scope"
    | "geographic_tags"
    | "urgency_score"
    | "diplomatic_relevance_score"
    | "sweden_relevance_score"
    | "economic_impact_score"
    | "security_impact_score"
    | "public_attention_score"
    | "profile_tags"
    | "why_it_matters_sv"
    | "suggested_talking_points_sv"
    | "event_date"
  > {
  topicTags: string[];
  confidence: number;
}

export interface DiplomaticProcessor {
  process(input: DiplomaticProcessingInput): Promise<DiplomaticProcessingOutput>;
}

export const processingInstructionsSv = [
  "Översätt allt slutanvändarinnehåll till svenska.",
  "Skriv idiomatisk svensk nyhetssvenska: översätt betydelse, inte ord för ord, och lämna inte engelska fraser kvar i svenska rubriker.",
  "Använd EU eller Europeiska unionen, inte Europeiska Unionen; skriv Mexiko på svenska och använd Mexiko-EU eller Mexiko och EU i rubriker.",
  "Använd svensk stavning i användartext: skriv fentanyl, inte fentanil.",
  "Översätt joint declaration/declaración conjunta som gemensam deklaration eller gemensamt uttalande beroende på källans innebörd; använd inte kumulativ deklaration.",
  "Prioritera signalvärde över allmän nyhetsvärdering.",
  "Identifiera relevans för Sverige, EU-positioner, svenska företag och ambassadens relationer utan att spekulera.",
  "Skilj tydligt mellan brådska, diplomatisk relevans, ekonomisk påverkan och säkerhetspåverkan.",
  "Skriv korta uppföljningspunkter för intern briefing.",
];

export const mockDiplomaticProcessor: DiplomaticProcessor = {
  async process(input) {
    const firstCategory = input.document.detectedCategories[0] ?? "domestic_politics";

    return {
      title_sv: input.document.title,
      summary_sv:
        "AI-pipeline ej ansluten. Ingen användarvänd analys har genererats.",
      category: firstCategory,
      geographic_scope:
        input.document.detectedGeographyIds.length > 0
          ? "administrative_division"
          : "national",
      geographic_tags: input.document.detectedGeographyIds,
      urgency_score: 50,
      diplomatic_relevance_score: 50,
      sweden_relevance_score: 50,
      economic_impact_score: 50,
      security_impact_score: 50,
      public_attention_score: 50,
      profile_tags: input.profileHints ?? ["daily_overview"],
      why_it_matters_sv:
        "Kräver AI-bearbetning innan signalen används i briefing.",
      suggested_talking_points_sv: [
        "Verifiera källan och jämför med minst en kompletterande källa.",
        "Bedöm om frågan kräver intern uppföljning eller extern kontakt.",
      ],
      event_date: undefined,
      topicTags: [],
      confidence: 0.25,
    };
  },
};

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

const scoreKeys = [
  "urgency_score",
  "diplomatic_relevance_score",
  "sweden_relevance_score",
  "economic_impact_score",
  "security_impact_score",
  "public_attention_score",
] as const;

type ScoreKey = (typeof scoreKeys)[number];

interface AiArticleInput {
  title: string;
  excerpt: string;
  sourceName: string;
  sourceCountry: string;
  sourceLanguage: string;
  publishedAt: string;
  sourceUrl: string;
  preliminaryCategory: IntelligenceCategory;
  preliminaryGeographicTags: string[];
}

interface AiArticleAnalysis {
  title_sv: string;
  summary_sv: string;
  category: IntelligenceCategory;
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
  event_date: string | null;
  risk_sv: string | null;
  opportunity_sv: string | null;
  confidence: number;
}

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title_sv",
    "summary_sv",
    "category",
    "geographic_scope",
    "geographic_tags",
    "urgency_score",
    "diplomatic_relevance_score",
    "sweden_relevance_score",
    "economic_impact_score",
    "security_impact_score",
    "public_attention_score",
    "profile_tags",
    "why_it_matters_sv",
    "suggested_talking_points_sv",
    "event_date",
    "risk_sv",
    "opportunity_sv",
    "confidence",
  ],
  properties: {
    title_sv: { type: "string" },
    summary_sv: { type: "string" },
    category: { type: "string", enum: categories },
    geographic_scope: { type: "string", enum: scopes },
    geographic_tags: {
      type: "array",
      items: { type: "string" },
    },
    urgency_score: { type: "integer", minimum: 0, maximum: 100 },
    diplomatic_relevance_score: { type: "integer", minimum: 0, maximum: 100 },
    sweden_relevance_score: { type: "integer", minimum: 0, maximum: 100 },
    economic_impact_score: { type: "integer", minimum: 0, maximum: 100 },
    security_impact_score: { type: "integer", minimum: 0, maximum: 100 },
    public_attention_score: { type: "integer", minimum: 0, maximum: 100 },
    profile_tags: {
      type: "array",
      items: { type: "string", enum: profiles },
    },
    why_it_matters_sv: { type: "string" },
    suggested_talking_points_sv: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: { type: "string" },
    },
    event_date: { type: ["string", "null"] },
    risk_sv: { type: ["string", "null"] },
    opportunity_sv: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

interface ResponsesApiResult {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  error?: { message?: string };
}

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 50;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sanitizeAnalysis(analysis: AiArticleAnalysis): AiArticleAnalysis {
  const category = categories.includes(analysis.category)
    ? analysis.category
    : "domestic_politics";
  const geographicScope = scopes.includes(analysis.geographic_scope)
    ? analysis.geographic_scope
    : "national";
  const profileTags = analysis.profile_tags.filter((profile) =>
    profiles.includes(profile),
  );

  return {
    ...analysis,
    title_sv: normalizeSwedishUserFacingText(analysis.title_sv).slice(0, 140),
    summary_sv: normalizeSwedishUserFacingText(analysis.summary_sv).slice(0, 420),
    category,
    geographic_scope: geographicScope,
    geographic_tags: analysis.geographic_tags.slice(0, 6),
    urgency_score: clampScore(analysis.urgency_score),
    diplomatic_relevance_score: clampScore(analysis.diplomatic_relevance_score),
    sweden_relevance_score: clampScore(analysis.sweden_relevance_score),
    economic_impact_score: clampScore(analysis.economic_impact_score),
    security_impact_score: clampScore(analysis.security_impact_score),
    public_attention_score: clampScore(analysis.public_attention_score),
    profile_tags: profileTags.length > 0 ? profileTags : ["daily_overview"],
    why_it_matters_sv: normalizeSwedishUserFacingText(analysis.why_it_matters_sv).slice(
      0,
      240,
    ),
    suggested_talking_points_sv: analysis.suggested_talking_points_sv
      .map((point) => point.slice(0, 120))
      .slice(0, 2),
    event_date: normalizeEventDate(analysis.event_date) ?? null,
    confidence: Math.max(0, Math.min(1, analysis.confidence)),
  };
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

export async function analyzeArticleWithOpenAI(
  article: AiArticleInput,
  embassy: EmbassyConfig,
): Promise<AiArticleAnalysis | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const divisions = embassy.geography.administrativeDivisions.map((division) => ({
    id: division.id,
    displayName: division.displayName,
    tags: division.tags ?? [],
  }));

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      max_output_tokens: 520,
      input: [
        {
          role: "system",
          content: [
            "Du gör kort signalbearbetning för MissionDesk.",
            ...processingInstructionsSv,
            "Använd endast artikelns rubrik och utdrag. Hitta inte på detaljer som inte stöds av underlaget.",
            "Om underlaget är tunt: skriv det tydligt och håll sammanfattningen försiktig.",
            "Undvik essästil, långa analyser och autonoma policyrekommendationer.",
            "Skriv kompakt nog för en morgonbriefing som ska läsas på under fem minuter.",
            "Alla användarvända texter ska vara på svenska.",
            "Returnera strikt JSON enligt schemat.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            embassy: {
              name: embassy.embassyName,
              country: embassy.country,
              city: embassy.city,
              swedenRelationPriorities: embassy.swedenRelationPriorities,
              priorityThemes: embassy.priorityThemes,
            },
            allowedCategories: categories,
            allowedProfiles: profiles,
            allowedGeographyIds: divisions,
            article,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "missiondesk_article_analysis",
          strict: true,
          schema: analysisSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI analysis failed with ${response.status}: ${message}`);
  }

  const payload = (await response.json()) as ResponsesApiResult;
  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const text = extractResponseText(payload);
  if (!text) return null;

  return sanitizeAnalysis(JSON.parse(text) as AiArticleAnalysis);
}
