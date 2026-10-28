import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { IntelligenceItem } from "@/lib/types";
import { getProductPool } from "@/lib/product/store";
import { productPlans, type PlanId } from "@/lib/product/plans";
import { personalProfiles, type HomeCountry } from "@/lib/product/profiles";
import { workspacePolicyKey } from "@/lib/product/workspace-candidates";
import { workspaceArticleToItem } from "@/lib/product/workspace-items";
import { normalizePersonalSearchQuery } from "@/lib/product/feed";

export interface WorkspaceSearchPage { items: IntelligenceItem[]; nextCursor: string | null }
interface SearchCursor { time: string; id: string; query: string }
export interface WorkspaceSearchInput { query: string; homeOnly: boolean; cursor: SearchCursor | null }
export class WorkspaceSearchDenied extends Error {}
export class WorkspaceSearchLimited extends Error {
  retryAfter: number;
  constructor(retryAfter: number) { super("Search rate limited"); this.retryAfter=retryAfter; }
}
const queryKey = (query: string, homeOnly: boolean) => createHash("sha256").update(homeOnly ? JSON.stringify({query,homeOnly}) : query).digest("hex");

export function parseWorkspaceSearch(value: unknown): WorkspaceSearchInput | null {
  if (!value || typeof value!=="object" || Array.isArray(value)) return null;
  const body=value as Record<string,unknown>;
  if (Object.keys(body).some(key=>!["query","homeOnly","cursor"].includes(key)) || typeof body.query!=="string" ||
    (Object.hasOwn(body,"homeOnly") && typeof body.homeOnly!=="boolean")) return null;
  const query=normalizePersonalSearchQuery(body.query);
  const homeOnly=body.homeOnly===true;
  if ((query.length<2 && !(homeOnly && !query)) || query.length>120 || /[\u0000-\u001f]/.test(query)) return null;
  if (body.cursor===undefined || body.cursor===null) return {query,homeOnly,cursor:null};
  if (typeof body.cursor!=="string" || body.cursor.length>400 || !/^[a-zA-Z0-9_-]+$/.test(body.cursor)) return null;
  try {
    const cursor=JSON.parse(Buffer.from(body.cursor,"base64url").toString("utf8"));
    if (!cursor || typeof cursor!=="object" || Object.keys(cursor).sort().join(",")!=="id,query,time" ||
      typeof cursor.time!=="string" || !Number.isFinite(Date.parse(cursor.time)) || new Date(cursor.time).toISOString()!==cursor.time ||
      typeof cursor.id!=="string" || !/^[a-f0-9]{64}$/.test(cursor.id) || cursor.query!==queryKey(query,homeOnly)) return null;
    return {query,homeOnly,cursor};
  } catch {return null;}
}

