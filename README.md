# MissionDesk

MissionDesk är ett modernt underrättelse- och briefingdashboard för en svensk ambassad. MVP-versionen är byggd för Sveriges ambassad i Mexico City och använder endast livehämtade källor i dashboarden. Arkitekturen är konfigurationsdriven så att andra ambassader kan läggas till senare.

## Kom igång

```bash
npm install
npm run dev
```

Öppna sedan `http://localhost:3000`.

För produktionskontroll:

```bash
npm run build
```

## AI-bearbetning

Liveartiklar kan AI-bearbetas med OpenAI Responses API. Skapa en lokal `.env.local` och fyll i:

```bash
OPENAI_API_KEY=din_nyckel
OPENAI_MODEL=gpt-4o-mini
MISSIONDESK_AI_LIMIT=10
```

När `OPENAI_API_KEY` finns kommer `GET /api/intelligence/live` att AI-bearbeta de första relevanta liveartiklarna per hämtning. AI-lagret översätter till svenska, skapar sammanfattning, diplomatisk relevansbedömning, scoring, profil-taggar och samtalspunkter. Om nyckeln saknas eller ett AI-anrop misslyckas använder appen regelbaserad live-inramning.

## Vad som ingår i MVP

- Next.js App Router, React, TypeScript och Tailwind CSS.
- Premium dashboard med mörkt läge som standard och ljust läge via toggle.
- Livehämtning från öppna RSS-flöden för ett första riktigt nyhetslager.
- Source Manager på `/sources` för att lägga till, pausa, återställa och ta bort RSS-källor.
- Profilväljare för daglig överblick, ambassadörsbriefing, handel, politisk risk, Sverigekoppling, säkerhet, veckosammanfattning och kommande händelser.
- Tematiska filter för ekonomi, handel, inrikespolitik, utrikespolitik, Sverigekoppling, säkerhet, marknader, investeringsklimat, migration, samhälle, energi, teknik och kultur.
- Geografiska filter som bygger på config: nationell vy, regiongrupper och administrativa divisioner.
- Mexico City-konfiguration med alla mexikanska delstater, prioriterade regioner och källor.
- Morgonbrief, ambassadörsbriefing, veckosammanfattning, kommande händelser, tematisk signalmatris och källflöde.
- Scoring för brådska, diplomatisk relevans, Sverigerelevans, ekonomisk påverkan, säkerhetspåverkan och offentlig uppmärksamhet.
- Expanderbar analys med svensk sammanfattning, varför det spelar roll, risk/möjlighet och föreslagna samtalspunkter.

## Projektstruktur

```text
src/app/
  globals.css
  layout.tsx
  page.tsx
src/components/dashboard/
  MissionDashboard.tsx
src/lib/
  types.ts
  ai/pipeline.ts
  config/embassies/sweden-mexico.ts
  db/postgres.ts
  ingestion/live-intelligence.ts
  ingestion/registry.ts
  ingestion/rss.ts
  ingestion/types.ts
  intelligence/models.ts
  intelligence/repository.ts
  sources/default-sources.ts
  sources/store.ts
```

## Konfigurationsarkitektur

Ambassad- och landsspecifik logik ligger i `src/lib/config/embassies/sweden-mexico.ts`. UI-komponenterna läser:

- land, stad och ambassadnamn
- prioriterade teman
- profilviktning och score-viktning
- geografisk enhetsetikett
- regiongrupper
- administrativa divisioner
- prioriterade regioner
- källor och källtyper

För en ny ambassad skapas en ny `EmbassyConfig` med motsvarande geografimodell, källor och prioriteringar. App-logiken behöver inte känna till om landet använder delstater, provinser, departement, regioner eller kommuner.

## Data, Postgres och AI

MissionDesk använder Postgres/Neon via `DATABASE_URL` för all persistent data: källor, råa källposter, rankade kandidater, processade signaler, briefings och bakgrundsjobb. Lokal SQLite och `/tmp` används inte längre som produktionslagring.

