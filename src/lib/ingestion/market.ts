import type { RawSourceDocument } from "@/lib/ingestion/types";
import type { RawSourceItem } from "@/lib/intelligence/models";
import type { SourceDefinition } from "@/lib/types";

const USER_AGENT = "MissionDesk/0.1 diplomatic briefing ingestion";
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const BLOOMBERG_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Upgrade-Insecure-Requests": "1",
};

const DAILY_PERCENT_THRESHOLD = 0.5;
const SNAPSHOT_PERCENT_THRESHOLD = 0.35;
const SNAPSHOT_ABSOLUTE_THRESHOLD = 0.06;
const MIN_SIGNAL_INTERVAL_HOURS = 6;

export interface MarketFetchResult {
  documents: RawSourceDocument[];
  errors: Array<{ message: string; url?: string }>;
}

interface MarketSnapshot {
  instrument: string;
  ticker: string;
  price: number;
  netChange: number;
  percentChange: number;
  observedAt: string;
  observedLabel: string;
  marketType: "currency";
  quoteCurrency?: string;
}

interface MarketTriggerDecision {
  shouldEmit: boolean;
  reason: string;
  previous?: MarketSnapshot;
  previousDeltaAbs?: number;
  previousDeltaPct?: number;
}

const decodeEntities = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

function stripHtml(value: string) {
  return decodeEntities(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " "),
  );
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

function sourcePageUrl(source: SourceDefinition) {
  return source.websiteUrl ?? source.url;
}

function signalWithTimeout(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (parentSignal) {
    if (parentSignal.aborted) {
      controller.abort();
    } else {
      parentSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

async function fetchHtml(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
) {
  const timeout = signalWithTimeout(options.signal, options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        ...BLOOMBERG_HEADERS,
      },
      signal: timeout.signal,
    });

    if (!response.ok) {
      throw new Error(`Market fetch failed with ${response.status}`);
    }

    return response.text();
  } finally {
    timeout.clear();
  }
}

function parseNumber(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSignedPercent(value: string | undefined) {
  if (!value) return null;
  const normalized = value.replace(/<!-- -->/g, "").replace(/%/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBloombergMarketSource(source: SourceDefinition) {
  try {
    const url = new URL(sourcePageUrl(source));
    return (
      url.hostname.toLowerCase().replace(/^www\./, "") === "bloomberg.com" &&
      /^\/quote\/[^/]+$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function extractBetween(html: string, startNeedle: string, endNeedle: string) {
  const startIndex = html.indexOf(startNeedle);
  if (startIndex < 0) return "";
  const sliced = html.slice(startIndex + startNeedle.length);
  const endIndex = sliced.indexOf(endNeedle);
  return endIndex >= 0 ? sliced.slice(0, endIndex) : sliced;
}

function extractBloombergSnapshot(html: string, source: SourceDefinition): MarketSnapshot | null {
  const instrument =
    decodeEntities(
      html.match(
        /<script type="application\/ld\+json">[\s\S]*?"name":"([^"]+X-RATE)"[\s\S]*?<\/script>/i,
      )?.[1] ?? "",
    ) ||
    decodeEntities(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "");
  const ticker =
    decodeEntities(
      html.match(/"tickerSymbol":"\s*([^"]+)"/i)?.[1] ??
        html.match(/"tickerId":"([^"]+)"/i)?.[1] ??
        "",
    ) ||
    "";
  const quoteCurrency =
    decodeEntities(html.match(/quotePageHeader_securityDetails__[^>]*>\(([^)]+)\)</i)?.[1] ?? "") ||
    undefined;

  const container = extractBetween(
    html,
    '<div class="currentPrice_currentPriceContainer__',
    '<div class="flex"><div class="quotePageLayout_shareSmallDesktopContainer__',
  );
  if (!container) return null;

  const price = parseNumber(
    container.match(/<div data-component="sized-price"[^>]*>([^<]+)<\/div>/i)?.[1],
  );
  const netChange = parseNumber(
    container.match(/<span class="media-ui-Change_priceChange-[^"]+">([^<]+)<\/span>/i)?.[1],
  );
  const percentChange = parseSignedPercent(
    container.match(
      /<span class="media-ui-Change_(?:positive|negative)[^"]+">\s*([+-]?[0-9.]+(?:<!-- -->)?%)\s*<\/span>/i,
    )?.[1],
  );
  const observedAt =
    decodeEntities(container.match(/<time dateTime="([^"]+)"/i)?.[1] ?? "") || "";
  const observedLabel =
    stripHtml(
      container.match(/<time dateTime="[^"]+"[^>]*>([\s\S]*?)<\/time>/i)?.[1] ?? "",
    ) || observedAt;

  if (!instrument || !ticker || price === null || netChange === null || percentChange === null || !observedAt) {
    return null;
  }

  return {
    instrument,
    ticker,
    price,
    netChange,
    percentChange,
    observedAt: new Date(observedAt).toISOString(),
    observedLabel,
    marketType: "currency",
    quoteCurrency,
  };
}

