# Current signals ordering

The workspace's default Current signals view preserves the server's full ordered
presentation, including its existing age weighting and source/country/topic
balancing. The browser no longer replaces it with a sort on raw relevance scores.
"Newest" remains chronological. Search, Prioritized, Meeting brief and the legacy
non-workspace dashboard retain their existing sorting.

Only the Current signals presentation opts in to contextual economic-event
matching. An existing change word such as `cae`, `rises`, `record` or `crisis`
needs economic evidence nearby in the same clause. A generic rate reference can
also qualify when the existing topic classifier identifies an economic topic.
An unrelated economic sentence does not qualify an arrest headline.

The correction uses the existing assessment calculation, including its event
bonus cap and score bounds. It changes only the economic-event contribution and
that explanation on a presentation copy. Category, geography, all other reasons,
source text, dates and IDs remain unchanged. If the original stored score cannot
be reproduced, the item is retained without correction.

The original `feed.items` and stored candidates keep their existing scores,
statuses and `public-rules-v4` policy keys. The assessment option is off for every
existing ingestion/search caller. No database migration, reprocessing, additional
source fetching, AI/LLM call, new age weight or diversity weight is introduced.

## Verification

```sh
MISSIONDESK_CURRENT_ORDER_REPORT=/tmp/current-order.json node --no-warnings --experimental-strip-types --experimental-loader ./scripts/node-ts-loader.mjs scripts/shadow-current-signals-order.ts
node --no-warnings --experimental-test-module-mocks --experimental-strip-types --experimental-loader ./scripts/node-ts-loader.mjs scripts/smoke-current-signals-order-ui.ts
```

The shadow replay compares 85 original assessments with a frozen copy from
commit `4de6e56`, then computes a separate proposed Current signals presentation.
On the 12 November 2026 capture, the fresh tariff threat moves from display
position 11 to 4; the Jalisco arrest moves from 1 to 10. Its presentation relevance
changes from 82 to 70 while the threat stays at 62. With existing age weighting,
their scores are about 55.5 and 61.7 respectively. Sheinbaum's response remains.

Curated context controls cover real economic changes, non-economic uses of change
words, mixed sentences, implicit rate references and crime/health rates. All
proposed score changes and changes to the 30-story membership are listed in the
shadow report for review before release. Rendering tests execute the actual
dashboard component with each view's state and verify server order, newest,
saved-view ordering and legacy ordering. Integration checks preserve search,
saved selections, original scores and the existing deduplication behavior.
