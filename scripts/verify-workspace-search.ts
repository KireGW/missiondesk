import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { personalAdmin } from "./workspace-admin";
import { workspaceSearchSchemaSql } from "../src/lib/product/workspace-search-schema";
import { parseWorkspaceSearch, searchWorkspace, WorkspaceSearchLimited } from "../src/lib/product/workspace-search";
import { publicCandidate, workspacePolicyKey } from "../src/lib/product/workspace-candidates";
import { workspacePilotSources } from "../src/lib/product/workspace-pilot-sources";
import { personalHomeConnection, personalProfiles } from "../src/lib/product/profiles";

const mode=process.argv[2];
if(!["--rehearse","--apply","--check"].includes(mode)) throw new Error("Use --rehearse, --apply or --check");
const admin=personalAdmin();
if(mode==="--check") {
  const owner=admin.connect(admin.parentId);
  const app=admin.connect(admin.parentId,"missiondesk_personal_app");
  try {
    const members=(await owner.query(`SELECT m.account_id FROM product_workspaces w JOIN product_workspace_members m ON m.workspace_id=w.id
      JOIN product_username_logins u ON u.account_id=m.account_id WHERE w.slug='daniel-regional-pilot' AND w.enabled
      AND m.role='owner' AND u.enabled AND u.connection_name='MissionDesk-Daniel-Dev'`)).rows;
    if(members.length!==1) throw new Error("Approved pilot owner required");
    const result=await searchWorkspace(members[0].account_id,"NO","free",parseWorkspaceSearch({query:"lula"})!,app);
    console.log(JSON.stringify({query:"lula",matches:result.items.length,hasMore:!!result.nextCursor,
      unselected:result.items.filter(item=>item.workspace_selection!=="selected").length,
      sources:[...new Set(result.items.map(item=>item.source_name))]},null,2));
  } finally {await app.end();await owner.end();}
  process.exit(0);
}
const name=`verify-search-${randomUUID().slice(0,8)}`;
const created=admin.neon(["branches","create","--project-id",admin.project,"--parent",admin.parentId,"--name",name,
  "--no-secrets","--cu","0.25","--expires-at",new Date(Date.now()+3_600_000).toISOString()]);
