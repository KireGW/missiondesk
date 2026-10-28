import type { HomeCountry, MonitoredCountry, PersonalLanguage, PersonalPreferences } from "@/lib/product/profiles";
import { interfaceLanguagesForProfile, mexicoPublication, personalStations } from "@/lib/product/profiles";
import { defaultSources } from "@/lib/sources/default-sources";

type Localized = Readonly<Record<PersonalLanguage, string>>;
export type ProfileSourceGroup = "baseline" | "norway" | "mexico" | "social" | Exclude<MonitoredCountry, "MX">;
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
    purpose: { sv: "Mexikanska nyheter inom det befintliga publiceringsurvalet.", nb: "Nyheter om Mexico i det eksisterende publiseringsutvalget.",
      en: "Mexican news within the existing publication selection.", es: "Noticias de México dentro de la selección de publicación actual." },
    review: { sv: "Ingår i personlägets fem tillåtna källor. Detta är inte en ny kontroll av RSS-hälsa eller publiceringsrättigheter.", nb: "Inngår i personvisningens fem tillatte kilder. Dette er ikke en ny kontroll av RSS-status eller publiseringsrettigheter.",
      en: "One of the five sources allowed in the personal view. This is not a new check of RSS health or publication rights.",
      es: "Una de las cinco fuentes permitidas en la vista personal. No implica una nueva revisión del estado del RSS ni de los derechos de publicación." },
  };
});

