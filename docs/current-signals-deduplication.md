# Current signals deduplication

This is a presentation filter after the existing workspace ordering. It replaces
the former rule for one particular tariff threat. Production matching contains
no event, person, country or topic-specific cases and makes no AI/LLM or external
API calls.

`workspace-feed.ts` still returns the original plan-sized `items`. Only the
optional `currentItems` presentation is filtered and backfilled from the same
existing ordered candidate pool. Search, candidate decisions, scores, ingestion,
Prioritized and Meeting brief continue to use the original material. The
candidate query, database schema and existing ranking/balancing are unchanged.

## Matching

- Compare articles in the same supported language (Spanish, English, Swedish,
  Norwegian), with identical country tags and publication times within 24 hours.
- Retain uncertain comparisons: missing dates/geography, reference material,
  changed headline name anchors, detected action stages, direction, quantities
  with adjacent units/nouns, or timing details.
- Normalize generic action families and light word inflections. Require at least
  five matched headline content words, complete coverage of the shorter headline
  and character-trigram similarity of at least 0.50. Limited fuzzy word matching
  tolerates spelling differences. Comparisons without name/number anchors require
  stronger overlap and at least seven words.
- A quoted suffix after a colon is omitted from word overlap; the full headline
  and excerpt still participate in the safeguards.
- Require every member of a cluster to match every other member. This prevents
  a bridge article from combining distinct developments. Keep the first article
  in the existing order, then fill freed slots from that same order.

This is lexical matching, not semantic understanding. It deliberately retains
uncertain duplicates, does not match across languages, and cannot guarantee that
every new detail in free text will be recognized. Add observed examples to the
regression corpus; change general safeguards rather than adding named events.

## Shadow verification

`analyzeCurrentSignals` defaults to `shadow`: it returns the original selection
as `items` and a separate `proposedItems` plus pair decisions. `off` skips matching;
`apply` returns the proposal. The Current signals wrapper uses `apply` after the
shadow checks below. Modes do not persist or alter database records.

```sh
MISSIONDESK_CURRENT_SIGNALS_REPORT=/tmp/current-signals-shadow.json node --no-warnings --experimental-strip-types --experimental-loader ./scripts/node-ts-loader.mjs scripts/shadow-current-signals.ts
node --no-warnings --experimental-test-module-mocks --experimental-strip-types --experimental-loader ./scripts/node-ts-loader.mjs scripts/smoke-current-signals.ts
```

The shadow script separates curated hypothetical cases from the captured public
RSS pool. Six calibration events and six held-out events exercise rate decisions,
earthquakes, arrests, budgets, energy, strikes, courts, ports, flooding, trade,
security responses and health alerts. Both article orders and unrelated-news
context are checked. False suppressions fail the check; uncertain duplicates may
remain visible. It also checks bridge chains, negation, units and canonical URLs.

The frozen 85-article replay from 12 November 2026 must propose exactly two
repeated threat reports for suppression, retain Sheinbaum's response, preserve
the other 28 articles' order and fill two places from existing candidates. Other
real event families in that pool (inflation, Sarstoon, arrest/background coverage)
must remain separate. The integration smoke verifies original feed material,
search, saved selections, cached merging and absence of new database writes or
network calls.
