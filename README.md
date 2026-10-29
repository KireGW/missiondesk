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
- Personlig inloggning använder Auth0:s officiella Next.js-SDK och krypterade sessionskakor. Ingen ambassad-SSO eller intern systemintegration används. E-postadressen måste vara verifierad, alternativt ska det stabila Auth0-subjektet vara administrativt godkänt för användarnamn enligt nedan. Identitet kommer från SDK-sessionen; plan och budget kommer från serverns databas, aldrig från klientens uppgifter.
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

Den isolerade grenen skapades 2026-10-27 som `missiondesk-personal-test-2026-10-27` med minsta compute (0,25 CU) och sju dagars utgång. Den har därefter gjorts varaktig som `missiondesk-personal-pilot`, utan utgångsdatum; det tidigare datumet 2026-11-03 gäller inte längre. Gren-id och endpoint är oförändrade och huvuddatabasen är fortsatt separat. Detta är nu pilotlagring, inte en disponibel databas som får återställas från sin förälder. Appen använder SQL-rollen `missiondesk_personal_app`, utan det administratörsarv som Neon ger CLI-skapade roller. Riktiga databastester godkänner publiceringsflöde, kontoisolering, budgetlås, daglig kvot och att motorns tabeller inte ändras. `.env.local` och den publika produktionsmiljön är oförändrade.

Användaren har bekräftat riktig inloggning, att nyhetsflödet visas samt efterföljande utloggning och krav på ny inloggning. En anonymiserad databaskontroll bekräftar ett aktivt Gratis-konto med noll LLM-/socialbudget och inga förbrukningsposter. Separat e-post/lösenordsregistrering och verifieringsmejl är inte verifierade av denna bekräftelse; HTTP-omdirigeringar och simulerad sessions-/e-postkontroll är testade.

#### Daniels Varaktiga Pilotkonto

Daniel har ett riktigt Auth0-konto med ett stabilt `user_id` och samma befintliga `product_accounts.id`. Profil, abonnemang och förbrukning kopplas till dessa ID:n, aldrig till ändringsbart användarnamn eller e-post. Norge/Mexiko/bokmål och Gratis med noll extern budget är bevarade. Namn- och lösenordsbyte kräver inte ett nytt konto.

`product_username_logins` lagrar administratörens uttryckliga godkännande för det kontot: Auth0-anslutning, visningsnamn, aktiv flagga och tidigaste tillåtna sessionstid. Approllen har enbart SELECT på tabellen och får inte godkänna fler konton eller häva sessionsspärrar. Varje begäran använder SDK-verifierat Auth0-subjekt och SDK-sessionens `internal.createdAt`, aldrig ett inkommande användarnamn eller en lokal miljölista. Den tidigare `MISSIONDESK_LOCAL_DEMO_USER_ID`-genvägen är borttagen. Oregistrerade användarnamnskonton och vanliga overifierade e-postkonton nekas fortfarande.

`MISSIONDESK_USERNAME_CONNECTION` väljer vilken stängd Auth0-anslutning inloggningsknappen använder, men ger i sig ingen kontobehörighet. Den tekniska anslutningen behåller namnet `MissionDesk-Daniel-Dev` för att inte skapa en ny identitet; namnet är inte längre en testbehörighet. Google-/e-postanslutningar är oförändrade. `Mitt konto` visar Daniel utan testetikett och erbjuder inloggning med användarnamn när relevant.

Administrera kontot med `scripts/manage-daniel-account.mjs`. Kör med `AUTH0_CLI_PATH`, `MISSIONDESK_NEON_CONFIG_DIR` och `MISSIONDESK_NEON_PROFILE` satta till de redan godkända CLI-installationerna. Åtgärder: `status`, `promote`, `norwegian-interface`, `rename <nytt-anvandarnamn>` och `rotate-password`. Verktyget verifierar både Auth0-identitet, stängd anslutning och den isolerade databasgrenens endpoint innan det skriver. Det vägrar huvuddatabasen och skapar aldrig en ersättningsidentitet. `promote` tar bort grenens utgång och godkänner samma konto, utan att byta lösenord eller profil. `norwegian-interface` ger just Daniel kontots norska UI-språklista och byter endast ett eventuellt tidigare svenskt UI-val till bokmål; signaltextval, lösenord och bevakningsprofil bevaras. Det äldre `setup-daniel-demo.mjs` är spärrat för ett redan permanent konto.

Namn- och lösenordsbyte är separata Auth0-operationer. Båda spärrar tidigare appsessioner innan leverantörsanropet; en avbruten begäran ger alltså inte fortsatt åtkomst med en gammal appsession. Lösenordsbyte genererar 15 läsbara tecken utan att sänka policyn. `.env.daniel-demo.local` är fortsatt den privata 0600-inloggningsfilen (historiskt filnamn, git-ignorerad). En privat pending-fil gör osäkra leverantörssvar återhämtningsbara; inga lösenord skickas som CLI-argument eller loggas. `smoke:managed-account` testar namnbyte, lösenordsbyte, bevarad identitet, sessionsspärr före leverantörsanropet, återhämtning och nekad administration utan godkännande, utan riktiga leverantörsanrop.