function parseStoredMarketSnapshot(item: RawSourceItem): MarketSnapshot | null {
  const text = item.raw_content ?? item.snippet ?? "";
  if (!text) return null;

  const instrument = text.match(/Instrument:\s*(.+)/i)?.[1]?.trim() ?? "";
  const ticker = text.match(/Ticker:\s*(.+)/i)?.[1]?.trim() ?? "";
  const price = parseNumber(text.match(/Price:\s*([0-9.,+-]+)/i)?.[1]);
  const netChange = parseNumber(text.match(/Net change:\s*([0-9.,+-]+)/i)?.[1]);
  const percentChange = parseNumber(text.match(/Percent change:\s*([0-9.,+-]+)/i)?.[1]);
  const observedAt = text.match(/Observed at:\s*(.+)/i)?.[1]?.trim() ?? "";
  const observedLabel = text.match(/Observed label:\s*(.+)/i)?.[1]?.trim() ?? observedAt;
  const quoteCurrency = text.match(/Quote currency:\s*(.+)/i)?.[1]?.trim();

  if (!instrument || !ticker || price === null || netChange === null || percentChange === null || !observedAt) {
    return null;
  }

  return {
    instrument,
    ticker,
    price,
    netChange,
    percentChange,
    observedAt,
    observedLabel,
    marketType: "currency",
    quoteCurrency,
  };
}

function hoursBetween(leftIso: string, rightIso: string) {
  return Math.abs(new Date(leftIso).getTime() - new Date(rightIso).getTime()) / (1000 * 60 * 60);
}

function decideMarketTrigger(
  snapshot: MarketSnapshot,
  previousItems: RawSourceItem[],
): MarketTriggerDecision {
  const previous = previousItems
    .map(parseStoredMarketSnapshot)
    .find((item) => item?.ticker === snapshot.ticker);

  if (Math.abs(snapshot.percentChange) >= DAILY_PERCENT_THRESHOLD) {
    return { shouldEmit: true, reason: "daily_percent_threshold", previous: previous ?? undefined };
  }

  if (!previous) {
    return { shouldEmit: false, reason: "below_initial_threshold" };
  }

  const previousDeltaAbs = Number((snapshot.price - previous.price).toFixed(4));
  const previousDeltaPct = Number((((snapshot.price - previous.price) / previous.price) * 100).toFixed(4));
  const elapsedHours = hoursBetween(snapshot.observedAt, previous.observedAt);

  if (elapsedHours < MIN_SIGNAL_INTERVAL_HOURS) {
    return {
      shouldEmit: false,
      reason: "cooldown_window",
      previous,
      previousDeltaAbs,
      previousDeltaPct,
    };
  }

  if (
    Math.abs(previousDeltaPct) >= SNAPSHOT_PERCENT_THRESHOLD ||
    Math.abs(previousDeltaAbs) >= SNAPSHOT_ABSOLUTE_THRESHOLD
  ) {
    return {
      shouldEmit: true,
      reason: "movement_vs_previous_signal",
      previous,
      previousDeltaAbs,
      previousDeltaPct,
    };
  }

  return {
    shouldEmit: false,
    reason: "below_movement_threshold",
    previous,
    previousDeltaAbs,
    previousDeltaPct,
  };
}

function signedNumber(value: number, decimals: number) {
  const absolute = Math.abs(value).toFixed(decimals);
  return `${value >= 0 ? "+" : "-"}${absolute}`;
}

function buildMarketTitle(snapshot: MarketSnapshot, trigger: MarketTriggerDecision) {
  const instrumentLabel = snapshot.instrument.includes("X-RATE")
    ? snapshot.instrument.replace(/\s+X-RATE/i, "")
    : snapshot.instrument;
  const direction = snapshot.netChange >= 0 ? "moves higher" : "moves lower";

  if (trigger.reason === "movement_vs_previous_signal" && trigger.previousDeltaPct !== undefined) {
    return `${instrumentLabel} ${direction} to ${snapshot.price.toFixed(4)} after ${signedNumber(
      trigger.previousDeltaPct,
      2,
    )}% move since last signal`;
  }

  return `${instrumentLabel} ${direction} to ${snapshot.price.toFixed(4)} (${signedNumber(
    snapshot.percentChange,
    2,
  )}%)`;
}

