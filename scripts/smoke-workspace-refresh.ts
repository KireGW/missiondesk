import assert from "node:assert/strict";
import { mock } from "node:test";
import { workspaceSources } from "../src/lib/product/workspace-pilot-sources";
import { getProfileSourceCatalog } from "../src/lib/product/source-catalog";
import { referencePageHash, parsePilotFeed, fetchPilotFeed } from "../src/lib/product/workspace-ingestion";
import { evaluateCandidate } from "../src/lib/product/workspace-candidates";

assert.equal(workspaceSources.length,33);
assert.deepEqual(new Set(workspaceSources.map(s=>s.id)),new Set(getProfileSourceCatalog("NO").sources.filter(s=>s.publication!=="premium_locked").map(s=>s.id)));
assert.equal(workspaceSources.filter(s=>s.mode==="rss").length,13);
assert.equal(workspaceSources.filter(s=>s.mode==="page").length,12);
assert.equal(workspaceSources.filter(s=>s.mode==="paused").length,8);
for(const s of workspaceSources) assert.equal(new URL(s.feedUrl).protocol,"https:");
const body="Official public travel information about the countries monitored by this mission. ".repeat(3);
assert.equal(referencePageHash(`<html><title>Advice</title><nav>one</nav><main>${body}</main><script>one()</script></html>`),referencePageHash(`<html><title>Advice</title><nav>two</nav><main>${body}</main><script>two()</script></html>`));
assert.notEqual(referencePageHash(`<main>${body}</main>`),referencePageHash(`<main>${body}Changed advice</main>`));
assert.throws(()=>referencePageHash("<html><title>Just a moment...</title><main>Challenge</main></html>"));
assert.throws(()=>referencePageHash("<html><main>Empty</main></html>"));
const government=workspaceSources.find(s=>s.id==="no-mx-ud-news")!;
const calendar=parsePilotFeed(`<rss><channel><item><title>Norge Mexico minister</title><link>https://${government.host}/no/dep/kalender/event/</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`,government).items[0];
assert.equal(calendar.contentKind,"reference");
assert.equal(evaluateCandidate(calendar,{id:"fixture",homeCountry:"NO",countries:["MX"]}).status,"held");
assert.equal(parsePilotFeed(`<rss><channel><item><title>Mexico trade</title><link>https://${government.host}/no/aktuelt/test/</link><description><![CDATA[<!DOCTYPE html><p>Mexico trade</p>]]></description></item></channel></rss>`,government).items[0].excerpt,"Mexico trade");
assert.throws(()=>parsePilotFeed('<!DOCTYPE rss [<!ENTITY external SYSTEM "file:///etc/passwd">]><rss><channel/></rss>',government));
const fetchBefore=globalThis.fetch;
try {
  let redirects=0;
  globalThis.fetch=async()=>{redirects++;return new Response(null,{status:302,headers:{Location:"https://untrusted.example/"}});};
  await assert.rejects(()=>fetchPilotFeed(government),/Cross-host redirect denied/);
  assert.equal(redirects,1);
  globalThis.fetch=async()=>new Response(new Uint8Array(2_000_001));
  await assert.rejects(()=>fetchPilotFeed(government),/2 MB/);
} finally {globalThis.fetch=fetchBefore;}

let account:{id:string;status:string}|null=null;
let calls=0;
let failure:Error|undefined;
class Denied extends Error {}
mock.module(new URL("../src/lib/product/account.ts",import.meta.url),{namedExports:{getPersonalAccount:async()=>account}});
mock.module(new URL("../src/lib/product/preferences-store.ts",import.meta.url),{namedExports:{getPersonalPreferences:async()=>({homeCountry:"NO"})}});
mock.module(new URL("../src/lib/product/workspace-refresh.ts",import.meta.url),{namedExports:{WorkspaceRefreshDenied:Denied,
  refreshWorkspaceStep:async(id:string,country:string)=>{calls++;assert.equal(id,"trusted-account");assert.equal(country,"NO");if(failure)throw failure;return {state:"progress",processed:1,total:25,partial:false};}}});
const route=await import("../src/app/api/personal/feed/refresh/route");
assert.equal("GET" in route,false,"GET must never start a scan");
const keys=["MISSIONDESK_ACCESS_MODE","MISSIONDESK_WORKSPACE_PILOT","MISSIONDESK_WORKSPACE_REFRESH","APP_BASE_URL"];
const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
const request=(body="{}",origin="http://localhost:3001",type="application/json")=>new Request("http://localhost:3001/api/personal/feed/refresh",{method:"POST",headers:{origin,"content-type":type},body});
try {
  process.env.MISSIONDESK_WORKSPACE_PILOT="true";process.env.MISSIONDESK_WORKSPACE_REFRESH="true";process.env.APP_BASE_URL="http://localhost:3001";
  for(const mode of ["legacy","invalid"]){process.env.MISSIONDESK_ACCESS_MODE=mode;assert.equal((await route.POST(request())).status,404);}
  process.env.MISSIONDESK_ACCESS_MODE="personal";
  process.env.MISSIONDESK_WORKSPACE_REFRESH="false";assert.equal((await route.POST(request())).status,404);process.env.MISSIONDESK_WORKSPACE_REFRESH="true";
  assert.equal((await route.POST(request())).status,401);
  account={id:"trusted-account",status:"suspended"};assert.equal((await route.POST(request())).status,403);account.status="active";
  for(const origin of ["","https://other.example","http://localhost:3000"]) assert.equal((await route.POST(request("{}",origin))).status,403);
  assert.equal((await route.POST(request("{}",undefined,"text/plain"))).status,415);
  assert.equal((await route.POST(request("x".repeat(129)))).status,413);
  for(const body of ["{invalid","[]","null",'{"workspaceId":"other"}','{"force":true}','{"url":"https://untrusted.example"}']) assert.equal((await route.POST(request(body))).status,400);
  assert.equal(calls,0,"Rejected requests must not reach the scan worker");
  const response=await route.POST(request());assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"private, no-store");
  assert.deepEqual(await response.json(),{state:"progress",processed:1,total:25,partial:false});
  failure=new Denied();assert.equal((await route.POST(request())).status,403);
  failure=new Error("Private database detail");const unavailable=await route.POST(request());assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:"refresh_unavailable"});
} finally {for(const key of keys) if(saved[key]===undefined) delete process.env[key];else process.env[key]=saved[key];mock.restoreAll();}
console.log("[smoke:workspace-refresh] All 33 non-premium entries accounted for; reference hashes, calendar exclusion, redirect/size boundaries, feature gates, auth, CSRF, input isolation and private errors passed. No paid services used.");
