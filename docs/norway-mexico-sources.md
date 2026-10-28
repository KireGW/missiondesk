# Preliminär Källmall: Norge, Mexiko Och Centralamerika

Granskad 2026-10-27, pauser och statuspresentation reviderade 2026-10-28. Mall-id: `norway-mexico-sources-v1`.

Katalogen ligger separat i `src/lib/product/source-catalog.ts`. Alla 33 icke-premiumposter finns i Daniels isolerade arbetsytesprenumerationer. Konfigurationen efter granskningen innehåller 12 RSS-adaptrar, 5 sidor för ändringsbevakning och 16 pausade källor. Konfigurerad anslutning och lyckad hämtning är olika saker; pausorsaker och begränsningar dokumenteras i källistan. Huvuddatabasen, den svenska motorns källtabeller och hämtare ändras inte. Den svenska personprofilens fem publiceringskällor är inte hela den svenska motorns källista.

## Aktuell Anslutning

- RSS: de fem befintliga Mexikoflödena, de sex regionala journalistiska flödena och Belize Press Office. Varje källa ger högst 20 poster.
- Ändringsbevakning: SSB, EFTA, INEGI, Banco Central de Nicaragua och NOREF. Bara en hash av huvudinnehållet lagras; första kontrollen skapar en bas. Förändringar markeras i källistan, inte som nya artiklar. Detta extraherar inte statistik eller JavaScript-laddade resultat och ger inte garanterad ändringsdetektion för allt på sidan.
- Pausade: ambassadens nyhetssida, Innovasjon Norge, SRE, Secretaría de Economía, utrikesministerierna i Costa Rica, Guatemala, Honduras och El Salvador, sju UD-reseinformationssidor samt Regjeringens breda RSS. Åtkomst eller artikelutvinning är inte verifierad för de första åtta. De sju resesidorna gav åter HTTP 403; Regjeringens första 20 poster var framtida kalenderhändelser. Källorna och deras granskning behålls, men ingår inte i ordinarie skanning. Spärrar kringgås inte.
- Premium: alla 20 sociala kandidater förblir låsta och ingår inte i skanningen.

Knappen **Uppdatera flödet** startar eller återupptar en gemensam dagskörning för arbetsytan, räknad i Mexico City-kalenderdygn. Flera användare delar den. Avslutade källsteg upprepas inte samma dag. Ingen automatisk schemaläggning eller betald LLM-/socialtrafik ingår. De äldre granskningsanteckningarna nedan beskriver respektive källas innehåll och ursprungliga kontroll, inte alltid dagens åtkomststatus.

Historiskt utfall vid första dagskörningen 2026-10-27: alla 13 då konfigurerade RSS-adaptrar kunde hämtas. EFTA, INEGI, NOREF, SSB och Banco Central de Nicaragua gav en referensbas. Samtliga sju UD-reseinformationssidor gav HTTP 403. Inga åtkomstspärrar kringgicks. Den körningens interna status `partial` och granskningshistorik behålls även efter att källor pausats.

Huvudsidan använder neutrala uppdateringsbesked, även för äldre delvisa körningar: exempelvis **Källkontrollen är klar. Visar tillgängligt material.** Orsaker hör hemma i källförteckningens granskningsnoteringar. En källa som pausas under en pågående körning markeras internt som överhoppad, utan hämtningsanrop eller nytt hämtningsfel. Ett faktiskt avbrott i appens uppdatering visas fortfarande separat; ett sådant avbrott får inte presenteras som en lyckad uppdatering.

### Ambassadens Nyhetssida: Omkontroll 2026-10-28

