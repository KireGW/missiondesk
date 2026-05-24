import type { RawSourceDocument } from "@/lib/ingestion/types";
import type { SourceDefinition } from "@/lib/types";

interface SocialFetchOptions {
  limit?: number;
  signal?: AbortSignal;
  preserveRawContent?: boolean;
  since?: string;
}

interface XUserLookupResponse {
  data?: {
    id: string;
    name: string;
    username: string;
  };
  errors?: Array<{ detail?: string; title?: string }>;
}

interface XTimelineResponse {
  data?: Array<{
    id: string;
    text: string;
    created_at?: string;
    lang?: string;
    public_metrics?: {
      retweet_count?: number;
      reply_count?: number;
      like_count?: number;
      quote_count?: number;
      bookmark_count?: number;
      impression_count?: number;
    };
    entities?: {
      urls?: Array<{
        url?: string;
        expanded_url?: string;
        display_url?: string;
      }>;
      hashtags?: Array<{ tag?: string }>;
    };
  }>;
  meta?: {
    result_count?: number;
  };
  errors?: Array<{ detail?: string; title?: string }>;
}

const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);

const stripHtml = (value: string) =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const firstMatch = (value: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = value.match(pattern)?.[1];
    if (match) return stripHtml(match);
  }
  return "";
};

const canonicalUrl = (value: string) => {
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
};

function extractProfileTitle(html: string, source: SourceDefinition) {
  return (
    firstMatch(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]) || source.name
  );
}

function extractProfileDescription(html: string) {
  return firstMatch(html, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ]);
}

function isXSource(source: SourceDefinition) {
  if (source.platform === "x") return true;

  try {
    const host = new URL(source.url).hostname.toLowerCase();
    return X_HOSTS.has(host);
  } catch {
    return false;
  }
}

function extractXUsername(source: SourceDefinition) {
  if (!isXSource(source)) return null;

  try {
    const url = new URL(source.url);
    const firstSegment = url.pathname.split("/").filter(Boolean)[0];
    if (!firstSegment) return null;
    return firstSegment.replace(/^@/, "");
  } catch {
    return null;
  }
}

function xBearerToken() {
  return (
    process.env.X_API_BEARER_TOKEN ||
    process.env.X_BEARER_TOKEN ||
    process.env.TWITTER_BEARER_TOKEN ||
    null
  );
}

