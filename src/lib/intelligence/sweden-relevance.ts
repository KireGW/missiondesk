import type { RawSourceItem } from "@/lib/intelligence/models";

export type RelevanceLevel = "high" | "medium" | "low" | "none";

interface TermGroup {
  label: string;
  patterns: string[];
}

export interface SwedenMexicoRelevanceSignal {
  swedenScoreRaw: number;
  mexicoCrossScoreRaw: number;
  swedenRelevanceScore: number;
  crossRegionalScore: number;
  swedenRelevanceLevel: RelevanceLevel;
  mexicoCrossRelevanceLevel: RelevanceLevel;
  swedishEntities: string[];
  mexicanEntities: string[];
  strategicSectors: string[];
  regionalSignals: string[];
  reasons: string[];
  falsePositiveFlags: string[];
  isSwedishSource: boolean;
  isSwedishMediaSource: boolean;
  isStaticSwedishInstitutionalSource: boolean;
}

const directSwedenTerms: TermGroup[] = [
  { label: "Sweden", patterns: ["sweden", "suecia", "sverige"] },
  { label: "Swedish", patterns: ["swedish", "sueco", "sueca", "suecos", "suecas", "svensk", "svenska"] },
  { label: "Stockholm", patterns: ["stockholm"] },
  { label: "Gothenburg", patterns: ["gothenburg", "goteborg", "göteborg"] },
  { label: "Malmö", patterns: ["malmo", "malmö"] },
];

const swedishInstitutions: TermGroup[] = [
  { label: "Regeringen", patterns: ["regeringen", "government offices of sweden"] },
  { label: "Riksdagen", patterns: ["riksdagen", "swedish parliament"] },
  { label: "Försvarsmakten", patterns: ["forsvarsmakten", "försvarsmakten", "swedish armed forces"] },
  { label: "Säpo", patterns: ["sapo", "säpo", "swedish security service"] },
  { label: "MSB", patterns: ["msb", "myndigheten for samhällsskydd", "myndigheten för samhällsskydd"] },
  { label: "UD", patterns: ["utrikesdepartementet", "foreign ministry of sweden"] },
  { label: "Sida", patterns: ["sida", "swedish international development cooperation agency"] },
  { label: "Business Sweden", patterns: ["business sweden"] },
  { label: "Energimyndigheten", patterns: ["energimyndigheten", "swedish energy agency"] },
  { label: "Finansinspektionen", patterns: ["finansinspektionen"] },
  { label: "Riksbanken", patterns: ["riksbanken", "swedish central bank"] },
];

const swedishCompanies: TermGroup[] = [
  { label: "Ericsson", patterns: ["ericsson"] },
  { label: "Saab", patterns: ["saab"] },
  { label: "Volvo Cars", patterns: ["volvo cars"] },
  { label: "Volvo", patterns: ["volvo"] },
  { label: "Scania", patterns: ["scania"] },
  { label: "Northvolt", patterns: ["northvolt"] },
  { label: "LKAB", patterns: ["lkab"] },
  { label: "Vattenfall", patterns: ["vattenfall"] },
  { label: "SSAB", patterns: ["ssab"] },
  { label: "H&M", patterns: ["h m", "hm"] },
  { label: "IKEA", patterns: ["ikea"] },
  { label: "Spotify", patterns: ["spotify"] },
  { label: "Klarna", patterns: ["klarna"] },
  { label: "Electrolux", patterns: ["electrolux"] },
  { label: "Atlas Copco", patterns: ["atlas copco"] },
  { label: "Sandvik", patterns: ["sandvik"] },
  { label: "SKF", patterns: ["skf"] },
  { label: "SEB", patterns: ["seb"] },
  { label: "Handelsbanken", patterns: ["handelsbanken"] },
  { label: "Swedbank", patterns: ["swedbank"] },
  { label: "Investor", patterns: ["investor ab"] },
  { label: "EQT", patterns: ["eqt"] },
  { label: "Hexagon", patterns: ["hexagon ab"] },
  { label: "Telia", patterns: ["telia"] },
  { label: "Alfa Laval", patterns: ["alfa laval"] },
  { label: "ABB", patterns: ["abb"] },
  { label: "AstraZeneca", patterns: ["astrazeneca", "astra zeneca"] },
  { label: "Tetra Pak", patterns: ["tetra pak"] },
  { label: "Epiroc", patterns: ["epiroc"] },
];

