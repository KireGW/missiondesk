# Account-bound selections (stage 1)

Prioritized and Meeting brief are private account data, separate from public
news and workspace candidate decisions. The home page loads the selections
alongside the feed and keys the client component by account. Reloading or signing
in again uses the stable account ID derived from the existing verified identity.

`/api/personal/selections` reads that account's state. PATCH accepts only an
article ID, a selection kind and an explicit boolean, or a revision-checked clear
of Meeting brief. The browser cannot supply another owner or article metadata.
The account header detects stale tabs after switching accounts; identity always
comes from the existing server session.

Two additive tables hold membership rows and a monotonically increasing account
revision. Row-level security is forced on both tables. Operations are serialized
per account and change one membership rather than replacing an entire list.
Duplicate adds/removes are idempotent, clearing Meeting brief preserves
Prioritized, and a stale clear is rejected. Reads never create or save an empty
selection state.

The client shows pending/error feedback, rolls back unconfirmed optimistic
changes, and refreshes on focus/visibility. Revision checks prevent an older
response from overwriting newer state. Writes use keepalive when navigating;
only reads are aborted on unmount. A failed initial read disables selection
controls until recovery, while the existing news feed remains available.

Only a source-verified title, source name, link, publication date, language,
category and geographic tags are persisted. Current source text is resolved
under existing publication/workspace permissions and the plan's archive window.
Outside that window an owned bookmark still shows its title/date/link, explicitly
labelled as a saved source link. It does not carry a copied excerpt, translation
or relevance score. The seven-day free search archive is unchanged.

No ingestion, source configuration, candidate assessment, ranking, deduplication,
search quota or AI/social usage logic is changed. Personal data is not placed in
the shared public-feed cache.

## Verification and migration

Create an isolated schema-only database branch and seed only synthetic accounts.
The integration script refuses databases containing non-test account identities.
Supply the owner/app connection URLs through private files and explicitly verify
the isolated hostname:

```sh
MISSIONDESK_SELECTION_TEST_OWNER_URL_FILE=/private/tmp/test-owner.url \
MISSIONDESK_SELECTION_TEST_APP_URL_FILE=/private/tmp/test-app.url \
MISSIONDESK_SELECTION_TEST_HOST=verified-test-host \
MISSIONDESK_SELECTION_TEST_REPORT=/private/tmp/selections-verification.json \
npm run verify:personal-selections
```

This executes the actual API handlers, account mapping, database/RLS and React
component. Auth0's already-verified identity is a test fixture; new session
instances for the same identity must restore both lists. Tests cover logout,
another account, client remount, failed saves, failed initial reads, recovery,
concurrent list changes, stale clears, archive expiry and articles leaving the
30-item feed. Article/candidate fingerprints and existing schema columns must
remain unchanged. DOM interaction uses jsdom; it is not a manual Auth0 browser
login test.

The additive migration is explicit, not run by ordinary requests:

```sh
MISSIONDESK_NEON_CONFIG_DIR=verified-cli-config \
MISSIONDESK_NEON_PROFILE=verified-profile \
MISSIONDESK_SELECTION_MIGRATION_BRANCH_ID=verified-personal-pilot-branch \
node --experimental-strip-types --experimental-loader ./scripts/node-ts-loader.mjs scripts/migrate-personal-selections.ts --apply
```

The existing pilot-admin checks verify the non-primary branch and endpoint.
Migration compares existing columns and row fingerprints, then verifies forced
RLS. Roll back application code if necessary; leave the additive tables and
saved user data intact. Stages 2–4 are not included in this release.
