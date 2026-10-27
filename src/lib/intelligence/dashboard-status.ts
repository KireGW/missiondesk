export interface DashboardUpdateStatus {
  sourcesCheckedAt?: string;
  signalsProcessedAt?: string;
  briefingsGeneratedAt?: string;
  lastRefresh?: {
    completedAt: string;
    processedCount: number;
    newSourceItemCount: number;
  };
}

export const SOURCE_FRESHNESS_MS = 24 * 60 * 60 * 1000;
export const REFRESH_RECEIPT_MS = 30_000;

export function latestDashboardUpdateAt(status: DashboardUpdateStatus) {
  const timestamps = [status.sourcesCheckedAt, status.signalsProcessedAt, status.briefingsGeneratedAt]
    .map((value) => new Date(value ?? "").getTime())
    .filter(Number.isFinite);
  return timestamps.length > 0 ? new Date(Math.max(...timestamps)).toISOString() : undefined;
}

export function isSourceCheckFresh(checkedAt: string | undefined, now: number) {
  const age = now - new Date(checkedAt ?? "").getTime();
  return Number.isFinite(age) && age >= 0 && age < SOURCE_FRESHNESS_MS;
}

export function showRefreshReceipt(completedAt: string | undefined, now: number) {
  const age = now - new Date(completedAt ?? "").getTime();
  return Number.isFinite(age) && age >= 0 && age < REFRESH_RECEIPT_MS;
}

export function formatUpdateTimestamp(value?: string) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "Ej registrerat";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Mexico_City",
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}
