import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getProductPool } from "@/lib/product/store";
import type { HomeCountry } from "@/lib/product/profiles";
import type { WorkspacePolicy } from "@/lib/product/workspace-candidates";
import { workspaceSources } from "@/lib/product/workspace-pilot-sources";
import { evaluateWorkspace, scanPublicSource, type SourceScanReport } from "@/lib/product/workspace-ingestion";

export interface WorkspaceRefreshResult {
  state: "progress" | "complete" | "reused" | "busy";
  processed: number; total: number; partial: boolean;
}
export class WorkspaceRefreshDenied extends Error {}

// One bounded source per request. Committed progress survives navigation and server restarts.
export async function refreshWorkspaceStep(accountId: string, homeCountry: HomeCountry, db: Pool = getProductPool()): Promise<WorkspaceRefreshResult> {
  const client = await db.connect();
  try {
    if ((await client.query("SELECT current_user AS role")).rows[0]?.role!=="missiondesk_personal_app") throw new WorkspaceRefreshDenied("Scoped application role required");
    await client.query("BEGIN");
    await client.query("SELECT set_config('missiondesk.account_id',$1,true)",[accountId]);
    const workspaces=(await client.query(`SELECT w.id,w.home_country,w.countries FROM product_workspaces w
      JOIN product_workspace_members m ON m.workspace_id=w.id WHERE m.account_id=$1 AND w.enabled`,[accountId])).rows;
    if (workspaces.length!==1 || workspaces[0].home_country!==homeCountry) throw new WorkspaceRefreshDenied("Workspace is not available");
    const workspace=workspaces[0];
    const policy: WorkspacePolicy={id:workspace.id,homeCountry:workspace.home_country,countries:workspace.countries};
    const subscribed=(await client.query(`SELECT s.source_id FROM product_workspace_sources s JOIN product_public_sources p ON p.id=s.source_id
      WHERE s.workspace_id=$1 AND p.fetch_mode<>'paused'`,[policy.id])).rows.map(row=>row.source_id);
    const eligible=workspaceSources.filter(source=>source.mode!=="paused" && subscribed.includes(source.id)).map(source=>source.id).sort();
    if (!eligible.length) throw new WorkspaceRefreshDenied("No connected sources");
    // The database supplies the Mexico City calendar day; callers cannot choose or reset it.
    await client.query(`INSERT INTO product_workspace_scan_runs(id,workspace_id,source_ids) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(workspace_id,run_day) DO NOTHING`,[randomUUID(),policy.id,JSON.stringify(eligible)]);
    await client.query("COMMIT");

    await client.query("BEGIN");
    await client.query("SELECT set_config('missiondesk.account_id',$1,true)",[accountId]);
    const current=(await client.query(`SELECT * FROM product_workspace_scan_runs WHERE workspace_id=$1
      AND run_day=(now() AT TIME ZONE 'America/Mexico_City')::date`,[policy.id])).rows[0];
    if (!current) throw new WorkspaceRefreshDenied("Daily run is not available");
    if (current.status!=="running") {
      await client.query("COMMIT");
      return {state:"reused",processed:current.completed_source_ids.length,total:current.source_ids.length,partial:current.status==="partial"};
    }
    // Completed runs intentionally have no UPDATE policy, so inspect before requesting a row lock.
    const run=(await client.query("SELECT * FROM product_workspace_scan_runs WHERE id=$1 FOR UPDATE SKIP LOCKED",[current.id])).rows[0];
    if (!run) { await client.query("COMMIT"); return {state:"busy",processed:current.completed_source_ids.length,total:current.source_ids.length,partial:false}; }
    const completed: string[]=run.completed_source_ids;
    const report: SourceScanReport[]=run.report;
    if (run.status!=="running") {
      await client.query("COMMIT");
      return {state:"reused",processed:completed.length,total:run.source_ids.length,partial:run.status==="partial"};
    }
    const nextId=run.source_ids.find((id:string)=>!completed.includes(id));
    if (nextId) {
      const source=workspaceSources.find(source=>source.id===nextId && eligible.includes(source.id));
      const result: SourceScanReport=source ? await scanPublicSource(client,source) : {source:nextId,error:"Subscription is no longer active"};
      if (result.busy) {await client.query("COMMIT");return {state:"busy",processed:completed.length,total:run.source_ids.length,partial:false};}
      report.push(result);
      completed.push(nextId);
      // Reused public material must still receive this workspace's independent decision.
      if (source?.mode==="rss") await evaluateWorkspace(client,policy,source.id);
    }
    const finished=completed.length===run.source_ids.length;
    if (finished) await evaluateWorkspace(client,policy);
    const partial=report.some(result=>Boolean(result.error));
    await client.query(`UPDATE product_workspace_scan_runs SET completed_source_ids=$2::jsonb,report=$3::jsonb,
      status=$4,finished_at=CASE WHEN $4='running' THEN NULL ELSE now() END WHERE id=$1`,
    [run.id,JSON.stringify(completed),JSON.stringify(report),finished ? partial ? "partial" : "completed" : "running"]);
    await client.query("COMMIT");
    return {state:finished?"complete":"progress",processed:completed.length,total:run.source_ids.length,partial};
  } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
}
