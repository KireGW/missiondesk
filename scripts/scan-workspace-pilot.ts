import { personalAdmin } from "./workspace-admin";
import { scanWorkspace } from "../src/lib/product/workspace-ingestion";
import { workspacePilotSources } from "../src/lib/product/workspace-pilot-sources";
import { fetchPilotFeed } from "../src/lib/product/workspace-ingestion";
import { refreshWorkspaceStep } from "../src/lib/product/workspace-refresh";

if(process.argv.includes("--probe")) {
  for(const source of workspacePilotSources) {
    try { const feed=await fetchPilotFeed(source); console.log(JSON.stringify({id:source.id,count:feed.items.length,truncated:feed.truncated})); }
    catch(e) {console.log(JSON.stringify({id:source.id,error:e instanceof Error?e.message:"Failed"}));}
  }
} else {
  if(!process.argv.includes("--apply")&&!process.argv.includes("--daily")&&!process.argv.includes("--status")) throw new Error("Pass --probe, --apply, --daily or --status");
  const admin=personalAdmin();
  const db=admin.connect(admin.parentId);
  try {
    const rows=(await db.query("SELECT id,home_country,countries FROM product_workspaces WHERE slug='daniel-regional-pilot' AND enabled")).rows;
    if(rows.length!==1||rows[0].home_country!=="NO") throw new Error("Verified pilot workspace is missing");
    if(process.argv.includes("--status")) {
      console.log(JSON.stringify({sources:(await db.query(`SELECT fetch_mode,count(*)::int AS count,count(last_success_at)::int AS successful
        FROM product_public_sources p JOIN product_workspace_sources s ON s.source_id=p.id WHERE s.workspace_id=$1 GROUP BY fetch_mode ORDER BY fetch_mode`,[rows[0].id])).rows,
      run:(await db.query(`SELECT run_day,status,completed_source_ids,report FROM product_workspace_scan_runs WHERE workspace_id=$1
        ORDER BY run_day DESC LIMIT 1`,[rows[0].id])).rows[0],
      candidates:(await db.query(`SELECT c.status,count(*)::int AS count FROM product_workspace_candidates c JOIN product_public_articles a ON a.id=c.article_id
        WHERE c.workspace_id=$1 AND c.content_hash=a.content_hash AND c.policy_key=$2 GROUP BY c.status`,[rows[0].id,(await import('../src/lib/product/workspace-candidates')).workspacePolicyKey({id:rows[0].id,homeCountry:rows[0].home_country,countries:rows[0].countries})])).rows},null,2));
    } else if(process.argv.includes("--daily")) {
      const members=(await db.query(`SELECT m.account_id FROM product_workspace_members m JOIN product_username_logins u ON u.account_id=m.account_id
        WHERE m.workspace_id=$1 AND m.role='owner' AND u.enabled AND u.connection_name='MissionDesk-Daniel-Dev'`,[rows[0].id])).rows;
      if(members.length!==1) throw new Error("Expected the approved pilot owner");
      const app=admin.connect(admin.parentId,"missiondesk_personal_app");
      try {for(let step=0;step<35;step++){const result=await refreshWorkspaceStep(members[0].account_id,"NO",app);console.log(JSON.stringify(result));if(result.state!=="progress")break;}}
      finally {await app.end();}
    } else console.log(JSON.stringify(await scanWorkspace(db,{id:rows[0].id,homeCountry:rows[0].home_country,countries:rows[0].countries}),null,2));
  } finally {await db.end();}
}