const norwegianProposals: readonly ProfileSourceProposal[] = [
  {
    id: "no-mx-embassy-news", name: "Norges ambassade i Mexico", url: "https://www.norway.no/es/mexico/noruega-mexico/news/",
    language: "es", group: "norway", kind: "news", publication: "proposed", reviewedOn: "2026-10-28",
    evidenceUrl: "https://www.norway.no/es/mexico",
    purpose: { sv: "Bilaterala relationer, ambassadens aktiviteter och norsk närvaro i Mexiko och bevakningsländerna i Centralamerika.", nb: "Bilaterale forbindelser, ambassadens aktiviteter og norsk tilstedeværelse i Mexico og overvåkingslandene i Mellom-Amerika.",
      en: "Bilateral relations, embassy activities and Norway's presence in Mexico and the monitored Central American countries.", es: "Relaciones bilaterales, actividades de la embajada y presencia noruega en México y los países de seguimiento de Centroamérica." },
    review: { sv: "Adressen är länkad från ambassadens officiella webbplats, men MissionDesks automatiska hämtning gav HTTP 403 vid kontrollen. Inget fungerande RSS-/Atom-flöde har verifierats. Källan förblir pausad och kan tills vidare bara läsas manuellt via länken; inga signaler hämtas härifrån. Automatisk import kräver en fungerande, tillåten anslutning samt kontroll av publiceringsdatum och koppling till stationens bevakningsländer.",
      nb: "Adressen er lenket fra ambassadens offisielle nettsted, men MissionDesks automatiske innhenting ga HTTP 403 ved kontrollen. Ingen fungerende RSS-/Atom-strøm er bekreftet. Kilden forblir satt på pause og kan inntil videre bare leses manuelt via lenken; ingen signaler hentes herfra. Automatisk import krever en fungerende, tillatt tilkobling samt kontroll av publiseringsdato og tilknytning til stasjonens overvåkingsland.",
      en: "The address is linked from the embassy's official website, but MissionDesk's automated retrieval returned HTTP 403 during the check. No working RSS/Atom feed has been verified. The source remains paused and is currently available only for manual reading via the link; no signals are imported from it. Automatic import requires a working, permitted connection and verification of publication dates and connections to the station's monitored countries.",
      es: "La dirección está enlazada desde el sitio oficial de la embajada, pero la consulta automática de MissionDesk devolvió HTTP 403 durante la comprobación. No se ha verificado ningún flujo RSS/Atom que funcione. La fuente sigue pausada y por ahora solo puede leerse manualmente mediante el enlace; no se importan señales de ella. La importación automática requiere una conexión funcional y permitida, además de verificar las fechas de publicación y los vínculos con los países de seguimiento de la sede." },
  },
  {
    id: "no-mx-ud-news", name: "Utenriksdepartementet / Regjeringen.no", url: "https://www.regjeringen.no/no/aktuelt/rss/id2581966/",
    discoveredFeedUrl: "https://www.regjeringen.no/no/rss/Rss/2581966/",
    language: "nb", group: "norway", kind: "news", publication: "proposed", reviewedOn: "2026-10-28",
    purpose: { sv: "Norsk utrikespolitik med uttrycklig koppling till stationens bevakningsländer.", nb: "Norsk utenrikspolitikk med uttrykkelig tilknytning til stasjonens overvåkingsland.",
      en: "Norwegian foreign policy with an explicit connection to the station's monitored countries.", es: "Política exterior noruega con un vínculo explícito con los países de seguimiento de la sede." },
    review: { sv: "Pausad efter kvalitetskontroll. RSS svarade HTTP 200, men de första 20 posterna var framtida kalenderposter, inte ett verifierat nyhetsurval från UD. Nyhetssökvägen räcker inte för att skilja innehållstyperna åt. Källan återaktiveras först när departement, innehållstyp, publiceringsdatum och koppling till bevakningsländerna kan verifieras. Sparat material och tidigare granskningshistorik behålls.",
      nb: "Satt på pause etter kvalitetskontroll. RSS svarte HTTP 200, men de første 20 oppføringene var fremtidige kalenderoppføringer, ikke et bekreftet nyhetsutvalg fra UD. Nyhetsstien alene skiller ikke innholdstypene. Kilden aktiveres først når departement, innholdstype, publiseringsdato og tilknytning til overvåkingslandene kan bekreftes. Lagret materiale og tidligere vurderingshistorikk beholdes.",
      en: "Paused following a quality review. The RSS returned HTTP 200, but its first 20 entries were future calendar events, not a verified Foreign Ministry news selection. The news URL path alone does not distinguish content types. Reactivation requires verified department, content type, publication dates and monitored-country connections. Saved material and previous review history are retained.",
      es: "Pausada tras revisar la calidad. El RSS respondió HTTP 200, pero sus primeras 20 entradas eran eventos futuros de calendario, no una selección verificada de noticias del Ministerio de Exteriores. La ruta de noticias no distingue por sí sola los tipos de contenido. La reactivación requiere verificar la dependencia, el tipo de contenido, las fechas de publicación y los vínculos con los países observados. Se conservan el material guardado y el historial de revisión." },
  },
  {
    id: "no-mx-ud-advisory", name: "UD: Mexico – reiseinformasjon",
    url: "https://www.regjeringen.no/no/tema/utenrikssaker/reiseinformasjon/velg-land/reiseinfo_mexico/id2416296/",
    language: "nb", group: "norway", kind: "advisory", publication: "proposed", reviewedOn: "2026-10-28",
    purpose: { sv: "Officiell konsulär information och förändringar i reserekommendationer.", nb: "Offisiell konsulær informasjon og endringer i reiseinformasjonen.",
      en: "Official consular information and changes to travel advice.", es: "Información consular oficial y cambios en las recomendaciones de viaje." },
    review: { sv: "Pausad: MissionDesks automatiska hämtning av den officiella Mexikosidan gav HTTP 403. Ändringsbevakningen är därför inte aktiv. Läs råd och uppdateringsdatum manuellt via originallänken. Återaktivering kräver verifierad, tillåten åtkomst; oförändrat referensmaterial ska inte publiceras som nya nyhetssignaler.",
      nb: "Satt på pause: MissionDesks automatiske innhenting av den offisielle Mexico-siden ga HTTP 403. Endringsovervåkingen er derfor ikke aktiv. Les råd og oppdateringsdato manuelt via originallenken. Aktivering krever bekreftet, tillatt tilgang; uendret referansemateriale skal ikke publiseres som nye nyhetssignaler.",
      en: "Paused: MissionDesk's automated retrieval of the official Mexico page returned HTTP 403. Change monitoring is therefore not active. Read advice and update dates manually via the original link. Reactivation requires verified, permitted access; unchanged reference material must not be published as new news signals.",
      es: "Pausada: la consulta automática de MissionDesk a la página oficial de México devolvió HTTP 403. Por ello no está activo el seguimiento de cambios. Consulta manualmente las recomendaciones y fechas mediante el enlace original. La reactivación requiere acceso verificado y permitido; el material de referencia sin cambios no debe publicarse como noticias nuevas." },
  },
  {
    id: "no-mx-ssb-trade", name: "SSB: Utenrikshandel med varer",
    url: "https://www.ssb.no/utenriksokonomi/utenrikshandel/statistikk/utenrikshandel-med-varer",
    language: "nb", group: "norway", kind: "reference", publication: "proposed", reviewedOn,
    purpose: { sv: "Norsk handel med bevakningsländerna, uppdelad efter land och varugrupp.", nb: "Norsk handel med overvåkingslandene, fordelt på land og varegruppe.",
      en: "Norwegian trade with the monitored countries, broken down by country and commodity group.", es: "Comercio noruego con los países de seguimiento, desglosado por país y grupo de productos." },
    review: { sv: "Officiell statistik verifierad. En framtida datakoppling måste välja respektive bevakningsland och ange statistikperiod; totalsiffror för hela världen är inte bilaterala siffror.", nb: "Offisiell statistikk bekreftet. En fremtidig datakobling må velge hvert overvåkingsland og angi statistikkperiode; globale totaltall er ikke bilaterale tall.",
      en: "Official statistics verified. A future data connection must select each monitored country and specify the reporting period; global totals are not bilateral figures.",
      es: "Estadísticas oficiales verificadas. Una futura conexión debe seleccionar cada país de seguimiento e indicar el periodo estadístico; los totales mundiales no son cifras bilaterales." },
  },
  {
    id: "no-mx-efta", name: "EFTA: Mexico", url: "https://www.efta.int/trade-relations/free-trade-network/mexico",
    language: "en", group: "norway", kind: "reference", publication: "proposed", reviewedOn,
    purpose: { sv: "EFTA–Mexiko: handel, avtalsram och marknadstillträde.", nb: "EFTA–Mexico: handel, avtaleramme og markedsadgang.",
      en: "EFTA–Mexico: trade, treaty framework and market access.", es: "AELC–México: comercio, marco del acuerdo y acceso al mercado." },
    review: { sv: "Officiell Mexikosida verifierad. Referensmaterial, inte ett löpande nyhetsflöde. Avtalsdatum får inte förväxlas med publiceringsdatum för en ny signal.", nb: "Offisiell Mexico-side bekreftet. Referansemateriale, ikke en løpende nyhetsstrøm. Avtaledatoer må ikke forveksles med publiseringsdato for et nytt signal.",
      en: "Official Mexico page verified. Reference material, not an ongoing news feed. Treaty dates must not be mistaken for the publication date of a new signal.",
      es: "Página oficial sobre México verificada. Es material de referencia, no un flujo continuo de noticias. Las fechas de los acuerdos no deben confundirse con la fecha de publicación de una señal nueva." },
  },
  {
    id: "no-mx-innovation", name: "Innovasjon Norge", url: "https://www.innovasjonnorge.no/seksjon/nyheter",
    language: "nb", group: "norway", kind: "news", publication: "proposed", reviewedOn: "2026-10-28",
    purpose: { sv: "Norska exportmöjligheter och företagssamarbeten i bevakningsländerna.", nb: "Norske eksportmuligheter og næringssamarbeid i overvåkingslandene.",
      en: "Norwegian export opportunities and business cooperation in the monitored countries.", es: "Oportunidades de exportación noruega y colaboración empresarial en los países de seguimiento." },
    review: { sv: "Pausad: omkontrollen gav HTTP 403. Officiell nyhetssida finns, men artikelupptäckt kunde inte verifieras i det läsbara sidinnehållet. Kräver tillåten åtkomst, adapterprov och uttryckligt filter för bevakningsländerna; generell norsk näringslivsinformation ska inte fylla flödet.", nb: "Satt på pause: ny kontroll ga HTTP 403. Offisiell nyhetsside finnes, men artikkeloppdagelse kunne ikke bekreftes i det lesbare sideinnholdet. Krever tillatt tilgang, adaptertest og uttrykkelig filter for overvåkingslandene; generelle norske næringslivsnyheter skal ikke fylle strømmen.",
      en: "Paused: the latest check returned HTTP 403. An official news page exists, but article discovery could not be verified in its readable content. Requires permitted access, an adapter test and explicit monitored-country filtering; general Norwegian business news must not fill the feed.",
      es: "Pausada: la nueva comprobación devolvió HTTP 403. Existe una página oficial de noticias, pero no pudo verificarse la detección de artículos en el contenido legible. Requiere acceso permitido, probar el adaptador y filtrar los países de seguimiento; las noticias empresariales generales de Noruega no deben llenar el flujo." },
  },
  {
    id: "no-mx-noref", name: "NOREF", url: "https://noref.no/insights/news",
    language: "en", group: "norway", kind: "news", publication: "proposed", reviewedOn,
    evidenceUrl: "https://www.gob.mx/sre/prensa/sre-and-unam-together-with-norway-s-embassy-and-norwegian-centre-for-conflict-resolution-join-forces-to-foster-a-culture-of-peace?idiom=en",
    purpose: { sv: "Fred, medling och diplomati med norsk koppling och relevans för bevakningsländerna.", nb: "Fred, mekling og diplomati med norsk tilknytning og relevans for overvåkingslandene.",
      en: "Peacebuilding, mediation and diplomacy with Norwegian connections and relevance to the monitored countries.", es: "Paz, mediación y diplomacia con vínculos noruegos y relevancia para los países de seguimiento." },
    review: { sv: "Officiell nyhetslista och bilateral Mexikorelevans verifierade. Publiceringstakten är låg och listan innehåller äldre globalt material; datum och koppling till ett bevakningsland måste kontrolleras. Regionalt urval är ännu inte provat.", nb: "Offisiell nyhetsliste og bilateral Mexico-relevans bekreftet. Publiseringstakten er lav, og listen har eldre globalt materiale; dato og tilknytning til et overvåkingsland må kontrolleres. Regionalt utvalg er ennå ikke testet.",
      en: "Official news list and bilateral Mexico relevance verified. Publication is infrequent and includes older global material; dates and connections to a monitored country must be checked. Regional selection has not yet been tested.",
      es: "Lista oficial y relevancia bilateral para México verificadas. La publicación es poco frecuente e incluye material global antiguo; deben comprobarse las fechas y el vínculo con un país de seguimiento. La selección regional aún no se ha probado." },
  },
  {
    id: "no-mx-sre", name: "Secretaría de Relaciones Exteriores", url: "https://www.gob.mx/sre/archivo/prensa",
    language: "es", group: "mexico", kind: "news", publication: "proposed", reviewedOn: "2026-10-28",
    evidenceUrl: "https://www.gob.mx/sre/prensa/mexico-norway-qatar-and-switzerland-meet-to-strengthen-cooperation-on-preventive-diplomacy-mediation-and-conflict-resolution?idiom=en",
    purpose: { sv: "Mexikansk utrikespolitik och officiella relationer med Norge.", nb: "Meksikansk utenrikspolitikk og offisielle forbindelser med Norge.",
      en: "Mexican foreign policy and official relations with Norway.", es: "Política exterior mexicana y relaciones oficiales con Noruega." },
    review: { sv: "Pausad tills en HTML-nyhetsadapter har verifierats. Bilateral presskommunikation är belagd. Tidigare kontroll gav HTTP 403; omkontrollen gav HTTP 200 och synliga artikellänkar, men automatisk import och datumens tidszon är ännu inte verifierade. Tillåten återgivning behöver också granskas. Åtkomstspärrar kringgås inte.", nb: "Satt på pause til en HTML-nyhetsadapter er bekreftet. Bilateral pressekommunikasjon er dokumentert. Tidligere kontroll ga HTTP 403; ny kontroll ga HTTP 200 og synlige artikkellenker, men automatisk import og datoenes tidssone er ennå ikke bekreftet. Tillatt gjengivelse må også vurderes. Tilgangssperrer omgås ikke.",
      en: "Paused until an HTML news adapter is verified. Bilateral press communication is evidenced. An earlier check returned HTTP 403; the new check returned HTTP 200 and visible article links, but automated import and the dates' time zone remain unverified. Permitted reproduction also needs review. Access restrictions are not bypassed.",
      es: "Pausada hasta verificar un adaptador de noticias HTML. Hay evidencia de comunicación bilateral. Una comprobación anterior devolvió HTTP 403; la nueva devolvió HTTP 200 y enlaces visibles a artículos, pero la importación automática y la zona horaria de las fechas siguen sin verificarse. También debe revisarse la reproducción permitida. No se eluden restricciones de acceso." },
  },
  {
    id: "no-mx-economy", name: "Secretaría de Economía", url: "https://www.gob.mx/se/archivo/prensa",
    language: "es", group: "mexico", kind: "news", publication: "proposed", reviewedOn: "2026-10-28",
    purpose: { sv: "Mexikansk handelspolitik, investeringar och marknadstillträde.", nb: "Meksikansk handelspolitikk, investeringer og markedsadgang.",
      en: "Mexican trade policy, investment and market access.", es: "Política comercial mexicana, inversiones y acceso al mercado." },
    review: { sv: "Pausat officiellt arkiv i väntan på verifierad HTML-nyhetsadapter. Tidigare kontroll gav HTTP 403; omkontrollen gav HTTP 200 med artikellänkar. Det finns ännu ingen verifierad automatisk import med korrekt tolkning av publiceringsdatumens tidszon. Tillåten återgivning behöver granskas och åtkomstspärrar får inte kringgås.", nb: "Offisielt arkiv satt på pause i påvente av en bekreftet HTML-nyhetsadapter. Tidligere kontroll ga HTTP 403; ny kontroll ga HTTP 200 med artikkellenker. Det finnes ennå ingen bekreftet automatisk import med korrekt tolkning av publiseringsdatoenes tidssone. Tillatt gjengivelse må vurderes, og tilgangssperrer skal ikke omgås.",
      en: "Official archive paused pending a verified HTML news adapter. An earlier check returned HTTP 403; the new check returned HTTP 200 with article links. Automated import with correct interpretation of publication time zones is not yet verified. Permitted reproduction needs review and access restrictions must not be bypassed.",
      es: "Archivo oficial pausado hasta verificar un adaptador de noticias HTML. Una comprobación anterior devolvió HTTP 403; la nueva devolvió HTTP 200 con enlaces a artículos. Aún no está verificada la importación automática con una interpretación correcta de la zona horaria de publicación. Debe revisarse la reproducción permitida y no deben eludirse restricciones de acceso." },
  },
  {
    id: "no-mx-inegi", name: "INEGI: Sala de prensa", url: "https://www.inegi.org.mx/app/saladeprensa/",
    language: "es", group: "mexico", kind: "reference", publication: "proposed", reviewedOn,
    purpose: { sv: "Mexikansk ekonomi, samhälle och officiella statistikpubliceringar.", nb: "Meksikansk økonomi, samfunn og offisielle statistikkpubliseringer.",
      en: "Mexican economy, society and official statistical releases.", es: "Economía, sociedad y publicaciones estadísticas oficiales de México." },
    review: { sv: "Officiell pressida verifierad, men resultatlistan laddas dynamiskt. Kräver separat adapterprov samt tydliga datum och statistikperioder.", nb: "Offisiell presseside bekreftet, men resultatlisten lastes dynamisk. Krever separat adaptertest samt tydelige datoer og statistikkperioder.",
      en: "Official press page verified, but results load dynamically. Requires a separate adapter test and clear dates and reporting periods.",
      es: "Página oficial de prensa verificada, pero los resultados se cargan dinámicamente. Requiere una prueba independiente del adaptador y fechas y periodos estadísticos claros." },
  },
  {
    id: "no-mx-embassy-x", name: "Norges ambassade: @NoruegaMexCA", url: "https://twitter.com/NoruegaMexCA",
    language: "es", group: "social", kind: "social", publication: "premium_locked", reviewedOn,
    evidenceUrl: "https://www.norway.no/es/mexico",
    purpose: { sv: "Ambassadens officiellt länkade X-konto som Premium-kandidat.", nb: "Ambassadens offisielt lenkede X-konto som Premium-kandidat.",
      en: "The embassy's officially linked X account as a Premium candidate.", es: "Cuenta de X enlazada oficialmente por la embajada, como candidata para Premium." },
    review: { sv: "Kontolänken kommer från ambassadens webbplats. Kontots aktuella aktivitet och API-åtkomst är inte verifierade. Ingen social hämtning, OAuth-koppling eller API-kostnad aktiveras av detta förslag.", nb: "Kontolenken kommer fra ambassadens nettsted. Kontoens aktuelle aktivitet og API-tilgang er ikke verifisert. Forslaget aktiverer ingen sosial innhenting, OAuth-kobling eller API-kostnad.",
      en: "The account link comes from the embassy website. Current activity and API access are unverified. This proposal enables no social retrieval, OAuth connection or API cost.",
      es: "El enlace proviene del sitio de la embajada. La actividad actual y el acceso a la API no están verificados. Esta propuesta no activa consultas sociales, conexiones OAuth ni costos de API." },
  },
];