Varaktigt pilotkonto betyder inte att en publik lansering är gjord. Appen körs fortfarande separat på localhost:3001, med Auth0:s befintliga utvecklingsapp/tenant. Före åtkomst från Daniels dator behövs en separat skyddad publicering och exakta callback-adresser. E-postfri återställning sker nu administrativt, inte via ett fungerande återställningsmejl. Före överlämning behöver Daniel ett eget lösenord och en överenskommen återställningsväg; behåll inte delade inloggningsuppgifter. Norska källförslag är fortfarande en startmall och kopian av nyhetsmotorn synkas inte automatiskt med huvuddatabasen. Ingen ny inhämtning, LLM eller social API-användning aktiveras av kontoförändringen.

Verifierat 2026-10-27 efter övergången: Neons gren saknar utgångsdatum, Daniel har samma konto-ID/profil och en ny riktig Auth0-inloggning med de oförändrade uppgifterna visar `Daniel` utan testetikett. Riktiga databastester bekräftar att approllen inte kan skriva godkännanden. Mockade administrationstester visar att namn-/lösenordsbyte bevarar ID och profil och spärrar äldre sessioner; Daniels verkliga användarnamn och lösenord har inte ändrats av dessa tester.

#### Separat Onlinepilot

Onlinepiloten använder ett eget Vercel-projekt, `missiondesk-pilot`, med adressen `https://missiondesk-pilot.vercel.app`, personläge och `MISSIONDESK_PILOT_INVITE_ONLY=true`. Den befintliga installationen på `missiondesk.vercel.app` behåller sitt projekt och sin produktionsversion. Pilotgrenen `codex/personal-profiles-norway` utlöser inte Git-baserade automatbyggen: `vercel.json` stänger av just den grenen så att den inte också publiceras som en legacy-preview i huvudprojektet. Publicering sker uttryckligen till pilotens projekt-ID från en ren export av en granskad Git-commit, utan lokala miljöfiler eller testartefakter.

`scripts/setup-online-pilot.mjs --configure` verifierar det befintliga aktiva Gratis-kontot och dess godkännande innan projektet konfigureras. Det använder samma varaktiga pilotdatabas och `missiondesk_personal_app`, men en separat Auth0 Regular Web Application, `MissionDesk Online Pilot`, och en egen sessionsnyckel. Bara den befintliga stängda användarnamnsanslutningen aktiveras för den nya applikationen. Befintliga anslutningars övriga klienter och den lokala applikationens callback bevaras. Auth0:s dedikerade `/connections/{id}/clients`-endpoint används; inga användaridentiteter, lösenord eller Auth0-behörighetsscope ändras av konfigurationen.

Pilotens exakta callback är `<APP_BASE_URL>/auth/callback`; utloggning tillåts bara till basadressen. Endast utvalda runtime-variabler skickas till Vercel, och databas-/Auth0-hemligheter märks som känsliga. LLM-/sociala leverantörsnycklar kopieras inte. Lokala testmarkörer, huvuddatabasens anslutning och administratörsnycklar förs inte över. Vercel Functions använder Node 22, region `iad1` och högst 60 sekunder per begäran. Inga cron-jobb installeras.

En verifierad e-postadress eller Google-session räcker inte i inbjudningsläget. Åtkomst kräver det serverlagrade, aktiva godkännandet i `product_username_logins`, rätt anslutning och en session nyare än eventuell spärr. Nekade användare skapar inga nya appkonton. Saknat/felaktigt personläge tillsammans med inbjudningsflaggan ger stängd åtkomst, aldrig ett öppet legacy-läge. Detta ändrar inte lokal e-post-/Google-inloggning där inbjudningsläget inte är aktiverat. Den publika inloggningssidan använder engelska; inloggade konton behåller sina sparade språkval.

Den privata `.env.pilot.local` har behörighet 0600, är Git-ignorerad och laddas inte av den lokala testappen. Den används även för att administratörsverktyget ska kunna verifiera just de två avsedda Auth0-applikationerna vid framtida namn-/lösenordsbyte. `reports/online-pilot-configuration.json` innehåller bara en teknisk sammanfattning, inte hemligheter. `--status` kontrollerar konfigurationen utan att ändra molninställningar. Kör med `AUTH0_CLI_PATH` till den redan godkända officiella CLI:n. `npm run smoke:pilot-access` provar nekad anonym/ej inbjuden åtkomst före kontoskapande, samma godkända identitet, sessionsspärrar och oförändrad lokal åtkomst utan riktiga leverantörsanrop.

