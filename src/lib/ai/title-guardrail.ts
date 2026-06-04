import {
  looksLikeForeignSummaryInSwedishField,
  needsSwedishTitleRewrite,
  normalizeSwedishUserFacingText,
} from "@/lib/ai/swedish-normalization";

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

interface EnsureSwedishTitleOptions {
  apiKey: string;
  model: string;
  sourceLanguage?: string | null;
  titleSv: string;
  titleOriginal: string;
  snippetOriginal?: string | null;
  summarySv?: string | null;
}

interface EnsureSwedishSummaryOptions {
  apiKey: string;
  model: string;
  sourceLanguage?: string | null;
  summarySv: string;
  titleSv?: string | null;
  titleOriginal: string;
  snippetOriginal?: string | null;
}

function supportsLowDeliberationReasoning(model: string) {
  return model.startsWith("gpt-5");
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

async function translateShortTitleToSwedish({
  apiKey,
  model,
  sourceLanguage,
  titleOriginal,
  snippetOriginal,
  summarySv,
}: Omit<EnsureSwedishTitleOptions, "titleSv">) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 120,
      ...(supportsLowDeliberationReasoning(model)
        ? { reasoning: { effort: "minimal" as const } }
        : {}),
      input: [
        {
          role: "system",
          content:
            "Översätt endast rubriken till saklig, kort och idiomatisk svenska. Lämna inte engelska fraser kvar i svenska rubriker. Behåll egennamn och akronymer. Använd Mexiko på svenska. Om den givna svenska rubriken ser halvöversatt eller avklippt ut, skriv om betydelsen på korrekt svenska i stället för att bevara ordstumpen. Exempel: skriv 'Modernisering av AICM' eller 'AICM moderniseras', inte 'Moderna AICM'. Returnera endast strikt JSON enligt schemat.",
        },
        {
          role: "user",
          content: JSON.stringify({
            title_original: titleOriginal,
            snippet_original: snippetOriginal ?? null,
            summary_sv: summarySv ?? null,
            source_language: sourceLanguage ?? null,
            instruction: "Kort svensk signalrubrik, max cirka 12 ord.",
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "missiondesk_short_title_translation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["title_sv"],
            properties: {
              title_sv: { type: "string" },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as ResponsesApiResult;
  if (payload.error?.message) return null;

  const text = extractResponseText(payload);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as { title_sv?: string };
    return parsed.title_sv ? normalizeSwedishUserFacingText(parsed.title_sv).slice(0, 140) : null;
  } catch {
    return null;
  }
}

export async function ensureSwedishSignalTitle(options: EnsureSwedishTitleOptions) {
  const normalizedCurrent = normalizeSwedishUserFacingText(options.titleSv).slice(0, 140);

  if (!needsSwedishTitleRewrite(normalizedCurrent)) {
    return normalizedCurrent;
  }

  const translated = await translateShortTitleToSwedish(options);
  return translated ?? normalizedCurrent;
}

async function translateShortSummaryToSwedish({
  apiKey,
  model,
  sourceLanguage,
  summarySv,
  titleSv,
  titleOriginal,
  snippetOriginal,
}: EnsureSwedishSummaryOptions) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 180,
      ...(supportsLowDeliberationReasoning(model)
        ? { reasoning: { effort: "minimal" as const } }
        : {}),
      input: [
        {
          role: "system",
          content:
            "Översätt endast sammanfattningen till kort, saklig och idiomatisk svenska. Lämna inte engelska meningar eller halvöversatta fraser kvar. Behåll egennamn och akronymer. Returnera endast strikt JSON enligt schemat.",
        },
        {
          role: "user",
          content: JSON.stringify({
            title_sv: titleSv ?? null,
            title_original: titleOriginal,
            snippet_original: snippetOriginal ?? null,
            summary_sv: summarySv,
            source_language: sourceLanguage ?? null,
            instruction: "Kort svensk sammanfattning i 1 mening, max cirka 30 ord.",
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "missiondesk_short_summary_translation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["summary_sv"],
            properties: {
              summary_sv: { type: "string" },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as ResponsesApiResult;
  if (payload.error?.message) return null;

  const text = extractResponseText(payload);
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as { summary_sv?: string };
    return parsed.summary_sv
      ? normalizeSwedishUserFacingText(parsed.summary_sv).slice(0, 420)
      : null;
  } catch {
    return null;
  }
}

export async function ensureSwedishSignalSummary(options: EnsureSwedishSummaryOptions) {
  const normalizedCurrent = normalizeSwedishUserFacingText(options.summarySv).slice(0, 420);

  if (!looksLikeForeignSummaryInSwedishField(normalizedCurrent)) {
    return normalizedCurrent;
  }

  const translated = await translateShortSummaryToSwedish(options);
  return translated ?? normalizedCurrent;
}