const socialProposalReview: Localized = {
  sv: "Kandidat från det godkända urvalet. Kontots identitet, aktuella roll, aktivitet, användar-id och API-åtkomst måste kontrolleras före aktivering. Filtrera inlägg mot stationens bevakningsländer och behandla politiska uttalanden som avsändarens uppgifter. Förslaget aktiverar inga sociala anrop, OAuth-kopplingar eller API-kostnader.",
  nb: "Kandidat fra det godkjente utvalget. Kontoens identitet, nåværende rolle, aktivitet, bruker-id og API-tilgang må kontrolleres før aktivering. Filtrer innlegg mot stasjonens overvåkingsland, og behandle politiske uttalelser som avsenderens opplysninger. Forslaget aktiverer ingen sosiale API-kall, OAuth-koblinger eller API-kostnader.",
  en: "Candidate from the approved selection. Account identity, current role, activity, user ID and API access must be checked before activation. Filter posts against the station's monitored countries and treat political statements as the author's claims. This proposal enables no social API calls, OAuth connections or API costs.",
  es: "Cuenta candidata de la selección aprobada. Antes de activarla deben comprobarse su identidad, cargo actual, actividad, identificador de usuario y acceso a la API. Filtrar las publicaciones por los países de seguimiento de la sede y tratar las declaraciones políticas como afirmaciones de su autor. Esta propuesta no activa consultas sociales, conexiones OAuth ni costos de API.",
};

