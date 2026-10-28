import Link from "next/link";
import { ArrowLeft, ExternalLink, Info, Library, LockKeyhole } from "lucide-react";
import { personalMessages } from "@/lib/product/messages";
import { interfaceLanguageNames, type HomeCountry, type PersonalLanguage } from "@/lib/product/profiles";
import { getProfileSourceCatalog, type ProfileSourceGroup } from "@/lib/product/source-catalog";
import type { WorkspaceSourceStatus } from "@/lib/product/workspace-source-status";

export function ProfileSourceCatalog({ home, language, interfaceLanguages, sourceStatus = [] }: {
  home: HomeCountry; language: PersonalLanguage; interfaceLanguages: readonly PersonalLanguage[];
  sourceStatus?: WorkspaceSourceStatus[];
}) {
  const catalog = getProfileSourceCatalog(home);
  const t = personalMessages(language);
  const groups: Array<{ id: ProfileSourceGroup; label: string }> = [
    { id: "norway", label: t.sourceNorway }, { id: "mexico", label: t.sourceMexico },
    ...catalog.countries.flatMap((country) => country === "MX" ? [] : [{ id: country, label: t.monitoredCountryNames[country] }]),
    { id: "baseline", label: t.sourceBaseline }, { id: "social", label: t.sourceSocial },
  ];
  return <main lang={language} className="missiondesk personal-desk min-h-dvh px-4 py-6 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-5xl">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--app-line)] pb-5">
        <div><h1 className="text-2xl font-semibold">MissionDesk</h1><p className="mt-1 text-sm text-[var(--app-muted)]">{t.sources}</p></div>
        <Link href="/account" className="inline-flex min-h-11 items-center gap-2 text-sm"><ArrowLeft className="h-4 w-4" />{t.account}</Link>
      </header>
      <section className="border-b border-[var(--app-line)] py-5">
        <div className="flex min-w-0 items-center gap-3">
          <Library className="h-5 w-5 shrink-0 text-[var(--app-positive)]" />
          <div className="min-w-0"><h2 className="text-xl font-semibold">{t.stationNames[home]}</h2><p className="mt-1 text-sm text-[var(--app-muted)]">{catalog.countries.map((country) => t.monitoredCountryNames[country]).join(", ")}</p><p className="mt-1 text-xs text-[var(--app-muted)]">{t.sourceDraft} · {catalog.sources.length} {t.sourceCount}</p></div>
        </div>
        <div className="mt-4 grid gap-3 text-sm text-[var(--app-muted)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <details className="min-w-0 flex-1">
            <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2"><Info className="h-4 w-4 shrink-0" />{t.sourceInfo}</summary>
            <p className="max-w-3xl py-3 leading-6">{t.sourceInfoBody}</p>
          </details>
          <nav aria-label={t.interfaceLanguage} className="flex flex-wrap items-center gap-x-3 text-xs">
            {interfaceLanguages.map((locale) => <Link key={locale} href={{ pathname: "/account/sources", query: { lang: locale } }} aria-current={language === locale ? "page" : undefined}
              className={`inline-flex min-h-10 items-center ${language === locale ? "text-[var(--app-fg)] underline underline-offset-4" : ""}`}>{interfaceLanguageNames[locale]}</Link>)}
          </nav>
        </div>
      </section>
      {groups.map((group) => {
        const sources = catalog.sources.filter((source) => source.group === group.id);
        if (!sources.length) return null;
        return <section key={group.id} className="py-6" aria-labelledby={`source-group-${group.id}`}>
          <h2 id={`source-group-${group.id}`} className="mb-3 text-lg font-semibold">{group.label} <span className="ml-1 text-sm font-normal text-[var(--app-muted)]">{sources.length}</span></h2>
          <div className="divide-y divide-[var(--app-line)] border-y border-[var(--app-line)]">
            {sources.map((source) => { const status=sourceStatus.find(status=>status.id===source.id); return <article key={source.id} className="grid min-w-0 gap-3 py-4 md:grid-cols-[minmax(0,1fr)_13rem]">
              <div className="min-w-0">
                <h3 className="break-words text-sm font-semibold"><a href={source.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-start gap-2 hover:text-[var(--app-accent)]"><span>{source.name}</span><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" /></a></h3>
                <p className="mt-2 text-sm leading-6 text-[var(--app-soft)]">{source.purpose[language]}</p>
                <details className="mt-2 text-xs text-[var(--app-muted)]">
                  <summary className="cursor-pointer py-2">{t.sourceReview}</summary>
                  <p className="max-w-3xl py-2 leading-5">{source.review[language]}</p>
                  {source.reviewedOn && <p className="py-1">{t.sourceReviewed}: <time dateTime={source.reviewedOn}>{source.reviewedOn}</time></p>}
                  {source.evidenceUrl && <a href={source.evidenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 text-[var(--app-accent)]">{t.sourceEvidence}<ExternalLink className="h-3 w-3" /></a>}
                </details>
              </div>
              <div className="flex flex-col items-start gap-2 text-xs md:items-end md:text-right">
                <span className={source.publication === "existing" ? "text-[var(--app-positive)]" : "text-[var(--app-muted)]"}>
                  {source.publication === "premium_locked" ? <span className="inline-flex items-center gap-1"><LockKeyhole className="h-3 w-3" />{t.sourcePremium}</span> : status?.mode==="paused" ? t.sourcePaused : status?.attention && !status.connected ? t.sourceUnavailable : status?.mode==="page" && status.connected ? t.sourcePageMonitor : status?.connected ? t.sourcePilotConnected : status ? t.sourceWaiting : source.publication === "existing" ? t.sourceExisting : t.sourceProposed}
                </span>
                {status?.attention && status.mode!=="paused" && <span className="text-[var(--app-muted)]">{t.sourcePilotLimited}</span>}
                {status?.changed && <span className="text-[var(--app-muted)]">{t.sourceChanged}</span>}
                <span className="text-[var(--app-muted)]">{t.sourceKinds[source.kind]} · {t.sourceLanguages[source.language] ?? source.language}</span>
              </div>
            </article>;})}
          </div>
        </section>;
      })}
    </div>
  </main>;
}
