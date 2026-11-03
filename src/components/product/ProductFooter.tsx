import Link from "next/link";
import { footerMessages, legalHref } from "@/lib/product/footer";
import type { PersonalLanguage } from "@/lib/product/profiles";

export function ProductFooter({ language }: { language: PersonalLanguage }) {
  const t = footerMessages[language];
  return <footer className="missiondesk-print-screen-only mt-auto border-t border-[var(--app-line)] py-4 text-xs text-[var(--app-muted)]">
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
      <p>© {new Date().getUTCFullYear()} Tone Tension Productions AB</p>
      <nav aria-label={t.navigation} className="flex flex-wrap items-center gap-x-5">
        <Link href={legalHref(language)} prefetch={false} className="inline-flex min-h-10 items-center underline-offset-4 hover:text-[var(--app-fg)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--app-accent)]">{t.legal}</Link>
        <Link href={legalHref(language, "copyright")} prefetch={false} className="inline-flex min-h-10 items-center underline-offset-4 hover:text-[var(--app-fg)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--app-accent)]">{t.copyright}</Link>
      </nav>
    </div>
  </footer>;
}
