import assert from "node:assert/strict";
import { fetchWebsiteSource } from "../src/lib/ingestion/website";
import type { SourceDefinition } from "../src/lib/types";

const requests: string[] = [];

(globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  requests.push(url);

  if (url.endsWith("/robots.txt")) {
    return new Response("User-agent: *\nAllow: /\n", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  if (url === "https://example.com/news") {
    return new Response(
      `
      <html>
        <body>
          <a href="/news/2026/relevant-one">Relevant policy update in Mexico</a>
          <a href="/news/2026/already-seen">Already seen update in Mexico</a>
          <a href="https://external.example.org/story">External story</a>
          <a href="/files/report.pdf">Download report</a>
        </body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  if (url === "https://example.com/news/2026/relevant-one") {
    return new Response(
      `
      <html>
        <head>
          <meta property="og:title" content="Relevant policy update in Mexico" />
          <meta property="og:description" content="A short operational update from the configured source." />
          <meta property="article:published_time" content="2026-05-20T10:00:00-06:00" />
        </head>
        <body><h1>Relevant policy update in Mexico</h1></body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  throw new Error(`Unexpected fetch: ${url}`);
};

const source: SourceDefinition = {
  id: "website-smoke",
  name: "Website Smoke",
  country: "Mexico",
  language: "es",
  type: "website",
  url: "https://example.com/news",
  trustTier: 2,
  categories: ["domestic_politics"],
  enabled: true,
  sourceCategory: "media",
  retrieval: { primary: "website" },
};

const result = await fetchWebsiteSource(source, {
  limit: 20,
  isKnownUrl: async (url) => url === "https://example.com/news/2026/already-seen",
});

assert.equal(result.documents.length, 1);
assert.equal(result.documents[0].url, "https://example.com/news/2026/relevant-one");
assert.equal(result.documents[0].publishedAt, "2026-05-20T16:00:00.000Z");
assert.equal(result.stats.websiteSourcesScanned, 1);
assert.equal(result.stats.pagesFetched, 2);
assert.equal(result.stats.newUrlsFound, 1);
assert.equal(result.stats.duplicatesSkipped, 1);
assert.equal(result.stats.candidatesSentToAnalysis, 1);
assert.equal(result.errors.length, 0);
assert(!requests.includes("https://external.example.org/story"));
assert(!requests.includes("https://example.com/files/report.pdf"));

console.info("[smoke:website] Website ingestion adapter smoke check passed.");

requests.length = 0;

(globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  requests.push(url);

  if (url === "https://www.ft.com/robots.txt") {
    return new Response("User-agent: *\nAllow: /\n", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  if (url === "https://www.ft.com/sitemaps/news.xml") {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
        <url>
          <loc>https://www.ft.com/content/mexico-relevant</loc>
          <news:news>
            <news:publication><news:name>Financial Times</news:name><news:language>en</news:language></news:publication>
            <news:publication_date>2026-05-20T14:30:00.000Z</news:publication_date>
            <news:title>Mexico benefits from nearshoring shift</news:title>
            <news:keywords>Mexico, nearshoring, supply chains, Latin America</news:keywords>
          </news:news>
        </url>
        <url>
          <loc>https://www.ft.com/content/not-relevant</loc>
          <news:news>
            <news:publication><news:name>Financial Times</news:name><news:language>en</news:language></news:publication>
            <news:publication_date>2026-05-20T13:30:00.000Z</news:publication_date>
            <news:title>UK pensions face new pressure</news:title>
            <news:keywords>UK, pensions, London</news:keywords>
          </news:news>
        </url>
      </urlset>
      `,
      { status: 200, headers: { "content-type": "application/xml" } },
    );
  }

  throw new Error(`Unexpected FT fetch: ${url}`);
};

const ftSource: SourceDefinition = {
  id: "financial-times-mexico",
  name: "Financial Times Mexico",
  country: "Storbritannien",
  language: "en",
  type: "website",
  url: "https://www.ft.com/mexico",
  trustTier: 1,
  categories: ["economy", "markets"],
  enabled: true,
  sourceCategory: "media",
  retrieval: { primary: "website" },
};

const ftResult = await fetchWebsiteSource(ftSource, {
  limit: 5,
  isKnownUrl: async () => false,
});

assert.equal(ftResult.documents.length, 1);
assert.equal(ftResult.documents[0].url, "https://www.ft.com/content/mexico-relevant");
assert.equal(ftResult.documents[0].publishedAt, "2026-05-20T14:30:00.000Z");
assert.match(ftResult.documents[0].excerpt ?? "", /FT-nyckelord/i);
assert.equal(ftResult.documents[0].metadata?.extractionMode, "ft_news_sitemap");
assert.equal(ftResult.documents[0].metadata?.metadataOnly, true);
assert.equal(ftResult.stats.pagesFetched, 1);
assert.equal(ftResult.stats.candidatesSentToAnalysis, 1);
assert.equal(ftResult.errors.length, 0);
assert(!requests.includes("https://www.ft.com/content/mexico-relevant"));

console.info("[smoke:website] FT sitemap extraction smoke check passed.");

requests.length = 0;

(globalThis as unknown as { fetch: typeof fetch }).fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  requests.push(url);

  if (url === "https://www.state.gov/robots.txt") {
    return new Response("User-agent: *\nAllow: /\n", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  if (url === "https://www.state.gov/countries-areas/mexico/") {
    const acceptLanguage = new Headers(init?.headers).get("Accept-Language");
    assert.equal(acceptLanguage, "en-US,en;q=0.9");

    return new Response(
      `
      <html>
        <body>
          <div class="state-content-feed-block">
            <header class="state-content-feed__header">
              <h2 class="stars-above">Highlights</h2>
            </header>
            <div class="state-content-feed-block-articles">
              <div class='state-content-feed__article-text'>
                <span class="state-content-feed__article-eyebrow ">May 20, 2026</span>
                <p class="state-content-feed__article-headline">
                  <a href="https://www.state.gov/releases/office-of-the-spokesperson/2026/05/sanctioning-two-sinaloa-cartel-networks-for-trafficking-illicit-fentanyl/">
                    Sanctioning Two Sinaloa Cartel Networks for Trafficking Illicit Fentanyl
                  </a>
                </p>
              </div>
              <div class='state-content-feed__article-text'>
                <span class="state-content-feed__article-eyebrow ">May 1, 2026</span>
                <p class="state-content-feed__article-headline">
                  <a href="https://www.state.gov/u-s-mexico-memorandum-of-consultations-of-may-1-2026/">
                    U.S.-Mexico Memorandum of Consultations of May 1, 2026
                  </a>
                </p>
              </div>
            </div>
          </div>
        </body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  if (
    url ===
    "https://www.state.gov/releases/office-of-the-spokesperson/2026/05/sanctioning-two-sinaloa-cartel-networks-for-trafficking-illicit-fentanyl/"
  ) {
    return new Response(
      `
      <html>
        <head>
          <meta property="og:title" content="Sanctioning Two Sinaloa Cartel Networks for Trafficking Illicit Fentanyl" />
          <meta property="og:description" content="The United States announced new sanctions targeting trafficking networks." />
          <meta property="article:published_time" content="2026-05-20T12:00:00-04:00" />
        </head>
        <body>
          <h1>Sanctioning Two Sinaloa Cartel Networks for Trafficking Illicit Fentanyl</h1>
        </body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  if (url === "https://www.state.gov/u-s-mexico-memorandum-of-consultations-of-may-1-2026/") {
    return new Response(
      `
      <html>
        <head>
          <meta property="og:title" content="U.S.-Mexico Memorandum of Consultations of May 1, 2026" />
          <meta property="og:description" content="The United States and Mexico held consultations on bilateral issues." />
          <meta property="article:published_time" content="2026-05-01T09:00:00-04:00" />
        </head>
        <body>
          <h1>U.S.-Mexico Memorandum of Consultations of May 1, 2026</h1>
        </body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  throw new Error(`Unexpected State.gov fetch: ${url}`);
};

const stateGovSource: SourceDefinition = {
  id: "us-state-mexico",
  name: "US State Department Mexico",
  country: "USA",
  language: "en",
  type: "website",
  url: "https://www.state.gov/countries-areas/mexico/",
  trustTier: 1,
  categories: ["foreign_policy", "security", "trade"],
  enabled: true,
  sourceCategory: "government",
  retrieval: { primary: "website" },
};

const stateGovResult = await fetchWebsiteSource(stateGovSource, {
  limit: 5,
  isKnownUrl: async () => false,
});

assert.equal(stateGovResult.documents.length, 2);
assert.equal(stateGovResult.documents[0].metadata?.extractionMode, "state_gov_highlights");
assert.equal(stateGovResult.documents[0].publishedAt, "2026-05-20T16:00:00.000Z");
assert.equal(stateGovResult.documents[1].publishedAt, "2026-05-01T13:00:00.000Z");
assert.equal(stateGovResult.stats.pagesFetched, 3);
assert.equal(stateGovResult.stats.candidatesSentToAnalysis, 2);
assert.equal(stateGovResult.errors.length, 0);

console.info("[smoke:website] State.gov highlights extraction smoke check passed.");

requests.length = 0;

(globalThis as unknown as { fetch: typeof fetch }).fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  requests.push(url);

  if (url === "https://www.oecd.org/robots.txt") {
    return new Response("User-agent: *\nAllow: /\nUser-agent: Spacecat/1.0\nAllow: /\n", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  if (url === "https://www.oecd.org/en/countries/mexico.html") {
    assert.equal(new Headers(init?.headers).get("User-Agent"), "Spacecat/1.0");

    return new Response(
      `
      <html>
        <body>
          <h2 class="cmp-title__text">Related publications</h2>
          <ul class="cmp-list cmp-list--carousel-layout cmp-list--card-rendition swiper-wrapper">
            <li class="cmp-list__item swiper-slide">
              <div class="card policy-brief-page card--silent-theme">
                <div class="card__content">
                  <div class="card__tags">
                    <div class="tag tag--small">Report</div>
                  </div>
                  <div class="card__title">
                    <a class="card__title-link" href="/en/publications/oecd-economic-surveys-mexico-2026_8a7c0ac4-en.html">
                      OECD Economic Surveys: Mexico 2026
                    </a>
                  </div>
                </div>
                <div class="card__metadata">
                  <div class="card__date">26 February 2026</div>
                  <div class="card__pages">129 Pages</div>
                </div>
              </div>
            </li>
            <li class="cmp-list__item swiper-slide">
              <div class="card report-summary-page card--silent-theme">
                <div class="card__content">
                  <div class="card__tags">
                    <div class="tag tag--small">Working paper</div>
                  </div>
                  <div class="card__title">
                    <a class="card__title-link" href="/en/publications/mapping-drought-severity-in-mexico-using-high-resolution-satellite-data_f2a165e7-en.html">
                      Mapping drought severity in Mexico using high-resolution satellite data
                    </a>
                  </div>
                </div>
                <div class="card__metadata">
                  <div class="card__date">1 April 2026</div>
                  <div class="card__pages">27 Pages</div>
                </div>
              </div>
            </li>
          </ul>
          <h2 class="cmp-title__text">Latest insights</h2>
          <ul class="cmp-list cmp-list--carousel-layout cmp-list--card-rendition swiper-wrapper">
            <li class="cmp-list__item swiper-slide">
              <div class="card press-release-page card---theme">
                <div class="card__content">
                  <div class="card__tags">
                    <div class="tag tag--small">Press release</div>
                  </div>
                  <div class="card__title">
                    <a class="card__title-link" href="/en/about/news/press-releases/2026/02/boosting-digitalisation-and-improving-education-outcomes-would-accelerate-growth-and-raise-living-standards-in-mexico.html">
                      Boosting digitalisation and improving education outcomes would accelerate growth and raise living standards in Mexico
                    </a>
                  </div>
                </div>
                <div class="card__metadata">
                  <div class="card__date">26 February 2026</div>
                </div>
              </div>
            </li>
            <li class="cmp-list__item swiper-slide">
              <div class="card article-page card---theme">
                <div class="card__content">
                  <div class="card__tags">
                    <div class="tag tag--small">Video</div>
                  </div>
                  <div class="card__title">
                    <a class="card__title-link" href="/en/blogs/2026/02/video-economic-survey-of-mexico-2026.html">
                      Video - Economic Survey of Mexico 2026
                    </a>
                  </div>
                </div>
                <div class="card__metadata">
                  <div class="card__date">26 February 2026</div>
                </div>
              </div>
            </li>
          </ul>
        </body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  if (url === "https://www.oecd.org/en/publications/oecd-economic-surveys-mexico-2026_8a7c0ac4-en.html") {
    assert.equal(new Headers(init?.headers).get("User-Agent"), "Spacecat/1.0");
    return new Response(
      `
      <html>
        <head>
          <meta property="og:title" content="OECD Economic Surveys: Mexico 2026" />
          <meta property="og:description" content="An OECD survey of the Mexican economy." />
          <meta property="article:published_time" content="2026-02-26T08:00:00Z" />
        </head>
        <body><h1>OECD Economic Surveys: Mexico 2026</h1></body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  if (
    url ===
    "https://www.oecd.org/en/about/news/press-releases/2026/02/boosting-digitalisation-and-improving-education-outcomes-would-accelerate-growth-and-raise-living-standards-in-mexico.html"
  ) {
    assert.equal(new Headers(init?.headers).get("User-Agent"), "Spacecat/1.0");
    return new Response(
      `
      <html>
        <head>
          <meta property="og:title" content="Boosting digitalisation and improving education outcomes would accelerate growth and raise living standards in Mexico" />
          <meta property="og:description" content="OECD says reforms could raise living standards in Mexico." />
          <meta property="article:published_time" content="2026-02-26T09:30:00Z" />
        </head>
        <body><h1>Boosting digitalisation and improving education outcomes would accelerate growth and raise living standards in Mexico</h1></body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  if (
    url ===
    "https://www.oecd.org/en/blogs/2026/02/video-economic-survey-of-mexico-2026.html"
  ) {
    assert.equal(new Headers(init?.headers).get("User-Agent"), "Spacecat/1.0");
    return new Response(
      `
      <html>
        <head>
          <meta property="og:title" content="Video - Economic Survey of Mexico 2026" />
          <meta property="og:description" content="Video summary of the OECD Economic Survey of Mexico 2026." />
          <meta property="article:published_time" content="2026-02-26T09:00:00Z" />
        </head>
        <body><h1>Video - Economic Survey of Mexico 2026</h1></body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  if (
    url ===
    "https://www.oecd.org/en/publications/mapping-drought-severity-in-mexico-using-high-resolution-satellite-data_f2a165e7-en.html"
  ) {
    assert.equal(new Headers(init?.headers).get("User-Agent"), "Spacecat/1.0");
    return new Response(
      `
      <html>
        <head>
          <meta property="og:title" content="Mapping drought severity in Mexico using high-resolution satellite data" />
          <meta property="og:description" content="Working paper on drought severity in Mexico." />
          <meta property="article:published_time" content="2026-04-01T07:00:00Z" />
        </head>
        <body><h1>Mapping drought severity in Mexico using high-resolution satellite data</h1></body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  throw new Error(`Unexpected OECD fetch: ${url}`);
};

const oecdSource: SourceDefinition = {
  id: "oecd-mexico",
  name: "OECD Mexico",
  country: "Internationell",
  language: "en",
  type: "website",
  url: "https://www.oecd.org/mexico/",
  websiteUrl: "https://www.oecd.org/en/countries/mexico.html",
  trustTier: 1,
  categories: ["economy", "trade", "society"],
  enabled: true,
  sourceCategory: "website",
  retrieval: { primary: "website" },
};

const oecdResult = await fetchWebsiteSource(oecdSource, {
  limit: 10,
  isKnownUrl: async () => false,
});

assert.equal(oecdResult.documents.length, 4);
assert.equal(oecdResult.documents[0].metadata?.extractionMode, "oecd_country_cards");
assert.deepEqual(
  oecdResult.documents
    .map((document) => String(document.metadata?.oecdContentType))
    .sort(),
  ["Press release", "Report", "Video", "Working paper"].sort(),
);
assert.equal(
  oecdResult.documents.find((document) => document.metadata?.oecdContentType === "Video")?.metadata
    ?.metadataOnly,
  true,
);
assert.equal(oecdResult.stats.pagesFetched, 5);
assert.equal(oecdResult.stats.candidatesSentToAnalysis, 4);
assert.equal(oecdResult.errors.length, 0);

console.info("[smoke:website] OECD country card extraction smoke check passed.");

requests.length = 0;

(globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  requests.push(url);

  if (url === "https://dof.gob.mx/robots.txt") {
    return new Response("User-agent: *\nAllow: /\n", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  }

  if (url === "https://dof.gob.mx/") {
    return new Response(
      `
      <html>
        <body>
          <span>Fecha: 20/05/2026 - Edicion Matutina</span>
          <div id="dia_lateral" class="tab_content2">
            <table>
              <tr>
                <td>
                  <a class="enlaces_leido" href="/nota_detalle.php?codigo=123&fecha=20/05/1926">
                    Tipo de cambio para solventar obligaciones denominadas en moneda extranjera pagaderas en la Republica Mexicana.
                  </a>
                </td>
              </tr>
            </table>
          </div>
        </body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  if (url === "https://dof.gob.mx/nota_detalle.php?codigo=123&fecha=20%2F05%2F2026") {
    return new Response(
      `
      <html>
        <body>
          <div id="DivDetalleNota">
            <h1>Tipo de cambio para solventar obligaciones denominadas en moneda extranjera pagaderas en la Republica Mexicana.</h1>
            <p>El Banco de Mexico informa el tipo de cambio obtenido el dia de hoy.</p>
            <p>Ciudad de Mexico, a 19 de mayo de 2026.</p>
          </div>
        </body>
      </html>
      `,
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  throw new Error(`Unexpected DOF fetch: ${url}`);
};

const dofSource: SourceDefinition = {
  id: "dof-smoke",
  name: "Diario Oficial de la Federacion",
  country: "Mexico",
  language: "es",
  type: "website",
  url: "https://dof.gob.mx/",
  trustTier: 1,
  categories: ["domestic_politics", "economy"],
  enabled: true,
  sourceCategory: "government",
  retrieval: { primary: "website" },
};

const dofResult = await fetchWebsiteSource(dofSource, {
  limit: 5,
  isKnownUrl: async () => false,
});

assert.equal(dofResult.documents.length, 1);
assert.equal(
  dofResult.documents[0].url,
  "https://dof.gob.mx/nota_detalle.php?codigo=123&fecha=20%2F05%2F2026",
);
assert.equal(dofResult.documents[0].publishedAt, "2026-05-20");
assert.equal(dofResult.documents[0].metadata?.extractionMode, "dof_index");
assert.equal(dofResult.stats.pagesFetched, 2);
assert.equal(dofResult.stats.candidatesSentToAnalysis, 1);
assert.equal(dofResult.errors.length, 0);

console.info("[smoke:website] DOF index extraction smoke check passed.");
