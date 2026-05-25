import {
  looksLikeEnglishTitleInSwedishField,
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
      input: [
        {
          role: "system",
          content:
            "Översätt endast rubriken till saklig, kort och idiomatisk svenska. Lämna inte engelska fraser kvar i svenska rubriker. Behåll egennamn och akronymer. Använd Mexiko på svenska. Returnera endast strikt JSON enligt schemat.",
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

  if (!looksLikeEnglishTitleInSwedishField(normalizedCurrent)) {
    return normalizedCurrent;
  }

  const translated = await translateShortTitleToSwedish(options);
  return translated ?? normalizedCurrent;
}
