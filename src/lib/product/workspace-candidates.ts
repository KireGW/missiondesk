import { createHash } from "node:crypto";
import type { HomeCountry, MonitoredCountry } from "@/lib/product/profiles";
import { sourcePlainText } from "@/lib/product/source-text";

export interface WorkspacePolicy { id: string; homeCountry: HomeCountry; countries: readonly MonitoredCountry[] }
export interface PublicCandidate {
  id: string; sourceId: string; url: string; title: string; excerpt: string;
  publishedAt: string | null; contentHash: string; countries: string[];
  contentKind?: "news" | "reference";
}
export type CandidateDecision = { status: "selected" | "held" | "rejected"; score: number; reason: string };
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
const countryTerms: Record<string, readonly string[]> = {
  MX: ["mexico", "mexiko", "mexican", "mexicano", "mexicana"], NI: ["nicaragua", "nicaraguan", "nicaraguense"],
  CR: ["costa rica", "costarricense", "costa rican"], GT: ["guatemala", "guatemalan", "guatemalteco", "guatemalteca"],
  HN: ["honduras", "honduran", "hondureno", "hondurena"], SV: ["el salvador", "salvadoran", "salvadoreno", "salvadorena"],
  BZ: ["belize", "belice", "belizean", "beliceno"], NO: ["norway", "norge", "noruega", "norwegian", "norsk"],
  SE: ["sweden", "sverige", "suecia", "swedish", "svensk"], US: ["united states", "estados unidos"],
};
function contains(text: string, term: string) {
  return new RegExp(`(^|[^a-z])${term.replace(/ /g, "\\s+")}([^a-z]|$)`).test(text);
}
export function detectCandidateCountries(title: string, excerpt: string) {
  const text = normalize(`${title} ${excerpt}`);
  return Object.entries(countryTerms).filter(([, terms]) => terms.some((term) => contains(text, term))).map(([country]) => country);
}
export function workspacePolicyKey(policy: WorkspacePolicy) {
  return `public-rules-v2:${digest(JSON.stringify([policy.homeCountry, [...policy.countries].sort()]))}`;
}
export function publicCandidate(input: Omit<PublicCandidate, "id" | "contentHash" | "countries">, allowedHost: string | readonly string[]): PublicCandidate {
  const url = new URL(input.url);
  const hosts = typeof allowedHost === "string" ? [allowedHost] : allowedHost;
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password || url.port) throw new Error("Article host is not approved");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (key.startsWith("utm_") || ["fbclid", "gclid"].includes(key)) url.searchParams.delete(key);
  const title = sourcePlainText(input.title).slice(0, 500);
  if (!title) throw new Error("Missing article title");
  const excerpt = sourcePlainText(input.excerpt).slice(0, 600);
  const publishedAt = input.publishedAt && Number.isFinite(Date.parse(input.publishedAt)) ? new Date(input.publishedAt).toISOString() : null;
  const contentKind = input.contentKind ?? "news";
  return { sourceId: input.sourceId, url: url.toString(), title, excerpt, publishedAt, contentKind,
    id: digest(`${input.sourceId}\n${url}`), contentHash: digest(JSON.stringify([title, excerpt, publishedAt, contentKind])),
    countries: detectCandidateCountries(title, excerpt) };
}
export function evaluateCandidate(article: PublicCandidate, policy: WorkspacePolicy, now = Date.now()): CandidateDecision {
  if (article.contentKind === "reference") return { status: "held", score: 0, reason: "not_a_news_article" };
  if (!article.publishedAt) return { status: "held", score: 0, reason: "missing_date" };
  const age = now - Date.parse(article.publishedAt);
  if (age < -300_000) return { status: "held", score: 0, reason: "future_date" };
  if (age > 7 * 86_400_000) return { status: "held", score: 0, reason: "outside_window" };
  // Country labels are evidence hints, not proof of absence; retain all non-matches for review.
  if (!article.countries.some((country) => policy.countries.includes(country as MonitoredCountry))) {
    return { status: "held", score: 0, reason: "country_uncertain_or_outside" };
  }
  const text = normalize(`${article.title} ${article.excerpt}`);
  const homeConnection = article.countries.includes(policy.homeCountry);
  const topic = /\b(trade|comercio|econom|security|seguridad|energy|energia|investment|inversion|derechos|rights|migration|migracion|corrupcion|corruption|diploma|minister|gobierno|government)\w*/.test(text);
  const score = Math.min(100, 45 + (homeConnection ? 35 : 0) + (topic ? 20 : 0));
  return { status: score >= 60 ? "selected" : "held", score, reason: homeConnection ? "home_connection" : topic ? "regional_topic" : "review_needed" };
}
