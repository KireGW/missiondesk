const countryMap: Record<string, string> = {
  cuba: "Kuba",
  mexico: "Mexiko",
  "united states": "USA",
  usa: "USA",
  "u.s.a.": "USA",
  sweden: "Sverige",
  sverige: "Sverige",
  britain: "Storbritannien",
  "united kingdom": "Storbritannien",
  "great britain": "Storbritannien",
  uk: "Storbritannien",
  "european union": "EU",
  eu: "EU",
  international: "Internationell",
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

export function countryNameSv(value?: string): string {
  if (!value) return "";
  return countryMap[normalize(value)] ?? value;
}
