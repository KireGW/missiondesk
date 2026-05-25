export function normalizeSwedishUserFacingText(value: string) {
  return value
    .replace(/\bFentanil\b/g, "Fentanyl")
    .replace(/\bfentanil\b/g, "fentanyl");
}
