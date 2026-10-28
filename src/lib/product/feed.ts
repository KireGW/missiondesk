import type { Briefing } from "@/lib/intelligence/models";
import type { IntelligenceItem } from "@/lib/types";
import type { DashboardUpdateStatus } from "@/lib/intelligence/dashboard-status";
import type { SignalTrackingSearchResult } from "@/lib/intelligence/signal-tracking";
import { personalHomeConnection, type HomeCountry } from "@/lib/product/profiles";

export interface PersonalFeed {
  workspacePilot?: { connectedSourceIds: string[]; heldCount: number; attentionNeeded: boolean; refreshEnabled?: boolean };
  items: IntelligenceItem[];
  briefings: Briefing[];
  activeSourceCount: number;
  updatedAt?: string;
  updates: DashboardUpdateStatus;
}

export function personalSelectionItems(items: IntelligenceItem[], retained: Record<string, IntelligenceItem>, selectedIds: string[]) {
  const current=new Set(items.map(item=>item.id));
  const selected=new Set(selectedIds);
  return [...items,...Object.values(retained).filter(item=>selected.has(item.id) && !current.has(item.id))];
}

export function normalizePersonalSearchQuery(query: string) {
  return query.normalize("NFKC").replace(/\s+/g," ").trim();
}

export function aggregatePersonalSearchItems(current: IntelligenceItem[], saved: IntelligenceItem[], query: string, homeCountry?: HomeCountry) {
  const normalized=normalizePersonalSearchQuery(query);
  const local=normalized ? searchPersonalFeed({items:current,briefings:[],updates:{},activeSourceCount:0},normalized) : homeCountry ? current : [];
  const seen=new Set<string>();
  return [...local,...saved].filter(item=>{
    if(homeCountry && !personalHomeConnection(item,homeCountry)) return false;
    let key=item.source_url || item.id;
    try {const url=new URL(key);url.hash="";for(const name of [...url.searchParams.keys()])if(name.startsWith("utm_")||["fbclid","gclid"].includes(name))url.searchParams.delete(name);key=url.toString();} catch { /* Retain non-URL fixture identities. */ }
    if(seen.has(key))return false;seen.add(key);return true;
  });
}

export function searchPersonalFeed(feed: PersonalFeed, query: string) {
  const terms = query.toLocaleLowerCase("sv").trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return feed.items.filter((item) => {
    const text = `${item.title_original} ${item.original_excerpt} ${item.title_sv} ${item.summary_sv} ${item.source_name} ${item.region}`.toLocaleLowerCase("sv");
    return terms.every((term) => text.includes(term));
  });
}

export function searchPersonalSignals(items: IntelligenceItem[], query: string): SignalTrackingSearchResult {
  const matches = searchPersonalFeed({ items, briefings: [], updates: {}, activeSourceCount: 0 }, query);
  return {
    query, mode: "local", aiEnabled: false, searchedAt: new Date().toISOString(), queryVariants: [query],
    sourceCount: new Set(items.map((item) => item.source_name)).size,
    scannedSourceCount: 0, fetchedCount: 0, resultCount: matches.length, translatedCount: 0,
    deepSearchUsed: false, notes: [], errors: [],
    report: { sourcesScanned: 0, rssHits: 0, websiteFallbackActivations: 0, xAccountsQueried: 0,
      xPostsFetched: 0, newUrlsDiscovered: 0, duplicatesSkipped: 0, aiCandidatesProcessed: 0,
      estimatedTokenUsage: 0, estimatedApiReads: 0 },
    results: matches.map((item) => ({
      id: item.id, title_original: item.title_original, title_sv: item.title_sv,
      snippet_original: item.original_excerpt, snippet_sv: item.summary_sv, url: item.source_url,
      source_name: item.source_name, source_country: item.source_country, source_language: item.source_language,
      published_at: item.published_at, retrieved_at: "", category: item.category, source_type: "news",
      detected_country: item.country, detected_region: item.region, detected_city: item.city,
      relevance_score: item.diplomatic_relevance_score, discovery: "local_cache", ai_enriched: false,
    })),
  };
}
