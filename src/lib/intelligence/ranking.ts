import { createHash } from "node:crypto";
import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import {
  enqueueBackgroundJob,
  listProcessedItems,
  listRawSourceItems,
  upsertDuplicateCluster,
  upsertRankedCandidate,
} from "@/lib/intelligence/repository";
import {
  compactSwedenMexicoReason,
  detectSwedenMexicoRelevance,
  type SwedenMexicoRelevanceSignal,
} from "@/lib/intelligence/sweden-relevance";
import type {
  CandidateSelectionStatus,
  NewRankedProcessingCandidate,
  RawSourceItem,
  RankedCandidateRecord,
} from "@/lib/intelligence/models";
import type { EmbassyConfig, IntelligenceCategory } from "@/lib/types";

export const rankingVersion = "missiondesk-lightweight-ranker-v1";

export interface CandidateRankingOptions {
  config?: EmbassyConfig;
  since?: string;
  scanLimit?: number;
  targetMin?: number;
  targetMax?: number;
  hardCap?: number;
  nationalOnly?: boolean;
  allowRegionalAi?: boolean;
  enqueueAiJobs?: boolean;
  minSelectedScore?: number;
  minCandidateScore?: number;
  rawSourceItemIds?: string[];
}

export interface CandidateRankingRunResult {
  rankedAt: string;
  scannedCount: number;
  clusterCount: number;
  selectedCount: number;
  candidateCount: number;
  deferredCount: number;
  rejectedCount: number;
  regionalHoldCount: number;
  candidates: NewRankedProcessingCandidate[];
}

interface RankedDraft {
  item: RawSourceItem;
  clusterId: string;
  duplicateOfRawSourceItemId?: string;
  duplicateRawSourceItemIds: string[];
  duplicateStrategy: string;
  sourceCount: number;
  titleFingerprint: string;
  urlFingerprint: string;
  swedenMexicoSignal: SwedenMexicoRelevanceSignal;
  scores: Omit<
    NewRankedProcessingCandidate,
    | "raw_source_item_id"
    | "selection_status"
    | "selection_reason"
    | "duplicate_cluster_id"
    | "duplicate_of_raw_source_item_id"
    | "embedding_similarity_hook"
    | "ranking_version"
    | "ranked_at"
  >;
}

const diplomaticTerms = [
  "president",
  "presidenta",
  "gobierno",
  "congreso",
  "senado",
  "secretaria",
  "ministerio",
  "canciller",
  "embajada",
  "diplomatic",
  "diplomat",
  "tratado",
  "acuerdo",
  "bilateral",
  "europa",
  "union europea",
  "ue",
  "onu",
  "oas",
  "ocde",
  "imf",
  "fmi",
  "world bank",
  "banco mundial",
  "usmca",
  "tmec",
  "consulado",
  "consular",
  "visa",
  "migrantes",
  "refugiados",
  "albergue",
];

const swedenTerms = [
  "suecia",
  "sweden",
  "sueco",
  "sueca",
  "suecos",
  "suecas",
  "embajada de suecia",
  "sweden abroad",
  "business sweden",
  "riksbanken",
  "regeringen",
  "volvo",
  "ericsson",
  "ikea",
  "saab",
  "atlas copco",
  "tetra pak",
  "scania",
  "sandvik",
  "abb",
];

const strategicKeywords = [
  "seguridad",
  "violencia",
  "homicidio",
  "crimen",
  "cartel",
  "guardia nacional",
  "migracion",
  "frontera",
  "asilo",
  "deportacion",
  "economia",
  "inflacion",
  "banxico",
  "peso",
  "tasa",
  "mercado",
  "inversion",
  "nearshoring",
  "comercio",
  "exportacion",
  "importacion",
  "energia",
  "pemex",
  "cfe",
  "reforma",
  "eleccion",
  "corte",
  "regulacion",
  "aduana",
  "arancel",
  "supply chain",
  "semiconductor",
  "cyber",
  "ciber",
  "agua",
  "protesta",
  "migrantes",
  "refugiados",
  "visa",
  "albergue",
  "consulado",
  "consular",
  "aduanas",
  "puerto",
  "fiscalia",
];

