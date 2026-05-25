import { createHash } from "node:crypto";
import { normalizeSwedishUserFacingText } from "@/lib/ai/swedish-normalization";
import {
  eventDateRange,
  isUpcomingEventDate,
  normalizeEventDate,
  UPCOMING_EVENTS_HORIZON_DAYS,
} from "@/lib/intelligence/event-dates";
import {
  listProcessedItems,
  listTemporalSignalRawSourceItemIds,
  upsertTemporalSignal,
} from "@/lib/intelligence/repository";
import type {
  NewTemporalSignal,
  ProcessedIntelligenceRecord,
  TemporalContext,
  TemporalDateType,
} from "@/lib/intelligence/models";

const temporalDateTypes: TemporalDateType[] = [
  "exact",
  "range",
  "relative",
  "deadline",
  "estimated",
  "implicit",
];

const temporalContexts: TemporalContext[] = [
  "upcoming_event",
  "ongoing_process",
  "future_risk",
  "scheduled_vote",
  "earnings",
  "summit",
  "policy_deadline",
  "regulatory_change",
  "security_window",
  "market_window",
];

const temporalPrefilterPatterns = [
  /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/i,
  /\b(q[1-4]|h[12])\s*20\d{2}\b/i,
  /\b(next|upcoming|scheduled|expected|deadline|before|ahead of|later this year|by year[- ]end)\b/i,
  /\b(vote|summit|meeting|hearing|election|tariff deadline|takes effect|implementation)\b/i,
  /\b(pr[oó]ximo|previsto|programado|fecha l[ií]mite|antes de|votaci[oó]n|cumbre|entra en vigor)\b/i,
  /\b(nästa|kommande|väntas|planeras|före|inför|senare i år|träder i kraft|omröstning|toppmöte)\b/i,
];

const strongFuturePatterns = [
  /\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/i,
  /\b(q[1-4]|h[12])\s*20\d{2}\b/i,
  /\b(next|upcoming|scheduled|deadline|before|ahead of|takes effect)\b/i,
  /\b(pr[oó]ximo|programado|fecha l[ií]mite|antes de|entra en vigor)\b/i,
  /\b(nästa|kommande|planeras|före|inför|träder i kraft)\b/i,
];

const futureEventPatterns = [
  /\b(vote|election|summit|hearing|tariff deadline|implementation)\b/i,
  /\b(votaci[oó]n|elecciones?|cumbre|comparecer|audiencia)\b/i,
  /\b(omröstning|val|toppmöte|utfrågning|deadline)\b/i,
];

const forwardLookingPatterns = [
  ...strongFuturePatterns,
  /\b(starts?|begins?|launch(?:es|ing)?|rollout|to take effect|will take effect|by 20\d{2}|through 20\d{2})\b/i,
  /\b(a partir del?|entrar[aá] en vigor|hacia 20\d{2}|durante el tercer trimestre|para 20\d{2})\b/i,
  /\b(startar|börjar|lanseras|fram till 20\d{2}|under q[1-4]|senast 20\d{2})\b/i,
];

const futureActionPatterns = [
  /\b(will|would|expected|planned|scheduled|set to|aims? to|ready for|before|ahead of|starting|from \w+ \d{1,2}|from 20\d{2})\b/i,
  /\b(va a|prev[eé]|planea|programad[oa]|estar[aá] listo|a partir de|antes de|de cara a|rumbo a)\b/i,
  /\b(kommer att|väntas|planeras|ska|redo för|från och med|inför|före|med start|senast)\b/i,
];

const futureObjectPatterns = [
  /\b(vote|voting|election|summit|meeting|hearing|deadline|review|implementation|launch|rollout|trial|audience|report|mission|production|regulation|tariff|opening|operations)\b/i,
  /\b(votaci[oó]n|elecciones?|cumbre|reuni[oó]n|audiencia|fecha l[ií]mite|revisi[oó]n|implementaci[oó]n|despliegue|misi[oó]n|producci[oó]n|regulaci[oó]n|arancel|operaciones)\b/i,
  /\b(omröstning|val|toppmöte|möte|utfrågning|deadline|översyn|ikraftträdande|lansering|utrullning|rapport|mission|produktion|reglering|tullar|driftstart)\b/i,
];

