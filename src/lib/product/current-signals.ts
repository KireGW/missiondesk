import type { IntelligenceItem } from "@/lib/types";
import { canonicalSignalUrl } from "@/lib/product/workspace-selection";
import { normalizeWorkspaceText } from "@/lib/product/workspace-text";

export type CurrentSignalsMode = "shadow" | "apply" | "off";
export interface CurrentSignalDecision {
  id: string;
  representativeId: string;
  reason: "same_url" | "same_development";
  wordSimilarity: number;
  headlineSimilarity: number;
}
export interface CurrentSignalsAnalysis {
  items: IntelligenceItem[];
  proposedItems: IntelligenceItem[];
  decisions: CurrentSignalDecision[];
}

type Stage = "denial" | "response" | "withdrawal" | "implementation" | "forecast" | "decision" | "threat" | "arrest" | "release" | "announcement" | "unknown";
const stageRules: Array<[Stage, RegExp]> = [
  ["denial", /\b(?:niega|nego|desmient\w*|desmint\w*|descart\w*|denies|denied|refutes?|avviser|avvisar|fornekar|benekter|refuses?|refused|cannot)\b|\b(?:won|doesn|didn|can)['’]t\b|\b(?:no|not|never|nunca|ikke|inte)\s+(?:aument\w*|duplic\w*|apro\w*|sub\w*|recort\w*|anunci\w*|amenaz\w*|rais\w*|increas\w*|approv\w*|cuts?|announc\w*|threat\w*|godkann\w*|pagrip\w*|arrest\w*)\b|\b(?:godkann\w*|pagrip\w*|steng\w*|vedt\w*)\s+(?:inte|ikke)\b/],
  ["response", /\b(?:respond\w*|respuesta|replic\w*|reaccion\w*|replies|reply|response|condemns?|condemned|svarar|svarer|svarade|reager\w*|fordom\w*)\b/],
  ["withdrawal", /\b(?:retir\w*|cancel\w*|suspend\w*|withdraw\w*|revers\w*|revoke\w*|avbryt\w*|trekker|aterkall\w*)\b/],
  ["implementation", /\b(?:implement\w*|aplic\w*|impus\w*|impon\w*|impos\w*|genomfor\w*|iverksett\w*)\b|\bentr\w*\s+en\s+vigor\b|\b(?:takes?|took) effect\b/],
  ["forecast", /\b(?:preve\w*|pronostic\w*|forecast\w*|predict\w*|expects?|expected|prognos\w*|forvent\w*)\b/],
  ["decision", /\b(?:aprueb\w*|aprob\w*|ratific\w*|approv\w*|adopts?|adopted|vedtar|vedtok|godkann\w*|beslutar)\b/],
  ["threat", /\b(?:amenaz\w*|threat\w*|hotar|hotade|truer|truet)\b/],
  ["arrest", /\b(?:detenid\w*|detencion|arrest\w*|grip\w*|pagrip\w*)\b/],
  ["release", /\b(?:liber\w*|released?|friges|frigiv\w*)\b/],
  ["announcement", /\b(?:anunci\w*|announc\w*|kunngjor\w*|meddel\w*)\b/],
];
const increase = /\b(?:aument\w*|duplic\w*|aceler\w*|sube|subio|alza|rais\w*|increas\w*|hoj\w*|oker|okte)\b/;
const decrease = /\b(?:recort\w*|reduc\w*|baja|bajo|cuts?|lower\w*|decreas\w*|sank\w*|kutt\w*)\b/;
const stop = new Set(("a al ante bajo con contra de del desde durante el en entre es esta este estos estas fue ha hasta la las lo los mas o para pero por que se sin sobre su sus un una uno unos unas y " +
  "an and are as at be been by for from has have in is it its of on or s that the their this to was were will with " +
  "av att den det de en ett for fran i med och om pa som till ar " +
  "at da den det eller en er et fra i med og om pa som til " +
  "si no while after before following says said dice dijo bien hoy today latest nuevo nueva nuevos nuevas").split(/\s+/));
const nonNames = new Set(("inflacion inflation sismo terremoto earthquake temblor nuevo nueva new latest despues continua retomara " +
  "indice precios consumidor index consumer price central bank banco minister ministerio police senate senado government gobierno president presidente ciudad city national nacional " +
  "three two one cuatro cinco seis siete ocho nueve diez once doce una dos tres " +
  "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre january february march april may june july august september october november december").split(/\s+/));
const writtenNumbers: Record<string, Record<string, string>> = {
  es: { cero:"0", uno:"1", una:"1", dos:"2", tres:"3", cuatro:"4", cinco:"5", seis:"6", siete:"7", ocho:"8", nueve:"9", diez:"10", once:"11", doce:"12" },
  en: { zero:"0", one:"1", two:"2", three:"3", four:"4", five:"5", six:"6", seven:"7", eight:"8", nine:"9", ten:"10", eleven:"11", twelve:"12" },
  sv: { noll:"0", ett:"1", tva:"2", tre:"3", fyra:"4", fem:"5", sex:"6", sju:"7", atta:"8", nio:"9", tio:"10" },
  nb: { null:"0", ett:"1", to:"2", tre:"3", fire:"4", fem:"5", seks:"6", sju:"7", atte:"8", ni:"9", ti:"10" },
};
const months = /\b(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|january|february|march|april|may|june|july|august|september|october|november|december|januari?|februari?|mars|maj|mai|juni|juli|augusti?|oktober|desember)\b/g;
const words = (text: string) => text.match(/[\p{L}\p{N}]+/gu) ?? [];
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(value => b.has(value));
function stage(text: string): Stage { return stageRules.find(([, pattern]) => pattern.test(text))?.[0] ?? "unknown"; }

function stem(token: string, language: string) {
  // Generic action families normalize inflections and common headline wording.
  if (increase.test(token)) return "action_increase";
  if (decrease.test(token)) return "action_decrease";
  if (/^(?:detiene|detener|detengan|fren\w*|halts?|halted|stops?|stopped)$/.test(token)) return "action_halt";
  const action = stage(token);
  if (action !== "unknown") return `action_${action}`;
  if (token.length < 5) return token;
  const endings = language === "es" ? /(?:amientos|imientos|aciones|acion|mente|ando|iendo|ados|adas|idos|idas|aria|aron|eran|ar|er|ir|es|s)$/
    : language === "en" ? /(?:ing|ers|ed|es|s)$/ : /(?:hetene|heter|heten|ende|arna|erna|ene|are|er|en|et|ar|or|s)$/;
  let result = token.replace(endings, "");
  if (language === "es" && result.length > 5) result = result.replace(/[aeo]$/, "");
  return result.length >= 4 ? result : token;
}
function grams(text: string) {
  const result = new Set<string>();
  for (let i = 0; i < text.length - 2; i++) result.add(text.slice(i, i + 3));
  return result;
}
function dice(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  return 2 * [...a].filter(value => b.has(value)).length / (a.size + b.size);
}
function facts(text: string, language: string) {
  const numbered = text.replace(/\b[\p{L}]+\b/gu, word => writtenNumbers[language]?.[word] ?? word);
  // Include the adjacent unit/noun, including unfamiliar units. A changed unit
  // must not disappear just because its number is unchanged.
  const values = [...numbered.matchAll(/([$€£]\s*)?\b(\d+(?:[.,]\d+)?)(?:\s*(%|[a-z]+))?/g)]
    .map(([, currency, value, unit]) => `${currency ?? ""}${value}${unit && !stop.has(unit) ? unit : ""}`);
  const timing = text.match(/\b(?:manana|ayer|tomorrow|yesterday)\b|\b(?:plazo de|antes del?|a partir de|deadline|effective from)\b[^.!?;]{0,45}/g) ?? [];
  return new Set([...values, ...timing, ...(text.match(months) ?? [])].map(value => value.replace(/\s+/g, "").replace(/,(?=\d)/g, ".")));
}
interface Profile {
  item: IntelligenceItem; url: string; language: string; time: number; countries: Set<string>;
  tokens: Set<string>; headline: Set<string>; names: Set<string>; stage: Stage; direction: string; facts: Set<string>; developments: Set<string>;
}
function profile(item: IntelligenceItem): Profile {
  const language = item.source_language === "no" ? "nb" : item.source_language;
  const headline = normalizeWorkspaceText(item.title_original ?? "");
  const comparisonHeadline = headline.replace(/:\s*[‘“"].*$/, "");
  const excerpt = normalizeWorkspaceText(item.original_excerpt ?? "");
  const text = `${headline} ${excerpt}`;
  const countries = new Set(item.geographic_tags ?? []);
  const countryWords = new Set([...countries].flatMap(code => {
    try { return words(normalizeWorkspaceText(new Intl.DisplayNames([language], { type: "region" }).of(code) ?? code)); }
    catch { return [code.toLowerCase()]; }
  }));
  // Drop a promotional lead only when the text after the colon contains the actual action.
  const colon = headline.indexOf(":");
  const focusStart = colon >= 0 && stage(headline.slice(0, colon)) === "unknown" && (stage(headline.slice(colon + 1)) !== "unknown" || increase.test(headline.slice(colon + 1)) || decrease.test(headline.slice(colon + 1))) ? colon + 1 : 0;
  const originalFocus = (item.title_original ?? "").slice(focusStart);
  const names = new Set([...originalFocus.matchAll(/(?:^|[^\p{L}\p{N}])([\p{Lu}][\p{L}\p{N}.-]*)/gu)].map(match => normalizeWorkspaceText(match[1]).replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(name => name.length > 1 && !stop.has(name) && !nonNames.has(name) && !countryWords.has(name) && !countries.has(name.toUpperCase()) && stage(name) === "unknown" && !increase.test(name) && !decrease.test(name)));
  return { item, url: canonicalSignalUrl(item), language, time: Date.parse(item.published_at), countries,
    tokens: new Set(words(comparisonHeadline).filter(word => word.length > 2 && !/^\d/.test(word) && !stop.has(word)).map(word => stem(word, language))),
    headline: grams(words(headline).join(" ")), names,
    stage: stage(headline) === "unknown" ? stage(excerpt) : stage(headline),
    direction: `${increase.test(headline) ? "+" : ""}${decrease.test(headline) ? "-" : ""}`, facts: facts(text, language),
    developments: new Set([
      ...stageRules.filter(([kind, pattern]) => ["denial", "response", "withdrawal", "implementation", "arrest", "release"].includes(kind) && pattern.test(text)).map(([kind]) => kind),
      ...(/\b(?:acuerdo|agreement|avtal|avtale)\b/.test(text) ? ["agreement"] : []),
      ...(/\b(?:duplica|aumenta|subio|raised|increased|hojer|okte)\b/.test(headline) ? ["realized_increase"] : []),
    ]) };
}

function compare(a: Profile, b: Profile, weights: Map<string, number>) {
  if (a.language !== b.language || !["es", "en", "sv", "nb"].includes(a.language) || !Number.isFinite(a.time) || !Number.isFinite(b.time)
    || Math.abs(a.time - b.time) > 24 * 3_600_000 || !a.countries.size || !sameSet(a.countries, b.countries)
    || a.item.content_kind === "reference" || b.item.content_kind === "reference" || a.stage !== b.stage || a.direction !== b.direction
    || !sameSet(a.facts, b.facts) || !sameSet(a.names, b.names) || !sameSet(a.developments, b.developments)) return null;
  // Fix comparison orientation so fuzzy matching is independent of article order.
  if (a.tokens.size > b.tokens.size || (a.tokens.size === b.tokens.size
    && [...a.tokens].sort().join(" ").localeCompare([...b.tokens].sort().join(" ")) > 0)) [a, b] = [b, a];
  const weight = (word: string) => weights.get(word) ?? 1;
  const totalA = [...a.tokens].reduce((sum, word) => sum + weight(word), 0);
  const totalB = [...b.tokens].reduce((sum, word) => sum + weight(word), 0);
  const available = new Set(b.tokens);
  let intersection = 0, matches = 0;
  for (const word of [...a.tokens].sort((x, y) => Number(b.tokens.has(y)) - Number(b.tokens.has(x)) || weight(y) - weight(x) || x.localeCompare(y))) {
    let match = available.has(word) ? word : undefined;
    if (!match && word.length >= 6) match = [...available].sort().find(other => other.length >= 6
      && Math.min(word.length, other.length) / Math.max(word.length, other.length) >= 0.75 && dice(grams(word), grams(other)) >= 0.8);
    if (match) { intersection += (weight(word) + weight(match)) / 2; matches++; available.delete(match); }
  }
  const wordSimilarity = totalA + totalB ? 2 * intersection / (totalA + totalB) : 0;
  const headlineSimilarity = dice(a.headline, b.headline);
  // Every content word in the shorter headline must be accounted for. This keeps
  // a shared actor/topic from hiding a different object or development.
  if (matches < 5 || matches !== Math.min(a.tokens.size, b.tokens.size) || headlineSimilarity < 0.50) return null;
  if (!a.names.size && !a.facts.size && (wordSimilarity < 0.9 || matches < 7)) return null;
  return { wordSimilarity, headlineSimilarity };
}

/** Stateless, offline shadow/apply analysis. Original objects, order and source decisions are never mutated. */
export function analyzeCurrentSignals(orderedItems: readonly IntelligenceItem[], limit: number, mode: CurrentSignalsMode = "shadow"): CurrentSignalsAnalysis {
  if (mode === "off") {
    const urls = new Set<string>();
    const items = orderedItems.filter(item => {
      const url = canonicalSignalUrl(item);
      if (urls.has(url)) return false;
      urls.add(url);
      return true;
    }).slice(0, Math.max(0, limit));
    return { items, proposedItems: items, decisions: [] };
  }
  const profiles = orderedItems.map(profile);
  const documentFrequency = new Map<string, number>();
  for (const entry of profiles) for (const token of entry.tokens) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  const weights = new Map([...documentFrequency].map(([token, count]) => [token, 1 + Math.log((profiles.length + 1) / (count + 1))]));
  const groups: Profile[][] = [];
  const representatives: IntelligenceItem[] = [];
  const urls = new Map<string, Profile>();
  const decisions: CurrentSignalDecision[] = [];
  const baseline: IntelligenceItem[] = [];
  const baselineUrls = new Set<string>();
  for (const entry of profiles) {
    if (!baselineUrls.has(entry.url)) { baseline.push(entry.item); baselineUrls.add(entry.url); }
    const exact = urls.get(entry.url);
    if (exact) { decisions.push({ id: entry.item.id, representativeId: exact.item.id, reason: "same_url", wordSimilarity: 1, headlineSimilarity: 1 }); continue; }
    // Complete-link checks prevent A~B~C chains from swallowing a distinct development.
    const group = groups.find(members => members.every(member => compare(member, entry, weights)));
    if (group) {
      const similarity = compare(group[0], entry, weights)!;
      decisions.push({ id: entry.item.id, representativeId: group[0].item.id, reason: "same_development", ...similarity });
      group.push(entry);
    } else { groups.push([entry]); representatives.push(entry.item); }
    urls.set(entry.url, group?.[0] ?? entry);
  }
  const proposedItems = representatives.slice(0, Math.max(0, limit));
  return { items: mode === "apply" ? proposedItems : baseline.slice(0, Math.max(0, limit)), proposedItems, decisions };
}

/** Only Current signals consumes this result; search and saved selections use the original feed.items. */
export function selectCurrentSignalItems(orderedItems: readonly IntelligenceItem[], limit: number): IntelligenceItem[] {
  return analyzeCurrentSignals(orderedItems, limit, "apply").items;
}
