import type { IntelligenceCategory, RelevanceReason } from "@/lib/types";
import { personalProfiles, type HomeCountry, type MonitoredCountry } from "@/lib/product/profiles";
import { sourcePlainText } from "@/lib/product/source-text";

export const workspaceRulesVersion = "public-rules-v3";
const normalize = (value: string) => sourcePlainText(value).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/ø/g,"o").replace(/æ/g,"ae");
const patterns=new Map<string,RegExp>();
function occurrences(text: string, term: string) {
  let pattern=patterns.get(term);
  if(!pattern) {
    const escaped=normalize(term).replace(/[.*+?^${}()|[\]\\]/g,"\\$&").replace(/ /g,"\\s+");
    pattern=new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`,"g");patterns.set(term,pattern);
  }
  return [...text.matchAll(pattern)].length;
}
const countryTerms: Record<string, readonly string[]> = {
  MX:["mexico","mexiko","mexican","mexicans","mexicano","mexicana","mexicanos","mexicanas","cdmx","ciudad de mexico","chiapas","oaxaca"],
  NI:["nicaragua","nicaraguan","nicaraguans","nicaraguense","nicaraguenses","managua"],
  CR:["costa rica","costarricense","costarricenses","costa rican"],
  GT:["guatemala","guatemalan","guatemalans","guatemalteco","guatemalteca","guatemaltecos","guatemaltecas"],
  HN:["honduras","honduran","hondurans","hondureno","hondurena","hondurenos","hondurenas","tegucigalpa"],
  SV:["el salvador","salvadoran","salvadorans","salvadoreno","salvadorena","salvadorenos","salvadorenas","san salvador"],
  BZ:["belize","belice","belizean","belizeans","beliceno","belicena","belmopan"],
  NO:personalProfiles.NO.homeTerms, SE:personalProfiles.SE.homeTerms,
  US:["united states","estados unidos","usa"], DE:["germany","alemania","tyskland"],
  BR:["brazil","brasil"], AR:["argentina"], CN:["china","kina"], FR:["france","francia","frankrike"],
  HT:["haiti"], ES:["spain","espana","spania","spanien"],
};
export function detectWorkspaceCountries(title: string, excerpt: string) {
  const text=normalize(`${title} ${excerpt}`).replace(/\bparque espana\b/g,"");
  return Object.entries(countryTerms).filter(([,terms])=>terms.some(term=>occurrences(text,term)>0)).map(([country])=>country);
}

interface TopicRule { category: IntelligenceCategory; terms: readonly string[]; broad?: boolean }
// Specific domains precede broad government/society terms only when evidence scores tie.
const topics: readonly TopicRule[] = [
  {category:"migration",terms:["migracion","migration","migrant","migrants","migrante","migrantes","asilo","asylum","refugiados","refugees","deportacion","deportation","migrasjon","flyktninger","deportaciones","visa","visas","visado","pasaporte","passport","passports","boarding","consular","consulado","travel requirements","entry requirements","requisitos de entrada"]},
  {category:"security",terms:["seguridad","security","sikkerhet","sakerhet","crimen","crime","cartel","carteles","violencia","violence","homicidios","homicidio","murder","narcotrafico","kidnapping","secuestro","military","militar","policia","police","terrorismo","terremoto","earthquake","huracan","hurricane","emergencia","emergency","masacre","massacre","shooting","ambush","troops","ejercito","fuerzas armadas","bus crash","accidente de autobus"]},
  {category:"energy",terms:["energia","energy","energi","petroleo","oil","gas natural","natural gas","renewable","renewables","renovable","renovables","eolica","wind power","electricidad","electricity","hydrogen","hidrogeno","clima","climate","klima","emisiones","emissions","oceano","ocean","oceans","offshore"]},
  {category:"trade",terms:["comercio","trade","handel","arancel","aranceles","tariff","tariffs","tollsatser","tollavgift","export","exports","exportacion","exportaciones","importaciones","importacion","import","imports","tmec","t-mec","usmca","free trade","libre comercio","tratado comercial","supply chain"]},
  {category:"investment_climate",terms:["inversion","inversiones","investment","investments","investering","investeringer","nearshoring","inversion extranjera","foreign investment","inversores","investors","business climate","clima de negocios"]},
  {category:"markets",terms:["bolsa","stock market","mercado bursatil","bond yields","bonos","acciones","stocks","divisas","exchange rate","tipo de cambio","peso mexicano","borsen"]},
  {category:"technology",terms:["tecnologia","technology","teknologi","artificial intelligence","inteligencia artificial","kunstig intelligens","semiconductores","semiconductors","ciberseguridad","cybersecurity","ciberataque","cyberattack","digitalizacion","digitalisation","digitalization","telecomunicaciones"]},
  {category:"foreign_policy",terms:["diplomacia","diplomacy","diplomati","bilateral","embajada","embassy","ambassade","ambassad","ambassador","embajador","embajadora","international court of justice","cancilleria","foreign minister","ministro de exteriores","utenriksminister","utrikesminister","foreign policy","politica exterior","united nations","naciones unidas","peace talks","negociaciones de paz","mediacion","mediation","sanciones","sanctions"]},
  {category:"economy",terms:["economia","economy","economic","economico","economica","economics","okonomi","ekonomi","inflacion","inflation","pib","gdp","presupuesto","budget","budsjett","recaudacion","impuestos","tax","taxes","deuda","debt","desempleo","unemployment","banco central","central bank","production","produccion","agriculture","agricultura","cost of living","fiscal","price increases","pensiones","pension","pensions"]},
  {category:"domestic_politics",terms:["eleccion","elecciones","election","elections","valg","valget","congreso","congress","parlamento","parliament","reforma","reformas","reform","reforms","constitucion","constitution","partido politico","political party","corrupcion","corruption","korrupsjon","corte suprema","supreme court"]},
  {category:"society",terms:["derechos humanos","human rights","menneskerettigheter","manskliga rattigheter","violaciones a derechos","violaciones de derechos","rights violations","libertad de prensa","press freedom","libertad de expresion","freedom of expression","pueblos indigenas","indigenous","urfolk","educacion","education","salud","health","pobreza","poverty","justicia","justice","prision","prison"]},
  {category:"culture_soft_power",terms:["cultura","culture","kultur","cultural","museo","museum","arte","art exhibition","festival","literatura","literature","libro","book","poemario","poetry","cine","cinema","heritage","patrimonio"]},
  {category:"domestic_politics",broad:true,terms:["government","gobierno","regjeringen","regeringen","president","presidente","minister","ministro","ministra","gobernador"]},
];
const events: ReadonlyArray<{reason: RelevanceReason; terms: readonly string[]}> = [
  {reason:"agreement",terms:["agreement","agreements","acuerdo","acuerdos","tratado","treaty","avtale","avtaler","avtal","signs","firman","firma un","suscriben"]},
  {reason:"policy_change",terms:["reforma","reformas","reform","reforms","ley","law","legislation","prohibe","bans","sanctions","sanciones","decreto","decree","elecciones","elections","election","valg","aprobacion","aprueba","aprueban","approves","resignation","renuncia","dimision","must sign","must refuse boarding","new travel rules","travel restrictions","requisitos de entrada"]},
  {reason:"security_event",terms:["detenido","detenidos","arrest","arrested","asesinato","asesinado","murder","murdered","ataque","attack","ambush","shooting","emergencia","emergency","terremoto","earthquake","huracan","hurricane","desaparecidos","missing people","protestas","protests","violaciones a derechos","rights violations","allanamientos"]},
  {reason:"economic_change",terms:["aumenta","aumentan","aumento","cae","caida","sube","crece","growth","surge","rises","falls","cuts","recorte","record","crisis","anuncia inversion","announces investment"]},
  {reason:"regional_impact",terms:["estado de emergencia","state of emergency","emergencia nacional","national emergency","free trade agreement","tratado de libre comercio","masacre","massacre","terremoto","earthquake","huracan","hurricane","crimenes de lesa humanidad","crimes against humanity","cierre de frontera","border closure"]},
];
export function classifyWorkspaceText(title: string, excerpt: string) {
  const heading=normalize(title), body=normalize(excerpt);
  const foodOil=/\b(cooking oil|soybean|olive oil|aceite de cocina|aceite comestible|matolje)\b/.test(`${heading} ${body}`);
  const matches=topics.map(rule=>{
    const terms=rule.category==="energy"&&foodOil?rule.terms.filter(term=>term!=="oil"):rule.terms;
    const titleHits=terms.filter(term=>occurrences(heading,term)>0).length;
    const bodyHits=terms.filter(term=>occurrences(body,term)>0).length;
    return {...rule,titleHits,bodyHits,weight:Math.min(4,titleHits)*4+Math.min(4,bodyHits)};
  }).filter(rule=>rule.weight>0).sort((a,b)=>Number(a.broad??false)-Number(b.broad??false)||b.weight-a.weight);
  const best=matches[0];
  return {category:best?.category??"society",classified:Boolean(best),broad:best?.broad??false,
    titleHits:best?.titleHits??0,bodyHits:best?.bodyHits??0};
}

export function assessWorkspaceText(title: string, excerpt: string, policy: {homeCountry: HomeCountry;countries:readonly MonitoredCountry[]}) {
  const heading=normalize(title), body=normalize(excerpt);
  const titleCountries=detectWorkspaceCountries(title,"");
  const countries=detectWorkspaceCountries(title,excerpt);
  const inTitle=titleCountries.some(country=>policy.countries.includes(country as MonitoredCountry));
  const inRegion=countries.some(country=>policy.countries.includes(country as MonitoredCountry));
  const homeConnection=countries.includes(policy.homeCountry);
  const topic=classifyWorkspaceText(title,excerpt);
  const evidence: RelevanceReason[]=[];
  if(inRegion) evidence.push(inTitle?"country_in_title":"country_in_excerpt");
  if(homeConnection) evidence.push("home_connection");
  if(topic.classified&&!topic.broad) evidence.push("profile_topic");
  const eventMatches=events.filter(event=>event.terms.some(term=>occurrences(heading,term)>0||occurrences(body,term)>0));
  for(const event of eventMatches) evidence.push(event.reason);
  const titleEvents=eventMatches.filter(event=>event.terms.some(term=>occurrences(heading,term)>0)).length;
  const outsideLead=!inTitle&&titleCountries.some(country=>country!==policy.homeCountry&&!policy.countries.includes(country as MonitoredCountry));
  if(outsideLead) evidence.push("incidental_geography");
  const crossBorder=inTitle&&titleCountries.some(country=>country!==policy.homeCountry&&!policy.countries.includes(country as MonitoredCountry))&&["foreign_policy","security","trade","migration"].includes(topic.category);
  if(crossBorder&&!evidence.includes("regional_impact")) evidence.push("regional_impact");
  const lifestyle=/\b(thinking of moving|top of your list|best places to live|travel guide|things to do|shopping guide|guia de viaje|boletos|refill|cosmetics|maquillaje)\b/.test(heading)&&!homeConnection;
  const localRoutine=(/\bmarcha de seguridad\b/.test(heading)||(/\b(perritos|perros|mascotas|dogs|cats|pets)\b/.test(heading)&&!/\b(rabies|rabia|outbreak|brote)\b/.test(`${heading} ${body}`)))&&!homeConnection;
  const historicalOpinion=/\b19\d{2}\b/.test(body)&&(heading.includes(":")||/\b(history|historia|memoria|recuerdo)\b/.test(heading))
    &&!/\b(trial|juicio|sentencia|condena|court|tribunal|corte|investigation|investigacion)\b/.test(heading);
  const lowPriority=(/\b(football|futbol|soccer|horoscope|horoscopo|lottery|loteria|recipe|receta|celebrity|celebridades)\b/.test(`${heading} ${body}`)&&titleEvents===0)||lifestyle||historicalOpinion||localRoutine;
  if(lowPriority) evidence.push("low_priority");
  if(!excerpt.trim()) evidence.push("limited_context");
  const priority: Partial<Record<IntelligenceCategory,number>>=policy.homeCountry==="NO"
    ? {energy:6,trade:4,foreign_policy:4,security:4,society:4,migration:10}
    : {trade:6,technology:6,security:4,foreign_policy:2,migration:10};
  const rights=/\b(derechos humanos|human rights|menneskerettigheter|libertad de prensa|press freedom|pueblos indigenas|indigenous|violaciones a derechos|rights violations)\b/.test(`${heading} ${body}`);
  const topicPoints=topic.broad?6:topic.classified?(topic.titleHits?26:20)+Math.min(6,Math.max(0,topic.titleHits+topic.bodyHits-1)*2):0;
  const score=Math.max(0,Math.min(95,(inTitle?22:inRegion?10:0)+(homeConnection?(titleCountries.includes(policy.homeCountry)?25:16):0)
    +topicPoints+(topic.classified&&!topic.broad?(priority[topic.category]??0):0)+(rights?10:0)+(crossBorder?6:0)+Math.min(24,titleEvents*12+(eventMatches.length-titleEvents)*6)
    -(outsideLead?18:0)-(lowPriority?30:0)-(topic.category==="culture_soft_power"&&!homeConnection?12:0)));
  return {category:topic.category,classified:topic.classified,countries,homeConnection,inRegion,score,evidence};
}

export function workspaceRank(score: number, publishedAt: string, now=Date.now()) {
  return score-Math.min(24,Math.max(0,(now-Date.parse(publishedAt))/21_600_000));
}
// Keep SQL and the in-memory/fixture ordering equivalent: one point per six hours, capped at 24.
export const workspaceRankSql="(c.score - LEAST(24, GREATEST(0, EXTRACT(EPOCH FROM (now() - a.published_at)) / 21600)))";