const branch=created.branch ?? created;
if(!branch.id || branch.id===admin.parentId || branch.parent_id!==admin.parentId || branch.name!==name || branch.primary || branch.default) throw new Error("Wrong disposable branch");
let db:Pool|undefined;
let app:Pool|undefined;
try {
  db=admin.connect(branch.id);
  await db.query(workspaceSearchSchemaSql);
  const legacyBefore=(await db.query("SELECT (SELECT count(*) FROM raw_source_items)::int AS raw,(SELECT count(*) FROM processed_items)::int AS processed")).rows;
  const ids=[randomUUID(),randomUUID()];
  const workspaces=[randomUUID(),randomUUID()];
  const sources=workspacePilotSources.slice(0,2).map(source=>({...source,id:`verify-search-${randomUUID()}`}));
  for(let i=0;i<2;i++) {
    await db.query("INSERT INTO product_public_sources(id,name,feed_url,article_host,language) VALUES($1,$2,$3,$4,$5)",
      [sources[i].id,sources[i].name,sources[i].feedUrl,sources[i].host,sources[i].language]);
    await db.query("INSERT INTO product_accounts(id,auth_subject) VALUES($1,$2)",[ids[i],`search-test:${ids[i]}`]);
    await db.query("INSERT INTO product_workspaces(id,slug,home_country,countries,enabled) VALUES($1,$2,'NO','[\"MX\"]',true)",[workspaces[i],`search-test-${workspaces[i]}`]);
    await db.query("INSERT INTO product_workspace_members VALUES($1,$2,'owner')",[workspaces[i],ids[i]]);
    await db.query("INSERT INTO product_workspace_sources VALUES($1,$2)",[workspaces[i],sources[i].id]);
  }
  const tag=`lulatest${randomUUID().replaceAll('-','')}`;
  const now=Date.now();
  const make=(index:number,title:string,publishedAt:string|null,sourceIndex=0,excerpt="Original public source excerpt about Brasil.")=>publicCandidate({sourceId:sources[sourceIndex].id,
    url:`https://${sources[sourceIndex].host}/search-test-${tag}/${index}`,title,excerpt,publishedAt},sources[sourceIndex].host);
  const matching=Array.from({length:65},(_,i)=>make(i,`${tag} Lula Brasil ${i}`,new Date(now-(i+100)*1000).toISOString(),0,
    i<35 ? `An agreement with ${personalProfiles.NO.homeTerms[i%personalProfiles.NO.homeTerms.length].toUpperCase()}.` : "Original public source excerpt about Brasil."));
  const newer=Array.from({length:35},(_,i)=>make(100+i,`Unrelated newer fixture ${i}: Noruegalandia and Suecia`,new Date(now-i*1000).toISOString()));
  const undated=make(200,`${tag} Lula undated`,null);
  const outside=[make(201,`${tag} Lula old`,new Date(now-8*86_400_000).toISOString(),0,"Noruega"),
    make(202,`${tag} Lula future`,new Date(now+86_400_000).toISOString(),0,"Noruega"),
    make(203,`${tag} Lula other workspace`,new Date(now).toISOString(),1,"Noruega")];
  const fixtures=[...matching,...newer,undated,...outside];
  await db.query(`INSERT INTO product_public_articles(id,source_id,url,title,excerpt,published_at,content_hash,countries)
    SELECT id,"sourceId",url,title,excerpt,"publishedAt","contentHash",countries FROM jsonb_to_recordset($1::jsonb)
      AS a(id text,"sourceId" text,url text,title text,excerpt text,"publishedAt" timestamptz,"contentHash" text,countries jsonb)`,[JSON.stringify(fixtures)]);
  const policy=workspacePolicyKey({id:workspaces[0],homeCountry:"NO",countries:["MX"]});
  for(const item of matching.slice(0,63)) await db.query(`INSERT INTO product_workspace_candidates(workspace_id,article_id,content_hash,policy_key,status,score,reason)
    VALUES($1,$2,$3,$4,'held',0,'country_uncertain_or_outside')`,[workspaces[0],item.id,item.contentHash,policy]);
  const candidatesBefore=(await db.query("SELECT count(*)::int AS count FROM product_workspace_candidates")).rows;
  app=admin.connect(branch.id,"missiondesk_personal_app");
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("Search must not fetch sources or invoke an external API");};
  try {
    const results=[];
    let cursor:string|null=null;
    do {
      const input=parseWorkspaceSearch({query:`${tag} lula`,cursor});assert.ok(input);
      const page=await searchWorkspace(ids[0],"NO","free",input,app);
      assert.ok(page.items.length<=30);
      results.push(...page.items);cursor=page.nextCursor;
    } while(cursor);
    assert.equal(results.length,66,"Search must include held and undated recent entries, beyond the first 30 non-matching articles");
    assert.equal(new Set(results.map(item=>item.id)).size,66,"Pagination must not repeat hits");
    assert.ok(results.some(item=>item.workspace_selection==="held"));
    assert.ok(results.some(item=>item.workspace_selection==="unassessed"));
    assert.ok(results.every(item=>!item.title_original.includes("other workspace")&&!item.title_original.endsWith(" old")&&!item.title_original.endsWith(" future")));
    for(const query of ["",`${tag} lula`]) {
      const homeResults=[];
      let cursor:string|null=null;
      do {
        const input=parseWorkspaceSearch({query,homeOnly:true,cursor});assert.ok(input);
        const page=await searchWorkspace(ids[0],"NO","free",input,app);
        homeResults.push(...page.items);cursor=page.nextCursor;
        if(cursor) assert.equal(parseWorkspaceSearch({query:query || tag,homeOnly:false,cursor}),null,"A filtered cursor must not work after unchecking");
      } while(cursor);
      assert.equal(homeResults.length,35,"Home-country matching precedes pagination and includes held material beyond the current feed");
      assert.equal(new Set(homeResults.map(item=>item.id)).size,35);
      assert.ok(homeResults.every(item=>personalHomeConnection(item,"NO")),"SQL and the UI must recognize the same source-based home-country evidence");
      assert.ok(homeResults.every(item=>item.workspace_selection==="held"));
    }
    assert.equal((await searchWorkspace(ids[0],"NO","free",parseWorkspaceSearch({query:`${tag} undated`,homeOnly:true})!,app)).items.length,0,
      "Home-country evidence and query terms must both match, not either one");
    await assert.rejects(()=>searchWorkspace(ids[0],"SE","free",parseWorkspaceSearch({query:tag})!,app));
    await assert.rejects(()=>searchWorkspace(randomUUID(),"NO","free",parseWorkspaceSearch({query:tag})!,app));
    const foreign=await searchWorkspace(ids[1],"NO","free",parseWorkspaceSearch({query:tag})!,app);
    assert.equal(foreign.items.length,1);
    await db.query(`UPDATE product_workspace_search_limits SET minute_requests=29,day_requests=299,
      minute_started_at=date_trunc('minute',now()),day_key=(now() AT TIME ZONE 'America/Mexico_City')::date WHERE workspace_id=$1`,[workspaces[0]]);
    const raced=await Promise.allSettled([searchWorkspace(ids[0],"NO","free",parseWorkspaceSearch({query:tag})!,app),searchWorkspace(ids[0],"NO","free",parseWorkspaceSearch({query:tag})!,app)]);
    assert.equal(raced.filter(result=>result.status==="fulfilled").length,1);
    assert.ok(raced.some(result=>result.status==="rejected" && result.reason instanceof WorkspaceSearchLimited));
    assert.deepEqual((await db.query("SELECT minute_requests,day_requests FROM product_workspace_search_limits WHERE workspace_id=$1",[workspaces[0]])).rows[0],{minute_requests:30,day_requests:300});
    await db.query(`UPDATE product_workspace_search_limits SET minute_started_at=now()-interval '2 minutes',day_key=day_key-1 WHERE workspace_id=$1`,[workspaces[0]]);
    await searchWorkspace(ids[0],"NO","free",parseWorkspaceSearch({query:tag})!,app);
    assert.deepEqual((await db.query("SELECT minute_requests,day_requests FROM product_workspace_search_limits WHERE workspace_id=$1",[workspaces[0]])).rows[0],{minute_requests:1,day_requests:1});
    const client=await app.connect();
    try {
      await client.query("BEGIN");await client.query("SELECT set_config('missiondesk.account_id',$1,true)",[ids[0]]);
      assert.equal((await client.query("SELECT * FROM product_workspace_search_limits")).rowCount,1);
      assert.equal((await client.query("UPDATE product_workspace_search_limits SET day_requests=1 WHERE workspace_id=$1",[workspaces[1]])).rowCount,0);
      await assert.rejects(client.query("DELETE FROM product_workspace_search_limits"),(e:unknown)=>(e as {code:string}).code==="42501");
      await client.query("ROLLBACK");
      assert.equal((await client.query("SELECT * FROM product_workspace_search_limits")).rowCount,0,"Pooled connections must not retain another account context");
    } finally {client.release();}
  } finally {globalThis.fetch=previousFetch;}
  await db.query(workspaceSearchSchemaSql);
  assert.deepEqual((await db.query("SELECT count(*)::int AS count FROM product_workspace_candidates")).rows,candidatesBefore,"Search must not publish or rescore candidates");
  assert.deepEqual((await db.query("SELECT (SELECT count(*) FROM raw_source_items)::int AS raw,(SELECT count(*) FROM processed_items)::int AS processed")).rows,legacyBefore);
  console.log("[search:rehearsal] Passed: held/unassessed hits beyond feed limit, home-country-only and combined searches before 30-hit pagination, profile aliases and cursor binding, seven-day/source isolation, concurrent rate limits, anonymous denial and no scoring/legacy changes or external calls.");
} finally {await app?.end();await db?.end();admin.neon(["api",`/projects/${admin.project}/branches/${branch.id}`,"--method","DELETE"]);console.log("Disposable search branch removed.");}
if(mode==="--apply") {
  const db=admin.connect(admin.parentId);
  try {await db.query(workspaceSearchSchemaSql);console.log("[search:apply] Search index and scoped request counters installed on the isolated pilot; source and signal data unchanged.");}
  finally {await db.end();}
}