Lokal setup:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/neondb?sslmode=require"
OPENAI_API_KEY="..."
```

Lägg värdena i `.env.local`. Kör sedan:

```bash
npm run db:migrate
npm run smoke:postgres
npm run dev
```

Vercel Production:

1. Lägg `DATABASE_URL` i Project Settings → Environment Variables → Production.
2. Lägg `OPENAI_API_KEY` i samma Production-miljö.
3. Redeploya produktionen så serverless-funktionerna får de nya variablerna.

Migrationer körs också lazy när repository-lagret används, men `npm run db:migrate` är det tydliga sättet att verifiera att Neon-schemat finns innan ingestion startas.

Källor hanteras via `/sources` och sparas i Postgres-tabellen `source_definitions`. Standardlistan innehåller nationella mexikanska källor, mexikanska delstats-/regionala källor, svenska källor och internationella källor.

Backendlagret för bredare källintelligens ligger i `src/lib/intelligence/` och `src/lib/db/`. Det modellerar råa källobjekt, processade briefingposter, cacheade briefings och bakgrundsjobb.

Appen hämtar även riktiga artiklar via `GET /api/intelligence/live`. Första liveversionen använder öppna RSS-flöden från El Universal, El Financiero, La Jornada, Expansión och BBC Latin America. Artiklarna klassificeras lokalt efter kategori och geografi. När `OPENAI_API_KEY` är satt förbättras de med AI-genererad svensk översättning, sammanfattning, scoring och diplomatisk briefing.

Lättviktsurvalet för AI-kandidater ligger i `src/lib/intelligence/ranking.ts`. Det rankar råa källobjekt utan AI med URL-/titeldeduplicering, freshness, källprioritet, trovärdighet, nyckelordsrelevans, diplomatisk relevans, Sverigerelevans, geografi, novelty och cross-source-signaler. Kandidater sparas i `ranked_processing_candidates`; dedupe-kluster sparas i `item_duplicate_clusters`, med hook-fält för framtida embeddingbaserad klustring. Backend-endpoints finns på `GET /api/intelligence/candidates` och `POST /api/intelligence/candidates/rank`.

Nationell AI-bearbetning körs endast via bakgrundsjobb. `src/lib/ai/national-processing.ts` använder `MISSIONDESK_PROCESSING_MODEL`, `OPENAI_PROCESSING_MODEL` eller `OPENAI_MODEL`, i den ordningen, annars `gpt-6-luna`. Regional bearbetning kan styras separat med `MISSIONDESK_REGIONAL_MODEL`. Befintliga miljövariabler har alltid företräde framför kodens standardvärden. `src/lib/intelligence/national-processing-worker.ts` plockar bara `selected` kandidater som inte är dubbletter eller redan processade. Backend-endpoints finns på `POST /api/intelligence/process/enqueue`, `POST /api/intelligence/process/run` och `GET /api/intelligence/processed`. Den gamla live-endpointen kör inte AI som standard; `GET /api/intelligence/live?ai=1` krävs för opt-in.

Briefinggenerering körs också via bakgrundsjobb och bygger endast på redan processade poster. `src/lib/ai/briefing-generation.ts` använder `MISSIONDESK_BRIEFING_MODEL` eller `OPENAI_BRIEFING_MODEL`, annars `gpt-6.1-sol`, för slutlig syntes/polish. Detta bevarar uppdelningen mellan lättare signalbearbetning och starkare syntes; alla artiklar skickas inte till flaggskeppsmodellen. `src/lib/intelligence/briefing-worker.ts` väljer 5-15 högt signalvärderade poster och genererar Morgonbrief, Ambassadörsbrief, viktigaste nationella utvecklingar, brådskande utvecklingar och kommande händelser/advisories. Backend-endpoints finns på `GET /api/intelligence/briefings`, `POST /api/intelligence/briefings/enqueue` och `POST /api/intelligence/briefings/run`.

Liveflöden går via:

- `src/lib/ingestion/types.ts` för råa och normaliserade källdokument.
- `src/lib/ingestion/registry.ts` för adapterbaserad RSS, webb, scraping, API och kalenderingestion.
- `src/lib/ingestion/rss.ts` för XML/RSS-parsning.
- `src/lib/ingestion/website.ts` för metadatahämtning från seriösa webb-, myndighets-, institutions- och sociala källsidor.
- `src/lib/ingestion/source-catalog.ts` för den bredare Mexico City-källkatalogen: mexikanska nationella och regionala källor, officiella myndigheter, svenska källor, internationella institutioner och betrodda publika konton.
- `src/lib/ingestion/raw-source-ingestion.ts` för backend-only råingestion till `RawSourceItem` utan AI-bearbetning.
- `src/lib/ingestion/live-intelligence.ts` för första klassificering, scoring och konvertering till MissionDesk-poster.
- `src/lib/ai/pipeline.ts` för översättning, sammanfattning, klassificering, scoring, trendanalys och briefinggenerering.

## Roadmap

### Fristående Personkonton: Lokal Pilot

Samma kodbas har nu två driftlägen. `MISSIONDESK_ACCESS_MODE` saknad eller `legacy` behåller dagens installation. `personal` är ett separat, uttryckligen aktiverat läge för personliga konton. Okända värden stänger åtkomsten i stället för att öppna motorn. Detta är ett första grundlager, inte en färdig kommersiell lansering.

- `src/lib/product/` äger abonnemang, inloggningsgräns, publiceringsurval och kostnadsreservationer. Inga ändringar görs i källadaptrar, ranking, AI-prompter eller arbetarnas beteende. Publiceringsflödet använder en separat läsande databasanslutning som inte kör motorns lazy migrations.
- Personlig inloggning förbereds med Auth0:s officiella Next.js-SDK och krypterade sessionskakor. Ingen ambassad-SSO eller intern systemintegration används. E-postadressen måste vara verifierad. Identitet kommer från SDK-sessionen; plan och budget kommer från serverns databas, aldrig från klientens uppgifter.
- Gratis har inledningsvis högst 30 redan bearbetade nyhetssignaler från senaste sju dygnen, ur fem uttryckligen valda publika nyhetskällor. Det är provisoriska produktgränser, inte en fastställd prislista. Endast detta publiceringsurval delas i en 15-minuters servercache. Konton, sökfrågor och privata uppgifter cacheas inte gemensamt.
- Sökning i personläget sker lokalt i det levererade urvalet. Visa senaste läser samma cache. Inga nya LLM-anrop, dolda AI-framtagna sökord, sociala anrop, regionala analyser eller automatiska förstagångsjobb startas. Globala briefingar publiceras inte eftersom deras underlag kan innehålla sociala eller andra ej godkända källor. Mötesurval och sökhistorik sparas tills vidare bara i aktuell vy, inte i delad lokal lagring.
- Alla befintliga motor- och käll-API:er avvisar anrop i personläget, även för Premium. Konton får inte ändra den gemensamma källistan, starta eller avbryta globala jobb. Personläget har en separat språkstyrd vy som återanvänder motorns publicerade nyhetsurval, medan den befintliga dashboarden behålls i legacy-läget.
- Premiums plan anger 30 sociala konton, högst 20 poster per konto och en körning per UTC-dygn, per abonnemang. **Betalda personfunktioner är inte aktiverade än.** Den befintliga sociala adapterns gräns på fem poster har inte ändrats. Planens avsedda funktioner ska inte förväxlas med tillgängliga funktioner i denna fas.
- `product_accounts` och `product_usage` är separata, additiva tabeller. Nya konton är Gratis och har noll extern budget. Premium kräver en giltig, tidsbegränsad serverlagrad tilldelning. Kostnadsreservationer använder kontolås i en databastransaktion, unika operationsnycklar, separata månadsbudgetar för LLM/socialt och daglig social kvot. Belopp lagras i miljondelar USD; detta är ett underlag för uppskattad förbrukning, inte automatisk avläsning av leverantörsfakturor.

#### Säker Aktiveringsordning

1. Behåll den befintliga installationen i `legacy`. Skapa en separat skyddad preview för `personal`, med en preview-databas eller databasgren. Testa inte nya kontomigrationer direkt mot produktion.
2. Konfigurera en Auth0 Regular Web Application för personliga konton. Sätt `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` (64 slumpmässiga hextecken) och ett uttryckligt `APP_BASE_URL`. Registrera exakt `<APP_BASE_URL>/auth/callback` och basadressen som tillåten utloggningsadress. Aktivera e-postverifiering och lämpligt missbruksskydd/MFA hos inloggningsleverantören. Inga hemligheter ska vara `NEXT_PUBLIC_*`.
3. Kontrollera preview-databasens adress separat. För det lokala testet används `personal:migrate` enligt nedan, med separat approll och tillfällig administratörsåtkomst till testgrenen. Det generella `product:migrate -- --apply` får bara köras med en uttryckligen konfigurerad och verifierad preview-anslutning, aldrig genom att enbart ändra driftläget ovanpå originalets `.env.local`. Migrationen körs aldrig av den befintliga motorns lazy migrations och gör bara nya produkttabeller.
4. Testa riktig registrering, verifiering, inloggning, utloggning, avstängt konto och åtskilda användare mot preview. Saknad authkonfiguration ska ge 503, inte återgång till ett öppet motorläge.
5. Före kommersiell öppning: skydda den gamla motorns driftadress och dess administrations-/jobb-API:er separat. Att personläget är skyddat säkrar inte en annan publik `legacy`-installation. Använd lägsta nödvändiga databasbehörigheter och fastställ dataskydd, gallring, kontoradering och källornas publiceringsrättigheter.
6. Innan Premiums externa anrop öppnas: bygg kontospecifika bevakningslistor och varaktig daglig körning, koppla reservation/avstämning till **varje** leverantörsanrop inklusive retries och profilläsningar, samt inför prisversioner, globalt kostnadstak, trafikbegränsningar och leverantörsavstämning. Reservera en konservativ övre kostnadsgräns innan arbete; släpp bara reservationer för arbete som säkert inte startat. Oklara/felade leverantörsanrop kan fortfarande vara debiterade. X:s licens för det faktiska användningsfallet måste vara bekräftad.
7. Betalning, automatisk abonnemangsaktivering, fler bevakningsländer, profil-/språkspecifika AI-analyser, kontoradering och serverlagrade privata mötesurval återstår. Profilvalen Sverige/Norge, Mexiko och svenska/norska sparas redan per konto. Inget nytt artikelunderlag skickas till LLM-/socialleverantörer i personlägets implementationstester.

Återgång i en **intern/skyddad** installation: sätt `MISSIONDESK_ACCESS_MODE=legacy`. Ingen radering eller återställning av produkttabeller behövs. Använd inte detta som en nödöppning av en publik personinstallation.

`npm run smoke:product` testar alla befintliga API-handlers mot personläge och felstavat driftläge, legacy-kompatibilitet, sessionsgräns, publiceringsurval, socialt bortfilter, lokal sökning, kvoter och samtidiga budgetreservationer med simulerad databas/radlås. Inga produktionsdata, betalda API-anrop eller riktiga identitetsleverantörer används. Riktiga Postgres-transaktioner och hela inloggningsflödet måste också verifieras i preview före aktivering.

#### Separat Lokal Testmiljö

Auth0 konfigureras med en egen Regular Web Application, `MissionDesk Personal Dev`, och exakt `http://localhost:3001/auth/callback`. Originalets `.env.local` används inte för testets autentisering. `scripts/setup-auth0-personal.mjs <tenant-domain>` använder en redan godkänd officiell Auth0 CLI (sätt vid behov `AUTH0_CLI_PATH`), återanvänder endast en app med rätt testmarkör och skriver nycklar direkt till `.env.personal.local` med behörighet 0600. Befintliga Auth0-appar ändras inte. Inga nycklar skrivs till terminalen.

