import { getProductPool } from "@/lib/product/store";
import { workspaceSources } from "@/lib/product/workspace-pilot-sources";

export interface WorkspaceSourceStatus { id: string; connected: boolean; attention: boolean; mode: "rss" | "page" | "paused"; changed: boolean }
export async function readWorkspaceSourceStatus(accountId: string): Promise<WorkspaceSourceStatus[]> {
  if (process.env.MISSIONDESK_WORKSPACE_PILOT !== "true") return [];
  const client = await getProductPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('missiondesk.account_id',$1,true)",[accountId]);
    const rows = (await client.query("SELECT id,fetch_mode,last_success_at,last_error,truncated,changed_at FROM product_public_sources")).rows;
    await client.query("COMMIT");
    return rows.map(row=>{
      // The scanner also excludes code-reviewed holds, even before database configuration is synchronized.
      const mode=workspaceSources.find(source=>source.id===row.id)?.mode==="paused" ? "paused" : row.fetch_mode;
      return {id:row.id,connected:!!row.last_success_at,attention:!!row.last_error||row.truncated,mode,changed:mode!=="paused" && !!row.changed_at};
    });
  } catch(e) {await client.query("ROLLBACK");throw e;} finally {client.release();}
}
