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
  Info,
  Landmark,
  Languages,
  LineChart,
  ListFilter,
  Loader2,
  MapPin,
  Moon,
  Newspaper,
  PanelRightOpen,
  Printer,
  Radar,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { normalizeSwedishUserFacingText } from "@/lib/ai/swedish-normalization";
import type { SignalTrackingResult, SignalTrackingSearchResult } from "@/lib/intelligence/signal-tracking";
import { processedRecordToIntelligenceItem } from "@/lib/intelligence/dashboard-view";
import {
  eventDateRange,
  isUpcomingEventDate,
  UPCOMING_EVENTS_HORIZON_DAYS,
} from "@/lib/intelligence/event-dates";
import { countryNameSv } from "@/lib/i18n/countries";
import type {
  BackgroundJob,
  Briefing,
  ProcessedIntelligenceRecord,
  TemporalSignalRecord,
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
  lastIngestedAt?: string;
}

const DEFAULT_PROFILE: ProfileMode = "daily_overview";

type GeographySelection =
  | { type: "national"; ids: string[] }
  | { type: "region"; ids: string[] }
  | { type: "division"; ids: string[] };

type RegionalStatus = "idle" | "loading" | "ready" | "empty" | "error" | "not_configured";
type ActiveViewState =
  | { kind: "profile"; profile: ProfileMode }
  | { kind: "briefing" }
  | { kind: "print" }
  | { kind: "tracking" };

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
  lastIngestedAt?: string;
  updateStartedAt?: string;
  updateCompletedAt?: string;
  updateErrorMessage?: string;
  updateStatus?: "idle" | "pending" | "running" | "completed" | "failed";
}

type BriefingContentBlock =
  | { kind: "section"; title: string }
  | { kind: "item"; text: string };

interface UpcomingSignalsApiPayload {
  signals: TemporalSignalRecord[];
  cache: {
    itemCount: number;
    generatedAt: string;
    onlyUpcoming: boolean;
  };
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

const SIGNAL_TRACKING_DEFAULT_QUICK_SEARCHES = [
  "Volvo",
  "Kina",
  "migration",
  "energi",
  "fentanyl",
] as const;

const LEGACY_SIGNAL_TRACKING_DEFAULT_QUICK_SEARCHES = [
  "Volvo",
  "Kina",
  "Migration",
  "Energi",
  "Fentanyl",
] as const;

const DEFAULT_QUICK_SEARCH_CANONICAL_CASE: Record<string, string> = {
  volvo: "Volvo",
  kina: "Kina",
  migration: "migration",
  energi: "energi",
  fentanyl: "fentanyl",
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

const priorityLabel = (score: number) => {
  if (score >= 82) return "Kräver uppföljning";
  if (score >= 65) return "Hög relevans";
  if (score >= 45) return "Måttlig relevans";
  return "Bakgrund";
};

const refreshProgressCaps = [34, 58, 84, 96];

function displayedRefreshProgress(status?: CacheRefreshStatusPayload) {
  if (!status) return 0;
  if (!status.active) return Math.round(status.progressPercent);

  const backendProgress = Math.max(0, Math.min(99, status.progressPercent));
  const stepIndex = Math.max(0, Math.min(refreshProgressCaps.length - 1, status.activeStepIndex));
  const cap = refreshProgressCaps[stepIndex] ?? 96;
  const startedAt =
    status.updateStartedAt ?? (typeof status.job?.payload.startedAt === "string" ? status.job.payload.startedAt : undefined);
  const startedAtMs = startedAt ? new Date(startedAt).getTime() : 0;
  const elapsedSeconds =
    Number.isFinite(startedAtMs) && startedAtMs > 0
      ? Math.max(0, (Date.now() - startedAtMs) / 1000)
      : 0;
  const drift = Math.min(cap - backendProgress, Math.floor(elapsedSeconds / 8));

  return Math.round(Math.min(cap, backendProgress + Math.max(0, drift)));
}

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

const formatDateRange = (start?: string, end?: string) => {
  if (!start && !end) {
    return "Tid ej fastställd";
  }
  if (start && end && start !== end) {
    return `${formatDate(start)} – ${formatDate(end)}`;
  }
  return formatDate(start ?? end, true);
};

const temporalContextLabel: Record<TemporalSignalRecord["signal"]["temporal_context"], string> = {
  upcoming_event: "Kommande händelse",
  ongoing_process: "Pågående process",
  future_risk: "Framtidsrisk",
  scheduled_vote: "Planerad omröstning",
  earnings: "Rapporttillfälle",
  summit: "Toppmöte",
  policy_deadline: "Policydeadline",
  regulatory_change: "Regeländring",
  security_window: "Säkerhetsfönster",
  market_window: "Marknadsfönster",
};

type UpcomingSortMode = "priority" | "soonest" | "certainty";
type UpcomingHorizonFilter = "all" | "ongoing" | "7d" | "30d" | "90d" | "later";
type UpcomingTypeFilter =
  | "all"
  | "policy"
  | "decision"
  | "security"
  | "diplomacy"
  | "market";

const upcomingSortOptions: Array<{ id: UpcomingSortMode; label: string }> = [
  { id: "priority", label: "Viktigast" },
  { id: "soonest", label: "Snart" },
  { id: "certainty", label: "Säkrast fastställda" },
];

const upcomingHorizonOptions: Array<{ id: UpcomingHorizonFilter; label: string }> = [
  { id: "all", label: "Alla" },
  { id: "ongoing", label: "Pågår" },
  { id: "7d", label: "7 dagar" },
  { id: "30d", label: "30 dagar" },
  { id: "90d", label: "90 dagar" },
  { id: "later", label: "Senare" },
];

const upcomingTypeOptions: Array<{ id: UpcomingTypeFilter; label: string }> = [
  { id: "all", label: "Alla typer" },
  { id: "policy", label: "Policy / regler" },
  { id: "decision", label: "Beslut / omröstning" },
  { id: "security", label: "Säkerhet / risk" },
  { id: "diplomacy", label: "Diplomati / möten" },
  { id: "market", label: "Marknad / investering" },
];

const temporalSignalReferenceTs = (signal: TemporalSignalRecord["signal"], nowTs: number) => {
  const startRange = eventDateRange(signal.date_start);
  const endRange = eventDateRange(signal.date_end);
  const startTs = startRange?.startTs ?? Number.NaN;
  const endTs = endRange?.endTs ?? Number.NaN;

  if (Number.isFinite(startTs) && startTs >= nowTs) return startTs;
  if (Number.isFinite(endTs) && endTs >= nowTs) return endTs;
  return startTs;
};

function temporalDateParts(value?: string) {
  if (!value) {
    return {
      day: "—",
      month: "TBD",
      year: "",
    };
  }

  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return {
      day: "—",
      month: "TBD",
      year: "",
    };
  }

  return {
    day: new Intl.DateTimeFormat("sv-SE", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("sv-SE", { month: "short" }).format(date).toUpperCase(),
    year: new Intl.DateTimeFormat("sv-SE", { year: "numeric" }).format(date),
  };
}

function temporalSignalDateCard(signal: TemporalSignalRecord["signal"], nowTs: number) {
  const startRange = eventDateRange(signal.date_start);
  const endRange = eventDateRange(signal.date_end);
  const isOngoing =
    Boolean(startRange && startRange.startTs < nowTs) &&
    Boolean(endRange && endRange.endTs >= nowTs);
  const primaryDate =
    isOngoing && signal.date_end
      ? signal.date_end
      : signal.date_start ?? signal.date_end;
  const undatedOngoing = !primaryDate && signal.temporal_context === "ongoing_process";
  const referenceTs = temporalSignalReferenceTs(signal, nowTs);
  const days = Number.isFinite(referenceTs)
    ? Math.max(0, Math.floor((referenceTs - nowTs) / 86400000))
    : null;

  if (undatedOngoing) {
    return {
      day: "NU",
      month: "PÅGÅR",
      year: "",
      eyebrow: "Pågående",
      relativeLabel: "Pågår nu",
      timelineLabel: "Bekräftat pågående",
    };
  }

  return {
    ...temporalDateParts(primaryDate),
    eyebrow: !primaryDate
      ? "Tidsfönster"
      : isOngoing
        ? "Pågår till"
        : signal.date_start && signal.date_end && signal.date_start !== signal.date_end
          ? "Start"
          : "Datum",
    relativeLabel: isOngoing ? "Pågår nu" : days === null ? "Tidsfönster" : days === 0 ? "I dag" : `Om ${days} dagar`,
    timelineLabel: formatDateRange(signal.date_start, signal.date_end),
  };
}

function temporalSignalTiming(
  signal: TemporalSignalRecord["signal"],
  nowTs: number,
): { isOngoing: boolean; referenceTs: number; days: number | null } {
  const startRange = eventDateRange(signal.date_start);
  const endRange = eventDateRange(signal.date_end);
  const isOngoing =
    Boolean(startRange && startRange.startTs < nowTs) &&
    Boolean(endRange && endRange.endTs >= nowTs);
  const referenceTs = temporalSignalReferenceTs(signal, nowTs);
  const days = Number.isFinite(referenceTs)
    ? Math.max(0, Math.floor((referenceTs - nowTs) / 86400000))
    : null;

  return { isOngoing, referenceTs, days };
}

function temporalSignalTypeGroup(record: TemporalSignalRecord): UpcomingTypeFilter {
  const context = record.signal.temporal_context;
  const category = record.processed.category;

  if (context === "policy_deadline" || context === "regulatory_change") return "policy";
  if (context === "scheduled_vote") return "decision";
  if (context === "future_risk" || context === "security_window") return "security";
  if (context === "summit") return "diplomacy";
  if (context === "earnings" || context === "market_window") return "market";

  if (context === "upcoming_event") {
    if (category === "foreign_policy" || category === "sweden_connection") return "diplomacy";
    if (category === "domestic_politics") return "decision";
    if (
      category === "economy" ||
      category === "trade" ||
      category === "markets" ||
      category === "investment_climate" ||
      category === "technology" ||
      category === "energy"
    ) {
      return "market";
    }
    return "policy";
  }

  if (context === "ongoing_process") {
    if (category === "security") return "security";
    if (category === "foreign_policy" || category === "sweden_connection") return "diplomacy";
    if (category === "domestic_politics") return "decision";
    if (
      category === "economy" ||
      category === "trade" ||
      category === "markets" ||
      category === "investment_climate" ||
      category === "technology" ||
      category === "energy"
    ) {
      return "market";
    }
    return "policy";
  }

  return "policy";
}

function temporalPriorityScore(record: TemporalSignalRecord, nowTs: number) {
  const { isOngoing, days } = temporalSignalTiming(record.signal, nowTs);
  const proximityScore =
    days === null
      ? 35
      : isOngoing
        ? 100
        : Math.max(0, 100 - Math.min(days, UPCOMING_EVENTS_HORIZON_DAYS) * (100 / UPCOMING_EVENTS_HORIZON_DAYS));

  return (
    record.signal.strategic_importance_score * 0.46 +
    record.signal.sweden_mexico_relevance_score * 0.22 +
    record.signal.temporal_certainty_score * 0.16 +
    proximityScore * 0.16
  );
}

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

const decodeHtmlEntities = (value?: string) => {
  if (!value) return value ?? "";
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    Aring: "Å",
    aring: "å",
    Auml: "Ä",
    auml: "ä",
    Ouml: "Ö",
    ouml: "ö",
  };

  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&([a-zA-Z]+);/g, (match, key) => named[key] ?? match)
    .replace(/\s+/g, " ")
    .trim();
};