function buildMarketText(snapshot: MarketSnapshot, trigger: MarketTriggerDecision) {
  const lines = [
    `Instrument: ${snapshot.instrument}`,
    `Ticker: ${snapshot.ticker}`,
    `Price: ${snapshot.price.toFixed(4)}`,
    `Net change: ${signedNumber(snapshot.netChange, 2)}`,
    `Percent change: ${signedNumber(snapshot.percentChange, 2)}`,
    `Observed at: ${snapshot.observedAt}`,
    `Observed label: ${snapshot.observedLabel}`,
  ];

  if (snapshot.quoteCurrency) {
    lines.push(`Quote currency: ${snapshot.quoteCurrency}`);
  }

  if (trigger.previous) {
    lines.push(`Previous signal observed at: ${trigger.previous.observedAt}`);
    lines.push(`Previous signal price: ${trigger.previous.price.toFixed(4)}`);
  }

  if (trigger.previousDeltaAbs !== undefined) {
    lines.push(`Move since previous signal: ${signedNumber(trigger.previousDeltaAbs, 4)}`);
  }

  if (trigger.previousDeltaPct !== undefined) {
    lines.push(`Percent move since previous signal: ${signedNumber(trigger.previousDeltaPct, 2)}`);
  }

  lines.push(`Trigger reason: ${trigger.reason}`);

  return lines.join("\n");
}

function buildMarketExcerpt(snapshot: MarketSnapshot, trigger: MarketTriggerDecision) {
  const pieces = [
    `${snapshot.instrument} at ${snapshot.price.toFixed(4)}`,
    `daily move ${signedNumber(snapshot.percentChange, 2)}% (${signedNumber(snapshot.netChange, 2)})`,
  ];

  if (trigger.previous && trigger.previousDeltaPct !== undefined) {
    pieces.push(`since last signal ${signedNumber(trigger.previousDeltaPct, 2)}%`);
  }

  pieces.push(`as of ${snapshot.observedLabel}`);
  return `${pieces.join(" · ")}.`;
}

export async function fetchMarketSource(
  source: SourceDefinition,
  options: {
    signal?: AbortSignal;
    preserveRawContent?: boolean;
    recentItems?: RawSourceItem[];
  } = {},
): Promise<MarketFetchResult> {
  const documents: RawSourceDocument[] = [];
  const errors: MarketFetchResult["errors"] = [];
  const rootUrl = canonicalUrl(sourcePageUrl(source));
  const retrievedAt = new Date().toISOString();

  if (!isBloombergMarketSource(source)) {
    return {
      documents,
      errors: [{ message: "No market adapter available for this source", url: rootUrl }],
    };
  }

  try {
    const html = await fetchHtml(rootUrl, {
      signal: options.signal,
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    });
    const snapshot = extractBloombergSnapshot(html, source);

    if (!snapshot) {
      return {
        documents,
        errors: [{ message: "Could not extract Bloomberg market snapshot", url: rootUrl }],
      };
    }

    const trigger = decideMarketTrigger(snapshot, options.recentItems ?? []);
    if (!trigger.shouldEmit) {
      return { documents, errors };
    }

    const title = buildMarketTitle(snapshot, trigger);
    const text = buildMarketText(snapshot, trigger);

    documents.push({
      id: `${source.id}:${snapshot.ticker}:${snapshot.observedAt}`,
      sourceId: source.id,
      title,
      url: rootUrl,
      language: source.language,
      country: source.country,
      publishedAt: snapshot.observedAt,
      retrievedAt,
      excerpt: buildMarketExcerpt(snapshot, trigger),
      html: options.preserveRawContent ? html.slice(0, 50000) : undefined,
      text,
      metadata: {
        sourceType: source.type,
        retrievalMethod: "website",
        extractionMode: "bloomberg_market_quote",
        marketSource: "bloomberg_quote",
        marketType: snapshot.marketType,
        ticker: snapshot.ticker,
        instrument: snapshot.instrument,
        quoteCurrency: snapshot.quoteCurrency ?? null,
        price: snapshot.price,
        netChange: snapshot.netChange,
        percentChange: snapshot.percentChange,
        observedAt: snapshot.observedAt,
        observedLabel: snapshot.observedLabel,
        triggerReason: trigger.reason,
        previousDeltaAbs: trigger.previousDeltaAbs ?? null,
        previousDeltaPct: trigger.previousDeltaPct ?? null,
      },
    });

    return { documents, errors };
  } catch (error) {
    return {
      documents,
      errors: [
        {
          message: error instanceof Error ? error.message : "Market source fetch failed",
          url: rootUrl,
        },
      ],
    };
  }
}
