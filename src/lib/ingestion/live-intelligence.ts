import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import { analyzeArticleWithOpenAI, isOpenAiConfigured } from "@/lib/ai/pipeline";
import { normalizeEventDate } from "@/lib/intelligence/event-dates";
import { fetchRssSource } from "@/lib/ingestion/rss";
import type {
  EmbassyConfig,
  GeographicScope,
  IntelligenceCategory,
  IntelligenceItem,
  ProfileMode,
  SourceDefinition,
} from "@/lib/types";

const categoryLabels: Record<IntelligenceCategory, string> = {
  economy: "ekonomi",
  trade: "handel",
  domestic_politics: "inrikespolitik",
  foreign_policy: "utrikespolitik",
  sweden_connection: "Sverigekoppling",
  security: "säkerhet",
  markets: "marknader",
  investment_climate: "investeringsklimat",
  migration: "migration",
  society: "samhälle",
  energy: "energi",
  technology: "teknik",
  culture_soft_power: "kultur och soft power",
};

const categoryKeywords: Array<{
  category: IntelligenceCategory;
  keywords: string[];
}> = [
  {
    category: "migration",
    keywords: ["migr", "frontera", "asilo", "refug", "deport", "border", "visa", "alberg", "caravana", "inm"],
  },
  {
    category: "security",
    keywords: ["seguridad", "violencia", "delito", "crimen", "guardia", "ataque", "homicid", "huachicol", "fgr", "security", "crime"],
  },
  {
    category: "economy",
    keywords: ["econom", "inflación", "inflation", "pib", "gdp", "hacienda", "crecimiento", "growth"],
  },
  {
    category: "markets",
    keywords: ["banxico", "peso", "bolsa", "mercado", "markets", "rate", "tasa", "dólar", "dollar"],
  },
  {
    category: "trade",
    keywords: ["comercio", "export", "import", "tmec", "usmca", "nearshoring", "aduana", "trade"],
  },
  {
    category: "energy",
    keywords: ["energ", "electric", "solar", "pemex", "cfe", "oil", "gas", "renewable"],
  },
  {
    category: "technology",
    keywords: ["tecnolog", "digital", "ciber", "cyber", "semiconductor", "ia ", "ai ", "datos"],
  },
  {
    category: "foreign_policy",
    keywords: ["sre", "canciller", "europa", "unión europea", "eeuu", "estados unidos", "foreign", "diplom"],
  },
  {
    category: "sweden_connection",
    keywords: ["suecia", "sweden", "sueco", "sueca", "nórd", "nordic", "embajada"],
  },
  {
    category: "investment_climate",
    keywords: ["invers", "investment", "empresa", "industr", "planta", "proveedor", "logística"],
  },
  {
    category: "culture_soft_power",
    keywords: ["cultura", "cine", "festival", "universidad", "educación", "culture"],
  },
  {
    category: "society",
    keywords: ["sociedad", "protest", "salud", "educación", "agua", "vivienda", "opinion"],
  },
  {
    category: "domestic_politics",
    keywords: ["senado", "congreso", "diputados", "gobierno", "sheinbaum", "morena", "elección", "reforma", "politic"],
  },
];

const geographyKeywords: Array<{
  id: string;
  region: string;
  terms: string[];
}> = [
  { id: "ciudad-de-mexico", region: "Ciudad de México", terms: ["ciudad de méxico", "cdmx", "mexico city"] },
  { id: "estado-de-mexico", region: "Estado de México", terms: ["estado de méxico", "edomex"] },
  { id: "nuevo-leon", region: "Nuevo León", terms: ["nuevo león", "monterrey"] },
  { id: "jalisco", region: "Jalisco", terms: ["jalisco", "guadalajara"] },
  { id: "queretaro", region: "Querétaro", terms: ["querétaro", "queretaro"] },
  { id: "guanajuato", region: "Guanajuato", terms: ["guanajuato", "león"] },
  { id: "baja-california", region: "Baja California", terms: ["baja california", "tijuana"] },
  { id: "chihuahua", region: "Chihuahua", terms: ["chihuahua", "ciudad juárez", "juárez"] },
  { id: "puebla", region: "Puebla", terms: ["puebla"] },
  { id: "veracruz", region: "Veracruz", terms: ["veracruz"] },
  { id: "yucatan", region: "Yucatán", terms: ["yucatán", "yucatan", "mérida"] },
  { id: "quintana-roo", region: "Quintana Roo", terms: ["quintana roo", "cancún", "cancun"] },
  { id: "sonora", region: "Sonora", terms: ["sonora"] },
  { id: "coahuila", region: "Coahuila", terms: ["coahuila", "saltillo"] },
  { id: "chiapas", region: "Chiapas", terms: ["chiapas", "tapachula"] },
  { id: "tabasco", region: "Tabasco", terms: ["tabasco"] },
  { id: "oaxaca", region: "Oaxaca", terms: ["oaxaca"] },
  { id: "tamaulipas", region: "Tamaulipas", terms: ["tamaulipas", "matamoros", "reynosa"] },
];

