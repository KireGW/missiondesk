import assert from "node:assert/strict";
import { fetchMarketSource } from "../src/lib/ingestion/market";
import type { RawSourceItem } from "../src/lib/intelligence/models";
import type { SourceDefinition } from "../src/lib/types";

const requests: string[] = [];

const source: SourceDefinition = {
  id: "bloomberg-mexico-markets",
  name: "Bloomberg Mexico Markets",
  country: "USA",
  language: "en",
  type: "website",
  sourceType: "other",
  url: "https://www.bloomberg.com/quote/USDMXN:CUR",
  trustTier: 1,
  categories: ["markets", "economy"],
  enabled: true,
  sourceCategory: "market",
  retrieval: { primary: "website" },
};

function marketHtml({
  price,
  netChange,
  percentChange,
  observedAt,
  observedLabel,
}: {
  price: string;
  netChange: string;
  percentChange: string;
  observedAt: string;
  observedLabel: string;
}) {
  return `
    <html>
      <head>
        <title>USD to MXN Exchange Rate</title>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"WebPage","mentions":[{"@type":"Thing","name":"USD-MXN X-RATE"}]}
        </script>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Corporation","name":"USD-MXN X-RATE","tickerSymbol":"USDMXN"}
        </script>
      </head>
      <body>
        <div><span class="quotePageHeader_securityDetails__UCqVj">(MXN)</span></div>
        <div class="currentPrice_currentPriceContainer__nC8vw">
          <div data-component="sized-price" class="sized-price">${price}</div>
          <div data-component="change" class="currentPrice_change__zZt9P change" aria-label="Current price is ${netChange}. Current percentage change is ${percentChange}%.">
            <span aria-hidden="true">
              <span class="media-ui-Change_changeValue-cRzdGNve3oU- media-ui-Change_positive-il7qv0BctMg- media-ui-Change_large--d--nglkh5o-">
                <span class="media-ui-Change_priceChange-OgFOGsx-jKI-">${netChange}</span>
                <span class="media-ui-Change_positive-il7qv0BctMg- media-ui-Change_large--d--nglkh5o-">${percentChange}<!-- -->%</span>
              </span>
            </span>
          </div>
          <div class="marketLastUpdate_marketStatus__Al2DJ">
            <span class="marketLastUpdate_exchangeDelay___PZEn">As of</span>
            <time dateTime="${observedAt}" class="timestamp_timeStamp__oD1aI">${observedLabel}</time>
            <span class="marketLastUpdate_space__krS26">.</span>
          </div>
        </div>
        <div class="flex"><div class="quotePageLayout_shareSmallDesktopContainer__e_ZRf"></div></div>
      </body>
    </html>
  `;
}

(globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  requests.push(url);

  if (url === "https://www.bloomberg.com/quote/USDMXN:CUR") {
    return new Response(
      marketHtml({
        price: "17.3792",
        netChange: "0.06",
        percentChange: "+0.37",
        observedAt: "2026-05-21T13:48:06.000Z",
        observedLabel: "9:48 AM EDT 05/21/26",
      }),
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  throw new Error(`Unexpected market fetch: ${url}`);
};

const previousItems: RawSourceItem[] = [
  {
    id: "prev-market-signal",
    source_type: "other",
    title_original: "USD-MXN moves lower to 17.3100",
    url: "https://www.bloomberg.com/quote/USDMXN:CUR",
    source_name: "Bloomberg Mexico Markets",
    source_country: "USA",
    source_language: "en",
    published_at: "2026-05-21T06:00:00.000Z",
    detected_country: "Mexiko",
    detected_region: undefined,
    detected_city: undefined,
    snippet: "Previous market signal",
    raw_content: [
      "Instrument: USD-MXN X-RATE",
      "Ticker: USDMXN",
      "Price: 17.3100",
      "Net change: -0.05",
      "Percent change: -0.29",
      "Observed at: 2026-05-21T06:00:00.000Z",
      "Observed label: 2:00 AM EDT 05/21/26",
      "Quote currency: MXN",
    ].join("\n"),
    source_priority: 78,
    credibility_score: 90,
    crawl_status: "fetched",
    created_at: "2026-05-21T06:05:00.000Z",
    updated_at: "2026-05-21T06:05:00.000Z",
  },
];

const result = await fetchMarketSource(source, {
  preserveRawContent: true,
  recentItems: previousItems,
});

assert.equal(result.documents.length, 1);
assert.equal(result.documents[0].metadata?.extractionMode, "bloomberg_market_quote");
assert.equal(result.documents[0].metadata?.marketType, "currency");
assert.equal(result.documents[0].publishedAt, "2026-05-21T13:48:06.000Z");
assert.match(result.documents[0].title, /USD-MXN/i);
assert.match(result.documents[0].text ?? "", /Trigger reason: movement_vs_previous_signal/i);
assert.deepEqual(requests, ["https://www.bloomberg.com/quote/USDMXN:CUR"]);

console.info("[smoke:markets] Bloomberg market adapter emits a signal on meaningful movement.");

requests.length = 0;

(globalThis as unknown as { fetch: typeof fetch }).fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  requests.push(url);

  if (url === "https://www.bloomberg.com/quote/USDMXN:CUR") {
    return new Response(
      marketHtml({
        price: "17.3210",
        netChange: "0.02",
        percentChange: "+0.12",
        observedAt: "2026-05-21T14:05:00.000Z",
        observedLabel: "10:05 AM EDT 05/21/26",
      }),
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }

  throw new Error(`Unexpected quiet market fetch: ${url}`);
};

const quietResult = await fetchMarketSource(source, {
  recentItems: previousItems,
});

assert.equal(quietResult.documents.length, 0);
assert.equal(quietResult.errors.length, 0);

console.info("[smoke:markets] Bloomberg market adapter suppresses routine FX noise.");
