import assert from "node:assert/strict";
import {
  eventDateRange,
  isUpcomingEventDate,
  normalizeEventDate,
  UPCOMING_EVENTS_HORIZON_DAYS,
} from "@/lib/intelligence/event-dates";

assert.equal(normalizeEventDate(null), undefined);
assert.equal(normalizeEventDate(""), undefined);
assert.equal(normalizeEventDate("null"), undefined);
assert.equal(normalizeEventDate("undefined"), undefined);
assert.equal(normalizeEventDate("2026-02-31"), undefined);
assert.equal(normalizeEventDate("1999-12-31"), undefined);
assert.equal(normalizeEventDate("2026-05-24"), "2026-05-24");
assert.equal(
  normalizeEventDate("2026-05-24T15:00:00.000Z"),
  "2026-05-24T15:00:00.000Z",
);

const now = Date.UTC(2026, 4, 24, 17, 0, 0, 0);
assert.equal(isUpcomingEventDate("2026-05-24", now), true);
assert.equal(isUpcomingEventDate("2026-05-23", now), false);
assert.equal(isUpcomingEventDate("2026-08-22", now), true);
assert.equal(isUpcomingEventDate("2026-08-23", now), false);

const range = eventDateRange("2026-05-24");
assert.ok(range);
assert.equal(range.normalized, "2026-05-24");
assert.equal(UPCOMING_EVENTS_HORIZON_DAYS, 90);

console.log("event date validation smoke test passed");