const futureOrientedContexts = new Set<TemporalContext>([
  "upcoming_event",
  "future_risk",
  "scheduled_vote",
  "earnings",
  "summit",
  "policy_deadline",
  "regulatory_change",
  "security_window",
  "market_window",
]);

export interface TemporalExtractionRunResult {
  model?: string;
  scannedCount: number;
  prefilteredCount: number;
  attemptedCount: number;
  storedCount: number;
  skippedCount: number;
  skipReasonCounts: Partial<Record<TemporalSkipReason, number>>;
  attemptLogs: TemporalExtractionAttemptLog[];
  errors: string[];
}

export interface TemporalPrefilterAssessment {
  passed: boolean;
  baselineStrategicImportance: number;
  cueTags: string[];
  failureReasons: string[];
}

export type TemporalSkipReason =
  | "model_rejected_signal"
  | "response_incomplete"
  | "invalid_model_output"
  | "missing_supporting_fields"
  | "below_relevance_threshold"
  | "low_temporal_certainty_without_date"
  | "not_future_oriented";

export interface TemporalExtractionAttemptLog {
  rawSourceItemId: string;
  sourceName: string;
  title: string;
  outcome: "stored" | "skipped" | "error";
  skipReason?: TemporalSkipReason;
  detail?: string;
  dateStart?: string;
  dateEnd?: string;
  temporalContext?: TemporalContext;
  temporalCertaintyScore?: number;
  strategicImportanceScore?: number;
  swedenMexicoRelevanceScore?: number;
  extractionConfidenceScore?: number;
}

export interface TemporalExtractionProgress {
  label: string;
  completedCount: number;
  attemptedCount: number;
  storedCount: number;
  skippedCount: number;
  errorCount: number;
  currentTitle: string;
  currentSourceName: string;
  currentOutcome: "stored" | "skipped" | "error";
  currentSkipReason?: TemporalSkipReason;
}

interface ResponsesApiResult {
  status?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
    summary?: Array<{
      text?: string;
    }>;
  }>;
  incomplete_details?: {
    reason?: string;
  };
  error?: { message?: string };
}

interface TemporalAiOutput {
  has_temporal_signal: boolean;
  date_start: string | null;
  date_end: string | null;
  extracted_date_type: TemporalDateType;
  temporal_context: TemporalContext;
  temporal_certainty_score: number;
  strategic_importance_score: number;
  sweden_mexico_relevance_score: number;
  extraction_confidence_score: number;
  source_sentence: string;
  normalized_summary: string;
  extraction_reason: string | null;
}

type TemporalSanitizeResult =
  | {
      kind: "signal";
      signal: NewTemporalSignal;
      detail?: string;
    }
  | {
      kind: "skip";
      reason: TemporalSkipReason;
      detail: string;
      dateStart?: string;
      dateEnd?: string;
      temporalContext?: TemporalContext;
      temporalCertaintyScore?: number;
      strategicImportanceScore?: number;
      swedenMexicoRelevanceScore?: number;
      extractionConfidenceScore?: number;
    };

const temporalSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "has_temporal_signal",
    "date_start",
    "date_end",
    "extracted_date_type",
    "temporal_context",
    "temporal_certainty_score",
    "strategic_importance_score",
    "sweden_mexico_relevance_score",
    "extraction_confidence_score",
    "source_sentence",
    "normalized_summary",
    "extraction_reason",
  ],
  properties: {
    has_temporal_signal: { type: "boolean" },
    date_start: { type: ["string", "null"] },
    date_end: { type: ["string", "null"] },
    extracted_date_type: { type: "string", enum: temporalDateTypes },
    temporal_context: { type: "string", enum: temporalContexts },
    temporal_certainty_score: { type: "integer", minimum: 0, maximum: 100 },
    strategic_importance_score: { type: "integer", minimum: 0, maximum: 100 },
    sweden_mexico_relevance_score: { type: "integer", minimum: 0, maximum: 100 },
    extraction_confidence_score: { type: "integer", minimum: 0, maximum: 100 },
    source_sentence: { type: "string" },
    normalized_summary: { type: "string" },
    extraction_reason: { type: ["string", "null"] },
  },
};

