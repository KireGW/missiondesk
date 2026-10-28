import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mock } from "node:test";
import type { IntelligenceItem } from "../src/lib/types";
import { aggregatePersonalSearchItems, personalSelectionItems } from "../src/lib/product/feed";
import { parseWorkspaceSearch, WorkspaceSearchDenied, WorkspaceSearchLimited } from "../src/lib/product/workspace-search";

assert.deepEqual(parseWorkspaceSearch({query:"  Lula  Brasil  "}),{query:"Lula Brasil",homeOnly:false,cursor:null});
assert.deepEqual(parseWorkspaceSearch({query:"  ",homeOnly:true}),{query:"",homeOnly:true,cursor:null},"A home-country search does not require keywords");
assert.deepEqual(parseWorkspaceSearch({query:"lula",homeOnly:true}),{query:"lula",homeOnly:true,cursor:null});
for(const body of [null,[],{}, {query:""},{query:"l"},{query:"a".repeat(121)}, {query:"lula",workspaceId:"other"},
  {query:"lula",days:999},{query:"lula",limit:500},{query:"lula",cursor:{}},{query:"lula",cursor:"invalid"},
  {query:"lula\u0000"},{query:7},{query:"",homeOnly:false},{query:"l",homeOnly:true},
  {query:"lula",homeOnly:"true"},{query:"lula",homeOnly:null},{query:"lula",homeCountry:"SE"}]) assert.equal(parseWorkspaceSearch(body),null);
const cursor=Buffer.from(JSON.stringify({time:"2026-10-27T12:00:00.000Z",id:"a".repeat(64),query:createHash("sha256").update("lula").digest("hex")})).toString("base64url");
assert.ok(parseWorkspaceSearch({query:"lula",cursor}));
assert.equal(parseWorkspaceSearch({query:"another",cursor}),null,"Cursors belong to a specific query");
assert.equal(parseWorkspaceSearch({query:"lula",homeOnly:true,cursor}),null,"An unfiltered cursor cannot be reused for a home-country search");
const homeCursor=Buffer.from(JSON.stringify({time:"2026-10-27T12:00:00.000Z",id:"a".repeat(64),query:createHash("sha256").update(JSON.stringify({query:"lula",homeOnly:true})).digest("hex")})).toString("base64url");
assert.ok(parseWorkspaceSearch({query:"lula",homeOnly:true,cursor:homeCursor}));
assert.equal(parseWorkspaceSearch({query:"lula",homeOnly:false,cursor:homeCursor}),null);
const feed=Array.from({length:30},(_,i)=>({id:`feed:${i}`} as IntelligenceItem));
const held={id:"workspace:held-lula",title_original:"Lula Brasil",workspace_selection:"held"} as IntelligenceItem;
const retained={[held.id]:held};
const priorityIds=[held.id];
const meetingIds=[held.id];
const selected=personalSelectionItems(feed,retained,[...priorityIds,...meetingIds]);
assert.equal(selected.filter(item=>priorityIds.includes(item.id)).length,1,"An off-feed search hit must be available in Prioritized");
assert.equal(selected.filter(item=>meetingIds.includes(item.id)).length,1,"The same hit must also be available in the meeting brief");
assert.equal(personalSelectionItems([],retained,priorityIds)[0],held,"Changing the feed or result page must not lose a selected search hit");
assert.equal(personalSelectionItems(feed,retained,[]).length,30,"Deselection must not publish a search hit into the feed");
assert.equal(personalSelectionItems([held],retained,priorityIds).length,1,"Selected feed/search duplicates must only appear once");
assert.equal(feed.length,30,"Selections must not mutate the current feed");
const remote=Array.from({length:65},(_,i)=>({id:`saved:${i}`,title_original:`Lula ${i}`,source_url:`https://fixture.example/${i}`} as IntelligenceItem));
const local=remote.slice(60).map(item=>({...item,id:`current:${item.id}`,source_url:`${item.source_url}?utm_source=old#article`}));
const first=aggregatePersonalSearchItems(local,remote.slice(0,30),"LULA");
const second=aggregatePersonalSearchItems(local,remote.slice(0,60),"lula");
const all=aggregatePersonalSearchItems(local,remote,"lula");
assert.equal(all.length,65,"Current and stored copies must be deduplicated by canonical URL, not their different IDs");
assert.deepEqual(first.slice(0,30).map(item=>item.id),all.slice(0,30).map(item=>item.id),"Loading later archive pages must not reorder an already shown page");
assert.equal(new Set([...first.slice(0,30),...second.slice(30,60),...all.slice(60)].map(item=>item.id)).size,65,
  "Buffered archive hits must not be dropped at combined page boundaries");
const snippetOnly={id:"current:snippet",title_original:"Different title",original_excerpt:"Lula in a cached original excerpt",source_url:"https://fixture.example/snippet"} as IntelligenceItem;
assert.equal(aggregatePersonalSearchItems([snippetOnly],[],"lula").length,1,"Current-list original excerpts must also be searched");
const norwegian={...snippetOnly,id:"current:norway",original_excerpt:"Lula meets representatives from NORUEGA",source_url:"https://fixture.example/norway"};
const savedNorwegian={...norwegian,id:"saved:norway",source_url:`${norwegian.source_url}?utm_source=rss`};
const secondNorwegian={...norwegian,id:"saved:norge",title_original:"Norske delegation",original_excerpt:"No search keyword here",source_url:"https://fixture.example/norge"};
const falseConnection={...snippetOnly,id:"saved:false",title_original:"Noruegalandia",title_sv:"Lula visits Norge",source_name:"Norway News",source_url:"https://fixture.example/norway-false"};
const swedish={...snippetOnly,id:"saved:sweden",title_original:"Suecia y México",source_url:"https://fixture.example/sweden"};
assert.deepEqual(aggregatePersonalSearchItems([norwegian,snippetOnly],[savedNorwegian,secondNorwegian,falseConnection,swedish],"","NO").map(item=>item.id),
  [norwegian.id,secondNorwegian.id],"The checkbox alone searches current and saved material, with original-source evidence and URL deduplication");
