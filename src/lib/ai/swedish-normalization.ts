export function normalizeSwedishUserFacingText(value: string) {
  return value
    .replace(/\bund(er)? cumbren\b/gi, "under toppmötet")
    .replace(/\bvid cumbren\b/gi, "vid toppmötet")
    .replace(/\bcumbren\b/gi, "toppmötet")
    .replace(/\bFentanil\b/g, "Fentanyl")
    .replace(/\bfentanil\b/g, "fentanyl");
}
