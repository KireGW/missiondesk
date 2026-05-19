import type { EmbassyConfig } from "@/lib/types";

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

export interface DetectedGeography {
  detectedCountry?: string;
  detectedRegion?: string;
  detectedCity?: string;
}

function includesGeographicTerm(normalizedValue: string, term: string) {
  const normalizedTerm = normalize(term).trim();
  if (!normalizedTerm) return false;

  const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(normalizedValue);
}

export function detectGeographicDivisionIds(value: string, config: EmbassyConfig) {
  const normalized = normalize(value);

  return config.geography.administrativeDivisions
    .filter((division) => {
      const terms = [division.displayName, ...(division.aliases ?? [])].sort(
        (a, b) => b.length - a.length,
      );

      return terms.some((term) => includesGeographicTerm(normalized, term));
    })
    .map((division) => division.id);
}

export function detectGeography(
  value: string,
  config: EmbassyConfig,
  fallback: DetectedGeography = {},
): DetectedGeography {
  const normalized = normalize(value);
  const countryMatches =
    normalized.includes(normalize(config.country)) ||
    normalized.includes(normalize(config.countryCode));

  const matchedDivision = config.geography.administrativeDivisions.find((division) => {
    const terms = [
      division.displayName,
      ...(division.aliases ?? []),
    ];

    return terms.some((term) => includesGeographicTerm(normalized, term));
  });

  const matchedRegion = matchedDivision
    ? config.geography.regions.find(
        (region) => region.id === matchedDivision.parentRegionId,
      )
    : config.geography.regions.find((region) =>
        [region.displayName, region.description].some((term) =>
          includesGeographicTerm(normalized, term),
        ),
      );

  const cityAlias = matchedDivision?.aliases?.find((alias) =>
    includesGeographicTerm(normalized, alias),
  );

  return {
    detectedCountry:
      fallback.detectedCountry ?? (countryMatches || matchedDivision ? config.country : undefined),
    detectedRegion:
      matchedDivision?.id ?? fallback.detectedRegion ?? matchedRegion?.id,
    detectedCity: cityAlias ?? fallback.detectedCity,
  };
}
