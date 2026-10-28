import type { HomeCountry, PersonalLanguage, PersonalPreferences } from "@/lib/product/profiles";
import { mexicoPublication } from "@/lib/product/profiles";
import { defaultSources } from "@/lib/sources/default-sources";

type Localized = Readonly<Record<PersonalLanguage, string>>;
export type ProfileSourceGroup = "baseline" | "norway" | "mexico" | "social";
export interface ProfileSourceProposal {
  id: string;
  name: string;
  url: string;
  language: string;
  group: ProfileSourceGroup;
  kind: "news" | "advisory" | "reference" | "social";
  publication: "existing" | "proposed" | "premium_locked";
  purpose: Localized;
  review: Localized;
  evidenceUrl?: string;
  reviewedOn?: string;
  // Deliberately not a SourceDefinition: proposals cannot be passed to an ingestion adapter.
  discoveredFeedUrl?: string;
}

const reviewedOn = "2026-10-27";
const baselineSources: readonly ProfileSourceProposal[] = mexicoPublication.sourceIds.map((id) => {
  const source = defaultSources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Missing publication source: ${id}`);
  return {
    id, name: source.name, url: source.url, language: source.language, group: "baseline", kind: "news", publication: "existing",
    purpose: { sv: "Mexikanska nyheter inom det befintliga publiceringsurvalet.", nb: "Nyheter om Mexico i det eksisterende publiseringsutvalget." },
    review: { sv: "Ingår i personlägets fem tillåtna källor. Detta är inte en ny kontroll av RSS-hälsa eller publiceringsrättigheter.", nb: "Inngår i personvisningens fem tillatte kilder. Dette er ikke en ny kontroll av RSS-status eller publiseringsrettigheter." },
  };
});

const norwegianProposals: readonly ProfileSourceProposal[] = [
  {
    id: "no-mx-embassy-news", name: "Norges ambassade i Mexico", url: "https://www.norway.no/es/mexico/noruega-mexico/news/",
    language: "es", group: "norway", kind: "news", publication: "proposed", reviewedOn,
    evidenceUrl: "https://www.norway.no/es/mexico",
    purpose: { sv: "Bilaterala relationer, ambassadens aktiviteter och norsk närvaro.", nb: "Bilaterale forbindelser, ambassadens aktiviteter og norsk tilstedeværelse." },
    review: { sv: "Officiell nyhetssida verifierad via ambassadens webbplats. Ambassaden täcker även Centralamerika; Mexikokoppling måste kontrolleras i originalartikeln före publicering.", nb: "Offisiell nyhetsside bekreftet via ambassadens nettsted. Ambassaden dekker også Mellom-Amerika; tilknytning til Mexico må kontrolleres i originalartikkelen før publisering." },
  },
  {
    id: "no-mx-ud-news", name: "Utenriksdepartementet / Regjeringen.no", url: "https://www.regjeringen.no/no/aktuelt/rss/id2581966/",
    discoveredFeedUrl: "https://www.regjeringen.no/no/rss/Rss/2581966/",
    language: "nb", group: "norway", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Norsk utrikespolitik med uttrycklig Mexikokoppling.", nb: "Norsk utenrikspolitikk med uttrykkelig tilknytning til Mexico." },
    review: { sv: "RSS svarade HTTP 200 och kunde XML-tolkas, men det är ett brett regeringsflöde med bland annat kalenderposter. Departement, innehållstyp, Mexikofilter och faktiska publiceringsdatum måste verifieras före aktivering.", nb: "RSS svarte HTTP 200 og kunne XML-tolkes, men dette er en bred regjeringsstrøm med blant annet kalenderoppføringer. Departement, innholdstype, Mexico-filter og faktiske publiseringsdatoer må verifiseres før aktivering." },
  },
  {
    id: "no-mx-ud-advisory", name: "UD: Mexico – reiseinformasjon",
    url: "https://www.regjeringen.no/no/tema/utenrikssaker/reiseinformasjon/velg-land/reiseinfo_mexico/id2416296/",
    language: "nb", group: "norway", kind: "advisory", publication: "proposed", reviewedOn,
    purpose: { sv: "Officiell konsulär information och förändringar i reserekommendationer.", nb: "Offisiell konsulær informasjon og endringer i reiseinformasjonen." },
    review: { sv: "Officiell Mexikosida verifierad. Bevaka ändringar och sidans uppdateringsdatum; innehållet ska inte återpubliceras som en ny artikel vid varje kontroll.", nb: "Offisiell Mexico-side bekreftet. Overvåk endringer og sidens oppdateringsdato; innholdet skal ikke publiseres som en ny artikkel ved hver kontroll." },
  },
  {
    id: "no-mx-ssb-trade", name: "SSB: Utenrikshandel med varer",
    url: "https://www.ssb.no/utenriksokonomi/utenrikshandel/statistikk/utenrikshandel-med-varer",
    language: "nb", group: "norway", kind: "reference", publication: "proposed", reviewedOn,
    purpose: { sv: "Norsk handel med Mexiko, uppdelad efter land och varugrupp.", nb: "Norsk handel med Mexico, fordelt på land og varegruppe." },
    review: { sv: "Officiell statistik verifierad. En framtida datakoppling måste välja Mexiko i landdimensionen och ange statistikperiod; totalsiffror för hela världen är inte bilaterala siffror.", nb: "Offisiell statistikk bekreftet. En fremtidig datakobling må velge Mexico i landdimensjonen og angi statistikkperiode; globale totaltall er ikke bilaterale tall." },
  },
  {
    id: "no-mx-efta", name: "EFTA: Mexico", url: "https://www.efta.int/trade-relations/free-trade-network/mexico",
    language: "en", group: "norway", kind: "reference", publication: "proposed", reviewedOn,
    purpose: { sv: "EFTA–Mexiko: handel, avtalsram och marknadstillträde.", nb: "EFTA–Mexico: handel, avtaleramme og markedsadgang." },
    review: { sv: "Officiell Mexikosida verifierad. Referensmaterial, inte ett löpande nyhetsflöde. Avtalsdatum får inte förväxlas med publiceringsdatum för en ny signal.", nb: "Offisiell Mexico-side bekreftet. Referansemateriale, ikke en løpende nyhetsstrøm. Avtaledatoer må ikke forveksles med publiseringsdato for et nytt signal." },
  },
  {
    id: "no-mx-innovation", name: "Innovasjon Norge", url: "https://www.innovasjonnorge.no/seksjon/nyheter",
    language: "nb", group: "norway", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Norska exportmöjligheter och företagssamarbeten med Mexiko.", nb: "Norske eksportmuligheter og næringssamarbeid med Mexico." },
    review: { sv: "Officiell nyhetssida finns, men artikelupptäckt kunde inte verifieras i det läsbara sidinnehållet. Kräver adapterprov och uttryckligt Mexikofilter; generell norsk näringslivsinformation ska inte fylla flödet.", nb: "Offisiell nyhetsside finnes, men artikkeloppdagelse kunne ikke bekreftes i det lesbare sideinnholdet. Krever adaptertest og uttrykkelig Mexico-filter; generelle norske næringslivsnyheter skal ikke fylle strømmen." },
  },
  {
    id: "no-mx-noref", name: "NOREF", url: "https://noref.no/insights/news",
    language: "en", group: "norway", kind: "news", publication: "proposed", reviewedOn,
    evidenceUrl: "https://www.gob.mx/sre/prensa/sre-and-unam-together-with-norway-s-embassy-and-norwegian-centre-for-conflict-resolution-join-forces-to-foster-a-culture-of-peace?idiom=en",
    purpose: { sv: "Norsk freds- och medlingsverksamhet med konkret Mexikokoppling.", nb: "Norsk freds- og meklingsarbeid med konkret tilknytning til Mexico." },
    review: { sv: "Officiell nyhetslista och bilateral relevans verifierade. Publiceringstakten är låg och listan innehåller äldre material om andra länder; datum och Mexikokoppling måste filtreras.", nb: "Offisiell nyhetsliste og bilateral relevans bekreftet. Publiseringstakten er lav, og listen har eldre materiale om andre land; dato og tilknytning til Mexico må filtreres." },
  },
  {
    id: "no-mx-sre", name: "Secretaría de Relaciones Exteriores", url: "https://www.gob.mx/sre/archivo/prensa",
    language: "es", group: "mexico", kind: "news", publication: "proposed", reviewedOn,
    evidenceUrl: "https://www.gob.mx/sre/prensa/mexico-norway-qatar-and-switzerland-meet-to-strengthen-cooperation-on-preventive-diplomacy-mediation-and-conflict-resolution?idiom=en",
    purpose: { sv: "Mexikansk utrikespolitik och officiella relationer med Norge.", nb: "Meksikansk utenrikspolitikk og offisielle forbindelser med Norge." },
    review: { sv: "Bilateral presskommunikation verifierad, men arkivsidan gav HTTP 403 vid kontrollen. Automatisk listning är inte godkänd och spärren ska inte kringgås.", nb: "Bilateral pressekommunikasjon bekreftet, men arkivsiden ga HTTP 403 ved kontroll. Automatisk listing er ikke godkjent, og sperren skal ikke omgås." },
  },
  {
    id: "no-mx-economy", name: "Secretaría de Economía", url: "https://www.gob.mx/se/archivo/prensa",
    language: "es", group: "mexico", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Mexikansk handelspolitik, investeringar och marknadstillträde.", nb: "Meksikansk handelspolitikk, investeringer og markedsadgang." },
    review: { sv: "Officiellt arkivförslag. Arkivsidan gav HTTP 403 vid kontrollen. Innehållsutvinning är inte verifierad och spärren ska inte kringgås.", nb: "Forslag til offisielt arkiv. Arkivsiden ga HTTP 403 ved kontroll. Innholdsuttrekk er ikke verifisert, og sperren skal ikke omgås." },
  },
  {
    id: "no-mx-inegi", name: "INEGI: Sala de prensa", url: "https://www.inegi.org.mx/app/saladeprensa/",
    language: "es", group: "mexico", kind: "reference", publication: "proposed", reviewedOn,
    purpose: { sv: "Mexikansk ekonomi, samhälle och officiella statistikpubliceringar.", nb: "Meksikansk økonomi, samfunn og offisielle statistikkpubliseringer." },
    review: { sv: "Officiell pressida verifierad, men resultatlistan laddas dynamiskt. Kräver separat adapterprov samt tydliga datum och statistikperioder.", nb: "Offisiell presseside bekreftet, men resultatlisten lastes dynamisk. Krever separat adaptertest samt tydelige datoer og statistikkperioder." },
  },
  {
    id: "no-mx-embassy-x", name: "Norges ambassade: @NoruegaMexCA", url: "https://twitter.com/NoruegaMexCA",
    language: "es", group: "social", kind: "social", publication: "premium_locked", reviewedOn,
    evidenceUrl: "https://www.norway.no/es/mexico",
    purpose: { sv: "Ambassadens officiellt länkade X-konto som Premium-kandidat.", nb: "Ambassadens offisielt lenkede X-konto som Premium-kandidat." },
    review: { sv: "Kontolänken kommer från ambassadens webbplats. Kontots aktuella aktivitet och API-åtkomst är inte verifierade. Ingen social hämtning, OAuth-koppling eller API-kostnad aktiveras av detta förslag.", nb: "Kontolenken kommer fra ambassadens nettsted. Kontoens aktuelle aktivitet og API-tilgang er ikke verifisert. Forslaget aktiverer ingen sosial innhenting, OAuth-kobling eller API-kostnad." },
  },
];

export function getProfileSourceCatalog(homeCountry: HomeCountry) {
  return {
    id: homeCountry === "NO" ? "norway-mexico-sources-v1" : "sweden-mexico-publication-v1",
    homeCountry, targetCountry: "MX" as const,
    sources: (homeCountry === "NO" ? [...baselineSources, ...norwegianProposals] : [...baselineSources])
      .map((source) => ({ ...source, purpose: { ...source.purpose }, review: { ...source.review } })),
  };
}

export function sourceCatalogPreview(preferences: PersonalPreferences, query: { home?: string; lang?: string }) {
  return {
    home: query.home === "NO" || query.home === "SE" ? query.home : preferences.homeCountry,
    language: query.lang === "nb" || query.lang === "sv" ? query.lang : preferences.language,
  };
}