Detta är en begränsad onlinepilot, inte en öppen kommersiell lansering. Återställning för e-postfria konton är fortsatt administrativ; före överlämning ska användaren få ett eget lösenord och återställningsvägen vara överenskommen. Prioriteringar och mötesurval ligger ännu bara i webbläsarsessionens minne och följer inte med mellan datorer. Ingen ambassad-SSO eller intern integration har införts.

#### Svenska Och Norska Profilval

`Mitt konto` visar en fast station och stationens planerade bevakningsländer. Daniels station är Norges ambassad i Mexico City med Mexiko, Nicaragua, Costa Rica, Guatemala, Honduras, El Salvador och Belize. Den svenska profilen visar Sveriges ambassad i Mexico City med Mexiko. Stationsdefinitionerna ligger i `personalStations` i `src/lib/product/profiles.ts`; varken station eller landlista är valbar. Profilvalet aktiverar inte inhämtning. Daniels separata arbetsytepilot har därefter anslutits till sex regionala RSS-källor enligt avsnittet nedan; grundflödet och den svenska motorn är oförändrade.

Gränssnittsspråk och språk för signaltext är fortsatt kontosparade, redigerbara val, oberoende av varandra. Tekniskt hemland, Mexikourval och språkval ligger i den separata tabellen `product_account_preferences`, med kontots serververifierade identitet som ägare. Engelska är förvalt gränssnittsspråk från 2026-10-28; sparade språkval gäller alltid före standardvalet. Saknad rad ger svensk stationsprofil med engelskt gränssnitt och oförändrat val av befintliga svenska sammanfattningar. Daniels nyprofilsmall använder engelska och originaltext, men skriver inte över befintliga inställningar. Inga språkval återställs vid inloggning. Profil-API:t nekar ändringar av det sparade hemlandet eller bevakningslandet, även om klienten manipuleras. Ingen databasmigrering behövs för standardvalet eller stationsvisningen.

UI-språklistan styrs av en separat kontoinställning, inte av hemlandsvalet. `product_username_logins.interface_profile` är administratörsstyrd och endast läsbar för approllen. Daniels `norwegian`-profil erbjuder engelska (`en`), bokmål (`nb`) och spanska (`es`), utan svenska. Standardkonton erbjuder engelska, svenska och bokmål. Engelska ligger först i båda listorna. Servern skickar kontots tillåtna val till formuläret och validerar dem även vid sparande; klienten får inte ange eller ändra språkprofilen. Konto, flöde, mötesvy och källkatalog har kompletta UI-texter på alla fyra språk. Källkatalogens ändamål och granskningsnoteringar finns också på engelska/spanska. Signalernas originaltext översätts inte av UI-språkvalet.

`src/lib/product/profiles.ts` äger pilotprofiler, källurval för Mexiko och regelbaserad profilrelevans för den delade femkällesbasen. Den basens poäng räknas i läsvyn och ändrar inte motorns sparade analyser. Den anslutna arbetsytans RSS-material använder däremot egna versionsbundna bedömningar enligt avsnittet Regelbaserat Arbetsyteurval nedan. Hemlandskoppling kräver ordstöd i originalrubrik eller originalutdrag. Ingen av dessa pilotregler är en validerad norsk diplomatisk AI-bedömning.

Språkvalen är uttryckligen separata: `language` är gränssnittsspråk och `contentLanguage` är antingen `original` eller `sv` (befintliga svenska rubriker/sammanfattningar). Norskt gränssnitt kan visa svenska sammanfattningar och svenskt gränssnitt kan visa originaltext. Om svensk rubrik eller sammanfattning saknas används originaltext med rätt språkmärkning. Inga nya översättningar eller AI-analyser startas av något språkval. Norska finns inte som val för signaltext förrän sådan bearbetning faktiskt är implementerad. Hemlandsprofil och relevansbedömning ändras inte av språkvalen. Detta och beräkningsgrunden framgår i inforutan, inte som utvecklartext i grundvyn.

Den explicita migreringen `productPreferencesMigrationSql` lägger till `content_language` och fyller endast saknade värden: äldre svenska UI-profiler behåller svensk signaltext och äldre norska UI-profiler behåller originaltext. En upprepad migrering skriver aldrig över ett redan valt signalspråk. Migreringen körs inte vid sidvisning och rör inga motortabeller. `scripts/verify-profile-language-migration.ts --apply`, med de autentiserade Neon-testvariablerna satta, provar verklig backfill, oförändrade profilfält, idempotens och nekade otillgängliga språk på en tillfällig undergren och städar endast den grenen efteråt.

Personvyn behåller aktuella signaler, separat prioritering och mötesunderlag för utskrift. Flödets ämnesfilter, textsökning och sortering körs i webbläsaren. Arbetsytans manuella signalspårning använder däremot serversökningen nedan och begränsas inte till det publicerade flödet. Mötesunderlaget påverkas inte av sökfiltret. Prioritering och mötesurval ligger tills vidare bara i den aktuella sessionens minne och delas inte via localStorage eller mellan användare.