function clampScore(value: number, fallback = 50) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function cleanTemporalText(value: string | null | undefined) {
  return value?.replace(/\u0000/g, "").trim() ?? "";
}

function extractResponseText(payload: ResponsesApiResult) {
  if (payload.output_text) return payload.output_text;

  const directText =
    payload.output
      ?.flatMap((output) => output.content ?? [])
      .map((content) => content.text ?? "")
      .find(Boolean) ?? "";

  if (directText) return directText;

  return (
    payload.output
      ?.flatMap((output) => output.summary ?? [])
      .map((content) => content.text ?? "")
      .find(Boolean) ?? ""
  );
}

function parseOutput(text: string): TemporalAiOutput | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as TemporalAiOutput;
  } catch {
    const candidate = trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1);
    if (!candidate) return null;
    try {
      return JSON.parse(candidate) as TemporalAiOutput;
    } catch {
      return null;
    }
  }
}

function textForTemporalScan(record: ProcessedIntelligenceRecord) {
  return [
    record.processed.title_sv,
    record.processed.summary_sv,
    record.processed.why_it_may_matter_sv,
    record.raw.title_original,
    record.raw.snippet,
    record.raw.raw_content?.slice(0, 2500),
  ]
    .filter(Boolean)
    .join("\n");
}

export function temporalCueTags(record: ProcessedIntelligenceRecord) {
  const text = textForTemporalScan(record);
  const tags: string[] = [];

  if (record.processed.event_date) tags.push("processed_event_date");
  if (/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/i.test(text)) tags.push("explicit_date");
  if (/\b(q[1-4]|h[12])\s*20\d{2}\b/i.test(text)) tags.push("quarter_or_half");
  if (/\b(next|upcoming|scheduled|expected|deadline|before|ahead of|later this year|by year[- ]end)\b/i.test(text)) {
    tags.push("english_future_phrase");
  }
  if (/\b(pr[oó]ximo|previsto|programado|fecha l[ií]mite|antes de|votaci[oó]n|cumbre|entra en vigor)\b/i.test(text)) {
    tags.push("spanish_future_phrase");
  }
  if (/\b(nästa|kommande|väntas|planeras|före|inför|senare i år|träder i kraft|omröstning|toppmöte)\b/i.test(text)) {
    tags.push("swedish_future_phrase");
  }
  if (/\b(vote|summit|meeting|hearing|election|tariff deadline|takes effect|implementation)\b/i.test(text)) {
    tags.push("event_noun_en");
  }
  if (/\b(votaci[oó]n|elecciones?|cumbre|comparecer|audiencia)\b/i.test(text)) {
    tags.push("event_noun_es");
  }
  if (/\b(omröstning|val|toppmöte|utfrågning|deadline)\b/i.test(text)) {
    tags.push("event_noun_sv");
  }

  return [...new Set(tags)];
}

export function hasTemporalCue(record: ProcessedIntelligenceRecord) {
  return temporalCueTags(record).length > 0;
}

export function baselineStrategicImportance(record: ProcessedIntelligenceRecord) {
  const processed = record.processed;
  return clampScore(
    processed.diplomatic_relevance_score * 0.28 +
      processed.sweden_relevance_score * 0.24 +
      processed.security_impact_score * 0.18 +
      processed.economic_impact_score * 0.16 +
      processed.urgency_score * 0.14,
  );
}

export function assessTemporalPrefilter(
  record: ProcessedIntelligenceRecord,
  minStrategicImportance = 50,
): TemporalPrefilterAssessment {
  const cueTags = temporalCueTags(record);
  const baseline = baselineStrategicImportance(record);
  const failureReasons: string[] = [];

  if (cueTags.length === 0) failureReasons.push("missing_temporal_cue");
  if (baseline < minStrategicImportance) {
    failureReasons.push(`baseline_below_${minStrategicImportance}`);
  }

  return {
    passed: failureReasons.length === 0,
    baselineStrategicImportance: baseline,
    cueTags,
    failureReasons,
  };
}