const regionalNewsReview: Localized = {
  sv: "Källan blandar nyheter med annat material. Urvalet behöver belägg för landkoppling och publiceringsdatum. Källans aktuella anslutning och eventuella hämtningsfel visas separat i listan. Användningsvillkor behöver granskas före bredare lansering.",
  nb: "Kilden blander nyheter med annet innhold. Utvalget trenger belegg for landtilknytning og publiseringsdato. Gjeldende tilkobling og eventuelle innhentingsfeil vises separat i listen. Bruksvilkår må vurderes før bredere lansering.",
  en: "The source mixes news with other content. Selection needs evidence of country connections and publication dates. Current connection and any retrieval errors are shown separately in the list. Terms need review before a wider launch.",
  es: "La fuente mezcla noticias con otros contenidos. La selección requiere evidencia del vínculo geográfico y la fecha de publicación. La conexión actual y los errores se indican por separado en la lista. Deben revisarse las condiciones antes de un lanzamiento más amplio.",
};
const regionalOfficialReview: Localized = {
  sv: "Officiell källa. Skilj myndighetens egna uppgifter från oberoende rapportering och kontrollera publiceringsdatum, innehållstyp, åtkomst och villkor före eventuell anslutning.",
  nb: "Offisiell kilde. Skill myndighetens egne opplysninger fra uavhengig rapportering, og kontroller publiseringsdato, innholdstype, tilgang og vilkår før eventuell tilkobling.",
  en: "Official source. Distinguish the authority's own statements from independent reporting and check publication dates, content type, access and terms before any connection.",
  es: "Fuente oficial. Distinguir las declaraciones de la autoridad de la cobertura independiente y comprobar fechas de publicación, tipo de contenido, acceso y condiciones antes de conectarla.",
};
const blockedOfficialReview: Localized = {
  sv: `${regionalOfficialReview.sv} Pausad: automatisk hämtning gav HTTP 403. Använd originallänken för manuell läsning tills tillåten åtkomst har verifierats.`,
  nb: `${regionalOfficialReview.nb} Satt på pause: automatisk innhenting ga HTTP 403. Bruk originallenken for manuell lesing til tillatt tilgang er bekreftet.`,
  en: `${regionalOfficialReview.en} Paused: automated retrieval returned HTTP 403. Use the original link for manual reading until permitted access is verified.`,
  es: `${regionalOfficialReview.es} Pausada: la consulta automática devolvió HTTP 403. Usa el enlace original para lectura manual hasta verificar el acceso permitido.`,
};
const regionalAdvisoryReview: Localized = {
  sv: "Pausad: MissionDesks automatiska hämtning av denna officiella resesida gav HTTP 403. Ändringsbevakningen är inte aktiv och åtkomstspärren kringgås inte. Läs tills vidare råd och uppdateringsdatum manuellt via originallänken. Verifierad, tillåten åtkomst krävs före återaktivering; referensmaterial ska inte behandlas som nya nyhetsartiklar.",
  nb: "Satt på pause: MissionDesks automatiske innhenting av denne offisielle reisesiden ga HTTP 403. Endringsovervåkingen er ikke aktiv, og tilgangssperren omgås ikke. Les foreløpig råd og oppdateringsdato manuelt via originallenken. Bekreftet, tillatt tilgang kreves før aktivering; referansemateriale skal ikke behandles som nye nyhetsartikler.",
  en: "Paused: MissionDesk's automated retrieval of this official travel page returned HTTP 403. Change monitoring is not active and the access restriction is not bypassed. For now, read advice and update dates manually via the original link. Verified, permitted access is required before reactivation; reference material must not be treated as new news articles.",
  es: "Pausada: la consulta automática de MissionDesk a esta página oficial de viaje devolvió HTTP 403. El seguimiento de cambios no está activo y no se elude la restricción de acceso. Por ahora, consulta manualmente las recomendaciones y fechas mediante el enlace original. La reactivación requiere acceso verificado y permitido; el material de referencia no debe tratarse como noticias nuevas.",
};
const regionalAdvisoryPurpose: Localized = {
  sv: "Norska UD:s reseinformation och konsulärt relevanta förändringar.", nb: "Norske UDs reiseinformasjon og konsulært relevante endringer.",
  en: "Norwegian travel advice and changes relevant to consular affairs.", es: "Información de viaje de Noruega y cambios relevantes para asuntos consulares.",
};