`PATCH /api/personal/profile` tar endast de fyra profilfälten, kräver aktivt konto och samma Origin som appens basadress, accepterar endast JSON och begränsar kroppen till 2 KiB. Äldre formulär som bara skickar de ursprungliga tre fälten behåller kontots redan sparade signalspråk; det härleds aldrig på nytt från UI-språket. Klienten får inte välja konto-id, abonnemang eller budget. Kontouppgifter och profilval ligger aldrig i den delade publiceringscachen. `smoke:personal-profiles` testar språkens oberoende, korrekt reservtext, bakåtkompatibilitet och API-gränser utan externa anrop; `personal:smoke` testar även verklig lagring, kontoisolering och spärr för pausade konton.

Verifiering av separata språkval 2026-10-27, före den kontospecifika språklistan: migreringen provades först på en tillfällig Neon-undergren, som sedan togs bort, och installerades därefter på den separata personpiloten. Riktig webbsession visade svenska UI-texter med spansk originaltext och norska UI-texter med svenska sammanfattningar (26 signaler). Daniel återställdes till Norge/Mexiko, bokmål och originaltext, och valet fanns kvar efter omladdning. Den längsta svenska valtexten ryms vid 320 px utan horisontell sidscroll. Inga LLM-/socialanrop eller ändringar i huvuddatabasen gjordes.

Verifiering av Daniels UI-språklista 2026-10-27: engelska och spanska sparades via den riktiga kontovyn och fanns kvar efter omladdning. Engelskt flöde visade fortfarande spansk originaltext (26 signaler); båda språkens källvy hade rätt språktexter och endast bokmål/spanska/engelska som val. Spanska konto-, flödes- och källvyer ryms på 320 px utan horisontell sidscroll. Daniel återställdes till bokmål och originaltext. API-tester nekar svenska för hans språkprofil och nekar klientförsök att ändra språkprofilen; standardkontots språklista och motorns tabeller är oförändrade.

Verifiering i riktig webbsession 2026-10-27: Norge och norska bokmål sparades via kontoformuläret och fanns kvar efter omladdning. Den norska vyn laddade 26 riktiga, redan sparade nyheter med korrekt märkning av originalspråket. Prioritering och val till mötesunderlag fungerade; den valda signalen visades i mötesvyn med utskriftsknappen aktiverad. Ingen faktisk utskrift startades. De ursprungliga valen Sverige/svenska återställdes och verifierades efter omladdning. Endast testkontots profilinställningar ändrades; inga motorjobb eller LLM-/socialanrop startades.

#### Separat Norsk Källmall

`/account/sources` visar källförteckningen för den inloggade, aktiva personprofilen. Det finns ingen växling mellan Sverige och Norge. Äldre `home`-parametrar ignoreras; kontots sparade profil bestämmer alltid källurvalet. Gränssnittsspråk kan förhandsgranskas med de `lang`-värden som kontots språkprofil tillåter: engelska/svenska/bokmål för standardkonton och engelska/bokmål/spanska för Daniel. Ett otillåtet språk faller tillbaka till kontots sparade UI-språk. Inga godtyckliga källadresser eller konto-id:n tas emot.

Den norska katalogen innehåller 53 poster: 33 öppna källor och 20 låsta X-konton under Premium. Alla 33 är arbetsytesparade; efter granskningen 2026-10-28 konfigureras 12 RSS-adaptrar, 5 sidor för ändringsbevakning och 16 pausade källor. För Nicaragua, Costa Rica, Guatemala, Honduras, El Salvador och Belize finns vardera en lokal nyhetskälla, en myndighets- eller ekonomikälla och norska UD:s reseinformation. Statusen skiljer mellan nyhetsuttag, ändringsbevakning och manuell kontroll; en konfigurerad källa är inte ett löfte om lyckad åtkomst. Källorna och pausorsakerna behålls i `src/lib/product/source-catalog.ts`; fasta adaptrar och pauser i `workspace-pilot-sources.ts`. Uppdateringsbesked på huvudsidan är neutrala; granskning och teknisk diagnostik ligger i källförteckningen. Bakgrund och officiella länkar finns i [källgranskningen](docs/norway-mexico-sources.md). Den svenska motorns globala källtabell ändras inte.

Nyheter, reseinformation, referenser och statistik skiljs åt. Blockerade arkiv, dynamiska listor och det blandade regerings-RSS-flödet har tydliga granskningsnoteringar. En fungerande webblänk är inte ett godkänt automatiskt artikeluttag. X-kontona är endast förslag, inte anslutningar eller verifierade API-källor. Identitet, aktuell roll, aktivitet, användar-id, API-åtkomst och landfilter måste kontrolleras före aktivering.

