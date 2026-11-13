# New in selection (stage 2)

Each personal account stores one comparison point for Current signals. The first successful dashboard load initializes it from that selection, so existing stories do not all appear new. Later membership additions show “New in selection” (“Ny i urvalet” in Swedish), including older articles newly entering the selection. Reloading, signing in again, sorting, filtering and opening an article do not clear the marker.

“Mark selection reviewed” replaces the comparison point with the entire Current signals selection held by that client, including stories hidden by filters. Its tooltip states this scope. The request carries those exact IDs, not a newly computed server feed; a concurrent arrival the client has not displayed remains new. Failed saves retain markers. A stale revision is rejected and the client loads the newer comparison point before retrying. Concurrent initialization never replaces an existing baseline.

This is a membership comparison against the latest explicitly reviewed selection, not a publication-date indicator, unread tracking or lifetime reading history. A story that leaves that baseline and later re-enters can be new in selection again. The baseline is per account, not per browser or workspace, and contains at most the plan's selection limit (30 free, 100 premium).

## Isolation

`product_account_current_review` is an additive table with a primary key on the existing account ID, a revision, a bounded JSON array of article IDs and the explicit review timestamp. Forced row-level security permits only the active account under the existing restricted application role. API requests use the existing verified identity mapping, same-origin protection, a matching account header and private/no-store responses. IDs are authorized against existing visible material without fetching sources, consuming search allowance or recalculating the feed.

The dashboard only derives badge membership. It does not use review state in row filtering, ordering, relevance, deduplication, retention, ingestion, search, Prioritized or Meeting brief. No engine modules or existing schemas are modified. A storage failure leaves the rest of the dashboard available and provides a retry control; it never silently treats every item as new or acknowledges an empty selection.

## Verification

`npm run verify:current-review` uses an explicitly configured schema-only Neon test database containing synthetic accounts. It exercises actual React DOM interactions, API handlers, account mapping and PostgreSQL, with only verified identity and surrounding navigation supplied as fixtures. It checks quiet initialization, older and fresh arrivals, account isolation and forced RLS, reload/new-session persistence, explicit review through active filters, unchanged default/newest order and dates, arrivals outside the acknowledged selection, stale and concurrent writes, failed reads/saves, and unchanged saved lists and engine rows/schema. It is not a manual Auth0 browser-login test.

Run the existing personal-selections integration test, frozen ordering/deduplication shadow replays and workspace/product regressions alongside it. `scripts/migrate-current-review.ts --apply` requires the verified pilot branch ID, uses a transaction and checks that all existing schemas, engine rows and saved-selection rows remain unchanged before committing the additive table.
