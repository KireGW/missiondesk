import type { IntelligenceItem } from "@/lib/types";
import { sourcePlainText } from "@/lib/product/source-text";

export interface WorkspaceArticleRow {
  id: string; title: string; excerpt: string; url: string; name: string; language: string;
  published_at: Date | null; countries: string[]; score: number | null;
  content_kind?: "news" | "reference";
  selection?: "selected" | "held" | "rejected" | "unassessed";
}
export function workspaceArticleToItem(row: WorkspaceArticleRow): IntelligenceItem {
  return {
    id: `workspace:${row.id}`, title_original: sourcePlainText(row.title), original_excerpt: sourcePlainText(row.excerpt), title_sv: "", summary_sv: "",
    source_name: row.name, source_url: row.url, source_country: "", source_language: row.language,
    published_at: row.published_at?.toISOString() ?? "", category: "society", country: row.countries.join(", "), region: "", subregion: "",
    geographic_scope: row.countries.length > 1 ? "cross_border" : "national", geographic_tags: row.countries,
    urgency_score: 0, diplomatic_relevance_score: 0, sweden_relevance_score: 0, economic_impact_score: 0,
    security_impact_score: 0, public_attention_score: 0, profile_tags: [], why_it_matters_sv: "", suggested_talking_points_sv: [],
    workspace_relevance: row.score ?? 0,
    ...(row.content_kind ? { content_kind: row.content_kind } : {}),
    ...(row.selection ? { workspace_selection: row.selection } : {}),
  };
}
