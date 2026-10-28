import { getProfileSourceCatalog } from "@/lib/product/source-catalog";

export type WorkspaceSourceMode = "rss" | "page" | "paused";
export interface WorkspaceSource {
  id: string; name: string; feedUrl: string; host: string; language: string; mode: WorkspaceSourceMode;
  articleHosts?: readonly string[]; newsPathPrefix?: string;
}
const feeds: Record<string, string> = {
  "el-universal-national": "https://www.eluniversal.com.mx/arc/outboundfeeds/rss/?outputType=xml",
  "el-financiero": "https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/?outputType=xml",
  "la-jornada-politica": "https://www.jornada.com.mx/rss/politica.xml",
  "expansion-mexico": "https://expansion.mx/rss",
  "bbc-latin-america": "https://feeds.bbci.co.uk/news/world/latin_america/rss.xml",
  "no-mx-ud-news": "https://www.regjeringen.no/no/rss/Rss/2581966/",
  "no-ni-confidencial": "https://confidencial.digital/feed/",
  "no-cr-tico-times": "https://ticotimes.net/feed",
  "no-gt-plaza-publica": "https://plazapublica.com.gt/feed/",
  "no-hn-criterio": "https://criterio.hn/feed/",
  "no-sv-gato-encerrado": "https://gatoencerrado.news/feed/",
  "no-bz-love-fm": "https://lovefm.com/feed/",
  "no-bz-press-office": "https://www.pressoffice.gov.bz/feed/",
};
// Reviewed access blocks, JS challenges or unavailable origin. Never bypass them.
const paused = new Set(["no-mx-embassy-news", "no-mx-innovation", "no-mx-sre", "no-mx-economy",
  "no-cr-mfa", "no-gt-minex", "no-hn-mfa", "no-sv-mfa"]);
export const workspaceSources: readonly WorkspaceSource[] = getProfileSourceCatalog("NO").sources
  .filter(source => source.publication !== "premium_locked" && source.kind !== "social")
  .map(source => ({ id: source.id, name: source.name, feedUrl: feeds[source.id] ?? source.url,
    host: source.id === "bbc-latin-america" ? "www.bbc.com" : new URL(feeds[source.id] ?? source.url).hostname,
    language: source.language, mode: paused.has(source.id) ? "paused" : feeds[source.id] ? "rss" : "page",
    ...(source.id === "bbc-latin-america" ? { articleHosts: ["www.bbc.com", "www.bbc.co.uk"] } : {}),
    ...(source.id === "no-mx-ud-news" ? { newsPathPrefix: "/no/aktuelt/" } : {}),
  }));
export const workspacePilotSources = workspaceSources.filter(source => source.mode === "rss");