const strategicSectors: TermGroup[] = [
  { label: "telecom", patterns: ["telecom", "telekom", "5g", "network rollout", "red 5g"] },
  { label: "defence", patterns: ["defence", "defense", "forsvar", "försvar", "defensa", "defence procurement"] },
  { label: "aerospace", patterns: ["aerospace", "flygindustri", "aviation"] },
  { label: "steel", patterns: ["steel", "stal", "stål", "green steel", "gront stal", "grönt stål", "acero"] },
  { label: "batteries", patterns: ["battery", "batteries", "batteri", "batterier"] },
  { label: "critical minerals", patterns: ["critical minerals", "kritiska mineraler", "litio", "lithium", "mining technology"] },
  { label: "forestry", patterns: ["forestry", "skog", "forest industry"] },
  { label: "energy", patterns: ["energy", "energia", "energi", "electricity", "electricidad", "nuclear", "hydropower", "vattenkraft"] },
  { label: "fintech", patterns: ["fintech", "payments", "digital payments"] },
  { label: "automotive", patterns: ["automotive", "auto industry", "automotriz", "fordonsindustri", "ev", "electric vehicles"] },
  { label: "shipping", patterns: ["shipping", "logistics", "logistik", "port", "puerto", "supply chain"] },
];

const securityDiplomaticSignals: TermGroup[] = [
  { label: "NATO", patterns: ["nato", "otan"] },
  { label: "Russia", patterns: ["russia", "russian", "ryssland", "rysk", "rusia", "ruso"] },
  { label: "Ukraine support", patterns: ["ukraine support", "stod till ukraina", "stöd till ukraina", "apoyo a ucrania"] },
  { label: "EU sanctions", patterns: ["eu sanctions", "sanktioner", "sanciones"] },
  { label: "China trade", patterns: ["china trade", "chinese imports", "comercio chino", "kinesisk handel"] },
  { label: "cyber threats", patterns: ["cyber", "ciber", "cyberattack", "ciberataque"] },
  { label: "undersea cables", patterns: ["undersea cable", "subsea cable", "undervattenskabel", "cable submarino"] },
  { label: "disinformation", patterns: ["disinformation", "desinformation", "desinformacion", "desinformación"] },
  { label: "defence procurement", patterns: ["defence procurement", "defense procurement", "forsvarsupphandling", "försvarsupphandling"] },
  { label: "GPS jamming", patterns: ["gps jamming", "gps störningar", "gps storningar"] },
];

const nordicBalticSignals: TermGroup[] = [
  { label: "Denmark", patterns: ["denmark", "danmark", "dinamarca"] },
  { label: "Norway", patterns: ["norway", "norge", "noruega"] },
  { label: "Finland", patterns: ["finland", "finlandia"] },
  { label: "Estonia", patterns: ["estonia", "estland"] },
  { label: "Latvia", patterns: ["latvia", "lettland"] },
  { label: "Lithuania", patterns: ["lithuania", "litauen"] },
  { label: "Poland", patterns: ["poland", "polen", "polonia"] },
  { label: "Baltic Sea", patterns: ["baltic sea", "ostersjon", "östersjön", "mar baltico", "mar báltico"] },
  { label: "Arctic", patterns: ["arctic", "arktis", "artico", "ártico"] },
  { label: "Nordics", patterns: ["nordics", "nordic", "norden", "nordiska", "scandinavia", "skandinavien"] },
];

const mexicoSignals: TermGroup[] = [
  { label: "Mexico", patterns: ["mexico", "méxico", "mexiko", "mexican", "mexicana", "mexicano", "mexikansk"] },
  { label: "CDMX", patterns: ["cdmx", "mexico city", "ciudad de mexico", "ciudad de méxico"] },
  { label: "Monterrey", patterns: ["monterrey"] },
  { label: "Guadalajara", patterns: ["guadalajara"] },
  { label: "Claudia Sheinbaum", patterns: ["claudia sheinbaum", "sheinbaum"] },
  { label: "Pemex", patterns: ["pemex"] },
  { label: "CFE", patterns: ["cfe"] },
  { label: "SAT", patterns: ["sat"] },
  { label: "Secretaría de Economía", patterns: ["secretaria de economia", "secretaría de economía"] },
  { label: "Nearshoring", patterns: ["nearshoring"] },
  { label: "USMCA/T-MEC", patterns: ["usmca", "t mec", "tmec"] },
  { label: "Maquiladoras", patterns: ["maquiladora", "maquiladoras"] },
  { label: "Cartels", patterns: ["cartel", "cartels", "cartel", "cártel"] },
  { label: "Nuevo León", patterns: ["nuevo leon", "nuevo león"] },
  { label: "Automotive corridor", patterns: ["automotive corridor", "corredor automotriz"] },
  { label: "Lithium", patterns: ["lithium", "litio"] },
  { label: "Semiconductors", patterns: ["semiconductor", "semiconductors", "semiconductores"] },
];