Att öppna katalogen startar ingen hämtning, AI-bearbetning eller social API-användning. Arbetsyteanslutna källor och begränsade flöden markeras med aktuell serverläst status. Medlemsinbjudningar, redigerbara källval och gemensam kvot för betalda AI-/socialanrop återstår; RSS-dygnskvoten delas redan per arbetsyta. `npm run smoke:profile-sources` verifierar att mallarna är separata, att ändringar i en förhandsvisning inte ändrar andra mallar eller motorns standardkällor, samt att sociala förslag förblir låsta.

Granskningsvyn är verifierad i den riktiga testsessionen på dator samt vid 390 och 320 pixlars bredd. Den ursprungliga norska mallen hade 16 poster; efter utökningen har den 53. Svensk personmall har fortsatt 5. Navigering mellan konto och källvy fungerar. Vid den ursprungliga verifieringen ändrade förhandsvisning av land/språk inte kontots sparade Sverige/svenska-inställningar; landväxlingen är nu borttagen. Anonym åtkomst går till inloggning och legacy-installationen visar inte den nya personvyn. Produktionsinställningar och den svenska motorns källista är oförändrade.

`npm run smoke:personal-env` testar skyddsräckena utan nätverk eller databas. Använd inte äldre Neon OAuth-återkopplingslänkar: CLI:ns korta väntetid gör dem ogiltiga när den lokala mottagaren stängts. Slutför i stället aktuell CLI-inloggning direkt i en vanlig lokal terminal.

#### Isolerad Arbetsytepilot

`MISSIONDESK_WORKSPACE_PILOT` och `MISSIONDESK_WORKSPACE_REFRESH` är avstängda som standard och aktiverade endast i den privata lokala personmiljön. Åtta tabeller ligger bredvid den befintliga motorn: arbetsytor, medlemskap, offentliga källor, prenumerationer, neutrala råartiklar, versionsbundna kandidatbedömningar, dagskörningar och en sökräknare per arbetsyta. Daniels medlemskap och 33 öppna källposter är sparade på den varaktiga, icke-primära grenen `missiondesk-personal-pilot`. Huvuddatabasen och produktionen är inte ändrade.

Offentliga RSS-rubriker och korta originalutdrag lagras en gång per källa och kanonisk artikeladress. Endast fasta HTTPS-värdar accepteras. Ingen lands- eller profilrelevans avgör om en giltig råpost får lagras. En separat regelbedömning sparas per arbetsyta, innehållsversion och policyversion. Ändrad artikeltext eller ändrade bevakningsländer kan därför inte ärva ett gammalt beslut. Även när en annan arbetsyta redan hämtat källan bedöms det lagrade underlaget för den aktuella arbetsytan. Oklart land, saknat publiceringsdatum, framtida datum och svag regelrelevans behålls som `held`, inte som globalt bortval. Landindikatorerna är enkla ordregler, inte en fullständig landsklassificerare eller en validerad diplomatisk AI-bedömning.

Webbappen har RLS styrd av serververifierat konto och medlemskap. Uppdateringsmigreringen tillåter endast nödvändiga INSERT/UPDATE-kolumner för offentliga artiklar, egna bedömningar, källornas hämtningsstatus och egna dagskörningar. Appen får inte ändra källadresser, prenumerationer, medlemskap, kvotdatum eller den svenska motorns tabeller. Kontokontexten sätts transaktionslokalt; klienten väljer inte arbetsyta eller konto-ID. Saknat medlemskap ger det gamla läsflödet men nekar skanning; flera träffar gissas inte fram. En profil/arbetsyte-konflikt nekas. Arbetsyteposter blandas aldrig in i den gemensamma Mexikocachen. Ingen administratörsanslutning finns i webbappen.

Skanningen läser högst 20 RSS-poster per källa, 2 MB och 15 sekunder per svar, utan fullständiga artikelhämtningar. Ett databaslås och 15 minuters färskhetskontroll delar en hämtning mellan samtidiga arbetsytor. Begränsade flöden markeras; detta är inte en komplett arkivhämtning eller en säker upphämtningsmekanism efter längre avbrott. Den första körningen 2026-10-27 lagrade 75 råkandidater: 12 valdes och 63 behölls för senare bedömning. Confidencial och Love FM hade fler än 20 poster och markeras därför som begränsade. Inga nya LLM- eller sociala API-anrop gjordes. Databasdrift och överföring kan fortfarande kosta.

Personflödet visar arbetsytans separata urval tillsammans med tidigare sparat Mexikomaterial, inom abonnemangets visningsgräns. Dubbletter av samma kanoniska artikeladress visas inte dubbelt. Nya RSS-poster har originaltext och regelpoäng, inga AI-sammanfattningar eller översättningar. Regerings-RSS-poster utanför den godkända nyhetssökvägen behålls som referens, inte färska signaler. Tolv HTML-sidor jämförs med en innehållshash av huvudinnehållet; navigering och skript ignoreras. Första kontrollen skapar en bas, senare förändringar markeras i källistan. Detta är inte statistikutvinning, automatiserad bedömning av reseråd eller innehållsbevakning bakom JavaScript.

