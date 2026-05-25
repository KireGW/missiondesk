"use client";

import {
  ArrowLeft,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Plus,
  RotateCcw,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { countryNameSv } from "@/lib/i18n/countries";
import {
  auditSources,
  retrievalMethodLabel,
  sourceCategoryLabel,
} from "@/lib/sources/audit";
import { normalizeRssHealthStatus, rssHealthLabel } from "@/lib/sources/rss-quality";
import type { SourceAuditDetectedType, SourceAuditResult } from "@/lib/sources/audit";
import type {
  IntelligenceCategory,
  RssHealthStatus,
  RetrievalMethod,
  SourceCategory,
  SourceDefinition,
} from "@/lib/types";

const categoryOptions: Array<{ id: IntelligenceCategory; label: string }> = [
  { id: "economy", label: "Ekonomi" },
  { id: "trade", label: "Handel" },
  { id: "domestic_politics", label: "Inrikespolitik" },
  { id: "foreign_policy", label: "Utrikespolitik" },
  { id: "sweden_connection", label: "Sverigekoppling" },
  { id: "security", label: "Säkerhet" },
  { id: "markets", label: "Marknader" },
  { id: "investment_climate", label: "Investeringsklimat" },
  { id: "migration", label: "Migration" },
  { id: "society", label: "Samhälle" },
  { id: "energy", label: "Energi" },
  { id: "technology", label: "Teknik" },
  { id: "culture_soft_power", label: "Kultur" },
];

const emptyForm = {
  name: "",
  url: "",
  country: "Mexiko",
  language: "es",
  categories: ["domestic_politics"] as IntelligenceCategory[],
  notes: "",
};

type AuditFilter = "active" | "ignored" | "history" | SourceAuditDetectedType | "media";
type AuditReviewState = NonNullable<SourceDefinition["auditReviewState"]>;
type SourceStatusFilter = "all" | "active" | "paused";

const auditFilters: Array<{ id: AuditFilter; label: string }> = [
  { id: "active", label: "Aktiva förslag" },
  { id: "ignored", label: "Ignorerade" },
  { id: "history", label: "Historik" },
  { id: "rss_feed", label: "RSS" },
  { id: "government_page", label: "Myndighet" },
  { id: "media", label: "Media" },
  { id: "official_social_account", label: "Sociala konton" },
  { id: "market_reference_page", label: "Marknad" },
  { id: "website", label: "Webbplats" },
];

const reviewStateLabels: Record<AuditReviewState, string> = {
  suggested: "Föreslagen",
  confirmed: "Godkänd",
  ignored: "Ignorerad",
};

const sourceCategoryFilterOptions: Array<{ id: "all" | SourceCategory; label: string }> = [
  { id: "all", label: "Alla kategorier" },
  { id: "government", label: "Myndighet" },
  { id: "media", label: "Media" },
  { id: "market", label: "Marknad" },
  { id: "website", label: "Webbplats" },
];

const retrievalFilterOptions: Array<{ id: "all" | RetrievalMethod; label: string }> = [
  { id: "all", label: "Alla primära hämtmetoder" },
  { id: "rss", label: "RSS" },
  { id: "website", label: "Website" },
  { id: "api", label: "API" },
  { id: "social_api", label: "Social API" },
];

const sourceStatusFilterOptions: Array<{ id: SourceStatusFilter; label: string }> = [
  { id: "all", label: "Alla statusar" },
  { id: "active", label: "Aktiva" },
  { id: "paused", label: "Pausade" },
];

const auditStateFilterOptions: Array<{ id: "all" | AuditReviewState; label: string }> = [
  { id: "all", label: "Alla auditlägen" },
  { id: "suggested", label: "Föreslagen" },
  { id: "confirmed", label: "Godkänd" },
  { id: "ignored", label: "Ignorerad" },
];

function hasAuditRecommendation(item: SourceAuditResult) {
  return (
    item.recommendedCategory !== item.currentCategory ||
    item.recommendedRetrievalMethod !== item.currentRetrievalMethod ||
    item.recommendedPlatform !== item.currentPlatform
  );
}

function hasMeaningfulAudit(item: SourceAuditResult | undefined) {
  return Boolean(
    item &&
      (item.confidence < 85 ||
        item.issues.length > 0 ||
        hasAuditRecommendation(item)),
  );
}

function hasActiveAuditSuggestion(
  item: SourceAuditResult | undefined,
  source: SourceDefinition | undefined,
) {
  return Boolean(
    item &&
      hasMeaningfulAudit(item) &&
      !isResolvedAuditRecommendation(item, source),
  );
}

function reviewStateForSource(source: SourceDefinition | undefined): AuditReviewState {
  if (!source) return "suggested";
  if (source.auditReviewState) return source.auditReviewState;
  if (
    source.auditConfirmedRecommendedType ||
    source.auditConfirmedCategory ||
    source.auditConfirmedRetrievalMethod ||
    source.auditConfirmedPlatform
  ) {
    return "confirmed";
  }
  return "suggested";
}

function isResolvedAuditRecommendation(
  item: SourceAuditResult,
  source: SourceDefinition | undefined,
) {
  if (!source) return false;
  if (!source.enabled) return true;
  if (reviewStateForSource(source) !== "suggested") return true;

  return (
    item.currentCategory === item.recommendedCategory &&
    item.currentRetrievalMethod === item.recommendedRetrievalMethod &&
    item.currentPlatform === item.recommendedPlatform
  );
}

function ingestionStatusFor(retrievalMethod: RetrievalMethod, enabled: boolean) {
  if (!enabled) {
    return {
      label: "Pausad",
      tone: "neutral" as const,
    };
  }

  if (retrievalMethod === "rss") {
    return {
      label: "Aktiv RSS-hämtning",
      tone: "accent" as const,
    };
  }

  if (retrievalMethod === "website") {
    return {
      label: "Aktiv hämtning: Website",
      tone: "accent" as const,
    };
  }

  if (retrievalMethod === "social_api") {
    return {
      label: "Aktiv hämtning: Social API",
      tone: "accent" as const,
    };
  }

  return {
    label: "Metadata klar – hämtning ej implementerad",
    tone: "neutral" as const,
  };
}

function rssHealthTone(status: RssHealthStatus) {
  if (status === "verified" || status === "recommended") return "accent" as const;
  if (status === "low_quality" || status === "inactive" || status === "rejected") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function shouldShowRssHealthBadge(status: RssHealthStatus, retrievalMethod: RetrievalMethod) {
  if (status === "unusable" && retrievalMethod === "website") return false;
  if (status === "missing" && retrievalMethod === "website") return false;
  return status !== "unknown";
}

function retrievalStrategyFor(
  source: SourceDefinition,
  primary: RetrievalMethod,
): SourceDefinition["retrieval"] {
  const fallback = source.retrieval?.fallback;
  return {
    primary,
    ...(fallback && fallback !== primary ? { fallback } : primary === "rss" ? { fallback: "website" as const } : {}),
  };
}

export function SourceManager({
  initialSources,
  initialAudit,
}: {
  initialSources: SourceDefinition[];
  initialAudit: SourceAuditResult[];
}) {
  const [sources, setSources] = useState<SourceDefinition[]>(initialSources);
  const [audit, setAudit] = useState<SourceAuditResult[]>(initialAudit);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState<"ready" | "saving" | "error">("ready");
  const [query, setQuery] = useState("");
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("active");
  const [updatingAuditIds, setUpdatingAuditIds] = useState<string[]>([]);
  const [sourceCategoryFilter, setSourceCategoryFilter] = useState<"all" | SourceCategory>("all");
  const [retrievalFilter, setRetrievalFilter] = useState<"all" | RetrievalMethod>("all");
  const [sourceStatusFilter, setSourceStatusFilter] = useState<SourceStatusFilter>("all");
  const [auditStateFilter, setAuditStateFilter] = useState<"all" | AuditReviewState>("all");

  const enabledCount = sources.filter((source) => source.enabled).length;
  const auditBySourceId = useMemo(
    () => new Map(audit.map((item) => [item.sourceId, item])),
    [audit],
  );
  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );

  const filteredSources = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const collator = new Intl.Collator("sv", { numeric: true, sensitivity: "base" });

    return sources
      .filter((source) => {
        const sourceAudit = auditBySourceId.get(source.id);
        const category = sourceAudit?.currentCategory ?? source.sourceCategory ?? "website";
        const retrieval =
          sourceAudit?.currentRetrievalMethod ?? source.retrievalMethod ?? "website";
        const reviewState = reviewStateForSource(source);
        const meaningfulAudit = hasMeaningfulAudit(sourceAudit);
        const activeAuditSuggestion = hasActiveAuditSuggestion(sourceAudit, source);
        const searchText = [
          source.name,
          source.country,
          countryNameSv(source.country) ?? "",
          source.language,
          source.url,
          source.notes ?? "",
          sourceCategoryLabel(category),
          retrievalMethodLabel(retrieval),
          activeAuditSuggestion ? reviewStateLabels[reviewState] : "normaliserad",
          ingestionStatusFor(retrieval, source.enabled).label,
          ...source.categories,
        ]
          .join(" ")
          .toLowerCase();

        if (needle && !searchText.includes(needle)) return false;
        if (sourceCategoryFilter !== "all" && category !== sourceCategoryFilter) return false;
        if (retrievalFilter !== "all" && retrieval !== retrievalFilter) return false;
        if (sourceStatusFilter === "active" && !source.enabled) return false;
        if (sourceStatusFilter === "paused" && source.enabled) return false;
        if (
          auditStateFilter !== "all" &&
          (!meaningfulAudit || !activeAuditSuggestion || reviewState !== auditStateFilter)
        ) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        return collator.compare(left.name, right.name);
      });
  }, [
    auditBySourceId,
    auditStateFilter,
    query,
    retrievalFilter,
    sourceCategoryFilter,
    sourceStatusFilter,
    sources,
  ]);

  const advisoryItems = useMemo(
    () => audit.filter((item) => hasMeaningfulAudit(item)),
    [audit],
  );

  const activeRecommendationItems = useMemo(
    () =>
      advisoryItems.filter(
        (item) => !isResolvedAuditRecommendation(item, sourceById.get(item.sourceId)),
      ),
    [advisoryItems, sourceById],
  );

  const ignoredRecommendationItems = useMemo(
    () =>
      advisoryItems.filter(
        (item) => reviewStateForSource(sourceById.get(item.sourceId)) === "ignored",
      ),
    [advisoryItems, sourceById],
  );

  const resolvedRecommendationItems = useMemo(
    () =>
      advisoryItems.filter(
        (item) => reviewStateForSource(sourceById.get(item.sourceId)) === "confirmed",
      ),
    [advisoryItems, sourceById],
  );

  const filteredAuditItems = useMemo(() => {
    const activeItems = activeRecommendationItems;

    if (auditFilter === "active") return activeItems;
    if (auditFilter === "ignored") return ignoredRecommendationItems;
    if (auditFilter === "history") {
      return [...resolvedRecommendationItems, ...ignoredRecommendationItems];
    }

    return activeItems.filter((item) => {
      if (auditFilter === "rss_feed") return item.currentRetrievalMethod === "rss";
      if (auditFilter === "website") return item.currentCategory === "website";
      if (auditFilter === "government_page") return item.currentCategory === "government";
      if (auditFilter === "media") return item.currentCategory === "media";
      if (auditFilter === "official_social_account") {
        return item.detectedType === "official_social_account";
      }
      if (auditFilter === "market_reference_page") return item.currentCategory === "market";
      return false;
    });
  }, [
    activeRecommendationItems,
    auditFilter,
    ignoredRecommendationItems,
    resolvedRecommendationItems,
  ]);
  const auditEmptyMessage =
    auditFilter === "active"
      ? "Inga aktiva klassificeringsförslag."
      : auditFilter === "ignored"
        ? "Inga ignorerade förslag."
        : auditFilter === "history"
          ? "Ingen klassificeringshistorik ännu."
          : "Inga aktiva förslag matchar valt filter.";
  const exportRows = audit.map((item) => {
    const source = sourceById.get(item.sourceId);
    return {
      sourceName: source?.name ?? item.sourceId,
      url: source?.url ?? "",
      currentType: item.currentType,
      currentCategory: item.currentCategory,
      currentRetrievalMethod: item.currentRetrievalMethod,
      detectedType: item.detectedType,
      recommendedType: item.recommendedType,
      recommendedClass: item.recommendedClass,
      recommendedCategory: item.recommendedCategory,
      recommendedRetrievalMethod: item.recommendedRetrievalMethod,
      fallbackRetrievalMethod: source?.retrieval?.fallback,
      confidence: item.confidence,
      warnings: item.warnings,
      issues: item.issues,
      suggestedAction: item.suggestedAction,
      reviewState: reviewStateForSource(source),
    };
  });

  const toggleCategory = (id: IntelligenceCategory) => {
    setForm((current) => {
      const categories = current.categories.includes(id)
        ? current.categories.filter((category) => category !== id)
        : [...current.categories, id];

      return {
        ...current,
        categories: categories.length > 0 ? categories : ["domestic_politics"],
      };
    });
  };

  const addSource = async () => {
    setStatus("saving");
    const response = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        type: "rss",
        enabled: true,
        trustTier: 2,
      }),
    });

    if (!response.ok) {
      setStatus("error");
      return;
    }

    const payload = (await response.json()) as { sources: SourceDefinition[] };
    setSources(payload.sources);
    setAudit(auditSources(payload.sources));
    setForm(emptyForm);
    setStatus("ready");
  };

  const saveSourcePatch = async (
    source: SourceDefinition,
    patch: Partial<SourceDefinition>,
  ) => {
    const response = await fetch(`/api/sources/${source.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });

    if (!response.ok) {
      setStatus("error");
      return null;
    }

    const payload = (await response.json()) as { sources: SourceDefinition[] };
    return payload.sources;
  };

  const patchSource = async (source: SourceDefinition, patch: Partial<SourceDefinition>) => {
    const savedSources = await saveSourcePatch(source, patch);
    if (!savedSources) return;

    setSources(savedSources);
    setAudit(auditSources(savedSources));
    setStatus("ready");
  };

  const resetSourceList = async () => {
    setStatus("saving");
    const response = await fetch("/api/sources/reset", { method: "POST" });
    const payload = (await response.json()) as { sources: SourceDefinition[] };
    setSources(payload.sources);
    setAudit(auditSources(payload.sources));
    setStatus("ready");
  };

  const updateAuditReviewState = async (
    source: SourceDefinition,
    state: AuditReviewState,
  ) => {
    const sourceAudit = auditBySourceId.get(source.id);
    const recommendedCategory =
      sourceAudit?.recommendedCategory ??
      source.auditRecommendedCategory ??
      source.sourceCategory ??
      sourceAudit?.currentCategory ??
      "website";
    const recommendedRetrievalMethod =
      sourceAudit?.recommendedRetrievalMethod ??
      source.auditRecommendedRetrievalMethod ??
      source.retrievalMethod ??
      sourceAudit?.currentRetrievalMethod ??
      "website";
    const recommendedPlatform =
      sourceAudit?.recommendedPlatform ?? source.auditRecommendedPlatform ?? source.platform;
    const recommendedType =
      sourceAudit?.recommendedType ?? source.auditRecommendedType ?? source.recommendedSourceType;
    const patch: Partial<SourceDefinition> = {
      auditReviewState: state,
      auditReviewedAt: new Date().toISOString(),
      sourceCategory:
        state === "confirmed"
          ? recommendedCategory
          : source.sourceCategory,
      retrievalMethod:
        state === "confirmed"
          ? recommendedRetrievalMethod
          : source.retrievalMethod,
      retrieval:
        state === "confirmed"
          ? retrievalStrategyFor(source, recommendedRetrievalMethod)
          : source.retrieval,
      platform:
        state === "confirmed"
          ? recommendedPlatform
          : source.platform,
      auditConfirmedRecommendedType:
        state === "confirmed" ? recommendedType : undefined,
      auditConfirmedCategory:
        state === "confirmed" ? recommendedCategory : undefined,
      auditConfirmedRetrievalMethod:
        state === "confirmed" ? recommendedRetrievalMethod : undefined,
      auditConfirmedPlatform:
        state === "confirmed" ? recommendedPlatform : undefined,
    };

    setUpdatingAuditIds((current) =>
      current.includes(source.id) ? current : [...current, source.id],
    );
    const optimisticSources = sources.map((item) =>
      item.id === source.id ? { ...item, ...patch } : item,
    );
    setSources(optimisticSources);
    setAudit(auditSources(optimisticSources));

    try {
      const savedSources = await saveSourcePatch(source, patch);
      if (!savedSources) return;

      const confirmedSources = savedSources.map((item) =>
        item.id === source.id ? { ...item, ...patch } : item,
      );
      setSources(confirmedSources);
      setAudit(auditSources(confirmedSources));
      setStatus("ready");
    } finally {
      setUpdatingAuditIds((current) => current.filter((id) => id !== source.id));
    }
  };

  const downloadAuditReport = (format: "json" | "markdown") => {
    const generatedAt = new Date().toISOString();
    const content =
      format === "json"
        ? JSON.stringify({ generatedAt, sources: exportRows }, null, 2)
        : [
            `# MissionDesk source audit`,
            ``,
            `Generated: ${generatedAt}`,
            ``,
            `| Source | Source category | Primary retrieval | Fallback retrieval | Recommended category | Recommended retrieval | Ingestion | Confidence | State | Notes | Suggested action |`,
            `| --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |`,
            ...exportRows.map((row) =>
              `| ${[
                  row.sourceName,
                  sourceCategoryLabel(row.currentCategory),
                  retrievalMethodLabel(row.currentRetrievalMethod),
                  row.fallbackRetrievalMethod
                    ? retrievalMethodLabel(row.fallbackRetrievalMethod)
                    : "-",
                  sourceCategoryLabel(row.recommendedCategory),
                  retrievalMethodLabel(row.recommendedRetrievalMethod),
                  "Oförändrad",
                  `${row.confidence}%`,
                  row.reviewState,
                  [...row.issues, ...row.warnings].join("; ") || "-",
                  row.suggestedAction,
                ]
                  .map((cell) => String(cell).replace(/\|/g, "\\|"))
                  .join(" | ")} |`,
            ),
          ].join("\n");
    const blob = new Blob([content], {
      type: format === "json" ? "application/json" : "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `missiondesk-source-audit.${format === "json" ? "json" : "md"}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="missiondesk min-h-screen px-4 py-5 sm:px-6 lg:px-7">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
        <header className="surface-strong rounded-lg p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-sm text-[var(--app-muted)] hover:text-[var(--app-accent)]"
              >
                <ArrowLeft className="h-4 w-4" />
                Till dashboard
              </Link>
              <div className="mt-4 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)]">
                  <Database className="h-5 w-5 text-[var(--app-accent)]" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-muted)]">
                    MissionDesk
                  </p>
                  <h1 className="text-3xl font-semibold">Source Manager</h1>
                </div>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
                Hantera seriösa källor för nyheter, myndighetsuppdateringar och
                institutionella signaler. Inga påhittade artiklar visas i dashboarden.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:w-[520px]">
              <Metric label="Aktiva källor" value={enabledCount} />
              <Metric label="Totalt" value={sources.length} />
              <Metric label="Aktiva förslag" value={activeRecommendationItems.length} />
            </div>
          </div>
        </header>

        <section className="surface rounded-lg p-5">
          <div className="flex flex-col gap-3 border-b border-[var(--app-line)] pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-muted)]">
                Källassistans
              </p>
              <h2 className="mt-2 text-xl font-semibold">Klassificeringsförslag</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
                En tillfällig inbox för föreslagen källmetadata. Godkända rekommendationer
                tas bort från kön och sparas bara som metadata. Hämtning, polling, ingestion,
                ranking och “Uppdatera flöde” är oförändrade.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <AuditPill tone="accent">
                {activeRecommendationItems.length} aktiva rekommendationer
              </AuditPill>
              <AuditPill tone="neutral">
                {resolvedRecommendationItems.length} godkända
              </AuditPill>
              <button
                type="button"
                onClick={() => downloadAuditReport("json")}
                className="inline-flex items-center gap-2 rounded border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-2.5 py-1.5 text-xs text-[var(--app-soft)] hover:border-[var(--app-accent)]"
              >
                <Download className="h-3.5 w-3.5" />
                Export JSON
              </button>
              <button
                type="button"
                onClick={() => downloadAuditReport("markdown")}
                className="inline-flex items-center gap-2 rounded border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-2.5 py-1.5 text-xs text-[var(--app-soft)] hover:border-[var(--app-accent)]"
              >
                <Download className="h-3.5 w-3.5" />
                Export MD
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {auditFilters.map((filter) => {
              const count =
                filter.id === "active"
                  ? activeRecommendationItems.length
                  : filter.id === "ignored"
                    ? ignoredRecommendationItems.length
                    : filter.id === "history"
                      ? resolvedRecommendationItems.length + ignoredRecommendationItems.length
                  : activeRecommendationItems.filter((item) => {
                      if (filter.id === "rss_feed") return item.currentRetrievalMethod === "rss";
                      if (filter.id === "website") return item.currentCategory === "website";
                      if (filter.id === "government_page") return item.currentCategory === "government";
                      if (filter.id === "media") return item.currentCategory === "media";
                      if (filter.id === "official_social_account") {
                        return item.detectedType === "official_social_account";
                      }
                      if (filter.id === "market_reference_page") return item.currentCategory === "market";
                      return false;
                    }).length;
              const active = auditFilter === filter.id;

              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setAuditFilter(filter.id)}
                  className={clsx(
                    "rounded-md border px-3 py-2 text-xs font-medium transition",
                    active
                      ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_84%)] text-[var(--app-accent-strong)]"
                      : "border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-soft)] hover:border-[var(--app-accent)]",
                  )}
                >
                  {filter.label} · {count}
                </button>
              );
            })}
          </div>

          {filteredAuditItems.length > 0 ? (
            <div className="thin-scrollbar mt-4 overflow-x-auto">
              <table className="w-full min-w-[1380px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--app-line)] text-xs uppercase tracking-[0.12em] text-[var(--app-muted)]">
                    <th className="px-4 py-3 font-medium">Källa</th>
                    <th className="px-4 py-3 font-medium">Källkategori</th>
                    <th className="px-4 py-3 font-medium">Hämtmetod</th>
                    <th className="px-4 py-3 font-medium">Rekommenderad kategori</th>
                    <th className="px-4 py-3 font-medium">Rekommenderad hämtmetod</th>
                    <th className="px-4 py-3 font-medium">Plattform</th>
                    <th className="px-4 py-3 font-medium">Ingestion</th>
                    <th className="px-4 py-3 font-medium">Säkerhet</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Kommentarer</th>
                    <th className="px-4 py-3 font-medium">Nästa steg</th>
                    <th className="px-4 py-3 font-medium">Åtgärd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--app-line)]">
                  {filteredAuditItems.map((item) => {
                    const source = sourceById.get(item.sourceId);
                    if (!source) return null;
                    const messages = [...item.issues, ...item.warnings];
                    const reviewState = reviewStateForSource(source);
                    const updatingAuditState = updatingAuditIds.includes(source.id);

                    return (
                      <tr key={item.sourceId} className="align-top hover:bg-[var(--app-panel-muted)]">
                        <td className="px-4 py-3">
                          <p className="font-medium text-[var(--app-fg)]">{source.name}</p>
                          <SourceUrlLink url={source.url} className="mt-1" />
                        </td>
                        <td className="px-4 py-3">
                          <AuditPill tone="neutral">
                            {sourceCategoryLabel(item.currentCategory)}
                          </AuditPill>
                        </td>
                        <td className="px-4 py-3">
                          <AuditPill tone="neutral">
                            {retrievalMethodLabel(item.currentRetrievalMethod)}
                          </AuditPill>
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--app-soft)]">
                          {sourceCategoryLabel(item.recommendedCategory)}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--app-soft)]">
                          {retrievalMethodLabel(item.recommendedRetrievalMethod)}
                        </td>
                        <td className="px-4 py-3 text-sm text-[var(--app-soft)]">
                          {item.recommendedPlatform ?? item.currentPlatform ?? "-"}
                        </td>
                        <td className="px-4 py-3">
                          <AuditPill tone="neutral">Oförändrad</AuditPill>
                        </td>
                        <td className="px-4 py-3">
                          <AuditPill tone={item.confidence >= 85 ? "neutral" : "warning"}>
                            {item.confidence}%
                          </AuditPill>
                        </td>
                        <td className="px-4 py-3">
                          <AuditPill
                            tone={
                              reviewState === "confirmed"
                                ? "accent"
                                : reviewState === "ignored"
                                  ? "neutral"
                                  : "warning"
                            }
                          >
                            {reviewStateLabels[reviewState]}
                          </AuditPill>
                        </td>
                        <td className="max-w-[260px] px-4 py-3 text-xs leading-5 text-[var(--app-muted)]">
                          {messages.length > 0 ? messages.join(" ") : "Ingen särskild kommentar."}
                        </td>
                        <td className="max-w-[300px] px-4 py-3 text-xs leading-5 text-[var(--app-muted)]">
                          {item.suggestedAction}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex min-w-[170px] flex-col gap-2">
                            {reviewState === "confirmed" ? (
                              <>
                                <AuditPill tone="accent">
                                  {updatingAuditState ? "Sparar..." : "Godkänd"}
                                </AuditPill>
                                <button
                                  type="button"
                                  onClick={() => void updateAuditReviewState(source, "suggested")}
                                  disabled={updatingAuditState}
                                  className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-xs font-medium text-[var(--app-soft)] transition hover:border-[var(--app-accent)] disabled:cursor-default disabled:opacity-55"
                                >
                                  Ångra
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void updateAuditReviewState(source, "confirmed")}
                                  disabled={updatingAuditState}
                                  className="rounded-md border border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_86%)] px-3 py-2 text-xs font-medium text-[var(--app-accent-strong)] transition hover:bg-[color-mix(in_srgb,var(--app-accent),transparent_78%)] disabled:cursor-default disabled:opacity-55"
                                >
                                  {updatingAuditState ? "Sparar..." : "Godkänn rekommendation"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void updateAuditReviewState(source, "ignored")}
                                  disabled={reviewState === "ignored" || updatingAuditState}
                                  className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-xs font-medium text-[var(--app-soft)] transition hover:border-[var(--app-accent)] disabled:cursor-default disabled:opacity-55"
                                >
                                  Ignorera förslag
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--app-muted)]">
              {auditEmptyMessage}
            </p>
          )}
        </section>

        <section className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <form
            className="surface rounded-lg p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void addSource();
            }}
          >
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--app-muted)]">
              <Plus className="h-4 w-4 text-[var(--app-accent)]" />
              Lägg till RSS-källa
            </div>

            <div className="mt-5 grid gap-3">
              <Field
                label="Namn"
                value={form.name}
                onChange={(value) => setForm((current) => ({ ...current, name: value }))}
                placeholder="Ex. El Norte"
              />
              <Field
                label="RSS URL"
                value={form.url}
                onChange={(value) => setForm((current) => ({ ...current, url: value }))}
                placeholder="https://example.com/feed"
              />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Land"
                  value={form.country}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, country: value }))
                  }
                />
                <Field
                  label="Språk"
                  value={form.language}
                  onChange={(value) =>
                    setForm((current) => ({ ...current, language: value }))
                  }
                />
              </div>
              <Field
                label="Anteckning"
                value={form.notes}
                onChange={(value) => setForm((current) => ({ ...current, notes: value }))}
                placeholder="Region, inriktning eller kommentar"
              />
            </div>

            <p className="mt-5 text-xs uppercase tracking-[0.14em] text-[var(--app-muted)]">
              Teman
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {categoryOptions.map((category) => {
                const active = form.categories.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => toggleCategory(category.id)}
                    className={clsx(
                      "rounded-md border px-3 py-2 text-xs transition",
                      active
                        ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_82%)] text-[var(--app-accent-strong)]"
                        : "border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-soft)]",
                    )}
                  >
                    {category.label}
                  </button>
                );
              })}
            </div>

            <button
              type="submit"
              disabled={!form.name || !form.url || status === "saving"}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md border border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_82%)] px-4 py-3 text-sm font-medium text-[var(--app-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              Lägg till källa
            </button>
          </form>

          <section className="surface rounded-lg">
            <div className="flex flex-col gap-3 border-b border-[var(--app-line)] p-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-[var(--app-muted)]">
                  Aktiva och tillgängliga källor
                </p>
                <h2 className="mt-2 text-xl font-semibold">Källista</h2>
                <p className="mt-2 text-sm text-[var(--app-muted)]">
                  {filteredSources.length} av {sources.length} källor visas.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Sök källa"
                  className="min-h-10 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 text-sm outline-none placeholder:text-[var(--app-muted)]"
                />
                <button
                  type="button"
                  onClick={() => void resetSourceList()}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 text-sm text-[var(--app-soft)] hover:border-[var(--app-accent)]"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </button>
              </div>
            </div>

            <div className="grid gap-3 border-b border-[var(--app-line)] p-5 md:grid-cols-2 xl:grid-cols-4">
              <SelectField
                label="Källkategori"
                value={sourceCategoryFilter}
                onChange={(value) => setSourceCategoryFilter(value as "all" | SourceCategory)}
                options={sourceCategoryFilterOptions}
              />
              <SelectField
                label="Primär hämtning"
                value={retrievalFilter}
                onChange={(value) => setRetrievalFilter(value as "all" | RetrievalMethod)}
                options={retrievalFilterOptions}
              />
              <SelectField
                label="Status"
                value={sourceStatusFilter}
                onChange={(value) => setSourceStatusFilter(value as SourceStatusFilter)}
                options={sourceStatusFilterOptions}
              />
              <SelectField
                label="Audit"
                value={auditStateFilter}
                onChange={(value) => setAuditStateFilter(value as "all" | AuditReviewState)}
                options={auditStateFilterOptions}
              />
            </div>

            <div className="divide-y divide-[var(--app-line)]">
              {filteredSources.map((source) => {
                const sourceAudit = auditBySourceId.get(source.id);
                const sourceCategory =
                  sourceAudit?.currentCategory ?? source.sourceCategory ?? "website";
                const retrieval =
                  sourceAudit?.currentRetrievalMethod ?? source.retrievalMethod ?? "website";
                const reviewState = reviewStateForSource(source);
                const activeAuditSuggestion = hasActiveAuditSuggestion(sourceAudit, source);
                const ingestionStatus = ingestionStatusFor(retrieval, source.enabled);
                const fallbackRetrieval = source.retrieval?.fallback;
                const platform = source.platform ?? sourceAudit?.currentPlatform;
                const rssHealthStatus = normalizeRssHealthStatus(source.rssHealthStatus);

                return (
                  <article
                    key={source.id}
                    className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_220px]"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold">{source.name}</span>
                        <span
                          className={clsx(
                            "inline-flex items-center gap-1 rounded px-2 py-1 text-xs",
                            source.enabled
                              ? "bg-[color-mix(in_srgb,var(--app-positive),transparent_84%)] text-[var(--app-positive)]"
                              : "bg-[var(--app-panel-muted)] text-[var(--app-muted)]",
                          )}
                        >
                          {source.enabled ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <XCircle className="h-3.5 w-3.5" />
                          )}
                          {source.enabled ? "Aktiv" : "Pausad"}
                        </span>
                        <AuditPill tone="neutral">
                          Kategori: {sourceCategoryLabel(sourceCategory)}
                        </AuditPill>
                        <AuditPill tone="accent">
                          Primär: {retrievalMethodLabel(retrieval)}
                        </AuditPill>
                        {fallbackRetrieval && fallbackRetrieval !== retrieval && (
                          <AuditPill tone="neutral">
                            Fallback: {retrievalMethodLabel(fallbackRetrieval)}
                          </AuditPill>
                        )}
                        <AuditPill tone={ingestionStatus.tone}>
                          {ingestionStatus.label}
                        </AuditPill>
                        {rssHealthStatus && shouldShowRssHealthBadge(rssHealthStatus, retrieval) && (
                          <AuditPill tone={rssHealthTone(rssHealthStatus)}>
                            {rssHealthLabel(rssHealthStatus)}
                          </AuditPill>
                        )}
                        {platform && (
                          <AuditPill tone="neutral">
                            Plattform: {platform.toUpperCase()}
                          </AuditPill>
                        )}
                        {activeAuditSuggestion && (
                          <AuditPill
                            tone={
                              reviewState === "confirmed"
                                ? "accent"
                                : reviewState === "ignored"
                                  ? "neutral"
                                  : "warning"
                            }
                          >
                            {reviewStateLabels[reviewState]}
                          </AuditPill>
                        )}
                        {activeAuditSuggestion && sourceAudit && sourceAudit.confidence < 85 && (
                          <AuditPill tone="warning">
                            {sourceAudit.confidence}% säkerhet
                          </AuditPill>
                        )}
                      </div>
                      <SourceUrlLink url={source.url} className="mt-2" />
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--app-muted)]">
                        <span>{countryNameSv(source.country) ?? source.country}</span>
                        <span>{source.language.toUpperCase()}</span>
                        <span>Tier {source.trustTier}</span>
                        {source.categories.map((category) => (
                          <span
                            key={category}
                            className="rounded border border-[var(--app-line)] px-2 py-1"
                          >
                            {category}
                          </span>
                        ))}
                      </div>
                      {source.notes && (
                        <p className="mt-3 text-sm leading-6 text-[var(--app-soft)]">
                          {source.notes}
                        </p>
                      )}
                      {activeAuditSuggestion && sourceAudit && (
                        <div className="mt-3 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3 text-xs leading-5 text-[var(--app-muted)]">
                          <p>
                          {reviewState === "confirmed"
                            ? "Godkänd metadata"
                            : reviewState === "ignored"
                              ? "Ignorerad rekommendation"
                              : "Föreslagen metadata"}
                            :{" "}
                            <span className="font-medium text-[var(--app-soft)]">
                              {sourceCategoryLabel(sourceAudit.recommendedCategory)} ·{" "}
                              {retrievalMethodLabel(sourceAudit.recommendedRetrievalMethod)}
                            </span>
                          </p>
                          <p className="mt-1">
                            Nuvarande hämtning: {retrievalMethodLabel(sourceAudit.currentRetrievalMethod)}.
                            Ingestion: Oförändrad.
                          </p>
                          {(sourceAudit.issues.length > 0 || sourceAudit.warnings.length > 0) && (
                            <ul className="mt-2 list-disc space-y-1 pl-4">
                              {[...sourceAudit.issues, ...sourceAudit.warnings].map((message) => (
                                <li key={message}>{message}</li>
                              ))}
                            </ul>
                          )}
                          <p className="mt-2">{sourceAudit.suggestedAction}</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-start lg:justify-end">
                      <button
                        type="button"
                        onClick={() => void patchSource(source, { enabled: !source.enabled })}
                        className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-sm hover:border-[var(--app-accent)]"
                      >
                        {source.enabled ? "Pausa" : "Aktivera"}
                      </button>
                    </div>
                  </article>
                );
              })}
              {filteredSources.length === 0 && (
                <p className="p-5 text-sm text-[var(--app-muted)]">
                  Inga källor matchar aktuell sökning och filter.
                </p>
              )}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs text-[var(--app-muted)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-h-10 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 text-sm outline-none placeholder:text-[var(--app-muted)] focus:border-[var(--app-accent)]"
      />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: string) => void;
  options: Array<{ id: T; label: string }>;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs text-[var(--app-muted)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 text-sm text-[var(--app-soft)] outline-none focus:border-[var(--app-accent)]"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SourceUrlLink({ url, className }: { url: string; className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={clsx(
        "group inline-flex max-w-full items-center gap-1 break-all font-mono text-xs text-[var(--app-muted)] transition hover:text-[var(--app-accent)]",
        className,
      )}
    >
      <span className="group-hover:underline group-hover:decoration-1 group-hover:decoration-[color-mix(in_srgb,var(--app-fg),transparent_38%)] group-hover:underline-offset-3">
        {url}
      </span>
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">Öppna källa i ny flik</span>
    </a>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3">
      <span className="text-xs text-[var(--app-muted)]">{label}</span>
      <span className="mt-2 block font-mono text-2xl font-semibold">{value}</span>
    </div>
  );
}

function AuditPill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "neutral" | "accent" | "warning";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded border px-2 py-1 text-xs font-medium",
        tone === "neutral" &&
          "border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-muted)]",
        tone === "accent" &&
          "border-[color-mix(in_srgb,var(--app-accent),transparent_45%)] bg-[color-mix(in_srgb,var(--app-accent),transparent_86%)] text-[var(--app-accent-strong)]",
        tone === "warning" &&
          "border-[color-mix(in_srgb,var(--app-gold),transparent_45%)] bg-[color-mix(in_srgb,var(--app-gold),transparent_86%)] text-[var(--app-gold)]",
      )}
    >
      {children}
    </span>
  );
}
