import { sourcePlainText } from "@/lib/product/source-text";

export const normalizeWorkspaceText = (value: string) => sourcePlainText(value).toLowerCase().normalize("NFD")
  .replace(/\p{Diacritic}/gu, "").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/[‐‑–—]/g, "-");

const patterns = new Map<string, RegExp>();
export function workspaceTermCount(text: string, term: string) {
  let pattern = patterns.get(term);
  if (!pattern) {
    const escaped = normalizeWorkspaceText(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    pattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "g");
    patterns.set(term, pattern);
  }
  return [...text.matchAll(pattern)].length;
}
