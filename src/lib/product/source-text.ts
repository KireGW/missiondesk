import { decodeHTMLStrict } from "entities";

export function sourcePlainText(value: string): string {
  let text = value;
  // RSS CDATA can contain HTML entities, sometimes escaped once more as &amp;#...;.
  for (let depth = 0; depth < 3; depth++) {
    const decoded = decodeHTMLStrict(text);
    if (decoded === text) break;
    text = decoded;
  }
  return text.replace(/<!--[\s\S]*?-->|<\/?[a-z][^>]*>/gi, " ").replace(/\s+/g, " ").trim();
}
