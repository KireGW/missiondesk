import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import type { IntelligenceItem } from "../src/lib/types";
import { assessWorkspaceText, workspaceRank, workspaceRulesVersion } from "../src/lib/product/workspace-assessment";
import { workspacePolicyKey, type WorkspacePolicy } from "../src/lib/product/workspace-candidates";
import { workspaceArticleToItem, type WorkspaceArticleRow } from "../src/lib/product/workspace-items";
import { selectBalancedWorkspaceItems } from "../src/lib/product/workspace-selection";
import { selectCurrentSignalItems } from "../src/lib/product/current-signals";
import { currentSignalRelevance, orderCurrentSignalItems } from "../src/lib/product/current-signals-order";
import { aggregatePersonalSearchItems, personalSelectionItems } from "../src/lib/product/feed";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/current-signals-2026-11-12.json", import.meta.url), "utf8")) as {
  now: string; policy: WorkspacePolicy; rows: Array<Omit<WorkspaceArticleRow,"published_at"> & {published_at:string}>;
  expectedOriginalIds:string[]; keptThreatId:string; responseId:string; suppressedIds:string[];
};
const baseline = JSON.parse(readFileSync(new URL("./fixtures/current-signals-order-baseline.json", import.meta.url), "utf8")) as {
  assessments: Array<{id:string;assessment:ReturnType<typeof assessWorkspaceText>}>;
};
const contexts = JSON.parse(readFileSync(new URL("./fixtures/current-signals-economic-context.json", import.meta.url), "utf8")) as {
  cases:Array<{title:string;excerpt:string;economicChange:boolean}>;
};
const now = Date.parse(fixture.now);
const rows = fixture.rows.map(row=>({...row,published_at:new Date(row.published_at)}));
const items = rows.map(row=>workspaceArticleToItem(row,fixture.policy));
const sourceIds = new Map(rows.map(row=>[`workspace:${row.id}`,row.source_id!]));
const frozen = JSON.stringify(items);
for (const row of rows) assert.deepEqual(assessWorkspaceText(row.title,row.excerpt,fixture.policy,row.source_id),baseline.assessments.find(entry=>entry.id===row.id)!.assessment,
  "All existing assessment callers must retain their exact pre-change results");
assert.equal(workspaceRulesVersion,"public-rules-v4");
assert.ok(workspacePolicyKey(fixture.policy).startsWith("public-rules-v4:"),"No persistent decision keys change");
const ordered = selectBalancedWorkspaceItems(items,fixture.policy,items.length,now);
assert.deepEqual(ordered.slice(0,30).map(item=>item.id),fixture.expectedOriginalIds,"The original search/retention pool remains unchanged");
const originalThirty = ordered.slice(0,30);
const originalSearch = JSON.stringify(aggregatePersonalSearchItems(originalThirty,[],"Trump"));
const originalSavedSelection = JSON.stringify(personalSelectionItems(originalThirty,{},fixture.expectedOriginalIds));
const existing = selectCurrentSignalItems(ordered,30);
const proposal = selectCurrentSignalItems(orderCurrentSignalItems(ordered,fixture.policy,now,sourceIds),30);
assert.equal(proposal.length,30);
const jalisco = items.find(item=>item.title_original.includes("Nuevo golpe al Cartel Jalisco"))!;
const threat = items.find(item=>item.id===fixture.keptThreatId)!;
const pos = (pool:IntelligenceItem[], id:string)=>pool.findIndex(item=>item.id===id)+1;
assert.ok(pos(proposal,threat.id)>0 && pos(proposal,threat.id)<pos(proposal,jalisco.id),"Fresh tariff threat must precede the Jalisco arrest");
assert.equal(proposal.find(item=>item.id===jalisco.id)!.workspace_relevance,70);
assert.equal(proposal.find(item=>item.id===threat.id)!.workspace_relevance,62);
assert.ok(proposal.some(item=>item.id===fixture.responseId),"Sheinbaum's response survives");
for (const id of fixture.suppressedIds) assert.ok(!proposal.some(item=>item.id===id),"General deduplication remains active");
assert.equal(JSON.stringify(items),frozen,"No source objects, stored scores or selection material mutate");
assert.deepEqual(orderCurrentSignalItems(ordered,fixture.policy,now,sourceIds),orderCurrentSignalItems(ordered,fixture.policy,now,sourceIds));
for (const item of items) {
  const corrected = currentSignalRelevance(item,fixture.policy,sourceIds.get(item.id));
  const { workspace_relevance: oldScore, workspace_relevance_reasons: oldReasons, ...originalFields } = item;
  const { workspace_relevance: newScore, workspace_relevance_reasons: newReasons, ...correctedFields } = corrected;
  assert.deepEqual(correctedFields,originalFields,"Only presentation score and economic-event evidence may differ");
  assert.ok(newScore!<=oldScore! && oldScore!-newScore!<=12,"Remove at most the pre-existing economic-event bonus");
  assert.deepEqual(newReasons?.filter(reason=>reason!=="economic_change"),oldReasons?.filter(reason=>reason!=="economic_change"));
}
// Missing/stale original assessments must be retained rather than guessed.
const stale = {...jalisco,workspace_relevance:1};
assert.equal(currentSignalRelevance(stale,fixture.policy),stale);
const legacy = {...jalisco,workspace_relevance:undefined};
assert.equal(currentSignalRelevance(legacy,fixture.policy),legacy);
assert.equal(JSON.stringify(aggregatePersonalSearchItems(originalThirty,[],"Trump")),originalSearch);
assert.equal(JSON.stringify(personalSelectionItems(originalThirty,{},fixture.expectedOriginalIds)),originalSavedSelection);
const selected = [jalisco.id,threat.id,fixture.responseId,...fixture.suppressedIds];
const retained = Object.fromEntries(originalThirty.map(item=>[item.id,item]));
assert.equal(personalSelectionItems(originalThirty,retained,selected).find(item=>item.id===jalisco.id)?.workspace_relevance,82,"Saved selections continue to see original scores");

