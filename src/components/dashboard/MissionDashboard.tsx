"use client";

import {
  Activity,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  ClipboardList,
  Database,
  ExternalLink,
  Eye,
  Filter,
  Flag,
  Gauge,
  Globe2,
  Landmark,
  Languages,
  LineChart,
  ListFilter,
  Loader2,
  Map as MapIcon,
  MapPin,
  Moon,
  Newspaper,
  PanelRightOpen,
  Printer,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { processedRecordToIntelligenceItem } from "@/lib/intelligence/dashboard-view";
import { countryNameSv } from "@/lib/i18n/countries";
import type {
  BackgroundJob,
  Briefing,
  ProcessedIntelligenceRecord,
} from "@/lib/intelligence/models";
import type {
  EmbassyConfig,
  IntelligenceCategory,
  IntelligenceItem,
  ProfileMode,
  ScoreKey,
} from "@/lib/types";

interface MissionDashboardProps {
  config: EmbassyConfig;
  initialItems: IntelligenceItem[];
  initialBriefings: Briefing[];
  initialCacheTimestamp?: string;
  initialCacheExpiresAt?: string;
  activeSourceCount: number;
}

type GeographySelection =
  | { type: "national"; ids: string[] }
  | { type: "region"; ids: string[] }
  | { type: "division"; ids: string[] };

type RegionalStatus = "idle" | "loading" | "ready" | "empty" | "error" | "not_configured";

interface RegionalApiPayload {
  status: "ready" | "empty" | "not_configured";
  regionId: string;
  regionLabel: string;
  divisionIds: string[];
  fromCache: boolean;
  reprocessed: boolean;
  processedCount: number;
  freshnessTimestamp?: string;
  cacheExpiresAt?: string;
  items: ProcessedIntelligenceRecord[];
  loadingSteps: string[];
}

interface FirstRunStatusPayload {
  cacheExists: boolean;
  job?: BackgroundJob;
  active: boolean;
  missingSources: boolean;
  missingApiKey: boolean;
  message: string;
  steps: string[];
  progressPercent: number;
  activeStepIndex: number;
  estimatedDurationLabel: string;
  longRunning: boolean;
  logs: Array<{
    at: string;
    message: string;
    data?: Record<string, unknown>;
  }>;
}

interface CacheRefreshStatusPayload {
  active: boolean;
  job?: BackgroundJob;
  message: string;
  progressPercent: number;
  activeStepIndex: number;
  steps: string[];
  logs: Array<{
    at: string;
    message: string;
    data?: Record<string, unknown>;
  }>;
}

const scoreMeta: Array<{ key: ScoreKey; label: string; compact: string }> = [
  { key: "urgency_score", label: "Brådska", compact: "Nu" },
  {
    key: "diplomatic_relevance_score",
    label: "Diplomatisk relevans",
    compact: "Dipl.",
  },
  { key: "sweden_relevance_score", label: "Sverigerelevans", compact: "Sve." },
  {
    key: "economic_impact_score",
    label: "Ekonomisk påverkan",
    compact: "Eko.",
  },
  {
    key: "security_impact_score",
    label: "Säkerhetspåverkan",
    compact: "Säk.",
  },
  {
    key: "public_attention_score",
    label: "Offentlig uppmärksamhet",
    compact: "Publ.",
  },
];

const categoryIcon: Record<IntelligenceCategory, LucideIcon> = {
  economy: BarChart3,
  trade: BriefcaseBusiness,
  domestic_politics: Landmark,
  foreign_policy: Globe2,
  sweden_connection: Flag,
  security: Shield,
  markets: LineChart,
  investment_climate: TrendingUp,
  migration: Users,
  society: Eye,
  energy: Activity,
  technology: Sparkles,
  culture_soft_power: Building2,
};

const categoryIconTone: Record<IntelligenceCategory, string> = {
  economy: "text-[var(--app-warning)]",
  trade: "text-[color-mix(in_srgb,var(--app-warning),white_12%)]",
  domestic_politics: "text-[var(--app-positive)]",
  foreign_policy: "text-[color-mix(in_srgb,var(--app-accent),#c084fc_45%)]",
  sweden_connection: "text-[var(--app-positive)]",
  security: "text-[var(--app-danger)]",
  markets: "text-[var(--app-warning)]",
  investment_climate: "text-[var(--app-positive)]",
  migration: "text-[color-mix(in_srgb,var(--app-warning),white_22%)]",
  society: "text-[color-mix(in_srgb,var(--app-positive),white_10%)]",
  energy: "text-[var(--app-positive)]",
  technology: "text-[color-mix(in_srgb,var(--app-accent),white_22%)]",
  culture_soft_power: "text-[color-mix(in_srgb,var(--app-accent),white_8%)]",
};

const themeFilterOrder: IntelligenceCategory[] = [
  "economy",
  "trade",
  "markets",
  "technology",
  "investment_climate",
  "energy",
  "domestic_politics",
  "security",
  "foreign_policy",
  "migration",
  "sweden_connection",
  "society",
  "culture_soft_power",
];

const profileIcon: Record<ProfileMode, LucideIcon> = {
  daily_overview: Gauge,
  ambassador_briefing: Landmark,
  trade_business: BriefcaseBusiness,
  political_risk: CircleAlert,
  sweden_connection: Flag,
  security: Shield,
  weekly_summary: ClipboardList,
  upcoming_events: CalendarDays,
};

const scoreTone = (score: number) => {
  if (score >= 82) return "text-[var(--app-danger)]";
  if (score >= 65) return "text-[var(--app-warning)]";
  return "text-[var(--app-positive)]";
};

const priorityLabel = (score: number) => {
  if (score >= 82) return "Kräver uppföljning";
  if (score >= 65) return "Hög relevans";
  if (score >= 45) return "Måttlig relevans";
  return "Bakgrund";
};

const urgencyLabel = (score: number) => {
  if (score >= 82) return "Kräver uppmärksamhet";
  if (score >= 65) return "Följ i dag";
  if (score >= 45) return "Bevaka";
  return "Bakgrund";
};

const formatDate = (value?: string, includeTime = false) => {
  if (!value) return "Ej daterad";
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const parsedYear = Number(year);
    return new Intl.DateTimeFormat("sv-SE", {
      day: "numeric",
      month: "short",
      ...(parsedYear !== new Date().getFullYear() ? { year: "numeric" } : {}),
    }).format(new Date(parsedYear, Number(month) - 1, Number(day)));
  }
  const date = new Date(value);
  const isCurrentYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
    ...(!isCurrentYear ? { year: "numeric" } : {}),
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
};

const latestIso = (values: Array<string | undefined>) => {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value!).getTime())
    .filter(Number.isFinite);

  if (timestamps.length === 0) return undefined;
  return new Date(Math.max(...timestamps)).toISOString();
};

const earliestIso = (values: Array<string | undefined>) => {
  const timestamps = values
    .filter(Boolean)
    .map((value) => new Date(value!).getTime())
    .filter(Number.isFinite);

  if (timestamps.length === 0) return undefined;
  return new Date(Math.min(...timestamps)).toISOString();
};

const getCompositeScore = (
  item: IntelligenceItem,
  config: EmbassyConfig,
  profile: ProfileMode,
) => {
  const profileDefinition = config.profileModes.find((mode) => mode.id === profile);
  const baseScore = scoreMeta.reduce((total, { key }) => {
    const configWeight = config.scoringWeights[key] ?? 1;
    const profileWeight = profileDefinition?.scoreWeights[key] ?? 1;
    return total + item[key] * configWeight * profileWeight;
  }, 0);
  const categoryWeight = profileDefinition?.categoryWeights[item.category] ?? 1;
  const profileBoost = item.profile_tags.includes(profile) ? 1.13 : 0.96;

  return Math.round((baseScore / scoreMeta.length) * categoryWeight * profileBoost);
};

const getRegionDivisionIds = (config: EmbassyConfig, regionId: string) =>
  config.geography.regions.find((region) => region.id === regionId)?.divisionIds ?? [];

const itemMatchesGeography = (
  item: IntelligenceItem,
  config: EmbassyConfig,
  selection: GeographySelection,
) => {
  if (selection.type === "national") return true;

  const ids =
    selection.type === "region"
      ? selection.ids.flatMap((regionId) => getRegionDivisionIds(config, regionId))
      : selection.ids;

  if (item.geographic_scope === "national" && item.geographic_tags.length === 0) {
    return false;
  }

  return item.geographic_tags.some((tag) => ids.includes(tag));
};

const getCategoryLabel = (config: EmbassyConfig, category: IntelligenceCategory) =>
  config.themeCategories.find((theme) => theme.id === category)?.label ?? category;

const getGeographyLabel = (item: IntelligenceItem, config: EmbassyConfig) => {
  if (item.geographic_tags.length > 1) return "Flera delstater";

  const division = item.geographic_tags[0]
    ? config.geography.administrativeDivisions.find(
        (candidate) => candidate.id === item.geographic_tags[0],
      )
    : undefined;

  return division?.displayName ?? item.region;
};