Nyhetsadressen är länkad som **News** från [ambassadens officiella startsida](https://www.norway.no/es/mexico/). MissionDesks vanliga, begränsade HTTP-hämtning gav däremot **403**. Inget fungerande RSS-/Atom-flöde har verifierats. En länk till en verklig sida är alltså inte en fungerande automatisk källanslutning.

Källan förblir pausad: uppdateringsknappen hämtar inga artiklar från den och ingen AI- eller social API-kostnad uppstår. Originallänken behålls för manuell läsning. Nästa steg för automatisk import är ett av webbplatsägaren tillhandahållet flöde eller en annan uttryckligen tillåten, fungerande anslutning, följt av adaptertest och kontroll av datum och geografisk relevans. Ambassadens X-konto är en separat, fortsatt låst Premium-källa, inte en automatisk reservväg.

Diagnostiken kan upprepas med `npm run workspace:audit -- --ids=no-mx-embassy-news`. Verktyget provar bara katalogens icke-premiumadresser, skriver en separat lokal rapport i `reports/` och ändrar varken databas, källstatus eller dagskvot. En pausad sida får ett vanligt diagnostiskt anrop, inte en aktivering; åtkomstspärrar kringgås inte.

## Förslag

| Källa | Roll | Status Vid Kontroll |
| --- | --- | --- |
| El Universal, El Financiero, La Jornada Politica, Expansion Mexico, BBC Latin America | Gemensam nyhetsbas om Mexiko | De fem befintliga publiceringskällorna återanvänds. Ingen ny hälsokontroll eller ny hämtning av dessa har gjorts här. |
| [Norges ambassad: nyheter](https://www.norway.no/es/mexico/noruega-mexico/news/) | Bilaterala relationer och norsk närvaro | Omkontroll 2026-10-28: korrekt officiell länk, men automatisk hämtning gav HTTP 403. Inget fungerande RSS-/Atom-flöde verifierat. Pausad, endast manuell läsning tills anslutningen är verifierad. |
| [UD / Regjeringen: RSS](https://www.regjeringen.no/no/aktuelt/rss/id2581966/) | Norsk utrikespolitik med Mexikokoppling | Pausad 2026-10-28: de första 20 posterna var framtida kalenderhändelser. Behöver ett verifierat nyhetsurval, inte bara en URL-gräns. |
| [UD: reseinformation för Mexiko](https://www.regjeringen.no/no/tema/utenrikssaker/reiseinformasjon/velg-land/reiseinfo_mexico/id2416296/) | Konsulär bevakning | Pausad 2026-10-28 efter återkommande HTTP 403. Manuell originallänk behålls; aktiv ändringsbevakning kräver tillåten åtkomst. |
| [SSB: utrikeshandel med varor](https://www.ssb.no/utenriksokonomi/utenrikshandel/statistikk/utenrikshandel-med-varer) | Norsk handel med Mexiko | Referens/statistik. Landdimensionen måste väljas till Mexiko; den allmänna sidans totalsiffror får inte presenteras som bilateral handel. |
| [EFTA: Mexiko](https://www.efta.int/trade-relations/free-trade-network/mexico) | Avtals- och handelsreferens | Officiell Mexikosida verifierad. Referensmaterial, inte ett aktuellt nyhetsflöde. |
| [Innovasjon Norge: nyheter](https://www.innovasjonnorge.no/seksjon/nyheter) | Export och företagssamarbeten | Officiell sida verifierad, men artikelupptäckt återstår att testa. Kräver uttrycklig Mexikokoppling. |
| [NOREF: nyheter](https://noref.no/insights/news) | Fred, medling och diplomati | Officiell lista verifierad. Låg publiceringstakt och äldre material om andra länder kräver datum- och landsfilter. |
| [SRE: pressarkiv](https://www.gob.mx/sre/archivo/prensa) | Mexikansk utrikespolitik och Norgekoppling | Tidigare HTTP 403, nu HTTP 200 med artikellänkar. Fortsatt pausad: HTML-nyhetsadapter, datumens tidszon och tillåten återgivning återstår att verifiera. |
| [Secretaría de Economía: pressarkiv](https://www.gob.mx/se/archivo/prensa) | Handel och investeringar | Tidigare HTTP 403, nu HTTP 200 med artikellänkar. Fortsatt pausad i väntan på verifierad HTML-import, tidszonshantering och tillåten återgivning. |
| [INEGI: pressrum](https://www.inegi.org.mx/app/saladeprensa/) | Ekonomi och samhällsstatistik | Officiell sida verifierad, men listan laddas dynamiskt. Kräver adapterprov och korrekta statistikperioder. |
| [Ambassadens X-konto](https://twitter.com/NoruegaMexCA) | Social Premium-kandidat | Länken är verifierad från [ambassadens webbplats](https://www.norway.no/es/mexico), men aktivitet och API-åtkomst är inte verifierade. Förblir låst. |

Totalt efter utökningen 2026-10-27: 53 källposter, fördelade enligt aktuell anslutning ovan. Det tidigare ambassadkontot behålls en gång, tillsammans med 19 tillagda sociala konton. En kontolänk är inte en OAuth-anslutning och innebär inte att sociala anrop får göras.

## Regionala Källförslag

Varje land nedan har dessutom en sida för norsk reseinformation, länkad från [UD:s landlista](https://www.regjeringen.no/no/tema/utenrikssaker/reiseinformasjon/velg-land/id2414273/). Dessa ändringsbevakas separat och blir inte löpande nyhetsartiklar.

| Land | Journalistisk Källa | Myndighets- Eller Ekonomikälla |
| --- | --- | --- |
| Nicaragua | [Confidencial](https://confidencial.digital/) | [Banco Central de Nicaragua](https://www.bcn.gob.ni/notas-de-prensa) |
| Costa Rica | [The Tico Times](https://ticotimes.net/) | [Cancillería de Costa Rica](https://www.rree.go.cr/) |
| Guatemala | [Plaza Pública](https://plazapublica.com.gt/) | [MINEX](https://www.minex.gob.gt/), webbkontrollen gav 403 |
| Honduras | [Criterio.hn](https://criterio.hn/) | [Cancillería Honduras](https://sreci.gob.hn/comunicados-generales), direkt kontroll fick timeout |
| El Salvador | [GatoEncerrado](https://gatoencerrado.news/) | [Cancillería de El Salvador](https://rree.gob.sv/) |
| Belize | [Love FM](https://lovefm.com/) | [Government of Belize Press Office](https://www.pressoffice.gov.bz/) |

De sex journalistiska källornas offentliga RSS har provats och hämtats i den isolerade piloten. Första, begränsade sexkällorskörningen gav 75 råkandidater, 12 valda och 63 behållna för senare bedömning. Därefter utökades anslutningen enligt ovan. Det är regelbaserat urval av originalutdrag, inte LLM-bearbetning eller komplett landstäckning. Flöden med fler än 20 poster markeras som begränsade; fullständig arkivhämtning är inte implementerad.

Webb- och RSS-åtkomst verifierar inte återpubliceringsrättigheter. Blandade geografier, opinion, gamla artiklar och eventuella betalväggar måste hanteras; originalartiklar länkas och fullständiga sidor hämtas inte här. Användningsvillkor och tillåten återgivning behöver granskas före bredare lansering. Myndigheters egna uttalanden är inte oberoende rapportering.

## Godkänt Premium-Urval

De 20 kontona i `src/lib/product/source-catalog.ts` omfattar mexikanska beslutsfattare och guvernörer, regionala ledare och utrikesministerier, CIDH, EU-företrädare samt norska företrädare. Varje konto har ändamålsbeskrivning och granskningsnotering på svenska, bokmål, engelska och spanska. Kontots identitet, aktuella roll, aktivitet, användar-id och API-åtkomst behöver kontrolleras före teknisk aktivering. Politisk kommunikation behandlas som avsändarens uppgifter, inte som oberoende nyhetsrapportering.

Framtida sociala landsfilter ska följa stationens fullständiga bevakningsområde: Mexiko, Nicaragua, Costa Rica, Guatemala, Honduras, El Salvador och Belize. Inga sociala anslutningar eller betalda API-anrop aktiveras av att kandidaterna visas. De sex regionala RSS-källorna ovan är en separat offentlig pilot.

## Avgränsning Före Aktivering

- Publicerat arbetsyteurval behöver en uttrycklig koppling till ett bevakningsland i originalmaterialet. Källans land eller sidans navigering räcker inte som belägg. För bilateralt urval behövs även Norgekoppling. Giltiga råposter lagras däremot neutralt före profilbedömning; oklara fall behålls så att ett annat lands profil inte tappar underlaget.
- Kalenderdatum, avtalsdatum, statistikperiod och publiceringsdatum måste hållas isär. Referenser och reseinformation ska inte fylla listan över färska nyhetssignaler.
- RSS-flödet från Regjeringen svarade HTTP 200 och gav 96 tolkningsbara poster vid kontrollen, men innehöll kalenderposter med framtida datum. Dessa datum bevisar inte att nyheter nyligen publicerats.
- Åtkomstspärrar kringgås inte. Webbåtkomst betyder inte heller att automatiserad hämtning eller återpublicering är licensierad; användningsvillkor granskas före anslutning.
- Katalogvisning och GET av flödet startar inga hämtningar. Den skyddade POST-uppdateringen sparar pilotens råposter, regelbedömningar, referenshashar och framsteg inom dagskvoten. Ingen AI, global källändring eller social hämtning ingår.

## Nästa Beslut

Pilotkontakten bör bekräfta sakprioriteringar, exempelvis handel, energi, maritima frågor, fred/medling och konsulär bevakning. Därefter behöver det grova regelurvalet utvärderas på ett granskat facit. Medlemskap, 33 öppna källposter och gemensam RSS-dygnskvot finns för Daniel; inbjudningar, redigerbara källval och gemensam betald kvot återstår. Ändringar i en arbetsytas lista ska inte ändra andra arbetsytor eller den svenska motorns källista.

Pilotens separata läsväg använder RLS och aktuell innehålls-/policyversion. Gemensam råinhämtning har provats i båda skanningsordningar och med samtidiga körningar; bedömningen görs oberoende per arbetsyta. Automatisk schemaläggning, komplett upphämtning efter avbrott, fysisk gallring och överflyttning av befintlig Mexikoinhämtning till den gemensamma poolen återstår. Den publika produktionsversionen är oförändrad. Se README:s avsnitt Isolerad Arbetsytepilot för säkra test- och skanningskommandon.