const regionalPublicProposals: readonly ProfileSourceProposal[] = [
  {
    id: "no-ni-confidencial", name: "Confidencial", url: "https://confidencial.digital/", group: "NI", language: "es", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Nicaraguansk journalistik om politik, samhälle och ekonomi.", nb: "Nicaraguansk journalistikk om politikk, samfunn og økonomi.", en: "Nicaraguan reporting on politics, society and the economy.", es: "Periodismo nicaragüense sobre política, sociedad y economía." }, review: regionalNewsReview,
  },
  {
    id: "no-ni-bcn", name: "Banco Central de Nicaragua", url: "https://www.bcn.gob.ni/notas-de-prensa", group: "NI", language: "es", kind: "reference", publication: "proposed", reviewedOn,
    purpose: { sv: "Nicaraguanska centralbankens ekonomiska rapporter och pressmeddelanden.", nb: "Nicaraguas sentralbanks økonomiske rapporter og pressemeldinger.", en: "Nicaraguan central-bank economic reports and press releases.", es: "Informes económicos y comunicados del Banco Central de Nicaragua." }, review: regionalOfficialReview,
  },
  {
    id: "no-cr-tico-times", name: "The Tico Times", url: "https://ticotimes.net/", group: "CR", language: "en", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Engelskspråkiga nyheter om Costa Rica och regionen.", nb: "Engelskspråklige nyheter om Costa Rica og regionen.", en: "English-language news about Costa Rica and the region.", es: "Noticias en inglés sobre Costa Rica y la región." }, review: regionalNewsReview,
  },
  {
    id: "no-cr-mfa", name: "Cancillería de Costa Rica", url: "https://www.rree.go.cr/", group: "CR", language: "es", kind: "news", publication: "proposed", reviewedOn: "2026-10-28",
    purpose: { sv: "Costa Ricas officiella utrikespolitik och diplomatiska meddelanden.", nb: "Costa Ricas offisielle utenrikspolitikk og diplomatiske meldinger.", en: "Costa Rican official foreign policy and diplomatic announcements.", es: "Política exterior oficial y comunicados diplomáticos de Costa Rica." }, review: blockedOfficialReview,
  },
  {
    id: "no-gt-plaza-publica", name: "Plaza Pública", url: "https://plazapublica.com.gt/", group: "GT", language: "es", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Granskande journalistik om Guatemala, politik och samhälle.", nb: "Undersøkende journalistikk om Guatemala, politikk og samfunn.", en: "Investigative reporting on Guatemala, politics and society.", es: "Periodismo de investigación sobre Guatemala, política y sociedad." }, review: regionalNewsReview,
  },
  {
    id: "no-gt-minex", name: "MINEX Guatemala", url: "https://www.minex.gob.gt/", group: "GT", language: "es", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Guatemalas officiella utrikespolitik och diplomati.", nb: "Guatemalas offisielle utenrikspolitikk og diplomati.", en: "Guatemala's official foreign policy and diplomacy.", es: "Política exterior oficial y diplomacia de Guatemala." },
    review: { sv: "Webbkontrollen gav HTTP 403. Automatisk åtkomst är inte verifierad; spärren ska inte kringgås. Myndighetens uppgifter måste skiljas från oberoende rapportering.", nb: "Nettkontrollen ga HTTP 403. Automatisk tilgang er ikke verifisert; sperren skal ikke omgås. Myndighetens opplysninger må skilles fra uavhengig rapportering.", en: "The web check returned HTTP 403. Automated access is unverified; do not bypass the restriction. Distinguish the authority's statements from independent reporting.", es: "La comprobación web respondió HTTP 403. El acceso automatizado no está verificado; no eludir la restricción. Distinguir las declaraciones oficiales de la cobertura independiente." },
  },
  {
    id: "no-hn-criterio", name: "Criterio.hn", url: "https://criterio.hn/", group: "HN", language: "es", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Journalistik om Honduras, demokrati och mänskliga rättigheter.", nb: "Journalistikk om Honduras, demokrati og menneskerettigheter.", en: "Reporting on Honduras, democracy and human rights.", es: "Periodismo sobre Honduras, democracia y derechos humanos." }, review: regionalNewsReview,
  },
  {
    id: "no-hn-mfa", name: "Cancillería Honduras", url: "https://sreci.gob.hn/comunicados-generales", group: "HN", language: "es", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Honduras officiella utrikespolitik och diplomatiska meddelanden.", nb: "Honduras' offisielle utenrikspolitikk og diplomatiske meldinger.", en: "Honduran official foreign policy and diplomatic announcements.", es: "Política exterior oficial y comunicados diplomáticos de Honduras." },
    review: { sv: "Arkivet hittades, men den direkta webbkontrollen fick timeout. Automatisk hämtning och aktuella publiceringsdatum är inte verifierade.", nb: "Arkivet ble funnet, men den direkte nettverkskontrollen fikk tidsavbrudd. Automatisk innhenting og aktuelle publiseringsdatoer er ikke verifisert.", en: "The archive was found, but the direct web check timed out. Automated retrieval and current publication dates are unverified.", es: "Se encontró el archivo, pero la comprobación web directa agotó el tiempo de espera. La extracción automatizada y las fechas actuales no están verificadas." },
  },
  {
    id: "no-sv-gato-encerrado", name: "GatoEncerrado", url: "https://gatoencerrado.news/", group: "SV", language: "es", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Granskande journalistik om El Salvador och Centralamerika.", nb: "Undersøkende journalistikk om El Salvador og Mellom-Amerika.", en: "Investigative reporting on El Salvador and Central America.", es: "Periodismo de investigación sobre El Salvador y Centroamérica." }, review: regionalNewsReview,
  },
  {
    id: "no-sv-mfa", name: "Cancillería de El Salvador", url: "https://rree.gob.sv/", group: "SV", language: "es", kind: "news", publication: "proposed", reviewedOn: "2026-10-28",
    purpose: { sv: "El Salvadors officiella utrikespolitik och diplomatiska meddelanden.", nb: "El Salvadors offisielle utenrikspolitikk og diplomatiske meldinger.", en: "Salvadoran official foreign policy and diplomatic announcements.", es: "Política exterior oficial y comunicados diplomáticos de El Salvador." }, review: blockedOfficialReview,
  },
  {
    id: "no-bz-love-fm", name: "Love FM Belize", url: "https://lovefm.com/", group: "BZ", language: "en", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Nyheter om Belize, politik, ekonomi och samhälle.", nb: "Nyheter om Belize, politikk, økonomi og samfunn.", en: "News about Belize, politics, the economy and society.", es: "Noticias sobre Belice, política, economía y sociedad." }, review: regionalNewsReview,
  },
  {
    id: "no-bz-press-office", name: "Government of Belize Press Office", url: "https://www.pressoffice.gov.bz/", group: "BZ", language: "en", kind: "news", publication: "proposed", reviewedOn,
    purpose: { sv: "Belizes regeringsmeddelanden om politik, ekonomi och samhälle.", nb: "Belizes regjeringsmeldinger om politikk, økonomi og samfunn.", en: "Belize government announcements on politics, the economy and society.", es: "Comunicados del Gobierno de Belice sobre política, economía y sociedad." }, review: regionalOfficialReview,
  },
];