const getOrderedThemeCategories = (config: EmbassyConfig) => {
  const byId = new Map(config.themeCategories.map((category) => [category.id, category]));
  const orderedIds = new Set(themeFilterOrder);
  return [
    ...themeFilterOrder.flatMap((id) => {
      const category = byId.get(id);
      return category ? [category] : [];
    }),
    ...config.themeCategories.filter((category) => !orderedIds.has(category.id)),
  ];
};

const getSignalThemeTags = (item: IntelligenceItem, config: EmbassyConfig) => {
  const tagIds = new Set<IntelligenceCategory>([item.category]);

  if (item.sweden_relevance_score >= 55) tagIds.add("sweden_connection");
  if (item.economic_impact_score >= 65) tagIds.add("economy");
  if (item.security_impact_score >= 55) tagIds.add("security");

  if (item.profile_tags.includes("trade_business")) tagIds.add("trade");
  if (item.profile_tags.includes("political_risk")) tagIds.add("domestic_politics");

  return Array.from(tagIds)
    .map((id) => ({
      id,
      label: getCategoryLabel(config, id),
      Icon: categoryIcon[id],
    }))
    .filter(({ label }) => Boolean(label))
    .slice(0, 5);
};

const byScore =
  (config: EmbassyConfig, profile: ProfileMode) =>
  (a: IntelligenceItem, b: IntelligenceItem) =>
    getCompositeScore(b, config, profile) - getCompositeScore(a, config, profile);

