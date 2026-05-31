export function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    Aring: "Å",
    aring: "å",
    Auml: "Ä",
    auml: "ä",
    Ouml: "Ö",
    ouml: "ö",
  };

  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    })
    .replace(/&#([0-9]+);/g, (match, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    })
    .replace(/&([a-zA-Z]+);/g, (match, key) => named[key] ?? match);
}

export function normalizeSwedishUserFacingText(value: string) {
  return decodeHtmlEntities(value)
    .replace(/\bbrist på mördarskott minskar med\s+(\d+)\s*%/gi, "Antalet mord minskar med $1 %")
    .replace(/\bmördarskott\b/gi, "mord")
    .replace(/\bremodellering\b/gi, "renovering")
    .replace(/\bVIII Cumbre Mexico-Union Européenne\b/gi, "åttonde toppmötet mellan Mexiko och Europeiska unionen")
    .replace(/\bden åttonde toppmötet\b/gi, "det åttonde toppmötet")
    .replace(/\bden åttonde toppmöte\b/gi, "det åttonde toppmötet")
    .replace(/\bMexico\b/g, "Mexiko")
    .replace(/\bUnion Européenne\b/g, "Europeiska unionen")
    .replace(/\bund(er)? cumbren\b/gi, "under toppmötet")
    .replace(/\bvid cumbren\b/gi, "vid toppmötet")
    .replace(/\bcumbren\b/gi, "toppmötet")
    .replace(/\bFentanil\b/g, "Fentanyl")
    .replace(/\bfentanil\b/g, "fentanyl")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSwedishTitle(value: string) {
  const normalized = normalizeSwedishUserFacingText(value);
  return normalized.replace(/^([^A-Za-zÅÄÖåäö]*)([a-zåäö])/u, (_, prefix: string, first: string) =>
    `${prefix}${first.toUpperCase()}`,
  );
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

const englishSummaryMarkers = new Set([
  "after",
  "against",
  "authorities",
  "block",
  "citizen",
  "effect",
  "federal",
  "judge",
  "kidnapped",
  "limit",
  "local",
  "mail",
  "midterms",
  "operation",
  "order",
  "refuses",
  "rescued",
  "support",
  "there",
  "there's",
  "voting",
]);

const spanishSummaryMarkers = new Set([
  "aeropuerto",
  "asi",
  "baja",
  "ciudad",
  "detenidos",
  "gabinete",
  "homicidios",
  "honestidad",
  "internacional",
  "invertidos",
  "pais",
  "quedo",
  "remodelacion",
  "reporta",
  "resultados",
  "seguridad",
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

export function looksLikeEnglishSummaryInSwedishField(value: string) {
  const normalized = normalizeSwedishUserFacingText(value).trim().toLowerCase();
  if (!normalized) return false;

  const tokens = normalized
    .replace(/[“”"'`´.,:;!?()[\]{}\-–—/]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length < 5) return false;

  const englishHits = tokens.filter((token) => englishSummaryMarkers.has(token)).length;
  const swedishHits = tokens.filter((token) => swedishTitleMarkers.has(token)).length;
  const hasStrongEnglishLexeme = tokens.some((token) =>
    [
      "judge",
      "refuses",
      "block",
      "order",
      "voting",
      "kidnapped",
      "rescued",
      "authorities",
      "support",
    ].includes(token),
  );

  if (!hasStrongEnglishLexeme && englishHits < 3) return false;
  if (swedishHits >= englishHits && !hasStrongEnglishLexeme) return false;

  return true;
}

export function looksLikeSpanishSummaryInSwedishField(value: string) {
  const normalized = normalizeSwedishUserFacingText(value).trim().toLowerCase();
  if (!normalized) return false;

  const tokens = normalized
    .replace(/[“”"'`´.,:;!?()[\]{}\-–—/]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length < 5) return false;

  const spanishHits = tokens.filter((token) => spanishSummaryMarkers.has(token)).length;
  const swedishHits = tokens.filter((token) => swedishTitleMarkers.has(token)).length;
  const hasStrongSpanishLexeme = tokens.some((token) =>
    [
      "asi",
      "quedo",
      "aeropuerto",
      "homicidios",
      "detenidos",
      "remodelacion",
      "invertidos",
      "honestidad",
    ].includes(token),
  );

  if (!hasStrongSpanishLexeme && spanishHits < 3) return false;
  if (swedishHits >= spanishHits && !hasStrongSpanishLexeme) return false;

  return true;
}

export function looksLikeForeignSummaryInSwedishField(value: string) {
  return (
    looksLikeEnglishSummaryInSwedishField(value) ||
    looksLikeSpanishSummaryInSwedishField(value)
  );
}

const suspiciousSwedishTitlePatterns = [
  /\bmördarskott\b/i,
  /\bremodellering\b/i,
  /\bbrist på mördarskott\b/i,
  /^moderna\s+[A-Z0-9]{2,}\b/u,
];

export function needsSwedishTitleRewrite(value: string) {
  const normalized = normalizeSwedishUserFacingText(value);
  return (
    looksLikeEnglishTitleInSwedishField(normalized) ||
    suspiciousSwedishTitlePatterns.some((pattern) => pattern.test(normalized))
  );
}
