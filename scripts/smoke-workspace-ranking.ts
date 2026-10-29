import assert from "node:assert/strict";
import type { IntelligenceCategory } from "../src/lib/types";
import { assessWorkspaceText, classifyWorkspaceText, workspaceRank, workspaceRankSql } from "../src/lib/product/workspace-assessment";
import { evaluateCandidate, publicCandidate, workspacePolicyKey, type WorkspacePolicy } from "../src/lib/product/workspace-candidates";
import { personalRelevanceLevel } from "../src/lib/product/profiles";
import { personalMessages, personalRelevanceExplanation } from "../src/lib/product/messages";
import { workspaceArticleToItem } from "../src/lib/product/workspace-items";

const no: WorkspacePolicy={id:"no",homeCountry:"NO",countries:["MX","NI","CR","GT","HN","SV","BZ"]};
const se: WorkspacePolicy={id:"se",homeCountry:"SE",countries:["MX"]};
const now=Date.parse("2026-10-29T15:00:00Z");
const fixtures: Array<[string,IntelligenceCategory,("selected"|"held")?]> = [
  ["Norway and Mexico sign renewable energy agreement","energy"],
  ["Norge og Mexico signerer avtale om fornybar energi","energy"],
  ["Noruega y Mexico firman acuerdo de energia eolica","energy"],
  ["Mexico and Guatemala sign a free trade agreement","trade"],
  ["Earthquake triggers national emergency in Mexico","security"],
  ["Honduras declares state of emergency after massacre","security"],
  ["Nicaragua grants asylum to migrant families","migration"],
  ["Costa Rica announces investment in new factories","investment_climate"],
  ["Costa Rica develops artificial intelligence technology","technology"],
  ["Norway and Mexico open a cultural festival","culture_soft_power"],
  ["Belize reports GDP growth","economy"],
  ["Mexico stock market rises","markets"],
  ["Mexico congress approves election reform","domestic_politics"],
  ["Guatemala defends human rights and indigenous communities","society"],
  ["Nicaragua police arrest suspects","security"],
  ["Mexico announces sanctions through its foreign minister","foreign_policy"],
  ["Mexico aumenta aranceles al comercio","trade"],
  ["El Salvador desarrolla energia renovable","energy"],
  ["Honduras deportation of migrants","migration"],
  ["Nicaragua debt and inflation rise","economy"],
  ["Sweden and Mexico sign technology agreement","technology"],
  ["Mexico aprueba reforma del congreso","domestic_politics"],
  ["Guatemala educacion y salud","society"],
  ["Belize investment and nearshoring","investment_climate"],
  ["Mexico tipo de cambio y bonos","markets"],
  ["Noruega y Mexico impulsan la mediacion y la diplomacia","foreign_policy"],
  ["Mexico anuncia nuevas exportaciones","trade"],
  ["Mexico budget and taxes change","economy"],
  ["Guatemala opens museum and art exhibition","culture_soft_power","held"],
  ["Costa Rica digitalizacion y telecomunicaciones","technology"],
  ["Mexico hydrogen and offshore energy project","energy"],
  ["Honduras kidnapping and cartel violence","security"],
  ["El Salvador refugees seek asylum","migration"],
  ["Mexico parliament debates constitution","domestic_politics"],
  ["Norway and Mexico renew embassy cooperation","foreign_policy"],
  ["Belize central bank inflation report","economy"],
  ["Nicaragua libertad de prensa y derechos humanos","society"],
  ["Mexico semiconductores y tecnologia","technology"],
  ["Mexico y Noruega firman un tratado comercial","trade"],
  ["Mexico y Estados Unidos acuerdan cierre de frontera por migracion","migration"],
];
assert.equal(fixtures.length,40);
const article=(title:string,excerpt="")=>publicCandidate({sourceId:"fixture",url:"https://fixture.example/a",title,excerpt,publishedAt:new Date(now).toISOString()},"fixture.example");
const scores=new Set<number>();
for(const [title,category,expectedStatus="selected"] of fixtures) {
  const candidate=article(title);
  const assessment=assessWorkspaceText(title,"",no);
  assert.equal(assessment.category,category,title);
  assert.equal(assessment.classified,true,title);
  const decision=evaluateCandidate(candidate,no,now);
  assert.equal(decision.status,expectedStatus,title);
  scores.add(decision.score);
  const expected={no:evaluateCandidate(candidate,no,now),se:evaluateCandidate(candidate,se,now)};
  const before=JSON.stringify(candidate);
  for(const order of [[no,se],[se,no]]) for(const policy of order)
    assert.deepEqual(evaluateCandidate(candidate,policy,now),expected[policy.id as "no"|"se"],"Assessments must be order-independent");
  assert.equal(JSON.stringify(candidate),before,"Workspace assessment must not mutate shared raw material");
}
assert.ok(scores.size>=8,"Meaningfully different evidence must not collapse to one default score");
const high=evaluateCandidate(article(fixtures[0][0]),no,now);
assert.equal(personalRelevanceLevel(high.score),"high");
assert.equal(personalRelevanceLevel(evaluateCandidate(article(fixtures[4][0]),no,now).score),"high","A serious regional event need not mention Norway to rank highly");
const generic=article("Mexico government issues a statement");
assert.equal(evaluateCandidate(generic,no,now).status,"held","A broad government keyword alone must not pass the selection threshold");
assert.ok(high.score>evaluateCandidate(generic,no,now).score);
for(const title of ["Mexico football highlights","Mexico horoscope and lottery","Norway and Mexico celebrity party","Noruegalandia Mexicox trade","Latest international news"])
  assert.equal(evaluateCandidate(article(title),no,now).status,"held",title);
