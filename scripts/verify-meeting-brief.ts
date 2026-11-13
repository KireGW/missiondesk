import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID,createHash } from "node:crypto";
import { readFileSync,writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mock } from "node:test";
import { Pool } from "pg";
import { JSDOM } from "jsdom";
import type { ReactNode } from "react";
import { meetingBriefSchemaSql } from "../src/lib/product/meeting-brief-schema";
import { meetingDateLabel,validMeetingDate } from "../src/lib/product/meeting-brief";
import { getPersonalSelections,changePersonalSelection } from "../src/lib/product/selections-store";
import type { PersonalSelections } from "../src/lib/product/selections";
import { personalSelectionMaterial } from "../src/lib/product/selection-material";
import { initializeCurrentReview,getCurrentReview } from "../src/lib/product/current-review-store";
import { workspacePolicyKey } from "../src/lib/product/workspace-candidates";
import type { PersonalPreferences } from "../src/lib/product/profiles";
import type { PersonalFeed } from "../src/lib/product/feed";

const ownerFile=process.env.MISSIONDESK_SELECTION_TEST_OWNER_URL_FILE,appFile=process.env.MISSIONDESK_SELECTION_TEST_APP_URL_FILE;
if(!ownerFile||!appFile||!process.env.MISSIONDESK_SELECTION_TEST_HOST)throw new Error("Explicit isolated test connections required");
const ownerUrl=readFileSync(ownerFile,"utf8").trim(),appUrl=readFileSync(appFile,"utf8").trim();
for(const url of [ownerUrl,appUrl])assert.equal(new URL(url).hostname,process.env.MISSIONDESK_SELECTION_TEST_HOST);
assert.equal(new URL(appUrl).username,"missiondesk_personal_app");
const owner=new Pool({connectionString:ownerUrl,max:2}),app=new Pool({connectionString:appUrl,max:4});
const envKeys=["DATABASE_URL","MISSIONDESK_ACCESS_MODE","MISSIONDESK_WORKSPACE_PILOT","APP_BASE_URL"];
const savedEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
const origin="http://localhost:3001";process.env.DATABASE_URL=appUrl;process.env.MISSIONDESK_ACCESS_MODE="personal";process.env.MISSIONDESK_WORKSPACE_PILOT="true";process.env.APP_BASE_URL=origin;
const ids={a:randomUUID(),b:randomUUID(),wa:randomUUID(),wb:randomUUID()};
const subjectA=`selection-test:meeting:${ids.a}`,subjectB=`selection-test:meeting:${ids.b}`;
const articles=Array.from({length:5},(_,i)=>createHash("sha256").update(`${ids.a}:${i}`).digest("hex")),items=articles.map(id=>`workspace:${id}`);
const preferences:PersonalPreferences={homeCountry:"NO",targetCountry:"MX",language:"en",contentLanguage:"original"};
const sessions=new AsyncLocalStorage<{subject:string;session:string}|null>();
const inSession=<T>(subject:string|null,work:()=>T)=>sessions.run(subject?{subject,session:randomUUID()}:null,work);
const moduleAt=(path:string)=>pathToFileURL(resolve(path));
const hook=registerHooks({resolve(specifier,context,nextResolve){return nextResolve(specifier==="next/link"?"next/link.js":specifier,context);}});
const savedFetch=globalThis.fetch;
let networkAct:<T>(work:()=>Promise<T>)=>Promise<T>=async work=>work();
try {
  assert.ok((await owner.query("SELECT auth_subject FROM product_accounts")).rows.every(row=>row.auth_subject.startsWith("selection-test:")),"Refusing non-test accounts");
  const schema=async()=>(await owner.query(`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name<>'product_account_meeting_briefs' ORDER BY table_name,ordinal_position`)).rows;
  const oldSchema=await schema();await owner.query(meetingBriefSchemaSql);await owner.query(meetingBriefSchemaSql);assert.deepEqual(await schema(),oldSchema);
  await owner.query("INSERT INTO product_accounts(id,auth_subject,status) VALUES($1,$2,'active'),($3,$4,'active')",[ids.a,subjectA,ids.b,subjectB]);
  for(const [account,workspace] of [[ids.a,ids.wa],[ids.b,ids.wb]]) {
    await owner.query("INSERT INTO product_account_preferences(account_id,home_country,target_country,language,content_language) VALUES($1,'NO','MX','en','original')",[account]);
    await owner.query("INSERT INTO product_workspaces(id,slug,home_country,countries,enabled) VALUES($1,$2,'NO','[\"MX\"]',true)",[workspace,`meeting-${workspace}`]);
    await owner.query("INSERT INTO product_workspace_members(workspace_id,account_id,role) VALUES($1,$2,'owner')",[workspace,account]);
    const source=`meeting-${account}`;
    await owner.query("INSERT INTO product_public_sources(id,name,feed_url,article_host,language) VALUES($1,'Meeting test source','https://fixture.example/feed','fixture.example','en')",[source]);
    await owner.query("INSERT INTO product_workspace_sources(workspace_id,source_id) VALUES($1,$2)",[workspace,source]);
    for(const index of account===ids.a?[0,1,2,3]:[4]) {
      await owner.query(`INSERT INTO product_public_articles(id,source_id,url,title,excerpt,published_at,countries,content_hash,content_kind)
        VALUES($1,$2,$3,$4,'Original article excerpt for the meeting document.',now()-($5::int*interval '1 hour'),'["MX"]','meeting-test','news')`,
        [articles[index],source,`https://fixture.example/${articles[index]}`,`Mexico meeting article ${index}`,index]);
      await owner.query(`INSERT INTO product_workspace_candidates(workspace_id,article_id,content_hash,policy_key,status,score,reason)
        VALUES($1,$2,'meeting-test',$3,'selected',62,'meeting-test')`,[workspace,articles[index],workspacePolicyKey({id:workspace,homeCountry:"NO",countries:["MX"]})]);
    }
  }
  const reviewBefore=await initializeCurrentReview(ids.a,preferences,"free",items.slice(0,4),app);
  const fingerprint=async()=>{
    const result:Record<string,unknown>={};
    for(const table of ["product_public_articles","product_workspace_candidates","product_workspace_scan_runs","product_usage","product_account_current_review","raw_source_items","processed_items"])
      if((await owner.query("SELECT to_regclass($1) AS table",[`public.${table}`])).rows[0].table)
        result[table]=(await owner.query(`SELECT count(*)::int AS count,md5(string_agg(md5(row_to_json(v)::text),'' ORDER BY md5(row_to_json(v)::text))) AS hash FROM ${table} v`)).rows[0];
    return result;
  };
  const engineBefore=await fingerprint();
  mock.module(moduleAt("src/lib/product/auth.ts"),{namedExports:{getPersonalIdentity:async()=>sessions.getStore()?{subject:sessions.getStore()!.subject}:null}});
  const route=await import("../src/app/api/personal/selections/route");
  const request=(body:unknown,account=ids.a,extra:Record<string,string>={})=>new Request(`${origin}/api/personal/selections`,{method:"PATCH",headers:{origin,"content-type":"application/json","x-selection-account":account,...extra},body:JSON.stringify(body)});
  const read=(subject=subjectA)=>networkAct(async()=>{const response=await inSession(subject,()=>route.GET());assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");return await response.json() as PersonalSelections;});
  const write=(body:unknown,account=ids.a)=>networkAct(()=>inSession(subjectA,()=>route.PATCH(request(body,account))));
  let a=await read();assert.deepEqual(a.meetingBrief,{title:"",date:""});
  const scoped=await app.connect();
  try{await scoped.query("BEGIN");await scoped.query("SELECT set_config('missiondesk.account_id',$1,true)",[ids.a]);
    assert.equal((await scoped.query("SELECT count(*)::int AS count FROM product_account_meeting_briefs")).rows[0].count,0,"Read cannot create an empty document");
  }finally{await scoped.query("ROLLBACK");scoped.release();}
  const details={title:"Veckomöte: Mexiko, handel & säkerhet",date:"2026-11-20"};
  const update={kind:"meeting",details,revision:a.revision};
  assert.equal((await inSession(null,()=>route.PATCH(request(update)))).status,401);
  assert.equal((await write(update,ids.b)).status,409);
  assert.equal((await inSession(subjectA,()=>route.PATCH(request(update,ids.a,{origin:"https://other.example"})))).status,403);
  for(const body of [{...update,accountId:ids.b},{...update,details:{...details,notes:"unexpected"}},{...update,details:{...details,title:"x".repeat(161)}},
    {...update,details:{...details,title:"line\nbreak"}},{...update,details:{...details,date:"2026-02-29"}},{...update,details:{...details,date:"11/20/2026"}},
    {kind:"meeting",move:{itemId:items[0],direction:"sideways"},revision:"0"}])assert.equal((await write(body)).status,400);
  assert.ok(validMeetingDate("2028-02-29"));assert.ok(!validMeetingDate("2026-02-29"));assert.equal(meetingDateLabel(details.date,"en"),"20 November 2026");
  for(const id of items.slice(0,3))assert.equal((await write({kind:"meeting",itemId:id,selected:true})).status,200);
  await write({kind:"priority",itemId:items[0],selected:true});a=await read();
  a=await (await write({...update,revision:a.revision})).json();assert.deepEqual(a.meetingBrief,details);
  const oldRevision=a.revision;
  a=await (await write({kind:"meeting",move:{itemId:items[2],direction:"up"},revision:a.revision})).json();assert.deepEqual(a.meeting,[items[0],items[2],items[1]]);
  assert.equal((await write({...update,revision:oldRevision})).status,409,"Stale metadata cannot overwrite a newer document");
  assert.equal((await write({kind:"meeting",move:{itemId:items[4],direction:"up"},revision:a.revision})).status,404,"Only selected owned articles can move");
  assert.deepEqual(await read(),a,"Reload and new verified session restore title/date/order");
  const b=await read(subjectB);assert.deepEqual(b.meetingBrief,{title:"",date:""});assert.deepEqual(b.meeting,[]);
  const rls=await app.connect();
  try{await rls.query("BEGIN");await rls.query("SELECT set_config('missiondesk.account_id',$1,true)",[ids.b]);
    assert.equal((await rls.query("SELECT * FROM product_account_meeting_briefs WHERE account_id=$1",[ids.a])).rowCount,0);
    assert.equal((await rls.query("UPDATE product_account_meeting_briefs SET title='forged' WHERE account_id=$1",[ids.a])).rowCount,0);
    await assert.rejects(rls.query("INSERT INTO product_account_meeting_briefs(account_id) VALUES($1)",[ids.a]),/row-level security/);
  }finally{await rls.query("ROLLBACK");rls.release();}
  const race=await Promise.all([write({kind:"meeting",move:{itemId:items[2],direction:"down"},revision:a.revision}),write({...update,details:{...details,title:"Concurrent title"},revision:a.revision})]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409],"Concurrent document changes cannot silently replace each other");
  a=await read();a=await (await write({...update,revision:a.revision})).json();

  const materialClient=await app.connect();let material;
  try{await materialClient.query("BEGIN READ ONLY");await materialClient.query("SELECT set_config('missiondesk.account_id',$1,true)",[ids.a]);material=await personalSelectionMaterial(materialClient,ids.a,preferences,"free",items.slice(0,4));}
  finally{await materialClient.query("ROLLBACK");materialClient.release();}
  const byId=new Map(material.map(item=>[item.id,item]));
  const currentOrder=[items[2],items[0],items[1]],feed:PersonalFeed={items:currentOrder.map(id=>byId.get(id)!),currentItems:currentOrder.map(id=>byId.get(id)!),briefings:[],activeSourceCount:1,updates:{},workspacePilot:{connectedSourceIds:[],heldCount:0,attentionNeeded:false}};
  const originalFeed=JSON.stringify(feed);
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:origin});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Event:dom.window.Event,MouseEvent:dom.window.MouseEvent,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const React=await import("react"),{createRoot}=await import("react-dom/client");
  networkAct=async<T>(work:()=>Promise<T>)=>{let value:T;await React.act(async()=>{value=await work();});return value!;};
  mock.module(moduleAt("node_modules/next/link.js"),{defaultExport:({children}:{children:ReactNode})=>React.createElement("span",null,children)});
  mock.module(moduleAt("src/components/product/BrandLogo.tsx"),{namedExports:{BrandLogo:()=>React.createElement("span",null,"MissionDesk")}});
  mock.module(moduleAt("src/components/product/ProductFooter.tsx"),{namedExports:{ProductFooter:()=>null}});
  const {PersonalDashboard}=await import("../src/components/product/PersonalDashboard");
  let session:string|null=subjectA,failSave=false,patches=0,prints=0;
  dom.window.print=()=>{prints++;};
  globalThis.fetch=async(input,init)=>{
    assert.equal(String(input),"/api/personal/selections","No engine, source, feed, search, review or external API calls allowed");
    if(init?.method==="PATCH"){patches++;if(failSave)return new Response("{}",{status:503});return inSession(session,()=>route.PATCH(new Request(`${origin}/api/personal/selections`,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),origin}})));}
    return inSession(session,()=>route.GET());
  };
  const container=dom.window.document.createElement("div");dom.window.document.body.append(container);let root=createRoot(container);
  const render=async(state:PersonalSelections|null,account=ids.a)=>React.act(async()=>root.render(React.createElement(PersonalDashboard,{initialFeed:feed,initialPreferences:preferences,plan:"free",selectionAccountId:account,initialSelections:state})));
  const wait=async(check:()=>boolean)=>{for(let i=0;i<120&&!check();i++)await React.act(async()=>{await new Promise(done=>setTimeout(done,20));});assert.ok(check(),"Client condition did not settle");};
  const click=async(element:Element)=>React.act(async()=>{(element as HTMLElement).click();});
  const tab=(label:string)=>Array.from(container.querySelectorAll("nav button")).find(node=>node.textContent?.includes(label))!;
  const button=(label:string)=>Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(node=>node.textContent===label)!;
  const order=()=>Array.from(container.querySelectorAll("article h3")).map(node=>node.textContent);
  const titles=(ids:readonly string[])=>ids.map(id=>byId.get(id)!.title_original);
  const input=(name:string)=>container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const edit=async(name:string,value:string)=>React.act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value")!.set!.call(input(name),value);input(name).dispatchEvent(new dom.window.Event("input",{bubbles:true}));input(name).dispatchEvent(new dom.window.Event("change",{bubbles:true}));});
  await render(a);assert.deepEqual(order(),titles(currentOrder));await click(tab("Meeting brief"));assert.deepEqual(order(),titles(a.meeting));
  assert.equal(input("meeting-title").value,details.title);assert.equal(input("meeting-date").value,details.date);
  await edit("meeting-title","Planning meeting - Mexico");await edit("meeting-date","2026-12-01");
  assert.ok(button("Print").disabled,"Unsaved details cannot be printed via the action");
  failSave=true;await click(button("Save meeting details"));await wait(()=>!!container.querySelector('[role="alert"]')&&!button("Save meeting details").disabled);
  assert.deepEqual((await read()).meetingBrief,details);assert.equal(input("meeting-title").value,"Planning meeting - Mexico","Failed save preserves the draft");failSave=false;
  await click(button("Save meeting details"));await wait(()=>!button("Print").disabled&&button("Save meeting details").disabled);
  a=await read();assert.deepEqual(a.meetingBrief,{title:"Planning meeting - Mexico",date:"2026-12-01"});
  const beforeMove=[...a.meeting];await click(container.querySelectorAll("article")[1].querySelector('button[aria-label^="Move up:"]')!);
  await wait(()=>!button("Print").disabled&&order()[0]===titles([beforeMove[1]])[0]);a=await read();assert.equal(a.meeting[0],beforeMove[1]);
  failSave=true;const savedOrder=[...a.meeting];await click(container.querySelectorAll("article")[1].querySelector('button[aria-label^="Move up:"]')!);
  await wait(()=>!!container.querySelector('[role="alert"]')&&!button("Print").disabled);assert.deepEqual(order(),titles(savedOrder));assert.deepEqual((await read()).meeting,savedOrder);failSave=false;
  await React.act(async()=>root.unmount());root=createRoot(container);await render(await read());await click(tab("Meeting brief"));
  assert.equal(input("meeting-title").value,a.meetingBrief!.title);assert.equal(input("meeting-date").value,a.meetingBrief!.date);assert.deepEqual(order(),titles(a.meeting));
  session=null;assert.equal((await globalThis.fetch("/api/personal/selections")).status,401);session=subjectB;
  await React.act(async()=>root.unmount());root=createRoot(container);await render(b,ids.b);await click(tab("Meeting brief"));assert.equal(input("meeting-title").value,"");assert.equal(input("meeting-date").value,"");assert.deepEqual(order(),[]);
  session=subjectA;await React.act(async()=>root.unmount());root=createRoot(container);await render(await read());await click(tab("Meeting brief"));assert.deepEqual(order(),titles(a.meeting));
  await click(button("Print"));assert.equal(prints,1);
  assert.equal(container.querySelector('.missiondesk-print-title')!.textContent,a.meetingBrief!.title);
  assert.equal(container.querySelector('.missiondesk-print-meta time')!.getAttribute('dateTime'),a.meetingBrief!.date);
  assert.equal(container.querySelector('.missiondesk-print-meta time')!.textContent,"1 December 2026");
  if(process.env.MISSIONDESK_MEETING_PRINT_HTML)writeFileSync(process.env.MISSIONDESK_MEETING_PRINT_HTML,`<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${container.innerHTML}</body></html>`);
  if(process.env.MISSIONDESK_MEETING_PRINT_EXPECTED)writeFileSync(process.env.MISSIONDESK_MEETING_PRINT_EXPECTED,JSON.stringify({title:a.meetingBrief!.title,date:"1 December 2026",articleTitles:titles(a.meeting)},null,2)+"\n");
  await click(tab("Current signals"));assert.deepEqual(order(),titles(currentOrder),"Meeting order never changes Current signals");
  await click(tab("Prioritized"));assert.deepEqual(order(),titles([items[0]]));
  await React.act(async()=>root.unmount());dom.window.close();
  assert.deepEqual((await read()).priorities,[items[0]]);assert.deepEqual(await getCurrentReview(ids.a,app),reviewBefore);
  assert.equal(JSON.stringify(feed),originalFeed);assert.deepEqual(await fingerprint(),engineBefore);assert.deepEqual(await schema(),oldSchema);
  // Removal prunes old positions; re-added and newly selected articles append at the end.
  await write({kind:"meeting",itemId:a.meeting[0],selected:false});const removed=a.meeting[0];
  await write({kind:"meeting",itemId:removed,selected:true});await write({kind:"meeting",itemId:items[3],selected:true});
  a=await read();assert.deepEqual(a.meeting.slice(-2),[removed,items[3]]);
  const retainedDetails=a.meetingBrief;await write({kind:"meeting",clear:true,revision:a.revision});a=await read();assert.deepEqual(a.meeting,[]);assert.deepEqual(a.meetingBrief,retainedDetails,"Clearing articles does not erase meeting details");
  const report={verifiedAt:new Date().toISOString(),isolatedDatabase:true,accountsIsolated:true,forcedRls:true,titleDateAndOrderPersist:true,reloadAndNewSessionRestore:true,
    actualClientEditing:true,actualClientReordering:true,printActionAndMarkupMatch:true,dateOnlyNoTimezoneShift:true,failedDetailsPreserveDraft:true,failedMoveRollsBack:true,
    staleAndConcurrentChangesRejected:true,removedPositionsPruned:true,newArticlesAppend:true,clearPreservesDetails:true,prioritiesUnchanged:true,currentSignalsOrderUnchanged:true,
    reviewStateUnchanged:true,engineRowsAndExistingSchemaUnchanged:true,patches,
    identityVerification:"Actual React DOM, API/account mapping and PostgreSQL with verified-identity fixtures; no manual Auth0 browser login."};
  if(process.env.MISSIONDESK_MEETING_TEST_REPORT)writeFileSync(process.env.MISSIONDESK_MEETING_TEST_REPORT,JSON.stringify(report,null,2)+"\n");
  console.log("[verify:meeting-brief] Per-account title/date/order, reload/new-session, client editing/reordering/printing, concurrency, rollback, RLS and unchanged Current signals/engine passed.");
}finally {
  globalThis.fetch=savedFetch;mock.restoreAll();hook.deregister();const {getProductPool}=await import("../src/lib/product/store");await getProductPool().end();await app.end();await owner.end();
  for(const key of envKeys)if(savedEnv[key]===undefined)delete process.env[key];else process.env[key]=savedEnv[key];
}
