"use client";

import {
  Activity,
  ArrowUpRight,
  BarChart3,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
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
  Map,
  MapPin,
  Moon,
  Newspaper,
  PanelRightOpen,
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

const urgencyLabel = (score: number) => {
  if (score >= 82) return "Kräver uppmärksamhet";
  if (score >= 65) return "Följ i dag";
  if (score >= 45) return "Bevaka";
  return "Bakgrund";
};

const formatDate = (value?: string, includeTime = false) => {
  if (!value) return "Ej daterad";
  const date = new Date(value);
  return new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
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
}: MissionDashboardProps) {
  const [items, setItems] = useState<IntelligenceItem[]>(initialItems);
  const [briefings, setBriefings] = useState<Briefing[]>(initialBriefings);
  const [cacheTimestamp, setCacheTimestamp] = useState(initialCacheTimestamp);
  const [cacheExpiresAt, setCacheExpiresAt] = useState(initialCacheExpiresAt);
  const [secondaryStatus, setSecondaryStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [profile, setProfile] = useState<ProfileMode>("daily_overview");
  const [selectedCategories, setSelectedCategories] = useState<IntelligenceCategory[]>([]);
  const [geographySelection, setGeographySelection] = useState<GeographySelection>({
    type: "national",
    ids: [],
  });
  const [geoView, setGeoView] = useState<"list" | "map">("list");
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
    "idle" | "queued" | "loading" | "error"
  >("idle");
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
      fetch("/api/intelligence/processed?limit=140", { cache: "no-store" }),
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

  const activeProfile = config.profileModes.find((mode) => mode.id === profile)!;
  const ActiveProfileIcon = profileIcon[profile];

  const filteredItems = useMemo(() => {
    return items
      .filter((item) =>
        selectedCategories.length === 0
          ? true
          : selectedCategories.includes(item.category),
      )
      .filter((item) => itemMatchesGeography(item, config, geographySelection))
      .sort(byScore(config, profile));
  }, [config, geographySelection, items, profile, selectedCategories]);

  const highSignalItems = filteredItems.filter(
    (item) => getCompositeScore(item, config, profile) >= 55,
  );
  const topFive = (highSignalItems.length > 0 ? highSignalItems : filteredItems).slice(0, 5);
  const urgentItems = filteredItems
    .filter((item) => item.urgency_score >= 78 || item.security_impact_score >= 82)
    .slice(0, 6);
  const expandedItem =
    filteredItems.find((item) => item.id === expandedId) ?? filteredItems[0];

  const weeklyItems = filteredItems
    .filter((item) => item.profile_tags.includes("weekly_summary"))
    .slice(0, 5);

  const upcomingItems = filteredItems
    .filter((item) => item.event_date)
    .sort((a, b) => (a.event_date ?? "").localeCompare(b.event_date ?? ""))
    .slice(0, 5);

  const ambassadorItems = filteredItems
    .filter((item) => item.profile_tags.includes("ambassador_briefing"))
    .slice(0, 4);

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
        body: JSON.stringify({ scope: "all", force: true }),
      });

      if (!response.ok) {
        throw new Error("Cacheuppdatering kunde inte köas.");
      }

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

  const toggleDivision = (id: string) => {
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

  const highRiskCount = filteredItems.filter(
    (item) => item.urgency_score >= 80 || item.security_impact_score >= 85,
  ).length;

  const swedenRelevantCount = filteredItems.filter(
    (item) => item.sweden_relevance_score >= 75,
  ).length;
  const briefingByType = (type: string) =>
    briefings.find((briefing) => briefing.type === type);
  const morningBriefing = briefingByType("morning_brief");
  const ambassadorBriefing = briefingByType("ambassador_brief");
  const urgentBriefing = briefingByType("urgent_developments");
  const upcomingBriefing = briefingByType("upcoming_events_advisories");
  const hasPrimaryData = Boolean(morningBriefing || topFive.length > 0);

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
                <span>{config.embassyName}</span>
                <span className="h-1 w-1 rounded-full bg-[var(--app-gold)]" />
                <span>Situationsbild</span>
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-normal text-[var(--app-fg)] sm:text-4xl">
                MissionDesk
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
                Vad behöver jag förstå i dag? En cache-first lägesbild för {config.city},
                med prioriterade signaler och spårbara underlag.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[680px]">
            <StatTile label="Signaler" value={filteredItems.length} icon={Newspaper} />
            <StatTile label="Kräver koll" value={highRiskCount} icon={CircleAlert} danger />
            <StatTile label="Sverige" value={swedenRelevantCount} icon={Flag} />
            <div className="grid min-w-0 grid-cols-2 gap-2">
              <a
                href="/sources"
                className="flex min-h-20 min-w-0 flex-col justify-between rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3 text-left transition hover:border-[var(--app-accent)]"
                aria-label="Öppna källhanteraren"
              >
                <span className="flex items-center justify-between gap-2 text-xs leading-none text-[var(--app-muted)]">
                  Källor
                  <Database className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold leading-5 text-[var(--app-fg)]">
                  Hantera
                </span>
              </a>
              <button
                type="button"
                onClick={() => setTheme((value) => (value === "dark" ? "light" : "dark"))}
                className="flex min-h-20 min-w-0 flex-col justify-between rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3 text-left transition hover:border-[var(--app-accent)]"
                aria-label="Växla färgtema"
              >
                <span className="flex items-center justify-between gap-2 text-xs leading-none text-[var(--app-muted)]">
                  Tema
                  {theme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                </span>
                <span className="text-sm font-semibold leading-5 text-[var(--app-fg)]">
                  {theme === "dark" ? "Mörkt" : "Ljust"}
                </span>
              </button>
            </div>
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
          <button
            type="button"
            onClick={() => void handleNationalCacheRefresh()}
            disabled={cacheRefreshStatus === "loading"}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-xs font-medium text-[var(--app-soft)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-fg)] disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw
              className={clsx(
                "h-3.5 w-3.5",
                cacheRefreshStatus === "loading" && "animate-spin",
              )}
            />
            {cacheRefreshStatus === "queued"
              ? "Uppdatering köad"
              : cacheRefreshStatus === "error"
                ? "Försök igen"
                : "Uppdatera"}
          </button>
        </section>

        {geographySelection.type !== "national" && (
          <RegionalCachePanel
            label={activeGeoLabel}
            status={regionalStatus}
            message={regionalLoadingMessages[regionalMessageIndex]}
            freshnessTimestamp={regionalFreshness}
            cacheExpiresAt={regionalCacheExpiresAt}
            fromCache={regionalFromCache}
            error={regionalError}
            onRefresh={() => void handleRegionalRefresh()}
          />
        )}

        {showFirstRunPanel && (
          <FirstRunPanel
            status={firstRunStatus}
            requestStatus={firstRunRequestStatus}
            onRetry={() => void handleFirstRunRetry()}
          />
        )}

        <PrimaryBriefingPanel
          briefing={morningBriefing}
          fallbackItems={topFive}
          cacheTimestamp={cacheTimestamp}
        />

        <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-5">
            <section className="surface rounded-lg p-4">
              <SectionKicker icon={ListFilter} label="Profil" />
              <p className="mt-2 text-xs leading-5 text-[var(--app-muted)]">
                Välj ett perspektiv när urvalet behöver vägas om.
              </p>
              <div className="mt-4 grid gap-2">
                {config.profileModes.map((mode) => {
                  const Icon = profileIcon[mode.id];
                  const active = mode.id === profile;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setProfile(mode.id)}
                      className={clsx(
                        "flex items-center gap-3 rounded-md border px-3 py-3 text-left transition",
                        active
                          ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_84%)]"
                          : "border-[var(--app-line)] bg-[var(--app-panel-muted)] hover:border-[var(--app-accent)]",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-[var(--app-accent)]" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-[var(--app-fg)]">
                          {mode.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">
                          {mode.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="surface rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <SectionKicker icon={Filter} label="Tematiska filter" />
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
              <div className="mt-4 flex flex-wrap gap-2">
                {config.themeCategories.map((category) => {
                  const active = selectedCategories.includes(category.id);
                  const Icon = categoryIcon[category.id];
                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => toggleCategory(category.id)}
                      className={clsx(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition",
                        active
                          ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_82%)] text-[var(--app-accent-strong)]"
                          : "border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-soft)] hover:border-[var(--app-accent)]",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {category.label}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="surface rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <SectionKicker icon={MapPin} label="Geografisk filtrering" />
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
                    icon={Map}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setGeographySelection({ type: "national", ids: [] })}
                className={clsx(
                  "mt-4 flex w-full items-center justify-between rounded-md border px-3 py-3 text-left transition",
                  geographySelection.type === "national"
                    ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_84%)]"
                    : "border-[var(--app-line)] bg-[var(--app-panel-muted)] hover:border-[var(--app-accent)]",
                )}
              >
                <span>
                  <span className="block text-sm font-medium">Nationellt</span>
                  <span className="block text-xs text-[var(--app-muted)]">
                    Endast nationella signaler som standard
                  </span>
                </span>
                {geographySelection.type === "national" && (
                  <Check className="h-4 w-4 text-[var(--app-accent)]" />
                )}
              </button>

              <div className="mt-4">
                <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--app-muted)]">
                  Regiongrupper
                </p>
                <div className="grid gap-2">
                  {config.geography.regions.map((region) => {
                    const active =
                      geographySelection.type === "region" &&
                      geographySelection.ids.includes(region.id);
                    return (
                      <button
                        key={region.id}
                        type="button"
                        onClick={() => toggleRegion(region.id)}
                        className={clsx(
                          "rounded-md border px-3 py-2 text-left transition",
                          active
                            ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_84%)]"
                            : "border-[var(--app-line)] bg-[var(--app-panel-muted)] hover:border-[var(--app-accent)]",
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
                        <span className="mt-1 block text-xs leading-5 text-[var(--app-muted)]">
                          {region.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4">
                <p className="mb-2 text-xs uppercase tracking-[0.14em] text-[var(--app-muted)]">
                  {config.geography.geographicUnitPluralLabel}
                </p>
                {geoView === "list" ? (
                  <div className="thin-scrollbar max-h-[360px] overflow-y-auto pr-1">
                    <div className="flex flex-wrap gap-2">
                      {config.geography.administrativeDivisions.map((division) => {
                        const active =
                          geographySelection.type === "division" &&
                          geographySelection.ids.includes(division.id);
                        return (
                          <button
                            key={division.id}
                            type="button"
                            onClick={() => toggleDivision(division.id)}
                            className={clsx(
                              "flex items-center gap-2 rounded-md border px-2.5 py-2 text-xs transition",
                              active
                                ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_80%)] text-[var(--app-accent-strong)]"
                                : "border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-soft)] hover:border-[var(--app-accent)]",
                            )}
                          >
                            {division.priority && (
                              <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-gold)]" />
                            )}
                            {division.displayName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {config.geography.regions.map((region) => {
                      const regionItems = items.filter((item) =>
                        item.geographic_tags.some((tag) =>
                          region.divisionIds.includes(tag),
                        ),
                      );
                      return (
                        <button
                          key={region.id}
                          type="button"
                          onClick={() => setGeographySelection({ type: "region", ids: [region.id] })}
                          className="min-h-[112px] rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3 text-left transition hover:border-[var(--app-accent)]"
                        >
                          <span className="block text-sm font-semibold">{region.displayName}</span>
                          <span className="mt-2 block h-1.5 rounded-full bg-[color-mix(in_srgb,var(--app-muted),transparent_70%)]">
                            <span
                              className="block h-1.5 rounded-full bg-[var(--app-accent)]"
                              style={{
                                width: `${Math.min(100, regionItems.length * 22)}%`,
                              }}
                            />
                          </span>
                          <span className="mt-3 block text-xs text-[var(--app-muted)]">
                            {regionItems.length} signaler i urvalet
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          </aside>

          <div className="flex min-w-0 flex-col gap-5">
            <section className="surface-strong overflow-hidden rounded-lg">
              <div className="border-b border-[var(--app-line)] px-5 py-4">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em] text-[var(--app-muted)]">
                        <ActiveProfileIcon className="h-4 w-4 text-[var(--app-accent)]" />
                        <span>{activeProfile.label}</span>
                        <span className="h-1 w-1 rounded-full bg-[var(--app-gold)]" />
                        <span>{activeGeoLabel}</span>
                      </div>
                      <h2 className="mt-2 text-2xl font-semibold tracking-normal">
                        Topp prioriterade signaler
                      </h2>
                      <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
                        Det här är de starkaste signalerna i urvalet just nu. Använd dem som
                        underlag för snabb prioritering och fortsatt läsning.
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <MiniSignal label="Signaler" value={filteredItems.length} />
                      <MiniSignal label="Kräver koll" value={highRiskCount} danger />
                      <MiniSignal label="Sverige" value={swedenRelevantCount} />
                    </div>
                  </div>
                  <p className="max-w-3xl text-xs leading-5 text-[var(--app-muted)]">
                    Detaljerna till höger visar spårbart underlag för den valda signalen.
                  </p>
                </div>
              </div>

              <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="divide-y divide-[var(--app-line)]">
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

                <DetailPanel item={expandedItem} config={config} profile={profile} />
              </div>
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
              <AmbassadorBriefing
                items={ambassadorItems}
                briefing={ambassadorBriefing}
                config={config}
                profile={profile}
              />
              <UrgentDevelopments
                items={urgentItems}
                briefing={urgentBriefing}
                config={config}
              />
            </section>

            <EventTimeline
              items={upcomingItems}
              briefing={upcomingBriefing}
              config={config}
              loading={secondaryStatus === "loading" && items.length === initialItems.length}
            />

            <ProgressiveSection loading={secondaryStatus === "loading"} label="Läser sekundär cache">
              <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
                <WeeklySummary items={weeklyItems} config={config} />
                <ThemeMatrix items={filteredItems} config={config} />
              </section>
            </ProgressiveSection>

            <ProgressiveSection loading={secondaryStatus === "loading"} label="Läser källindex">
              <SourceFeed
                rows={sourceRows}
                query={sourceQuery}
                onQueryChange={setSourceQuery}
                config={config}
                profile={profile}
              />
            </ProgressiveSection>
          </div>
        </div>
      </div>
    </main>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
  danger,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  danger?: boolean;
}) {
  return (
    <div className="flex min-h-20 min-w-0 flex-col justify-between rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3">
      <span className="flex items-center justify-between gap-2 text-xs leading-none text-[var(--app-muted)]">
        {label}
        <Icon className={clsx("h-4 w-4", danger && "text-[var(--app-danger)]")} />
      </span>
      <span className="font-mono text-2xl font-semibold leading-none text-[var(--app-fg)]">
        {value}
      </span>
    </div>
  );
}

function SectionKicker({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-[var(--app-muted)]">
      <Icon className="h-4 w-4 text-[var(--app-accent)]" />
      {label}
    </div>
  );
}

function MiniSignal({
  label,
  value,
  danger,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col justify-between rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2">
      <span className="text-[10px] uppercase tracking-[0.14em] text-[var(--app-muted)]">
        {label}
      </span>
      <span
        className={clsx(
          "mt-1 font-mono text-lg font-semibold leading-none text-[var(--app-fg)]",
          danger && "text-[var(--app-danger)]",
        )}
      >
        {value}
      </span>
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
  cacheTimestamp,
}: {
  briefing?: Briefing;
  fallbackItems: IntelligenceItem[];
  cacheTimestamp?: string;
}) {
  const lines = briefing?.content_sv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);

  return (
    <section className="surface-strong rounded-lg p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <SectionKicker icon={Gauge} label="Morgonbrief" />
          <h2 className="mt-3 text-2xl font-semibold">Lägesbild på fem minuter</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
            En kort, cachead överblick för att snabbt förstå vad som har hänt, vad som kräver
            uppmärksamhet och vad som bör följas vidare.
          </p>
        </div>
        <Pill tone={briefing ? "accent" : "neutral"}>
          {briefing
            ? `Genererad ${formatDate(briefing.generated_at, true)}`
            : cacheTimestamp
              ? `Cache ${formatDate(cacheTimestamp, true)}`
              : "Inväntar briefing"}
        </Pill>
      </div>

      {lines && lines.length > 0 ? (
        <div className="mt-5 rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--app-muted)]">
            Briefing
          </p>
          <div className="mt-4 space-y-3">
            {lines.map((line, index) => (
              <div key={line} className="flex gap-3">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--app-accent)]" />
                <p
                  className={clsx(
                    "text-sm leading-6 text-[var(--app-soft)]",
                    index === 0 && "font-medium text-[var(--app-fg)]",
                  )}
                >
                  {line.replace(/^[-*]\s*/, "")}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Pill tone="neutral">
              Underlag: {briefing?.source_item_ids.length ?? fallbackItems.length} poster
            </Pill>
            <Pill tone="neutral">Cachead och spårbar</Pill>
            <Pill tone="neutral">Ingen live-AI vid sidladdning</Pill>
          </div>
        </div>
      ) : fallbackItems.length > 0 ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {fallbackItems.slice(0, 6).map((item) => (
            <div
              key={item.id}
              className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-4"
            >
              <p className="text-sm font-semibold leading-5">{item.title_sv}</p>
              <p className="mt-2 text-xs leading-5 text-[var(--app-muted)]">
                {item.why_it_matters_sv}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <SkeletonStack label="Ingen färsk morgonbrief i cache" />
      )}
    </section>
  );
}

function IntelligenceCard({
  item,
  index,
  config,
  profile,
  active,
  onSelect,
}: {
  item: IntelligenceItem;
  index: number;
  config: EmbassyConfig;
  profile: ProfileMode;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = categoryIcon[item.category];
  const composite = getCompositeScore(item, config, profile);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "grid w-full gap-4 px-5 py-4 text-left transition md:grid-cols-[40px_minmax(0,1fr)_132px]",
        active
          ? "bg-[color-mix(in_srgb,var(--app-accent),transparent_90%)]"
          : "hover:bg-[var(--app-panel-muted)]",
      )}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] font-mono text-sm text-[var(--app-muted)]">
        {String(index + 1).padStart(2, "0")}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
          <span className="flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 text-[var(--app-accent)]" />
            {getCategoryLabel(config, item.category)}
          </span>
          <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
          <span>{item.region}</span>
          <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
          <span>{formatDate(item.published_at, true)}</span>
        </div>
        <h3 className="mt-2 text-base font-semibold leading-6 text-[var(--app-fg)]">
          {item.title_sv}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--app-soft)]">
          {item.summary_sv}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill tone="accent">{urgencyLabel(item.urgency_score)}</Pill>
          {item.sweden_relevance_score >= 80 && <Pill tone="gold">Sverigekritisk</Pill>}
          {item.event_date && <Pill tone="neutral">Händelse {formatDate(item.event_date)}</Pill>}
        </div>
      </div>

      <div className="flex md:justify-end">
        <div className="w-full max-w-[160px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--app-muted)]">Läsning</span>
            <span className={clsx("font-mono text-sm font-semibold", scoreTone(composite))}>
              {Math.min(99, composite)}
            </span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--app-panel-muted)]">
            <div
              className="metric-bar h-full rounded-full"
              style={{ width: `${Math.min(100, composite)}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.urgency_score >= 80 && <Pill tone="danger">Brådskande</Pill>}
            {item.sweden_relevance_score >= 80 && <Pill tone="gold">Sverigekritisk</Pill>}
            {item.security_impact_score >= 80 && <Pill tone="neutral">Säkerhet</Pill>}
          </div>
        </div>
      </div>
    </button>
  );
}

function DetailPanel({
  item,
  config,
  profile,
}: {
  item?: IntelligenceItem;
  config: EmbassyConfig;
  profile: ProfileMode;
}) {
  if (!item) {
    return (
      <aside className="border-l border-[var(--app-line)] p-5">
        <EmptyState title="Välj en signal för detaljer" />
      </aside>
    );
  }

  return (
    <aside className="border-l border-[var(--app-line)] bg-[var(--app-panel-muted)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionKicker icon={PanelRightOpen} label="Signaldetalj" />
          <h3 className="mt-3 text-xl font-semibold leading-7">{item.title_sv}</h3>
        </div>
        <span className={clsx("font-mono text-3xl font-semibold", scoreTone(getCompositeScore(item, config, profile)))}>
          {Math.min(99, getCompositeScore(item, config, profile))}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        {scoreMeta.map(({ key, compact, label }) => (
          <div key={key} className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel)] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--app-muted)]" title={label}>
                {compact}
              </span>
              <span className={clsx("font-mono text-sm font-semibold", scoreTone(item[key]))}>
                {item[key]}
              </span>
            </div>
            <div className="mt-2 h-1 rounded-full bg-[var(--app-panel-muted)]">
              <div
                className="h-1 rounded-full bg-[var(--app-accent)]"
                style={{ width: `${item[key]}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        <AnalysisBlock title="Betydelse" body={item.why_it_matters_sv} />
        {item.risk_sv && <AnalysisBlock title="Risk" body={item.risk_sv} tone="danger" />}
        {item.opportunity_sv && (
          <AnalysisBlock title="Möjlighet" body={item.opportunity_sv} tone="positive" />
        )}

        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--app-muted)]">
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
          <p className="text-xs uppercase tracking-[0.14em] text-[var(--app-muted)]">
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
      </div>
    </aside>
  );
}

function AmbassadorBriefing({
  items,
  briefing,
  config,
  profile,
}: {
  items: IntelligenceItem[];
  briefing?: Briefing;
  config: EmbassyConfig;
  profile: ProfileMode;
}) {
  const primary = items[0];
  const briefingLines = briefing?.content_sv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
  return (
    <section className="surface rounded-lg p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionKicker icon={Landmark} label="Ambassadörsunderlag" />
          <h2 className="mt-3 text-xl font-semibold">Kort, beslutsnära underlag</h2>
        </div>
        <Pill tone="gold">Kortformat</Pill>
      </div>

      {briefingLines && briefingLines.length > 0 ? (
        <div className="mt-5 space-y-2">
          {briefingLines.map((line) => (
            <p
              key={line}
              className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-sm leading-6 text-[var(--app-soft)]"
            >
              {line.replace(/^[-*]\s*/, "")}
            </p>
          ))}
        </div>
      ) : primary ? (
        <div className="mt-5">
          <div className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-4">
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm font-semibold text-[var(--app-fg)]">
                För intern avstämning
              </p>
              <span className={clsx("font-mono text-lg font-semibold", scoreTone(getCompositeScore(primary, config, profile)))}>
                {Math.min(99, getCompositeScore(primary, config, profile))}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-[var(--app-soft)]">
              Det finns ännu ingen cachead ambassadörsbrief. Använd punkterna nedan som
              orientering och kontrollera originalkällorna inför mötet.
            </p>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3"
              >
                <p className="text-sm font-medium leading-5">{item.title_sv}</p>
                <p className="mt-2 text-xs leading-5 text-[var(--app-muted)]">
                  {item.why_it_matters_sv}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyState title="Ingen ambassadörsbrief i aktuell cache" />
      )}
    </section>
  );
}

function UrgentDevelopments({
  items,
  briefing,
  config,
}: {
  items: IntelligenceItem[];
  briefing?: Briefing;
  config: EmbassyConfig;
}) {
  const lines = briefing?.content_sv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  return (
    <section className="surface rounded-lg p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionKicker icon={CircleAlert} label="Varningar och avvikelser" />
          <h2 className="mt-3 text-xl font-semibold">Kräver åtgärd eller bevakning</h2>
        </div>
        <Pill tone={items.length > 0 ? "danger" : "neutral"}>{items.length} signaler</Pill>
      </div>

      <div className="mt-5 space-y-3">
        {lines && lines.length > 0 ? (
          lines.map((line) => (
            <p
              key={line}
              className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-sm leading-6 text-[var(--app-soft)]"
            >
              {line.replace(/^[-*]\s*/, "")}
            </p>
          ))
        ) : items.length > 0 ? (
          items.map((item) => (
            <div
              key={item.id}
              className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
                <span>{getCategoryLabel(config, item.category)}</span>
                <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                <span>{item.region}</span>
              </div>
              <p className="mt-2 text-sm font-medium leading-5">{item.title_sv}</p>
              <p className="mt-2 text-xs leading-5 text-[var(--app-muted)]">
                {item.why_it_matters_sv}
              </p>
            </div>
          ))
        ) : (
          <EmptyState title="Inga brådskande signaler över tröskeln" />
        )}
      </div>
    </section>
  );
}

function EventTimeline({
  items,
  briefing,
  config,
  loading,
}: {
  items: IntelligenceItem[];
  briefing?: Briefing;
  config: EmbassyConfig;
  loading?: boolean;
}) {
  const lines = briefing?.content_sv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  return (
    <section className="surface rounded-lg p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionKicker icon={CalendarDays} label="Kommande händelser" />
          <h2 className="mt-3 text-xl font-semibold">Händelser att förbereda</h2>
        </div>
        <Pill tone="neutral">{items.length} händelser</Pill>
      </div>

      <div className="mt-5 space-y-3">
        {lines && lines.length > 0 ? (
          lines.map((line) => (
            <p
              key={line}
              className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-sm leading-6 text-[var(--app-soft)]"
            >
              {line.replace(/^[-*]\s*/, "")}
            </p>
          ))
        ) : loading ? (
          <SkeletonStack label="Hämtar händelsecache" compact />
        ) : items.length > 0 ? (
          items.map((item) => (
            <div key={item.id} className="grid grid-cols-[74px_minmax(0,1fr)] gap-3">
              <div className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-2 text-center">
                <span className="block font-mono text-lg font-semibold">
                  {new Date(item.event_date ?? item.published_at).getDate()}
                </span>
                <span className="text-xs text-[var(--app-muted)]">
                  {new Intl.DateTimeFormat("sv-SE", { month: "short" }).format(
                    new Date(item.event_date ?? item.published_at),
                  )}
                </span>
              </div>
              <div className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
                  <span>{getCategoryLabel(config, item.category)}</span>
                  <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                  <span>{item.region}</span>
                </div>
                <p className="mt-1 text-sm font-medium leading-5">{item.title_sv}</p>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--app-muted)]">
                  {item.why_it_matters_sv}
                </p>
              </div>
            </div>
          ))
        ) : (
          <EmptyState title="Inga kommande händelser över tröskeln" />
        )}
      </div>
    </section>
  );
}

function WeeklySummary({
  items,
  config,
}: {
  items: IntelligenceItem[];
  config: EmbassyConfig;
}) {
  return (
    <section className="surface rounded-lg p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionKicker icon={ClipboardList} label="Veckosammanfattning" />
          <h2 className="mt-3 text-xl font-semibold">Följ upp från veckan</h2>
        </div>
        <Pill tone="accent">Veckobild</Pill>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {items.length > 0 ? (
          items.map((item) => {
            const Icon = categoryIcon[item.category];
            return (
              <div
                key={item.id}
                className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-4"
              >
                <div className="flex items-center gap-2 text-xs text-[var(--app-muted)]">
                  <Icon className="h-3.5 w-3.5 text-[var(--app-accent)]" />
                  {getCategoryLabel(config, item.category)}
                  <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                  {formatDate(item.published_at)}
                </div>
                <p className="mt-2 text-sm font-semibold leading-5">{item.title_sv}</p>
                <p className="mt-2 text-xs leading-5 text-[var(--app-muted)]">
                  {item.summary_sv}
                </p>
              </div>
            );
          })
        ) : (
          <EmptyState title="Inga veckosignaler i aktuell cache" />
        )}
      </div>
    </section>
  );
}

function ThemeMatrix({
  items,
  config,
}: {
  items: IntelligenceItem[];
  config: EmbassyConfig;
}) {
  const categoryCounts = config.themeCategories
    .map((category) => ({
      ...category,
      count: items.filter((item) => item.category === category.id).length,
      average:
        Math.round(
          median(
            items
              .filter((item) => item.category === category.id)
              .map((item) => item.sweden_relevance_score),
          ),
        ) || 0,
    }))
    .filter((category) => category.count > 0)
    .slice(0, 8);

  return (
    <section className="surface rounded-lg p-5">
      <SectionKicker icon={Target} label="Teman" />
      <h2 className="mt-3 text-xl font-semibold">Var signalerna samlas</h2>

      <div className="mt-5 space-y-3">
        {categoryCounts.map((category) => {
          const Icon = categoryIcon[category.id];
          return (
            <div key={category.id} className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4 text-[var(--app-accent)]" />
                  {category.label}
                </span>
                <span className="font-mono text-sm text-[var(--app-muted)]">
                  {category.count} / {category.average}
                </span>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-[var(--app-panel)]">
                <div
                  className="h-1.5 rounded-full bg-[var(--app-accent)]"
                  style={{ width: `${Math.min(100, category.average)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SourceFeed({
  rows,
  query,
  onQueryChange,
  config,
  profile,
}: {
  rows: IntelligenceItem[];
  query: string;
  onQueryChange: (value: string) => void;
  config: EmbassyConfig;
  profile: ProfileMode;
}) {
  return (
    <section className="surface rounded-lg">
      <div className="flex flex-col gap-4 border-b border-[var(--app-line)] p-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <SectionKicker icon={Newspaper} label="Källor och verifiering" />
          <h2 className="mt-3 text-xl font-semibold">Spårbara underlag</h2>
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
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--app-line)] text-xs uppercase tracking-[0.12em] text-[var(--app-muted)]">
                <th className="px-5 py-3 font-medium">Original / svensk titel</th>
                <th className="px-5 py-3 font-medium">Källa</th>
                <th className="px-5 py-3 font-medium">Datum</th>
                <th className="px-5 py-3 font-medium">Geografi</th>
                <th className="px-5 py-3 font-medium">Relevans</th>
                <th className="px-5 py-3 font-medium">Länk</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-line)]">
              {rows.map((item) => (
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
                    <p className="text-sm">{item.region}</p>
                    <p className="mt-1 text-xs text-[var(--app-muted)]">{item.subregion}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span className={clsx("font-mono text-lg font-semibold", scoreTone(getCompositeScore(item, config, profile)))}>
                      {Math.min(99, getCompositeScore(item, config, profile))}
                    </span>
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
              ))}
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