function temporalCandidatePriority(record: ProcessedIntelligenceRecord) {
  const text = textForTemporalScan(record);
  const authorityBoost = ["event", "advisory", "government", "institution"].includes(record.raw.source_type)
    ? 18
    : 0;
  const upcomingDateBoost = isUpcomingEventDate(record.processed.event_date) ? 24 : 0;
  const strongFutureBoost = strongFuturePatterns.some((pattern) => pattern.test(text)) ? 22 : 0;
  const eventBoost = futureEventPatterns.some((pattern) => pattern.test(text)) ? 14 : 0;
  return (
    baselineStrategicImportance(record) +
    authorityBoost +
    upcomingDateBoost +
    strongFutureBoost +
    eventBoost
  );
}

function temporalSignalId(record: ProcessedIntelligenceRecord, output: TemporalAiOutput) {
  return createHash("sha256")
    .update([
      record.raw.id,
      output.date_start ?? "",
      output.date_end ?? "",
      output.temporal_context,
      output.source_sentence,
    ].join("|"))
    .digest("hex")
    .slice(0, 32);
}

function isFutureOrientedSignal(
  record: ProcessedIntelligenceRecord,
  output: TemporalAiOutput,
  dateStart: string | undefined,
  dateEnd: string | undefined,
): { ok: true } | { ok: false; detail: string } {
  const nowTs = Date.now();
  const startRange = eventDateRange(dateStart);
  const endRange = eventDateRange(dateEnd);
  const latestRange = endRange ?? startRange;
  const hasFutureWindow = Boolean(latestRange && latestRange.endTs >= nowTs);
  const scanText = [
    cleanTemporalText(output.source_sentence),
    cleanTemporalText(output.normalized_summary),
    textForTemporalScan(record),
  ]
    .filter(Boolean)
    .join("\n");
  const hasForwardCue = forwardLookingPatterns.some((pattern) => pattern.test(scanText));
  const contextImpliesFuture = futureOrientedContexts.has(output.temporal_context);

  if (latestRange && latestRange.endTs < nowTs) {
    return {
      ok: false,
      detail:
        "Signal carries a dated window, but that window is already fully in the past and does not qualify as an upcoming signal",
    };
  }

  if (hasFutureWindow) {
    return { ok: true };
  }

  const aiText = [cleanTemporalText(output.source_sentence), cleanTemporalText(output.normalized_summary)]
    .filter(Boolean)
    .join("\n");
  const hasAiFutureCue = futureActionPatterns.some((pattern) => pattern.test(aiText));
  const hasAiFutureObject = futureObjectPatterns.some((pattern) => pattern.test(aiText));

  if (!dateStart && !dateEnd && (!hasAiFutureCue || !hasAiFutureObject)) {
    return {
      ok: false,
      detail:
        "Signal lacks a normalized date and does not clearly identify the concrete future event, decision, risk window, or next step to monitor",
    };
  }

  if (contextImpliesFuture && hasForwardCue) {
    return { ok: true };
  }

  if (output.temporal_context === "ongoing_process" && hasForwardCue) {
    return { ok: true };
  }

  return {
    ok: false,
    detail:
      "Signal appears historical or currently ongoing without a clear future window, deadline, or forward-looking cue",
  };
}