const isXUrl = (value?: string) => {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes("x.com") || host.includes("twitter.com");
  } catch {
    return false;
  }
};

const xSourceDisplayName = (sourceName: string, sourceUrl?: string) =>
  isXUrl(sourceUrl) ? `${sourceName} på X` : sourceName;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const normalizeForGrouping = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const weeklyDatePattern =
  /\b(20\d{2}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-](?:20)?\d{2}|\d{1,2}\s+(?:januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4})\b/i;

const weeklyActionTerms = [
  "beslut",
  "antog",
  "godkände",
  "genomförde",
  "inledde",
  "lanserade",
  "publicerade",
  "meddelade",
  "undertecknade",
  "tillkännagav",
  "acordó",
  "aprobó",
  "anunció",
  "publicó",
  "firmó",
  "inició",
  "announced",
  "approved",
  "published",
  "signed",
  "launched",
  "started",
  "held",
];

const weeklyGenericOnlyTerms = [
  "kritik mot",
  "oro för",
  "debatt om",
  "diskussion om",
  "analys av",
];

const asWeeklyRetrospective = (summary: string) => {
  const trimmed = summary.trim();
  if (!trimmed) return "";
  const normalized = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
  return `Det rapporterades att ${normalized}.`;
};

const highlightSearchTerms = (text: string, terms: string[]) => {
  const normalizedTerms = [...new Set(terms.map((term) => term.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 10);
  if (!text || normalizedTerms.length === 0) return text;
  const pattern = normalizedTerms.map((term) => escapeRegex(term)).join("|");
  if (!pattern) return text;
  const regex = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(regex);
  if (parts.length <= 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <mark
        key={`${part}-${index}`}
        className="rounded-sm bg-[color-mix(in_srgb,var(--app-warning),transparent_76%)] px-0.5 text-[var(--app-fg)]"
      >
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    ),
  );
};

const matchFieldLabel: Record<NonNullable<SignalTrackingResult["match_field"]>, string> = {
  title: "rubrik",
  snippet: "sammanfattning",
  body: "artikeltext",
  url: "länk",
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

const getTrackingGeographyLabel = (item: SignalTrackingResult, config: EmbassyConfig) => {
  if (!item.detected_region) return config.geography.nationalLabel;
  const division = config.geography.administrativeDivisions.find(
    (candidate) => candidate.id === item.detected_region,
  );
  return division?.displayName ?? item.detected_region;
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

const getSignalCategoryIds = (item: IntelligenceItem) => {
  const tagIds = new Set<IntelligenceCategory>([item.category]);

  if (item.sweden_relevance_score >= 55) tagIds.add("sweden_connection");
  if (item.economic_impact_score >= 65) tagIds.add("economy");
  if (item.security_impact_score >= 55) tagIds.add("security");

  if (item.profile_tags.includes("trade_business")) tagIds.add("trade");
  if (item.profile_tags.includes("political_risk")) tagIds.add("domestic_politics");

  return Array.from(tagIds);
};

const getSignalThemeTags = (item: IntelligenceItem, config: EmbassyConfig) => {
  const tagIds = getSignalCategoryIds(item);

  return tagIds
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
  lastIngestedAt: initialLastIngestedAt,
}: MissionDashboardProps) {
  const [items, setItems] = useState<IntelligenceItem[]>(initialItems);
  const [briefings, setBriefings] = useState<Briefing[]>(initialBriefings);
  const [briefingSupportItems, setBriefingSupportItems] = useState<IntelligenceItem[]>([]);
  const [cacheTimestamp, setCacheTimestamp] = useState(initialCacheTimestamp);
  const [cacheExpiresAt, setCacheExpiresAt] = useState(initialCacheExpiresAt);
  const [secondaryStatus, setSecondaryStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [profile, setProfile] = useState<ProfileMode>(DEFAULT_PROFILE);
  const [showBriefingPanel, setShowBriefingPanel] = useState(false);
  const [showPrintPanel, setShowPrintPanel] = useState(false);
  const [showSignalTrackingPanel, setShowSignalTrackingPanel] = useState(false);
  const [manualPriorityIds, setManualPriorityIds] = useState<string[]>([]);
  const [suppressedPriorityIds, setSuppressedPriorityIds] = useState<string[]>([]);
  const [printItemIds, setPrintItemIds] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<IntelligenceCategory[]>([]);
  const [geographySelection, setGeographySelection] = useState<GeographySelection>({
    type: "national",
    ids: [],
  });
  const [expandedRegionIds, setExpandedRegionIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sourceQuery, setSourceQuery] = useState("");
  const [trackingQuery, setTrackingQuery] = useState("");
  const [trackingStatus, setTrackingStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [trackingLoadingMode, setTrackingLoadingMode] = useState<"local" | "deep">("local");
  const [trackingProgress, setTrackingProgress] = useState(0);
  const [trackingStepIndex, setTrackingStepIndex] = useState(0);
  const [trackingPayload, setTrackingPayload] = useState<SignalTrackingSearchResult | null>(null);
  const [trackingError, setTrackingError] = useState("");
  const [trackingAiEnabled, setTrackingAiEnabled] = useState(true);
  const [trackingIncludeWebRss, setTrackingIncludeWebRss] = useState(false);
  const [trackingQuickSearches, setTrackingQuickSearches] = useState<string[]>([
    ...SIGNAL_TRACKING_DEFAULT_QUICK_SEARCHES,
  ]);
  const [weeklySummaryWindow, setWeeklySummaryWindow] = useState<"week" | "month" | "custom">(
    "week",
  );
  const [weeklyCustomFrom, setWeeklyCustomFrom] = useState("");
  const [weeklyCustomTo, setWeeklyCustomTo] = useState("");
  const [upcomingSignals, setUpcomingSignals] = useState<TemporalSignalRecord[]>([]);
  const [upcomingSignalsStatus, setUpcomingSignalsStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [upcomingSignalsError, setUpcomingSignalsError] = useState("");
  const [regionalStatus, setRegionalStatus] = useState<RegionalStatus>("idle");
  const [regionalFreshness, setRegionalFreshness] = useState<string | undefined>();
  const [regionalCacheExpiresAt, setRegionalCacheExpiresAt] = useState<string | undefined>();
  const [regionalFromCache, setRegionalFromCache] = useState(false);
  const [regionalMessageIndex, setRegionalMessageIndex] = useState(0);
  const [regionalError, setRegionalError] = useState("");
  const [regionalLabels, setRegionalLabels] = useState<string[]>([]);
  const [viewNowTs] = useState(() => Date.now());
  const [cacheRefreshStatus, setCacheRefreshStatus] = useState<
    "idle" | "queued" | "loading" | "ready" | "error"
  >("idle");
  const [cacheRefreshJobStatus, setCacheRefreshJobStatus] = useState<
    CacheRefreshStatusPayload | undefined
  >();
  const [displayRefreshProgress, setDisplayRefreshProgress] = useState(0);
  const [lastIngestedAt, setLastIngestedAt] = useState(initialLastIngestedAt);
  const [pendingFeedUpdateConfirmation, setPendingFeedUpdateConfirmation] = useState(false);
  const [showUpdateInfo, setShowUpdateInfo] = useState(false);
  const [firstRunStatus, setFirstRunStatus] = useState<FirstRunStatusPayload | undefined>();
  const [firstRunRequestStatus, setFirstRunRequestStatus] = useState<
    "idle" | "starting" | "ready" | "error"
  >("idle");
  const regionalRequestCounter = useRef(0);
  const updateInfoRef = useRef<HTMLDivElement | null>(null);
  const trackingProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initiallyNeedsFirstRun = initialItems.length === 0 && initialBriefings.length === 0;
  const hasCachedIntelligence = items.length > 0 || briefings.length > 0;
  const showFirstRunPanel = initiallyNeedsFirstRun && !hasCachedIntelligence;
  const isUpcomingEventsProfile = profile === "upcoming_events";

  useEffect(() => {
    const stored = window.localStorage.getItem("missiondesk.activeView");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as ActiveViewState;
      if (parsed.kind === "briefing") {
        setShowBriefingPanel(true);
        setShowPrintPanel(false);
        setShowSignalTrackingPanel(false);
        return;
      }
      if (parsed.kind === "print") {
        setShowBriefingPanel(false);
        setShowPrintPanel(true);
        setShowSignalTrackingPanel(false);
        return;
      }
      if (parsed.kind === "tracking") {
        setShowBriefingPanel(false);
        setShowPrintPanel(false);
        setShowSignalTrackingPanel(true);
        return;
      }
      if (
        parsed.kind === "profile" &&
        config.profileModes.some((mode) => mode.id === parsed.profile)
      ) {
        setProfile(parsed.profile);
        setShowBriefingPanel(false);
        setShowPrintPanel(false);
        setShowSignalTrackingPanel(false);
      }
    } catch {
      // Ignore malformed local view state.
    }
  }, [config.profileModes]);

  useEffect(() => {
    const stored = window.localStorage.getItem("missiondesk.signalTracking.quickSearches");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as unknown;
      if (Array.isArray(parsed)) {
        const values = parsed.filter((item): item is string => typeof item === "string");
        if (values.length > 0) {
          const normalizedDefaults = values.map((value) => {
            const mapped = DEFAULT_QUICK_SEARCH_CANONICAL_CASE[value.trim().toLowerCase()];
            return mapped ?? value;
          });

          const legacyDefaultsMatch =
            values.length === LEGACY_SIGNAL_TRACKING_DEFAULT_QUICK_SEARCHES.length &&
            values.every(
              (value, index) =>
                value.toLowerCase() ===
                LEGACY_SIGNAL_TRACKING_DEFAULT_QUICK_SEARCHES[index].toLowerCase(),
            );

          const hydrated = legacyDefaultsMatch
            ? [...SIGNAL_TRACKING_DEFAULT_QUICK_SEARCHES]
            : normalizedDefaults;

          const changed =
            hydrated.length === values.length &&
            hydrated.some((value, index) => value !== values[index]);

          if (legacyDefaultsMatch || changed) {
            window.localStorage.setItem(
              "missiondesk.signalTracking.quickSearches",
              JSON.stringify(hydrated),
            );
          }
          window.setTimeout(() => setTrackingQuickSearches(hydrated.slice(0, 8)), 0);
        }
      }
    } catch {
      // Ignore malformed local preference state.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      "missiondesk.signalTracking.quickSearches",
      JSON.stringify(trackingQuickSearches.slice(0, 8)),
    );
  }, [trackingQuickSearches]);

  useEffect(() => {
    const state: ActiveViewState = showSignalTrackingPanel
      ? { kind: "tracking" }
      : showPrintPanel
        ? { kind: "print" }
        : showBriefingPanel
          ? { kind: "briefing" }
          : { kind: "profile", profile };
    window.localStorage.setItem("missiondesk.activeView", JSON.stringify(state));
  }, [profile, showBriefingPanel, showPrintPanel, showSignalTrackingPanel]);

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
      fetch("/api/intelligence/processed?limit=200", { cache: "no-store" }),
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

    setItems(processedPayload.items.map(processedRecordToIntelligenceItem));
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
    if (!isUpcomingEventsProfile || showBriefingPanel || showPrintPanel || showSignalTrackingPanel) {
      return;
    }

    let cancelled = false;

    async function loadUpcomingSignals() {
      setUpcomingSignalsStatus("loading");
      setUpcomingSignalsError("");

      try {
        const params = new URLSearchParams({
          limit: "120",
          minTemporalCertainty: "45",
          minStrategicImportance: "65",
          minSwedenMexicoRelevance: "0",
        });
        const response = await fetch(`/api/intelligence/upcoming?${params.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? "Kommande signaler kunde inte hämtas.");
        }

        const payload = (await response.json()) as UpcomingSignalsApiPayload;
        if (cancelled) return;
        setUpcomingSignals(payload.signals);
        setUpcomingSignalsStatus("ready");
      } catch (error) {
        if (cancelled) return;
        setUpcomingSignalsStatus("error");
        setUpcomingSignalsError(
          error instanceof Error ? error.message : "Kommande signaler kunde inte hämtas.",
        );
      }
    }

    void loadUpcomingSignals();

    return () => {
      cancelled = true;
    };
  }, [
    cacheTimestamp,
    isUpcomingEventsProfile,
    lastIngestedAt,
    showBriefingPanel,
    showPrintPanel,
    showSignalTrackingPanel,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadRefreshStatus() {
      try {
        const response = await fetch("/api/intelligence/cache/refresh", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as CacheRefreshStatusPayload;
        if (cancelled) return;
        setCacheRefreshJobStatus(payload);
        setDisplayRefreshProgress(displayedRefreshProgress(payload));
        if (payload.lastIngestedAt) setLastIngestedAt(payload.lastIngestedAt);
        if (payload.active) {
          setCacheRefreshStatus("queued");
        }
      } catch {
        // Status polling is non-critical; cached dashboard data still renders.
      }
    }

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

    void loadRefreshStatus();
    void loadSecondaryData();

    return () => {
      cancelled = true;
    };
  }, [loadCachedDashboardData]);

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
    if (cacheRefreshStatus !== "queued") return;
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
          setDisplayRefreshProgress(displayedRefreshProgress(payload));
          if (payload.lastIngestedAt) setLastIngestedAt(payload.lastIngestedAt);

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
    if (!cacheRefreshJobStatus?.active) {
      return;
    }

    const timer = window.setInterval(() => {
      setDisplayRefreshProgress(displayedRefreshProgress(cacheRefreshJobStatus));
    }, 2000);

    return () => window.clearInterval(timer);
  }, [cacheRefreshJobStatus]);

  useEffect(() => {
    if (!showUpdateInfo) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        updateInfoRef.current &&
        !updateInfoRef.current.contains(event.target as Node)
      ) {
        setShowUpdateInfo(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [showUpdateInfo]);

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

  const categoryFilteredItems = useMemo(() => {
    return items
      .filter((item) =>
        selectedCategories.length === 0
          ? true
          : selectedCategories.some((selectedCategory) =>
              getSignalCategoryIds(item).includes(selectedCategory),
            ),
      );
  }, [items, selectedCategories]);

  const regionSignalCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const region of config.geography.regions) {
      const count = categoryFilteredItems.filter((item) =>
        item.geographic_tags.some((tag) => region.divisionIds.includes(tag)),
      ).length;
      counts.set(region.id, count);
    }
    return counts;
  }, [categoryFilteredItems, config.geography.regions]);

  const baseFilteredItems = useMemo(() => {
    return categoryFilteredItems
      .filter((item) => itemMatchesGeography(item, config, geographySelection))
      .sort(byScore(config, profile));
  }, [categoryFilteredItems, config, geographySelection, profile]);

  const filteredItems = baseFilteredItems;

  const highSignalItems = filteredItems.filter(
    (item) => getCompositeScore(item, config, profile) >= 55,
  );
  const manualPriorityItems = manualPriorityIds
    .map((id) => filteredItems.find((item) => item.id === id))
    .filter((item): item is IntelligenceItem => Boolean(item));
  const automaticPriorityItems = highSignalItems.length > 0 ? highSignalItems : filteredItems;
  const automaticTopItems = automaticPriorityItems
    .slice(0, 5)
    .filter((item) => !suppressedPriorityIds.includes(item.id));
  const priorityItems = [
    ...manualPriorityItems,
    ...automaticTopItems.filter((item) => !manualPriorityIds.includes(item.id)),
  ];
  const topFive = priorityItems;
  const prioritizedIds = topFive.map((item) => item.id);
  const printItems = printItemIds
    .map((id) => [...items, ...briefingSupportItems].find((item) => item.id === id))
    .filter((item): item is IntelligenceItem => Boolean(item));
  const expandedItem =
    topFive.find((item) => item.id === expandedId) ?? topFive[0];

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

  const sourceRowsCurrentSignals = sourceRows
    .filter((item) => {
      const publishedTs = new Date(item.published_at).getTime();
      if (!Number.isFinite(publishedTs)) return false;
      return publishedTs >= Date.now() - 4 * 24 * 60 * 60 * 1000;
    })
    .sort(
      (left, right) =>
        new Date(right.published_at).getTime() - new Date(left.published_at).getTime(),
    )
    .slice(0, 200);

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
      `Hämtar regional lägesbild för ${label}...`,
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

  const startNationalFeedUpdate = useCallback(async () => {
    setCacheRefreshStatus("loading");
    setCacheRefreshJobStatus(undefined);
    setDisplayRefreshProgress(0);
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
      setDisplayRefreshProgress(displayedRefreshProgress(payload));
      if (payload.lastIngestedAt) setLastIngestedAt(payload.lastIngestedAt);
      setCacheRefreshStatus("queued");
    } catch {
      setCacheRefreshStatus("error");
    }
  }, []);

  const handleNationalCacheRefresh = useCallback(async () => {
    const freshnessSource = lastIngestedAt ?? cacheTimestamp;
    const lastIngestedTime = freshnessSource ? new Date(freshnessSource).getTime() : 0;
    const shouldConfirm =
      Number.isFinite(lastIngestedTime) &&
      lastIngestedTime > 0 &&
      Date.now() - lastIngestedTime < 24 * 60 * 60 * 1000;

    if (shouldConfirm) {
      setPendingFeedUpdateConfirmation(true);
      return;
    }

    await startNationalFeedUpdate();
  }, [cacheTimestamp, lastIngestedAt, startNationalFeedUpdate]);

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

  const activateSignalView = (nextProfile?: ProfileMode) => {
    if (nextProfile) {
      setProfile(nextProfile);
    }
    setShowBriefingPanel(false);
    setShowPrintPanel(false);
    setShowSignalTrackingPanel(false);
  };

  const activateSignalTrackingView = () => {
    setShowBriefingPanel(false);
    setShowPrintPanel(false);
    setShowSignalTrackingPanel(true);
  };

  const rememberTrackingSearch = useCallback((query: string) => {
    const value = query.trim();
    if (!value) return;
    setTrackingQuickSearches((current) => [
      value,
      ...current.filter((item) => item.toLowerCase() !== value.toLowerCase()),
    ].slice(0, 8));
  }, []);

  const runSignalTrackingSearch = useCallback(
    async (queryOverride?: string, mode: "local" | "deep" = "local") => {
      const query = (queryOverride ?? trackingQuery).trim();
      if (query.length < 2) return;

      setTrackingQuery(query);
      setTrackingStatus("loading");
      setTrackingLoadingMode(mode);
      setTrackingProgress(mode === "deep" ? 8 : 15);
      setTrackingStepIndex(0);
      setTrackingError("");
      rememberTrackingSearch(query);

      if (trackingProgressTimerRef.current) {
        clearInterval(trackingProgressTimerRef.current);
        trackingProgressTimerRef.current = null;
      }

      if (mode === "deep") {
        const caps = [26, 52, 76, 92];
        const stepCutoffs = [10, 28, 52];
        trackingProgressTimerRef.current = setInterval(() => {
          setTrackingProgress((current) => {
            const next = Math.min(92, current + (current < 55 ? 3 : 1));
            const step = stepCutoffs.reduce(
              (acc, cutoff, idx) => (next >= cutoff ? idx + 1 : acc),
              0,
            );
            setTrackingStepIndex(Math.min(3, step));
            const cap = caps[Math.min(3, step)];
            return Math.min(cap, next);
          });
        }, 1200);
      }

      try {
        const response = await fetch("/api/intelligence/signal-tracking", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            limit: mode === "deep" ? 60 : 50,
            mode,
            aiEnabled: trackingAiEnabled,
            deepSearchOptions: {
              includeWebRss: trackingIncludeWebRss,
              includeSocialX: true,
            },
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as
          | SignalTrackingSearchResult
          | { error?: string };

        if (!response.ok) {
          throw new Error("error" in payload ? payload.error : undefined);
        }

        setTrackingPayload(payload as SignalTrackingSearchResult);
        setTrackingProgress(100);
        setTrackingStepIndex(mode === "deep" ? 3 : 1);
        setTrackingStatus("ready");
      } catch (error) {
        setTrackingProgress(0);
        setTrackingStepIndex(0);
        setTrackingError(
          error instanceof Error
            ? error.message
            : "Signalspårningen kunde inte genomföras.",
        );
        setTrackingStatus("error");
      } finally {
        if (trackingProgressTimerRef.current) {
          clearInterval(trackingProgressTimerRef.current);
          trackingProgressTimerRef.current = null;
        }
      }
    },
    [
      rememberTrackingSearch,
      trackingAiEnabled,
      trackingIncludeWebRss,
      trackingQuery,
    ],
  );

  useEffect(() => {
    return () => {
      if (trackingProgressTimerRef.current) {
        clearInterval(trackingProgressTimerRef.current);
        trackingProgressTimerRef.current = null;
      }
    };
  }, []);

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
  const isWeeklySummaryProfile = profile === "weekly_summary";
  const upcomingEventItems = useMemo(() => {
    const unique = new Set<string>();

    return filteredItems
      .filter((item) => {
        return isUpcomingEventDate(item.event_date, viewNowTs);
      })
      .filter((item) => {
        const key = `${item.event_date}|${item.title_sv.toLowerCase()}|${item.source_url}`;
        if (unique.has(key)) return false;
        unique.add(key);
        return true;
      })
      .sort((left, right) => {
        const leftTime = eventDateRange(left.event_date)?.startTs ?? Number.POSITIVE_INFINITY;
        const rightTime = eventDateRange(right.event_date)?.startTs ?? Number.POSITIVE_INFINITY;
        if (leftTime !== rightTime) return leftTime - rightTime;
        return getCompositeScore(right, config, profile) - getCompositeScore(left, config, profile);
      })
      .slice(0, 120);
  }, [config, filteredItems, profile, viewNowTs]);
  const weeklySummaryItems = useMemo(() => {
    const now = viewNowTs;
    const customFromTs = weeklyCustomFrom ? new Date(`${weeklyCustomFrom}T00:00:00`).getTime() : Number.NaN;
    const customToTs = weeklyCustomTo ? new Date(`${weeklyCustomTo}T23:59:59`).getTime() : Number.NaN;
    const windowStart =
      weeklySummaryWindow === "week"
        ? now - 7 * 86400000
        : weeklySummaryWindow === "month"
          ? now - 30 * 86400000
          : Number.isFinite(customFromTs)
            ? customFromTs
            : now - 7 * 86400000;
    const windowEnd =
      weeklySummaryWindow === "custom" && Number.isFinite(customToTs) ? customToTs : now;
    const inWindow = filteredItems.filter((item) => {
      const ts = new Date(item.published_at).getTime();
      if (!Number.isFinite(ts) || ts < windowStart || ts > windowEnd) return false;

      const eventTs = eventDateRange(item.event_date)?.startTs ?? Number.NaN;
      if (Number.isFinite(eventTs) && eventTs > now) return false;
      if (Number.isFinite(eventTs) && eventTs < windowStart) return false;

      const text = [item.title_sv, item.title_original, item.summary_sv, item.original_excerpt]
        .join(" ")
        .toLowerCase();
      const hasConcreteDate = weeklyDatePattern.test(text) || Number.isFinite(eventTs);
      const hasAction = weeklyActionTerms.some((term) => text.includes(term));
      const genericOnly = weeklyGenericOnlyTerms.some((term) => text.includes(term));

      if (!hasConcreteDate && !hasAction) return false;
      if (genericOnly && !hasConcreteDate && !hasAction) return false;
      return true;
    });

    const groups = new Map<
      string,
      {
        representative: IntelligenceItem;
        items: IntelligenceItem[];
        latestTs: number;
      }
    >();

    for (const item of inWindow) {
      const fingerprint = normalizeForGrouping(item.title_sv || item.title_original).split(" ").slice(0, 10).join(" ");
      const key = `${item.category}|${fingerprint}`;
      const ts = new Date(item.published_at).getTime();
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, { representative: item, items: [item], latestTs: ts });
        continue;
      }
      existing.items.push(item);
      if (ts > existing.latestTs) {
        existing.latestTs = ts;
        existing.representative = item;
      }
    }

    return [...groups.values()]
      .sort((a, b) => b.latestTs - a.latestTs)
      .slice(0, weeklySummaryWindow === "week" ? 16 : 28);
  }, [filteredItems, viewNowTs, weeklySummaryWindow, weeklyCustomFrom, weeklyCustomTo]);
  const morningBriefing = briefings.find((briefing) => briefing.type === "morning_brief");
  const ambassadorBriefing =
    briefings.find((briefing) => briefing.type === "ambassador_brief") ?? morningBriefing;
  const briefingSourceItems = useMemo(() => {
    if (!ambassadorBriefing) return [];

    const itemsById = new Map<string, IntelligenceItem>();
    for (const item of [...items, ...briefingSupportItems]) {
      itemsById.set(item.id, item);
    }

    return ambassadorBriefing.source_item_ids
      .map((sourceId) => itemsById.get(`processed-${sourceId}`))
      .filter((item): item is IntelligenceItem => Boolean(item));
  }, [ambassadorBriefing, briefingSupportItems, items]);

  useEffect(() => {
    if (!showBriefingPanel || !ambassadorBriefing || ambassadorBriefing.source_item_ids.length === 0) {
      setBriefingSupportItems([]);
      return;
    }

    const existingIds = new Set(items.map((item) => item.id));
    const missingRawIds = ambassadorBriefing.source_item_ids.filter(
      (sourceId) => !existingIds.has(`processed-${sourceId}`),
    );

    if (missingRawIds.length === 0) {
      setBriefingSupportItems([]);
      return;
    }

    let cancelled = false;

    async function loadBriefingSupportItems() {
      try {
        const params = new URLSearchParams({
          limit: String(Math.max(missingRawIds.length, 1)),
          fresh: "0",
          rawSourceItemIds: missingRawIds.join(","),
        });

        const response = await fetch(`/api/intelligence/processed?${params.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error("Briefing support items could not be loaded");
        }

        const payload = (await response.json()) as { items: ProcessedIntelligenceRecord[] };
        if (cancelled) return;
        setBriefingSupportItems(payload.items.map(processedRecordToIntelligenceItem));
      } catch {
        if (!cancelled) {
          setBriefingSupportItems([]);
        }
      }
    }

    void loadBriefingSupportItems();

    return () => {
      cancelled = true;
    };
  }, [ambassadorBriefing, items, showBriefingPanel]);

  const openBriefingPrintView = useCallback(() => {
    const seedItems = briefingSourceItems.length > 0 ? briefingSourceItems : topFive.slice(0, 5);
    setPrintItemIds(seedItems.map((item) => item.id));
    setShowBriefingPanel(false);
    setShowPrintPanel(true);
    setShowSignalTrackingPanel(false);
  }, [briefingSourceItems, topFive]);

  const hasPrimaryData = Boolean(ambassadorBriefing || topFive.length > 0);
  const statusTimestamp =
    lastIngestedAt ?? cacheRefreshJobStatus?.updateCompletedAt ?? cacheTimestamp;
  const primaryStatusLine = statusTimestamp
    ? `Färsk lägesbild · uppdaterad ${formatDate(statusTimestamp, true)} Mexico City-tid`
    : "Ingen lägesbild tillgänglig";
  const shouldShowRefreshMessage = Boolean(
    cacheRefreshJobStatus &&
      (
        ((cacheRefreshStatus === "loading" || cacheRefreshStatus === "queued") &&
          cacheRefreshJobStatus.active) ||
        cacheRefreshStatus === "ready" ||
        cacheRefreshStatus === "error"
      ),
  );

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
            <span>{primaryStatusLine}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {shouldShowRefreshMessage && cacheRefreshJobStatus && (
              <span
                className={clsx(
                  "text-xs",
                  cacheRefreshStatus === "error"
                    ? "text-[var(--app-warning)]"
                    : "text-[var(--app-muted)]",
                )}
              >
                {cacheRefreshJobStatus.message}
                {cacheRefreshJobStatus.active ? ` · ${displayRefreshProgress}%` : ""}
              </span>
            )}
            <div ref={updateInfoRef} className="relative flex items-center gap-2">
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
                    ? "Uppdaterar lägesbild..."
                    : cacheRefreshStatus === "ready"
                      ? "Uppdatera flöde"
                      : cacheRefreshStatus === "error"
                        ? "Försök igen"
                        : "Uppdatera flöde"}
              </button>
              <button
                type="button"
                onClick={() => setShowUpdateInfo((value) => !value)}
                aria-label="Om uppdateringar"
                aria-expanded={showUpdateInfo}
                className="inline-flex h-9 w-9 items-center justify-center text-[var(--app-muted)] transition hover:text-[var(--app-fg)]"
              >
                <Info className="h-5 w-5" />
              </button>
              {showUpdateInfo && (
                <div className="absolute right-0 top-10 z-30 w-80 rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-strong)] p-4 text-xs leading-5 text-[var(--app-fg)] shadow-xl">
                  <p className="font-medium text-[var(--app-fg)]">Om uppdateringar</p>
                  <p className="mt-2">
                    MissionDesk återanvänder redan bearbetade signaler och analyserar bara
                    nytillkommet material när flödet uppdateras.
                  </p>
                  <p className="mt-2">
                    En körning tar normalt 3-10 minuter beroende på antal nya källposter och
                    hur mycket som behöver sammanfattas.
                  </p>
                  <p className="mt-4">
                    Detta kan medföra ytterligare AI-kostnader.
                  </p>
                  <p className="mt-3">
                    En daglig uppdatering rekommenderas normalt.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {pendingFeedUpdateConfirmation && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="feed-update-confirm-title"
              className="surface-strong w-full max-w-md rounded-xl p-5 shadow-2xl"
            >
              <h2
                id="feed-update-confirm-title"
                className="text-lg font-semibold text-[var(--app-fg)]"
              >
                Uppdatera lägesbild?
              </h2>
              <p className="mt-3 text-sm leading-6 text-[var(--app-soft)]">
                Den aktuella lägesbilden är fortfarande färsk.
                <br />
                Fortsatt uppdatering analyserar nytillkomna signaler och kan medföra
                ytterligare AI-kostnader.
              </p>
              <p className="mt-3 text-sm leading-6 text-[var(--app-soft)]">
                En daglig uppdatering rekommenderas normalt.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingFeedUpdateConfirmation(false)}
                  className="rounded-md border border-[var(--app-line)] px-3 py-2 text-xs font-medium text-[var(--app-soft)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-fg)]"
                >
                  Avbryt
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPendingFeedUpdateConfirmation(false);
                    void startNationalFeedUpdate();
                  }}
                  className="rounded-md border border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_84%)] px-3 py-2 text-xs font-medium text-[var(--app-fg)] transition hover:bg-[color-mix(in_srgb,var(--app-accent),transparent_76%)]"
                >
                  Uppdatera
                </button>
              </div>
            </div>
          </div>
        )}

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
                      setShowSignalTrackingPanel(false);
                    }}
                  />
                  {config.profileModes
                    .filter(
                      (mode) =>
                        mode.id !== "sweden_connection" &&
                        mode.id !== "ambassador_briefing" &&
                        mode.id !== "trade_business" &&
                        mode.id !== "political_risk" &&
                        mode.id !== "security" &&
                        mode.id !== "weekly_summary",
                    )
                    .map((mode) => {
                    const Icon = profileIcon[mode.id];
                    const active =
                      !showBriefingPanel &&
                      !showPrintPanel &&
                      !showSignalTrackingPanel &&
                      mode.id === profile;
                    return (
                      <div key={mode.id} className="grid gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            activateSignalView(mode.id);
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
                      setShowSignalTrackingPanel(false);
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
                        Mötesunderlag
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">
                        Valda signaler för briefing och utskrift
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={activateSignalTrackingView}
                    className={clsx(
                      "flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition",
                      showSignalTrackingPanel
                        ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_86%)]"
                        : "border-[var(--app-line)] bg-[var(--app-panel-muted)] hover:border-[var(--app-accent)]",
                    )}
                  >
                    <Radar className="h-4 w-4 shrink-0 text-[var(--app-accent)]" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[var(--app-fg)]">
                        Signalspårning
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">
                        Riktad sökning i källor
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
                      active
                      onClick={() => undefined}
                      icon={ListFilter}
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
                                    {regionSignalCounts.get(region.id) ?? 0}
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
                sourceItems={briefingSourceItems}
                cacheTimestamp={cacheTimestamp}
                config={config}
                onPrint={openBriefingPrintView}
              />
            )}

            {showSignalTrackingPanel && (
              <SignalTrackingPanel
                query={trackingQuery}
                onQueryChange={setTrackingQuery}
                status={trackingStatus}
                payload={trackingPayload}
                error={trackingError}
                quickSearches={trackingQuickSearches}
                aiEnabled={trackingAiEnabled}
                onAiEnabledChange={setTrackingAiEnabled}
                includeWebRss={trackingIncludeWebRss}
                onIncludeWebRssChange={setTrackingIncludeWebRss}
                onSearch={(query) => void runSignalTrackingSearch(query, "local")}
                onDeepSearch={(query) => void runSignalTrackingSearch(query, "deep")}
                config={config}
                loadingMode={trackingLoadingMode}
                loadingProgress={trackingProgress}
                loadingStepIndex={trackingStepIndex}
              />
            )}

            {showPrintPanel && (
              <CustomPrintPanel
                items={printItems}
                config={config}
                onRemove={(id) => togglePrintItem(id, false)}
                onOpenSignals={activateSignalView}
              />
            )}

            {!showBriefingPanel && !showPrintPanel && !showSignalTrackingPanel && !isUpcomingEventsProfile && !isWeeklySummaryProfile && (
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
                            ? "Ingen aktuell nationell lägesbild"
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

            {!showBriefingPanel && !showPrintPanel && !showSignalTrackingPanel && isUpcomingEventsProfile && (
              <UpcomingSignalsPanel
                signals={upcomingSignals}
                status={upcomingSignalsStatus}
                errorMessage={upcomingSignalsError}
                config={config}
                nowTs={viewNowTs}
              />
            )}

            {!showBriefingPanel && !showPrintPanel && !showSignalTrackingPanel && isWeeklySummaryProfile && (
              <WeeklySummaryPanel
                windowMode={weeklySummaryWindow}
                onWindowChange={setWeeklySummaryWindow}
                groups={weeklySummaryItems}
                config={config}
                customFrom={weeklyCustomFrom}
                customTo={weeklyCustomTo}
                onCustomFromChange={setWeeklyCustomFrom}
                onCustomToChange={setWeeklyCustomTo}
              />
            )}

            {!showBriefingPanel && !showPrintPanel && !showSignalTrackingPanel && !isUpcomingEventsProfile && !isWeeklySummaryProfile && (
              <SourceFeed
                rows={sourceRowsCurrentSignals}
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
  onRemove,
  onOpenSignals,
}: {
  items: IntelligenceItem[];
  config: EmbassyConfig;
  onRemove: (id: string) => void;
  onOpenSignals: () => void;
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
              Mötesunderlag
            </h2>
            <p className="mt-1 text-sm text-[var(--app-muted)]">
              MissionDesk · Sveriges ambassad · {config.city}
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
              Valda signaler sammanställs för briefing och utskrift.
            </p>
          </div>
        </div>
        <div className="missiondesk-print-actions flex flex-wrap gap-2">
          <Pill tone="neutral">{items.length} valda signaler</Pill>
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
          <EmptyState
            title={
              <span className="block">
                <span className="block">Inga signaler har lagts till ännu.</span>
                <span className="mt-3 block">
                  <button
                    type="button"
                    onClick={onOpenSignals}
                    className="font-medium text-[var(--app-accent)] underline-offset-4 hover:underline"
                  >
                    Öppna en prioriterad signal
                  </button>{" "}
                  och välj &quot;Ta med i mötesunderlag&quot; i fördjupningsvyn för att skapa
                  ett eget underlag.
                </span>
              </span>
            }
          />
        </div>
      )}
    </section>
  );
}

