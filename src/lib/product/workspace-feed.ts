import { getProductPool } from "@/lib/product/store";
import { workspacePolicyKey, type WorkspacePolicy } from "@/lib/product/workspace-candidates";
import type { PersonalFeed } from "@/lib/product/feed";
import type { PersonalPreferences } from "@/lib/product/profiles";
import { productPlans, type PlanId } from "@/lib/product/plans";
import { workspaceArticleToItem } from "@/lib/product/workspace-items";
import { workspaceRankSql } from "@/lib/product/workspace-assessment";
import { canonicalSignalUrl, selectBalancedWorkspaceItems } from "@/lib/product/workspace-selection";
import { selectCurrentSignalItems } from "@/lib/product/current-signals";

export async function addWorkspaceFeed(accountId: string, preferences: PersonalPreferences, feed: PersonalFeed, planId: PlanId = "free"): Promise<PersonalFeed> {
  if (process.env.MISSIONDESK_WORKSPACE_PILOT !== "true") return feed;
  const limit = productPlans[planId].feedLimit;
  const client = await getProductPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('missiondesk.account_id', $1, true)", [accountId]);
    // RLS derives access from server-verified membership, not a requested workspace ID.
    const memberships = await client.query(`SELECT w.id, w.home_country, w.countries FROM product_workspaces w
      JOIN product_workspace_members m ON m.workspace_id = w.id WHERE m.account_id = $1 AND w.enabled`, [accountId]);
    // Pilot has exactly one workspace per account. Do not guess if an organisation is later added.
    if (memberships.rows.length !== 1) { await client.query("COMMIT"); return feed; }
    const workspace = memberships.rows[0];
    if (workspace.home_country !== preferences.homeCountry) throw new Error("Workspace/profile mismatch");
    const policy: WorkspacePolicy = { id: workspace.id, homeCountry: workspace.home_country, countries: workspace.countries };
    const sources = (await client.query(`SELECT p.id, p.name, p.language, p.fetch_mode, p.last_success_at, p.truncated, p.last_error
      FROM product_public_sources p JOIN product_workspace_sources s ON s.source_id=p.id WHERE s.workspace_id=$1`, [workspace.id])).rows;
    const candidates = (await client.query(`SELECT a.id,a.source_id,a.title,a.excerpt,a.url,a.published_at,a.countries,a.content_kind,c.score,p.name,p.language FROM product_workspace_candidates c
      JOIN product_public_articles a ON a.id=c.article_id JOIN product_public_sources p ON p.id=a.source_id
      WHERE c.workspace_id=$1 AND c.policy_key=$2 AND c.content_hash=a.content_hash AND c.status='selected'
        AND a.published_at > now() - interval '7 days' AND a.published_at <= now() + interval '5 minutes'
      ORDER BY ${workspaceRankSql} DESC, a.published_at DESC, a.id LIMIT $3`, [workspace.id, workspacePolicyKey(policy), Math.min(limit * 3, 300)])).rows;
    const held = (await client.query(`SELECT COUNT(*)::int AS count FROM product_workspace_candidates c
      JOIN product_public_articles a ON a.id=c.article_id WHERE c.workspace_id=$1 AND c.policy_key=$2
      AND c.content_hash=a.content_hash AND c.status='held' AND a.fetched_at > now() - interval '7 days'`,
    [workspace.id, workspacePolicyKey(policy)])).rows[0].count;
    // Extending the existing ordered list preserves its original plan-sized prefix.
    // Keep that prefix as items; only Current signals receives the filtered/backfilled presentation.
    const ordered = selectBalancedWorkspaceItems(candidates.map(row=>workspaceArticleToItem(row,policy)),policy,candidates.length);
    const items = ordered.slice(0, limit);
    await client.query("COMMIT");
    const fetchedAt = sources.map((source) => source.last_success_at?.toISOString()).filter(Boolean).sort().at(-1);
    const seen=new Set<string>();
    const combined=[...items,...feed.items].filter(item=>{
      const key=canonicalSignalUrl(item);
      if(seen.has(key)) return false;seen.add(key);return true;
    });
    const originalItems = combined.slice(0, limit);
    const currentItems = selectCurrentSignalItems([...ordered, ...feed.items], limit);
    const presentationChanged = currentItems.length !== originalItems.length || currentItems.some((item,index)=>item.id !== originalItems[index]?.id);
    return { ...feed, items: originalItems, ...(presentationChanged ? { currentItems } : {}),
      updatedAt: [feed.updatedAt, fetchedAt].filter(Boolean).sort().at(-1),
      workspacePilot: { connectedSourceIds: sources.filter((source) => source.last_success_at).map((source) => source.id), heldCount: held,
        attentionNeeded: sources.some((source) => source.last_error || source.truncated || source.fetch_mode==="paused"),
        ...(process.env.MISSIONDESK_WORKSPACE_REFRESH==="true" ? {refreshEnabled:true} : {}) } };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