async function fetchXJson<T>(url: URL, signal?: AbortSignal): Promise<T> {
  const bearerToken = xBearerToken();
  if (!bearerToken) {
    throw new Error(
      "X API-bärare saknas. Lägg till X_API_BEARER_TOKEN, X_BEARER_TOKEN eller TWITTER_BEARER_TOKEN.",
    );
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${bearerToken}`,
      "User-Agent": "MissionDesk/0.1 diplomatic briefing ingestion",
    },
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`X API request failed with ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  return (await response.json()) as T;
}

function toIsoOrUndefined(value: string | undefined) {
  if (!value) return undefined;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
}

function cleanPostText(value: string) {
  return value
    .replace(/https:\/\/t\.co\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tweetUrl(username: string, tweetId: string) {
  return `https://x.com/${username}/status/${tweetId}`;
}

async function fetchXSource(
  source: SourceDefinition,
  options: SocialFetchOptions,
): Promise<RawSourceDocument[]> {
  const username = extractXUsername(source);
  if (!username) {
    throw new Error("Kunde inte läsa X-användarnamn från källans URL.");
  }

  const requestedLimit = Math.max(1, Math.min(5, options.limit ?? 5));

  const userUrl = new URL(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`);
  userUrl.searchParams.set("user.fields", "name,username");
  const userResponse = await fetchXJson<XUserLookupResponse>(userUrl, options.signal);
  const user = userResponse.data;
  if (!user?.id) {
    const detail =
      userResponse.errors?.map((error) => error.detail || error.title).filter(Boolean).join("; ") ||
      "okänt fel";
    throw new Error(`X user lookup misslyckades för @${username}: ${detail}`);
  }

  const timelineUrl = new URL(`https://api.x.com/2/users/${user.id}/tweets`);
  timelineUrl.searchParams.set("max_results", String(Math.max(5, requestedLimit)));
  timelineUrl.searchParams.set(
    "tweet.fields",
    ["created_at", "lang", "public_metrics", "entities"].join(","),
  );
  timelineUrl.searchParams.set("exclude", "replies,retweets");
  if (options.since) {
    const since = toIsoOrUndefined(options.since);
    if (since) timelineUrl.searchParams.set("start_time", since);
  }

  const timeline = await fetchXJson<XTimelineResponse>(timelineUrl, options.signal);
  const posts = timeline.data ?? [];
  const now = new Date().toISOString();

  const documents: RawSourceDocument[] = [];

  for (const post of posts) {
    const cleanedText = cleanPostText(post.text);
    if (!cleanedText) continue;

    const hashtags =
      post.entities?.hashtags
        ?.map((item) => item.tag?.trim())
        .filter((value): value is string => Boolean(value)) ?? [];
    const expandedUrls =
      post.entities?.urls
        ?.map((item) => item.expanded_url || item.display_url || item.url)
        .filter((value): value is string => Boolean(value)) ?? [];
    const publishedAt = toIsoOrUndefined(post.created_at) ?? now;

    documents.push({
      id: `${source.id}:${post.id}`,
      sourceId: source.id,
      title: cleanedText.slice(0, 220),
      url: tweetUrl(user.username, post.id),
      language: source.language,
      country: source.country,
      publishedAt,
      retrievedAt: now,
      excerpt: cleanedText.slice(0, 600),
      text: cleanedText,
      metadata: {
        sourceType: source.sourceType ?? "social",
        username: user.username,
        displayName: user.name,
        postId: post.id,
        hashtags: hashtags.join(", "),
        linkedUrls: expandedUrls.join(", "),
        likeCount: post.public_metrics?.like_count ?? 0,
        retweetCount: post.public_metrics?.retweet_count ?? 0,
        replyCount: post.public_metrics?.reply_count ?? 0,
        quoteCount: post.public_metrics?.quote_count ?? 0,
      },
    });
  }

  return documents.slice(0, requestedLimit);
}

function extractSocialPosts(html: string, source: SourceDefinition, limit: number) {
  const articles = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)];
  const now = new Date().toISOString();
  const items = articles
    .map((match, index) => {
      const block = match[1] ?? "";
      const text = firstMatch(block, [
        /data-testid=["']tweetText["'][^>]*>([\s\S]*?)<\/div>/i,
        /data-testid=["']tweetText["'][^>]*>([\s\S]*?)<\/span>/i,
        /lang=["'][^"']+["'][^>]*>([\s\S]*?)<\/span>/i,
      ]);
      const link = firstMatch(block, [/href=["']([^"']*\/status\/[^"']+)["']/i]);
      const publishedAt = firstMatch(block, [/time[^>]+datetime=["']([^"']+)["']/i]);
      const cleanedText = stripHtml(text);

      if (!cleanedText) return null;

      return {
        id: `${source.id}:${canonicalUrl(link || source.url)}:${index}`,
        sourceId: source.id,
        title: cleanedText.slice(0, 220),
        url: canonicalUrl(link || source.url),
        language: source.language,
        country: source.country,
        publishedAt: publishedAt || now,
        retrievedAt: now,
        excerpt: cleanedText.slice(0, 600),
        html: html.slice(0, 50000),
        text: cleanedText,
        metadata: {
          sourceType: source.sourceType ?? "social",
          profileTitle: extractProfileTitle(html, source),
        },
      } satisfies RawSourceDocument;
    })
    .filter(Boolean) as RawSourceDocument[];

  const limitedItems = items.slice(0, limit);

  if (limitedItems.length > 0) return limitedItems;

  const profileTitle = extractProfileTitle(html, source);
  const description = extractProfileDescription(html);

  return [
    {
      id: `${source.id}:${canonicalUrl(source.url)}`,
      sourceId: source.id,
      title: profileTitle,
      url: canonicalUrl(source.url),
      language: source.language,
      country: source.country,
      publishedAt: undefined,
      retrievedAt: now,
      excerpt: description || profileTitle,
      html: html.slice(0, 50000),
      text: description || stripHtml(html).slice(0, 5000),
      metadata: {
        sourceType: source.sourceType ?? "social",
        profileTitle,
      },
    },
  ];
}

async function fetchSocialHtmlSource(
  source: SourceDefinition,
  options: SocialFetchOptions = {},
): Promise<RawSourceDocument[]> {
  const response = await fetch(source.url, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.7",
      "User-Agent": "MissionDesk/0.1 diplomatic briefing ingestion",
    },
    next: { revalidate: 600 },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Social fetch failed with ${response.status}`);
  }

  const html = await response.text();
  const limit = Math.max(1, Math.min(10, options.limit ?? 6));
  const items = extractSocialPosts(html, source, limit);

  return items.map((item) => ({
    ...item,
    html: options.preserveRawContent ? item.html : undefined,
    text: options.preserveRawContent ? item.text : item.excerpt,
  }));
}

export async function fetchSocialSource(
  source: SourceDefinition,
  options: SocialFetchOptions = {},
): Promise<RawSourceDocument[]> {
  if (isXSource(source)) {
    return fetchXSource(source, options);
  }

  return fetchSocialHtmlSource(source, options);
}
