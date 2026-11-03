import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BrandLogo } from "@/components/product/BrandLogo";
import { ProductFooter } from "@/components/product/ProductFooter";
import { getAccessMode } from "@/lib/product/config";
import { legalLanguage } from "@/lib/product/footer";
import { legalMessages } from "@/lib/product/legal";
import { personalMessages } from "@/lib/product/messages";

export const metadata: Metadata = {
  title: "Legal | MissionDesk",
  robots: { index: false, follow: false },
};

export default async function LegalPage({ searchParams }: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  if (getAccessMode() !== "personal") redirect("/");
  const language = legalLanguage((await searchParams).lang);
  const t = legalMessages[language];
  return <main lang={language} className="missiondesk flex min-h-dvh flex-col px-4 py-8 text-[var(--app-fg)] sm:px-8">
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--app-line)] pb-5">
        <Link href="/" className="inline-flex rounded-sm text-2xl font-semibold hover:text-[var(--app-accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--app-accent)]"><BrandLogo /></Link>
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-sm"><ArrowLeft className="h-4 w-4" />{personalMessages(language).back}</Link>
      </header>
      <article className="py-8">
        <h1 className="text-xl font-semibold">{t.title}</h1>
        <div className="mt-5 border-b border-[var(--app-line)] pb-5 text-sm leading-6">
          <p className="text-[var(--app-muted)]">{t.operator}</p>
          <p>Tone Tension Productions AB</p>
          <p className="text-[var(--app-soft)]">Båstad, Sweden</p>
        </div>
        {t.sections.map(section => <section key={section.id} id={section.id} className="scroll-mt-6 pt-6" aria-labelledby={`legal-${section.id}`}>
          <h2 id={`legal-${section.id}`} className="text-base font-semibold">{section.title}</h2>
          {section.paragraphs.map(paragraph => <p key={paragraph} className="mt-2 text-sm leading-6 text-[var(--app-soft)]">{paragraph}</p>)}
        </section>)}
      </article>
      <ProductFooter language={language} />
    </div>
  </main>;
}