export async function searchWorkspace(accountId: string, homeCountry: HomeCountry, plan: PlanId, input: WorkspaceSearchInput, db: Pool = getProductPool()): Promise<WorkspaceSearchPage> {
  const client=await db.connect();
  try {
    await client.query("BEGIN");
    if ((await client.query("SELECT current_user AS role")).rows[0]?.role!=="missiondesk_personal_app") throw new WorkspaceSearchDenied("Scoped application role required");
    await client.query("SET LOCAL statement_timeout='3s'");
    await client.query("SELECT set_config('missiondesk.account_id',$1,true)",[accountId]);
    const workspaces=(await client.query(`SELECT w.id,w.home_country,w.countries FROM product_workspaces w
      JOIN product_workspace_members m ON m.workspace_id=w.id WHERE m.account_id=$1 AND w.enabled`,[accountId])).rows;
    if (workspaces.length!==1 || workspaces[0].home_country!==homeCountry) throw new WorkspaceSearchDenied("Workspace unavailable");
    const workspace=workspaces[0];
    // One fixed-size row per workspace; no query text is retained. The upsert serializes concurrent callers.
    const reservation=await client.query(`INSERT INTO product_workspace_search_limits(workspace_id) VALUES($1)
      ON CONFLICT(workspace_id) DO UPDATE SET
        minute_requests=CASE WHEN product_workspace_search_limits.minute_started_at=date_trunc('minute',now()) THEN product_workspace_search_limits.minute_requests+1 ELSE 1 END,
        day_requests=CASE WHEN product_workspace_search_limits.day_key=(now() AT TIME ZONE 'America/Mexico_City')::date THEN product_workspace_search_limits.day_requests+1 ELSE 1 END,
        minute_started_at=date_trunc('minute',now()),day_key=(now() AT TIME ZONE 'America/Mexico_City')::date
      WHERE (product_workspace_search_limits.minute_started_at<>date_trunc('minute',now()) OR product_workspace_search_limits.minute_requests<30)
        AND (product_workspace_search_limits.day_key<>(now() AT TIME ZONE 'America/Mexico_City')::date OR product_workspace_search_limits.day_requests<300)
      RETURNING workspace_id`,[workspace.id]);
    if (!reservation.rowCount) {
      const limit=(await client.query(`SELECT CASE WHEN day_requests>=300 AND day_key=(now() AT TIME ZONE 'America/Mexico_City')::date
        THEN ceil(extract(epoch FROM ((day_key+1)::timestamp AT TIME ZONE 'America/Mexico_City')-now()))::int
        ELSE ceil(extract(epoch FROM date_trunc('minute',now())+interval '1 minute'-now()))::int END AS seconds
        FROM product_workspace_search_limits WHERE workspace_id=$1`,[workspace.id])).rows[0];
      await client.query("COMMIT");
      throw new WorkspaceSearchLimited(Math.max(1,limit?.seconds ?? 60));
    }
    // Admission stays counted even if the following read times out or the client disconnects.
    await client.query("COMMIT");
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout='3s'");
    await client.query("SELECT set_config('missiondesk.account_id',$1,true)",[accountId]);
    const policy=workspacePolicyKey({id:workspace.id,homeCountry:workspace.home_country,countries:workspace.countries});
    // Both text and home-country predicates precede LIMIT; the country comes only from the trusted profile.
    const result=await client.query(`SELECT a.id,a.title,a.excerpt,a.url,a.published_at,a.countries,a.content_kind,
      p.name,p.language,c.score,coalesce(c.status,'unassessed') AS selection,
      date_trunc('milliseconds',coalesce(a.published_at,a.fetched_at)) AS sort_time
      FROM product_public_articles a JOIN product_workspace_sources s ON s.source_id=a.source_id AND s.workspace_id=$1
      JOIN product_public_sources p ON p.id=a.source_id
      LEFT JOIN product_workspace_candidates c ON c.workspace_id=$1 AND c.article_id=a.id AND c.content_hash=a.content_hash AND c.policy_key=$3
      WHERE ($2::text='' OR to_tsvector('simple',coalesce(a.title,'') || ' ' || coalesce(a.excerpt,'')) @@ websearch_to_tsquery('simple',$2))
        AND ($7::text IS NULL OR to_tsvector('simple',coalesce(a.title,'') || ' ' || coalesce(a.excerpt,'')) @@ to_tsquery('simple',$7))
        AND coalesce(a.published_at,a.fetched_at)>=now()-$4::integer*interval '1 day'
        AND coalesce(a.published_at,a.fetched_at)<=now()+interval '5 minutes'
        AND ($5::timestamptz IS NULL OR (date_trunc('milliseconds',coalesce(a.published_at,a.fetched_at)),a.id)<($5::timestamptz,$6::text))
      ORDER BY sort_time DESC,a.id DESC LIMIT 31`,[workspace.id,input.query,policy,productPlans[plan].archiveDays,input.cursor?.time ?? null,input.cursor?.id ?? null,
        input.homeOnly ? personalProfiles[homeCountry].homeTerms.join(" | ") : null]);
    const rows=result.rows.slice(0,30);
    const last=rows.at(-1);
    const nextCursor=result.rows.length>30 && last ? Buffer.from(JSON.stringify({time:last.sort_time.toISOString(),id:last.id,query:queryKey(input.query,input.homeOnly)})).toString("base64url") : null;
    await client.query("COMMIT");
    return {items:rows.map(workspaceArticleToItem),nextCursor};
  } catch(error) {if (!(error instanceof WorkspaceSearchLimited)) await client.query("ROLLBACK");throw error;} finally {client.release();}
}
