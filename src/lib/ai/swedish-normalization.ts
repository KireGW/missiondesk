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

const englishTitleMarkers = new Set([
  "a",
  "after",
  "against",
  "amid",
  "and",
  "as",
  "at",
  "before",
  "citizen",
  "citizens",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "operation",
  "over",
  "rescue",
  "to",
  "under",
  "with",
]);

const swedishTitleMarkers = new Set([
  "av",
  "efter",
  "en",
  "ett",
  "för",
  "i",
  "med",
  "mot",
  "och",
  "som",
  "till",
  "under",
  "vid",
]);

export function looksLikeEnglishTitleInSwedishField(value: string) {
  const normalized = normalizeSwedishUserFacingText(value).trim().toLowerCase();
  if (!normalized) return false;

  const tokens = normalized
    .replace(/[“”"'`´.,:;!?()[\]{}\-–—/]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length < 3) return false;

  const englishHits = tokens.filter((token) => englishTitleMarkers.has(token)).length;
  const swedishHits = tokens.filter((token) => swedishTitleMarkers.has(token)).length;
  const hasStrongEnglishLexeme = tokens.some((token) =>
    ["rescue", "operation", "citizen", "citizens", "kidnapped", "shooting"].includes(token),
  );

  if (!hasStrongEnglishLexeme && englishHits < 2) return false;
  if (swedishHits >= englishHits && !hasStrongEnglishLexeme) return false;

  return true;
}
