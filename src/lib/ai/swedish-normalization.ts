export function normalizeSwedishUserFacingText(value: string) {
  return value
    .replace(/\bVIII Cumbre Mexico-Union Européenne\b/gi, "åttonde toppmötet mellan Mexiko och Europeiska unionen")
    .replace(/\bden åttonde toppmötet\b/gi, "det åttonde toppmötet")
    .replace(/\bden åttonde toppmöte\b/gi, "det åttonde toppmötet")
    .replace(/\bMexico\b/g, "Mexiko")
    .replace(/\bUnion Européenne\b/g, "Europeiska unionen")
    .replace(/\bund(er)? cumbren\b/gi, "under toppmötet")
    .replace(/\bvid cumbren\b/gi, "vid toppmötet")
    .replace(/\bcumbren\b/gi, "toppmötet")
    .replace(/\bFentanil\b/g, "Fentanyl")
    .replace(/\bfentanil\b/g, "fentanyl");
}