function SignalTrackingPanel({
  query,
  onQueryChange,
  status,
  payload,
  error,
  quickSearches,
  aiEnabled,
  onAiEnabledChange,
  includeWebRss,
  onIncludeWebRssChange,
  onSearch,
  onDeepSearch,
  config,
  loadingMode,
  loadingProgress,
  loadingStepIndex,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  status: "idle" | "loading" | "ready" | "error";
  payload: SignalTrackingSearchResult | null;
  error: string;
  quickSearches: string[];
  aiEnabled: boolean;
  onAiEnabledChange: (value: boolean) => void;
  includeWebRss: boolean;
  onIncludeWebRssChange: (value: boolean) => void;
  onSearch: (query?: string) => void;
  onDeepSearch: (query?: string) => void;
  config: EmbassyConfig;
  loadingMode: "local" | "deep";
  loadingProgress: number;
  loadingStepIndex: number;
}) {
  const results = payload?.results ?? [];
  const [showTrackingInfo, setShowTrackingInfo] = useState(false);
  const trackingInfoRef = useRef<HTMLDivElement | null>(null);
  const deepSearchSteps = [
    "Läser lokala signaler och matchar sökord",
    "Skannar aktiva RSS- och webbkällor",
    "Hämtar senaste poster från aktiva X-konton",
    "Deduplicerar och sammanställer träffar",
  ];

  useEffect(() => {
    if (!showTrackingInfo) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!trackingInfoRef.current) return;
      if (!trackingInfoRef.current.contains(event.target as Node)) {
        setShowTrackingInfo(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showTrackingInfo]);

  return (
    <section className="missiondesk-print-panel surface-strong rounded-xl p-5">
      <div className="border-b border-[var(--app-line)] pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SectionKicker icon={Radar} label="Signalspårning" />
              <div ref={trackingInfoRef} className="relative">
                <button
                  type="button"
                  onClick={() => setShowTrackingInfo((value) => !value)}
                  aria-label="Om signalspårning"
                  aria-expanded={showTrackingInfo}
                  className="inline-flex h-9 w-9 items-center justify-center text-[var(--app-muted)] transition hover:text-[var(--app-fg)]"
                >
                  <Info className="h-5 w-5" />
                </button>
                {showTrackingInfo && (
                  <div className="absolute left-0 top-9 z-30 w-[340px] max-w-[90vw] rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-strong)] p-3 text-xs leading-5 text-[var(--app-fg)] shadow-xl">
                    <p className="font-medium text-[var(--app-fg)]">Om signalspårning</p>
                    <p className="mt-2">
                      <strong>Standardsökning</strong> söker i redan skannade och sparade signaler, inklusive tidigare hämtade <strong>X-poster</strong>.
                    </p>
                    <p className="mt-2">
                      Aktivera <strong>utökad sökning</strong> för att skanna aktiva <strong>webb-/RSS-källor</strong> och hämta de senaste posterna från aktiva <strong>X-konton</strong>.
                    </p>
                    <p className="mt-2">
                      <strong>AI-bearbetning</strong> visar träffar översatta och kort sammanfattade på svenska. När AI-bearbetning är av visas innehållet på <strong>originalspråk</strong>.
                    </p>
                    <p className="mt-2">
                      <strong>Utökad sökning</strong> och <strong>AI-bearbetning</strong> kan medföra ytterligare <strong>API- och AI-kostnader</strong>.
                    </p>
                  </div>
                )}
              </div>
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-normal">
              Riktad sökning i källor
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
              Sök efter aktörer, teman eller händelser i MissionDesks källor.
            </p>
          </div>
          {payload && (
            <div className="flex flex-wrap gap-2">
              <Pill tone="neutral">{payload.resultCount} träffar</Pill>
              <Pill tone="neutral">{payload.sourceCount} källor</Pill>
            </div>
          )}
        </div>

        <form
          className="mt-5 flex flex-col gap-3 md:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (includeWebRss) {
              onDeepSearch();
            } else {
              onSearch();
            }
          }}
        >
          <label className="flex min-h-11 flex-1 items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3">
            <Search className="h-4 w-4 text-[var(--app-muted)]" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Sök på aktör, tema, plats eller nyckelord"
              className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--app-muted)]"
            />
          </label>
          <button
            type="submit"
            disabled={status === "loading" || query.trim().length < 2}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent),transparent_84%)] px-4 text-sm font-medium text-[var(--app-fg)] transition hover:bg-[color-mix(in_srgb,var(--app-accent),transparent_76%)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
            Sök
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--app-muted)]">
          <label className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-2.5 py-1.5">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(event) => onAiEnabledChange(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--app-accent)]"
            />
            AI-bearbetning
          </label>
          <label className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-2.5 py-1.5">
            <input
              type="checkbox"
              checked={includeWebRss}
              onChange={(event) => onIncludeWebRssChange(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--app-accent)]"
            />
            Utökad sökning
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {quickSearches.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                onQueryChange(item);
              }}
              className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-1.5 text-xs font-medium text-[var(--app-soft)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-fg)]"
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        {status === "idle" && (
          <EmptyState title="Sök efter aktörer, teman eller händelser i MissionDesks källor." />
        )}

        {status === "loading" && (
          <div className="space-y-3 rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-4">
            <p className="text-sm font-medium text-[var(--app-fg)]">
              {loadingMode === "deep"
                ? "Utökad sökning pågår..."
                : "Lokal sökning pågår..."}
            </p>
            {loadingMode === "deep" ? (
              <>
                <div className="h-2 w-full overflow-hidden rounded bg-[color-mix(in_srgb,var(--app-muted),transparent_82%)]">
                  <div
                    className="h-full rounded bg-[var(--app-accent)] transition-all duration-500"
                    style={{ width: `${Math.max(6, Math.min(100, loadingProgress))}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--app-muted)]">
                  <span>{deepSearchSteps[Math.min(deepSearchSteps.length - 1, loadingStepIndex)]}</span>
                  <span>{Math.round(Math.max(6, Math.min(100, loadingProgress)))}%</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-[var(--app-muted)]">
                Söker i redan sparade signaler och tidigare hämtade poster.
              </p>
            )}
          </div>
        )}

        {status === "error" && (
          <EmptyState title={error || "Signalspårningen kunde inte genomföras."} />
        )}

        {status === "ready" && results.length === 0 && (
          <EmptyState title="Få eller inga träffar hittades." />
        )}

        {status === "ready" && results.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Pill tone={payload?.mode === "deep" ? "gold" : "neutral"}>
                {payload?.mode === "deep" ? "Utökad sökning" : "Lokal sökning"}
              </Pill>
              {payload?.deepSearchUsed && <Pill tone="neutral">{payload.scannedSourceCount} skannade källor</Pill>}
              {payload?.aiEnabled ? <Pill tone="neutral">AI på</Pill> : <Pill tone="neutral">AI av</Pill>}
            </div>
            {payload?.notes?.length ? (
              <div className="rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3 text-xs leading-5 text-[var(--app-muted)]">
                {payload.notes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            ) : null}
            {results.map((item) => {
              const Icon = categoryIcon[item.category];
              const geographyLabel = getTrackingGeographyLabel(item, config);
              const highlightTerms = [
                ...(payload?.queryVariants ?? []),
                item.match_term ?? "",
                query,
              ].filter(Boolean);
              const displayTitle = decodeHtmlEntities(item.title_sv);
              const displayOriginalTitle = decodeHtmlEntities(item.title_original);
              const displaySnippet = decodeHtmlEntities(item.snippet_sv ?? item.snippet_original);
              const displayMatchExcerpt = decodeHtmlEntities(item.match_excerpt);

              return (
                <article
                  key={item.id}
                  className="rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
                        <span className="flex items-center gap-1.5">
                          <Icon className={clsx("h-3.5 w-3.5", categoryIconTone[item.category])} />
                          {getCategoryLabel(config, item.category)}
                        </span>
                        <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                        <span>{geographyLabel}</span>
                        <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                        <span>{formatDate(item.published_at, true)}</span>
                        {item.source_type === "social" && (
                          <span className="rounded border border-[color-mix(in_srgb,var(--app-gold),transparent_42%)] bg-[color-mix(in_srgb,var(--app-gold),transparent_90%)] px-2 py-0.5 text-[11px] font-medium text-[var(--app-gold)]">
                            X-konto
                          </span>
                        )}
                      </div>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group text-base font-semibold leading-6 text-[var(--app-fg)] transition hover:text-[var(--app-accent)]"
                      >
                        <span className="group-hover:underline group-hover:decoration-1 group-hover:decoration-[color-mix(in_srgb,var(--app-fg),transparent_38%)] group-hover:underline-offset-3">
                          {highlightSearchTerms(displayTitle, highlightTerms)}
                        </span>
                      </a>
                      {displayTitle !== displayOriginalTitle && (
                        <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]">
                          {highlightSearchTerms(displayOriginalTitle, highlightTerms)}
                        </p>
                      )}
                      {(item.snippet_sv ?? item.snippet_original) && (
                        <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--app-soft)]">
                          {highlightSearchTerms(displaySnippet, highlightTerms)}
                        </p>
                      )}
                      {item.match_field && displayMatchExcerpt ? (
                        <p className="mt-2 text-xs leading-5 text-[var(--app-muted)]">
                          Träff i {matchFieldLabel[item.match_field]}:{" "}
                          {highlightSearchTerms(displayMatchExcerpt, highlightTerms)}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-xs leading-5 text-[var(--app-muted)] lg:text-right">
                      <p className="font-medium text-[var(--app-soft)]">
                        {decodeHtmlEntities(
                          item.source_type === "social"
                            ? `${item.source_name} på X`
                            : item.source_name,
                        )}
                      </p>
                      <p>
                        {countryNameSv(item.source_country) ?? item.source_country} ·{" "}
                        {item.source_language.toUpperCase()}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function UpcomingSignalsPanel({
  signals,
  status,
  errorMessage,
  config,
  nowTs,
}: {
  signals: TemporalSignalRecord[];
  status: "idle" | "loading" | "ready" | "error";
  errorMessage: string;
  config: EmbassyConfig;
  nowTs: number;
}) {
  const [sortMode, setSortMode] = useState<UpcomingSortMode>("priority");
  const [horizonFilter, setHorizonFilter] = useState<UpcomingHorizonFilter>("all");
  const [typeFilter, setTypeFilter] = useState<UpcomingTypeFilter>("all");

  const hasTemporalSignals = signals.length > 0;
  const visibleSignals = useMemo(() => {
    return [...signals]
      .filter((record) => {
        const timing = temporalSignalTiming(record.signal, nowTs);
        if (horizonFilter === "all") return true;
        if (horizonFilter === "ongoing") return timing.isOngoing;
        if (timing.days === null) return false;
        if (horizonFilter === "7d") return timing.days <= 7;
        if (horizonFilter === "30d") return timing.days <= 30;
        if (horizonFilter === "90d") return timing.days <= 90;
        if (horizonFilter === "later") return timing.days > 90;
        return true;
      })
      .filter((record) => typeFilter === "all" || temporalSignalTypeGroup(record) === typeFilter)
      .sort((left, right) => {
        const leftTiming = temporalSignalTiming(left.signal, nowTs);
        const rightTiming = temporalSignalTiming(right.signal, nowTs);

        if (sortMode === "soonest") {
          const leftTs = Number.isFinite(leftTiming.referenceTs)
            ? leftTiming.referenceTs
            : Number.POSITIVE_INFINITY;
          const rightTs = Number.isFinite(rightTiming.referenceTs)
            ? rightTiming.referenceTs
            : Number.POSITIVE_INFINITY;
          if (leftTs !== rightTs) return leftTs - rightTs;
          return temporalPriorityScore(right, nowTs) - temporalPriorityScore(left, nowTs);
        }

        if (sortMode === "certainty") {
          if (left.signal.temporal_certainty_score !== right.signal.temporal_certainty_score) {
            return right.signal.temporal_certainty_score - left.signal.temporal_certainty_score;
          }
          return temporalPriorityScore(right, nowTs) - temporalPriorityScore(left, nowTs);
        }

        return temporalPriorityScore(right, nowTs) - temporalPriorityScore(left, nowTs);
      });
  }, [horizonFilter, nowTs, signals, sortMode, typeFilter]);

  return (
    <section className="missiondesk-print-panel surface-strong rounded-xl p-5">
      <div className="flex flex-col gap-3 border-b border-[var(--app-line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SectionKicker icon={CalendarDays} label="Framåtblick" />
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-normal">Kommande signaler</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
            Strategiska framtidssignaler med tidsfönster, relevansbedömning och spårbara källmeningar.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="neutral">
            {visibleSignals.length === signals.length
              ? `${signals.length} signaler`
              : `${visibleSignals.length} av ${signals.length} signaler`}
          </Pill>
          <Pill tone="neutral">{UPCOMING_EVENTS_HORIZON_DAYS} dagars horisont</Pill>
        </div>
      </div>

      {status === "loading" && !hasTemporalSignals ? (
        <div className="mt-6 rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-6 text-sm text-[var(--app-soft)]">
          <div className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Läser kommande signaler…
          </div>
        </div>
      ) : null}

      {status === "error" && !hasTemporalSignals ? (
        <div className="mt-6 rounded-lg border border-[color-mix(in_srgb,var(--app-danger),transparent_48%)] bg-[color-mix(in_srgb,var(--app-danger),transparent_92%)] p-4 text-sm text-[var(--app-soft)]">
          Kunde inte läsa kommande signaler just nu. {errorMessage}
        </div>
      ) : null}

      {hasTemporalSignals ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-3">
            {visibleSignals.length > 0 ? (
              visibleSignals.map((record) => {
                const { isOngoing, days } = temporalSignalTiming(record.signal, nowTs);
                const verificationLevel =
                  record.raw.source_country === "Sverige" ||
                  record.raw.source_country === "Mexiko"
                    ? "Hög verifiering"
                    : "Medel verifiering";
                const sourceItem = processedRecordToIntelligenceItem(record);
                const dateCard = temporalSignalDateCard(record.signal, nowTs);
                return (
                  <article
                    key={record.signal.id}
                    className="rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-4"
                  >
                    <div className="grid gap-4 md:grid-cols-[108px_minmax(0,1fr)] md:items-start">
                      <div className="flex min-h-[124px] min-w-[96px] flex-col justify-between rounded-lg bg-[color-mix(in_srgb,var(--app-gold),transparent_84%)] px-3 py-3 text-center shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--app-gold),transparent_46%)]">
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[color-mix(in_srgb,var(--app-gold),white_18%)]">
                            {dateCard.eyebrow}
                          </span>
                          <span className="mt-1 block text-3xl font-semibold leading-none text-[var(--app-fg)]">
                            {dateCard.day}
                          </span>
                          <span className="mt-1 block text-xs font-semibold uppercase tracking-[0.14em] text-[color-mix(in_srgb,var(--app-gold),white_10%)]">
                            {dateCard.month}
                          </span>
                          <span className="mt-1 block text-xs text-[var(--app-soft)]">{dateCard.year}</span>
                        </div>
                        <div className="mt-3 border-t border-[color-mix(in_srgb,var(--app-gold),transparent_58%)] pt-2">
                          <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-[color-mix(in_srgb,var(--app-gold),white_18%)]">
                            Tidsläge
                          </span>
                          <span className="mt-1 block text-sm font-medium text-[var(--app-fg)]">
                            {dateCard.relativeLabel}
                          </span>
                          <span className="mt-1 block text-[11px] leading-4 text-[var(--app-muted)]">
                            {dateCard.timelineLabel}
                          </span>
                        </div>
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3.5 w-3.5" />
                            {isOngoing && record.signal.date_end
                              ? `Pågår till ${formatDate(record.signal.date_end)}`
                              : formatDateRange(record.signal.date_start, record.signal.date_end)}
                          </span>
                          <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                          <span>{dateCard.relativeLabel}</span>
                          <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                          <span>{verificationLevel}</span>
                          <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                          <span>{getGeographyLabel(sourceItem, config)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Pill tone="neutral">{temporalContextLabel[record.signal.temporal_context]}</Pill>
                          <Pill tone="neutral">Tidsvisshet {record.signal.temporal_certainty_score}</Pill>
                          <Pill tone="neutral">Strategi {record.signal.strategic_importance_score}</Pill>
                          {record.signal.sweden_mexico_relevance_score > 0 ? (
                            <Pill tone="neutral">Sve/Mex {record.signal.sweden_mexico_relevance_score}</Pill>
                          ) : null}
                        </div>
                        <h3 className="mt-3 text-base font-semibold leading-6 text-[var(--app-fg)]">
                          {record.processed.title_sv}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-[var(--app-soft)]">
                          {record.signal.normalized_summary || record.processed.summary_sv}
                        </p>
                        <p className="mt-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel)] px-3 py-2 text-xs leading-5 text-[var(--app-muted)]">
                          Spårbarhet: {record.signal.source_sentence}
                        </p>
                        <a
                          href={record.raw.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[var(--app-accent)] underline-offset-3 hover:underline"
                        >
                          {xSourceDisplayName(record.raw.source_name, record.raw.url)}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-6">
                <EmptyState title="Inga signaler matchar valt urval just nu" />
              </div>
            )}
          </div>

          <aside className="xl:sticky xl:top-5 xl:self-start">
            <div className="rounded-lg border border-[var(--app-line)] bg-[var(--app-panel)] p-3">
              <div className="flex items-center gap-2 border-b border-[var(--app-line)] pb-3">
                <ListFilter className="h-4 w-4 text-[var(--app-muted)]" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--app-fg)]">Urval</p>
                  <p className="text-[11px] leading-5 text-[var(--app-muted)]">
                    Sortera och fokusera utan att ta höjd från listan.
                  </p>
                </div>
              </div>

              <div className="mt-3 space-y-4">
                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                    Sortering
                  </p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {upcomingSortOptions.map((option) => {
                      const active = sortMode === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setSortMode(option.id)}
                          className={clsx(
                            "inline-flex items-center justify-between rounded-md border px-3 py-2 text-left text-xs font-medium transition",
                            active
                              ? "border-[color-mix(in_srgb,var(--app-accent),transparent_40%)] bg-[color-mix(in_srgb,var(--app-accent),transparent_88%)] text-[var(--app-fg)]"
                              : "border-[var(--app-line)] text-[var(--app-soft)] hover:text-[var(--app-fg)]",
                          )}
                        >
                          <span>{option.label}</span>
                          {active ? <Check className="h-3.5 w-3.5" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                    Tidsläge
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {upcomingHorizonOptions.map((option) => {
                      const active = horizonFilter === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setHorizonFilter(option.id)}
                          className={clsx(
                            "inline-flex items-center rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition",
                            active
                              ? "border-[color-mix(in_srgb,var(--app-gold),transparent_34%)] bg-[color-mix(in_srgb,var(--app-gold),transparent_86%)] text-[var(--app-fg)]"
                              : "border-[var(--app-line)] text-[var(--app-soft)] hover:text-[var(--app-fg)]",
                          )}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                    Signaltyp
                  </p>
                  <div className="grid grid-cols-1 gap-1.5">
                    {upcomingTypeOptions.map((option) => {
                      const active = typeFilter === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setTypeFilter(option.id)}
                          className={clsx(
                            "inline-flex items-center justify-between rounded-md border px-3 py-2 text-left text-xs font-medium transition",
                            active
                              ? "border-[color-mix(in_srgb,var(--app-warning),transparent_36%)] bg-[color-mix(in_srgb,var(--app-warning),transparent_88%)] text-[var(--app-fg)]"
                              : "border-[var(--app-line)] text-[var(--app-soft)] hover:text-[var(--app-fg)]",
                          )}
                        >
                          <span>{option.label}</span>
                          {active ? <Check className="h-3.5 w-3.5" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-6">
          <EmptyState title="Inga kommande signaler hittades i urvalet just nu" />
        </div>
      )}
    </section>
  );
}

function WeeklySummaryPanel({
  windowMode,
  onWindowChange,
  groups,
  config,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
}: {
  windowMode: "week" | "month" | "custom";
  onWindowChange: (mode: "week" | "month" | "custom") => void;
  groups: Array<{
    representative: IntelligenceItem;
    items: IntelligenceItem[];
    latestTs: number;
  }>;
  config: EmbassyConfig;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
}) {
  const handlePrint = () => window.print();
  const periodEnd = new Date();
  const periodStart = new Date(
    windowMode === "week"
      ? periodEnd.getTime() - 7 * 86400000
      : windowMode === "month"
        ? periodEnd.getTime() - 30 * 86400000
        : customFrom
          ? new Date(`${customFrom}T00:00:00`).getTime()
          : periodEnd.getTime() - 7 * 86400000,
  );
  const customToDate = customTo ? new Date(`${customTo}T23:59:59`) : periodEnd;
  const labelEnd = windowMode === "custom" && customTo ? customToDate : periodEnd;
  const periodLabel = `${formatDate(periodStart.toISOString())} – ${formatDate(labelEnd.toISOString())}`;

  return (
    <section className="surface-strong rounded-xl p-5">
      <div className="flex flex-col gap-3 border-b border-[var(--app-line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SectionKicker icon={ClipboardList} label="Veckosammanfattning" />
            <span className="text-xs text-[var(--app-muted)]">–</span>
            <span className="inline-flex items-center rounded border border-[color-mix(in_srgb,var(--app-gold),transparent_42%)] bg-[color-mix(in_srgb,var(--app-gold),transparent_86%)] px-2 py-1 text-xs font-medium text-[var(--app-gold)]">
              Konkreta händelser
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-normal">
            Sammanfattning av gångna perioden
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
            Daterade, spårbara händelser grupperade från skannade signaler.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="gold">{periodLabel}</Pill>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onWindowChange("week")}
              aria-label="Visa senaste veckan"
              className={clsx(
                "inline-flex h-8 w-36 items-center justify-center rounded px-2 py-1 text-xs font-medium transition whitespace-nowrap",
                windowMode === "week"
                  ? "border border-[color-mix(in_srgb,var(--app-gold),transparent_45%)] bg-[color-mix(in_srgb,var(--app-gold),transparent_86%)] text-[var(--app-gold)]"
                  : "border border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-muted)] hover:text-[var(--app-fg)]",
              )}
            >
              Senaste veckan
            </button>
            <button
              type="button"
              onClick={() => onWindowChange("month")}
              aria-label="Visa senaste månaden"
              className={clsx(
                "inline-flex h-8 w-36 items-center justify-center rounded px-2 py-1 text-xs font-medium transition whitespace-nowrap",
                windowMode === "month"
                  ? "border border-[color-mix(in_srgb,var(--app-gold),transparent_45%)] bg-[color-mix(in_srgb,var(--app-gold),transparent_86%)] text-[var(--app-gold)]"
                  : "border border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-muted)] hover:text-[var(--app-fg)]",
              )}
            >
              Senaste månaden
            </button>
            <button
              type="button"
              onClick={() => onWindowChange("custom")}
              aria-label="Välj egna datum"
              className={clsx(
                "inline-flex h-8 w-36 items-center justify-center rounded px-2 py-1 text-xs font-medium transition whitespace-nowrap",
                windowMode === "custom"
                  ? "border border-[color-mix(in_srgb,var(--app-gold),transparent_45%)] bg-[color-mix(in_srgb,var(--app-gold),transparent_86%)] text-[var(--app-gold)]"
                  : "border border-[var(--app-line)] bg-[var(--app-panel-muted)] text-[var(--app-muted)] hover:text-[var(--app-fg)]",
              )}
            >
              Välj egna datum
            </button>
          </div>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-xs font-medium text-[var(--app-soft)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-fg)]"
          >
            <Printer className="h-3.5 w-3.5" />
            Skriv ut sammanfattning
          </button>
        </div>
      </div>

      {windowMode === "custom" && (
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-3">
          <label className="text-xs text-[var(--app-muted)]">
            Från
            <input
              type="date"
              value={customFrom}
              onChange={(event) => onCustomFromChange(event.target.value)}
              className="mt-1 block rounded border border-[var(--app-line)] bg-[var(--app-panel)] px-2 py-1 text-sm text-[var(--app-fg)]"
            />
          </label>
          <label className="text-xs text-[var(--app-muted)]">
            Till
            <input
              type="date"
              value={customTo}
              onChange={(event) => onCustomToChange(event.target.value)}
              className="mt-1 block rounded border border-[var(--app-line)] bg-[var(--app-panel)] px-2 py-1 text-sm text-[var(--app-fg)]"
            />
          </label>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="mt-5 rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-5">
          <EmptyState title="Inga daterade händelser i valt tidsfönster" />
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {groups.map((group) => {
            const item = group.representative;
            const uniqueSources = [...new Set(group.items.map((entry) => entry.source_url))].slice(0, 3);
            return (
              <article
                key={`${item.id}-${group.latestTs}`}
                className="rounded-lg border border-[var(--app-line)] bg-[var(--app-panel-muted)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
                  <span>{formatDate(item.published_at, true)}</span>
                  <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                  <span>{getCategoryLabel(config, item.category)}</span>
                  <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                  <span>{getGeographyLabel(item, config)}</span>
                  <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                  <span>{group.items.length} relaterade signaler</span>
                </div>
                <h3 className="mt-2 text-base font-semibold leading-6 text-[var(--app-fg)]">
                  {item.title_sv}
                </h3>
                <p className="mt-1 text-sm leading-6 text-[var(--app-soft)]">
                  {asWeeklyRetrospective(item.summary_sv)}
                </p>
                <div className="mt-2 space-y-1">
                  {uniqueSources.map((url) => {
                    const source = group.items.find((entry) => entry.source_url === url);
                    return (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--app-accent)] underline-offset-3 hover:underline"
                      >
                        {source ? xSourceDisplayName(source.source_name, source.source_url) : "Källa"}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    );
                  })}
                </div>
              </article>
            );
          })}
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
          ? "Första insamlingen är klar. Lägesbilden laddas in."
          : "Ingen insamling startas automatiskt. Använd “Uppdatera flöde” när du vill skanna källorna.";

  return (
    <section className="surface-strong rounded-lg p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <SectionKicker icon={Database} label="Första insamling" />
          <h2 className="mt-3 text-xl font-semibold">Ingen briefing finns ännu.</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
            {userMessage}
          </p>
          <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]">
            {status?.estimatedDurationLabel ?? "Första körningen tar oftast 3-10 minuter."} När
            du startar den körs arbetet i bakgrunden; du kan lämna sidan öppen eller komma tillbaka.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={failed ? "danger" : active ? "accent" : "neutral"}>
            {job?.status ?? (requestStatus === "starting" ? "pending" : "väntar")}
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
        Dashboarden visar bara verifierade signaler. Ingen nyhet fabriceras och ingen AI körs i
        sidladdningen.
      </p>
    </section>
  );
}

const BRIEFING_SECTION_PATTERNS = [
  /^att bevaka(?:\/åtgärder)?$/i,
  /^rekommenderade åtgärder$/i,
  /^åtgärder$/i,
  /^att följa$/i,
];

const BRIEFING_HIDDEN_SECTION_PATTERNS = [
  /^att följa i dag\b.*:$/i,
];

function isBriefingSectionLine(line: string) {
  if (BRIEFING_SECTION_PATTERNS.some((pattern) => pattern.test(line))) {
    return true;
  }

  return line.endsWith(":") && line.length <= 96 && !/\bbetydelse:\s*/i.test(line);
}

function parseBriefingBlocks(content?: string) {
  if (!content) return [] as BriefingContentBlock[];

  return normalizeSwedishUserFacingText(content)
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]\s*/, "")
        .replace(/^\d+[.)]\s*/, ""),
    )
    .filter(Boolean)
    .filter((line) => !/^(ambassadörsbrief|briefing|morning brief|morgonbrief)\b/i.test(line))
    .filter((line) => !BRIEFING_HIDDEN_SECTION_PATTERNS.some((pattern) => pattern.test(line)))
    .filter((line) => !isBriefingSynthesisLine(line))
    .map((line) =>
      isBriefingSectionLine(line)
        ? ({ kind: "section", title: line } satisfies BriefingContentBlock)
        : ({ kind: "item", text: line } satisfies BriefingContentBlock),
    )
    .slice(0, 9);
}

function isBriefingSynthesisLine(line: string) {
  return /^(mönster|samlad bild|övergripande bild|sammanfattningsvis)\b/i.test(line.trim());
}

function fallbackBriefingMeta(line: string): {
  label: string;
  Icon: LucideIcon;
  tone: string;
} {
  const prefix = line.split(":")[0]?.trim() || "";
  const normalized = prefix.toLowerCase();

  if (normalized.includes("konsul")) {
    return {
      label: "Konsulärt",
      Icon: Users,
      tone: "text-[var(--app-warning)]",
    };
  }

  if (
    normalized.includes("företag") ||
    normalized.includes("närings") ||
    normalized.includes("upphandling") ||
    normalized.includes("export")
  ) {
    return {
      label: prefix || "Näringsliv",
      Icon: BriefcaseBusiness,
      tone: "text-[var(--app-accent)]",
    };
  }

  if (
    normalized.includes("rätt") ||
    normalized.includes("domstol") ||
    normalized.includes("regel") ||
    normalized.includes("lag")
  ) {
    return {
      label: prefix || "Rättsstat",
      Icon: Landmark,
      tone: "text-[var(--app-positive)]",
    };
  }

  if (normalized.includes("säker")) {
    return {
      label: prefix || "Säkerhet",
      Icon: Shield,
      tone: "text-[var(--app-danger)]",
    };
  }

  return {
    label: prefix || "Åtgärdspunkt",
    Icon: ClipboardList,
    tone: "text-[var(--app-accent)]",
  };
}

function PrimaryBriefingPanel({
  briefing,
  fallbackItems,
  sourceItems,
  cacheTimestamp,
  config,
  onPrint,
}: {
  briefing?: Briefing;
  fallbackItems: IntelligenceItem[];
  sourceItems: IntelligenceItem[];
  cacheTimestamp?: string;
  config: EmbassyConfig;
  onPrint: () => void;
}) {
  const lines = parseBriefingBlocks(briefing?.content_sv);
  const briefingPointCount =
    lines.length > 0
      ? lines.filter((line) => line.kind === "item").length
      : Math.min(fallbackItems.length, 5);

  const sourceCount = briefing
    ? new Set(briefing.source_item_ids).size
    : fallbackItems.length;
  const resolvedSourceItems = briefing ? sourceItems : fallbackItems.slice(0, 5);
  const hasPrintableItems = resolvedSourceItems.length > 0 || fallbackItems.length > 0;

  return (
    <section className="surface-strong rounded-xl p-6">
      <div className="flex flex-col gap-4 border-b border-[var(--app-line)] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <SectionKicker icon={Gauge} label="Briefing" />
          <h2 className="text-2xl font-semibold tracking-normal">
            Daglig överblick med verifierbart underlag
          </h2>
          <p className="max-w-3xl text-sm leading-6 text-[var(--app-soft)]">
            En kort lägesbild av de viktigaste utvecklingarna. Varje punkt kan följas tillbaka
            till verifierade signaler och originalkällor.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill tone={briefing ? "accent" : "neutral"}>
              {briefing
                ? `Genererad ${formatDate(briefing.generated_at, true)}`
                : cacheTimestamp
                  ? `Uppdaterad ${formatDate(cacheTimestamp, true)}`
                  : "Inväntar briefing"}
            </Pill>
            <Pill tone="neutral">Punkter {briefingPointCount}</Pill>
            <Pill tone="neutral">Källposter {sourceCount}</Pill>
            <Pill tone="neutral">Bearbetad från verifierade källor</Pill>
          </div>
        </div>
        <button
          type="button"
          onClick={onPrint}
          disabled={!hasPrintableItems}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-muted)] px-3 py-2 text-xs font-medium text-[var(--app-soft)] transition hover:border-[var(--app-accent)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-45 lg:self-start"
        >
          <Printer className="h-3.5 w-3.5" />
          Öppna i mötesunderlag
        </button>
      </div>

      {lines && lines.length > 0 ? (
        <ol className="mt-5 space-y-3">
          {(() => {
            let sourceItemIndex = 0;
            return lines.map((line, index) =>
              line.kind === "section" ? (
                <li
                  key={`${line.title}-${index}`}
                  className="rounded-lg border border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-3"
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--app-muted)]">
                    {line.title}
                  </span>
                </li>
              ) : (
                <BriefingBullet
                  key={`${line.text}-${index}`}
                  line={line.text}
                  index={index}
                  item={resolvedSourceItems[sourceItemIndex++]}
                  config={config}
                />
              ),
            );
          })()}
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
        <SkeletonStack label="Ingen aktuell morgonbrief" />
      )}

      {resolvedSourceItems.length > 0 && (
        <div className="mt-6 border-t border-[var(--app-line)] pt-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <SectionKicker icon={ExternalLink} label="Underlag och spårbarhet" />
              <p className="mt-2 text-sm leading-6 text-[var(--app-soft)]">
                Källposter som briefingen bygger på.
              </p>
            </div>
            <Pill tone="neutral">{resolvedSourceItems.length} verifierbara källposter</Pill>
          </div>
          <div className="mt-4 grid gap-2">
            {resolvedSourceItems.map((item) => (
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
                      {xSourceDisplayName(item.source_name, item.source_url)} · {formatDate(item.published_at, true)}
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
  const [mainText, implicationText] = line.split(/\bBetydelse:\s*/i);
  const fallbackMeta = item ? null : fallbackBriefingMeta(mainText.trim());
  const Icon = item ? categoryIcon[item.category] : fallbackMeta?.Icon ?? ClipboardList;
  const iconTone = item
    ? categoryIconTone[item.category]
    : fallbackMeta?.tone ?? "text-[var(--app-accent)]";
  const label = item
    ? getCategoryLabel(config, item.category)
    : fallbackMeta?.label ?? "Åtgärdspunkt";

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
              {label}
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
        className="absolute right-3 top-3 z-10 flex h-7 w-7 cursor-pointer items-center justify-center"
        title="Ta bort från prioriterade signaler"
        aria-label="Ta bort från prioriterade signaler"
      >
        <input
          type="checkbox"
          checked
          onChange={onUnprioritize}
          className="peer sr-only"
        />
        <span className="flex h-5 w-5 items-center justify-center rounded border border-[var(--app-line)] bg-[var(--app-panel)] text-[var(--app-muted)] transition hover:border-[var(--app-soft)] hover:text-[var(--app-fg)] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--app-accent)]">
          <X className="h-3 w-3" strokeWidth={1.8} />
        </span>
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
              {isXUrl(item.source_url) && (
                <>
                  <span className="h-1 w-1 rounded-full bg-[var(--app-line)]" />
                  <span className="rounded border border-[var(--app-line)] bg-[var(--app-panel)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--app-soft)]">
                    X-post
                  </span>
                </>
              )}
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
            {xSourceDisplayName(item.source_name, item.source_url)}
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
              Ta med i mötesunderlag
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

type SourceFeedSortKey = "title" | "source" | "published" | "geography" | "relevance" | "priority";
type SourceFeedSortDirection = "asc" | "desc";
type SourceFeedSortState = {
  key: SourceFeedSortKey;
  direction: SourceFeedSortDirection;
};

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
  const [sort, setSort] = useState<SourceFeedSortState | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;

    const direction = sort.direction === "asc" ? 1 : -1;

    return rows
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        let result = 0;

        if (sort.key === "title") {
          result = left.item.title_sv.localeCompare(right.item.title_sv, "sv");
        }

        if (sort.key === "source") {
          result = left.item.source_name.localeCompare(right.item.source_name, "sv");
        }

        if (sort.key === "published") {
          result =
            new Date(left.item.published_at).getTime() -
            new Date(right.item.published_at).getTime();
        }

        if (sort.key === "geography") {
          result = getGeographyLabel(left.item, config).localeCompare(
            getGeographyLabel(right.item, config),
            "sv",
          );
        }

        if (sort.key === "relevance") {
          result =
            getCompositeScore(left.item, config, profile) -
            getCompositeScore(right.item, config, profile);
        }

        if (sort.key === "priority") {
          result =
            Number(prioritizedIds.includes(left.item.id)) -
            Number(prioritizedIds.includes(right.item.id));
        }

        return result === 0 ? left.index - right.index : result * direction;
      })
      .map(({ item }) => item);
  }, [config, prioritizedIds, profile, rows, sort]);

  const toggleSort = (key: SourceFeedSortKey) => {
    setSort((current) => {
      if (current?.key === key) {
        return { key, direction: current.direction === "asc" ? "desc" : "asc" };
      }

      return {
        key,
        direction: key === "title" || key === "source" || key === "geography" ? "asc" : "desc",
      };
    });
  };

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
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--app-line)] text-xs uppercase tracking-[0.12em] text-[var(--app-muted)]">
                <SourceFeedSortHeader
                  label="Original / svensk titel"
                  sortKey="title"
                  activeSort={sort}
                  onSort={toggleSort}
                />
                <SourceFeedSortHeader
                  label="Källa"
                  sortKey="source"
                  activeSort={sort}
                  onSort={toggleSort}
                />
                <SourceFeedSortHeader
                  label="Publicerad"
                  sortKey="published"
                  activeSort={sort}
                  onSort={toggleSort}
                />
                <SourceFeedSortHeader
                  label="Geografi"
                  sortKey="geography"
                  activeSort={sort}
                  onSort={toggleSort}
                />
                <SourceFeedSortHeader
                  label="Relevans"
                  sortKey="relevance"
                  activeSort={sort}
                  onSort={toggleSort}
                />
                <SourceFeedSortHeader
                  label="Prioritera"
                  sortKey="priority"
                  activeSort={sort}
                  onSort={toggleSort}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--app-line)]">
              {sortedRows.map((item) => {
                const isPrioritized = prioritizedIds.includes(item.id);

                return (
                  <tr key={item.id} className="hover:bg-[var(--app-panel-muted)]">
                    <td className="max-w-[420px] px-5 py-4">
                      <p className="font-medium leading-5 text-[var(--app-fg)]">{item.title_sv}</p>
                      <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]">
                        {item.title_original}
                      </p>
                    </td>
                    <td className="group px-5 py-4">
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-sm transition hover:text-[var(--app-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent)]"
                      >
                        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--app-fg)]">
                          <span className="group-hover:underline group-hover:decoration-1 group-hover:decoration-[color-mix(in_srgb,var(--app-fg),transparent_38%)] group-hover:underline-offset-3">
                            {xSourceDisplayName(item.source_name, item.source_url)}
                          </span>
                          <ArrowUpRight className="h-3.5 w-3.5 text-[var(--app-muted)]" />
                        </span>
                        <span className="mt-1 flex items-center gap-2 text-xs text-[var(--app-muted)]">
                          <Languages className="h-3.5 w-3.5" />
                          {countryNameSv(item.source_country) ?? item.source_country} ·{" "}
                          {item.source_language.toUpperCase()}
                        </span>
                      </a>
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

function SourceFeedSortHeader({
  label,
  sortKey,
  activeSort,
  onSort,
}: {
  label: string;
  sortKey: SourceFeedSortKey;
  activeSort: SourceFeedSortState | null;
  onSort: (key: SourceFeedSortKey) => void;
}) {
  const active = activeSort?.key === sortKey;
  const direction = activeSort?.direction ?? "desc";

  return (
    <th
      className="px-5 py-3 font-medium"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={clsx(
          "inline-flex items-center gap-1.5 text-left transition hover:text-[var(--app-fg)]",
          active && "text-[var(--app-fg)]",
        )}
      >
        <span>{label}</span>
        <ChevronDown
          className={clsx(
            "h-3.5 w-3.5 transition",
            active ? "opacity-100" : "opacity-35",
            active && direction === "asc" && "rotate-180",
          )}
        />
      </button>
    </th>
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

function EmptyState({ title }: { title: React.ReactNode }) {
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