const mexicoPolicySignals: TermGroup[] = [
  { label: "industrial policy", patterns: ["industrial policy", "politica industrial", "política industrial"] },
  { label: "nearshoring", patterns: ["nearshoring", "supply chain", "leveranskedja", "leveranskedjor"] },
  { label: "investment", patterns: ["investment", "investering", "inversion", "inversión", "manufacturing", "tillverkning"] },
  { label: "tariffs", patterns: ["tariff", "tariffs", "arancel", "aranceles", "tull", "tullar"] },
  { label: "trade", patterns: ["trade", "comercio", "handel", "export", "import"] },
  { label: "energy reform", patterns: ["energy reform", "reforma energetica", "reforma energética", "energilag"] },
  { label: "tax/customs", patterns: ["sat", "tax", "impuesto", "aduana", "customs"] },
  { label: "security", patterns: ["security", "seguridad", "violence", "violencia", "organized crime", "crime", "crimen"] },
  { label: "migration", patterns: ["migration", "migracion", "migración", "migranter", "migrants"] },
  { label: "infrastructure", patterns: ["infrastructure", "infraestructura", "infrastruktur"] },
];

const chinaUsExposureSignals: TermGroup[] = [
  { label: "China exposure", patterns: ["china", "chinese", "kinesisk", "kinesiska", "chino", "china tariffs"] },
  { label: "US exposure", patterns: ["united states", "usa", "u s", "us ", "eeuu", "estados unidos", "tariffs on chinese"] },
];

const swedishMediaSourcePatterns = [
  "dagens industri",
  "svenska dagbladet",
  "dagens nyheter",
  "omni",
  "svt",
  "sveriges radio",
  "affarsvarlden",
  "affärsvärlden",
  "breakit",
];

const swedishInstitutionSourcePatterns = [
  "sweden abroad",
  "regeringen",
  "utrikesdepartementet",
  "business sweden",
  "riksbanken",
];

const staticUrlPatterns = [
  "utlandsmyndigheter",
  "om utlandet",
  "reseinformation",
  "markets americas mexico",
  "sveriges regering utrikesdepartementet",
];

