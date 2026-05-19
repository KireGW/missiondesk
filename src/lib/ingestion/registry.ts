import type {
  IngestionAdapter,
  IngestionContext,
  IngestionRunResult,
} from "@/lib/ingestion/types";
import { fetchRssSource } from "@/lib/ingestion/rss";
import { fetchSocialSource } from "@/lib/ingestion/social";
import { fetchWebsiteMetadataSource } from "@/lib/ingestion/website";
import type { SourceDefinition } from "@/lib/types";

export const ingestionAdapters: IngestionAdapter[] = [
  {
    type: "rss",
    canHandle: (source) => source.type === "rss",
    fetch: (source, context) =>
      fetchRssSource(source, {
        limit: context.limit,
        preserveRawContent: context.preserveRawContent,
      }),
  },
  {
    type: "website",
    canHandle: (source) => source.type === "website",
    fetch: (source, context) =>
      fetchWebsiteMetadataSource(source, {
        limit: context.limit,
        preserveRawContent: context.preserveRawContent,
      }),
  },
  {
    type: "social",
    canHandle: (source) =>
      source.sourceType === "social" ||
      (source.type === "website" &&
        (() => {
          try {
            const host = new URL(source.url).hostname.toLowerCase();
            return [
              "x.com",
              "twitter.com",
              "www.x.com",
              "www.twitter.com",
              "linkedin.com",
              "www.linkedin.com",
              "facebook.com",
              "www.facebook.com",
              "instagram.com",
              "www.instagram.com",
              "youtube.com",
              "www.youtube.com",
            ].includes(host);
          } catch {
            return false;
          }
        })()),
    fetch: (source, context) =>
      fetchSocialSource(source, {
        limit: context.limit,
        preserveRawContent: context.preserveRawContent,
      }),
  },
  {
    type: "structured_scrape",
    canHandle: (source) => source.type === "structured_scrape",
    fetch: (source, context) =>
      fetchWebsiteMetadataSource(source, {
        limit: context.limit,
        preserveRawContent: context.preserveRawContent,
      }),
  },
  {
    type: "api",
    canHandle: (source) => source.type === "api",
    fetch: (source, context) =>
      fetchWebsiteMetadataSource(source, {
        limit: context.limit,
        preserveRawContent: context.preserveRawContent,
      }),
  },
  {
    type: "calendar",
    canHandle: (source) => source.type === "calendar",
    fetch: (source, context) =>
      fetchWebsiteMetadataSource(source, {
        limit: context.limit,
        preserveRawContent: context.preserveRawContent,
      }),
  },
];

export async function runIngestion(
  sources: SourceDefinition[],
  context: IngestionContext,
): Promise<IngestionRunResult[]> {
  const enabledSources = sources.filter((source) => source.enabled);

  return Promise.all(
    enabledSources.map(async (source) => {
      const adapter = ingestionAdapters.find((candidate) => candidate.canHandle(source));

      if (!adapter) {
        return {
          source,
          documents: [],
          errors: [{ message: `No ingestion adapter registered for ${source.type}` }],
        };
      }

      try {
        const documents = await adapter.fetch(source, context);
        return { source, documents, errors: [] };
      } catch (error) {
        return {
          source,
          documents: [],
          errors: [
            {
              message: error instanceof Error ? error.message : "Unknown ingestion error",
              url: source.url,
            },
          ],
        };
      }
    }),
  );
}