const regionalAdvisories: readonly ProfileSourceProposal[] = ([
  { id: "no-ni-ud-advisory", name: "UD: Nicaragua – reiseinformasjon", group: "NI", url: "https://www.regjeringen.no/no/tema/utenrikssaker/reiseinformasjon/velg-land/reiseinfo_nicaragua/id2428567/" },
  { id: "no-cr-ud-advisory", name: "UD: Costa Rica – reiseinformasjon", group: "CR", url: "https://www.regjeringen.no/no/tema/utenrikssaker/reiseinformasjon/velg-land/reiseinfo_costarica/id2428563/" },
  { id: "no-gt-ud-advisory", name: "UD: Guatemala – reiseinformasjon", group: "GT", url: "https://www.regjeringen.no/no/tema/utenrikssaker/reiseinformasjon/velg-land/reiseinfo_guatemala/id2428566/" },
  { id: "no-hn-ud-advisory", name: "UD: Honduras – reiseinformasjon", group: "HN", url: "https://www.regjeringen.no/no/tema/utenrikssaker/reiseinformasjon/velg-land/reiseinfo_honduras/id2428569/" },
  { id: "no-sv-ud-advisory", name: "UD: El Salvador – reiseinformasjon", group: "SV", url: "https://www.regjeringen.no/no/tema/utenrikssaker/reiseinformasjon/velg-land/reiseinfo_elsalvador/id2428564/" },
  { id: "no-bz-ud-advisory", name: "UD: Belize – reiseinformasjon", group: "BZ", url: "https://www.regjeringen.no/no/tema/utenrikssaker/reiseinformasjon/velg-land/belize---reiseinformasjon/id2428562/" },
] satisfies Array<Pick<ProfileSourceProposal, "id" | "name" | "group" | "url">>).map((source): ProfileSourceProposal => ({
  ...source, language: "nb", kind: "advisory", publication: "proposed", reviewedOn: "2026-10-28",
  purpose: regionalAdvisoryPurpose, review: regionalAdvisoryReview,
}));

