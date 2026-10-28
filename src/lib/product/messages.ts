import type { IntelligenceCategory } from "@/lib/types";
import type { PersonalLanguage } from "@/lib/product/profiles";

const sv = {
  account: "Mitt konto", back: "Till flödet", signIn: "Logga in", continueLogin: "Fortsätt till inloggning", signOut: "Logga ut",
  verify: "Verifiera din e-postadress", verifyMessage: "Bekräfta e-postadressen via meddelandet från inloggningstjänsten. Logga sedan in igen.",
  signInAgain: "Logga in igen", unavailable: "Personlig inloggning är inte tillgänglig än.", suspended: "Kontot är pausat.",
  safety: "Endast öppna källor. Lägg inte in konfidentiella uppgifter.",
  profile: "Bevakningsprofil", homeCountry: "Hemland", targetCountry: "Bevakningsland", language: "Språk",
  sources: "Bevakningskällor", sourceProposal: "Källförslag", sourceDraft: "Preliminär startmall",
  sourceBaseline: "Befintligt nyhetsurval", sourceNorway: "Norska och bilaterala källor", sourceMexico: "Mexikanska institutioner", sourceSocial: "Sociala medier · Premium",
  sourceExisting: "Ingår i sparat urval", sourceProposed: "Föreslagen · ej ansluten", sourcePremium: "Premiumförslag · låst",
  sourceReview: "Granskningsnotering", sourceReviewed: "Kontrollerat", sourceEvidence: "Officiell hänvisning", sourceInfo: "Om källmallen",
  sourceInfoBody: "Detta är startmallar för granskning, inte redigerbara kundlistor. Förhandsvisningen ändrar inte ditt konto, din kvot eller motorns källista. Fem baskällor ingår redan i det sparade nyhetsurvalet. Nya förslag hämtas inte automatiskt. Innan anslutning behöver hämtning, Mexikofilter, datum och användningsvillkor kontrolleras. Egna sparade källval kopplas till arbetsytor i nästa steg.",
  sourceKinds: { news: "Nyheter", advisory: "Reseinformation", reference: "Referensmaterial", social: "Socialt konto" },
  sweden: "Sverige", norway: "Norge", mexico: "Mexiko", swedish: "Svenska", norwegian: "Norska (bokmål)",
  save: "Spara profil", saving: "Sparar...", saved: "Profilen har sparats.", saveError: "Profilen kunde inte sparas. Försök igen.",
  subscription: "Abonnemang", free: "Gratis", social: "Sociala medier", ai: "AI på begäran", inactive: "Inte aktiverat",
  premiumLater: "Premium · inte öppet för beställning", feed: "Nyhetsurval", days: "dagar", signals: "signaler",
  profileName: "Omvärldsbevakning", current: "Aktuella signaler", prioritized: "Prioriterade", meeting: "Mötesunderlag", tracking: "Signalspårning",
  lastUpdated: "Senast uppdaterad", notRecorded: "Ej registrerat", timezone: "Mexico City-tid", latest: "Visa senaste",
  information: "Om urval och relevans", info: "Sparade nyheter från fem öppna källor. Profilrelevansen är regelbaserad och använder ekonomisk påverkan, säkerhet, brådska och källans uttryckliga hemlandskoppling. Den är inte en ny AI-analys för Sverige eller Norge. Den norska vyn visar originaltext; svenska sammanfattningar översätts inte automatiskt. Visa senaste hämtar bara sparat material och startar inga externa API-anrop.",
  search: "Sök i sparade signaler", query: "Sök efter ämne eller aktör", category: "Ämne", allCategories: "Alla ämnen",
  homeOnly: "Enbart hemlandskoppling", sort: "Sortera", relevance: "Profilrelevans", newest: "Senaste först",
  prioritize: "Prioritera", source: "Källa", contentLanguage: "Textspråk", original: "Originaltext", summary: "Sammanfattning",
  openSource: "Öppna källa", remove: "Ta bort", clearSelection: "Töm urval", print: "Skriv ut", theme: "Växla färgtema",
  empty: "Inga signaler matchar urvalet.", emptyMeeting: "Inga signaler är valda till mötesunderlaget.",
  refreshError: "Flödet kunde inte läsas in. Försök igen.", selected: "valda", connection: "Hemlandskoppling",
  sourceLanguages: { sv: "svenska", nb: "norska", no: "norska", es: "spanska", en: "engelska" } as Record<string, string>,
  categories: {
    economy: "Ekonomi", trade: "Handel", domestic_politics: "Inrikespolitik", foreign_policy: "Utrikespolitik",
    sweden_connection: "Utrikespolitik", security: "Säkerhet", markets: "Marknader", investment_climate: "Investeringsklimat",
    migration: "Migration", society: "Samhälle", energy: "Energi", technology: "Teknik", culture_soft_power: "Kultur",
  } satisfies Record<IntelligenceCategory, string>,
};

