import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mock } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import type { PersonalFeed } from "../src/lib/product/feed";
import type { PersonalPreferences } from "../src/lib/product/profiles";
import type { WorkspacePolicy } from "../src/lib/product/workspace-candidates";
import { workspaceArticleToItem, type WorkspaceArticleRow } from "../src/lib/product/workspace-items";
import { selectBalancedWorkspaceItems } from "../src/lib/product/workspace-selection";
import { orderCurrentSignalItems } from "../src/lib/product/current-signals-order";
import { selectCurrentSignalItems } from "../src/lib/product/current-signals";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/current-signals-2026-11-12.json",import.meta.url),"utf8")) as {
  now:string;policy:WorkspacePolicy;rows:Array<Omit<WorkspaceArticleRow,"published_at">&{published_at:string}>;responseId:string;keptThreatId:string;suppressedIds:string[];
};
const now = Date.parse(fixture.now);
const items = fixture.rows.map(row=>workspaceArticleToItem({...row,published_at:new Date(row.published_at)},fixture.policy));
const ordered = selectBalancedWorkspaceItems(items,fixture.policy,items.length,now);
const sourceIds = new Map(fixture.rows.map(row=>[`workspace:${row.id}`,row.source_id!]));
const current = selectCurrentSignalItems(orderCurrentSignalItems(ordered,fixture.policy,now,sourceIds),30);
const preferences:PersonalPreferences = {homeCountry:"NO",targetCountry:"MX",language:"en",contentLanguage:"original"};
const feed:PersonalFeed = {items:ordered.slice(0,30),currentItems:current,briefings:[],activeSourceCount:12,updates:{},updatedAt:fixture.now,
  workspacePilot:{connectedSourceIds:[],heldCount:0,attentionNeeded:false}};
const selectedIds = feed.items.map(item=>item.id);
let view = "signals", sort = "relevance";
const originalFetch = globalThis.fetch;
const hook = registerHooks({resolve(specifier,context,nextResolve){return nextResolve(specifier==="next/link"?"next/link.js":specifier,context);}});
const moduleAt = (path:string)=>pathToFileURL(resolve(path));
try {
  globalThis.fetch = async()=>{throw new Error("Rendering must not call external services");};
  // Seed real component state for each view; execute its actual row filtering/sort.
  mock.module("react",{namedExports:{...React,useState:(initial:unknown)=>React.useState(
    initial==="signals" ? view : Array.isArray(initial)&&!initial.length ? selectedIds :
      initial && typeof initial==="object" && "sort" in initial && "homeOnly" in initial ? {...initial,sort} : initial)}});
  mock.module(moduleAt("node_modules/next/link.js"),{defaultExport:({children}: {children:React.ReactNode})=>React.createElement("span",null,children)});
  mock.module(moduleAt("src/components/product/BrandLogo.tsx"),{namedExports:{BrandLogo:()=>React.createElement("span",null,"MissionDesk")}});
  mock.module(moduleAt("src/components/product/ProductFooter.tsx"),{namedExports:{ProductFooter:()=>null}});
  const {PersonalDashboard} = await import("../src/components/product/PersonalDashboard");
  function render(input:PersonalFeed) {
    const $=load(renderToStaticMarkup(React.createElement(PersonalDashboard,{initialFeed:input,initialPreferences:preferences,plan:"free"})));
    return $("article h3 a").map((_,node)=>$(node).text()).get();
  }
  const expected = (pool:typeof items)=>pool.map(item=>item.title_original);
  const results=[];
  view="signals";sort="relevance";
  assert.deepEqual(render(feed),expected(current),"Default Current signals must preserve the exact server order");
  results.push({view,sort,serverOrderPreserved:true,count:current.length});
  sort="newest";
  assert.deepEqual(render(feed),expected([...current].sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at)||a.id.localeCompare(b.id))),"Newest remains chronological");
  results.push({view,sort,chronological:true,count:current.length});
  sort="relevance";
  const legacyOrder=[...feed.items].sort((a,b)=>b.workspace_relevance!-a.workspace_relevance!||Date.parse(b.published_at)-Date.parse(a.published_at)||a.id.localeCompare(b.id));
  for (view of ["prioritized","meeting"]) {
    assert.deepEqual(render(feed),expected(legacyOrder),"Saved views retain their existing original-material sorting");
    results.push({view,sort,originalOrderPreserved:true,count:feed.items.length});
  }
  view="signals";
  const legacyFeed = {...feed,currentItems:undefined,workspacePilot:undefined};
  assert.deepEqual(render(legacyFeed),expected(legacyOrder),"Non-workspace legacy dashboard behavior is unchanged");
  results.push({view:"legacy-signals",sort,originalOrderPreserved:true,count:feed.items.length});
  if(process.env.MISSIONDESK_CURRENT_ORDER_UI_REPORT)writeFileSync(process.env.MISSIONDESK_CURRENT_ORDER_UI_REPORT,JSON.stringify(results,null,2)+"\n");
  console.log("[smoke:current-signals-order-ui] Real dashboard rendering: server order, newest, Prioritized, Meeting brief and legacy sorting passed.");
} finally {globalThis.fetch=originalFetch;mock.restoreAll();hook.deregister();}