assert.equal(evaluateCandidate(article("Germany trade update","An unrelated footer mentions Mexico."),no,now).status,"held","A passing country mention must not dominate an outside-country headline");
assert.ok(assessWorkspaceText("Mexico trade agreement","",no).score>assessWorkspaceText("Mexico daily update","Discussion of a trade agreement.",no).score,"Headline evidence must outweigh excerpt-only evidence");
const original=article("Norway and Mexico meet today");
assert.equal(evaluateCandidate(original,no,now).status,"selected");
assert.equal(evaluateCandidate(original,se,now).status,"held");
assert.equal(evaluateCandidate({...article("No geographic evidence"),countries:["NO","MX"]},no,now).status,"held","Stored hints must not manufacture evidence absent from original text");
for(const [date,reason] of [[null,"missing_date"],["invalid","missing_date"],[new Date(now+86400000).toISOString(),"future_date"],[new Date(now-8*86400000).toISOString(),"outside_window"]] as const)
  assert.equal(evaluateCandidate({...original,publishedAt:date},no,now).reason,reason);
assert.equal(evaluateCandidate({...original,contentKind:"reference"},no,now).status,"held");
assert.ok(workspacePolicyKey(no).startsWith("public-rules-v3:"));
assert.notEqual(workspacePolicyKey(no),workspacePolicyKey(se));
assert.equal(workspacePolicyKey(no),workspacePolicyKey({...no,countries:[...no.countries].reverse()}));
const older=workspaceRank(88,new Date(now-2*86400000).toISOString(),now);
assert.ok(older>workspaceRank(49,new Date(now).toISOString(),now),"An older important story must beat a fresh routine story before LIMIT");
assert.ok(workspaceRank(60,new Date(now).toISOString(),now)>workspaceRank(60,new Date(now-86400000).toISOString(),now));
assert.equal(workspaceRank(80,new Date(now-10*86400000).toISOString(),now),56,"Age penalty must be bounded");
assert.match(workspaceRankSql,/c\.score.*a\.published_at/);
const row={id:"a",title:fixtures[0][0],excerpt:"Mexico and Norway sign a new agreement.",url:"https://fixture.example/a",name:"Source",language:"en",published_at:new Date(now),countries:[],score:high.score};
const item=workspaceArticleToItem(row,no);
assert.equal(item.category,"energy");
assert.ok(item.geographic_tags.includes("MX"));
assert.equal(item.title_sv,"");
assert.equal(classifyWorkspaceText("Unclear headline","").classified,false);
assert.equal(classifyWorkspaceText("Sarapiqui Bus Crash Toll Rises to Three", "The bus lacked a permit.").category,"security","Death toll is not a trade tariff");
assert.equal(classifyWorkspaceText("Green Valley Oil begins local production of Belize-grown soybean cooking oil", "Soybean cooking oil production.").category,"economy","Food oil must not be classified as petroleum energy");
assert.equal(evaluateCandidate(article("Honduras consolida un Estado dictatorial con reformas penales", "Las reformas permiten allanamientos sin orden judicial."),no,now).status,"selected");
assert.equal(evaluateCandidate(article("Denuncian violaciones a derechos en El Salvador", "Organizaciones denuncian violaciones a derechos humanos."),no,now).status,"selected");
assert.equal(evaluateCandidate(article("Costa Rica pension reforms could change retirement", "Debate on pension reforms."),no,now).status,"selected");
assert.equal(evaluateCandidate(article("Dia de Muertos en Mexico: actividades del festival", "Boletos y actividades del festival."),no,now).status,"held","Routine cultural listings without a home connection must not crowd out mission topics");
assert.equal(evaluateCandidate(article("Thinking of Moving to Costa Rica? Put Puriscal at the Top of Your List", "A pleasant climate and energy for your new life."),no,now).status,"held","Lifestyle climate words must not masquerade as energy-policy coverage");
assert.equal(evaluateCandidate(article("Abraham Nuncio: Entre los desaparecidos de otono", "Los mexicanos recuerdan la masacre de 1968 y su historia."),no,now).status,"held","A historic retrospective must not be ranked as a new security emergency");
assert.equal(evaluateCandidate(article("Guatemala court sentences perpetrators of the 1982 massacre", "A new human rights judgment is announced."),no,now).status,"selected","A current justice event must not be discarded because it mentions a historic atrocity");
const travel=article("Flying to the US Soon? Every Passenger Must Sign a New Form", "In Costa Rica, airlines must refuse boarding to passengers without the new declaration.");
assert.equal(classifyWorkspaceText(travel.title,travel.excerpt).category,"migration");
assert.equal(evaluateCandidate(travel,no,now).status,"selected","Concrete travel requirements in a monitored country are relevant consular coverage");
const park=article("Perritos envenenados en Parque Espana: Fiscalia CDMX investiga", "La Secretaria de Seguridad Ciudadana investiga.");
assert.equal(park.countries.includes("ES"),false,"A local park name is not evidence of a connection to Spain");
assert.equal(evaluateCandidate(park,no,now).status,"held");
assert.equal(evaluateCandidate(article("Lluvia provoca marcha de seguridad en el Metro CDMX", "Los trenes reducen su velocidad."),no,now).status,"held","Routine transit safety wording must not be promoted as a security-policy event");
assert.equal(workspaceArticleToItem({...row,title:"Unclear headline",excerpt:""},no).workspace_topic_unclassified,true);
for(const language of ["sv","nb","en","es"] as const) {
  const messages=personalMessages(language);
  assert.ok(messages.relevanceLevels.high&&messages.relevanceLevels.medium&&messages.relevanceLevels.limited);
  const explanations=personalRelevanceExplanation(item,language,"NO");
  assert.ok(explanations.length>=3);
  assert.ok(explanations.every(reason=>reason&&!reason.includes("undefined")));
  assert.ok(explanations.some(reason=>reason.includes(messages.norway)));
}
console.log(`[smoke:workspace-ranking] 40 curated multilingual cases; ${scores.size} evidence-based scores; category assignment, weak/geographic/noise exclusions, profile isolation, age ordering, versioning and four-language explanations passed without live services.`);