`npm run smoke:auth0-setup` verifierar den riktiga leverantörens discovery, authorization-code-omdirigering, PKCE, nonce, callback, kakflaggor och avvisning av en förfalskad session. Det är **inte** ett genomfört användartest av registrering, inloggning eller utloggning. E-post och Google kan användas om de är aktiverade på testappen. Ej verifierad e-post ger en separat verifieringsvy utan att något appkonto eller nyhetsunderlag lämnas ut.

För databasdelen ska `.env.personal.local` innehålla den nya Neon-testgrenens `DATABASE_URL` och `MISSIONDESK_TEST_BRANCH_ID`. Den separata anslutningen måste verifieras mot Neons grenmetadata. Kopiera inte originalets databasadress. `scripts/personal-test-env.mjs` vägrar använda samma endpoint som originalet, även om den ena adressen är poolad. Den kräver också testmarkör, gren-id, rätt lokala port och skyddad nyckelfil. Betalda LLM-/X-nycklar och Gateway/OIDC-nycklar nollställs i testprocessen.

När båda anslutningarna är verifierade:

```bash
npm run personal:check
MISSIONDESK_NEON_CONFIG_DIR="$HOME/.config/missiondesk-neon" MISSIONDESK_NEON_PROFILE=personal-test npm run personal:migrate
npm run personal:smoke
npm run personal:build
npm run personal:dev
```