const nb: typeof sv = {
  account: "Min konto", back: "Til nyhetsstrømmen", signIn: "Logg inn", continueLogin: "Fortsett til innlogging", signOut: "Logg ut",
  verify: "Bekreft e-postadressen din", verifyMessage: "Bekreft e-postadressen via meldingen fra innloggingstjenesten. Logg deretter inn på nytt.",
  signInAgain: "Logg inn på nytt", unavailable: "Personlig innlogging er ikke tilgjengelig ennå.", suspended: "Kontoen er satt på pause.",
  safety: "Kun åpne kilder. Ikke legg inn konfidensielle opplysninger.",
  profile: "Overvåkingsprofil", homeCountry: "Hjemland", targetCountry: "Land som overvåkes", language: "Språk",
  sources: "Overvåkingskilder", sourceProposal: "Kildeforslag", sourceDraft: "Foreløpig startmal",
  sourceBaseline: "Eksisterende nyhetsutvalg", sourceNorway: "Norske og bilaterale kilder", sourceMexico: "Meksikanske institusjoner", sourceSocial: "Sosiale medier · Premium",
  sourceExisting: "Inngår i lagret utvalg", sourceProposed: "Foreslått · ikke tilkoblet", sourcePremium: "Premiumforslag · låst",
  sourceReview: "Vurderingsnotat", sourceReviewed: "Kontrollert", sourceEvidence: "Offisiell henvisning", sourceInfo: "Om kildemalen",
  sourceInfoBody: "Dette er startmaler for vurdering, ikke redigerbare kundelister. Forhåndsvisningen endrer ikke kontoen, kvoten eller motorens kildeliste. Fem basiskilder inngår allerede i det lagrede nyhetsutvalget. Nye forslag hentes ikke automatisk. Før tilkobling må innhenting, Mexico-filter, datoer og bruksvilkår kontrolleres. Egne lagrede kildevalg knyttes til arbeidsområder i neste trinn.",
  sourceKinds: { news: "Nyheter", advisory: "Reiseinformasjon", reference: "Referansemateriale", social: "Sosial konto" },
  sweden: "Sverige", norway: "Norge", mexico: "Mexico", swedish: "Svenska", norwegian: "Norsk (bokmål)",
  save: "Lagre profil", saving: "Lagrer...", saved: "Profilen er lagret.", saveError: "Profilen kunne ikke lagres. Prøv igjen.",
  subscription: "Abonnement", free: "Gratis", social: "Sosiale medier", ai: "KI på forespørsel", inactive: "Ikke aktivert",
  premiumLater: "Premium · ikke åpent for bestilling", feed: "Nyhetsutvalg", days: "dager", signals: "signaler",
  profileName: "Omverdensovervåking", current: "Aktuelle signaler", prioritized: "Prioriterte", meeting: "Møteunderlag", tracking: "Signalsøk",
  lastUpdated: "Sist oppdatert", notRecorded: "Ikke registrert", timezone: "Mexico City-tid", latest: "Vis siste",
  information: "Om utvalg og relevans", info: "Lagrede nyheter fra fem åpne kilder. Profilrelevansen er regelbasert og bruker økonomisk påvirkning, sikkerhet, hastegrad og kildens uttrykkelige tilknytning til hjemlandet. Den er ikke en ny KI-analyse for Sverige eller Norge. Den norske visningen bruker originaltekst; svenske sammendrag oversettes ikke automatisk. Vis siste henter kun lagret materiale og starter ingen eksterne API-kall.",
  search: "Søk i lagrede signaler", query: "Søk etter emne eller aktør", category: "Emne", allCategories: "Alle emner",
  homeOnly: "Kun tilknytning til hjemlandet", sort: "Sorter", relevance: "Profilrelevans", newest: "Nyeste først",
  prioritize: "Prioriter", source: "Kilde", contentLanguage: "Tekstspråk", original: "Originaltekst", summary: "Sammendrag",
  openSource: "Åpne kilde", remove: "Fjern", clearSelection: "Tøm utvalg", print: "Skriv ut", theme: "Bytt fargetema",
  empty: "Ingen signaler samsvarer med utvalget.", emptyMeeting: "Ingen signaler er valgt til møteunderlaget.",
  refreshError: "Nyhetsstrømmen kunne ikke lastes. Prøv igjen.", selected: "valgte", connection: "Tilknytning til hjemlandet",
  sourceLanguages: { sv: "svensk", nb: "norsk", no: "norsk", es: "spansk", en: "engelsk" },
  categories: {
    economy: "Økonomi", trade: "Handel", domestic_politics: "Innenrikspolitikk", foreign_policy: "Utenrikspolitikk",
    sweden_connection: "Utenrikspolitikk", security: "Sikkerhet", markets: "Markeder", investment_climate: "Investeringsklima",
    migration: "Migrasjon", society: "Samfunn", energy: "Energi", technology: "Teknologi", culture_soft_power: "Kultur",
  },
};

export const personalMessages = (language: PersonalLanguage) => language === "nb" ? nb : sv;

export function personalDate(value: string | undefined, language: PersonalLanguage) {
  if (!value || !Number.isFinite(Date.parse(value))) return personalMessages(language).notRecorded;
  return new Intl.DateTimeFormat(language === "nb" ? "nb-NO" : "sv-SE", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Mexico_City",
  }).format(new Date(value));
}
