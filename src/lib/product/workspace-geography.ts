import { personalProfiles } from "@/lib/product/profiles";
import { normalizeWorkspaceText as normalize, workspaceTermCount as occurrences } from "@/lib/product/workspace-text";

// Neutral names only, not the Swedish engine's regional priorities. INEGI's 32-entity catalogue:
// https://www.inegi.org.mx/app/areasgeograficas/
export const mexicoStates = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua",
  "Ciudad de México", "Coahuila", "Colima", "Durango", "Estado de México", "Guanajuato", "Guerrero",
  "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro",
  "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz",
  "Yucatán", "Zacatecas",
] as const;
const ambiguousStates = new Set(["chihuahua", "durango", "guerrero", "hidalgo", "morelos", "sonora", "tabasco"]);
const mexicoPlaces = ["monterrey", "guadalajara", "tijuana", "ciudad juarez", "mexicali", "saltillo", "toluca", "cancun", "culiacan", "hermosillo", "tuxtla gutierrez", "san francisco de campeche", "chetumal", "edomex"];
const mexicoInstitutions = ["banxico", "banco de mexico", "pemex", "petroleos mexicanos", "inegi", "instituto nacional de estadistica y geografia", "comision federal de electricidad", "servicio de administracion tributaria", "banobras", "t-mec", "tmec", "usmca", "sheinbaum", "lopez obrador"];
const mexicanNewsSources = new Set(["el-universal-national", "el-financiero", "la-jornada-politica", "expansion-mexico"]);
const countryTerms: Record<string, readonly string[]> = {
  MX: ["mexico", "mexiko", "mexican", "mexicans", "mexicano", "mexicana", "mexicanos", "mexicanas", "cdmx", "ciudad de mexico"],
  NI: ["nicaragua", "nicaraguan", "nicaraguans", "nicaraguense", "nicaraguenses", "managua"],
  CR: ["costa rica", "costarricense", "costarricenses", "costa rican"],
  GT: ["guatemala", "guatemalan", "guatemalans", "guatemalteco", "guatemalteca", "guatemaltecos", "guatemaltecas"],
  HN: ["honduras", "honduran", "hondurans", "hondureno", "hondurena", "hondurenos", "hondurenas", "tegucigalpa"],
  SV: ["el salvador", "salvadoran", "salvadorans", "salvadoreno", "salvadorena", "salvadorenos", "salvadorenas", "san salvador"],
  BZ: ["belize", "belice", "belizean", "belizeans", "beliceno", "belicena", "belmopan"],
  NO: personalProfiles.NO.homeTerms, SE: personalProfiles.SE.homeTerms,
  US: ["united states", "estados unidos", "usa"], DE: ["germany", "alemania", "tyskland"],
  BR: ["brazil", "brasil"], AR: ["argentina"], CN: ["china", "kina"], FR: ["france", "francia", "frankrike"],
  HT: ["haiti"], ES: ["spain", "espana", "spania", "spanien"],
};

export function workspaceGeography(title: string, excerpt: string, sourceId?: string) {
  const original = `${title} ${excerpt}`;
  const text = normalize(original).replace(/\bparque espana\b/g, "").replace(/\b(new mexico|nuevo mexico)\b/g, "");
  const countries = Object.entries(countryTerms).filter(([, terms]) => terms.some(term => occurrences(text, term) > 0)).map(([country]) => country);
  const directMexico = countries.includes("MX");
  const foreignLead = countries.some(country => !["MX", "NO", "SE"].includes(country));
  const localContext = directMexico || (mexicanNewsSources.has(sourceId ?? "") && !foreignLead);
  const state = mexicoStates.some(name => {
    const term = normalize(name);
    if (!occurrences(text, term)) return false;
    if (!ambiguousStates.has(term)) return true;
    const explicitState = [`estado de ${term}`, `gobierno de ${term}`, `state of ${term}`, `${term} state`].some(phrase => occurrences(text, phrase) > 0);
    if (explicitState) return true;
    if (term === "chihuahua" && /\b(chihuahua (dogs?|puppies)|perros? chihuahua|raza chihuahua)\b/.test(text)) return false;
    if (term === "tabasco" && /\b(tabasco sauce|salsa tabasco)\b/.test(text)) return false;
    if (term === "durango" && /\bdurango[, ]+(colorado|espana|spain)\b/.test(text)) return false;
    const location = ["en", "desde", "hacia", "in", "from"].some(prefix => occurrences(text, `${prefix} ${term}`) > 0)
      || normalize(title).startsWith(`${term}:`);
    return localContext && location;
  });
  const institution = mexicoInstitutions.some(term => occurrences(text, term) > 0);
  const contextualAcronym = localContext && ((/\bCFE\b/.test(original) && /\b(energia|energy|electricidad|electricity|tarifas|inversion)\b/.test(text))
    || (/\b(SHCP|SAT)\b/.test(original) && /\b(impuestos|tax|taxes|fiscal|recaudacion|presupuesto|budget|tributaria)\b/.test(text)));
  const placeText = text.replace(/\bguadalajara[, ]+(espana|spain|castilla la mancha)\b/g, "")
    .replace(/\btoluca[, ]+illinois\b/g, "").replace(/\bsaltillo[, ]+mississippi\b/g, "");
  const localMexico = state || institution || contextualAcronym || mexicoPlaces.some(term => occurrences(placeText, term) > 0);
  if (localMexico && !directMexico) countries.push("MX");
  return { countries, localMexicoEvidence: localMexico && !directMexico };
}

export const detectWorkspaceCountries = (title: string, excerpt: string, sourceId?: string) => workspaceGeography(title, excerpt, sourceId).countries;