const aiEnhancementLimit = Number(process.env.MISSIONDESK_AI_LIMIT ?? 10);

const excludedEditorialTerms = [
  "receta",
  "horóscopo",
  "horoscopo",
  "famos",
  "celebridad",
  "deporte",
  "tigres",
  "diablos rojos",
  "horarios y canales",
  "tercer juego",
  "beisbol",
  "béisbol",
  "futbol",
  "fútbol",
  "partido de futbol",
  "bebida",
  "cocina",
  "streaming",
  "netflix",
  "tiktok",
  "signo zodiacal",
  "maximiliano de habsburgo",
  "emperador",
  "tecate emblema",
  "fandom",
  "misionero",
  "abusar",
];

const diplomaticSignalTerms = [
  "méxico",
  "mexico",
  "gobierno",
  "congreso",
  "senado",
  "seguridad",
  "econom",
  "banxico",
  "empresa",
  "industr",
  "invers",
  "comercio",
  "migr",
  "energ",
  "tecnolog",
  "ciber",
  "europa",
  "estados unidos",
  "eeuu",
  "suecia",
  "sweden",
  "sverige",
  "riksbank",
  "ränta",
  "ranta",
  "penningpolit",
  "inflationen",
  "latam",
  "latin america",
  "arancel",
  "reforma",
  "mercado",
  "peso",
  "violencia",
];

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

const stableHash = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
};