Knappen **Uppdatera flödet** använder `POST /api/personal/feed/refresh` och kör högst en källa per begäran. En unik databaspost per arbetsyta och kalenderdag i Mexico City delar kvoten mellan kollegor. Upprepade klick läser en färdig dagskörning; en ofärdig körning återupptas från sparade steg. Samtidiga steg låses. Fel på en källa avslutar dess försök för dagen och redovisas; det skapar inte en obegränsad omkörningsloop. `GET /api/personal/feed` förblir läsande. Ursprung, aktivt konto, medlemskap och en tom JSON-kropp kontrolleras; klienten kan inte skicka källor, arbetsyta, URL eller force-flagga. Kvittot visas kortvarigt utan utvecklarinformation i grundvyn.

Ingen automatisk schemaläggning körs ännu. Fliken driver begäran vidare medan den är öppen; en stängd flik stoppar fortsättningen men förlorar inte redan sparade steg. Nästa klick samma dag fortsätter. Sjudagarsfönstret gäller urvalet, inte fysisk gallring. Den svenska produktionsmotorn är inte omkopplad till råpoolen; däremot kan Daniels separata prenumerationer nu hämta de fem öppna Mexikoflödena direkt.

RSS-text avkodas till vanlig Unicode före längdgräns, innehållshash och landindikatorer. `sourcePlainText` använder paketet `entities` för numeriska, namngivna och dubbelt kodade HTML-tecken i bland annat CDATA. Samma normalisering vid läsning rättar redan sparade arbetsyteposter utan databasskrivning, ny hämtning eller ombedömning. Texten renderas fortsatt som React-text, inte som aktiv HTML.

#### Manuell Sökning

Aktuella signaler och Signalspårning har separata uppgifter och egna filterval. **Filtrera aktuella signaler** begränsar bara den levererade listan, normalt högst 30 poster i gratisversionen; ämne, sortering och hemlandsruta gäller samma lista. Filterfältet, ämne och sortering ligger på samma rad på breda skärmar. Varken textfiltret eller hemlandsrutan i Aktuella signaler gör serveranrop eller byter automatiskt till sökvyn.

Endast **Signalspårning** har den dedikerade, automatiska sökningen. Fältet heter **Sök i signaler och sparat källmaterial**. Efter 450 ms skrivpaus kombineras matchningar ur den befintliga 30-posterslistan med `POST /api/personal/search`, som söker rubriker och RSS-utdrag i kopplade källors sparade råmaterial. Ingen extra sökknapp krävs. Även `held`, ej ännu bedömda och daterade referenskandidater kan träffa. Automatisk publiceringsstatus är en märkning, inte ett sökfilter; sökning eller manuell prioritering skriver aldrig om kandidatens poäng/status. HTML-referenssidornas kroppar är inte textsökbara eftersom bara deras jämförelsehash lagras.

Signalspårningens resultatlista tar först med aktuella lokala träffar, sedan övriga sparade träffar, och deduplicerar kanoniska artikeladresser även när kopiorna har olika ID. Lokala originalutdrag och redan befintlig svensk text ingår också i matchningen. Högst 30 resultat visas per sida. Arkivsvar buffras så att en lokal träff inte får sparade träffar att försvinna mellan sidorna. Bakåtbläddring läser redan hämtat material; ny skrivning eller ändrad hemlandsruta avbryter föregående begäran. Samma färdiga kombination av fråga och hemlandsval återanvänds inom den öppna vyn tills flödet uppdateras. Byte från sökvyn avbryter pågående sökanrop. Flödets text-, ämnes-, hemlands- och sorteringsfilter begränsar inte den dedikerade sökningen. Prioriterade behåller också sitt eget listfilter.

I Signalspårning söker **Enbart hemlandskoppling** i hela arbetsytans sparade, behöriga material inom samma historikfönster. Rutan fungerar utan söktext och kan kombineras med en textfråga; då måste båda villkoren stämma. Det är ett eget val, oberoende av hemlandsfiltret i Aktuella signaler. Hemlandet hämtas från den inloggade profilen, inte från klienten. Namnformer från profilens fasta ordlista, exempelvis Norge/Norway/Noruega, måste förekomma som hela ord i originalrubriken eller RSS-utdraget. AI-översättningar, källnamn och URL:er är inte bevis för hemlandskoppling. Detta är fortfarande en regelbaserad textsökning, inte semantisk analys av underförstådda kopplingar.