const categoryTerms: Record<IntelligenceCategory, string[]> = {
  economy: ["economia", "inflacion", "pib", "hacienda", "fiscal", "crecimiento"],
  trade: ["comercio", "export", "import", "tmec", "usmca", "aduana", "arancel"],
  domestic_politics: ["gobierno", "congreso", "senado", "morena", "eleccion", "reforma"],
  foreign_policy: ["sre", "canciller", "diplomatic", "bilateral", "europa", "eeuu"],
  sweden_connection: swedenTerms,
  security: ["seguridad", "violencia", "crimen", "homicidio", "cartel", "guardia"],
  markets: ["banxico", "peso", "dolar", "mercado", "bolsa", "tasa"],
  investment_climate: ["inversion", "nearshoring", "empresa", "planta", "industria"],
  migration: [
    "migracion",
    "migrantes",
    "frontera",
    "asilo",
    "refugio",
    "refugiados",
    "deportacion",
    "visa",
    "inm",
    "albergue",
    "caravana",
    "retorno",
  ],
  society: ["sociedad", "salud", "educacion", "protesta", "agua", "derechos"],
  energy: ["energia", "pemex", "cfe", "electricidad", "petroleo", "gas"],
  technology: ["tecnologia", "digital", "ciber", "semiconductor", "datos", "ia"],
  culture_soft_power: ["cultura", "festival", "universidad", "academia", "cine"],
};

const noiseTerms = [
  "horoscopo",
  "receta",
  "famoso",
  "celebridad",
  "deporte",
  "futbol",
  "beisbol",
  "streaming",
  "netflix",
  "tiktok",
  "loteria",
  "viral",
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s./:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const textForItem = (item: RawSourceItem) =>
  normalize([item.title_original, item.snippet, item.raw_content].filter(Boolean).join(" "));

function canonicalUrlFingerprint(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (
        key.toLowerCase().startsWith("utm_") ||
        ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())
      ) {
        parsed.searchParams.delete(key);
      }
    }
    return normalize(`${parsed.hostname}${parsed.pathname}${parsed.search}`);
  } catch {
    return normalize(url);
  }
}

function titleFingerprint(title: string) {
  const stopwords = new Set([
    "el",
    "la",
    "los",
    "las",
    "de",
    "del",
    "en",
    "y",
    "a",
    "the",
    "of",
    "for",
    "to",
    "in",
    "on",
    "with",
    "mexico",
    "mexico:",
  ]);

  return normalize(title)
    .split(" ")
    .filter((token) => token.length > 2 && !stopwords.has(token))
    .slice(0, 14)
    .join(" ");
}

