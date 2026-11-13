# Editable Meeting brief (stage 4)

Each personal account has one active meeting document. Its title (up to 160 characters), optional date and manually selected article order persist across reloads and new sessions. The date is a calendar date with no timezone conversion. Blank title uses the existing localized Meeting brief heading for print.

Use Save meeting details for title/date edits and the Up/Down buttons beside articles to reorder. Unsaved details remain local and can be discarded. The print action and article controls wait until those details are saved or discarded. Failed saves retain the draft; failed moves roll back. New selections append after the existing document order. Removing an article prunes its position, so re-adding it appends it; clearing articles keeps the meeting title/date.

## Storage and concurrency

The additive `product_account_meeting_briefs` table stores only account ID, title, a PostgreSQL DATE and an array of ordered selection IDs. Forced RLS uses the existing active-account scope and restricted app role. No document is automatically written during load. The existing private, same-origin selections API accepts bounded title/date or a single article move; it keeps its original request size limit. Original article text and the seven-day material archive rules are unchanged.

The existing selection-state row serializes membership, metadata and moves. Title/date saves and moves require the expected revision, rejecting stale or concurrent changes rather than silently replacing them. Membership updates remain targeted. A single database snapshot returns the revision, document details and normalized article order together. Client state is keyed by the existing authenticated account; unsaved edits never cross accounts.

## Scope and print

Only Meeting brief uses the saved manual order. Current signals, Prioritized, search, new-in-selection checkpoints, ingestion, ranking and deduplication keep their existing behavior. A successful save does not fetch or reprocess sources.

Screen articles and the print panel share the exact same rows. The print heading/date derive from saved account data, and the existing print styles hide the editor and all action controls. PDF remains the browser's Print / Save as PDF flow; no new PDF service or external document API is introduced.

## Verification

`npm run verify:meeting-brief` exercises actual React DOM editing, moving and print invocation, the real API/account mapping and isolated PostgreSQL with synthetic verified-session fixtures. It checks reload/new-session/account isolation, stale and concurrent writes, RLS, failed-save drafts and move rollback, clear/re-add behavior, date formatting, matching saved print markup, unchanged Current signals order, Prioritized, review state and engine rows/schema. Separate print verification renders that actual HTML and compiled app CSS into a test PDF, checks text/order and inspects page images. It does not replace a manual Auth0 login or browser print-dialog test.

The additive migration requires the verified personal pilot branch ID and checks that existing schemas/data are unchanged before committing. The release uses the previous verified production source plus only the stage-4 files.