export function MissionDashboard({
  config,
  initialItems,
  initialBriefings,
  initialCacheTimestamp,
  initialCacheExpiresAt,
  activeSourceCount,
}: MissionDashboardProps) {
  const [items, setItems] = useState<IntelligenceItem[]>(initialItems);
  const [briefings, setBriefings] = useState<Briefing[]>(initialBriefings);
  const [cacheTimestamp, setCacheTimestamp] = useState(initialCacheTimestamp);
  const [cacheExpiresAt, setCacheExpiresAt] = useState(initialCacheExpiresAt);
  const [secondaryStatus, setSecondaryStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [profile, setProfile] = useState<ProfileMode>("daily_overview");
  const [showBriefingPanel, setShowBriefingPanel] = useState(false);
  const [showPrintPanel, setShowPrintPanel] = useState(false);
  const [manualPriorityIds, setManualPriorityIds] = useState<string[]>([]);
  const [suppressedPriorityIds, setSuppressedPriorityIds] = useState<string[]>([]);
  const [printItemIds, setPrintItemIds] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<IntelligenceCategory[]>([]);
  const [geographySelection, setGeographySelection] = useState<GeographySelection>({
    type: "national",
    ids: [],
  });
  const [geoView, setGeoView] = useState<"list" | "map">("list");
  const [expandedRegionIds, setExpandedRegionIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState(initialItems[0]?.id ?? "");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sourceQuery, setSourceQuery] = useState("");
  const [regionalStatus, setRegionalStatus] = useState<RegionalStatus>("idle");
  const [regionalFreshness, setRegionalFreshness] = useState<string | undefined>();
  const [regionalCacheExpiresAt, setRegionalCacheExpiresAt] = useState<string | undefined>();
  const [regionalFromCache, setRegionalFromCache] = useState(false);
  const [regionalMessageIndex, setRegionalMessageIndex] = useState(0);
  const [regionalError, setRegionalError] = useState("");
  const [regionalLabels, setRegionalLabels] = useState<string[]>([]);
  const [cacheRefreshStatus, setCacheRefreshStatus] = useState<
    "idle" | "queued" | "loading" | "ready" | "error"
  >("idle");
  const [cacheRefreshJobStatus, setCacheRefreshJobStatus] = useState<
    CacheRefreshStatusPayload | undefined
  >();
  const [firstRunStatus, setFirstRunStatus] = useState<FirstRunStatusPayload | undefined>();
  const [firstRunRequestStatus, setFirstRunRequestStatus] = useState<
    "idle" | "starting" | "ready" | "error"
  >("idle");
  const regionalRequestCounter = useRef(0);
  const initiallyNeedsFirstRun = initialItems.length === 0 && initialBriefings.length === 0;
  const hasCachedIntelligence = items.length > 0 || briefings.length > 0;
  const showFirstRunPanel = initiallyNeedsFirstRun && !hasCachedIntelligence;

  const regionalRequestIds = useMemo(() => {
    if (geographySelection.type === "national") return [];
    return geographySelection.ids;
  }, [geographySelection]);

  const loadRegionalIntelligence = useCallback(
    async (regionIds: string[], force = false) => {
      const requestId = regionalRequestCounter.current + 1;
      regionalRequestCounter.current = requestId;

      if (regionIds.length === 0) {
        setRegionalStatus("idle");
        setRegionalFreshness(undefined);
        setRegionalCacheExpiresAt(undefined);
        setRegionalError("");
        setRegionalLabels([]);
        return;
      }

      setRegionalStatus("loading");
      setRegionalMessageIndex(0);
      setRegionalError("");
      setRegionalLabels([]);

      const responses = await Promise.all(
        regionIds.map(async (regionId) => {
          const params = new URLSearchParams({
            region: regionId,
            limit: "10",
          });
          if (force) params.set("force", "1");

          const response = await fetch(`/api/intelligence/regional?${params}`, {
            cache: "no-store",
          });

          if (!response.ok) {
            const payload = (await response.json().catch(() => ({}))) as { error?: string };
            throw new Error(payload.error ?? "Regional cache kunde inte uppdateras.");
          }

          return (await response.json()) as RegionalApiPayload;
        }),
      );

      const regionalRecords = responses.flatMap((response) => response.items);
      if (regionalRequestCounter.current !== requestId) return;

      setItems((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        const newItems = regionalRecords
          .map(processedRecordToIntelligenceItem)
          .filter((item) => !existingIds.has(item.id));
        return [...current, ...newItems];
      });

      setRegionalLabels(responses.map((response) => response.regionLabel));
      setRegionalFreshness(
        latestIso(responses.map((response) => response.freshnessTimestamp)),
      );
      setRegionalCacheExpiresAt(
        latestIso(responses.map((response) => response.cacheExpiresAt)),
      );
      setRegionalFromCache(responses.every((response) => response.fromCache));

      const hasItems = responses.some((response) => response.items.length > 0);
      const notConfigured = responses.every((response) => response.status === "not_configured");
      setRegionalStatus(notConfigured ? "not_configured" : hasItems ? "ready" : "empty");
    },
    [],
  );

  const loadCachedDashboardData = useCallback(async () => {
    const [processedResponse, briefingsResponse] = await Promise.all([
      fetch("/api/intelligence/processed?limit=220", { cache: "no-store" }),
      fetch("/api/intelligence/briefings?limit=12", { cache: "no-store" }),
    ]);

    if (!processedResponse.ok || !briefingsResponse.ok) {
      throw new Error("Cached dashboard data could not be refreshed");
    }

    const processedPayload = (await processedResponse.json()) as {
      items: ProcessedIntelligenceRecord[];
    };
    const briefingPayload = (await briefingsResponse.json()) as {
      briefings: Briefing[];
    };

    setItems((current) => {
      const existingIds = new Set(current.map((item) => item.id));
      const processedItems = processedPayload.items
        .map(processedRecordToIntelligenceItem)
        .filter((item) => !existingIds.has(item.id));
      return [...current, ...processedItems];
    });
    setBriefings(briefingPayload.briefings);
    setCacheTimestamp(
      briefingPayload.briefings[0]?.generated_at ??
        processedPayload.items[0]?.processed.processed_at ??
        initialCacheTimestamp,
    );
    setCacheExpiresAt(
      earliestIso([
        ...briefingPayload.briefings.map((briefing) => briefing.cache_expires_at),
        ...processedPayload.items.map((item) => item.processed.cache_expires_at),
      ]) ?? initialCacheExpiresAt,
    );
  }, [initialCacheExpiresAt, initialCacheTimestamp]);

  useEffect(() => {
    let cancelled = false;

    async function loadSecondaryData() {
      setSecondaryStatus("loading");

      try {
        await loadCachedDashboardData();
        if (cancelled) return;
        setSecondaryStatus("ready");
      } catch {
        if (cancelled) return;
        setSecondaryStatus("error");
      }
    }

    void loadSecondaryData();

    return () => {
      cancelled = true;
    };
  }, [loadCachedDashboardData]);

  useEffect(() => {
    if (!initiallyNeedsFirstRun) return;
    let cancelled = false;

    async function ensureFirstRun() {
      setFirstRunRequestStatus("starting");

      try {
        const response = await fetch("/api/intelligence/first-run/ensure", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });

        if (!response.ok) {
          throw new Error("Första insamlingen kunde inte startas.");
        }

        const payload = (await response.json()) as FirstRunStatusPayload;
        if (cancelled) return;
        setFirstRunStatus(payload);
        setFirstRunRequestStatus("ready");
      } catch {
        if (cancelled) return;
        setFirstRunRequestStatus("error");
      }
    }

    void ensureFirstRun();

    return () => {
      cancelled = true;
    };
  }, [initiallyNeedsFirstRun]);

  useEffect(() => {
    if (!initiallyNeedsFirstRun || !firstRunStatus?.active) return;
    let cancelled = false;

    const timer = window.setInterval(() => {
      void fetch("/api/intelligence/first-run/status", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("Could not fetch first-run status");
          return response.json() as Promise<FirstRunStatusPayload>;
        })
        .then((payload) => {
          if (cancelled) return;
          setFirstRunStatus(payload);
          if (payload.cacheExists || payload.job?.status === "completed") {
            void loadCachedDashboardData().catch(() => setSecondaryStatus("error"));
          }
        })
        .catch(() => {
          if (!cancelled) setFirstRunRequestStatus("error");
        });
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [firstRunStatus?.active, initiallyNeedsFirstRun, loadCachedDashboardData]);

  useEffect(() => {
    if (cacheRefreshStatus !== "queued" && cacheRefreshStatus !== "loading") return;
    let cancelled = false;

    const timer = window.setInterval(() => {
      void fetch("/api/intelligence/cache/refresh", { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error("Could not fetch refresh status");
          return response.json() as Promise<CacheRefreshStatusPayload>;
        })
        .then((payload) => {
          if (cancelled) return;
          setCacheRefreshJobStatus(payload);

          if (payload.active) {
            setCacheRefreshStatus("queued");
            return;
          }

          if (payload.job?.status === "failed") {
            setCacheRefreshStatus("error");
            return;
          }

          if (payload.job?.status === "completed") {
            setCacheRefreshStatus("ready");
            void loadCachedDashboardData().catch(() => setSecondaryStatus("error"));
          }
        })
        .catch(() => {
          if (!cancelled) setCacheRefreshStatus("error");
        });
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [cacheRefreshStatus, loadCachedDashboardData]);

  useEffect(() => {
    if (regionalRequestIds.length === 0) {
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        await loadRegionalIntelligence(regionalRequestIds, false);
      } catch (error) {
        if (cancelled) return;
        setRegionalStatus("error");
        setRegionalError(
          error instanceof Error
            ? error.message
            : "Regional intelligens kunde inte läsas in.",
        );
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [loadRegionalIntelligence, regionalRequestIds]);

  useEffect(() => {
    if (regionalStatus !== "loading") return;
    const timer = window.setInterval(() => {
      setRegionalMessageIndex((value) => (value + 1) % 3);
    }, 1500);

    return () => window.clearInterval(timer);
  }, [regionalStatus]);

  const baseFilteredItems = useMemo(() => {
    return items
      .filter((item) =>
        selectedCategories.length === 0
          ? true
          : selectedCategories.includes(item.category),
      )
      .filter((item) => itemMatchesGeography(item, config, geographySelection))
      .sort(byScore(config, profile));
  }, [config, geographySelection, items, profile, selectedCategories]);

  const filteredItems = baseFilteredItems;

  const highSignalItems = filteredItems.filter(
    (item) => getCompositeScore(item, config, profile) >= 55,
  );
  const manualPriorityItems = manualPriorityIds
    .map((id) => filteredItems.find((item) => item.id === id))
    .filter((item): item is IntelligenceItem => Boolean(item));
  const automaticPriorityItems = (highSignalItems.length > 0 ? highSignalItems : filteredItems)
    .filter((item) => !suppressedPriorityIds.includes(item.id));
  const automaticTopItems = automaticPriorityItems.slice(0, 5);
  const priorityItems = [
    ...manualPriorityItems,
    ...automaticTopItems.filter((item) => !manualPriorityIds.includes(item.id)),
  ];
  const topFive = priorityItems;
  const prioritizedIds = topFive.map((item) => item.id);
  const printItems = printItemIds
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is IntelligenceItem => Boolean(item));
  const expandedItem =
    filteredItems.find((item) => item.id === expandedId) ?? filteredItems[0];

  const toggleManualPriority = (id: string, checked: boolean) => {
    if (checked) {
      setSuppressedPriorityIds((current) => current.filter((itemId) => itemId !== id));
      setManualPriorityIds((current) => [id, ...current.filter((itemId) => itemId !== id)]);
      setExpandedId(id);
      return;
    }

    setManualPriorityIds((current) => current.filter((itemId) => itemId !== id));
    setSuppressedPriorityIds((current) =>
      current.includes(id) ? current : [id, ...current],
    );
  };

  const togglePrintItem = (id: string, checked: boolean) => {
    setPrintItemIds((current) =>
      checked
        ? [id, ...current.filter((itemId) => itemId !== id)]
        : current.filter((itemId) => itemId !== id),
    );
  };

  const sourceRows = filteredItems.filter((item) => {
    const q = sourceQuery.trim().toLowerCase();
    if (!q) return true;
    return [
      item.title_original,
      item.title_sv,
      item.source_name,
      item.source_country,
      item.source_language,
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  const activeGeoLabel = useMemo(() => {
    if (geographySelection.type === "national") return config.geography.nationalLabel;
    if (geographySelection.type === "region") {
      return geographySelection.ids
        .map(
          (id) =>
            config.geography.regions.find((region) => region.id === id)?.displayName,
        )
        .filter(Boolean)
        .join(", ");
    }
    return geographySelection.ids
      .map(
        (id) =>
          config.geography.administrativeDivisions.find((division) => division.id === id)
            ?.displayName,
      )
      .filter(Boolean)
      .join(", ");
  }, [config, geographySelection]);

  const regionalLoadingMessages = useMemo(() => {
    const label = regionalLabels[0] ?? activeGeoLabel;
    return [
      `Hämtar regional cache för ${label}...`,
      "Rankar relevanta råposter...",
      "Komprimerar till regionala signaler...",
    ];
  }, [activeGeoLabel, regionalLabels]);

  const handleRegionalRefresh = useCallback(async () => {
    try {
      await loadRegionalIntelligence(regionalRequestIds, true);
    } catch (error) {
      setRegionalStatus("error");
      setRegionalError(
        error instanceof Error
          ? error.message
          : "Regional intelligens kunde inte uppdateras.",
      );
    }
  }, [loadRegionalIntelligence, regionalRequestIds]);

  const handleNationalCacheRefresh = useCallback(async () => {
    setCacheRefreshStatus("loading");
    try {
      const response = await fetch("/api/intelligence/cache/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "all",
          rescanSources: true,
          force: false,
          limitPerSource: 12,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Cacheuppdatering kunde inte köas.");
      }

      const payload = (await response.json()) as CacheRefreshStatusPayload;
      setCacheRefreshJobStatus(payload);
      setCacheRefreshStatus("queued");
    } catch {
      setCacheRefreshStatus("error");
    }
  }, []);

  const handleFirstRunRetry = useCallback(async () => {
    setFirstRunRequestStatus("starting");
    try {
      const response = await fetch("/api/intelligence/first-run/ensure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });

      if (!response.ok) {
        throw new Error("Första insamlingen kunde inte startas om.");
      }

      setFirstRunStatus((await response.json()) as FirstRunStatusPayload);
      setFirstRunRequestStatus("ready");
    } catch {
      setFirstRunRequestStatus("error");
    }
  }, []);

  const toggleCategory = (category: IntelligenceCategory) => {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  };

  const activateSignalView = () => {
    setProfile("daily_overview");
    setShowBriefingPanel(false);
    setShowPrintPanel(false);
  };

  const toggleDivision = (id: string) => {
    activateSignalView();
    setGeographySelection((current) => {
      const currentIds = current.type === "division" ? current.ids : [];
      const nextIds = currentIds.includes(id)
        ? currentIds.filter((item) => item !== id)
        : [...currentIds, id];

      return nextIds.length === 0
        ? { type: "national", ids: [] }
        : { type: "division", ids: nextIds };
    });
  };

  const toggleRegion = (id: string) => {
    activateSignalView();
    setGeographySelection((current) => {
      const currentIds = current.type === "region" ? current.ids : [];
      const nextIds = currentIds.includes(id)
        ? currentIds.filter((item) => item !== id)
        : [...currentIds, id];

      return nextIds.length === 0
        ? { type: "national", ids: [] }
        : { type: "region", ids: nextIds };
    });
  };

  const toggleRegionExpansion = (id: string) => {
    setExpandedRegionIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  };

  const swedenRelevantCount = filteredItems.filter(
    (item) => item.sweden_relevance_score >= 75,
  ).length;
  const morningBriefing = briefings.find((briefing) => briefing.type === "morning_brief");
  const ambassadorBriefing =
    briefings.find((briefing) => briefing.type === "ambassador_brief") ?? morningBriefing;
  const hasPrimaryData = Boolean(ambassadorBriefing || topFive.length > 0);

  return (
    <main className={clsx("missiondesk", theme === "light" && "light")}>
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-5 px-4 py-4 sm:px-6 lg:px-7">
        <header className="surface-strong flex flex-col gap-5 rounded-lg px-5 py-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)]">
              <Building2 className="h-6 w-6 text-[var(--app-accent)]" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--app-muted)]">
                <span>Sveriges ambassad</span>
                <span className="h-1 w-1 rounded-full bg-[var(--app-gold)]" />
                <span>{config.city}</span>
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-[var(--app-fg)] sm:text-4xl">
                MissionDesk
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
                Verifierade signaler för snabb daglig orientering.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-start gap-2 lg:max-w-[520px] lg:justify-end">
            <a
              href="/sources"
              className="flex min-h-12 min-w-[92px] flex-col justify-between rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-2.5 py-1.5 text-left transition hover:border-[var(--app-accent)] hover:text-[var(--app-fg)]"
              aria-label="Öppna källhanteraren"
            >
              <span className="flex items-center justify-between gap-2 text-[11px] leading-none text-[var(--app-fg)]">
                {activeSourceCount} {activeSourceCount === 1 ? "källa" : "källor"}
                <Database className="h-3 w-3 text-[var(--app-muted)]" />
              </span>
              <span className="text-[11px] leading-4 text-[var(--app-muted)]">Hantera</span>
            </a>
            <button
              type="button"
              onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
              className="flex min-h-12 min-w-[92px] flex-col justify-between rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-2.5 py-1.5 text-left transition hover:border-[var(--app-accent)] hover:text-[var(--app-fg)]"
              aria-label="Växla färgtema"
            >
              <span className="flex items-center justify-between gap-2 text-[11px] leading-none text-[var(--app-fg)]">
                Tema
                {theme === "dark" ? <Moon className="h-3 w-3 text-[var(--app-muted)]" /> : <Sun className="h-3 w-3 text-[var(--app-muted)]" />}
              </span>
              <span className="text-[11px] leading-4 text-[var(--app-muted)]">
                {theme === "dark" ? "Mörkt" : "Ljust"}
              </span>
            </button>
          </div>
        </header>

        <section className="surface flex flex-col gap-3 rounded-lg px-4 py-3 text-sm text-[var(--app-soft)] md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <span
              className={clsx(
                "h-2.5 w-2.5 shrink-0 rounded-full",
                hasPrimaryData && "bg-[var(--app-positive)]",
                !hasPrimaryData && "bg-[var(--app-warning)]",
              )}
            />
            <span>
              {hasPrimaryData
                ? `Färsk lägesbild${cacheTimestamp ? ` · uppdaterad ${formatDate(cacheTimestamp, true)}` : ""}.`
                : "Ingen färsk lägesbild ännu. Avvaktar bakgrundsjobb."}
            </span>
          </div>
          {secondaryStatus === "loading" && (
            <span className="text-xs text-[var(--app-muted)]">
              Hämtar underlag...
            </span>
          )}
          {secondaryStatus === "error" && (
            <span className="text-xs text-[var(--app-warning)]">
              Källor och verifiering kunde inte uppdateras just nu.
            </span>
          )}
          {cacheExpiresAt && (
            <span className="text-xs text-[var(--app-muted)]">
              Cache till {formatDate(cacheExpiresAt, true)}
            </span>
          )}
          {geographySelection.type !== "national" && (
            <span
              className={clsx(
                "text-xs",
                regionalStatus === "error"
                  ? "text-[var(--app-warning)]"
                  : "text-[var(--app-muted)]",
              )}
            >
              {regionalStatus === "loading"
                ? regionalLoadingMessages[regionalMessageIndex]
                : regionalStatus === "ready"
                  ? `Regional cache ${regionalFreshness ? `uppdaterad ${formatDate(regionalFreshness, true)}` : "redo"}`
                  : regionalStatus === "empty"
                    ? "Inga regionala signaler över tröskeln"
                    : regionalStatus === "error"
                      ? regionalError || "Regional signalbearbetning misslyckades"
                      : null}
            </span>
          )}
          {cacheRefreshJobStatus && cacheRefreshStatus !== "idle" && (
            <span
              className={clsx(
                "text-xs",
                cacheRefreshStatus === "error"
                  ? "text-[var(--app-warning)]"
                  : "text-[var(--app-muted)]",
              )}
            >
              {cacheRefreshJobStatus.message}
              {cacheRefreshJobStatus.active
                ? ` ${Math.round(cacheRefreshJobStatus.progressPercent)}%`
                : ""}
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleNationalCacheRefresh()}
            disabled={cacheRefreshStatus === "loading" || cacheRefreshStatus === "queued"}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-xs font-medium text-[var(--app-soft)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-fg)] disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw
              className={clsx(
                "h-3.5 w-3.5",
                (cacheRefreshStatus === "loading" || cacheRefreshStatus === "queued") &&
                  "animate-spin",
              )}
            />
            {cacheRefreshStatus === "loading"
              ? "Startar..."
              : cacheRefreshStatus === "queued"
                ? "Skannar..."
                : cacheRefreshStatus === "ready"
                  ? "Uppdatera igen"
                  : cacheRefreshStatus === "error"
                    ? "Försök igen"
                    : "Uppdatera"}
          </button>
        </section>

        {showFirstRunPanel && (
          <FirstRunPanel
            status={firstRunStatus}
            requestStatus={firstRunRequestStatus}
            onRetry={() => void handleFirstRunRetry()}
          />
        )}

        <div className="grid gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="thin-scrollbar surface-strong rounded-xl p-4 xl:sticky xl:top-4 xl:max-h-[calc(100dvh-2rem)] xl:self-start xl:overflow-y-auto xl:overscroll-contain">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SectionKicker icon={Filter} label="Filter" />
                <p className="mt-2 text-xs leading-5 text-[var(--app-muted)]">
                  Välj perspektiv, tematiska filter och geografi utan att lämna huvudflödet.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-5">
              <div>
                <p className="mb-2 text-xs leading-5 text-[var(--app-muted)]">Perspektiv</p>
                <div className="grid gap-2">
                  <SidebarBriefingToggle
                    active={showBriefingPanel && !showPrintPanel}
                    briefing={ambassadorBriefing}
                    onClick={() => {
                      setShowBriefingPanel(true);
                      setShowPrintPanel(false);
                    }}
                  />
                  {config.profileModes
                    .filter(
                      (mode) =>
                        mode.id !== "sweden_connection" &&
                        mode.id !== "ambassador_briefing" &&
                        mode.id !== "trade_business" &&
                        mode.id !== "political_risk" &&
                        mode.id !== "security",
                    )
                    .map((mode) => {
                    const Icon = profileIcon[mode.id];
                    const active = !showBriefingPanel && !showPrintPanel && mode.id === profile;
                    return (
                      <div key={mode.id} className="grid gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setProfile(mode.id);
                            setShowBriefingPanel(false);
                            setShowPrintPanel(false);
                          }}
                          className={clsx(
                            "flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition",
                            active
                              ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_86%)]"
                              : "border-[var(--app-line)] bg-[var(--app-panel-muted)] hover:border-[var(--app-accent)]",
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0 text-[var(--app-accent)]" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-[var(--app-fg)]">
                              {mode.label}
                            </span>
                            <span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">
                              {mode.shortLabel}
                            </span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setShowBriefingPanel(false);
                      setShowPrintPanel(true);
                    }}
                    className={clsx(
                      "flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition",
                      showPrintPanel
                        ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_86%)]"
                        : "border-[var(--app-line)] bg-[var(--app-panel-muted)] hover:border-[var(--app-accent)]",
                    )}
                  >
                    <Printer className="h-4 w-4 shrink-0 text-[var(--app-accent)]" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[var(--app-fg)]">
                        Skapa mötesunderlag
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">
                        Anpassad utskrift
                      </span>
                    </span>
                  </button>
                </div>
              </div>

              <div className="border-t border-[var(--app-line)] pt-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs leading-5 text-[var(--app-muted)]">Regional filtrering</p>
                  <div className="flex rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-1">
                    <IconButton
                      label="Lista"
                      active={geoView === "list"}
                      onClick={() => setGeoView("list")}
                      icon={ListFilter}
                    />
                    <IconButton
                      label="Karta"
                      active={geoView === "map"}
                      onClick={() => setGeoView("map")}
                      icon={MapIcon}
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    activateSignalView();
                    setGeographySelection({ type: "national", ids: [] });
                  }}
                  className={clsx(
                    "mt-3 flex w-full items-center justify-between rounded-lg border px-3 py-3 text-left transition",
                    geographySelection.type === "national"
                      ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_86%)]"
                      : "border-[var(--app-line)] bg-[var(--app-panel-muted)] hover:border-[var(--app-accent)]",
                  )}
                >
                  <span>
                    <span className="block text-sm font-medium">Nationellt</span>
                    <span className="block text-xs text-[var(--app-muted)]">
                      Utgångsläget för hela landet
                    </span>
                  </span>
                  {geographySelection.type === "national" && (
                    <Check className="h-4 w-4 text-[var(--app-accent)]" />
                  )}
                </button>

                <div className="mt-3 space-y-3">
                  {config.geography.regions.map((region) => {
                    const active =
                      geographySelection.type === "region" &&
                      geographySelection.ids.includes(region.id);
                    const hasActiveDivision =
                      geographySelection.type === "division" &&
                      geographySelection.ids.some((id) => region.divisionIds.includes(id));
                    const expanded = expandedRegionIds.includes(region.id) || hasActiveDivision;
                    const divisions = config.geography.administrativeDivisions.filter(
                      (division) => region.divisionIds.includes(division.id),
                    );

                    return (
                      <div
                        key={region.id}
                        className="rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-2"
                      >
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => toggleRegion(region.id)}
                            className={clsx(
                              "w-full rounded-md border px-3 py-2 text-left transition",
                              active
                                ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_86%)]"
                                : "border-transparent bg-transparent hover:border-[var(--app-accent)] hover:bg-[var(--app-panel-muted)]",
                            )}
                          >
                            <span className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-[var(--app-fg)]">
                                {region.displayName}
                              </span>
                              <span className="font-mono text-xs text-[var(--app-muted)]">
                                {region.divisionIds.length}
                              </span>
                            </span>
                            <span className="mt-1 block pr-7 text-xs leading-5 text-[var(--app-muted)]">
                              {region.description}
                            </span>
                          </button>

                          <button
                            type="button"
                            aria-expanded={expanded}
                            aria-label={
                              expanded
                                ? `Dölj delstater i ${region.displayName}`
                                : `Visa delstater i ${region.displayName}`
                            }
                            onClick={() => toggleRegionExpansion(region.id)}
                            className="absolute bottom-2 right-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded text-[var(--app-muted)] transition hover:bg-[var(--app-panel)] hover:text-[var(--app-fg)]"
                          >
                            <ChevronDown
                              className={clsx(
                                "h-3 w-3 opacity-80 transition-transform",
                                expanded && "rotate-180",
                              )}
                            />
                          </button>
                        </div>

                        {expanded && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {divisions.map((division) => {
                              const divisionActive =
                                geographySelection.type === "division" &&
                                geographySelection.ids.includes(division.id);

                              return (
                                <button
                                  key={division.id}
                                  type="button"
                                  onClick={() => toggleDivision(division.id)}
                                  className={clsx(
                                    "inline-flex min-h-7 max-w-full items-center rounded-[4px] border px-2 py-1 text-left text-[11px] font-medium leading-4 transition",
                                    divisionActive
                                      ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_84%)] text-[var(--app-accent-strong)]"
                                      : "border-[var(--app-line)] bg-[var(--app-panel)] text-[var(--app-soft)] hover:border-[var(--app-accent)]",
                                  )}
                                >
                                  <span className="min-w-0 whitespace-nowrap">
                                    {division.displayName}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-[var(--app-line)] pt-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs leading-5 text-[var(--app-muted)]">Tematiska filter</p>
                  {selectedCategories.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedCategories([])}
                      className="text-xs text-[var(--app-accent)] hover:text-[var(--app-accent-strong)]"
                    >
                      Rensa
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {getOrderedThemeCategories(config).map((category) => {
                    const active = selectedCategories.includes(category.id);
                    const Icon = categoryIcon[category.id];
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => toggleCategory(category.id)}
                        className={clsx(
                          "inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-[4px] border px-2 py-1 text-left text-[11px] font-medium leading-4 transition",
                          active
                            ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_86%)] text-[var(--app-accent-strong)]"
                            : "border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-soft)] hover:border-[var(--app-accent)]",
                        )}
                      >
                        <Icon
                          className={clsx(
                            "h-3 w-3 shrink-0",
                            categoryIconTone[category.id],
                            active && "brightness-125",
                          )}
                        />
                        <span className="min-w-0 whitespace-nowrap">{category.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-6">
            {showBriefingPanel && !showPrintPanel && (
              <PrimaryBriefingPanel
                briefing={ambassadorBriefing}
                fallbackItems={topFive}
                allItems={items}
                cacheTimestamp={cacheTimestamp}
                config={config}
              />
            )}

            {showBriefingPanel && !showPrintPanel && (
              <SourceFeed
                rows={sourceRows}
                query={sourceQuery}
                onQueryChange={setSourceQuery}
                config={config}
                profile={profile}
                prioritizedIds={prioritizedIds}
                onTogglePriority={toggleManualPriority}
              />
            )}

            {showPrintPanel && (
              <CustomPrintPanel
                items={printItems}
                config={config}
                cacheTimestamp={cacheTimestamp}
                onRemove={(id) => togglePrintItem(id, false)}
              />
            )}

            {!showBriefingPanel && !showPrintPanel && (
              <section className="surface-strong rounded-xl p-5">
                <div className="flex flex-col gap-3 border-b border-[var(--app-line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <SectionKicker icon={Target} label="Aktuella signaler" />
                      <span className="text-xs text-[var(--app-muted)]">–</span>
                      <span className="inline-flex items-center rounded border border-[color-mix(in_srgb,var(--app-gold),transparent_42%)] bg-[color-mix(in_srgb,var(--app-gold),transparent_86%)] px-2 py-1 text-xs font-medium text-[var(--app-gold)]">
                        {activeGeoLabel || config.geography.nationalLabel}
                      </span>
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-normal">
                      Prioriterade signaler
                    </h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
                      Bearbetade signaler från verifierade källor. Öppna en signal för
                      spårbarhet, relevans och uppföljning.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Pill tone="neutral">{filteredItems.length} signaler</Pill>
                    <Pill tone={swedenRelevantCount > 0 ? "gold" : "neutral"}>
                      {swedenRelevantCount > 0
                        ? `${swedenRelevantCount} med Sverigekoppling`
                        : "Ingen tydlig svensk koppling"}
                    </Pill>
                  </div>
                </div>

                <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="space-y-3">
                    {topFive.length > 0 ? (
                      topFive.map((item, index) => (
                        <IntelligenceCard
                          key={item.id}
                          item={item}
                          index={index}
                          config={config}
                          profile={profile}
                          active={expandedItem?.id === item.id}
                          onSelect={() => setExpandedId(item.id)}
                          onUnprioritize={() => toggleManualPriority(item.id, false)}
                        />
                      ))
                    ) : (
                      <SkeletonStack
                        label={
                          geographySelection.type === "national"
                            ? "Ingen färsk nationell signalcache"
                            : "Ingen regional signal över tröskeln"
                        }
                      />
                    )}
                  </div>

                  <DetailPanel
                    item={expandedItem}
                    composite={expandedItem ? getCompositeScore(expandedItem, config, profile) : 0}
                    config={config}
                    printSelected={expandedItem ? printItemIds.includes(expandedItem.id) : false}
                    onTogglePrint={
                      expandedItem
                        ? (checked) => togglePrintItem(expandedItem.id, checked)
                        : undefined
                    }
                  />
                </div>
              </section>
            )}

            {!showBriefingPanel && !showPrintPanel && (
              <SourceFeed
                rows={sourceRows}
                query={sourceQuery}
                onQueryChange={setSourceQuery}
                config={config}
                profile={profile}
                prioritizedIds={prioritizedIds}
                onTogglePriority={toggleManualPriority}
              />
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function CustomPrintPanel({
  items,
  config,
  cacheTimestamp,
  onRemove,
}: {
  items: IntelligenceItem[];
  config: EmbassyConfig;
  cacheTimestamp?: string;
  onRemove: (id: string) => void;
}) {
  const [printGeneratedAt, setPrintGeneratedAt] = useState(() => new Date().toISOString());

  const handlePrint = () => {
    setPrintGeneratedAt(new Date().toISOString());
    window.setTimeout(() => window.print(), 0);
  };

  return (
    <section className="missiondesk-print-panel surface-strong rounded-xl p-5">
      <div className="flex flex-col gap-4 border-b border-[var(--app-line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="missiondesk-print-title text-2xl font-semibold tracking-normal">
            Mötesunderlag
          </h2>
          <p className="missiondesk-print-meta mt-1 text-sm">
            Sveriges ambassad · {config.city}
          </p>
          <p className="missiondesk-print-generated text-sm">
            Utskriven {formatDate(printGeneratedAt, true)}
          </p>
          <div className="missiondesk-print-screen-header">
            <SectionKicker icon={Printer} label="Skapa mötesunderlag" />
            <h2 className="mt-3 text-2xl font-semibold tracking-normal">
              Anpassad utskrift
            </h2>
            <p className="mt-1 text-sm text-[var(--app-muted)]">
              MissionDesk · Sveriges ambassad · {config.city}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
              Valda signaler sammanställs med kort sammanfattning, betydelse och spårbar källa.
            </p>
          </div>
        </div>
        <div className="missiondesk-print-actions flex flex-wrap gap-2">
          <Pill tone="neutral">{items.length} valda signaler</Pill>
          {cacheTimestamp && <Pill tone="accent">Uppdaterad {formatDate(cacheTimestamp, true)}</Pill>}
          <button
            type="button"
            onClick={handlePrint}
            disabled={items.length === 0}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-xs font-medium text-[var(--app-soft)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Printer className="h-3.5 w-3.5" />
            Skriv ut
          </button>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="missiondesk-print-list mt-4 space-y-3">
          {items.map((item, index) => {
            const Icon = categoryIcon[item.category];

            return (
              <article
                key={item.id}
                className="missiondesk-print-item rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="missiondesk-print-title-row">
                      <div className="missiondesk-print-meta-line mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
                        <span className="missiondesk-print-index font-mono text-[var(--app-gold)]">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                        <span className="flex items-center gap-1.5">
                          <Icon className={clsx("h-3.5 w-3.5", categoryIconTone[item.category])} />
                          {getCategoryLabel(config, item.category)}
                        </span>
                        <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                        <span>{getGeographyLabel(item, config)}</span>
                        <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                        <span>{formatDate(item.published_at, true)}</span>
                      </div>
                      <h3 className="min-w-0 text-base font-semibold leading-6 text-[var(--app-fg)]">
                        {item.title_sv}
                      </h3>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(item.id)}
                    className="missiondesk-print-remove shrink-0 rounded border border-[var(--app-line)] bg-[var(--app-panel)] px-2 py-1 text-xs text-[var(--app-muted)] transition hover:border-[var(--app-danger)] hover:text-[var(--app-danger)]"
                  >
                    Ta bort
                  </button>
                </div>

                <div className="mt-3 space-y-2.5">
                  <div>
                    <p className="missiondesk-summary-label text-xs tracking-[0.08em] text-[var(--app-muted)]">
                      Sammanfattning
                    </p>
                    <p className="mt-1 text-sm leading-5 text-[var(--app-soft)]">
                      {item.summary_sv}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs tracking-[0.08em] text-[var(--app-muted)]">
                      Varför det kan spela roll
                    </p>
                    <p className="mt-1 text-sm leading-5 text-[var(--app-soft)]">
                      {item.why_it_matters_sv}
                    </p>
                  </div>
                  <div className="missiondesk-print-source text-xs leading-5 text-[var(--app-muted)]">
                    <span className="font-medium text-[var(--app-soft)]">
                      {item.source_name}
                    </span>
                    <span className="mx-1 text-[var(--app-muted)]">·</span>
                    <a
                      href={item.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all font-medium text-[var(--app-accent)] hover:text-[var(--app-accent-strong)]"
                    >
                      {item.source_url}
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="mt-5">
          <EmptyState title="Inga signaler valda för anpassad utskrift" />
        </div>
      )}
    </section>
  );
}

function SectionKicker({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium tracking-[0.08em] text-[var(--app-muted)]">
      <Icon className="h-4 w-4 text-[var(--app-accent)]" />
      {label}
    </div>
  );
}

function IconButton({
  label,
  active,
  onClick,
  icon: Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: LucideIcon;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={clsx(
        "rounded px-2 py-1 transition",
        active
          ? "bg-[var(--app-panel-strong)] text-[var(--app-accent)]"
          : "text-[var(--app-muted)] hover:text-[var(--app-fg)]",
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function SidebarBriefingToggle({
  active,
  briefing,
  onClick,
}: {
  active: boolean;
  briefing?: Briefing;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition",
        active
          ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_86%)]"
          : "border-[var(--app-line)] bg-[var(--app-panel-muted)] hover:border-[var(--app-accent)]",
      )}
      aria-pressed={active}
    >
      <Gauge className="h-4 w-4 shrink-0 text-[var(--app-accent)]" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--app-fg)]">Briefing</span>
        <span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">
          Daglig överblick
        </span>
      </span>
    </button>
  );
}

function RegionalCachePanel({
  label,
  status,
  message,
  freshnessTimestamp,
  cacheExpiresAt,
  fromCache,
  error,
  onRefresh,
}: {
  label: string;
  status: RegionalStatus;
  message: string;
  freshnessTimestamp?: string;
  cacheExpiresAt?: string;
  fromCache: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const isLoading = status === "loading";
  const statusText =
    status === "ready"
      ? fromCache
        ? "Regional lägesbild redo"
        : "Regional lägesbild uppdaterad"
      : status === "empty"
        ? "Inga regionala signaler över tröskeln"
        : status === "not_configured"
          ? "AI-nyckel saknas för regional signalbearbetning"
          : status === "error"
            ? "Regional signalbearbetning misslyckades"
            : message;

  return (
    <section className="surface flex flex-col gap-3 rounded-lg px-4 py-3 text-sm text-[var(--app-soft)] lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={clsx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)]",
            status === "error" && "text-[var(--app-danger)]",
            status !== "error" && "text-[var(--app-accent)]",
          )}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Clock3 className="h-4 w-4" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block font-medium text-[var(--app-fg)]">{label}</span>
          <span className="block text-xs leading-5 text-[var(--app-muted)]">
            {isLoading ? message : error || statusText}
          </span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {freshnessTimestamp && (
          <Pill tone="neutral">Uppdaterad {formatDate(freshnessTimestamp, true)}</Pill>
        )}
        {cacheExpiresAt && (
          <Pill tone="neutral">Giltig till {formatDate(cacheExpiresAt, true)}</Pill>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-xs font-medium text-[var(--app-soft)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-fg)] disabled:cursor-wait disabled:opacity-60"
        >
          <RefreshCw className={clsx("h-3.5 w-3.5", isLoading && "animate-spin")} />
          Uppdatera
        </button>
      </div>
    </section>
  );
}

function FirstRunPanel({
  status,
  requestStatus,
  onRetry,
}: {
  status?: FirstRunStatusPayload;
  requestStatus: "idle" | "starting" | "ready" | "error";
  onRetry: () => void;
}) {
  const job = status?.job;
  const failed = job?.status === "failed" || requestStatus === "error";
  const active = requestStatus === "starting" || status?.active;
  const completed = job?.status === "completed" || status?.cacheExists;
  const progressPercent = Math.max(0, Math.min(100, status?.progressPercent ?? 8));
  const activeStepIndex = Math.max(0, Math.min(3, status?.activeStepIndex ?? 0));
  const steps =
    status?.steps && status.steps.length > 0
      ? status.steps
      : [
          "Hämtar verifierade källor…",
          "Deduplicerar och prioriterar…",
          "Bearbetar relevanta items…",
          "Genererar briefing…",
        ];
  const visibleLogs = status?.logs?.slice(-5) ?? [];
  const userMessage = status?.missingSources
    ? "Inga källor är konfigurerade ännu."
    : status?.missingApiKey
      ? "Kan inte bearbeta källor: OPENAI_API_KEY saknas."
      : failed
        ? (job?.error_message ?? "Första insamlingen kunde inte startas.")
        : completed
          ? "Första insamlingen är klar. Cachead lägesbild laddas in."
          : "Första insamlingen har startats automatiskt.";

  return (
    <section className="surface-strong rounded-lg p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <SectionKicker icon={Database} label="Första insamling" />
          <h2 className="mt-3 text-xl font-semibold">Ingen cachead briefing finns ännu.</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
            {userMessage}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]">
            {status?.estimatedDurationLabel ?? "Första körningen tar oftast 3-10 minuter."} Detta
            körs i bakgrunden; du kan lämna sidan öppen eller komma tillbaka.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={failed ? "danger" : active ? "accent" : "neutral"}>
            {job?.status ?? (requestStatus === "starting" ? "pending" : "queued")}
          </Pill>
          {job?.updated_at && <Pill tone="neutral">Senast {formatDate(job.updated_at, true)}</Pill>}
          {failed && (
            <button
              type="button"
              onClick={onRetry}
              disabled={requestStatus === "starting"}
              className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-xs font-medium text-[var(--app-soft)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-fg)] disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw
                className={clsx("h-3.5 w-3.5", requestStatus === "starting" && "animate-spin")}
              />
              Försök igen
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--app-muted)]">
              Totalt förlopp
            </p>
            <p className="mt-1 text-sm text-[var(--app-soft)]">
              Steg {activeStepIndex + 1} av {steps.length}: {steps[activeStepIndex]}
            </p>
          </div>
          <span className="font-mono text-sm text-[var(--app-fg)]">{progressPercent}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--app-line)]">
          <div
            className={clsx(
              "h-full rounded-full transition-all duration-500",
              failed ? "bg-[var(--app-danger)]" : "bg-[var(--app-accent)]",
            )}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        {status?.longRunning && active && (
          <p className="mt-3 text-xs leading-5 text-[var(--app-warning)]">
            Det tar längre tid än väntat. Om statusen inte ändras, kontrollera källor, nätverk och
            API-nyckel.
          </p>
        )}
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        {steps.map((step, index) => (
          <div
            key={step}
            className={clsx(
              "rounded-md border bg-[var(--app-panel-muted)] p-3",
              index === activeStepIndex && active
                ? "border-[var(--app-accent)]"
                : "border-[var(--app-line)]",
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs text-[var(--app-muted)]">
                {String(index + 1).padStart(2, "0")}
              </span>
              {active && index === activeStepIndex ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--app-accent)]" />
              ) : completed || index < activeStepIndex ? (
                <Check className="h-3.5 w-3.5 text-[var(--app-positive)]" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-line)]" />
              )}
            </div>
            <p className="mt-3 text-xs leading-5 text-[var(--app-soft)]">{step}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2 text-xs text-[var(--app-muted)] md:grid-cols-3">
        <span>Jobb-id: {job?.id ?? "skapas"}</span>
        <span>Skapad: {job?.created_at ? formatDate(job.created_at, true) : "väntar"}</span>
        <span>
          Status:{" "}
          {status?.missingApiKey
            ? "API-nyckel saknas"
            : status?.missingSources
              ? "Källor saknas"
              : status?.message ?? "Startar"}
        </span>
      </div>

      {visibleLogs.length > 0 && (
        <div className="mt-4 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--app-muted)]">
            Senaste aktivitet
          </p>
          <div className="mt-3 space-y-2">
            {visibleLogs.map((entry) => (
              <div
                key={`${entry.at}-${entry.message}`}
                className="flex flex-col gap-1 text-xs text-[var(--app-soft)] sm:flex-row sm:items-center sm:justify-between"
              >
                <span>{entry.message}</span>
                <span className="font-mono text-[var(--app-muted)]">
                  {formatDate(entry.at, true)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-xs leading-5 text-[var(--app-muted)]">
        Dashboarden visar bara verifierade, cacheade signaler. Ingen nyhet fabriceras och ingen AI
        körs i sidladdningen.
      </p>
    </section>
  );
}

function PrimaryBriefingPanel({
  briefing,
  fallbackItems,
  allItems,
  cacheTimestamp,
  config,
}: {
  briefing?: Briefing;
  fallbackItems: IntelligenceItem[];
  allItems: IntelligenceItem[];
  cacheTimestamp?: string;
  config: EmbassyConfig;
}) {
  const lines = briefing?.content_sv
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s*/, "").replace(/^\d+[.)]\s*/, ""))
    .filter(Boolean)
    .filter((line) => !/^(ambassadörsbrief|briefing|morning brief|morgonbrief)\b/i.test(line))
    .slice(0, 7);

  const sourceCount = briefing?.source_item_ids.length ?? fallbackItems.length;
  const sourceItems = briefing
    ? briefing.source_item_ids
        .map((sourceId) =>
          allItems.find((item) => item.id === `processed-${sourceId}`),
        )
        .filter((item): item is IntelligenceItem => Boolean(item))
    : fallbackItems.slice(0, 5);

  return (
    <section className="surface-strong rounded-xl p-6">
      <div className="flex flex-col gap-3 border-b border-[var(--app-line)] pb-5">
        <SectionKicker icon={Gauge} label="Briefing" />
        <h2 className="text-2xl font-semibold tracking-normal">
          Daglig överblick med verifierbart underlag
        </h2>
        <p className="max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
          En kort lägesbild av de viktigaste utvecklingarna. Varje punkt kan följas tillbaka
          till verifierade signaler och originalkällor.
        </p>
        <div className="flex flex-wrap gap-2">
          <Pill tone={briefing ? "accent" : "neutral"}>
            {briefing
              ? `Genererad ${formatDate(briefing.generated_at, true)}`
              : cacheTimestamp
                ? `Cache ${formatDate(cacheTimestamp, true)}`
                : "Inväntar briefing"}
          </Pill>
          <Pill tone="neutral">Underlag {sourceCount}</Pill>
          <Pill tone="neutral">Bearbetad från verifierade källor</Pill>
        </div>
      </div>

      {lines && lines.length > 0 ? (
        <ol className="mt-5 space-y-3">
          {lines.map((line, index) => (
            <BriefingBullet
              key={line}
              line={line}
              index={index}
              item={sourceItems[index]}
              config={config}
            />
          ))}
        </ol>
      ) : fallbackItems.length > 0 ? (
        <ol className="mt-5 space-y-3">
          {fallbackItems.slice(0, 5).map((item, index) => (
            <BriefingBullet
              key={item.id}
              line={`${item.title_sv}. Betydelse: ${item.why_it_matters_sv}`}
              index={index}
              item={item}
              config={config}
            />
          ))}
        </ol>
      ) : (
        <SkeletonStack label="Ingen färsk morgonbrief i cache" />
      )}

      {sourceItems.length > 0 && (
        <div className="mt-6 border-t border-[var(--app-line)] pt-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <SectionKicker icon={ExternalLink} label="Underlag och spårbarhet" />
              <p className="mt-2 text-sm leading-6 text-[var(--app-soft)]">
                Källposter som briefingen bygger på.
              </p>
            </div>
            <Pill tone="neutral">{sourceItems.length} verifierbara underlag</Pill>
          </div>
          <div className="mt-4 grid gap-2">
            {sourceItems.map((item) => (
              <a
                key={item.id}
                href={item.source_url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3 transition hover:border-[var(--app-accent)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium leading-5 text-[var(--app-fg)]">
                      {item.title_sv}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--app-muted)]">
                      {item.source_name} · {formatDate(item.published_at, true)}
                    </span>
                  </span>
                  <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--app-muted)]" />
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function BriefingBullet({
  line,
  index,
  item,
  config,
}: {
  line: string;
  index: number;
  item?: IntelligenceItem;
  config: EmbassyConfig;
}) {
  const Icon = item ? categoryIcon[item.category] : Target;
  const [mainText, implicationText] = line.split(/\bBetydelse:\s*/i);
  const iconTone = item ? categoryIconTone[item.category] : "text-[var(--app-accent)]";

  return (
    <li className="rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-4 py-3">
      <div className="flex gap-3">
        <div
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--app-line)] bg-[var(--app-panel)] font-mono text-xs font-semibold text-[var(--app-muted)]"
        >
          {String(index + 1).padStart(2, "0")}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
            <span className="flex items-center gap-1.5">
              <Icon className={clsx("h-3.5 w-3.5", iconTone)} />
              {item ? getCategoryLabel(config, item.category) : "Briefingpunkt"}
            </span>
            {item && (
              <>
                <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                <span>{getGeographyLabel(item, config)}</span>
              </>
            )}
          </div>
          <p className="mt-1.5 text-sm font-medium leading-6 text-[var(--app-fg)]">
            {mainText.trim()}
          </p>
          {implicationText?.trim() && (
            <div className="mt-2 border-t border-[var(--app-line)] pt-2">
              <p className="text-sm leading-6 text-[var(--app-soft)]">
                <span className="font-medium text-[var(--app-fg)]">Betydelse: </span>
                {implicationText.trim()}
              </p>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function IntelligenceCard({
  item,
  index,
  config,
  profile,
  active,
  onSelect,
  onUnprioritize,
}: {
  item: IntelligenceItem;
  index: number;
  config: EmbassyConfig;
  profile: ProfileMode;
  active: boolean;
  onSelect: () => void;
  onUnprioritize: () => void;
}) {
  const Icon = categoryIcon[item.category];
  const composite = getCompositeScore(item, config, profile);

  return (
    <div
      className={clsx(
        "relative w-full rounded-lg border transition",
        active
          ? "border-[color-mix(in_srgb,var(--app-accent),transparent_45%)] bg-[color-mix(in_srgb,var(--app-accent),transparent_90%)]"
          : "border-[var(--app-line)] bg-[var(--app-panel-muted)] hover:border-[var(--app-accent)]",
      )}
    >
      <label
        className="absolute right-3 top-3 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-[var(--app-line)] bg-[color-mix(in_srgb,var(--app-panel),transparent_8%)] text-[var(--app-muted)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-accent-strong)]"
        title="Ta bort från prioriterade signaler"
        aria-label="Ta bort från prioriterade signaler"
      >
        <input
          type="checkbox"
          checked
          onChange={onUnprioritize}
          className="h-3.5 w-3.5 cursor-pointer accent-[var(--app-accent)]"
        />
      </label>
      <button
        type="button"
        onClick={onSelect}
        className="w-full px-4 py-4 pr-12 text-left"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] font-mono text-sm text-[var(--app-muted)]">
            {String(index + 1).padStart(2, "0")}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
              <span className="flex items-center gap-1.5">
                <Icon className={clsx("h-3.5 w-3.5", categoryIconTone[item.category])} />
                {getCategoryLabel(config, item.category)}
              </span>
              <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
              <span>{getGeographyLabel(item, config)}</span>
              <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
              <span>{formatDate(item.published_at, true)}</span>
            </div>
            <h3 className="mt-2 text-base font-semibold leading-6 text-[var(--app-fg)]">
              {item.title_sv}
            </h3>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-[var(--app-soft)]">
              {item.summary_sv}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Pill tone="accent">{priorityLabel(composite)}</Pill>
              {item.sweden_relevance_score >= 80 && <Pill tone="gold">Sverigekritisk</Pill>}
              {item.event_date && <Pill tone="neutral">Händelse {formatDate(item.event_date)}</Pill>}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

function DetailPanel({
  item,
  composite,
  config,
  printSelected,
  onTogglePrint,
}: {
  item?: IntelligenceItem;
  composite: number;
  config: EmbassyConfig;
  printSelected: boolean;
  onTogglePrint?: (checked: boolean) => void;
}) {
  if (!item) {
    return (
      <div className="rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-5">
        <EmptyState title="Välj en signal för detaljer" />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <SectionKicker icon={PanelRightOpen} label="Fördjupning" />
          <h3 className="mt-3 text-lg font-semibold leading-7">{item.title_sv}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--app-soft)]">{item.summary_sv}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="neutral">{priorityLabel(composite)}</Pill>
        </div>
      </div>

      <div className="mt-5 rounded-md border border-[var(--app-line)] bg-[var(--app-panel)] p-3">
        <p className="text-xs tracking-[0.08em] text-[var(--app-muted)]">Teman</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {getSignalThemeTags(item, config).map(({ id, label, Icon }) => (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 rounded border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-2 py-1 text-xs font-medium text-[var(--app-soft)]"
            >
              <Icon className={clsx("h-3.5 w-3.5", categoryIconTone[id])} />
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <AnalysisBlock title="Betydelse" body={item.why_it_matters_sv} />
        {item.risk_sv && <AnalysisBlock title="Risk" body={item.risk_sv} tone="danger" />}
        {item.opportunity_sv && (
          <AnalysisBlock title="Möjlighet" body={item.opportunity_sv} tone="positive" />
        )}

        <div>
          <p className="text-xs tracking-[0.08em] text-[var(--app-muted)]">
            Uppföljning
          </p>
          <div className="mt-3 space-y-2">
            {item.suggested_talking_points_sv.map((point) => (
              <div
                key={point}
                className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel)] px-3 py-2 text-sm leading-6 text-[var(--app-soft)]"
              >
                {point}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel)] p-3">
          <p className="text-xs tracking-[0.08em] text-[var(--app-muted)]">
            Ursprung och spårbarhet
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--app-soft)]">
            {item.title_original}
          </p>
          <p className="mt-2 text-xs leading-5 text-[var(--app-muted)]">
            Utdrag: {item.original_excerpt}
          </p>
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-xs font-medium text-[var(--app-accent)] hover:text-[var(--app-accent-strong)]"
          >
            {item.source_name}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {onTogglePrint && (
          <label
            className={clsx(
              "flex cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition",
              printSelected
                ? "border-[color-mix(in_srgb,var(--app-gold),transparent_35%)] bg-[color-mix(in_srgb,var(--app-gold),transparent_86%)] text-[var(--app-gold)]"
                : "border-[var(--app-line)] bg-[var(--app-panel)] text-[var(--app-soft)] hover:border-[var(--app-accent)]",
            )}
          >
            <span className="flex items-center gap-2">
              <Printer className="h-4 w-4" />
              Skicka till anpassad utskrift
            </span>
            <input
              type="checkbox"
              checked={printSelected}
              onChange={(event) => onTogglePrint(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--app-gold)]"
            />
          </label>
        )}
      </div>
    </div>
  );
}

function SourceFeed({
  rows,
  query,
  onQueryChange,
  config,
  profile,
  prioritizedIds,
  onTogglePriority,
}: {
  rows: IntelligenceItem[];
  query: string;
  onQueryChange: (value: string) => void;
  config: EmbassyConfig;
  profile: ProfileMode;
  prioritizedIds: string[];
  onTogglePriority: (id: string, checked: boolean) => void;
}) {
  return (
    <section className="surface rounded-lg">
      <div className="flex flex-col gap-4 border-b border-[var(--app-line)] p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <SectionKicker icon={Newspaper} label="Källflöde" />
          <h2 className="mt-3 text-xl font-semibold">Fler signaler</h2>
        </div>
        <label className="flex min-h-10 w-full items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 lg:w-[360px]">
          <Search className="h-4 w-4 text-[var(--app-muted)]" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Sök källa eller signal"
            className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--app-muted)]"
          />
        </label>
      </div>

      {rows.length > 0 ? (
        <div className="thin-scrollbar overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--app-line)] text-xs uppercase tracking-[0.12em] text-[var(--app-muted)]">
                <th className="px-5 py-3 font-medium">Original / svensk titel</th>
                <th className="px-5 py-3 font-medium">Källa</th>
                <th className="px-5 py-3 font-medium">Datum</th>
                <th className="px-5 py-3 font-medium">Geografi</th>
                <th className="px-5 py-3 font-medium">Relevans</th>
                <th className="px-5 py-3 font-medium">Prioritera</th>
                <th className="px-5 py-3 font-medium">Länk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-line)]">
              {rows.map((item) => {
                const isPrioritized = prioritizedIds.includes(item.id);

                return (
                  <tr key={item.id} className="hover:bg-[var(--app-panel-muted)]">
                    <td className="max-w-[420px] px-5 py-4">
                      <p className="font-medium leading-5 text-[var(--app-fg)]">{item.title_sv}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]">
                        {item.title_original}
                      </p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium">{item.source_name}</p>
                      <p className="mt-1 flex items-center gap-2 text-xs text-[var(--app-muted)]">
                        <Languages className="h-3.5 w-3.5" />
                        {countryNameSv(item.source_country) ?? item.source_country} ·{" "}
                        {item.source_language.toUpperCase()}
                      </p>
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-[var(--app-muted)]">
                      {formatDate(item.published_at, true)}
                    </td>
                    <td className="px-5 py-4">
                      <p className="text-sm">{getGeographyLabel(item, config)}</p>
                      <p className="mt-1 text-xs text-[var(--app-muted)]">{item.subregion}</p>
                    </td>
                    <td className="px-5 py-4">
                      <span className={clsx("font-mono text-lg font-semibold", scoreTone(getCompositeScore(item, config, profile)))}>
                        {Math.min(99, getCompositeScore(item, config, profile))}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <label
                        className={clsx(
                          "inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition",
                          isPrioritized
                            ? "border-[color-mix(in_srgb,var(--app-accent),transparent_35%)] bg-[color-mix(in_srgb,var(--app-accent),transparent_84%)] text-[var(--app-accent-strong)]"
                            : "border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-soft)] hover:border-[var(--app-accent)]",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isPrioritized}
                          onChange={(event) => onTogglePriority(item.id, event.target.checked)}
                          className="h-3.5 w-3.5 accent-[var(--app-accent)]"
                        />
                        Prioritera
                      </label>
                    </td>
                    <td className="px-5 py-4">
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-xs font-medium text-[var(--app-accent)] hover:border-[var(--app-accent)]"
                      >
                        Öppna
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-5">
          <EmptyState title="Källor och verifiering visas när färska signaler finns" />
        </div>
      )}
    </section>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "accent" | "gold" | "neutral" | "danger";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded px-2 py-1 text-xs font-medium",
        tone === "accent" &&
          "border border-[color-mix(in_srgb,var(--app-accent),transparent_45%)] bg-[color-mix(in_srgb,var(--app-accent),transparent_86%)] text-[var(--app-accent-strong)]",
        tone === "gold" &&
          "border border-[color-mix(in_srgb,var(--app-gold),transparent_45%)] bg-[color-mix(in_srgb,var(--app-gold),transparent_86%)] text-[var(--app-gold)]",
        tone === "danger" &&
          "border border-[color-mix(in_srgb,var(--app-danger),transparent_45%)] bg-[color-mix(in_srgb,var(--app-danger),transparent_86%)] text-[var(--app-danger)]",
        tone === "neutral" &&
          "border border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-muted)]",
      )}
    >
      {children}
    </span>
  );
}

function AnalysisBlock({
  title,
  body,
  tone,
}: {
  title: string;
  body: string;
  tone?: "danger" | "positive";
}) {
  return (
    <div
      className={clsx(
        "rounded-md border bg-[var(--app-panel)] p-3",
        tone === "danger"
          ? "border-[color-mix(in_srgb,var(--app-danger),transparent_48%)]"
          : tone === "positive"
            ? "border-[color-mix(in_srgb,var(--app-positive),transparent_48%)]"
            : "border-[var(--app-line)]",
      )}
    >
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--app-muted)]">
        {title}
      </p>
      <p className="mt-2 text-sm leading-6 text-[var(--app-soft)]">{body}</p>
    </div>
  );
}

function ProgressiveSection({
  loading,
  label,
  children,
}: {
  loading: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      {loading && (
        <div className="mb-2 flex items-center gap-2 text-xs text-[var(--app-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-warning)]" />
          {label}
        </div>
      )}
      <div className={clsx("transition-opacity duration-300", loading && "opacity-80")}>
        {children}
      </div>
    </div>
  );
}

function SkeletonStack({
  label,
  compact,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-md border border-dashed border-[var(--app-line)] bg-[var(--app-panel-muted)] p-5",
        compact ? "min-h-28" : "min-h-44",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--app-muted)]">{label}</p>
        <span className="h-2 w-2 rounded-full bg-[var(--app-warning)]" />
      </div>
      <div className="mt-5 space-y-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="space-y-2">
            <div className="h-3 w-3/4 rounded bg-[color-mix(in_srgb,var(--app-muted),transparent_78%)]" />
            <div className="h-2 w-full rounded bg-[color-mix(in_srgb,var(--app-muted),transparent_84%)]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-md border border-dashed border-[var(--app-line)] p-6 text-center text-sm text-[var(--app-muted)]">
      {title}
    </div>
  );
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  }
  return sorted[middle];
}
