export type MissionDeskCacheScope =
  | "national_dashboard"
  | "briefing"
  | "regional"
  | "breaking";

export type CacheFreshnessState = "missing" | "fresh" | "stale";

const cacheDefaults: Record<MissionDeskCacheScope, { hours: number; min: number; max: number }> = {
  national_dashboard: { hours: 8, min: 6, max: 12 },
  briefing: { hours: 8, min: 6, max: 12 },
  regional: { hours: 18, min: 12, max: 24 },
  breaking: { hours: 2, min: 1, max: 4 },
};

const signalDisplayWindow = { days: 3, min: 1, max: 14 };

function envNumber(name: string) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : undefined;
}

function clampHours(value: number, scope: MissionDeskCacheScope) {
  const policy = cacheDefaults[scope];
  return Math.max(policy.min, Math.min(policy.max, Math.round(value)));
}

export function cacheHoursFor(scope: MissionDeskCacheScope, override?: number) {
  if (override && Number.isFinite(override)) {
    return clampHours(override, scope);
  }

  const configured =
    scope === "national_dashboard"
      ? envNumber("MISSIONDESK_NATIONAL_CACHE_HOURS") ??
        envNumber("MISSIONDESK_PROCESSED_CACHE_HOURS")
      : scope === "briefing"
        ? envNumber("MISSIONDESK_BRIEFING_CACHE_HOURS")
        : scope === "regional"
          ? envNumber("MISSIONDESK_REGIONAL_CACHE_HOURS")
          : envNumber("MISSIONDESK_BREAKING_CACHE_HOURS");

  return clampHours(configured ?? cacheDefaults[scope].hours, scope);
}

export function cacheExpiresAtFor(
  scope: MissionDeskCacheScope,
  overrideHours?: number,
  from: Date = new Date(),
) {
  return new Date(from.getTime() + cacheHoursFor(scope, overrideHours) * 36e5).toISOString();
}

export function isCacheFresh(cacheExpiresAt?: string, now: Date = new Date()) {
  if (!cacheExpiresAt) return false;
  const expiresAt = new Date(cacheExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

export function cacheFreshnessState(cacheExpiresAt?: string, now: Date = new Date()) {
  if (!cacheExpiresAt) return "missing";
  return isCacheFresh(cacheExpiresAt, now) ? "fresh" : "stale";
}

export function signalDisplayDays(override?: number) {
  const configured = override ?? envNumber("MISSIONDESK_SIGNAL_DISPLAY_DAYS");
  const value = Number.isFinite(configured) ? configured! : signalDisplayWindow.days;
  return Math.max(signalDisplayWindow.min, Math.min(signalDisplayWindow.max, Math.round(value)));
}

export function signalDisplaySince(overrideDays?: number, now: Date = new Date()) {
  return new Date(now.getTime() - signalDisplayDays(overrideDays) * 24 * 36e5).toISOString();
}
