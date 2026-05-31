import { getMigratedDb } from "@/lib/db/postgres";
import {
  looksLikeForeignSummaryInSwedishField,
  normalizeSwedishUserFacingText,
} from "@/lib/ai/swedish-normalization";
import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import { detectGeography } from "@/lib/ingestion/geography";
import { sanitizePublishedAt } from "@/lib/ingestion/published-at";
import { fetchRssSource } from "@/lib/ingestion/rss";
import { fetchSocialSource } from "@/lib/ingestion/social";
import { fetchWebsiteSource } from "@/lib/ingestion/website";
import type { RawSourceDocument } from "@/lib/ingestion/types";
import {
  createRawSourceItemId,
  getProcessedItemByRawId,
  getRawSourceItemById,
  getRawSourceItemByUrl,
  listRawSourceItems,
  upsertRawSourceItem,
} from "@/lib/intelligence/repository";
import type { RawSourceItem } from "@/lib/intelligence/models";
import { getSources } from "@/lib/sources/store";
import type { EmbassyConfig, IntelligenceCategory, RetrievalMethod, SourceDefinition } from "@/lib/types";
import type { SourceIntelligenceType } from "@/lib/intelligence/models";

const MAX_QUERY_VARIANTS = 5;
const MAX_RSS_ITEMS_PER_SOURCE = 20;
const MAX_WEBSITE_ITEMS_PER_SOURCE = 12;
const MAX_SOCIAL_POSTS_PER_ACCOUNT = 5;
const DEFAULT_LOCAL_RESULT_LIMIT = 50;
const DEFAULT_DEEP_RESULT_LIMIT = 60;
const LOCAL_SCAN_LIMIT = 5000;
const AI_CANDIDATE_LIMIT = 16;
const QUERY_CACHE_TTL_HOURS = 24 * 14;
const QUERY_VARIANTS_CACHE_VERSION = "v3";

export type SignalTrackingMode = "local" | "deep";

export interface SignalTrackingResult {
  id: string;
  title_original: string;
  title_sv: string;
  snippet_original?: string;
  snippet_sv?: string;
  url: string;
  source_name: string;
  source_country: string;
  source_language: string;
  published_at?: string;
  retrieved_at: string;
  category: IntelligenceCategory;
  source_type: SourceIntelligenceType;
  detected_country?: string;
  detected_region?: string;
  detected_city?: string;
  relevance_score: number;
  discovery: "local_cache" | "deep_discovery" | "source_metadata";
  ai_enriched: boolean;
  match_field?: "title" | "snippet" | "body" | "url";
  match_term?: string;
  match_excerpt?: string;
}

export interface SignalTrackingSearchResult {
  query: string;
  mode: SignalTrackingMode;
  aiEnabled: boolean;
  searchedAt: string;
  queryVariants: string[];
  sourceCount: number;
  scannedSourceCount: number;
  fetchedCount: number;
  resultCount: number;
  translatedCount: number;
  translationModel?: string;
  deepSearchUsed: boolean;
  notes: string[];
  report: {
    sourcesScanned: number;
    rssHits: number;
    websiteFallbackActivations: number;
    xAccountsQueried: number;
    xPostsFetched: number;
    newUrlsDiscovered: number;
    duplicatesSkipped: number;
    aiCandidatesProcessed: number;
    estimatedTokenUsage: number;
    estimatedApiReads: number;
  };
  results: SignalTrackingResult[];
  errors: Array<{ source: string; message: string }>;
}

interface DeepSearchOptions {
  includeWebRss: boolean;
  includeSocialX: boolean;
}

interface SearchOptions {
  query: string;
  config?: EmbassyConfig;
  mode?: SignalTrackingMode;
  aiEnabled?: boolean;
  deepSearchOptions?: DeepSearchOptions;
  limit?: number;
}

interface Candidate {
  source: SourceDefinition;
  titleOriginal: string;
  snippetOriginal?: string;
  url: string;
  publishedAt?: string;
  retrievedAt: string;
  category: IntelligenceCategory;
  sourceType: SourceIntelligenceType;
  score: number;
  detectedCountry?: string;
  detectedRegion?: string;
  detectedCity?: string;
  discovery: SignalTrackingResult["discovery"];
  rawId?: string;
  matchField?: SignalTrackingResult["match_field"];
  matchTerm?: string;
  matchExcerpt?: string;
}

interface QueryExpansionCacheRow {
  query_key: string;
  variants_json: string;
  model: string | null;
  expires_at: string | null;
}

interface ResponsesApiResult {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      refusal?: string;
    }>;
  }>;
}

interface DeepSearchStats {
  sourcesScanned: number;
  rssHits: number;
  websiteFallbackActivations: number;
  xAccountsQueried: number;
  xPostsFetched: number;
  newUrlsDiscovered: number;
  duplicatesSkipped: number;
  aiCandidatesProcessed: number;
  estimatedTokenUsage: number;
  estimatedApiReads: number;
}

interface TranslationItem {
  titleSv: string;
  snippetSv?: string;
  ai: boolean;
}

