export const UPCOMING_EVENTS_HORIZON_DAYS = 90;

const MIN_EVENT_YEAR = 2000;
const MAX_EVENT_YEAR = 2100;
const DAY_MS = 24 * 60 * 60 * 1000;

function validDateParts(year: number, month: number, day: number) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < MIN_EVENT_YEAR ||
    year > MAX_EVENT_YEAR ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return false;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export function normalizeEventDate(value: unknown) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || ["null", "undefined", "nan"].includes(trimmed.toLowerCase())) {
    return undefined;
  }

  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return validDateParts(Number(year), Number(month), Number(day))
      ? `${year}-${month}-${day}`
      : undefined;
  }

  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  const year = parsed.getUTCFullYear();
  if (year < MIN_EVENT_YEAR || year > MAX_EVENT_YEAR) return undefined;
  return parsed.toISOString();
}

export function eventDateRange(value: unknown) {
  const normalized = normalizeEventDate(value);
  if (!normalized) return undefined;

  const dateOnly = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const startTs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    return {
      normalized,
      startTs,
      endTs: startTs + DAY_MS - 1,
    };
  }

  const ts = new Date(normalized).getTime();
  return Number.isFinite(ts) ? { normalized, startTs: ts, endTs: ts } : undefined;
}

export function isUpcomingEventDate(
  value: unknown,
  nowTs = Date.now(),
  horizonDays = UPCOMING_EVENTS_HORIZON_DAYS,
) {
  const range = eventDateRange(value);
  if (!range) return false;
  return range.endTs >= nowTs && range.startTs <= nowTs + horizonDays * DAY_MS;
}
