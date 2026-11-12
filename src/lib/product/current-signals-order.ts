import type { IntelligenceItem } from "@/lib/types";
import type { WorkspacePolicy } from "@/lib/product/workspace-candidates";
import { assessWorkspaceText } from "@/lib/product/workspace-assessment";
import { selectBalancedWorkspaceItems } from "@/lib/product/workspace-selection";

/** Correct only the economic-event contribution to the Current signals copy. */
export function currentSignalRelevance(item: IntelligenceItem, policy: WorkspacePolicy, sourceId?: string): IntelligenceItem {
  if (item.workspace_relevance === undefined || !item.workspace_relevance_reasons?.includes("economic_change")) return item;
  const original = assessWorkspaceText(item.title_original, item.original_excerpt, policy, sourceId);
  // Leave cached/stale assessments alone when their original score is not reproducible.
  if (original.score !== item.workspace_relevance) return item;
  const contextual = assessWorkspaceText(item.title_original, item.original_excerpt, policy, sourceId, { contextualEconomicEvents: true });
  const delta = contextual.score - original.score;
  if (!delta && contextual.evidence.includes("economic_change")) return item;
  return { ...item, workspace_relevance: Math.max(0, Math.min(100, item.workspace_relevance + delta)),
    workspace_relevance_reasons: item.workspace_relevance_reasons.filter(reason=>reason!=="economic_change" || contextual.evidence.includes(reason)) };
}

/** Reuse the existing age weighting and diversity rules; never mutate feed.items. */
export function orderCurrentSignalItems(items: readonly IntelligenceItem[], policy: WorkspacePolicy, now = Date.now(), sourceIds?: ReadonlyMap<string,string>): IntelligenceItem[] {
  return selectBalancedWorkspaceItems(items.map(item=>currentSignalRelevance(item,policy,sourceIds?.get(item.id))),policy,items.length,now);
}