const categoryKeywords: Record<IntelligenceCategory, string[]> = {
  economy: ["inflation", "peso", "gdp", "growth", "crecimiento", "inflacion", "economia"],
  trade: ["trade", "export", "import", "tariff", "comercio", "exportacion", "importacion"],
  domestic_politics: ["president", "congress", "senate", "election", "gobierno", "congreso"],
  foreign_policy: ["foreign", "diplomatic", "bilateral", "sre", "cancilleria", "diplomacia"],
  sweden_connection: ["sweden", "swedish", "suecia", "sueco", "sueca", "volvo", "ericsson"],
  security: ["security", "crime", "violence", "cartel", "seguridad", "violencia", "crimen", "fentanyl"],
  markets: ["market", "stock", "bond", "currency", "mercado", "bolsa", "divisa", "rate"],
  investment_climate: ["investment", "nearshoring", "factory", "inversion", "empresa", "planta"],
  migration: ["migration", "migrant", "border", "migracion", "migrante", "frontera"],
  society: ["society", "health", "education", "protest", "salud", "educacion", "protesta"],
  energy: ["energy", "oil", "gas", "electricity", "energia", "petroleo", "electricidad"],
  technology: ["technology", "digital", "ai", "semiconductor", "tecnologia", "datos"],
  culture_soft_power: ["culture", "film", "music", "museum", "cultura", "cine", "arte"],
};

const localDictionary: Record<string, string[]> = {
  sverige: ["sweden", "suecia"],
  sweden: ["sverige", "suecia"],
  suecia: ["sweden", "sverige"],
  sakerhet: ["security", "seguridad"],
  säkerhet: ["security", "seguridad"],
  security: ["säkerhet", "seguridad"],
  seguridad: ["säkerhet", "security"],
  tullar: ["tariffs", "aranceles"],
  tariffs: ["tullar", "aranceles"],
  aranceles: ["tullar", "tariffs"],
  migration: ["migracion", "migración"],
  migracion: ["migration", "migration"],
  migrationen: ["migration", "migracion"],
  kina: ["china"],
  china: ["kina"],
  energi: ["energy", "energia"],
  energy: ["energi", "energia"],
  energia: ["energi", "energy"],
  fentanilo: ["fentanyl", "fentanil"],
  fentanyl: ["fentanilo", "fentanil"],
  fentanil: ["fentanilo", "fentanyl"],
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9åäö\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())
      ) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return value.trim();
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sourceType(source: SourceDefinition): SourceIntelligenceType {
  if (source.sourceType) return source.sourceType;
  if (source.type === "calendar") return "event";
  if (source.type === "rss") return "news";
  if (source.type === "social") return "social";
  if (/(gob\.mx|\.gov|government|minister|myndighet|agency|bank)/i.test(source.url)) {
    return "government";
  }
  return "other";
}

function sourcePriority(source: SourceDefinition) {
  if (typeof source.sourcePriority === "number") return source.sourcePriority;
  if (source.trustTier === 1) return 92;
  if (source.trustTier === 2) return 76;
  return 58;
}

function splitTerms(values: string[]) {
  return values
    .flatMap((value) => normalize(value).split(" "))
    .filter((term) => term.length >= 2);
}

function detectCategory(source: SourceDefinition, haystack: string): IntelligenceCategory {
  let best: { category: IntelligenceCategory; count: number } | null = null;
  for (const [category, keywords] of Object.entries(categoryKeywords) as Array<
    [IntelligenceCategory, string[]]
  >) {
    const count = keywords.filter((keyword) => haystack.includes(normalize(keyword))).length;
    if (count > 0 && (!best || count > best.count)) best = { category, count };
  }
  return best?.category ?? source.categories[0] ?? "society";
}

function scoreText(
  source: SourceDefinition,
  title: string,
  snippet: string | undefined,
  text: string | undefined,
  terms: string[],
) {
  const titleNorm = normalize(title);
  const snippetNorm = normalize(snippet ?? "");
  const textNorm = normalize(text ?? "");
  const sourceNorm = normalize(`${source.name} ${source.notes ?? ""}`);
  const phrase = terms.join(" ");

  const titleHits = terms.filter((term) => titleNorm.includes(term)).length;
  const snippetHits = terms.filter((term) => snippetNorm.includes(term)).length;
  const textHits = terms.filter((term) => textNorm.includes(term)).length;
  const sourceHits = terms.filter((term) => sourceNorm.includes(term)).length;
  const totalHits = titleHits + snippetHits + textHits + sourceHits;
  if (totalHits === 0) return 0;

  let score = 0;
  if (phrase && titleNorm.includes(phrase)) score += 68;
  score += titleHits * 24;
  score += snippetHits * 12;
  score += Math.min(30, textHits * 5);
  score += sourceHits * 3;
  score += Math.round(sourcePriority(source) / 8);
  return Math.max(1, Math.min(100, score));
}

function publishedBonus(publishedAt?: string) {
  if (!publishedAt) return 0;
  const ageHours = (Date.now() - new Date(publishedAt).getTime()) / 36e5;
  if (!Number.isFinite(ageHours)) return 0;
  if (ageHours <= 24) return 14;
  if (ageHours <= 72) return 9;
  if (ageHours <= 168) return 5;
  if (ageHours > 24 * 45) return -16;
  return 0;
}

function retrievalPrimary(source: SourceDefinition): RetrievalMethod {
  return source.retrieval?.primary ?? source.retrievalMethod ?? (source.type === "rss" ? "rss" : "website");
}

function retrievalFallback(source: SourceDefinition): RetrievalMethod | undefined {
  return source.retrieval?.fallback;
}

