import { createHash } from "node:crypto";
import type { HomeCountry, MonitoredCountry } from "@/lib/product/profiles";
import { sourcePlainText } from "@/lib/product/source-text";
import { assessWorkspaceText, detectWorkspaceCountries, workspaceRulesVersion } from "@/lib/product/workspace-assessment";

export interface WorkspacePolicy { id: string; homeCountry: HomeCountry; countries: readonly MonitoredCountry[] }
export interface PublicCandidate {
  id: string; sourceId: string; url: string; title: string; excerpt: string;
  publishedAt: string | null; contentHash: string; countries: string[];
  contentKind?: "news" | "reference";
}
export type CandidateDecision = { status: "selected" | "held" | "rejected"; score: number; reason: string };
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const detectCandidateCountries = detectWorkspaceCountries;
export function workspacePolicyKey(policy: WorkspacePolicy) {
  return `${workspaceRulesVersion}:${digest(JSON.stringify([policy.homeCountry, [...policy.countries].sort()]))}`;
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
  if (!article.publishedAt || !Number.isFinite(Date.parse(article.publishedAt))) return { status: "held", score: 0, reason: "missing_date" };
  const age = now - Date.parse(article.publishedAt);
  if (age < -300_000) return { status: "held", score: 0, reason: "future_date" };
  if (age > 7 * 86_400_000) return { status: "held", score: 0, reason: "outside_window" };
  // Re-evaluate original text, not potentially older country hints or another profile's decision.
  const assessment=assessWorkspaceText(article.title,article.excerpt,policy);
  if (!assessment.inRegion) {
    return { status: "held", score: 0, reason: "country_uncertain_or_outside" };
  }
  const {score,homeConnection}=assessment;
  return { status: score >= 45 ? "selected" : "held", score, reason: homeConnection ? "home_connection" : score>=45 ? "regional_topic" : "review_needed" };
}
