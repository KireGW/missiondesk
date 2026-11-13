import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mock } from "node:test";
import { Pool } from "pg";
import { JSDOM } from "jsdom";
import type { ReactNode } from "react";
import { currentReviewSchemaSql } from "../src/lib/product/current-review-schema";
import { getCurrentReview, initializeCurrentReview } from "../src/lib/product/current-review-store";
import { newCurrentSignalIds, type CurrentReview } from "../src/lib/product/current-review";
import { getPersonalSelections, changePersonalSelection } from "../src/lib/product/selections-store";
import { personalSelectionMaterial } from "../src/lib/product/selection-material";
import { workspacePolicyKey } from "../src/lib/product/workspace-candidates";
import type { PersonalPreferences } from "../src/lib/product/profiles";
import type { PersonalFeed } from "../src/lib/product/feed";

const ownerFile=process.env.MISSIONDESK_SELECTION_TEST_OWNER_URL_FILE,appFile=process.env.MISSIONDESK_SELECTION_TEST_APP_URL_FILE;
if(!ownerFile || !appFile || !process.env.MISSIONDESK_SELECTION_TEST_HOST)throw new Error("Explicit isolated test connections required");
const ownerUrl=readFileSync(ownerFile,"utf8").trim(),appUrl=readFileSync(appFile,"utf8").trim();
for(const url of [ownerUrl,appUrl])assert.equal(new URL(url).hostname,process.env.MISSIONDESK_SELECTION_TEST_HOST);
assert.equal(decodeURIComponent(new URL(appUrl).username),"missiondesk_personal_app");
const owner=new Pool({connectionString:ownerUrl,max:2}),app=new Pool({connectionString:appUrl,max:4});
const envKeys=["DATABASE_URL","MISSIONDESK_ACCESS_MODE","MISSIONDESK_WORKSPACE_PILOT","APP_BASE_URL"];
const savedEnv=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
const origin="http://localhost:3001";
process.env.DATABASE_URL=appUrl;process.env.MISSIONDESK_ACCESS_MODE="personal";process.env.MISSIONDESK_WORKSPACE_PILOT="true";process.env.APP_BASE_URL=origin;
const ids={a:randomUUID(),b:randomUUID(),paused:randomUUID(),wa:randomUUID(),wb:randomUUID()};
const subjectA=`selection-test:review:${ids.a}`,subjectB=`selection-test:review:${ids.b}`;
const articleIds=Array.from({length:6},(_,index)=>createHash("sha256").update(`${ids.a}:${index}`).digest("hex"));
const itemIds=articleIds.map(id=>`workspace:${id}`),base=itemIds.slice(0,2),shown=itemIds.slice(0,4),later=itemIds.slice(0,5);
const preferences:PersonalPreferences={homeCountry:"NO",targetCountry:"MX",language:"en",contentLanguage:"original"};
const sessions=new AsyncLocalStorage<{subject:string;session:string}|null>();
const inSession=<T>(subject:string|null,work:()=>T)=>sessions.run(subject?{subject,session:randomUUID()}:null,work);
const moduleAt=(path:string)=>pathToFileURL(resolve(path));
const hook=registerHooks({resolve(specifier,context,nextResolve){return nextResolve(specifier==="next/link"?"next/link.js":specifier,context);}});
const savedFetch=globalThis.fetch;
let networkAct:<T>(work:()=>Promise<T>)=>Promise<T>=async work=>work();
try {
  assert.ok((await owner.query("SELECT auth_subject FROM product_accounts")).rows.every(row=>row.auth_subject.startsWith("selection-test:")),"Refusing a database containing non-test accounts");
  const schema=async()=>(await owner.query(`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name<>'product_account_current_review' ORDER BY table_name,ordinal_position`)).rows;
  const schemaBefore=await schema();await owner.query(currentReviewSchemaSql);await owner.query(currentReviewSchemaSql);
  assert.deepEqual(await schema(),schemaBefore);
  await owner.query("INSERT INTO product_accounts(id,auth_subject,status) VALUES($1,$2,'active'),($3,$4,'active'),($5,$6,'suspended')",
    [ids.a,subjectA,ids.b,subjectB,ids.paused,`selection-test:review:${ids.paused}`]);
  for(const account of [ids.a,ids.b])await owner.query("INSERT INTO product_account_preferences(account_id,home_country,target_country,language,content_language) VALUES($1,'NO','MX','en','original')",[account]);
  for(const [account,workspace] of [[ids.a,ids.wa],[ids.b,ids.wb]]) {
    const source=`review-${account}`;
    await owner.query("INSERT INTO product_workspaces(id,slug,home_country,countries,enabled) VALUES($1,$2,'NO','[\"MX\"]',true)",[workspace,`review-${workspace}`]);
    await owner.query("INSERT INTO product_workspace_members(workspace_id,account_id,role) VALUES($1,$2,'owner')",[workspace,account]);
    await owner.query("INSERT INTO product_public_sources(id,name,feed_url,article_host,language) VALUES($1,'Review test source','https://fixture.example/feed','fixture.example','en')",[source]);
    await owner.query("INSERT INTO product_workspace_sources(workspace_id,source_id) VALUES($1,$2)",[workspace,source]);
    for(const index of account===ids.a?[0,1,2,3,4]:[5]) {
      await owner.query(`INSERT INTO product_public_articles(id,source_id,url,title,excerpt,published_at,countries,content_hash,content_kind)
        VALUES($1,$2,$3,$4,'Original source excerpt',now()-($5::int*interval '1 day'),'["MX"]','review-test','news')`,
        [articleIds[index],source,`https://fixture.example/${articleIds[index]}`,`Mexico trade announcement ${index}`,index===2?3:0]);
      await owner.query(`INSERT INTO product_workspace_candidates(workspace_id,article_id,content_hash,policy_key,status,score,reason)
        VALUES($1,$2,'review-test',$3,'selected',62,'review-test')`,[workspace,articleIds[index],workspacePolicyKey({id:workspace,homeCountry:"NO",countries:["MX"]})]);
    }
  }
  await changePersonalSelection(ids.a,preferences,"free",{kind:"priority",itemId:base[0],selected:true},app);
  await changePersonalSelection(ids.a,preferences,"free",{kind:"meeting",itemId:base[1],selected:true},app);
  const selectionsBefore=await getPersonalSelections(ids.a,preferences,"free",app);
  const fingerprint=async()=>{
    const result:Record<string,unknown>={};
    for(const table of ["product_public_articles","product_workspace_candidates","product_workspace_scan_runs","product_usage","raw_source_items","processed_items","product_account_selections","product_account_selection_state"])
      if((await owner.query("SELECT to_regclass($1) AS table",[`public.${table}`])).rows[0].table)
        result[table]=(await owner.query(`SELECT count(*)::int AS count,md5(string_agg(md5(row_to_json(v)::text),'' ORDER BY md5(row_to_json(v)::text))) AS hash FROM ${table} v`)).rows[0];
    return result;
  };
  const before=await fingerprint();
  mock.module(moduleAt("src/lib/product/auth.ts"),{namedExports:{getPersonalIdentity:async()=>sessions.getStore()?{subject:sessions.getStore()!.subject}:null}});
  const route=await import("../src/app/api/personal/current-review/route");
  const selectionRoute=await import("../src/app/api/personal/selections/route");
  const request=(body:unknown,account=ids.a,extra:Record<string,string>={})=>new Request(`${origin}/api/personal/current-review`,{method:"POST",
    headers:{origin,"content-type":"application/json","x-review-account":account,...extra},body:typeof body==="string"?body:JSON.stringify(body)});
  const read=(subject=subjectA)=>networkAct(async()=>{const response=await inSession(subject,()=>route.GET());assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");return await response.json() as CurrentReview;});
  const write=(body:unknown,account=ids.a)=>networkAct(()=>inSession(subjectA,()=>route.POST(request(body,account))));
  const initialize={action:"initialize",revision:"0",ids:base};
  for(const mode of ["legacy","invalid"]){process.env.MISSIONDESK_ACCESS_MODE=mode;assert.equal((await route.GET()).status,404);assert.equal((await route.POST(request({}))).status,404);}
  process.env.MISSIONDESK_ACCESS_MODE="personal";
  assert.equal((await inSession(null,()=>route.GET())).status,401);assert.equal((await inSession(null,()=>route.POST(request({})))).status,401);
  assert.equal((await inSession(`selection-test:review:${ids.paused}`,()=>route.GET())).status,403);
  assert.equal((await inSession(subjectA,()=>route.POST(request(initialize,ids.a,{origin:"https://other.example"})))).status,403);
  assert.equal((await inSession(subjectA,()=>route.POST(request(initialize,ids.a,{"content-type":"text/plain"})))).status,415);
  assert.equal((await write(initialize,ids.b)).status,409);
  for(const body of [null,[],{}, {...initialize,accountId:ids.b},{...initialize,ids:[base[0],base[0]]},{...initialize,ids:["javascript:fake"]},
    {...initialize,revision:"1"},{...initialize,ids:Array.from({length:31},(_,i)=>`processed-${i}`)},{action:"acknowledge",revision:"NaN",ids:[]}])assert.equal((await write(body)).status,400);
  assert.equal((await write("x".repeat(16385))).status,413);
  assert.equal((await read()).initialized,false,"Read does not advance the comparison point");
  assert.equal((await write({...initialize,ids:[itemIds[5]]})).status,409,"Another workspace's material cannot establish a baseline");
  let a=await initializeCurrentReview(ids.a,preferences,"free",base,app);
  assert.equal(a.revision,"1");assert.deepEqual(newCurrentSignalIds(base,a),[],"First view is a quiet starting point");
  assert.deepEqual(await (await write({...initialize,ids:shown})).json(),a,"Repeated initialization never acknowledges arrivals");
  assert.deepEqual(newCurrentSignalIds(shown,a),itemIds.slice(2,4),"Both fresh and older newly selected articles are new");
  assert.deepEqual(await read(),a,"Reload/new verified session does not clear markers");
  assert.equal((await read(subjectB)).initialized,false,"B has an independent baseline");
  const b=await initializeCurrentReview(ids.b,preferences,"free",[itemIds[5]],app);
  assert.deepEqual(newCurrentSignalIds([itemIds[5]],b),[]);assert.deepEqual(await read(),a);
  const client=await app.connect();
  try{await client.query("BEGIN");await client.query("SELECT set_config('missiondesk.account_id',$1,true)",[ids.b]);
    assert.equal((await client.query("SELECT * FROM product_account_current_review WHERE account_id=$1",[ids.a])).rowCount,0);
    assert.equal((await client.query("UPDATE product_account_current_review SET baseline_ids='[]' WHERE account_id=$1",[ids.a])).rowCount,0);
    await assert.rejects(client.query("INSERT INTO product_account_current_review(account_id,baseline_ids) VALUES($1,'[]')",[ids.a]),/row-level security/);
  }finally{await client.query("ROLLBACK");client.release();}

  // Exercise the real client, API, account mapping and PostgreSQL; Auth0 verification is a fixture.
  const materialClient=await app.connect();
  let material;
  try{await materialClient.query("BEGIN READ ONLY");await materialClient.query("SELECT set_config('missiondesk.account_id',$1,true)",[ids.a]);
    material=await personalSelectionMaterial(materialClient,ids.a,preferences,"free",later);
  }finally{await materialClient.query("ROLLBACK");materialClient.release();}
  const byId=new Map(material.map(item=>[item.id,item]));
  const ordered=[shown[0],shown[2],shown[1],shown[3]];
  const feed:PersonalFeed={items:ordered.map(id=>byId.get(id)!),currentItems:ordered.map(id=>byId.get(id)!),briefings:[],activeSourceCount:1,updates:{},workspacePilot:{connectedSourceIds:[],heldCount:0,attentionNeeded:false}};
  const inputBefore=JSON.stringify(feed);
  const dom=new JSDOM("<!doctype html><html><body></body></html>",{url:origin});
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,
    Event:dom.window.Event,MouseEvent:dom.window.MouseEvent,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
  const React=await import("react"),{createRoot}=await import("react-dom/client");
  networkAct=async<T>(work:()=>Promise<T>)=>{let value:T;await React.act(async()=>{value=await work();});return value!;};
  mock.module(moduleAt("node_modules/next/link.js"),{defaultExport:({children}:{children:ReactNode})=>React.createElement("span",null,children)});
  mock.module(moduleAt("src/components/product/BrandLogo.tsx"),{namedExports:{BrandLogo:()=>React.createElement("span",null,"MissionDesk")}});
  mock.module(moduleAt("src/components/product/ProductFooter.tsx"),{namedExports:{ProductFooter:()=>null}});
  const {PersonalDashboard}=await import("../src/components/product/PersonalDashboard");
  let session:string|null=subjectA,failSave=false,failLoad=false,posts=0;
  globalThis.fetch=async(input,init)=>{
    const path=String(input);
    if(path==="/api/personal/selections"){assert.notEqual(init?.method,"PATCH","Reviewing cannot modify saved lists");return inSession(session,()=>selectionRoute.GET());}
    assert.equal(path,"/api/personal/current-review","No feed, ranking, source, search or external API calls are allowed");
    if(init?.method==="POST"){posts++;if(failSave)return new Response("{}",{status:503});
      return inSession(session,()=>route.POST(new Request(`${origin}${path}`,{...init,headers:{...Object.fromEntries(new Headers(init.headers)),origin}})));}
    if(failLoad)return new Response("{}",{status:503});return inSession(session,()=>route.GET());
  };
  const container=dom.window.document.createElement("div");dom.window.document.body.append(container);let root=createRoot(container);
  const render=async(review:CurrentReview|null,account=ids.a,inputFeed=feed)=>React.act(async()=>root.render(React.createElement(PersonalDashboard,
    {initialFeed:inputFeed,initialPreferences:preferences,plan:"free",selectionAccountId:account,initialSelections:account===ids.a?selectionsBefore:null,initialCurrentReview:review})));
  const wait=async(check:()=>boolean)=>{for(let i=0;i<100&&!check();i++)await React.act(async()=>{await new Promise(done=>setTimeout(done,20));});assert.ok(check(),"Client condition did not settle");};
  const click=async(element:Element)=>React.act(async()=>{(element as HTMLElement).click();});
  const button=(label:string)=>Array.from(container.querySelectorAll("button")).find(node=>node.textContent===label)!;
  const markers=()=>container.querySelectorAll('[data-current-new="true"]');
  const order=()=>Array.from(container.querySelectorAll("article h3")).map(node=>node.textContent);
  const expectedOrder=ordered.map(id=>byId.get(id)!.title_original);
  await render(a);await wait(()=>markers().length===2);assert.deepEqual(order(),expectedOrder);
  assert.ok(Array.from(markers()).some(node=>node.parentElement?.textContent?.includes("Review test source")),"New marker belongs to actual article metadata");
  const oldArticle=Array.from(container.querySelectorAll("article")).find(node=>node.textContent?.includes("Mexico trade announcement 2"))!;
  assert.ok(oldArticle.querySelector('[data-current-new="true"]'),"An older article entering the selection is also new");
  const dates=Array.from(container.querySelectorAll("article time")).map(node=>node.getAttribute("dateTime"));
  const sort=container.querySelector<HTMLSelectElement>('select:has(option[value="newest"])')!;
  await React.act(async()=>{sort.value="newest";sort.dispatchEvent(new dom.window.Event("change",{bubbles:true}));});
  assert.deepEqual(order(),[...feed.currentItems!].sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)||a.id.localeCompare(b.id)).map(item=>item.title_original));
  await React.act(async()=>{sort.value="relevance";sort.dispatchEvent(new dom.window.Event("change",{bubbles:true}));});assert.deepEqual(order(),expectedOrder);
  await React.act(async()=>root.unmount());root=createRoot(container);a=await read();await render(a);await wait(()=>markers().length===2);
  assert.deepEqual(order(),expectedOrder,"Remount/new session preserves order and markers");
  session=null;assert.equal((await globalThis.fetch("/api/personal/current-review")).status,401);session=subjectB;
  await React.act(async()=>root.unmount());root=createRoot(container);await render(b,ids.b,{...feed,items:[],currentItems:[]});await wait(()=>!!button("Mark selection reviewed"));assert.equal(markers().length,0);
  session=subjectA;await React.act(async()=>root.unmount());root=createRoot(container);await render(await read());await wait(()=>markers().length===2);
  const tab=(label:string)=>Array.from(container.querySelectorAll("nav button")).find(node=>node.textContent?.includes(label))!;
  await click(tab("Prioritized"));assert.equal(markers().length,0);assert.equal(order().length,1);
  await click(tab("Meeting brief"));assert.equal(markers().length,0);assert.equal(order().length,1);
  await click(tab("Current signals"));assert.deepEqual(order(),expectedOrder);
  failSave=true;await click(button("Mark selection reviewed"));await wait(()=>!!container.querySelector('[role="alert"]'));
  assert.equal(markers().length,2);assert.deepEqual(await read(),a,"Failed save cannot clear persistent markers");failSave=false;
  const homeFilter=container.querySelector('section[aria-label] input[type="checkbox"]')!;
  await click(homeFilter);assert.equal(order().length,0,"Fixture has no home-country connection");
  await click(button("Mark selection reviewed"));await wait(()=>markers().length===0&&!button("Mark selection reviewed").hasAttribute("disabled"));
  a=await read();assert.equal(a.revision,"2");assert.deepEqual(a.baselineIds,ordered,"Acknowledge exactly the displayed selection");assert.ok(a.reviewedAt);
  await click(homeFilter);
  assert.deepEqual(order(),expectedOrder);assert.deepEqual(Array.from(container.querySelectorAll("article time")).map(node=>node.getAttribute("dateTime")),dates);
  assert.deepEqual(newCurrentSignalIds(later,a),[itemIds[4]],"A concurrent arrival not displayed at click remains new");
  assert.equal((await write({action:"acknowledge",revision:"1",ids:later})).status,409,"Stale tab cannot erase newer markers");
  assert.deepEqual(await read(),a);
  const concurrent=await networkAct(()=>Promise.all([0,1].map(()=>inSession(subjectA,()=>route.POST(request({action:"acknowledge",revision:a.revision,ids:shown}))))));
  assert.deepEqual(concurrent.map(response=>response.status).sort(),[200,409]);
  a=await read();
  await React.act(async()=>root.unmount());root=createRoot(container);
  await render(a,ids.a,{...feed,items:[...feed.items,byId.get(itemIds[4])!],currentItems:[...feed.currentItems!,byId.get(itemIds[4])!]});await wait(()=>markers().length===1);
  await click(button("Mark selection reviewed"));await wait(()=>markers().length===0&&!button("Mark selection reviewed").hasAttribute("disabled"));
  a=await read();await React.act(async()=>root.unmount());root=createRoot(container);failLoad=true;const beforePosts=posts;
  await render(null);await wait(()=>!!container.querySelector('[role="alert"]'));
  assert.equal(markers().length,0);assert.ok(button("Mark selection reviewed").hasAttribute("disabled"));assert.equal(posts,beforePosts,"Failed initial read never writes empty baseline");
  failLoad=false;await click(button("Reload markers"));await wait(()=>!button("Mark selection reviewed").hasAttribute("disabled"));
  assert.equal(markers().length,0);assert.deepEqual(await read(),a);
  await React.act(async()=>root.unmount());dom.window.close();
  assert.equal(JSON.stringify(feed),inputBefore,"Badges cannot mutate feed material or order");
  assert.deepEqual(await getPersonalSelections(ids.a,preferences,"free",app),selectionsBefore,"Prioritized and Meeting brief remain identical");
  assert.deepEqual(await fingerprint(),before,"No writes to engine, usage, archive or saved selections");assert.deepEqual(await schema(),schemaBefore);
  const report={verifiedAt:new Date().toISOString(),isolatedDatabase:true,firstViewIsBaseline:true,olderArrivalMarked:true,accountIsolation:true,rls:true,
    reloadAndNewSessionPersist:true,explicitAcknowledgementOnly:true,exactDisplayedSelectionAcknowledged:true,concurrentArrivalPreserved:true,staleTabRejected:true,
    failedSavePreservesMarkers:true,failedReadDoesNotWrite:true,articleOrderAndDatesUnchanged:true,inputFeedUnchanged:true,savedSelectionsUnchanged:true,engineRowsAndSchemaUnchanged:true,
    verification:"Actual React DOM, API handlers, account mapping and isolated PostgreSQL with verified-identity fixtures; no manual Auth0 browser login."};
  if(process.env.MISSIONDESK_REVIEW_TEST_REPORT)writeFileSync(process.env.MISSIONDESK_REVIEW_TEST_REPORT,JSON.stringify(report,null,2)+"\n");
  console.log("[verify:current-review] Account isolation, reload/new-session persistence, explicit review, concurrency, failure handling, unchanged order/engine/saved lists passed.");
}finally {
  globalThis.fetch=savedFetch;mock.restoreAll();hook.deregister();
  const {getProductPool}=await import("../src/lib/product/store");await getProductPool().end();await app.end();await owner.end();
  for(const key of envKeys)if(savedEnv[key]===undefined)delete process.env[key];else process.env[key]=savedEnv[key];
}