Testappen använder port 3001 och `.next-personal/`, så den delar varken port eller byggcache med vanliga `npm run dev`. `personal:build` använder `.next-personal-build/` och stör inte heller testets pågående dev-server. Sessionskakan heter `missiondesk_session`, inte det generiska Auth0-standardnamnet. `personal:smoke` använder riktiga Postgres-transaktioner och egna tillfälliga kontofiksturer på den verifierade testgrenen, testar kontoisolering och samtidiga kvoter och kontrollerar att motorns radantal inte ändras. Bara de skapade testkontona städas efteråt. Inga LLM-/socialanrop med API-kostnad utförs.

Testmigreringen hämtar tillfällig administratörsåtkomst till just testgrenen via den redan autentiserade Neon-profilen. Appens egen roll får endast läsa motortabellerna samt hantera konton och förbrukning. Administratörsanslutningen sparas inte i appens miljöfil. Databastestet verifierar även att approllen inte får skapa schemaobjekt eller ändra källor och jobb.

Lokal verifiering 2026-10-27: den isolerade grenen `missiondesk-personal-test-2026-10-27` är skapad med minsta compute (0,25 CU) och automatisk utgång 2026-11-03 kl. 15:22 Mexico City-tid. Detta är en tillfällig testdatabas, inte lagring för produktionskonton. Kontotabellerna är installerade. Appen använder SQL-rollen `missiondesk_personal_app`, utan det administratörsarv som Neon ger CLI-skapade roller. Riktiga databastester godkänner publiceringsflöde (26 nyheter vid kontrollen), kontoisolering, budgetlås, daglig kvot och att motorns tabeller inte ändras. Den oanvända CLI-skapade installationsrollen har tagits bort. `.env.local` och produktionsmiljön är oförändrade.

