import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mock } from "node:test";
import { Pool } from "pg";
import { personalSelectionsSchemaSql } from "../src/lib/product/selections-schema";
import { workspacePolicyKey } from "../src/lib/product/workspace-candidates";
import { getPersonalSelections, changePersonalSelection } from "../src/lib/product/selections-store";
import type { PersonalSelections } from "../src/lib/product/selections";
import type { PersonalPreferences } from "../src/lib/product/profiles";
import type { PersonalFeed } from "../src/lib/product/feed";
import { JSDOM } from "jsdom";
import type { ReactNode } from "react";

const ownerFile=process.env.MISSIONDESK_SELECTION_TEST_OWNER_URL_FILE;
const appFile=process.env.MISSIONDESK_SELECTION_TEST_APP_URL_FILE;
if(!ownerFile || !appFile || !process.env.MISSIONDESK_SELECTION_TEST_HOST)throw new Error("Explicit isolated test connections required");
const ownerUrl=readFileSync(ownerFile,"utf8").trim(),appUrl=readFileSync(appFile,"utf8").trim();
assert.equal(new URL(ownerUrl).hostname,process.env.MISSIONDESK_SELECTION_TEST_HOST);
assert.equal(new URL(appUrl).hostname,process.env.MISSIONDESK_SELECTION_TEST_HOST);
assert.equal(decodeURIComponent(new URL(appUrl).username),"missiondesk_personal_app");
const owner=new Pool({connectionString:ownerUrl,max:2}),app=new Pool({connectionString:appUrl,max:4});
const envKeys=["DATABASE_URL","MISSIONDESK_ACCESS_MODE","MISSIONDESK_WORKSPACE_PILOT","APP_BASE_URL"];
const savedEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
process.env.DATABASE_URL=appUrl;process.env.MISSIONDESK_ACCESS_MODE="personal";process.env.MISSIONDESK_WORKSPACE_PILOT="true";
const origin="http://localhost:3001";process.env.APP_BASE_URL=origin;
const ids={a:randomUUID(),b:randomUUID(),paused:randomUUID(),wa:randomUUID(),wb:randomUUID()};
const subjectA=`selection-test:${ids.a}`,subjectB=`selection-test:${ids.b}`;
const articleA=createHash("sha256").update(ids.a).digest("hex"),articleB=createHash("sha256").update(ids.b).digest("hex");
const itemA=`workspace:${articleA}`,itemB=`workspace:${articleB}`;
const preferences:PersonalPreferences={homeCountry:"NO",targetCountry:"MX",language:"en",contentLanguage:"original"};
const sessions=new AsyncLocalStorage<{subject:string;session:string}|null>();
const inSession=<T>(subject:string|null,work:()=>T)=>sessions.run(subject?{subject,session:randomUUID()}:null,work);
const moduleAt=(path:string)=>pathToFileURL(resolve(path));
const hook=registerHooks({resolve(specifier,context,nextResolve){return nextResolve(specifier==="next/link"?"next/link.js":specifier,context);}});
const savedFetch=globalThis.fetch;
let report:Record<string,unknown>={};
try {
  // This database must contain only synthetic accounts, never copied production identities.
  const existing=(await owner.query("SELECT auth_subject FROM product_accounts")).rows;
  assert.ok(existing.every(row=>row.auth_subject.startsWith("selection-test:")),"Refusing a database containing non-test accounts");
  const schemaBefore=(await owner.query(`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name NOT IN('product_account_selections','product_account_selection_state') ORDER BY table_name,ordinal_position`)).rows;
  await owner.query(personalSelectionsSchemaSql);await owner.query(personalSelectionsSchemaSql);
  assert.deepEqual((await owner.query(`SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns
    WHERE table_schema='public' AND table_name NOT IN('product_account_selections','product_account_selection_state') ORDER BY table_name,ordinal_position`)).rows,schemaBefore);
  await owner.query("INSERT INTO product_accounts(id,auth_subject,status) VALUES($1,$2,'active'),($3,$4,'active'),($5,$6,'suspended')",
    [ids.a,subjectA,ids.b,subjectB,ids.paused,`selection-test:${ids.paused}`]);
  for(const account of [ids.a,ids.b])await owner.query("INSERT INTO product_account_preferences(account_id,home_country,target_country,language,content_language) VALUES($1,'NO','MX','en','original')",[account]);
  for(const [account,workspace,source,article] of [[ids.a,ids.wa,`selection-${ids.a}`,articleA],[ids.b,ids.wb,`selection-${ids.b}`,articleB]]) {
    await owner.query("INSERT INTO product_workspaces(id,slug,home_country,countries,enabled) VALUES($1,$2,'NO','[\"MX\"]',true)",[workspace,`test-${workspace}`]);
    await owner.query("INSERT INTO product_workspace_members(workspace_id,account_id,role) VALUES($1,$2,'owner')",[workspace,account]);
    await owner.query("INSERT INTO product_public_sources(id,name,feed_url,article_host,language) VALUES($1,'Test source','https://fixture.example/feed','fixture.example','en')",[source]);
    await owner.query("INSERT INTO product_workspace_sources(workspace_id,source_id) VALUES($1,$2)",[workspace,source]);
    await owner.query(`INSERT INTO product_public_articles(id,source_id,url,title,excerpt,published_at,countries,content_hash,content_kind)
      VALUES($1,$2,$3,'Mexico trade announcement','Original source excerpt',now(),'["MX"]','test-hash','news')`,[article,source,`https://fixture.example/${article}`]);
    await owner.query(`INSERT INTO product_workspace_candidates(workspace_id,article_id,content_hash,policy_key,status,score,reason)
      VALUES($1,$2,'test-hash',$3,'selected',62,'test')`,[workspace,article,workspacePolicyKey({id:workspace,homeCountry:"NO",countries:["MX"]})]);
  }
  const engineSnapshot=async()=>JSON.stringify((await owner.query(`SELECT * FROM (SELECT 'articles' AS kind,row_to_json(a) AS value FROM product_public_articles a
    UNION ALL SELECT 'candidates',row_to_json(c) FROM product_workspace_candidates c) entries ORDER BY kind,value::text`)).rows);
  const engineBefore=await engineSnapshot();
  mock.module(moduleAt("src/lib/product/auth.ts"),{namedExports:{getPersonalIdentity:async()=>sessions.getStore()?{subject:sessions.getStore()!.subject}:null}});
  const route=await import("../src/app/api/personal/selections/route");
  const request=(body:unknown,account=ids.a,extra:Record<string,string>={})=>new Request(`${origin}/api/personal/selections`,{method:"PATCH",
    headers:{origin,"content-type":"application/json","x-selection-account":account,...extra},body:typeof body==="string"?body:JSON.stringify(body)});
  const read=()=>inSession(subjectA,()=>route.GET());
  const write=(body:unknown,account=ids.a)=>inSession(subjectA,()=>route.PATCH(request(body,account)));
  for(const mode of ["legacy","invalid"]){process.env.MISSIONDESK_ACCESS_MODE=mode;assert.equal((await route.GET()).status,404);assert.equal((await route.PATCH(request({}))).status,404);}
  process.env.MISSIONDESK_ACCESS_MODE="personal";
  assert.equal((await inSession(null,()=>route.GET())).status,401);
  assert.equal((await inSession(null,()=>route.PATCH(request({})))).status,401);
  assert.equal((await inSession(`selection-test:${ids.paused}`,()=>route.GET())).status,403);
  assert.equal((await inSession(subjectA,()=>route.PATCH(request({},ids.a,{origin:"https://other.example"})))).status,403);
  assert.equal((await inSession(subjectA,()=>route.PATCH(request({},ids.a,{"content-type":"text/plain"})))).status,415);
  assert.equal((await write({kind:"priority",itemId:itemA,selected:true},ids.b)).status,409,"Stale account tabs cannot mutate a new login");
  for(const body of [null,[],{}, {kind:"priority",itemId:itemA,selected:true,accountId:ids.b},{kind:"priority",itemId:itemA,selected:true,item:{title:"forged"}},
    {kind:"priority",itemId:"javascript:fake",selected:true},{kind:"meeting",clear:true,revision:"NaN"}])assert.equal((await write(body)).status,400);
  assert.equal((await write("x".repeat(2049))).status,413);
  const empty=await read();assert.equal(empty.headers.get("cache-control"),"private, no-store");
  assert.deepEqual((await empty.json()).priorities,[]);
  assert.equal((await write({kind:"priority",itemId:itemB,selected:true})).status,404,"No bookmarks for another workspace's private material");
  const emptyState=await app.connect();
  try{await emptyState.query("BEGIN");await emptyState.query("SELECT set_config('missiondesk.account_id',$1,true)",[ids.a]);
    assert.equal((await emptyState.query("SELECT count(*)::int AS count FROM product_account_selection_state")).rows[0].count,0,"Reads/failed writes cannot create empty state");
  }finally{await emptyState.query("ROLLBACK");emptyState.release();}
  let a=await (await write({kind:"priority",itemId:itemA,selected:true})).json() as PersonalSelections;
  assert.deepEqual(a.priorities,[itemA]);assert.equal(a.retained[itemA].original_excerpt,"Original source excerpt");
  a=await (await write({kind:"meeting",itemId:itemA,selected:true})).json() as PersonalSelections;
  assert.deepEqual(a.meeting,[itemA]);assert.deepEqual(a.priorities,[itemA]);
  const reloaded=await (await read()).json() as PersonalSelections;
  assert.deepEqual(reloaded,a,"Fresh request/reload reads persisted rows");
  const metadata=await app.connect();
  try{await metadata.query("BEGIN");await metadata.query("SELECT set_config('missiondesk.account_id',$1,true)",[ids.a]);
    const stored=(await metadata.query("SELECT bookmark FROM product_account_selections WHERE account_id=$1",[ids.a])).rows;
    assert.ok(stored.length===2 && stored.every(row=>!("original_excerpt" in row.bookmark) && !("summary_sv" in row.bookmark) && !("workspace_relevance" in row.bookmark)),"Persist link metadata, never a duplicate article archive or ranking score");
  }finally{await metadata.query("ROLLBACK");metadata.release();}
  const loginB=await (await inSession(subjectB,()=>route.GET())).json() as PersonalSelections;
  assert.deepEqual(loginB.priorities,[]);assert.deepEqual(loginB.meeting,[]);assert.deepEqual(loginB.retained,{});
  assert.deepEqual(await (await read()).json(),a,"A new verified session for account A restores both lists after B signed in");
  const c=await app.connect();
  try{await c.query("BEGIN");await c.query("SELECT set_config('missiondesk.account_id',$1,true)",[ids.b]);
    assert.equal((await c.query("SELECT * FROM product_account_selections WHERE account_id=$1",[ids.a])).rowCount,0);
    await assert.rejects(c.query("INSERT INTO product_account_selection_state(account_id) VALUES($1)",[ids.a]),/row-level security/);
  }finally{await c.query("ROLLBACK");c.release();}
  await Promise.all([write({kind:"priority",itemId:itemA,selected:false}),write({kind:"meeting",itemId:itemA,selected:false})]);
  await Promise.all([write({kind:"priority",itemId:itemA,selected:true}),write({kind:"meeting",itemId:itemA,selected:true})]);
  a=await (await read()).json();assert.deepEqual(a.priorities,[itemA]);assert.deepEqual(a.meeting,[itemA]);
  const duplicate=await write({kind:"meeting",itemId:itemA,selected:true});assert.deepEqual((await duplicate.json()).meeting,[itemA]);
  assert.equal((await write({kind:"meeting",clear:true,revision:"0"})).status,409,"Stale clear cannot erase newer changes");
  a=await (await write({kind:"meeting",clear:true,revision:a.revision})).json();assert.deepEqual(a.meeting,[]);assert.deepEqual(a.priorities,[itemA]);
  assert.equal(await engineSnapshot(),engineBefore,"Saving and reading selections cannot modify article/candidate rows");

  // Render and interact with the real client component; only the verified identity and external chrome are fixtures.
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:origin});
  const globals={window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,
    Event:dom.window.Event,MouseEvent:dom.window.MouseEvent,IS_REACT_ACT_ENVIRONMENT:true};
  for(const [key,value] of Object.entries(globals))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const React=await import("react"),{createRoot}=await import("react-dom/client");
  mock.module(moduleAt("node_modules/next/link.js"),{defaultExport:({children}: {children:ReactNode})=>React.createElement("span",null,children)});
  mock.module(moduleAt("src/components/product/BrandLogo.tsx"),{namedExports:{BrandLogo:()=>React.createElement("span",null,"MissionDesk")}});
  mock.module(moduleAt("src/components/product/ProductFooter.tsx"),{namedExports:{ProductFooter:()=>null}});
  const {PersonalDashboard}=await import("../src/components/product/PersonalDashboard");
  let session:string|null=subjectA,failSave=false,failLoad=false,gets=0,patches=0;
  globalThis.fetch=async(input,init)=>{
    assert.equal(String(input),"/api/personal/selections","No external API, source fetch or engine request is allowed");
    if(init?.method==="PATCH"){patches++;if(failSave)return new Response("{}",{status:503});
      return inSession(session,()=>route.PATCH(new Request(`${origin}/api/personal/selections`,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),origin}})));}
    gets++;if(failLoad)return new Response("{}",{status:503});return inSession(session,()=>route.GET());
  };
  const wait=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await React.act(async()=>{await new Promise(done=>setTimeout(done,20));});assert.ok(check(),"Client condition did not settle");};
  const container=dom.window.document.createElement("div");dom.window.document.body.append(container);
  let root=createRoot(container);
  const feed:PersonalFeed={items:[a.retained[itemA]],briefings:[],activeSourceCount:1,updates:{},workspacePilot:{connectedSourceIds:[],heldCount:0,attentionNeeded:false}};
  const render=async(initial:PersonalSelections|null,account=ids.a,inputFeed:PersonalFeed=feed)=>React.act(async()=>root.render(React.createElement(PersonalDashboard,{initialFeed:inputFeed,initialPreferences:preferences,plan:"free",selectionAccountId:account,initialSelections:initial})));
  const checks=()=>Array.from(container.querySelectorAll<HTMLInputElement>('article input[type="checkbox"]'));
  const click=async(element:Element)=>React.act(async()=>{(element as HTMLElement).click();});
  await render(a);await wait(()=>gets>0 && checks().length===2);
  assert.equal(checks()[0].checked,true);assert.equal(checks()[1].checked,false);
  await click(checks()[1]);await wait(()=>checks()[1].checked&&!checks()[1].disabled&&patches===1);
  await React.act(async()=>root.unmount());root=createRoot(container);
  a=await (await read()).json();await render(a);await wait(()=>checks().length===2&&!checks()[0].disabled);
  assert.ok(checks().every(input=>input.checked),"A full client remount restores both persisted checkboxes");
  session=null;assert.equal((await globalThis.fetch("/api/personal/selections")).status,401);session=subjectB;
  await React.act(async()=>root.unmount());root=createRoot(container);await render(loginB,ids.b);await wait(()=>checks().length===2&&!checks()[0].disabled);
  assert.ok(checks().every(input=>!input.checked),"Another account cannot see A's checked selections");
  session=subjectA;await React.act(async()=>root.unmount());root=createRoot(container);a=await (await read()).json();await render(a);
  await wait(()=>checks().length===2&&!checks()[0].disabled);assert.ok(checks().every(input=>input.checked),"New login and new component restore A's lists");
  failSave=true;await click(checks()[0]);await wait(()=>!!container.querySelector('[role="alert"]')&&!checks()[0].disabled);
  assert.ok(checks()[0].checked,"A failed save rolls back its optimistic checkbox");failSave=false;
  const beforeLoadPatches=patches;failLoad=true;await React.act(async()=>root.unmount());root=createRoot(container);await render(null);
  await wait(()=>!!container.querySelector('[role="alert"]'));assert.ok(checks().every(input=>input.disabled));assert.equal(patches,beforeLoadPatches,"Empty startup must never write an empty selection");
  failLoad=false;await click(container.querySelector('[role="alert"]')!.parentElement!.querySelector("button")!);
  await wait(()=>checks().every(input=>input.checked&&!input.disabled));
  await React.act(async()=>root.unmount());
  root=createRoot(container);a=await (await read()).json();
  await render(a,ids.a,{...feed,items:[]});
  assert.equal(container.querySelectorAll("article").length,0,"Saved items do not enter Current signals");
  const tab=(label:string)=>Array.from(container.querySelectorAll("nav button")).find(button=>button.textContent?.includes(label))!;
  await click(tab("Prioritized"));
  assert.equal(container.querySelectorAll("article").length,1,"An article leaving Current signals stays in Prioritized");
  assert.ok(container.textContent?.includes("Original source excerpt"),"Material inside the archive remains available outside Current signals");
  await React.act(async()=>root.unmount());
  assert.equal(await engineSnapshot(),engineBefore);
  // Past the free archive window only owned link metadata remains; existing bookmarks can move between lists.
  await owner.query("UPDATE product_public_articles SET published_at=now()-interval '8 days' WHERE id=$1",[articleA]);
  const expired=await getPersonalSelections(ids.a,preferences,"free",app);
  assert.deepEqual(expired.bookmarkOnlyIds,[itemA]);assert.equal(expired.retained[itemA].original_excerpt,"");
  assert.equal(expired.retained[itemA].title_original,"Mexico trade announcement");
  await changePersonalSelection(ids.a,preferences,"free",{kind:"meeting",itemId:itemA,selected:false},app);
  await changePersonalSelection(ids.a,preferences,"free",{kind:"meeting",itemId:itemA,selected:true},app);
  root=createRoot(container);await render(expired,ids.a,{...feed,items:[]});await click(tab("Prioritized"));
  assert.equal(container.querySelectorAll("article").length,1);
  assert.ok(container.textContent?.includes("Saved source link"));
  assert.ok(!container.textContent?.includes("Original source excerpt"),"An expired bookmark does not create an unlimited article archive");
  assert.equal(container.querySelectorAll("article details").length,0,"Do not invent relevance for a link-only bookmark");
  await React.act(async()=>root.unmount());
  report={isolatedDatabase:true,accountsIsolated:true,reloadRestored:true,newSessionRestored:true,clientRemountRestored:true,accountSwitchIsolated:true,
    failedSaveRolledBack:true,emptyStartupDidNotWrite:true,concurrentListsPreserved:true,staleClearRejected:true,duplicateAddsIdempotent:true,
    existingSchemaUnchanged:true,engineRowsUnchanged:true,freeArchivePreserved:true,expiredBookmarksMetadataOnly:true,itemsOutsideCurrentRetained:true,
    identityVerification:"Verified-session fixtures replace Auth0; actual account mapping, API handlers, React component and database are exercised.",
    browser:"Automated DOM interaction; local browser access is disabled.",verifiedAt:new Date().toISOString()};
  if(process.env.MISSIONDESK_SELECTION_TEST_REPORT)writeFileSync(process.env.MISSIONDESK_SELECTION_TEST_REPORT,JSON.stringify(report,null,2)+"\n");
  console.log("[verify:personal-selections] Account isolation, remount/reload/new-session persistence, concurrency, failed-save rollback, empty startup, RLS and archive controls passed; engine rows unchanged.");
} finally {
  globalThis.fetch=savedFetch;mock.restoreAll();hook.deregister();
  const {getProductPool}=await import("../src/lib/product/store");await getProductPool().end();await app.end();await owner.end();
  for(const key of envKeys)if(savedEnv[key]===undefined)delete process.env[key];else process.env[key]=savedEnv[key];
}