function sanitizeTemporalSignal(
  record: ProcessedIntelligenceRecord,
  output: TemporalAiOutput,
  model: string,
): TemporalSanitizeResult {
  if (!output.has_temporal_signal) {
    return {
      kind: "skip",
      reason: "model_rejected_signal",
      detail:
        cleanTemporalText(output.extraction_reason) || "Model returned has_temporal_signal=false",
      temporalContext: output.temporal_context,
      temporalCertaintyScore: clampScore(output.temporal_certainty_score),
      strategicImportanceScore: clampScore(output.strategic_importance_score),
      swedenMexicoRelevanceScore: clampScore(output.sweden_mexico_relevance_score),
      extractionConfidenceScore: clampScore(output.extraction_confidence_score),
    };
  }
  if (!cleanTemporalText(output.source_sentence) || !cleanTemporalText(output.normalized_summary)) {
    return {
      kind: "skip",
      reason: "missing_supporting_fields",
      detail: "Model did not provide source_sentence and normalized_summary",
      temporalContext: output.temporal_context,
      temporalCertaintyScore: clampScore(output.temporal_certainty_score),
      strategicImportanceScore: clampScore(output.strategic_importance_score),
      swedenMexicoRelevanceScore: clampScore(output.sweden_mexico_relevance_score),
      extractionConfidenceScore: clampScore(output.extraction_confidence_score),
    };
  }

  const dateStart = normalizeEventDate(output.date_start ?? undefined);
  const dateEnd = normalizeEventDate(output.date_end ?? undefined);
  const temporalCertainty = clampScore(output.temporal_certainty_score);
  const strategicImportance = Math.max(
    baselineStrategicImportance(record),
    clampScore(output.strategic_importance_score),
  );
  const swedenMexicoRelevance = Math.max(
    record.processed.sweden_relevance_score,
    clampScore(output.sweden_mexico_relevance_score),
  );

  if (strategicImportance < 55 && swedenMexicoRelevance < 55) {
    return {
      kind: "skip",
      reason: "below_relevance_threshold",
      detail: "Signal fell below both strategic and Sweden/Mexico relevance thresholds",
      dateStart,
      dateEnd,
      temporalContext: output.temporal_context,
      temporalCertaintyScore: temporalCertainty,
      strategicImportanceScore: strategicImportance,
      swedenMexicoRelevanceScore: swedenMexicoRelevance,
      extractionConfidenceScore: clampScore(output.extraction_confidence_score),
    };
  }
  if (!dateStart && temporalCertainty < 70) {
    return {
      kind: "skip",
      reason: "low_temporal_certainty_without_date",
      detail: "Signal lacked a normalized date and temporal certainty stayed below 70",
      dateStart,
      dateEnd,
      temporalContext: output.temporal_context,
      temporalCertaintyScore: temporalCertainty,
      strategicImportanceScore: strategicImportance,
      swedenMexicoRelevanceScore: swedenMexicoRelevance,
      extractionConfidenceScore: clampScore(output.extraction_confidence_score),
    };
  }

  const futureOrientation = isFutureOrientedSignal(record, output, dateStart, dateEnd);
  if (!futureOrientation.ok) {
    return {
      kind: "skip",
      reason: "not_future_oriented",
      detail: futureOrientation.detail,
      dateStart,
      dateEnd,
      temporalContext: output.temporal_context,
      temporalCertaintyScore: temporalCertainty,
      strategicImportanceScore: strategicImportance,
      swedenMexicoRelevanceScore: swedenMexicoRelevance,
      extractionConfidenceScore: clampScore(output.extraction_confidence_score),
    };
  }

  return {
    kind: "signal",
    detail: output.extraction_reason?.trim() || undefined,
    signal: {
      id: temporalSignalId(record, output),
      raw_source_item_id: record.raw.id,
      date_start: dateStart,
      date_end: dateEnd,
      extracted_date_type: temporalDateTypes.includes(output.extracted_date_type)
        ? output.extracted_date_type
        : "implicit",
      temporal_context: temporalContexts.includes(output.temporal_context)
        ? output.temporal_context
        : "ongoing_process",
      temporal_certainty_score: temporalCertainty,
      strategic_importance_score: strategicImportance,
      sweden_mexico_relevance_score: swedenMexicoRelevance,
      extraction_confidence_score: clampScore(output.extraction_confidence_score),
      source_sentence: cleanTemporalText(output.source_sentence),
      normalized_summary: normalizeSwedishUserFacingText(
        cleanTemporalText(output.normalized_summary),
      ),
      extraction_reason: cleanTemporalText(output.extraction_reason) || undefined,
      extraction_model: model,
    },
  };
}

