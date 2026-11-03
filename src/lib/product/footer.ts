import type { PersonalLanguage } from "@/lib/product/profiles";

export const footerMessages = {
  en: { legal: "Legal", copyright: "Copyright", navigation: "Legal information" },
  nb: { legal: "Juridisk informasjon", copyright: "Opphavsrett", navigation: "Juridisk informasjon" },
  es: { legal: "Aviso legal", copyright: "Derechos de autor", navigation: "Información legal" },
  sv: { legal: "Juridisk information", copyright: "Upphovsrätt", navigation: "Juridisk information" },
} as const satisfies Record<PersonalLanguage, { legal: string; copyright: string; navigation: string }>;

export function legalLanguage(value: string | string[] | undefined): PersonalLanguage {
  return typeof value === "string" && Object.hasOwn(footerMessages, value) ? value as PersonalLanguage : "en";
}

export function legalHref(language: PersonalLanguage, section?: "copyright") {
  return { pathname: "/legal", query: { lang: language }, hash: section };
}