const norwegianSocialProposals: readonly ProfileSourceProposal[] = [
  {
    id: "no-mx-sheinbaum-x", name: "Claudia Sheinbaum: @Claudiashein", url: "https://x.com/Claudiashein", language: "es",
    purpose: { sv: "Mexikanska regeringsbesked och nationella politiska prioriteringar.", nb: "Meksikanske regjeringsmeldinger og nasjonale politiske prioriteringer.",
      en: "Mexican government announcements and national political priorities.", es: "Anuncios del Gobierno mexicano y prioridades políticas nacionales." },
  },
  {
    id: "no-mx-ebrard-x", name: "Marcelo Ebrard: @m_ebrard", url: "https://x.com/m_ebrard", language: "es",
    purpose: { sv: "Mexikansk handelspolitik, investeringar och T-MEC.", nb: "Meksikansk handelspolitikk, investeringer og T-MEC.",
      en: "Mexican trade policy, investment and USMCA.", es: "Política comercial mexicana, inversiones y T-MEC." },
  },
  {
    id: "no-mx-harfuch-x", name: "Omar García Harfuch: @OHarfuch", url: "https://x.com/OHarfuch", language: "es",
    purpose: { sv: "Officiella säkerhetsbesked och insatser mot organiserad brottslighet i Mexiko.", nb: "Offisielle sikkerhetsmeldinger og innsats mot organisert kriminalitet i Mexico.",
      en: "Official security announcements and operations against organised crime in Mexico.", es: "Comunicados oficiales de seguridad y acciones contra la delincuencia organizada en México." },
  },
  {
    id: "no-mx-velasco-x", name: "Roberto Velasco: @r_velascoa", url: "https://x.com/r_velascoa", language: "es",
    purpose: { sv: "Mexikansk utrikespolitik, diplomati och internationella relationer.", nb: "Meksikansk utenrikspolitikk, diplomati og internasjonale forbindelser.",
      en: "Mexican foreign policy, diplomacy and international relations.", es: "Política exterior mexicana, diplomacia y relaciones internacionales." },
  },
  {
    id: "no-mx-brugada-x", name: "Clara Brugada: @ClaraBrugadaM", url: "https://x.com/ClaraBrugadaM", language: "es",
    purpose: { sv: "Mexico City: lokala beslut, säkerhet och krishantering.", nb: "Mexico City: lokale beslutninger, sikkerhet og krisehåndtering.",
      en: "Mexico City: local decisions, security and crisis management.", es: "Ciudad de México: decisiones locales, seguridad y gestión de crisis." },
  },
  {
    id: "no-mx-samuel-garcia-x", name: "Samuel García: @samuel_garcias", url: "https://x.com/samuel_garcias", language: "es",
    purpose: { sv: "Nuevo León: industri, investeringar och näringsliv.", nb: "Nuevo León: industri, investeringer og næringsliv.",
      en: "Nuevo León: industry, investment and business.", es: "Nuevo León: industria, inversiones y actividad empresarial." },
  },
  {
    id: "no-mx-mara-lezama-x", name: "Mara Lezama: @MaraLezama", url: "https://x.com/MaraLezama", language: "es",
    purpose: { sv: "Quintana Roo: turism, konsulärt relevanta händelser och gränsen mot Belize.", nb: "Quintana Roo: turisme, konsulært relevante hendelser og grensen mot Belize.",
      en: "Quintana Roo: tourism, events with consular relevance and the Belize border.", es: "Quintana Roo: turismo, acontecimientos de interés consular y frontera con Belice." },
  },
  {
    id: "no-mx-rocio-nahle-x", name: "Rocío Nahle: @rocionahle", url: "https://x.com/rocionahle", language: "es",
    purpose: { sv: "Veracruz: energi, hamnar och regional säkerhet.", nb: "Veracruz: energi, havner og regional sikkerhet.",
      en: "Veracruz: energy, ports and regional security.", es: "Veracruz: energía, puertos y seguridad regional." },
  },
  {
    id: "no-mx-salomon-jara-x", name: "Salomón Jara: @salomonj", url: "https://x.com/salomonj", language: "es",
    purpose: { sv: "Oaxaca: transportkorridoren över Tehuantepec och regional utveckling.", nb: "Oaxaca: transportkorridoren over Tehuantepec og regional utvikling.",
      en: "Oaxaca: the Tehuantepec transport corridor and regional development.", es: "Oaxaca: el corredor de transporte del Istmo de Tehuantepec y el desarrollo regional." },
  },
  {
    id: "no-mx-arevalo-x", name: "Bernardo Arévalo: @BArevalodeLeon", url: "https://x.com/BArevalodeLeon", language: "es",
    purpose: { sv: "Guatemala: demokrati, migration och regionalpolitik.", nb: "Guatemala: demokrati, migrasjon og regionalpolitikk.",
      en: "Guatemala: democracy, migration and regional politics.", es: "Guatemala: democracia, migración y política regional." },
  },
  {
    id: "no-mx-briceno-x", name: "John Briceño: @JohnBricenoBZE", url: "https://x.com/JohnBricenoBZE", language: "en",
    purpose: { sv: "Belize: handel, klimat och relationer med Mexiko.", nb: "Belize: handel, klima og forbindelser med Mexico.",
      en: "Belize: trade, climate and relations with Mexico.", es: "Belice: comercio, clima y relaciones con México." },
  },
  {
    id: "no-mx-costa-rica-mfa-x", name: "Cancillería de Costa Rica: @CRcancilleria", url: "https://x.com/CRcancilleria", language: "es",
    purpose: { sv: "Costa Ricas utrikespolitik, regionala diplomati och internationella samarbete.", nb: "Costa Ricas utenrikspolitikk, regionale diplomati og internasjonale samarbeid.",
      en: "Costa Rican foreign policy, regional diplomacy and international cooperation.", es: "Política exterior costarricense, diplomacia regional y cooperación internacional." },
  },
  {
    id: "no-mx-honduras-mfa-x", name: "Cancillería Honduras: @CancilleriaHN", url: "https://x.com/CancilleriaHN", language: "es",
    purpose: { sv: "Honduras: utrikespolitik, migration och konsulära frågor.", nb: "Honduras: utenrikspolitikk, migrasjon og konsulære spørsmål.",
      en: "Honduras: foreign policy, migration and consular affairs.", es: "Honduras: política exterior, migración y asuntos consulares." },
  },
  {
    id: "no-mx-el-salvador-mfa-x", name: "Cancillería de El Salvador: @CancilleriaSV", url: "https://x.com/CancilleriaSV", language: "es",
    purpose: { sv: "El Salvador: diplomati, internationellt samarbete och investeringar.", nb: "El Salvador: diplomati, internasjonalt samarbeid og investeringer.",
      en: "El Salvador: diplomacy, international cooperation and investment.", es: "El Salvador: diplomacia, cooperación internacional e inversiones." },
  },
  {
    id: "no-mx-cidh-x", name: "CIDH: @CIDH", url: "https://x.com/CIDH", language: "es",
    purpose: { sv: "Mänskliga rättigheter i regionen, inklusive Nicaragua.", nb: "Menneskerettigheter i regionen, inkludert Nicaragua.",
      en: "Human rights across the region, including Nicaragua.", es: "Derechos humanos en la región, incluida Nicaragua." },
  },
  {
    id: "no-mx-sikela-x", name: "Jozef Síkela: @JozefSikela", url: "https://x.com/JozefSikela", language: "en",
    purpose: { sv: "EU:s internationella partnerskap, Global Gateway och investeringar i Latinamerika.", nb: "EUs internasjonale partnerskap, Global Gateway og investeringer i Latin-Amerika.",
      en: "EU international partnerships, Global Gateway and investment in Latin America.", es: "Asociaciones internacionales de la UE, Global Gateway e inversiones en América Latina." },
  },
  {
    id: "no-mx-sefcovic-x", name: "Maroš Šefčovič: @MarosSefcovic", url: "https://x.com/MarosSefcovic", language: "en",
    purpose: { sv: "EU:s handelspolitik och ekonomiska relationer med Latinamerika.", nb: "EUs handelspolitikk og økonomiske forbindelser med Latin-Amerika.",
      en: "EU trade policy and economic relations with Latin America.", es: "Política comercial de la UE y relaciones económicas con América Latina." },
  },
  {
    id: "no-mx-eu-delegation-x", name: "Unión Europea en México: @UEenMexico", url: "https://x.com/UEenMexico", language: "es",
    purpose: { sv: "Lokala EU-positioner, samarbetsprojekt och diplomatiska uttalanden i Mexiko.", nb: "Lokale EU-posisjoner, samarbeidsprosjekter og diplomatiske uttalelser i Mexico.",
      en: "Local EU positions, cooperation projects and diplomatic statements in Mexico.", es: "Posiciones de la UE, proyectos de cooperación y declaraciones diplomáticas en México." },
  },
  {
    id: "no-mx-eide-x", name: "Espen Barth Eide: @EspenBarthEide", url: "https://x.com/EspenBarthEide", language: "en",
    purpose: { sv: "Norska utrikespolitiska positioner och diplomatiska initiativ med regional relevans.", nb: "Norske utenrikspolitiske posisjoner og diplomatiske initiativer med regional relevans.",
      en: "Norwegian foreign-policy positions and diplomatic initiatives with regional relevance.", es: "Posiciones de política exterior noruega e iniciativas diplomáticas de interés regional." },
  },
].map((source): ProfileSourceProposal => ({
  ...source, group: "social", kind: "social", publication: "premium_locked", review: socialProposalReview,
}));

export function getProfileSourceCatalog(homeCountry: HomeCountry) {
  return {
    id: homeCountry === "NO" ? "norway-mexico-sources-v1" : "sweden-mexico-publication-v1",
    homeCountry, countries: [...personalStations[homeCountry].countries],
    sources: (homeCountry === "NO" ? [...baselineSources, ...norwegianProposals, ...regionalPublicProposals, ...regionalAdvisories, ...norwegianSocialProposals] : [...baselineSources])
      .map((source) => ({ ...source, purpose: { ...source.purpose }, review: { ...source.review } })),
  };
}

export function sourceCatalogPreview(preferences: PersonalPreferences, query: { home?: string; lang?: string },
  interfaceLanguages: readonly PersonalLanguage[] = interfaceLanguagesForProfile()) {
  return {
    // Old country-preview links must not override the signed-in account's source profile.
    home: preferences.homeCountry,
    language: interfaceLanguages.find((language) => language === query.lang) ?? preferences.language,
  };
}