assert.deepEqual(aggregatePersonalSearchItems([norwegian,snippetOnly],[savedNorwegian],"lula","NO").map(item=>item.id),[norwegian.id],
  "Keywords and home-country evidence must both match");
assert.deepEqual(aggregatePersonalSearchItems([],[swedish,secondNorwegian],"","SE").map(item=>item.id),[swedish.id],"Each profile uses its own country");
const homeLocal=local.map(item=>({...item,original_excerpt:"Noruega"}));
const homeRemote=remote.map(item=>({...item,original_excerpt:"Noruega"}));
const allHome=aggregatePersonalSearchItems(homeLocal,homeRemote,"","NO");
assert.equal(allHome.length,65,"Home-only searches are not restricted to the 30-item feed");
assert.deepEqual(aggregatePersonalSearchItems(homeLocal,homeRemote.slice(0,30),"","NO").slice(0,30).map(item=>item.id),allHome.slice(0,30).map(item=>item.id));

let account:{id:string;status:string;plan:string;premiumUntil:string|null}|null=null;
let calls=0;
let failure:Error|undefined;
let expectedInput={query:"lula",homeOnly:false,cursor:null};
mock.module(new URL("../src/lib/product/account.ts",import.meta.url),{namedExports:{getPersonalAccount:async()=>account}});
mock.module(new URL("../src/lib/product/preferences-store.ts",import.meta.url),{namedExports:{getPersonalPreferences:async()=>({homeCountry:"NO"})}});
mock.module(new URL("../src/lib/product/workspace-search.ts",import.meta.url),{namedExports:{parseWorkspaceSearch,WorkspaceSearchDenied,WorkspaceSearchLimited,
  searchWorkspace:async(id:string,home:string,plan:string,input:unknown)=>{
    calls++;assert.equal(id,"trusted-account");assert.equal(home,"NO");assert.equal(plan,"free");assert.deepEqual(input,expectedInput);
    if(failure)throw failure;return {items:[held],nextCursor:null};
  }}});
const route=await import("../src/app/api/personal/search/route");
assert.equal("GET" in route,false);
const keys=["MISSIONDESK_ACCESS_MODE","MISSIONDESK_WORKSPACE_PILOT","APP_BASE_URL"];
const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
const previousFetch=globalThis.fetch;
const request=(body='{"query":"lula"}',origin="http://localhost:3001",type="application/json")=>new Request("http://localhost:3001/api/personal/search",{method:"POST",headers:{origin,"content-type":type},body});
try {
  globalThis.fetch=async()=>{throw new Error("Search must not call external sources or AI");};
  process.env.MISSIONDESK_WORKSPACE_PILOT="true";process.env.APP_BASE_URL="http://localhost:3001";
  for(const mode of ["legacy","invalid"]){process.env.MISSIONDESK_ACCESS_MODE=mode;assert.equal((await route.POST(request())).status,404);}
  process.env.MISSIONDESK_ACCESS_MODE="personal";process.env.MISSIONDESK_WORKSPACE_PILOT="false";assert.equal((await route.POST(request())).status,404);process.env.MISSIONDESK_WORKSPACE_PILOT="true";
  assert.equal((await route.POST(request())).status,401);
  account={id:"trusted-account",status:"suspended",plan:"free",premiumUntil:null};assert.equal((await route.POST(request())).status,403);account.status="active";
  for(const origin of ["","https://other.example","http://localhost:3000"])assert.equal((await route.POST(request(undefined,origin))).status,403);
  assert.equal((await route.POST(request(undefined,undefined,"text/plain"))).status,415);
  assert.equal((await route.POST(request("x".repeat(1025)))).status,413);
  for(const body of ["{invalid","[]","null",'{}','{"query":"lula","workspaceId":"other"}','{"query":"lula","days":30}','{"query":"lula","limit":500}',
    '{"query":"lula","homeCountry":"SE"}','{"query":"lula","homeOnly":"true"}']) assert.equal((await route.POST(request(body))).status,400);
  assert.equal(calls,0);
  const response=await route.POST(request());assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");assert.deepEqual(await response.json(),{items:[held],nextCursor:null});
  for(const query of ["","lula"]) {
    expectedInput={query,homeOnly:true,cursor:null};
    assert.equal((await route.POST(request(JSON.stringify({query,homeOnly:true})))).status,200,"The route passes only a boolean, deriving Norway from the authenticated profile");
  }
  expectedInput={query:"lula",homeOnly:false,cursor:null};
  account.plan="premium";account.premiumUntil="2000-01-01T00:00:00.000Z";assert.equal((await route.POST(request())).status,200,"Expired Premium must not expand the search window");
  failure=new WorkspaceSearchLimited(61);const limited=await route.POST(request());assert.equal(limited.status,429);assert.equal(limited.headers.get("retry-after"),"61");
  failure=new WorkspaceSearchDenied();assert.equal((await route.POST(request())).status,403);
  failure=new Error("Private database detail");const unavailable=await route.POST(request());assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:"search_unavailable"});
} finally {globalThis.fetch=previousFetch;for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];mock.restoreAll();}
console.log("[smoke:workspace-search] Query/home-country/cursor validation, merged home-only and combined searches, auth/CSRF, fixed server-owned scope, rate/private errors and retained selections passed; no external calls.");
