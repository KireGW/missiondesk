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
      ...(division.tags ?? []),
    ];

    return terms.some((term) => normalized.includes(normalize(term)));
  });

  const matchedRegion = matchedDivision
    ? config.geography.regions.find(
        (region) => region.id === matchedDivision.parentRegionId,
      )
    : config.geography.regions.find((region) =>
        [region.displayName, region.description].some((term) =>
          normalized.includes(normalize(term)),
        ),
      );

  const cityAlias = matchedDivision?.aliases?.find((alias) =>
    normalized.includes(normalize(alias)),
  );

  return {
    detectedCountry:
      fallback.detectedCountry ?? (countryMatches || matchedDivision ? config.country : undefined),
    detectedRegion:
      matchedDivision?.id ?? fallback.detectedRegion ?? matchedRegion?.id,
    detectedCity: cityAlias ?? fallback.detectedCity,
  };
}