function classifyCategory(source: SourceDefinition, text: string): IntelligenceCategory {
  const normalized = normalize(text);
  const scored = categoryKeywords
    .map(({ category, keywords }) => ({
      category,
      score:
        keywords.filter((keyword) => normalized.includes(normalize(keyword))).length +
        (source.categories.includes(category) ? 0.75 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].category : source.categories[0] ?? "domestic_politics";
}

function isDiplomaticallyRelevant(text: string) {
  const normalized = normalize(text);

  if (excludedEditorialTerms.some((term) => normalized.includes(normalize(term)))) {
    return false;
  }

  return diplomaticSignalTerms.some((term) => normalized.includes(normalize(term)));
}

function classifyProfiles(category: IntelligenceCategory): ProfileMode[] {
  const base: ProfileMode[] = ["daily_overview"];
  if (["trade", "economy", "markets", "investment_climate", "energy", "technology"].includes(category)) {
    base.push("trade_business");
  }
  if (["domestic_politics", "foreign_policy", "society", "migration"].includes(category)) {
    base.push("political_risk");
  }
  if (["security", "migration"].includes(category)) base.push("security");
  if (category === "sweden_connection" || category === "culture_soft_power") {
    base.push("sweden_connection");
  }
  return [...new Set(base)];
}

function classifyGeography(text: string) {
  const normalized = normalize(text);
  const matches = geographyKeywords.filter(({ terms }) =>
    terms.some((term) => normalized.includes(normalize(term))),
  );

  if (matches.length === 0) {
    return {
      geographic_scope: "national" as GeographicScope,
      geographic_tags: [],
      region: "Nationellt",
      subregion: "Liveflöde",
    };
  }

  const first = matches[0];
  return {
    geographic_scope: "administrative_division" as GeographicScope,
    geographic_tags: matches.map((match) => match.id),
    region: first.region,
    subregion: matches.length > 1 ? "Flera delstater" : first.region,
  };
}

function scoreLiveItem(category: IntelligenceCategory, text: string) {
  const normalized = normalize(text);
  const urgentTerms = ["última hora", "breaking", "alerta", "crisis", "ataque", "violencia", "reforma", "banxico", "migración", "migracion"];
  const swedenTerms = ["suecia", "sweden", "sueco", "sueca", "nordic", "nórd", "svensk", "embajada"];
  const urgentBoost = urgentTerms.some((term) => normalized.includes(normalize(term))) ? 12 : 0;
  const swedenBoost = swedenTerms.some((term) => normalized.includes(normalize(term))) ? 22 : 0;

  const categoryBase: Record<IntelligenceCategory, Partial<Record<keyof IntelligenceItem, number>>> = {
    economy: { economic_impact_score: 78, diplomatic_relevance_score: 58 },
    trade: { economic_impact_score: 82, sweden_relevance_score: 68 },
    domestic_politics: { diplomatic_relevance_score: 76, public_attention_score: 68 },
    foreign_policy: { diplomatic_relevance_score: 82, sweden_relevance_score: 60 },
    sweden_connection: { sweden_relevance_score: 92, diplomatic_relevance_score: 72 },
    security: { security_impact_score: 84, urgency_score: 72 },
    markets: { economic_impact_score: 80, urgency_score: 64 },
    investment_climate: { economic_impact_score: 80, sweden_relevance_score: 66 },
    migration: { diplomatic_relevance_score: 74, security_impact_score: 62 },
    society: { public_attention_score: 70, diplomatic_relevance_score: 56 },
    energy: { economic_impact_score: 78, sweden_relevance_score: 64 },
    technology: { economic_impact_score: 68, security_impact_score: 52 },
    culture_soft_power: { sweden_relevance_score: 72, public_attention_score: 50 },
  };

  return {
    urgency_score: Math.min(95, categoryBase[category].urgency_score ?? 50 + urgentBoost),
    diplomatic_relevance_score: Math.min(95, categoryBase[category].diplomatic_relevance_score ?? 58),
    sweden_relevance_score: Math.min(96, (categoryBase[category].sweden_relevance_score ?? 48) + swedenBoost),
    economic_impact_score: Math.min(95, categoryBase[category].economic_impact_score ?? 45),
    security_impact_score: Math.min(95, categoryBase[category].security_impact_score ?? 28),
    public_attention_score: Math.min(92, categoryBase[category].public_attention_score ?? 52),
  };
}

function toLiveIntelligenceItem(
  source: SourceDefinition,
  document: Awaited<ReturnType<typeof fetchRssSource>>[number],
): IntelligenceItem {
  const combinedText = `${document.title} ${document.excerpt ?? ""}`;
  const category = classifyCategory(source, combinedText);
  const geography = classifyGeography(combinedText);
  const scores = scoreLiveItem(category, combinedText);
  const label = categoryLabels[category];
  const publishedAt = document.publishedAt ?? document.retrievedAt;
  const published = new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "short",
  }).format(new Date(publishedAt));

  return {
    id: `live-${source.id}-${stableHash(document.url || document.title)}`,
    title_original: document.title,
    title_sv: `Live: ny signal inom ${label} från ${source.name}`,
    summary_sv:
      `Livehämtad artikel publicerad ${published}. Originalrubrik: “${document.title}”. ` +
      (document.excerpt
        ? `Kort utdrag från källflödet: ${document.excerpt.slice(0, 220)}`
        : "Källflödet gav ingen längre ingress."),
    source_name: source.name,
    source_url: document.url || source.url,
    source_country: source.country,
    source_language: source.language,
    published_at: publishedAt,
    category,
    country: swedenMexicoEmbassyConfig.country,
    region: geography.region,
    subregion: geography.subregion,
    geographic_scope: geography.geographic_scope,
    geographic_tags: geography.geographic_tags,
    ...scores,
    profile_tags: classifyProfiles(category),
    why_it_matters_sv:
      `Detta är en realtidsindikator från ${source.name}. Den bör användas som en bevakningssignal tills AI-översättning, deduplicering och analystolkning är inkopplad.`,
    suggested_talking_points_sv: [
      "Verifiera artikeln mot minst en kompletterande källa innan den används i extern dialog.",
      `Bedöm om signalen bör följas inom profilen ${label} eller lyftas i morgonbriefen.`,
    ],
    original_excerpt: document.excerpt ?? document.title,
    actors: [source.name],
  };
}

async function enhanceWithAi(
  item: IntelligenceItem,
  config: EmbassyConfig,
): Promise<{ item: IntelligenceItem; enhanced: boolean }> {
  try {
    const analysis = await analyzeArticleWithOpenAI(
      {
        title: item.title_original,
        excerpt: item.original_excerpt,
        sourceName: item.source_name,
        sourceCountry: item.source_country,
        sourceLanguage: item.source_language,
        publishedAt: item.published_at,
        sourceUrl: item.source_url,
        preliminaryCategory: item.category,
        preliminaryGeographicTags: item.geographic_tags,
      },
      config,
    );

    if (!analysis) {
      return { item, enhanced: false };
    }

    return {
      enhanced: true,
      item: {
        ...item,
        title_sv: analysis.title_sv,
        summary_sv: analysis.summary_sv,
        category: analysis.category,
        geographic_scope: analysis.geographic_scope,
        geographic_tags:
          analysis.geographic_tags.length > 0
            ? analysis.geographic_tags
            : item.geographic_tags,
        urgency_score: analysis.urgency_score,
        diplomatic_relevance_score: analysis.diplomatic_relevance_score,
        sweden_relevance_score: analysis.sweden_relevance_score,
        economic_impact_score: analysis.economic_impact_score,
        security_impact_score: analysis.security_impact_score,
        public_attention_score: analysis.public_attention_score,
        profile_tags: analysis.profile_tags,
        why_it_matters_sv: analysis.why_it_matters_sv,
        suggested_talking_points_sv: analysis.suggested_talking_points_sv,
        event_date: normalizeEventDate(analysis.event_date) ?? item.event_date,
        risk_sv: analysis.risk_sv ?? item.risk_sv,
        opportunity_sv: analysis.opportunity_sv ?? item.opportunity_sv,
        actors: [...(item.actors ?? []), "AI-bearbetad"],
      },
    };
  } catch {
    return { item, enhanced: false };
  }
}

async function enhanceItemsWithAi(items: IntelligenceItem[], config: EmbassyConfig) {
  if (!isOpenAiConfigured() || aiEnhancementLimit <= 0) {
    return { items, enhancedCount: 0 };
  }

  const enhancedResults = await Promise.all(
    items.slice(0, aiEnhancementLimit).map((item) => enhanceWithAi(item, config)),
  );

  return {
    items: [
      ...enhancedResults.map((result) => result.item),
      ...items.slice(aiEnhancementLimit),
    ],
    enhancedCount: enhancedResults.filter((result) => result.enhanced).length,
  };
}

export async function fetchLiveIntelligence(
  config: EmbassyConfig = swedenMexicoEmbassyConfig,
  managedSources?: SourceDefinition[],
  options: { enhanceWithAi?: boolean } = {},
) {
  const isRssRetrievalSource = (source: SourceDefinition) => {
    if (source.retrieval?.primary) return source.retrieval.primary === "rss";
    if (source.retrievalMethod) return source.retrievalMethod === "rss";
    if (source.type === "rss") return true;

    try {
      const url = new URL(source.url);
      const text = `${url.pathname} ${url.search}`.toLowerCase();
      return (
        /\brss\b/.test(text) ||
        /\batom\b/.test(text) ||
        /\bfeed\b/.test(text) ||
        /outboundfeeds/.test(text) ||
        /format=rss/.test(text) ||
        /\/xml\b/.test(text) ||
        /\.xml($|\?)/.test(`${url.pathname}${url.search}`)
      );
    } catch {
      return /\b(rss|atom|feed)\b|\.xml($|\?)/i.test(source.url);
    }
  };
  const liveSources = (managedSources ?? config.sources).filter(
    (source) => source.enabled && isRssRetrievalSource(source),
  );

  const results = await Promise.allSettled(
    liveSources.map(async (source) => {
      const documents = await fetchRssSource(source, { limit: 15 });
      return documents
        .filter((document) =>
          isDiplomaticallyRelevant(`${document.title} ${document.excerpt ?? ""}`),
        )
        .map((document) => toLiveIntelligenceItem(source, document));
    }),
  );

  const rawItems = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    .slice(0, 35);

  const shouldEnhanceWithAi = options.enhanceWithAi ?? false;
  const { items, enhancedCount } = shouldEnhanceWithAi
    ? await enhanceItemsWithAi(rawItems, config)
    : { items: rawItems, enhancedCount: 0 };

  const errors = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ source: liveSources[index]?.name ?? "Okänd källa", message: result.reason instanceof Error ? result.reason.message : "Okänt fel" }]
      : [],
  );

  return {
    items,
    summary: {
      fetchedAt: new Date().toISOString(),
      itemCount: items.length,
      sourceCount: liveSources.length,
      aiEnabled: shouldEnhanceWithAi && isOpenAiConfigured(),
      aiEnhancedCount: enhancedCount,
      errors,
    },
  };
}