function isSocialXSource(source: SourceDefinition) {
  if ((source.platform ?? "").toLowerCase() === "x") return true;
  try {
    const host = new URL(source.url).hostname.toLowerCase();
    return host.includes("x.com") || host.includes("twitter.com");
  } catch {
    return false;
  }
}

function queryExpansionModel() {
  return process.env.MISSIONDESK_SIGNAL_TRACKING_MODEL ?? "gpt-4o-mini";
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

function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

async function ensureQueryExpansionTable() {
  const db = getMigratedDb();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS signal_tracking_query_expansions (
      query_key TEXT PRIMARY KEY,
      variants_json TEXT NOT NULL,
      model TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT datetime('now'),
      updated_at TEXT NOT NULL DEFAULT datetime('now')
    )
  `).run();
}

async function readCachedExpansion(queryKey: string) {
  await ensureQueryExpansionTable();
  const db = getMigratedDb();
  const row = (await db
    .prepare(
      "SELECT query_key, variants_json, model, expires_at FROM signal_tracking_query_expansions WHERE query_key = ?",
    )
    .get(queryKey)) as QueryExpansionCacheRow | undefined;
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;
  try {
    const variants = JSON.parse(row.variants_json) as string[];
    return { variants, model: row.model ?? undefined };
  } catch {
    return null;
  }
}

async function writeCachedExpansion(queryKey: string, variants: string[], model?: string) {
  await ensureQueryExpansionTable();
  const db = getMigratedDb();
  const expiresAt = new Date(Date.now() + QUERY_CACHE_TTL_HOURS * 36e5).toISOString();
  await db
    .prepare(
      `
      INSERT INTO signal_tracking_query_expansions (query_key, variants_json, model, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(query_key) DO UPDATE SET
        variants_json = excluded.variants_json,
        model = excluded.model,
        expires_at = excluded.expires_at,
        updated_at = datetime('now')
    `,
    )
    .run(queryKey, JSON.stringify(variants), model ?? null, expiresAt);
}

function dictionaryExpansion(query: string) {
  const normalized = normalize(query);
  const seeds = [query];
  const terms = normalized.split(" ").filter(Boolean);
  for (const term of terms) {
    const mapped = localDictionary[term];
    if (!mapped) continue;
    for (const value of mapped) seeds.push(value);
  }
  return [...new Set(seeds.map((value) => value.trim()).filter(Boolean))].slice(0, MAX_QUERY_VARIANTS);
}

async function aiExpansion(query: string, existing: string[]) {
  if (!isOpenAiConfigured()) return existing;
  if (existing.length >= MAX_QUERY_VARIANTS) return existing;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return existing;
  const model = queryExpansionModel();
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "Returnera max fem nära språkvarianter (svenska, engelska, spanska) av samma sökterm. Inga breda semantiska sidospår. Behåll egennamn så nära originalet som möjligt. Returnera endast JSON-array med strängar.",
        },
        {
          role: "user",
          content: JSON.stringify({ query, existing }),
        },
      ],
      max_output_tokens: 180,
      temperature: 0,
    }),
  });
  if (!response.ok) return existing;
  const payload = (await response.json()) as ResponsesApiResult;
  const output = extractResponseText(payload);
  const jsonText = output.match(/\[[\s\S]*\]/)?.[0] ?? output;
  try {
    const parsed = JSON.parse(jsonText) as string[];
    const filtered = parsed
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => isVariantNearOriginal(query, value));
    const merged = [...new Set([...existing, ...filtered].map((value) => value.trim()).filter(Boolean))];
    return merged.slice(0, MAX_QUERY_VARIANTS);
  } catch {
    return existing;
  }
}

async function getQueryVariants(query: string) {
  const queryKey = `${QUERY_VARIANTS_CACHE_VERSION}:${normalize(query)}`;
  if (!queryKey) return { variants: [query], model: undefined as string | undefined };
  const cached = await readCachedExpansion(queryKey);
  if (cached) {
    return { variants: cached.variants.slice(0, MAX_QUERY_VARIANTS), model: cached.model };
  }

  const local = dictionaryExpansion(query);
  let variants = local;
  let model: string | undefined;
  const localNormalized = new Set(local.map((value) => normalize(value)));
  const normalizedQuery = normalize(query);
  const needsAiFallback = !localNormalized.has(normalizedQuery) || local.length < 3;
  if (needsAiFallback) {
    variants = await aiExpansion(query, local);
    model = isOpenAiConfigured() ? queryExpansionModel() : undefined;
  }

  await writeCachedExpansion(queryKey, variants, model);
  return { variants, model };
}

function toRawSourceType(source: SourceDefinition): SourceIntelligenceType {
  return sourceType(source);
}

function damerauLevenshtein(a: string, b: string) {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const matrix: number[][] = Array.from({ length: aLen + 1 }, () =>
    Array.from({ length: bLen + 1 }, () => 0),
  );

  for (let i = 0; i <= aLen; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= bLen; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= aLen; i += 1) {
    for (let j = 1; j <= bLen; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );

      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        value = Math.min(value, matrix[i - 2][j - 2] + 1);
      }
      matrix[i][j] = value;
    }
  }

  return matrix[aLen][bLen];
}

function isApproximateTokenMatch(needle: string, token: string) {
  if (!needle || !token) return false;
  if (needle === token) return true;
  if (needle.length !== token.length) return false;
  if (needle.length >= 4 && needle[0] !== token[0]) return false;
  if (needle.length >= 6 && needle.slice(0, 2) !== token.slice(0, 2)) return false;

  const maxDistance =
    needle.length >= 8 ? 2 : needle.length >= 5 ? 1 : 0;
  if (maxDistance === 0) return false;
  return damerauLevenshtein(needle, token) <= maxDistance;
}

function isVariantNearOriginal(original: string, variant: string) {
  const a = normalize(original);
  const b = normalize(variant);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(" ") || b.includes(" ")) {
    if (a.length >= 4 && a[0] !== b[0]) return false;
    return damerauLevenshtein(a, b) <= 3;
  }
  if (a.length >= 4 && a[0] !== b[0]) return false;
  if (a.length >= 6 && a.slice(0, 2) !== b.slice(0, 2)) return false;
  const maxDistance = a.length >= 8 ? 2 : 1;
  return damerauLevenshtein(a, b) <= maxDistance;
}

function buildBodyMatchExcerpt(text: string | undefined, variant: string) {
  const body = (text ?? "").replace(/\s+/g, " ").trim();
  if (!body) return "";
  const sections = body
    .split(/(?<=[.!?])\s+/)
    .map((section) => section.trim())
    .filter(Boolean);
  const found =
    sections.find((section) => normalize(section).includes(variant)) ??
    sections.find((section) => section.length >= 40) ??
    sections[0];
  if (!found) return body.slice(0, 280);
  return found.slice(0, 280);
}

function findVariantMatch(
  title: string,
  snippet: string | undefined,
  text: string | undefined,
  url: string,
  queryVariants: string[],
  fuzzyEnabledVariants: Set<string>,
) {
  const visibleHaystack = normalize([title, snippet, url].filter(Boolean).join(" "));
  const deepHaystack = normalize([text].filter(Boolean).join(" "));
  const visibleTokens = new Set(visibleHaystack.split(" ").filter(Boolean));
  const deepTokens = new Set(deepHaystack.split(" ").filter(Boolean));

  const normalizedVariants = [...new Set(queryVariants.map((value) => normalize(value)).filter(Boolean))];
  if (normalizedVariants.length === 0) return null;

  const containsVariant = (
    haystack: string,
    tokens: Set<string>,
    allowFuzzy: boolean,
  ): { variant: string; fuzzy: boolean } | null => {
    for (const variant of normalizedVariants) {
      if (variant.includes(" ")) {
        if (haystack.includes(variant)) return { variant, fuzzy: false };
        continue;
      }
      if (tokens.has(variant)) return { variant, fuzzy: false };
      if (!allowFuzzy) continue;
      if (!fuzzyEnabledVariants.has(variant)) continue;
      for (const token of tokens) {
        if (isApproximateTokenMatch(variant, token)) return { variant, fuzzy: true };
      }
    }
    return null;
  };

  const titleText = title.trim();
  const titleNorm = normalize(titleText);
  const titleTokens = new Set(titleNorm.split(" ").filter(Boolean));
  const titleMatch = containsVariant(titleNorm, titleTokens, true);
  if (titleMatch) {
    return { field: "title" as const, term: titleMatch.variant, excerpt: titleText.slice(0, 220) };
  }

  const snippetText = (snippet ?? "").trim();
  const snippetNorm = normalize(snippetText);
  const snippetTokens = new Set(snippetNorm.split(" ").filter(Boolean));
  const snippetMatch = containsVariant(snippetNorm, snippetTokens, true);
  if (snippetMatch) {
    return { field: "snippet" as const, term: snippetMatch.variant, excerpt: snippetText.slice(0, 260) };
  }

  const urlNorm = normalize(url);
  const urlTokens = new Set(urlNorm.split(" ").filter(Boolean));
  const urlMatch = containsVariant(urlNorm, urlTokens, false);
  if (urlMatch) {
    return { field: "url" as const, term: urlMatch.variant, excerpt: url.slice(0, 260) };
  }

  if (containsVariant(visibleHaystack, visibleTokens, true)) {
    return {
      field: "snippet" as const,
      term: normalizedVariants[0],
      excerpt: snippetText.slice(0, 260) || titleText.slice(0, 220),
    };
  }
  // Fallback to deep body text only for exact variant hits (no fuzzy),
  // to avoid false positives from near-miss tokens in long article bodies.
  const deepMatch = deepHaystack ? containsVariant(deepHaystack, deepTokens, false) : null;
  if (deepMatch) {
    return {
      field: "body" as const,
      term: deepMatch.variant,
      excerpt: buildBodyMatchExcerpt(text, deepMatch.variant),
    };
  }

  return null;
}

function toRawSourceItem(source: SourceDefinition, document: RawSourceDocument, config: EmbassyConfig): RawSourceItem | null {
  const title = document.title.trim();
  const url = canonicalUrl(document.url || source.url);
  if (!title || !url) return null;

  const textForDetection = [
    title,
    document.excerpt,
    document.text,
    source.name,
    source.defaultDetectedRegion,
  ]
    .filter(Boolean)
    .join(" ");

  const geography = detectGeography(textForDetection, config, {
    detectedCountry: source.defaultDetectedCountry,
    detectedRegion: source.defaultDetectedRegion,
    detectedCity: source.defaultDetectedCity,
  });

  return {
    id: createRawSourceItemId({
      url,
      title_original: title,
      source_name: source.name,
    }),
    source_type: toRawSourceType(source),
    title_original: title,
    url,
    source_name: source.name,
    source_country: source.country,
    source_language: source.language,
    published_at: sanitizePublishedAt(document.publishedAt, {
      allowFuture: source.type === "calendar",
    }),
    detected_country: geography.detectedCountry,
    detected_region: geography.detectedRegion,
    detected_city: geography.detectedCity,
    snippet: document.excerpt?.slice(0, 1200),
    raw_content: document.text?.slice(0, 50000),
    source_priority: Math.max(0, Math.min(100, sourcePriority(source))),
    credibility_score: Math.max(0, Math.min(100, source.credibilityScore ?? sourcePriority(source))),
    crawl_status: "fetched",
    created_at: nowIso(),
    updated_at: nowIso(),
  };
}

async function persistDiscoveredDocument(
  source: SourceDefinition,
  document: RawSourceDocument,
  config: EmbassyConfig,
) {
  const rawItem = toRawSourceItem(source, document, config);
  if (!rawItem) return { item: null as RawSourceItem | null, inserted: false, duplicate: true };

  const existingById = await getRawSourceItemById(rawItem.id);
  if (existingById) return { item: existingById, inserted: false, duplicate: true };

  const existingByUrl = await getRawSourceItemByUrl(rawItem.url);
  if (existingByUrl && rawItem.source_type !== "social") {
    return { item: existingByUrl, inserted: false, duplicate: true };
  }

  const stored = await upsertRawSourceItem(rawItem);
  return { item: stored, inserted: true, duplicate: false };
}

function candidateFromRaw(
  item: RawSourceItem,
  source: SourceDefinition,
  terms: string[],
  queryVariants: string[],
  fuzzyEnabledVariants: Set<string>,
): Candidate | null {
  const snippet = item.snippet ?? item.raw_content?.slice(0, 420);
  const match = findVariantMatch(
    item.title_original,
    snippet,
    item.raw_content,
    item.url,
    queryVariants,
    fuzzyEnabledVariants,
  );
  if (!match) {
    return null;
  }
  const score =
    scoreText(source, item.title_original, snippet, item.raw_content, terms) + publishedBonus(item.published_at);
  if (score <= 0) return null;

  const category = detectCategory(
    source,
    normalize([item.title_original, item.snippet, item.raw_content].filter(Boolean).join(" ")),
  );

  return {
    source,
    titleOriginal: item.title_original,
    snippetOriginal: snippet,
    url: item.url,
    publishedAt: item.published_at,
    retrievedAt: item.updated_at,
    category,
    sourceType: item.source_type,
    score: Math.max(1, Math.min(100, score)),
    detectedCountry: item.detected_country,
    detectedRegion: item.detected_region,
    detectedCity: item.detected_city,
    discovery: "local_cache",
    rawId: item.id,
    matchField: match.field,
    matchTerm: match.term,
    matchExcerpt: match.excerpt,
  };
}

async function localSearchCandidates(
  queryVariants: string[],
  config: EmbassyConfig,
  limit: number,
) {
  const activeSources = await getSources();
  const sourceByName = new Map(activeSources.map((source) => [source.name, source]));
  const terms = splitTerms(queryVariants);
  const fuzzyEnabledVariants = new Set(
    normalize(queryVariants[0] ?? "")
      .split(" ")
      .filter((term) => term.length >= 4),
  );
  const rawItems = await listRawSourceItems({ limit: LOCAL_SCAN_LIMIT });
  const candidates: Candidate[] = [];
  const notes: string[] = [];

  for (const raw of rawItems) {
    const source =
      sourceByName.get(raw.source_name) ??
      ({
        id: `shadow-${raw.source_name}`,
        name: raw.source_name,
        country: raw.source_country,
        language: raw.source_language,
        type: "website",
        url: raw.url,
        trustTier: 2,
        categories: ["society"],
        enabled: true,
      } satisfies SourceDefinition);
    const candidate = candidateFromRaw(raw, source, terms, queryVariants, fuzzyEnabledVariants);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) {
    notes.push("Inga lokala signaler innehöll sökordet eller dess språkliga varianter.");
  }

  const all = [...candidates];
  const seen = new Set<string>();
  const deduped = all
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      const key = `${canonicalUrl(candidate.url)}|${normalize(candidate.titleOriginal).slice(0, 120)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);

  return { candidates: deduped, sourceCount: activeSources.filter((source) => source.enabled).length, notes };
}

function shouldFallbackToWebsite(rssMatches: number, docsFetched: number) {
  return rssMatches < 2 || docsFetched < 4;
}

async function deepSearchCandidates(
  queryVariants: string[],
  config: EmbassyConfig,
  options: DeepSearchOptions,
  limit: number,
) {
  const terms = splitTerms(queryVariants);
  const fuzzyEnabledVariants = new Set(
    normalize(queryVariants[0] ?? "")
      .split(" ")
      .filter((term) => term.length >= 4),
  );
  const activeSources = (await getSources()).filter((source) => source.enabled);
  const socialXSources = options.includeSocialX
    ? activeSources.filter(
        (source) => retrievalPrimary(source) === "social_api" && isSocialXSource(source),
      )
    : [];
  const nonSocialSources = activeSources.filter(
    (source) => !(retrievalPrimary(source) === "social_api" && isSocialXSource(source)),
  );
  const boundedSources = [...nonSocialSources, ...socialXSources];
  const stats: DeepSearchStats = {
    sourcesScanned: 0,
    rssHits: 0,
    websiteFallbackActivations: 0,
    xAccountsQueried: 0,
    xPostsFetched: 0,
    newUrlsDiscovered: 0,
    duplicatesSkipped: 0,
    aiCandidatesProcessed: 0,
    estimatedTokenUsage: 0,
    estimatedApiReads: 0,
  };
  const errors: Array<{ source: string; message: string }> = [];
  const notes: string[] = [];
  const candidates: Candidate[] = [];

  for (const source of boundedSources) {
    const primary = retrievalPrimary(source);
    stats.sourcesScanned += 1;

    try {
      if (primary === "social_api") {
        if (!options.includeSocialX || !isSocialXSource(source)) continue;
        stats.xAccountsQueried += 1;
        const docs = await fetchSocialSource(source, {
          limit: Math.min(MAX_SOCIAL_POSTS_PER_ACCOUNT, source.maxItemsPerRun ?? MAX_SOCIAL_POSTS_PER_ACCOUNT),
          preserveRawContent: false,
        });
        stats.estimatedApiReads += docs.length;
        stats.xPostsFetched += docs.length;

        for (const doc of docs) {
          const persisted = await persistDiscoveredDocument(source, doc, config);
          if (persisted.duplicate) stats.duplicatesSkipped += 1;
          if (persisted.inserted) stats.newUrlsDiscovered += 1;
          const raw = persisted.item;
          if (!raw) continue;
          const candidate = candidateFromRaw(raw, source, terms, queryVariants, fuzzyEnabledVariants);
          if (candidate) {
            candidate.discovery = persisted.inserted ? "deep_discovery" : "local_cache";
            candidates.push(candidate);
          }
        }
        continue;
      }

      if (!options.includeWebRss) continue;

      if (primary === "rss") {
        const rssDocs = await fetchRssSource(source, {
          limit: Math.min(MAX_RSS_ITEMS_PER_SOURCE, source.maxItemsPerRun ?? MAX_RSS_ITEMS_PER_SOURCE),
          preserveRawContent: false,
        });
        let rssMatches = 0;
        for (const doc of rssDocs) {
          const persisted = await persistDiscoveredDocument(source, doc, config);
          if (persisted.duplicate) stats.duplicatesSkipped += 1;
          if (persisted.inserted) stats.newUrlsDiscovered += 1;
          const raw = persisted.item;
          if (!raw) continue;
          const candidate = candidateFromRaw(raw, source, terms, queryVariants, fuzzyEnabledVariants);
          if (candidate) {
            rssMatches += 1;
            candidate.discovery = persisted.inserted ? "deep_discovery" : "local_cache";
            candidates.push(candidate);
          }
        }
        stats.rssHits += rssMatches;

        const fallback = retrievalFallback(source);
        if (fallback === "website" && shouldFallbackToWebsite(rssMatches, rssDocs.length)) {
          stats.websiteFallbackActivations += 1;
          const websiteResult = await fetchWebsiteSource(source, {
            limit: Math.min(MAX_WEBSITE_ITEMS_PER_SOURCE, source.maxItemsPerRun ?? MAX_WEBSITE_ITEMS_PER_SOURCE),
            preserveRawContent: false,
            isKnownUrl: async (url) => Boolean(await getRawSourceItemByUrl(canonicalUrl(url))),
          });
          for (const doc of websiteResult.documents) {
            const persisted = await persistDiscoveredDocument(source, doc, config);
            if (persisted.duplicate) stats.duplicatesSkipped += 1;
            if (persisted.inserted) stats.newUrlsDiscovered += 1;
            const raw = persisted.item;
            if (!raw) continue;
            const candidate = candidateFromRaw(raw, source, terms, queryVariants, fuzzyEnabledVariants);
            if (candidate) {
              candidate.discovery = persisted.inserted ? "deep_discovery" : "local_cache";
              candidates.push(candidate);
            }
          }
          for (const error of websiteResult.errors) {
            errors.push({ source: source.name, message: error.message });
          }
        }
        continue;
      }

      if (primary === "website") {
        const websiteResult = await fetchWebsiteSource(source, {
          limit: Math.min(MAX_WEBSITE_ITEMS_PER_SOURCE, source.maxItemsPerRun ?? MAX_WEBSITE_ITEMS_PER_SOURCE),
          preserveRawContent: false,
          isKnownUrl: async (url) => Boolean(await getRawSourceItemByUrl(canonicalUrl(url))),
        });
        for (const doc of websiteResult.documents) {
          const persisted = await persistDiscoveredDocument(source, doc, config);
          if (persisted.duplicate) stats.duplicatesSkipped += 1;
          if (persisted.inserted) stats.newUrlsDiscovered += 1;
          const raw = persisted.item;
          if (!raw) continue;
          const candidate = candidateFromRaw(raw, source, terms, queryVariants, fuzzyEnabledVariants);
          if (candidate) {
            candidate.discovery = persisted.inserted ? "deep_discovery" : "local_cache";
            candidates.push(candidate);
          }
        }
        for (const error of websiteResult.errors) {
          errors.push({ source: source.name, message: error.message });
        }
      }
    } catch (error) {
      errors.push({
        source: source.name,
        message: error instanceof Error ? error.message : "Utökad sökning misslyckades",
      });
    }
  }

  if (stats.websiteFallbackActivations > 0) {
    notes.push("RSS gav få träffar – webbkälla kontrollerades.");
  }
  if (stats.xAccountsQueried > 0) {
    notes.push("Senaste X-poster hämtades från bevakade konton.");
  }

  const seen = new Set<string>();
  const deduped = candidates
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      const key = `${canonicalUrl(candidate.url)}|${normalize(candidate.titleOriginal).slice(0, 120)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);

  return {
    candidates: deduped,
    sourceCount: activeSources.length,
    scannedSourceCount: boundedSources.length,
    stats,
    errors,
    notes,
  };
}

async function translateCandidates(
  candidates: Candidate[],
  aiEnabled: boolean,
): Promise<{ translatedCount: number; model?: string; items: TranslationItem[] }> {
  if (!aiEnabled || !isOpenAiConfigured()) {
    return {
      translatedCount: 0,
      model: undefined,
      items: candidates.map((candidate) => ({
        titleSv: candidate.titleOriginal,
        snippetSv: undefined,
        ai: false,
      })),
    };
  }

  const model = queryExpansionModel();
  const apiKey = process.env.OPENAI_API_KEY!;
  if (candidates.length === 0) {
    return { translatedCount: 0, model: undefined, items: [] };
  }
  const topCandidates = candidates.slice(0, Math.min(AI_CANDIDATE_LIMIT, candidates.length));
  const fallbackItems: TranslationItem[] = candidates.map((candidate) => ({
    titleSv: candidate.titleOriginal,
    snippetSv: undefined,
    ai: false,
  }));
  const translatedItems = [...fallbackItems];
  const translatedIndexes = new Set<number>();

  for (let offset = 0; offset < topCandidates.length; offset += AI_CANDIDATE_LIMIT) {
    const chunk = topCandidates.slice(offset, offset + AI_CANDIDATE_LIMIT);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content:
              "Översätt rubrik och eventuell kort snippet till saklig, kort svenska. Skriv idiomatisk svensk nyhetssvenska: översätt betydelse, inte ord för ord, och lämna inte engelska fraser kvar i svenska rubriker. Använd EU eller Europeiska unionen, inte Europeiska Unionen; skriv Mexiko på svenska och använd Mexiko-EU eller Mexiko och EU i rubriker. Använd svensk stavning i användartext: skriv fentanyl, inte fentanil. Översätt joint declaration/declaración conjunta som gemensam deklaration eller gemensamt uttalande beroende på källans innebörd; använd inte kumulativ deklaration. Skriv Mexiko och EU som aktörer; skriv inte länderna i Mexiko om underlaget avser Mexiko som land. Returnera endast JSON-array med {index,title_sv,snippet_sv}.",
          },
          {
            role: "user",
            content: JSON.stringify(
              chunk.map((candidate, index) => ({
                index,
                title: candidate.titleOriginal,
                snippet: candidate.snippetOriginal ?? null,
                language: candidate.source.language,
              })),
            ),
          },
        ],
        max_output_tokens: Math.min(3200, Math.max(300, chunk.length * 90)),
        temperature: 0,
      }),
    });

    if (!response.ok) {
      continue;
    }

    const payload = (await response.json()) as ResponsesApiResult;
    const output = extractResponseText(payload);
    const jsonText = output.match(/\[[\s\S]*\]/)?.[0] ?? output;

    try {
      const parsed = JSON.parse(jsonText) as Array<{
        index?: number;
        title_sv?: string;
        snippet_sv?: string;
      }>;
      for (const row of parsed) {
        if (typeof row.index !== "number") continue;
        if (!row.title_sv) continue;
        if (row.index < 0 || row.index >= chunk.length) continue;
        const targetIndex = offset + row.index;
        translatedItems[targetIndex] = {
          titleSv: normalizeSwedishUserFacingText(row.title_sv).slice(0, 260),
          snippetSv: row.snippet_sv
            ? normalizeSwedishUserFacingText(row.snippet_sv).slice(0, 420)
            : undefined,
          ai: true,
        };
        translatedIndexes.add(targetIndex);
      }
    } catch {
      continue;
    }
  }

  return {
    translatedCount: translatedIndexes.size,
    model,
    items: translatedItems,
  };
}

export async function searchSignalsAcrossSources({
  query,
  config = swedenMexicoEmbassyConfig,
  mode = "local",
  aiEnabled = false,
  deepSearchOptions = { includeWebRss: true, includeSocialX: false },
  limit,
}: SearchOptions): Promise<SignalTrackingSearchResult> {
  const searchedAt = nowIso();
  const deepSearchUsed = mode === "deep";
  const baseLimit = deepSearchUsed ? DEFAULT_DEEP_RESULT_LIMIT : DEFAULT_LOCAL_RESULT_LIMIT;
  const resultLimit = Math.max(1, Math.min(120, limit ?? baseLimit));
  const errors: Array<{ source: string; message: string }> = [];
  const notes: string[] = [];

  const { variants, model: expansionModel } = await getQueryVariants(query);
  const local = await localSearchCandidates(variants, config, resultLimit);
  notes.push(...local.notes);

  let candidates = local.candidates;
  let scannedSourceCount = 0;
  let fetchedCount = 0;
  let deepStats: DeepSearchStats = {
    sourcesScanned: 0,
    rssHits: 0,
    websiteFallbackActivations: 0,
    xAccountsQueried: 0,
    xPostsFetched: 0,
    newUrlsDiscovered: 0,
    duplicatesSkipped: 0,
    aiCandidatesProcessed: 0,
    estimatedTokenUsage: 0,
    estimatedApiReads: 0,
  };

  if (deepSearchUsed) {
    const deep = await deepSearchCandidates(variants, config, deepSearchOptions, resultLimit * 2);
    candidates = [...candidates, ...deep.candidates];
    scannedSourceCount = deep.scannedSourceCount;
    deepStats = deep.stats;
    errors.push(...deep.errors);
    notes.push(...deep.notes);
    fetchedCount = deep.stats.newUrlsDiscovered + deep.stats.duplicatesSkipped + deep.stats.xPostsFetched;
  }

  const seen = new Set<string>();
  const finalCandidates = candidates
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      const key = `${canonicalUrl(candidate.url)}|${normalize(candidate.titleOriginal).slice(0, 140)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, resultLimit);

  const translations = await translateCandidates(finalCandidates, aiEnabled);
  deepStats.aiCandidatesProcessed = aiEnabled ? Math.min(AI_CANDIDATE_LIMIT, finalCandidates.length) : 0;
  deepStats.estimatedTokenUsage = aiEnabled ? deepStats.aiCandidatesProcessed * 85 : 0;

  const processedByRawId = new Map<string, Awaited<ReturnType<typeof getProcessedItemByRawId>>>();
  await Promise.all(
    finalCandidates.map(async (candidate) => {
      if (!candidate.rawId || processedByRawId.has(candidate.rawId)) return;
      const processed = await getProcessedItemByRawId(candidate.rawId);
      processedByRawId.set(candidate.rawId, processed);
    }),
  );

  const results: SignalTrackingResult[] = finalCandidates.map((candidate, index) => {
    const processed = candidate.rawId ? processedByRawId.get(candidate.rawId) ?? null : null;
    const processedSummary = processed?.summary_sv
      ? normalizeSwedishUserFacingText(processed.summary_sv)
      : undefined;
    const translatedSnippet = translations.items[index]?.snippetSv
      ? normalizeSwedishUserFacingText(translations.items[index]!.snippetSv!)
      : undefined;
    const fallbackSnippet =
      candidate.source.language.toLowerCase().startsWith("sv") && candidate.snippetOriginal
        ? normalizeSwedishUserFacingText(candidate.snippetOriginal)
        : undefined;
    const snippetSv = [processedSummary, translatedSnippet, fallbackSnippet].find(
      (value) => value && !looksLikeForeignSummaryInSwedishField(value),
    );

    return {
    id: `${candidate.source.id}:${canonicalUrl(candidate.url)}:${index}`,
    title_original: candidate.titleOriginal,
    title_sv:
      processed?.title_sv
        ? normalizeSwedishUserFacingText(processed.title_sv)
        : translations.items[index]?.titleSv ?? candidate.titleOriginal,
    snippet_original: candidate.snippetOriginal,
    snippet_sv: snippetSv,
    url: canonicalUrl(candidate.url),
    source_name: candidate.source.name,
    source_country: candidate.source.country,
    source_language: candidate.source.language,
    published_at: candidate.publishedAt,
    retrieved_at: candidate.retrievedAt,
    category: candidate.category,
    source_type: candidate.sourceType,
    detected_country: candidate.detectedCountry,
    detected_region: candidate.detectedRegion,
    detected_city: candidate.detectedCity,
    relevance_score: candidate.score,
    discovery: candidate.discovery,
    ai_enriched: processed ? false : (translations.items[index]?.ai ?? false),
    match_field: candidate.matchField,
    match_term: candidate.matchTerm,
    match_excerpt: candidate.matchExcerpt,
    };
  });

  return {
    query,
    mode,
    aiEnabled,
    searchedAt,
    queryVariants: variants,
    sourceCount: local.sourceCount,
    scannedSourceCount: deepSearchUsed ? scannedSourceCount : 0,
    fetchedCount,
    resultCount: results.length,
    translatedCount: translations.translatedCount,
    translationModel: translations.model ?? expansionModel,
    deepSearchUsed,
    notes,
    report: {
      sourcesScanned: deepStats.sourcesScanned,
      rssHits: deepStats.rssHits,
      websiteFallbackActivations: deepStats.websiteFallbackActivations,
      xAccountsQueried: deepStats.xAccountsQueried,
      xPostsFetched: deepStats.xPostsFetched,
      newUrlsDiscovered: deepStats.newUrlsDiscovered,
      duplicatesSkipped: deepStats.duplicatesSkipped,
      aiCandidatesProcessed: deepStats.aiCandidatesProcessed,
      estimatedTokenUsage: deepStats.estimatedTokenUsage,
      estimatedApiReads: deepStats.estimatedApiReads,
    },
    results,
    errors,
  };
}