const irrelevantEntertainmentSignals = [
  "fotboll",
  "football",
  "futbol",
  "fútbol",
  "recipe",
  "recept",
  "receta",
  "celebrity",
  "kändis",
  "famoso",
  "horoscope",
  "horoskop",
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s./:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const uniq = <T>(values: T[]) => [...new Set(values)];

function hasTerm(text: string, term: string) {
  const normalized = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${normalized}(?=$|[^a-z0-9])`).test(text);
}

function matches(text: string, groups: TermGroup[]) {
  return groups
    .filter((group) => group.patterns.some((pattern) => hasTerm(text, pattern)))
    .map((group) => group.label);
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => hasTerm(text, term));
}

function levelFromRaw(score: number): RelevanceLevel {
  if (score >= 8) return "high";
  if (score >= 4) return "medium";
  if (score >= 2) return "low";
  return "none";
}

function normalizeRawScore(score: number) {
  if (score <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(score * 10)));
}

function sourceText(item: RawSourceItem) {
  return normalize([item.source_name, item.source_country, item.source_language, item.source_type, item.url].join(" "));
}

function bodyText(item: RawSourceItem) {
  return normalize([item.title_original, item.snippet, item.raw_content].filter(Boolean).join(" "));
}

function isSwedishSource(item: RawSourceItem, source: string) {
  return (
    hasAny(source, ["sverige", "sweden", "suecia", "sv"]) ||
    swedishMediaSourcePatterns.some((pattern) => hasTerm(source, pattern)) ||
    swedishInstitutionSourcePatterns.some((pattern) => hasTerm(source, pattern))
  );
}

function isSwedishMediaSource(item: RawSourceItem, source: string) {
  const mediaName = swedishMediaSourcePatterns.some((pattern) => hasTerm(source, pattern));
  return mediaName || (isSwedishSource(item, source) && item.source_type === "news");
}

function isStaticSwedishInstitutionalSource(item: RawSourceItem, source: string) {
  const institutional =
    ["government", "institution", "advisory"].includes(item.source_type) ||
    swedishInstitutionSourcePatterns.some((pattern) => hasTerm(source, pattern));
  if (!institutional || item.published_at) return false;
  return staticUrlPatterns.some((pattern) => hasTerm(source, pattern));
}

function filteredRegionalSignals(text: string) {
  const regions = matches(text, nordicBalticSignals);
  if (!regions.includes("Nordics")) return regions;

  const hasConcreteRegionalContext = regions.some((region) => region !== "Nordics") ||
    matches(text, securityDiplomaticSignals).length > 0 ||
    hasAny(text, ["region", "regional", "security", "defence", "trade", "nato", "baltic", "arctic"]);

  return hasConcreteRegionalContext ? regions : regions.filter((region) => region !== "Nordics");
}

export function detectSwedenMexicoRelevance(item: RawSourceItem): SwedenMexicoRelevanceSignal {
  const text = bodyText(item);
  const source = sourceText(item);
  const reasons: string[] = [];
  const falsePositiveFlags: string[] = [];

  const hasStockholmSyndrome = hasTerm(text, "stockholm syndrome") || hasTerm(text, "stockholmssyndrom");
  const entertainmentOnly = hasAny(text, irrelevantEntertainmentSignals);

  let direct = matches(text, directSwedenTerms);
  if (hasStockholmSyndrome && direct.length === 1 && direct[0] === "Stockholm") {
    direct = [];
    falsePositiveFlags.push("stockholm_syndrome_metaphor");
  }

  const institutions = matches(text, swedishInstitutions);
  const companies = matches(text, swedishCompanies);
  const sectors = matches(text, strategicSectors);
  const diplomaticSecurity = matches(text, securityDiplomaticSignals);
  const regional = filteredRegionalSignals(text);
  const mexico = matches(text, mexicoSignals);
  const mexicoPolicy = matches(text, mexicoPolicySignals);
  const chinaUsExposure = matches(text, chinaUsExposureSignals);
  const sourceIsSwedish = isSwedishSource(item, source);
  const sourceIsSwedishMedia = isSwedishMediaSource(item, source);
  const staticSwedishInstitutional = isStaticSwedishInstitutionalSource(item, source);

  if (hasTerm(text, "nordic") && regional.length === 0) {
    falsePositiveFlags.push("uncontextual_nordic");
  }

  let swedenScoreRaw = 0;
  let mexicoCrossScoreRaw = 0;

  if (direct.length > 0) {
    swedenScoreRaw += 5;
    reasons.push(`direct_sweden=${direct.join(",")}`);
  }
  if (institutions.length > 0) {
    swedenScoreRaw += 4;
    reasons.push(`swedish_institutions=${institutions.join(",")}`);
  }
  if (companies.length > 0) {
    swedenScoreRaw += 4;
    reasons.push(`swedish_companies=${companies.join(",")}`);
  }
  if (sectors.length > 0) {
    swedenScoreRaw += 2;
    reasons.push(`sectors=${sectors.join(",")}`);
  }
  if (regional.length > 0) {
    swedenScoreRaw += 2;
    reasons.push(`regional=${regional.join(",")}`);
  }
  if (diplomaticSecurity.length > 0) {
    swedenScoreRaw += 3;
    reasons.push(`security_diplomacy=${diplomaticSecurity.join(",")}`);
  }

  const foreignEventCombo =
    companies.length > 0 &&
    (mexico.length > 0 || mexicoPolicy.length > 0 || regional.length > 0 || diplomaticSecurity.length > 0 || sectors.length > 0);
  if (foreignEventCombo) {
    swedenScoreRaw += 5;
    reasons.push("swedish_company_foreign_event_combo");
  }

  const natoRussiaArcticBaltic =
    diplomaticSecurity.includes("Russia") &&
    (diplomaticSecurity.includes("NATO") || regional.includes("Baltic Sea") || regional.includes("Arctic"));
  if (natoRussiaArcticBaltic) {
    swedenScoreRaw += 4;
    reasons.push("baltic_arctic_nato_russia_combo");
  }

  if (companies.length > 0 && mexico.length > 0) {
    mexicoCrossScoreRaw += 6;
    reasons.push("swedish_company_mexico_combo");
  }
  if (companies.length > 0 && mexico.length > 0 && (sectors.length > 0 || mexicoPolicy.length > 0)) {
    mexicoCrossScoreRaw += 3;
    reasons.push("swedish_company_mexico_sector_policy_combo");
  }
  if (mexico.length > 0 && mexicoPolicy.length > 0 && (sectors.length > 0 || companies.length > 0)) {
    mexicoCrossScoreRaw += 5;
    reasons.push(`mexico_policy_swedish_sector=${mexicoPolicy.join(",")}`);
  }
  if (sourceIsSwedish && mexico.length > 0 && (sectors.length > 0 || mexicoPolicy.length > 0 || diplomaticSecurity.length > 0)) {
    mexicoCrossScoreRaw += 4;
    reasons.push("swedish_source_mexico_strategic_topic");
  }
  if (mexico.length > 0 && mexicoPolicy.length > 0) {
    mexicoCrossScoreRaw += 3;
    reasons.push(`mexico_trade_supply_security=${mexicoPolicy.join(",")}`);
  }
  if (mexico.length > 0 && chinaUsExposure.length > 0 && mexicoPolicy.some((signal) => signal === "tariffs" || signal === "trade")) {
    mexicoCrossScoreRaw += 4;
    reasons.push(`mexico_china_us_exposure=${chinaUsExposure.join(",")}`);
  }

  if (sourceIsSwedishMedia && mexico.length > 0) {
    mexicoCrossScoreRaw = Math.max(mexicoCrossScoreRaw, 5);
    swedenScoreRaw = Math.max(swedenScoreRaw, 5);
    reasons.push("swedish_media_mentions_mexico");
  }

  if (sourceIsSwedish && mexico.length > 0 && !sourceIsSwedishMedia && !staticSwedishInstitutional) {
    mexicoCrossScoreRaw = Math.max(mexicoCrossScoreRaw, 3);
    reasons.push("fresh_swedish_source_mentions_mexico");
  }

  if (staticSwedishInstitutional && mexico.length > 0 && mexicoCrossScoreRaw < 8) {
    mexicoCrossScoreRaw = Math.min(mexicoCrossScoreRaw, 2);
    swedenScoreRaw = Math.min(swedenScoreRaw, 3);
    reasons.push("static_swedish_institutional_page_capped");
  }

  if (entertainmentOnly && mexico.length > 0 && companies.length === 0 && mexicoPolicy.length === 0) {
    mexicoCrossScoreRaw = Math.min(mexicoCrossScoreRaw, 2);
    reasons.push("entertainment_or_lifestyle_mexico_capped");
  }

  return {
    swedenScoreRaw,
    mexicoCrossScoreRaw,
    swedenRelevanceScore: normalizeRawScore(swedenScoreRaw),
    crossRegionalScore: normalizeRawScore(mexicoCrossScoreRaw),
    swedenRelevanceLevel: levelFromRaw(swedenScoreRaw),
    mexicoCrossRelevanceLevel: levelFromRaw(mexicoCrossScoreRaw),
    swedishEntities: uniq([...direct, ...institutions, ...companies]),
    mexicanEntities: uniq(mexico),
    strategicSectors: uniq([...sectors, ...mexicoPolicy]),
    regionalSignals: uniq([...regional, ...diplomaticSecurity, ...chinaUsExposure]),
    reasons: uniq(reasons),
    falsePositiveFlags,
    isSwedishSource: sourceIsSwedish,
    isSwedishMediaSource: sourceIsSwedishMedia,
    isStaticSwedishInstitutionalSource: staticSwedishInstitutional,
  };
}

export function compactSwedenMexicoReason(signal: SwedenMexicoRelevanceSignal) {
  const parts = [
    signal.swedishEntities.length > 0 ? `swe_entities=${signal.swedishEntities.slice(0, 4).join(",")}` : "",
    signal.mexicanEntities.length > 0 ? `mex_entities=${signal.mexicanEntities.slice(0, 4).join(",")}` : "",
    signal.strategicSectors.length > 0 ? `sectors=${signal.strategicSectors.slice(0, 4).join(",")}` : "",
    signal.regionalSignals.length > 0 ? `regional=${signal.regionalSignals.slice(0, 4).join(",")}` : "",
    signal.reasons.length > 0 ? `signal=${signal.reasons.slice(0, 3).join(",")}` : "",
    signal.falsePositiveFlags.length > 0 ? `caps=${signal.falsePositiveFlags.join(",")}` : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join("; ") : undefined;
}
