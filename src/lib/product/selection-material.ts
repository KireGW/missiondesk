import type { PoolClient } from "pg";
import type { IntelligenceItem } from "@/lib/types";
import type { PersonalPreferences } from "@/lib/product/profiles";
import { mexicoPublication } from "@/lib/product/profiles";
import { productPlans, type PlanId } from "@/lib/product/plans";
import { workspacePolicyKey } from "@/lib/product/workspace-candidates";
import { workspaceArticleToItem } from "@/lib/product/workspace-items";
import { getReadOnlyDb } from "@/lib/db/postgres";
import { listProcessedItems } from "@/lib/intelligence/repository";
import { processedRecordsToIntelligenceItems } from "@/lib/intelligence/dashboard-view";
import { defaultSources } from "@/lib/sources/default-sources";

/** Resolve only already-published material visible to this account, within its existing archive. No scan or search reservation. */
export async function personalSelectionMaterial(client: PoolClient, accountId: string, preferences: PersonalPreferences, plan: PlanId, ids: string[]): Promise<IntelligenceItem[]> {
  if (!ids.length) return [];
  const result: IntelligenceItem[] = [];
  const workspaceIds = ids.filter(id=>id.startsWith("workspace:")).map(id=>id.slice(10));
  if (workspaceIds.length && process.env.MISSIONDESK_WORKSPACE_PILOT === "true") {
    const memberships = (await client.query(`SELECT w.id,w.home_country,w.countries FROM product_workspaces w
      JOIN product_workspace_members m ON m.workspace_id=w.id WHERE m.account_id=$1 AND w.enabled`,[accountId])).rows;
    if (memberships.length === 1 && memberships[0].home_country === preferences.homeCountry) {
      const w = memberships[0], policy = {id:w.id,homeCountry:w.home_country,countries:w.countries};
      const rows = (await client.query(`SELECT a.id,a.source_id,a.title,a.excerpt,a.url,a.published_at,a.countries,a.content_kind,
        c.score,coalesce(c.status,'unassessed') AS selection,p.name,p.language FROM product_public_articles a
        JOIN product_workspace_sources s ON s.source_id=a.source_id AND s.workspace_id=$1
        JOIN product_public_sources p ON p.id=a.source_id
        LEFT JOIN product_workspace_candidates c ON c.workspace_id=$1 AND c.article_id=a.id AND c.content_hash=a.content_hash AND c.policy_key=$3
        WHERE a.id=ANY($2::text[]) AND coalesce(a.published_at,a.fetched_at)>=now()-$4::integer*interval '1 day'
          AND coalesce(a.published_at,a.fetched_at)<=now()+interval '5 minutes'`,[w.id,workspaceIds,workspacePolicyKey(policy),productPlans[plan].archiveDays])).rows;
      result.push(...rows.map(row=>workspaceArticleToItem(row,policy)));
    }
  }
  const legacyIds = ids.filter(id=>id.startsWith("processed-")).map(id=>id.slice(10));
  if (legacyIds.length) {
    const records = await listProcessedItems({rawSourceItemIds:legacyIds,onlyFresh:false,limit:legacyIds.length},getReadOnlyDb());
    const since = Date.now()-productPlans[plan].archiveDays*86_400_000;
    const sources = defaultSources.filter(source=>mexicoPublication.sourceIds.some(id=>id===source.id));
    const safe = records.filter(record=>{
      const source = sources.find(source=>source.name===record.raw.source_name);
      const time = Date.parse(record.raw.published_at ?? "");
      if (!source || record.raw.source_type!=="news" || !Number.isFinite(time) || time<since || time>Date.now()+300_000
        || !mexicoPublication.countryAliases.some(country=>country.toLowerCase()===(record.raw.detected_country || record.raw.source_country).toLowerCase())) return false;
      try {
        const url = new URL(record.raw.url), host = new URL(source.websiteUrl ?? source.url).hostname;
        return url.protocol==="https:" && !url.username && !url.password && (url.hostname===host
          || source.id==="bbc-latin-america" && ["www.bbc.com","www.bbc.co.uk"].includes(url.hostname));
      } catch { return false; }
    });
    result.push(...processedRecordsToIntelligenceItems(safe));
  }
  return result;
}