Användaren har bekräftat riktig inloggning, att nyhetsflödet visas samt efterföljande utloggning och krav på ny inloggning. En anonymiserad databaskontroll bekräftar ett aktivt Gratis-konto med noll LLM-/socialbudget och inga förbrukningsposter. Separat e-post/lösenordsregistrering och verifieringsmejl är inte verifierade av denna bekräftelse; HTTP-omdirigeringar och simulerad sessions-/e-postkontroll är testade.

#### Svenska Och Norska Profilval

`Mitt konto` har kontosparade val för hemland (Sverige/Norge) och gränssnittsspråk (svenska/norska bokmål), oberoende av varandra. Mexiko är det enda bevakningslandet i piloten. Uppgifterna ligger i den separata tabellen `product_account_preferences`, med kontots serververifierade identitet som ägare. Saknad rad ger svensk standardprofil; befintliga konton ändras inte av migrationen.

`src/lib/product/profiles.ts` äger pilotprofiler, källurval för Mexiko och regelbaserad profilrelevans. Båda profilerna delar samma fem öppna Mexikokällor och samma 15-minuters publiceringscache. Profilrelevansen räknas endast i läsvyn, påverkar aldrig sparade signalpoäng och använder inte motorns Sverige- eller ambassadspecifika relevanspoäng. Hemlandskoppling kräver ordstöd i originalrubrik eller originalutdrag. Detta är en provisorisk, transparent urvalsregel, inte en validerad norsk diplomatisk AI-bedömning.

Den norska vyn har norska gränssnittstexter men visar källornas originalrubriker och originalutdrag, med textens språk angivet. Den svenska vyn kan visa redan sparade svenska sammanfattningar. De sammanfattningarna är gemensamt underlag, inte nya analyser för den valda profilen. Inga norska översättningar eller norska briefingar skapas automatiskt. Detta och beräkningsgrunden framgår i inforutan, inte som utvecklartext i grundvyn.

Personvyn behåller aktuella signaler, separat prioritering, lokal signalspårning och mötesunderlag för utskrift. Sökning, ämnesfilter och sortering körs i webbläsaren. Mötesunderlaget påverkas inte av sökfiltret. Prioritering och mötesurval ligger tills vidare bara i den aktuella sessionens minne och delas inte via localStorage.

`PATCH /api/personal/profile` tar endast de tre profilfälten, kräver aktivt konto och samma Origin som appens basadress, accepterar endast JSON och begränsar kroppen till 2 KiB. Klienten får inte välja konto-id, abonnemang eller budget. Kontouppgifter och profilval ligger aldrig i den delade publiceringscachen. `smoke:personal-profiles` testar dessa gränser utan nätverk; `personal:smoke` testar även verklig lagring, kontoisolering och spärr för pausade konton på testgrenen. Den visuella komponentkontrollen använder syntetiska nyheter; byte av profil i användarens riktiga webbsession behöver också bekräftas.