Gratis har ett sjudagarsfönster, serverbestämt från abonnemanget. Publiceringsdatum används när det finns, annars hämtningsdatum; kända äldre eller framtida datum utanför fem minuters tolerans ger inte färska gratisträffar. Giltig Premium behåller planens befintliga 30-dagarsfönster. PostgreSQL:s indexerade fulltextsökning med `simple`-konfiguration och `websearch_to_tsquery` används i originaltext, utan språkmodell, översättning eller nya källanrop. Text- och hemlandsmatchning sker före `LIMIT 31`; högst 30 träffar skickas och den extra posten avgör om nästa sida finns. Datum/id-cursorer ger stabil sidordning och binds till både den normaliserade frågan och hemlandsvalet. Sökningen gör inte semantisk synonym- eller språkexpansion.

API:t kräver aktiv SDK-verifierad användare, samma Origin, JSON, en giltig 2–120 teckens fråga och högst 1 KiB kropp. Tom fråga tillåts endast med `homeOnly: true`; andra värden än en boolesk flagga nekas. Klienten får inte välja hemland, konto, arbetsyta, historikfönster eller antal träffar. Kontokontexten sätts transaktionslokalt och RLS avgränsar arbetsytan och källorna även efter att en poolanslutning återanvänts. Ingen kontospecifik sökcache delas. Personkonton utan arbetsyta får bara lokala träffar i sitt levererade material, med samma separata sökfält; server-API:t gissar inte deras källbehörigheter.

Missbruksskyddet tillåter 30 sökanrop per minut och 300 per kalenderdygn i Mexico City, gemensamt för arbetsytan. En atomisk räknare med fast radantal används även mellan serverinstanser. Antagningen sparas före den tidsbegränsade läsningen, så även avbrutna eller misslyckade databasläsningar räknas. Överskridande ger HTTP 429 med Retry-After. Räknaren innehåller inga sökord. Artikelhämtningens separata dygnskvot påverkas inte.

Träffar kan prioriteras och läggas till i mötesunderlaget direkt. Valda poster behålls i sessionens minne oberoende av söksida och flödets visningsgräns. En post som finns i båda listorna visas bara en gång; mötes- och prioriteringsval kan tas bort oberoende. Prioriterade har egna filter, så ett tidigare hemlandsfilter i Aktuella signaler döljer inte ett nytt sökval. Det är fortfarande inte permanent sparade prioriteringar: sidomladdning eller utloggning tömmer urvalet.

Verifierat på en disponibel Neon-undergren: 66 relevanta testträffar bakom 35 nyare icke-träffar, 30-träffars sidindelning utan dubbletter, äldre/futurexkludering, odaterat nyligt material, separata källprenumerationer, nekad anonym läsning, samtidiga kvotförsök och fönsterbyte. Signalpoäng och motortabeller ändrades inte; inga externa anrop tilläts. Därefter installerades sökindex och räknare på personpiloten. Riktig approllssökning på `lula` gav 15 träffar, samtliga utanför flödesurvalet. API-/urvalstester, lint och bygge passerar. Visuell kontroll är fortfarande blockerad.

Utökad verifiering av hemlandsrutan på en ny disponibel undergren: 35 sparade Norgekopplade testposter hittades över två sidor, både utan sökord och i kombination med textsökning. Nyare icke-träffar, delordet Noruegalandia, svenska kopplingar, andra arbetsytors källor och datum utanför fönstret uteslöts. Alla profilens norska namnformer testades. Cursorer kunde inte återanvändas efter ändrat hemlandsval. Testkällorna var egna fiksturer, och testgrenen togs bort efteråt. Ingen ny schemamigrering behövs; befintligt fulltextindex används.

Säkra verktyg med den redan autentiserade Neon-testprofilen:

```sh
export MISSIONDESK_NEON_CONFIG_DIR="$HOME/.config/missiondesk-neon"
export MISSIONDESK_NEON_PROFILE=personal-test
npm run workspace:verify -- --rehearse
npm run workspace:verify -- --apply
npm run workspace:scan -- --probe
npm run workspace:scan -- --daily
npm run smoke:workspace
npm run smoke:workspace-feed
npm run smoke:workspace-refresh
npm run workspace:search-verify -- --rehearse
npm run workspace:search-verify -- --apply
npm run workspace:search-verify -- --check
npm run smoke:workspace-search
```

`workspace:verify` provar alltid migreringen på en disponibel undergren först och tar endast bort den grenen efteråt. `--apply` installerar sedan på den beständiga piloten och räknar om sparade regler utan externa anrop. `workspace:scan --probe` provar de 12 aktiva RSS-adaptrarna utan databasskrivning. `--daily` använder samma approll, delade dagskvot och stegfunktion som knappen; den första riktiga körningen förbrukar alltså dagens skanning. Äldre `--apply` är en uttrycklig administratörsomkörning som inte följer användarkvoten och ska inte kopplas till webbappen. Huvudgren, fel endpoint och fel kontoprofil nekas.

