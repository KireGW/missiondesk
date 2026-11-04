import type { IntelligenceItem } from "@/lib/types";
import type { WorkspacePolicy } from "@/lib/product/workspace-candidates";
import { workspaceRank } from "@/lib/product/workspace-assessment";
import { normalizeWorkspaceText } from "@/lib/product/workspace-text";

export function canonicalSignalUrl(item: IntelligenceItem) {
  try {
    const url = new URL(item.source_url);
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) if (name.startsWith("utm_") || ["fbclid", "gclid"].includes(name)) url.searchParams.delete(name);
    return url.href;
  } catch { return item.source_url || item.id; }
}

export function selectBalancedWorkspaceItems(items: readonly IntelligenceItem[], policy: WorkspacePolicy, limit: number, now = Date.now()) {
  const pool = items.map(item => ({ item, rank: workspaceRank(item.workspace_relevance ?? 0, item.published_at, now),
    countries: (item.geographic_tags ?? []).filter(country => policy.countries.includes(country as typeof policy.countries[number])),
    headline: normalizeWorkspaceText(item.title_original).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(),
  })).sort((a, b) => b.rank - a.rank || Date.parse(b.item.published_at) - Date.parse(a.item.published_at) || a.item.id.localeCompare(b.item.id));
  const selected: typeof pool = [];
  const sources = new Map<string, number>(), countries = new Map<string, number>(), topics = new Map<string, number>(), localCrime = new Map<string, number>();
  const urls = new Set<string>();
  while (pool.length && selected.length < limit) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const entry = pool[i], item = entry.item;
      if (urls.has(canonicalSignalUrl(item))) continue;
      // Collapse syndicated copies, not speculative event clusters. Other stories remain searchable.
      if (entry.headline && selected.some(other => other.headline === entry.headline
        && entry.countries.length === other.countries.length && entry.countries.every(country => other.countries.includes(country))
        && Math.abs(Date.parse(other.item.published_at) - Date.parse(item.published_at)) < 3 * 86_400_000)) continue;
      const reasons = item.workspace_relevance_reasons ?? [];
      const important = (item.workspace_relevance ?? 0) >= 75 || reasons.includes("home_connection") || reasons.includes("regional_impact");
      const spread = important ? 0.2 : 1;
      const sourcePenalty = Math.min(18, Math.max(0, (sources.get(item.source_name) ?? 0) - 2) * 4);
      const countryPenalty = Math.max(0, ...entry.countries.map(country => Math.min(14, Math.max(0, (countries.get(country) ?? 0) - 4) * 2)));
      const topicPenalty = Math.max(0, ...entry.countries.map(country => Math.min(10, Math.max(0, (topics.get(`${country}:${item.category}`) ?? 0) - 3) * 2)));
      const crimePenalty = reasons.includes("local_crime") ? Math.max(0, ...entry.countries.map(country => Math.min(36, (localCrime.get(country) ?? 0) * 18))) : 0;
      const score = entry.rank - spread * (sourcePenalty + countryPenalty + topicPenalty) - crimePenalty;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best === -1) break;
    const [entry] = pool.splice(best, 1), item = entry.item;
    selected.push(entry); urls.add(canonicalSignalUrl(item));
    sources.set(item.source_name, (sources.get(item.source_name) ?? 0) + 1);
    for (const country of entry.countries) {
      countries.set(country, (countries.get(country) ?? 0) + 1 / entry.countries.length);
      topics.set(`${country}:${item.category}`, (topics.get(`${country}:${item.category}`) ?? 0) + 1);
      if (item.workspace_relevance_reasons?.includes("local_crime")) localCrime.set(country, (localCrime.get(country) ?? 0) + 1);
    }
  }
  return selected.map(entry => entry.item);
}