export function temporalExtractionModel() {
  return (
    process.env.MISSIONDESK_TEMPORAL_MODEL ??
    process.env.OPENAI_TEMPORAL_MODEL ??
    process.env.OPENAI_PROCESSING_MODEL ??
    process.env.OPENAI_MODEL ??
    "gpt-5-mini"
  );
}

function modelSupportsReasoningEffort(model: string) {
  return model.startsWith("gpt-5");
}

export function isTemporalExtractionConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function temporalRequestTimeoutMs() {
  const configured = Number(process.env.MISSIONDESK_TEMPORAL_REQUEST_TIMEOUT_MS ?? 45000);
  if (!Number.isFinite(configured)) return 45000;
  return Math.max(5000, Math.round(configured));
}

export async function extractTemporalSignalWithOpenAI(
  record: ProcessedIntelligenceRecord,
): Promise<TemporalSanitizeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      kind: "skip",
      reason: "invalid_model_output",
      detail: "OPENAI_API_KEY is missing",
    };
  }
  const model = temporalExtractionModel();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), temporalRequestTimeoutMs());
  timeout.unref?.();

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Connection: "close",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_output_tokens: 1100,
        ...(modelSupportsReasoningEffort(model)
          ? {
              reasoning: {
                effort: "minimal",
              },
            }
          : {}),
        input: [
          {
            role: "system",
            content: [
              "Du extraherar framtids- och tidsbaserade underrättelsesignalvärden för MissionDesk.",
              "Detta är inte en kalenderimport; hitta bara strategiskt relevanta framtida signaler.",
              "Använd endast tillhandahållen text. Hitta inte på datum, deadlines eller events.",
              "Om tidpunkten är vag, använd date_start/date_end null och ange relative/estimated/implicit med lägre temporal certainty.",
              "source_sentence måste vara en kort textbit från underlaget som stöder tidsbedömningen.",
              "Om du saknar normaliserbart datum eller intervall får du bara sätta has_temporal_signal=true om normalized_summary tydligt anger vilket framtida skeende, beslut, riskfönster eller kommande steg som ska bevakas.",
              "Allmän kritik, allmän oro eller bakgrund utan tydligt framtidsobjekt ska returneras med has_temporal_signal=false.",
              "Använd svensk stavning i normalized_summary: skriv fentanyl, inte fentanil.",
              "Prioritera Sverige, Mexiko, Sweden-Mexico-relevans, säkerhet, handel, industri, diplomati, policy och marknadsrisk.",
              "Lågstrategiska evenemang ska returneras med has_temporal_signal=false.",
              `Upcoming Signals UI har ${UPCOMING_EVENTS_HORIZON_DAYS} dagars primär horisont, men längre framtidsrisker kan sparas om de är strategiskt starka.`,
              "Returnera strikt JSON enligt schemat.",
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify({
              source: {
                name: record.raw.source_name,
                country: record.raw.source_country,
                language: record.raw.source_language,
                type: record.raw.source_type,
                published_at: record.raw.published_at,
                url: record.raw.url,
              },
              processed: {
                title_sv: record.processed.title_sv,
                summary_sv: record.processed.summary_sv,
                why_it_may_matter_sv: record.processed.why_it_may_matter_sv,
                event_date: record.processed.event_date,
                category: record.processed.category,
                scores: {
                  urgency: record.processed.urgency_score,
                  diplomatic: record.processed.diplomatic_relevance_score,
                  sweden: record.processed.sweden_relevance_score,
                  economic: record.processed.economic_impact_score,
                  security: record.processed.security_impact_score,
                },
              },
              raw: {
                title_original: record.raw.title_original,
                snippet: record.raw.snippet,
                raw_content_excerpt: record.raw.raw_content?.slice(0, 2500),
              },
            }),
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "missiondesk_temporal_signal",
            strict: true,
            schema: temporalSchema,
          },
        },
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`OpenAI temporal extraction failed with ${response.status}: ${message}`);
    }

    const payload = (await response.json()) as ResponsesApiResult;
    if (payload.error?.message) throw new Error(payload.error.message);
    if (payload.status === "incomplete") {
      return {
        kind: "skip",
        reason: "response_incomplete",
        detail: `Temporal extraction response was incomplete: ${payload.incomplete_details?.reason ?? "unknown_reason"}`,
      };
    }
    const output = parseOutput(extractResponseText(payload));
    if (!output) {
      return {
        kind: "skip",
        reason: "invalid_model_output",
        detail: "Could not parse JSON output from temporal extraction model",
      };
    }
    return sanitizeTemporalSignal(record, output, model);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Temporal extraction timed out after ${temporalRequestTimeoutMs()}ms for "${record.processed.title_sv || record.raw.title_original}"`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function pushSkipReason(
  counts: Partial<Record<TemporalSkipReason, number>>,
  reason: TemporalSkipReason,
) {
  counts[reason] = (counts[reason] ?? 0) + 1;
}

async function loadProcessedTemporalRecords(options: {
  onlyFresh?: boolean;
  rawSourceItemIds?: string[];
  scanLimit?: number;
}) {
  const pageSize = 250;
  const records: ProcessedIntelligenceRecord[] = [];

  if (options.scanLimit !== undefined) {
    return listProcessedItems({
      onlyFresh: options.onlyFresh ?? false,
      rawSourceItemIds: options.rawSourceItemIds,
      limit: options.scanLimit,
      offset: 0,
    });
  }

  let offset = 0;
  while (true) {
    const page = await listProcessedItems({
      onlyFresh: options.onlyFresh ?? false,
      rawSourceItemIds: options.rawSourceItemIds,
      limit: pageSize,
      offset,
    });
    records.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }

  return records;
}

export async function storeTemporalSignalForProcessedRecord(
  record: ProcessedIntelligenceRecord,
): Promise<TemporalExtractionAttemptLog> {
  const extraction = await extractTemporalSignalWithOpenAI(record);
  if (extraction.kind === "skip") {
    return {
      rawSourceItemId: record.raw.id,
      sourceName: record.raw.source_name,
      title: record.processed.title_sv || record.raw.title_original,
      outcome: "skipped",
      skipReason: extraction.reason,
      detail: extraction.detail,
      dateStart: extraction.dateStart,
      dateEnd: extraction.dateEnd,
      temporalContext: extraction.temporalContext,
      temporalCertaintyScore: extraction.temporalCertaintyScore,
      strategicImportanceScore: extraction.strategicImportanceScore,
      swedenMexicoRelevanceScore: extraction.swedenMexicoRelevanceScore,
      extractionConfidenceScore: extraction.extractionConfidenceScore,
    };
  }

  await upsertTemporalSignal(extraction.signal);
  return {
    rawSourceItemId: record.raw.id,
    sourceName: record.raw.source_name,
    title: record.processed.title_sv || record.raw.title_original,
    outcome: "stored",
    detail: extraction.detail,
    dateStart: extraction.signal.date_start,
    dateEnd: extraction.signal.date_end,
    temporalContext: extraction.signal.temporal_context,
    temporalCertaintyScore: extraction.signal.temporal_certainty_score,
    strategicImportanceScore: extraction.signal.strategic_importance_score,
    swedenMexicoRelevanceScore: extraction.signal.sweden_mexico_relevance_score,
    extractionConfidenceScore: extraction.signal.extraction_confidence_score,
  };
}

export async function extractTemporalSignalsFromProcessedItems(
  options: {
    onlyFresh?: boolean;
    rawSourceItemIds?: string[];
    excludeExistingTemporalSignals?: boolean;
    usePrefilter?: boolean;
    scanLimit?: number;
    attemptLimit?: number;
    minStrategicImportance?: number;
    progressLabel?: string;
    progressEvery?: number;
    onProgress?: (progress: TemporalExtractionProgress) => void | Promise<void>;
  } = {},
): Promise<TemporalExtractionRunResult> {
  const records = await loadProcessedTemporalRecords({
    onlyFresh: options.onlyFresh ?? false,
    rawSourceItemIds: options.rawSourceItemIds,
    scanLimit: options.scanLimit,
  });
  const existingTemporalIds = options.excludeExistingTemporalSignals
    ? new Set(await listTemporalSignalRawSourceItemIds(options.rawSourceItemIds))
    : new Set<string>();
  const minStrategic = options.minStrategicImportance ?? 50;
  const eligible = records
    .filter((record) => !existingTemporalIds.has(record.raw.id))
    .filter((record) =>
      options.usePrefilter
        ? hasTemporalCue(record) && baselineStrategicImportance(record) >= minStrategic
        : true,
    )
    .sort((a, b) => temporalCandidatePriority(b) - temporalCandidatePriority(a));
  const attempted =
    options.attemptLimit !== undefined
      ? eligible.slice(0, Math.max(1, options.attemptLimit))
      : eligible;
  const result: TemporalExtractionRunResult = {
    model: isTemporalExtractionConfigured() ? temporalExtractionModel() : undefined,
    scannedCount: records.length,
    prefilteredCount: eligible.length,
    attemptedCount: attempted.length,
    storedCount: 0,
    skippedCount: 0,
    skipReasonCounts: {},
    attemptLogs: [],
    errors: [],
  };

  if (!isTemporalExtractionConfigured()) {
    result.errors.push("OPENAI_API_KEY is required for temporal extraction");
    return result;
  }

  const progressLabel = options.progressLabel ?? "temporal-extraction";
  const progressEvery =
    options.progressEvery === undefined ? 0 : Math.max(1, Math.round(options.progressEvery));
  const emitProgress = async (
    completedCount: number,
    outcome: TemporalExtractionAttemptLog,
  ) => {
    const progress: TemporalExtractionProgress = {
      label: progressLabel,
      completedCount,
      attemptedCount: attempted.length,
      storedCount: result.storedCount,
      skippedCount: result.skippedCount,
      errorCount: result.errors.length,
      currentTitle: outcome.title,
      currentSourceName: outcome.sourceName,
      currentOutcome: outcome.outcome,
      currentSkipReason: outcome.skipReason,
    };

    if (options.onProgress) {
      await options.onProgress(progress);
    }

    if (
      progressEvery > 0 &&
      (completedCount === attempted.length || completedCount % progressEvery === 0)
    ) {
      console.info(
        `[${progressLabel}] progress ${completedCount}/${attempted.length}`,
        JSON.stringify({
          storedCount: result.storedCount,
          skippedCount: result.skippedCount,
          errorCount: result.errors.length,
          currentOutcome: outcome.outcome,
          currentSkipReason: outcome.skipReason,
          currentSourceName: outcome.sourceName,
          currentTitle: outcome.title,
        }),
      );
    }
  };

  for (const [index, record] of attempted.entries()) {
    try {
      const outcome = await storeTemporalSignalForProcessedRecord(record);
      result.attemptLogs.push(outcome);
      if (outcome.outcome === "skipped") {
        result.skippedCount += 1;
        if (outcome.skipReason) {
          pushSkipReason(result.skipReasonCounts, outcome.skipReason);
        }
        await emitProgress(index + 1, outcome);
        continue;
      }
      result.storedCount += 1;
      await emitProgress(index + 1, outcome);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown temporal extraction error";
      result.errors.push(message);
      const outcome: TemporalExtractionAttemptLog = {
        rawSourceItemId: record.raw.id,
        sourceName: record.raw.source_name,
        title: record.processed.title_sv || record.raw.title_original,
        outcome: "error",
        detail: message,
      };
      result.attemptLogs.push(outcome);
      await emitProgress(index + 1, outcome);
    }
  }

  console.info(
    "[temporal] extraction run",
    JSON.stringify({
      scannedCount: result.scannedCount,
      prefilteredCount: result.prefilteredCount,
      attemptedCount: result.attemptedCount,
      storedCount: result.storedCount,
      skippedCount: result.skippedCount,
      skipReasonCounts: result.skipReasonCounts,
      attemptSample: result.attemptLogs.slice(0, 8),
      errors: result.errors,
    }),
  );

  return result;
}