Verifierat med riktig Postgres: båda skanningsordningar, delade hämtningar, prenumerationsavgränsning, innehållsversioner, RLS-isolering, anonym nekad läsning, delad dygnskvot mellan två kollegor, återupptagning, idempotens och oförändrade motortabeller. Appen nekas ändring av medlemskap, källadresser och kvotdatum. API-tester verifierar flaggor, autentisering, Origin, tom JSON-kropp, storleksgräns och privata felsvar. Bygge och lint passerar. Visuell slutkontroll återstår eftersom webbläsarkontrollen är avstängd.

Första riktiga dagskörningen 2026-10-27 behandlade 25 källsteg med approllen: alla 13 RSS-flöden och fem referenssidor lyckades. De sju UD-reseinformationssidorna gav HTTP 403 och visas med hämtningsfel, utöver de åtta konfigurerat pausade källorna. Körningen är därför `partial`, inte helt lyckad. Sparade aktuella innehålls-/policybeslut omfattade efteråt 18 valda och 184 icke-publicerade kandidater; detta är inte en AI-kvalitetsmätning. Ny skanning kan stängas av separat med `MISSIONDESK_WORKSPACE_REFRESH=false` utan att ta bort läsvyn eller pilotdata.

### Regelbaserat Arbetsyteurval

Från 2026-10-29 används `public-rules-v3` för pilotens arbetsytebedömningar. Källadaptrar, dygnskvot, artikelidentifierare, råtexter och den svenska motorn ändras inte. `workspace-assessment.ts` klassar rubrik och originalutdrag med flerspråkiga ord- och frasregler. Ämnen är inte längre hårdkodade som Samhälle; otillräckligt underlag visas som Ej klassificerad.

Bedömningen använder landstöd i rubrik/utdrag, profilens sakfrågor, konkreta händelseord och uttrycklig hemlandskoppling. Landnamn i förbifarten, breda regeringsord, rutinmässiga kultur-/konsumenttips och vissa historiska tillbakablickar ger inte samma vikt som relevanta politiska, ekonomiska eller konsulära händelser. Ord kan fortfarande vara tvetydiga och reglerna är inte faktagranskning eller fullständig semantisk analys.

Gränssnittet visar Hög, Medelhög eller Begränsad relevans i stället för ett skenbart exakt 0–100-tal. Beräknade internpoäng används fortfarande för sortering. Nivågränserna är 75 respektive 45; material under urvalsgränsen behålls i rålagringen och är sökbart enligt arbetsytans vanliga behörigheter och tidsfönster. Relevansnivån kan öppnas för en lokaliserad förklaring utan att fylla grundvyn med extra text. Mötesunderlaget förblir fritt från relevansetiketter.

Arbetsytans aktuella urval sorteras i SQL **före** planens LIMIT: internpoäng minus en aktualitetsjustering på en poäng per sex timmar, högst 24 poäng. Därmed kan en viktigare två dagar gammal artikel väljas framför nyare rutinmaterial. Samma funktion har verifierats med skrivskyddade PostgreSQL-fiksturer där den viktiga artikeln annars skulle hamna utanför de 30 senaste. Användarens därefter valda sortering gäller inom det aktuella urvalet; arkivsökningens cursorordning ändras inte.

`workspacePolicyKey` innehåller regelversion, hemland och bevakningsländer. Bedömningarna är separata per arbetsyta och återberäknar landstöd ur originalet, inte från en annan profils urval. Äldre policyversioner ligger kvar. Ämnen och förklaringar härleds i läsvyn med samma regelversion; ändrad regelbetydelse kräver en ny versionsnyckel och ombedömning av sparat material. Ingen schemamigrering krävs.

```bash
npm run smoke:workspace-ranking
npm run workspace:ranking-review -- --sample
npm run workspace:ranking-review -- --apply
```

Granskningsverktyget är låst till Daniels verifierade pilot och approll. `--sample` är skrivskyddat; `--apply` sparar bara den nya policyversionens bedömningar inom hans arbetsyta och kontrollerar att tidigare beslut behålls. Båda lägena blockerar externa fetch-anrop och skriver lokala, ignorerade rapporter med ett 40-artiklars stickprov. Inga LLM- eller sociala anrop, nya källhämtningar eller ändringar av dygnskörningar ingår.

Verifierat 2026-10-29: 40 manuellt genomgångna sparade artiklar, 40 flerspråkiga regeltestfall samt regressionsfall för bland annat dödstal/tull, matolja/energi, rättighets- och pensionsreformer, kultur-/turisttips, historiska tillbakablickar och konsulära resekrav. 396 sparade artiklar ombedömdes på piloten: 44 valda och 352 behållna, med gamla beslut kvar. Detta är en första regelkalibrering, inte ett av Daniel godkänt facit eller en garanti för innehållskvalitet.

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