`npm run smoke:personal-env` testar skyddsräckena utan nätverk eller databas. Använd inte äldre Neon OAuth-återkopplingslänkar: CLI:ns korta väntetid gör dem ogiltiga när den lokala mottagaren stängts. Slutför i stället aktuell CLI-inloggning direkt i en vanlig lokal terminal.

### Lägeskontroll 2026-10-27

### Genomfört I Produktion

Produktionsversionen vid kontrollen var `dpl_5UVP4BxU7z3bBzJw9EQzK8PfZAHD` på [missiondesk.vercel.app](https://missiondesk.vercel.app). Den byggdes direkt från arbetskopian ovanpå `2d9c034`, innan ändringarna versionshanterades.

- 54 aktuella signaler ombearbetades med `gpt-6-luna`. Sex andra poster uteslöts som fel landinnehåll eller odaterat referensmaterial. De tidigare analyserna finns i den ignorerade lokala filen `reports/pre-reprocess-2026-10-27.json`.
- Fem nya briefingar skapades med `gpt-6.1-sol`. Produktionsinställningarna för dessa två modellroller är explicita.
- Daglig överblick har nu tre signaler med hög relevans (76, 73, 67), jämfört med noll för samma urval före ombedömningen. Mätningen använder samma nya sammanvägning på gamla respektive nya delpoäng. Ingen av de 54 ombearbetade signalerna har längre samtliga delpoäng högst 10.
- Gamla Business Sweden-rapporter visas under en separat flik för referensmaterial. De ingår inte som färska prioriterade signaler eller som underlag till nya nyhetsbriefingar.
- Aristegui använder sitt verifierade officiella Mexiko-RSS och Milenio sin fungerande politiksida. AP, IMF, SvD, DOF och SCJN är pausade med förklaring i källistan. Totalt finns 65 källor, varav 56 aktiva. Pausade myndighetskällor behöver tills vidare kontrolleras manuellt; de ska inte räknas som fullgod automatisk täckning.
- Totalt 202 övergivna junijobb avbröts efter uttryckliga godkännanden: först 194, därefter åtta med nya oktoberlås. Dagens 60 tidsanalysjobb slutfördes: 54 underlag behandlades och sex utanför källfokus hoppades över. Tretton tidsbaserade signaler lagrades; övriga hade motiverade bortval. Produktionskontrollen visade inga väntande eller körande jobb och Framåtblicks status var inaktiv. Tidsanalysen behåller tills vidare sin tidigare modell `gpt-5-mini`, till skillnad från den uppgraderade nationella bearbetningen och briefingsyntesen.
- Kösystemets hämtning av jobb är nu atomisk (`FOR UPDATE SKIP LOCKED`) så att samtidiga arbetare inte plockar samma jobb. Källistan skrivs atomiskt i ett enda databasanrop i stället för radering följd av många separata återinläggningar.
- Tolv oberoende syntetiska relevansfall passerade ett riktigt API-prov. Det ersätter inte ett större mänskligt granskat facit på verkliga artiklar. Bygge, sju testsviter och fullständig lint passerar. Publik sida, signal-API, briefing-API och käll-API har verifierats efter publicering; inga error/fatal-loggar hittades i den kontrollerade driftperioden.

Kvarstående driftarbete: ersätt lösa bakgrundslöften och webbläsardriven refresh med varaktig jobbkörning som kan fortsätta efter timeout eller ny driftsättning. Den nuvarande underhållskörningen slutför kön, men den ändrar inte denna arkitektur. Granska också källtextextraktion och geografiska taggar separat, särskilt risken att navigationsinnehåll räknas som artikelinnehåll. Framåtblick behöver ett eget kvalitetsfacit och granskning av historiska framtidssignaler: köstatusen är rättad, men kontrollen hittade fortfarande generella riskprognoser och ett felaktigt årtal i en sammanfattning. Det nationella relevansfacit på tolv fall verifierar inte dessa tidsanalyser.

### Signalspårning Efter Driftkontrollen

Signalspårning har en separat, förvalt avmarkerad ruta: **Sök i kopplade sociala medier-konton**. Bara ett uttryckligt val inkluderar sparade sociala medier-poster och hämtar nya från aktiva, kopplade konton. Servern blockerar sociala anrop även när webb-/RSS-sökning är på; den äldre automatiska X-flaggan aktiverar inte längre social sökning. Sociala medier och utökad webb-/RSS-sökning kan väljas oberoende av varandra. Inforutan beskriver de tre kryssrutorna, sparad svensk text och möjliga API-/AI-kostnader, inklusive separat AI-framtagning av sökordens språkvarianter.

`npm run smoke:signal-tracking` verifierar tio scenarier med simulerad databas och simulerade nätverkssvar, utan betalda API-anrop. Dessa efterföljande ändringar ingick inte i produktionsversionen ovan.

### Lägesbildens Tidsstämplar

Grundvyn visar bara **Senast uppdaterad**, följt av den senaste tiden för källkontroll, signalbearbetning eller briefinguppdatering, alltid i Mexico City-tid. De separata tiderna och daterade antal från senaste slutförda flödeskörning finns endast i inforutan. Det korta kvittot efter en körning visas bara i 30 sekunder och återkommer inte vid senare omladdning. Färskhetsmarkeringen följer fortfarande källkontrollen, inte en nyare AI-bearbetning.

Bearbetnings- och briefingtid hämtas från de senaste sparade händelserna i databasen, oavsett om jobbet kördes normalt eller som manuell revision. Fullständiga källkontroller registreras separat i befintlig `ingestion_update_state`; enstaka källor, pågående delbatcher och helt misslyckade kontroller gör inte hela flödet färskare. Äldre installationer använder tills vidare den tidigare sparade flödestiden som källtid. Apppublicering påverkar inga datatider.

`GET /api/intelligence/status` ger en liten, läsande sammanställning utan artikeltext eller start av bakgrundsjobb. Den kontrolleras högst en gång per minut medan sidan är synlig samt när fliken återfår fokus. `npm run smoke:dashboard-status` testar tidszon, oberoende tider, kvittots utgång och fullständiga respektive begränsade källkontroller med simulerade underlag.

### Förkontroll

Den anslutna appdatabasen hade 9 330 råposter och 1 307 processade signaler vid kontrollen. Senaste manuella uppdateringen försökte 61 källor, lagrade 511 nya råposter och bearbetade 60 signaler. Av dessa hade 55 samtliga fem poäng högst 10, trots ett avsett intervall 0-100. Detta är ett starkt tecken på felkalibrering, inte bevis för att varje låg poäng ska multipliceras med tio.

Business Sweden Mexicos sida länkade till globala artiklar. Den generiska hämtaren valde gamla Tysklandsartiklar, utan publiceringsdatum, och källans förvalda land blev sedan Mexiko. Källan har nu ett uttryckligt innehållsfilter som tillämpas före länkurval och artikelhämtning. Även äldre sådana poster filtreras ur rålistor, kandidater, signaler och framtidssignaler utan att raderas. Redan skrivna briefingtexter måste däremot genereras om.

Verifiering av den nya hämtningen gav Mexikos företagsklimatrapporter för 2025, 2024 och 2023 i stället för Tysklandsartiklar. Landfiltret fungerar alltså, men rapporterna saknar fortfarande publiceringsdatum i hämtningen och ska inte likställas med färska nyhetssignaler. Datumextraktion och tydlig separation mellan referensmaterial och nyheter återstår.

Relevansbedömningen har nu ett gemensamt 0-100-kontrakt med kalibrerade dimensioner och validering. Geografiska taggar begränsas till konfigurerade delstats-id:n. Sammanvägningen använder diplomatisk relevans, den starkaste sakdimensionen och brådska, med normaliserade profilvikter. Avsaknad av en Sverigekoppling sänker därmed inte automatiskt en viktig mexikansk handels- eller säkerhetssignal. Generella utlandsnyheter utan innehållsbelagd Mexikokoppling begränsas till bakgrundsnivå i huvudvyn.

Fem befintliga artiklar provkördes med `gpt-6-luna`, utan databasändringar. En transportblockad fick diplomatisk relevans 70 och ekonomisk påverkan 80; en mindre tunnelbanenyhet fick diplomatisk relevans 20; en tysk finanspolitisk artikel fick 5; Mexikos FN-samarbete fick 45; en undersökning om svenska företag i Mexiko fick Sverigerelevans 85. Provet kontrollerar kalibrering och format, inte generell modellkvalitet. Blockadexemplet ligger nära ett av instruktionernas kalibreringsankare, så siffrorna är inte ett oberoende benchmark.

Aktuella primärhämtningar lyckades för bland annat El Universal, El Financiero, La Jornada, Expansión, El Economista, Animal Político och flera mexikanska myndigheter. Milenio och Aristegui gav inga RSS-poster; detta rapporteras nu som ett fel i stället för tyst framgång. Konfigurerad webb-fallback används vid RSS-fel. AP och IMF svarade 403, SvD:s utrikessida 404, och DOF/SCJN hade hämtningsfel i testet. Enskilda utfall kan vara tillfälliga. Sociala konton och marknadsadaptern ingick inte i primärkontrollen.

Ursprunglig arbetsordning från förkontrollen (utfallet står ovan):

1. Granska ändringarna, sätt explicit `MISSIONDESK_PROCESSING_MODEL=gpt-6-luna` och `MISSIONDESK_BRIEFING_MODEL=gpt-6.1-sol` i rätt driftmiljö och deploya. Lokala och produktionsinställningar skilde sig: lokalt var bearbetningsmodellen `gpt-5`, medan senaste sparade körningen använde `gpt-5-mini`.
2. Ombearbeta ett avgränsat aktuellt urval och generera om briefingarna. Ändringarna rättar inte redan sparade poäng, och nya briefingmodellens kvalitet har ännu inte provats i skarpt syntesflöde.
3. Hantera övergivna jobb med förhandsvisning och uttryckligt urval, inte massomstart. Kontrollens jobblista innehöll 20 körande briefingjobb, 8 körande signaljobb, 31 körande tidsanalysjobb samt 208 väntande tidsanalysjobb; flera var kvar sedan juni. Antalen är en ögonblicksbild och kan ändras. Ingen sådan städning har körts.
4. Återställ eller ersätt blockerade/trasiga källor, följ upp utfall per källa och mät hur mycket av AI-urvalet som faktiskt handlar om Mexiko. Primärkontrollen bevisar inte korrekt artikelinnehåll för samtliga källor.
5. Gör jobbkörningen oberoende av webbläsarens statuspollning. Kontrollera återhämtning efter avbrutna serverless-anrop innan gammal kö återaktiveras.
6. Inför ett större oberoende relevansfacit med viktiga Mexikosignaler, rutinnyheter och negativa utlandsexempel. Åtgärda även befintliga React-lintfel och uppdatera den äldre MVP-roadmapen nedan.

Läsande diagnostik (ingen migration, inga databasändringar eller AI-anrop):

```bash
npm run audit:mission
npm run audit:mission -- --check-sources
npm run audit:mission -- --check-source=business-sweden-mexico
npm run smoke:mission
```

Separat modellprov använder betalda API-anrop för högst fem befintliga artiklar men skriver inte till databasen. Kör endast efter godkännande av artikelöverföringen:

```bash
npm run eval:signals -- --model=gpt-6-luna
```

Modellroller och kompatibilitet kontrollerades mot [OpenAI:s aktuella dokumentation](https://developers.openai.com/api/docs/guides/latest-model). Kontoåtkomst verifierades via modellistan, och Luna provades enligt ovan. API-nycklar och databaslösenord ska aldrig ingå i rapporter eller versionshistorik.

### Äldre MVP-roadmap

1. Real crawlers: implementera RSS-adapter, API-adapter för Banxico/INEGI/SCB/Riksbanken, kalenderparser och säker HTML-extraktion.
2. Lagring: vidareutveckla Postgres-schemat med normaliserade dokument, events, embeddings och användarpreferenser.
3. AI-sammanfattning: koppla LLM-pipeline för svensk översättning, relevansklassificering, scoring, event-detektion, topic extraction och talking point generation.
4. Verifiering: inför källdeduplicering, citations, confidence score, manuella analyst notes och audit trail för AI-genererade slutsatser.
5. Produktion: deploya på Vercel eller motsvarande, schemalägg ingestion, lägg till observationsloggar, rate limits och robust felhantering.
6. Autentisering: inför SSO, rollbaserad åtkomst och separata arbetsytor per ambassad/team.
7. Personalisering: låt användare spara profiler, regioner, teman, källpreferenser och briefingformat.
8. Multi-country: skapa config-loader, embassy registry och adminvy för att lägga till nya länder utan kodändringar.
