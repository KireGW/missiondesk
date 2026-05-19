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

Nationell AI-bearbetning körs endast via bakgrundsjobb. `src/lib/ai/national-processing.ts` använder som standard `gpt-5-mini` via `MISSIONDESK_PROCESSING_MODEL`, `OPENAI_PROCESSING_MODEL` eller `OPENAI_MODEL`, i den ordningen. `src/lib/intelligence/national-processing-worker.ts` plockar bara `selected` kandidater som inte är regionala/stadsspecifika och inte redan processade. Backend-endpoints finns på `POST /api/intelligence/process/enqueue`, `POST /api/intelligence/process/run` och `GET /api/intelligence/processed`. Den gamla live-endpointen kör inte AI som standard; `GET /api/intelligence/live?ai=1` krävs för opt-in.

Briefinggenerering körs också via bakgrundsjobb och bygger endast på redan processade poster. `src/lib/ai/briefing-generation.ts` använder `MISSIONDESK_BRIEFING_MODEL` eller `OPENAI_BRIEFING_MODEL`, annars `gpt-5`, för slutlig syntes/polish. `src/lib/intelligence/briefing-worker.ts` väljer 5-15 högt signalvärderade poster och genererar Morgonbrief, Ambassadörsbrief, viktigaste nationella utvecklingar, brådskande utvecklingar och kommande händelser/advisories. Backend-endpoints finns på `GET /api/intelligence/briefings`, `POST /api/intelligence/briefings/enqueue` och `POST /api/intelligence/briefings/run`.

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

1. Real crawlers: implementera RSS-adapter, API-adapter för Banxico/INEGI/SCB/Riksbanken, kalenderparser och säker HTML-extraktion.
2. Lagring: vidareutveckla Postgres-schemat med normaliserade dokument, events, embeddings och användarpreferenser.
3. AI-sammanfattning: koppla LLM-pipeline för svensk översättning, relevansklassificering, scoring, event-detektion, topic extraction och talking point generation.
4. Verifiering: inför källdeduplicering, citations, confidence score, manuella analyst notes och audit trail för AI-genererade slutsatser.
5. Produktion: deploya på Vercel eller motsvarande, schemalägg ingestion, lägg till observationsloggar, rate limits och robust felhantering.
6. Autentisering: inför SSO, rollbaserad åtkomst och separata arbetsytor per ambassad/team.
7. Personalisering: låt användare spara profiler, regioner, teman, källpreferenser och briefingformat.
8. Multi-country: skapa config-loader, embassy registry och adminvy för att lägga till nya länder utan kodändringar.