function jaccardSimilarity(a: string, b: string) {
  const aTokens = new Set(a.split(" ").filter(Boolean));
  const bTokens = new Set(b.split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;

  const intersection = [...aTokens].filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  return intersection / union;
}

function termScore(text: string, terms: string[], maxScore = 100) {
  const hits = terms.filter((term) => text.includes(normalize(term))).length;
  if (hits === 0) return 0;
  return clampScore(Math.min(maxScore, 28 + hits * 16));
}

function freshnessScore(item: RawSourceItem, now: Date) {
  if (!item.published_at) return 8;
  const value = item.published_at;
  const ageHours = Math.max(0, (now.getTime() - new Date(value).getTime()) / 36e5);
  if (ageHours <= 6) return 100;
  if (ageHours <= 24) return 88;
  if (ageHours <= 48) return 72;
  if (ageHours <= 96) return 52;
  if (ageHours <= 168) return 32;
  return 12;
}

function stalenessPenalty(item: RawSourceItem, now: Date) {
  if (!item.published_at) return 18;
  const ageDays = Math.max(0, (now.getTime() - new Date(item.published_at).getTime()) / 864e5);
  if (ageDays > 365) return 55;
  if (ageDays > 90) return 42;
  if (ageDays > 30) return 25;
  return 0;
}

function selectionWindowForScanLimit(scanLimit?: number) {
  const scanned = Math.max(200, Math.min(500, scanLimit ?? 500));
  const targetMin = Math.max(25, Math.min(40, Math.round(scanned / 16)));
  const targetMax = Math.max(targetMin, Math.min(60, Math.round(scanned / 10)));
  const hardCap = Math.max(targetMax, Math.min(100, Math.round(scanned / 5)));

  return {
    targetMin,
    targetMax,
    hardCap,
  };
}

function geographicRelevanceScore(item: RawSourceItem, config: EmbassyConfig) {
  if (item.detected_region) {
    const priority = config.geography.priorityDivisionIds.includes(item.detected_region);
    return priority ? 90 : 72;
  }
  if (item.detected_city) return 78;
  if (item.detected_country === config.country) return 68;
  if (item.source_country === "Mexiko") return 58;
  return 34;
}

function categoryRelevanceScore(text: string, item: RawSourceItem, config: EmbassyConfig) {
  const categoryScores = config.priorityThemes.map((category) =>
    termScore(text, categoryTerms[category] ?? [], 100),
  );
  const best = Math.max(0, ...categoryScores);
  const typeBoost = ["government", "institution", "advisory", "report", "event"].includes(
    item.source_type,
  )
    ? 12
    : 0;

  return clampScore(best + typeBoost);
}

function diplomaticRelevanceScore(text: string, item: RawSourceItem) {
  const sourceBoost = ["government", "institution", "advisory", "report"].includes(item.source_type)
    ? 22
    : 0;
  return clampScore(termScore(text, diplomaticTerms, 88) + sourceBoost);
}

function noveltyScore(
  item: RawSourceItem,
  titleFp: string,
  processedTitleFingerprints: Set<string>,
  processedUrlFingerprints: Set<string>,
) {
  if (processedTitleFingerprints.has(titleFp)) return 14;
  if (processedUrlFingerprints.has(canonicalUrlFingerprint(item.url))) return 10;
  if (item.source_type === "social") return 54;
  return 76;
}

function buildDuplicateClusters(items: RawSourceItem[]) {
  const clusters: RawSourceItem[][] = [];

  for (const item of items) {
    const urlFp = canonicalUrlFingerprint(item.url);
    const titleFp = titleFingerprint(item.title_original);
    const existing = clusters.find((cluster) => {
      const canonical = cluster[0];
      const sameUrl = canonicalUrlFingerprint(canonical.url) === urlFp;
      const similarTitle =
        jaccardSimilarity(titleFingerprint(canonical.title_original), titleFp) >= 0.82;

      return sameUrl || similarTitle;
    });

    if (existing) {
      existing.push(item);
    } else {
      clusters.push([item]);
    }
  }

  return clusters;
}

function pickCanonicalItem(cluster: RawSourceItem[]) {
  return [...cluster].sort((a, b) => {
    const sourceScore =
      b.source_priority + b.credibility_score - (a.source_priority + a.credibility_score);
    if (sourceScore !== 0) return sourceScore;
    return (
      new Date(b.published_at ?? b.created_at).getTime() -
      new Date(a.published_at ?? a.created_at).getTime()
    );
  })[0];
}

function selectionStatus(
  draft: RankedDraft,
  index: number,
  options: Required<
    Pick<
      CandidateRankingOptions,
      | "targetMin"
      | "targetMax"
      | "hardCap"
      | "nationalOnly"
      | "allowRegionalAi"
      | "minSelectedScore"
      | "minCandidateScore"
    >
  >,
): CandidateSelectionStatus {
  if (draft.duplicateOfRawSourceItemId) return "rejected";
  if (draft.scores.rank_score < options.minCandidateScore) return "rejected";
  if (
    draft.scores.rank_score >= options.minSelectedScore &&
    index < Math.min(options.targetMax, options.hardCap)
  ) {
    return "selected";
  }
  if (index < options.hardCap) return "candidate";
  return "deferred";
}

function selectionReason(draft: RankedDraft, status: CandidateSelectionStatus) {
  const reasons = [
    `rank=${draft.scores.rank_score}`,
    `fresh=${draft.scores.freshness_score}`,
    `source=${draft.scores.source_priority_score}`,
    `cred=${draft.scores.credibility_score}`,
    `dip=${draft.scores.diplomatic_relevance_score}`,
    `swe=${draft.scores.sweden_relevance_score}`,
    `geo=${draft.scores.geographic_relevance_score}`,
    `novel=${draft.scores.novelty_score}`,
    `xsrc=${draft.scores.cross_source_confirmation_score}`,
  ];

  if (draft.duplicateOfRawSourceItemId) {
    reasons.push(`duplicate_of=${draft.duplicateOfRawSourceItemId}`);
  }

  if (status === "regional_hold") {
    reasons.push("regional_state_item_held_for_on_demand_processing");
  }

  const signalReason = compactSwedenMexicoReason(draft.swedenMexicoSignal);
  if (signalReason) {
    reasons.push(signalReason);
  }

  return reasons.join("; ");
}

export function rankRawSourceItems(
  items: RawSourceItem[],
  processedItems: RawSourceItem[] = [],
  options: CandidateRankingOptions = {},
): NewRankedProcessingCandidate[] {
  const config = options.config ?? swedenMexicoEmbassyConfig;
  const now = new Date();
  const defaults = selectionWindowForScanLimit(options.scanLimit);
  const processedTitleFingerprints = new Set(
    processedItems.map((item) => titleFingerprint(item.title_original)),
  );
  const processedUrlFingerprints = new Set(
    processedItems.map((item) => canonicalUrlFingerprint(item.url)),
  );
  const clusters = buildDuplicateClusters(items);
  const drafts: RankedDraft[] = [];

  for (const cluster of clusters) {
    const canonical = pickCanonicalItem(cluster);
    const duplicateIds = cluster
      .filter((item) => item.id !== canonical.id)
      .map((item) => item.id);
    const sourceCount = new Set(cluster.map((item) => item.source_name)).size;
    const canonicalTitleFp = titleFingerprint(canonical.title_original);
    const canonicalUrlFp = canonicalUrlFingerprint(canonical.url);
    const clusterId = hash(`${canonicalUrlFp}:${canonicalTitleFp}`);

    for (const item of cluster) {
      const text = textForItem(item);
      const swedenMexicoSignal = detectSwedenMexicoRelevance(item);
      const noisePenalty = termScore(text, noiseTerms, 70);
      const baseKeyword = termScore(text, strategicKeywords, 100);
      const diplomatic = diplomaticRelevanceScore(text, item);
      const sweden = Math.max(termScore(text, swedenTerms, 100), swedenMexicoSignal.swedenRelevanceScore);
      const geography = geographicRelevanceScore(item, config);
      const keyword = clampScore(
        Math.max(baseKeyword, baseKeyword + swedenMexicoSignal.crossRegionalScore * 0.35),
      );
      const category = clampScore(
        Math.max(
          categoryRelevanceScore(text, item, config),
          swedenMexicoSignal.swedenRelevanceScore >= 50 ? 58 : 0,
          swedenMexicoSignal.crossRegionalScore >= 50 ? 62 : 0,
        ),
      );
      const novelty = noveltyScore(
        item,
        titleFingerprint(item.title_original),
        processedTitleFingerprints,
        processedUrlFingerprints,
      );
      const crossSource = sourceCount > 1 ? clampScore(48 + sourceCount * 16) : 22;
      const fresh = freshnessScore(item, now);
      const stalePenalty = stalenessPenalty(item, now);
      const source = item.source_priority;
      const credibility = item.credibility_score;
      const duplicateOfRawSourceItemId = item.id === canonical.id ? undefined : canonical.id;
      const duplicatePenalty = duplicateOfRawSourceItemId ? 44 : 0;

      const rank = clampScore(
        fresh * 0.12 +
          source * 0.13 +
          credibility * 0.11 +
          keyword * 0.14 +
          diplomatic * 0.16 +
          sweden * 0.11 +
          geography * 0.09 +
          category * 0.08 +
          novelty * 0.08 +
          swedenMexicoSignal.crossRegionalScore * 0.08 +
          crossSource * 0.08 -
          noisePenalty * 0.22 -
          stalePenalty -
          duplicatePenalty,
      );

      drafts.push({
        item,
        clusterId,
        duplicateOfRawSourceItemId,
        duplicateRawSourceItemIds: duplicateIds,
        duplicateStrategy: duplicateIds.length > 0 ? "url_or_title_similarity" : "singleton",
        sourceCount,
        titleFingerprint: canonicalTitleFp,
        urlFingerprint: canonicalUrlFp,
        swedenMexicoSignal,
        scores: {
          rank_score: rank,
          freshness_score: fresh,
          source_priority_score: source,
          credibility_score: credibility,
          keyword_relevance_score: keyword,
          diplomatic_relevance_score: diplomatic,
          sweden_relevance_score: sweden,
          geographic_relevance_score: geography,
          category_relevance_score: category,
          novelty_score: novelty,
          cross_source_confirmation_score: crossSource,
        },
      });

      if (
        process.env.MISSIONDESK_DEBUG_RELEVANCE === "1" &&
        (swedenMexicoSignal.swedenRelevanceScore > 0 || swedenMexicoSignal.crossRegionalScore > 0)
      ) {
        console.info("[MissionDesk relevance] ranked signal", {
          title: item.title_original,
          source: item.source_name,
          swedishEntities: swedenMexicoSignal.swedishEntities,
          mexicanEntities: swedenMexicoSignal.mexicanEntities,
          sectors: swedenMexicoSignal.strategicSectors,
          regionalSignals: swedenMexicoSignal.regionalSignals,
          swedenScore: swedenMexicoSignal.swedenRelevanceScore,
          crossRegionalScore: swedenMexicoSignal.crossRegionalScore,
          reasons: swedenMexicoSignal.reasons,
          caps: swedenMexicoSignal.falsePositiveFlags,
        });
      }
    }
  }

  return drafts
    .sort((a, b) => b.scores.rank_score - a.scores.rank_score)
    .map((draft, index) => {
      const status = selectionStatus(draft, index, {
        targetMin: options.targetMin ?? defaults.targetMin,
        targetMax: options.targetMax ?? defaults.targetMax,
        hardCap: options.hardCap ?? defaults.hardCap,
        nationalOnly: options.nationalOnly ?? false,
        allowRegionalAi: options.allowRegionalAi ?? false,
        minSelectedScore: options.minSelectedScore ?? 58,
        minCandidateScore: options.minCandidateScore ?? 50,
      });

      return {
        raw_source_item_id: draft.item.id,
        ...draft.scores,
        selection_status: status,
        selection_reason: selectionReason(draft, status),
        duplicate_cluster_id: draft.clusterId,
        duplicate_of_raw_source_item_id: draft.duplicateOfRawSourceItemId,
        embedding_similarity_hook: JSON.stringify({
          planned: true,
          strategy: "future_embedding_cluster",
          titleFingerprint: draft.titleFingerprint,
          urlFingerprint: draft.urlFingerprint,
          sourceCount: draft.sourceCount,
        }),
        ranking_version: rankingVersion,
        ranked_at: now.toISOString(),
      };
    });
}

export async function rankAndStoreCandidates(
  options: CandidateRankingOptions = {},
): Promise<CandidateRankingRunResult> {
  const rawItems = await listRawSourceItems({
    ids: options.rawSourceItemIds,
    since: options.since,
    excludeFreshProcessed: true,
    limit: options.scanLimit ?? 500,
  });
  const processedRawItems = (await listProcessedItems({
    limit: 250,
    onlyFresh: false,
  })).map((record) => record.raw);
  const ranked = rankRawSourceItems(rawItems, processedRawItems, options);
  const clusters = new Map<string, NewRankedProcessingCandidate[]>();

  for (const candidate of ranked) {
    if (!candidate.duplicate_cluster_id) continue;
    const items = clusters.get(candidate.duplicate_cluster_id) ?? [];
    items.push(candidate);
    clusters.set(candidate.duplicate_cluster_id, items);
  }

  for (const [clusterId, candidates] of clusters) {
    const canonical =
      candidates.find((candidate) => !candidate.duplicate_of_raw_source_item_id) ?? candidates[0];
    const raw = rawItems.find((item) => item.id === canonical.raw_source_item_id);

    await upsertDuplicateCluster({
      id: clusterId,
      canonical_raw_source_item_id:
        canonical.duplicate_of_raw_source_item_id ?? canonical.raw_source_item_id,
      duplicate_raw_source_item_ids: candidates
        .map((candidate) => candidate.raw_source_item_id)
        .filter((id) => id !== canonical.raw_source_item_id),
      duplicate_strategy: candidates.length > 1 ? "url_or_title_similarity" : "singleton",
      title_fingerprint: raw ? titleFingerprint(raw.title_original) : undefined,
      url_fingerprint: raw ? canonicalUrlFingerprint(raw.url) : undefined,
      embedding_cluster_id: undefined,
      source_count: new Set(
        candidates
          .map((candidate) => rawItems.find((item) => item.id === candidate.raw_source_item_id))
          .filter(Boolean)
          .map((item) => item!.source_name),
      ).size,
    });
  }

 const stored: Awaited<ReturnType<typeof upsertRankedCandidate>>[] = [];

for (const candidate of ranked.slice(0, options.hardCap ?? 100)) {
  try {
    stored.push(await upsertRankedCandidate(candidate));
  } catch (error) {
    console.error("[MissionDesk ranking] failed to store candidate", {
      rawSourceItemId: candidate.raw_source_item_id,
      error,
    });
  }
}

  if (options.enqueueAiJobs) {
    await Promise.all(stored
      .filter((candidate) => candidate.selection_status === "selected")
      .map((candidate) =>
        enqueueBackgroundJob({
          type: "process_ranked_candidate",
          priority: candidate.rank_score,
          payload: {
            rawSourceItemId: candidate.raw_source_item_id,
            rankingVersion: candidate.ranking_version,
          },
        }),
      ));
  }

  return {
    rankedAt: new Date().toISOString(),
    scannedCount: rawItems.length,
    clusterCount: clusters.size,
    selectedCount: stored.filter((candidate) => candidate.selection_status === "selected").length,
    candidateCount: stored.filter((candidate) => candidate.selection_status === "candidate").length,
    deferredCount: stored.filter((candidate) => candidate.selection_status === "deferred").length,
    rejectedCount: stored.filter((candidate) => candidate.selection_status === "rejected").length,
    regionalHoldCount: stored.filter((candidate) => candidate.selection_status === "regional_hold").length,
    candidates: stored,
  };
}

export function selectedCandidatesForAi(records: RankedCandidateRecord[]) {
  return records.filter((record) => record.candidate.selection_status === "selected");
}