const contextResults = contexts.cases.map((test,index)=>{
  const old = assessWorkspaceText(test.title,test.excerpt,fixture.policy);
  const contextual = assessWorkspaceText(test.title,test.excerpt,fixture.policy,undefined,{contextualEconomicEvents:true});
  assert.ok(old.evidence.includes("economic_change"),`Control must exercise an existing event match: ${test.title}`);
  assert.equal(contextual.evidence.includes("economic_change"),test.economicChange,test.title);
  assert.equal(contextual.category,old.category);
  assert.deepEqual(contextual.countries,old.countries);
  assert.deepEqual(contextual.evidence.filter(reason=>reason!=="economic_change"),old.evidence.filter(reason=>reason!=="economic_change"));
  assert.ok(old.score-contextual.score>=0 && old.score-contextual.score<=12,"No unrelated scoring heuristics may change");
  const sample = {...items[0],id:`context-${index}`,title_original:test.title,original_excerpt:test.excerpt,workspace_relevance:old.score,
    workspace_relevance_reasons:old.evidence,category:old.category,geographic_tags:old.countries};
  assert.equal(currentSignalRelevance(sample,fixture.policy).workspace_relevance,contextual.score);
  return {...test,oldScore:old.score,newScore:contextual.score};
});
const changes = ordered.map(item=>({item,corrected:currentSignalRelevance(item,fixture.policy,sourceIds.get(item.id))})).filter(({item,corrected})=>item!==corrected);
const report = {mode:"shadow",reviewedAt:new Date().toISOString(),fixtureTime:fixture.now,candidates:items.length,
  legacyAssessmentsUnchanged:baseline.assessments.length,originalItemsUnchanged:JSON.stringify(items)===frozen,
  persistentRulesVersion:workspaceRulesVersion,syntheticContextCases:contextResults,
  sheinbaumRetained:true,tariffBeforeJalisco:true,
  example:[threat,jalisco].map(item=>({id:item.id,title:item.title_original,oldScore:item.workspace_relevance,newScore:proposal.find(entry=>entry.id===item.id)?.workspace_relevance,
    oldDisplayPosition:pos([...existing].sort((a,b)=>b.workspace_relevance!-a.workspace_relevance!||Date.parse(b.published_at)-Date.parse(a.published_at)),item.id),
    proposedPosition:pos(proposal,item.id),oldAgeAdjustedRank:workspaceRank(item.workspace_relevance!,item.published_at,now),
    newAgeAdjustedRank:workspaceRank(proposal.find(entry=>entry.id===item.id)!.workspace_relevance!,item.published_at,now)})),
  scoreChanges:changes.map(({item,corrected})=>({id:item.id,title:item.title_original,excerpt:item.original_excerpt,oldScore:item.workspace_relevance,newScore:corrected.workspace_relevance,
    oldReasons:item.workspace_relevance_reasons,newReasons:corrected.workspace_relevance_reasons})),
  removedFromCurrent:existing.filter(item=>!proposal.some(entry=>entry.id===item.id)).map(item=>({id:item.id,title:item.title_original})),
  addedToCurrent:proposal.filter(item=>!existing.some(entry=>entry.id===item.id)).map(item=>({id:item.id,title:item.title_original})),
  proposedOrder:proposal.map((item,index)=>({position:index+1,id:item.id,title:item.title_original,score:item.workspace_relevance})),
};
if(process.env.MISSIONDESK_CURRENT_ORDER_REPORT)writeFileSync(process.env.MISSIONDESK_CURRENT_ORDER_REPORT,JSON.stringify(report,null,2)+"\n");
console.log(`[shadow:current-signals-order] ${items.length} unchanged legacy assessments; ${contextResults.length} context cases; tariff #${pos(proposal,threat.id)} before Jalisco #${pos(proposal,jalisco.id)}; Sheinbaum retained; ${changes.length} presentation corrections.`);
