const DEFAULT_FUTURE_SKEW_HOURS = 30;

export function sanitizePublishedAt(
  publishedAt: string | undefined,
  options?: { allowFuture?: boolean; futureSkewHours?: number },
) {
  if (!publishedAt) return undefined;
  const parsed = new Date(publishedAt);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (options?.allowFuture) return parsed.toISOString();

  const skewHours = options?.futureSkewHours ?? DEFAULT_FUTURE_SKEW_HOURS;
  const maxAccepted = Date.now() + skewHours * 36e5;
  if (parsed.getTime() > maxAccepted) return undefined;
  return parsed.toISOString();
}
