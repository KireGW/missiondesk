import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import { normalizeSwedishUserFacingText } from "@/lib/ai/swedish-normalization";
import type { ProcessedIntelligenceRecord } from "@/lib/intelligence/models";
import type { GeographicScope, ProfileMode } from "@/lib/types";

export type BriefingType =
  | "morning_brief"
  | "ambassador_brief"
  | "top_national_developments"
  | "urgent_developments"
  | "upcoming_events_advisories";

export interface BriefingGenerationInput {
  type: BriefingType;
  profile: ProfileMode;
  geographicScope: GeographicScope;
  region?: string;
  items: ProcessedIntelligenceRecord[];
}

export interface BriefingGenerationOutput {
  content_sv: string;
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

const briefingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["content_sv"],
  properties: {
    content_sv: { type: "string" },
  },
};

const briefingLabels: Record<BriefingType, string> = {
  morning_brief: "Morgonbrief",
  ambassador_brief: "Ambassadörsbrief",
  top_national_developments: "Viktigaste nationella utvecklingar",
  urgent_developments: "Brådskande utvecklingar",
  upcoming_events_advisories: "Kommande händelser och advisories",
};

export function briefingModel() {
  return (
    process.env.MISSIONDESK_BRIEFING_MODEL ??
    process.env.OPENAI_BRIEFING_MODEL ??
    "gpt-5"
  );
}

export function isBriefingGenerationConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function supportsMinimalReasoning(model: string) {
  return model.toLowerCase().startsWith("gpt-5");
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

function itemPayload(records: ProcessedIntelligenceRecord[]) {
  return records.map((record, index) => ({
    n: index + 1,
    raw_source_item_id: record.raw.id,
    title_sv: record.processed.title_sv,
    summary_sv: record.processed.summary_sv,
    why_it_may_matter_sv: record.processed.why_it_may_matter_sv,
    category: record.processed.category,
    scores: {
      urgency: record.processed.urgency_score,
      diplomatic: record.processed.diplomatic_relevance_score,
      sweden: record.processed.sweden_relevance_score,
      economic: record.processed.economic_impact_score,
      security: record.processed.security_impact_score,
    },
    geography: {
      scope: record.processed.geographic_scope,
      tags: record.processed.geographic_tags,
      raw_region: record.raw.detected_region,
      raw_city: record.raw.detected_city,
    },
    source: {
      type: record.raw.source_type,
      name: record.raw.source_name,
      country: record.raw.source_country,
      published_at: record.raw.published_at,
      url: record.raw.url,
    },
  }));
}

function sanitizeContent(value: string) {
  return normalizeSwedishUserFacingText(
    value
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 9)
    .join("\n"),
  )
    .slice(0, 2600);
}

function parseBriefingOutput(text: string): BriefingGenerationOutput | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const candidates = [
    trimmed,
    trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1),
  ].filter((candidate) => candidate.startsWith("{") && candidate.endsWith("}"));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<BriefingGenerationOutput>;
      if (typeof parsed.content_sv === "string" && parsed.content_sv.trim()) {
        return { content_sv: sanitizeContent(parsed.content_sv) };
      }
    } catch {
      // Fall through to the tolerant extraction below.
    }
  }

  const contentMatch = trimmed.match(/"content_sv"\s*:\s*"([\s\S]*)"?\s*}?$/);
  if (contentMatch?.[1]) {
    const rawValue = contentMatch[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    const content = sanitizeContent(rawValue);
    return content ? { content_sv: content } : null;
  }

  if (!trimmed.startsWith("{")) {
    return { content_sv: sanitizeContent(trimmed) };
  }

  return null;
}

export async function generateBriefingWithOpenAI(
  input: BriefingGenerationInput,
): Promise<BriefingGenerationOutput | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || input.items.length === 0) return null;
  const model = briefingModel();

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 2400,
      ...(supportsMinimalReasoning(model)
        ? { reasoning: { effort: "minimal" } }
        : {}),
      input: [
        {
          role: "system",
          content: [
            "Du skriver MissionDesk-briefingar för svenska diplomater.",
            "Du gör endast slutlig syntes/polish av redan processade källposter.",
            "Skriv som en morgonbrief: kort, skannbart och med hög signaltäthet.",
            "Undvik essäform, långa stycken, långt geopolitiskt resonemang och spekulativa slutsatser.",
            "Systemet stödjer diplomatisk bedömning, det ersätter den inte.",
            "Inkludera endast kort betydelsemarkering där det höjer nyttan.",
            "Använd bara de tillhandahållna processade posterna.",
            "Prioritera 5-7 kärnsignaler framför fullständig täckning.",
            "Alla användarvända texter ska vara på svenska.",
            "Skriv idiomatisk, tät och flytande briefing-svenska.",
            "Datum får användas när de klargör timing, men väv in dem naturligt i meningen i stället för att stapla dem i parenteser.",
            "Undvik parentesbrus, överlastade satser och för många orts-/delstatsmarkörer i samma huvudrad.",
            "Låt huvudraden bära observationen; lägg bedömningen efter 'Betydelse:' när det passar.",
            "Varje briefingpunkt måste gå att härleda direkt till en eller flera av de givna processade posterna.",
            "Skriv inte någon separat syntespunkt, sammanfattande slutpunkt eller metarad som återberättar de andra briefingpunkterna.",
            "Varje rad i briefingen ska vara en egen sakuppgift eller utveckling som direkt bygger på underlaget.",
            "Tillför inte nya fakta, nya datum, nya aktörer eller kausala samband som inte stöds av underlaget.",
            "Returnera strikt JSON enligt schemat.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            briefing: {
              type: input.type,
              label: briefingLabels[input.type],
              profile: input.profile,
              geographicScope: input.geographicScope,
              region: input.region,
              targetCoreDevelopments:
                input.type === "ambassador_brief" ? "5" : "5-7",
              style:
                input.type === "ambassador_brief"
                  ? "Kort ambassadörsbriefing med exakt 5 briefingpunkter om underlaget räcker. En rad per kärnsignal. Börja med vad som kräver uppmärksamhet. Inga långa stycken. Naturlig svenska med gott flyt; datum får nämnas när det hjälper, men utan klumpiga parenteser eller onödigt tät komprimering."
                  : "Kort morgonbriefing: en rad per kärnsignal. Börja med vad som kräver uppmärksamhet. Inga långa stycken. Naturlig svenska med gott flyt; datum får nämnas när det hjälper, men utan klumpiga parenteser eller onödigt tät komprimering.",
            },
            embassy: {
              name: swedenMexicoEmbassyConfig.embassyName,
              country: swedenMexicoEmbassyConfig.country,
              city: swedenMexicoEmbassyConfig.city,
              swedenRelationPriorities:
                swedenMexicoEmbassyConfig.swedenRelationPriorities,
            },
            items: itemPayload(input.items),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "missiondesk_briefing",
          strict: true,
          schema: briefingSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`OpenAI briefing generation failed with ${response.status}: ${message}`);
  }

  const payload = (await response.json()) as ResponsesApiResult;
  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const text = extractResponseText(payload);
  if (!text) return null;

  return parseBriefingOutput(text);
}
