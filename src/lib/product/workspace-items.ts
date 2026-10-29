import type { IntelligenceItem } from "@/lib/types";
import { sourcePlainText } from "@/lib/product/source-text";
import { assessWorkspaceText, classifyWorkspaceText, detectWorkspaceCountries } from "@/lib/product/workspace-assessment";
import type { WorkspacePolicy } from "@/lib/product/workspace-candidates";

export interface WorkspaceArticleRow {
  id: string; title: string; excerpt: string; url: string; name: string; language: string;
  published_at: Date | null; countries: string[]; score: number | null;
  content_kind?: "news" | "reference";
  selection?: "selected" | "held" | "rejected" | "unassessed";
}
export function workspaceArticleToItem(row: WorkspaceArticleRow, policy?: WorkspacePolicy): IntelligenceItem {
  const assessment=policy?assessWorkspaceText(row.title,row.excerpt,policy):null;
  const topic=assessment??classifyWorkspaceText(row.title,row.excerpt);
  const countries=assessment?.countries??detectWorkspaceCountries(row.title,row.excerpt);
  return {
    id: `workspace:${row.id}`, title_original: sourcePlainText(row.title), original_excerpt: sourcePlainText(row.excerpt), title_sv: "", summary_sv: "",
    source_name: row.name, source_url: row.url, source_country: "", source_language: row.language,
    published_at: row.published_at?.toISOString() ?? "", category: topic.category, country: countries.join(", "), region: "", subregion: "",
    geographic_scope: countries.length > 1 ? "cross_border" : "national", geographic_tags: countries,
    urgency_score: 0, diplomatic_relevance_score: 0, sweden_relevance_score: 0, economic_impact_score: 0,
    security_impact_score: 0, public_attention_score: 0, profile_tags: [], why_it_matters_sv: "", suggested_talking_points_sv: [],
    workspace_relevance: row.score ?? 0,
    workspace_topic_unclassified: !topic.classified,
    ...(assessment?{workspace_relevance_reasons:assessment.evidence}:{}),
    ...(row.content_kind ? { content_kind: row.content_kind } : {}),
    ...(row.selection ? { workspace_selection: row.selection } : {}),
  };
}
