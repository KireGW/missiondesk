"use client";

import { useMemo, useState } from "react";
import { ClipboardList, ExternalLink, Flag, Info, Library, Loader2, Moon, Newspaper, Printer, Radar, RefreshCw, Search, Settings, Star, Sun, Trash2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { IntelligenceCategory, IntelligenceItem } from "@/lib/types";
import type { PersonalFeed } from "@/lib/product/feed";
import type { PersonalPreferences } from "@/lib/product/profiles";
import { personalCategory, personalContent, personalRelevance } from "@/lib/product/profiles";
import { personalDate, personalMessages } from "@/lib/product/messages";
import type { PlanId } from "@/lib/product/plans";

type View = "signals" | "prioritized" | "tracking" | "meeting";

function IconButton({ label, icon: Icon, onClick, disabled = false }: {
  label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean;
}) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--app-line)] hover:border-[var(--app-accent)] disabled:opacity-50">
    <Icon className={`h-4 w-4 ${disabled ? "animate-spin" : ""}`} />
  </button>;
}

export function PersonalDashboard({ initialFeed, initialPreferences, plan }: {
  initialFeed: PersonalFeed; initialPreferences: PersonalPreferences; plan: PlanId;
}) {
  const [feed, setFeed] = useState(initialFeed);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [view, setView] = useState<View>("signals");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [homeOnly, setHomeOnly] = useState(false);
  const [sort, setSort] = useState("relevance");
  const [priorities, setPriorities] = useState<string[]>([]);
  const [meeting, setMeeting] = useState<string[]>([]);
  const [light, setLight] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const t = personalMessages(preferences.language);
  const home = preferences.homeCountry === "NO" ? t.norway : t.sweden;
  const categories = [...new Set(feed.items.map((item) => personalCategory(item.category)))];
  const rows = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return feed.items.map((item) => ({ item, content: personalContent(item, preferences), relevance: personalRelevance(item, preferences) }))
      .filter(({ item, content, relevance }) => {
        // A meeting document must retain its selected items regardless of search/filter changes.
        if (view === "meeting") return meeting.includes(item.id);
        if (view === "prioritized" && !priorities.includes(item.id)) return false;
        if (category && personalCategory(item.category) !== category) return false;
        if (homeOnly && !relevance.homeConnection) return false;
        const text = `${content.title} ${content.summary} ${item.title_original} ${item.source_name}`.toLocaleLowerCase();
        return terms.every((term) => text.includes(term));
      }).sort((a, b) => (sort === "relevance" ? b.relevance.score - a.relevance.score : 0) ||
        Date.parse(b.item.published_at) - Date.parse(a.item.published_at) || a.item.id.localeCompare(b.item.id));
  }, [feed.items, preferences, query, category, homeOnly, sort, view, meeting, priorities]);

  async function refresh() {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/personal/feed", { cache: "no-store" });
      if (response.status === 401 || response.status === 403) { window.location.assign("/account"); return; }
      if (!response.ok) throw new Error("Feed unavailable");
      const payload = await response.json() as PersonalFeed & { preferences: PersonalPreferences };
      setFeed(payload);
      setPreferences(payload.preferences);
      const ids = new Set(payload.items.map((item) => item.id));
      setMeeting((selected) => selected.filter((id) => ids.has(id)));
      setPriorities((selected) => selected.filter((id) => ids.has(id)));
    } catch { setError(true); } finally { setLoading(false); }
  }

  const tabs: Array<{ id: View; label: string; icon: LucideIcon; count?: number }> = [
    { id: "signals", label: t.current, icon: Newspaper, count: feed.items.length },
    { id: "prioritized", label: t.prioritized, icon: Star, count: priorities.length },
    { id: "tracking", label: t.tracking, icon: Radar },
    { id: "meeting", label: t.meeting, icon: ClipboardList, count: meeting.length },
  ];
  const title = tabs.find((tab) => tab.id === view)!.label;
  const selectClass = "min-h-11 w-full min-w-0 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-strong)] px-3 text-sm";

  return <main lang={preferences.language} className={`missiondesk personal-desk ${light ? "light" : ""}`}>
    <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--app-line)] py-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">MissionDesk</h1>
          <p className="mt-1 text-sm text-[var(--app-muted)]">{home} · {t.mexico} <span className="px-1">/</span> {t.profileName}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-2 text-xs text-[var(--app-positive)]">{plan === "free" ? t.free : "Premium"}</span>
          <IconButton label={t.theme} icon={light ? Sun : Moon} onClick={() => setLight(!light)} />
          <a href="/account/sources" title={t.sources} aria-label={t.sources} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--app-line)] hover:border-[var(--app-accent)]"><Library className="h-4 w-4" /></a>
          <a href="/account" title={t.account} aria-label={t.account} className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--app-line)] px-3 text-sm hover:border-[var(--app-accent)]">
            <Settings className="h-4 w-4" /><span>{t.account}</span>
          </a>
        </div>
      </header>

      <section className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-line)] py-3 text-xs text-[var(--app-muted)]">
        <p>{t.lastUpdated}: <time dateTime={feed.updatedAt}>{personalDate(feed.updatedAt, preferences.language)}</time> · {t.timezone}</p>
        <div className="ml-auto flex items-center gap-2">
          <IconButton label={t.latest} icon={loading ? Loader2 : RefreshCw} onClick={() => void refresh()} disabled={loading} />
          <details className="relative">
            <summary title={t.information} aria-label={t.information} className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-md border border-[var(--app-line)]"><Info className="h-4 w-4" /></summary>
            <div className="absolute right-0 top-12 z-20 max-h-[60vh] w-80 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-md border border-[var(--app-line)] bg-[var(--app-panel-strong)] p-4 text-sm leading-6 text-[var(--app-soft)] shadow-xl">
              <h2 className="mb-2 font-semibold text-[var(--app-fg)]">{t.information}</h2><p>{t.info}</p>
            </div>
          </details>
        </div>
      </section>
      {error && <p role="alert" className="py-3 text-sm text-[var(--app-danger)]">{t.refreshError}</p>}

      <nav aria-label={t.feed} className="flex gap-1 overflow-x-auto border-b border-[var(--app-line)] pt-3">
        {tabs.map(({ id, label, icon: Icon, count }) => <button key={id} type="button" aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}
          className={`inline-flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm ${view === id ? "border-[var(--app-positive)] text-[var(--app-fg)]" : "border-transparent text-[var(--app-muted)] hover:text-[var(--app-fg)]"}`}>
          <Icon className="h-4 w-4" />{label}{count !== undefined && <span className="w-7 shrink-0 text-center text-xs tabular-nums text-[var(--app-muted)]">{count}</span>}
        </button>)}
      </nav>

      {view !== "meeting" && <section aria-label={t.search} className="border-b border-[var(--app-line)] py-5">
        <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_13rem_12rem]">
          <label className="min-w-0 text-xs text-[var(--app-muted)]">{t.search}
            <span className="relative mt-2 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.query} className={`${selectClass} pl-10 text-[var(--app-fg)]`} />
            </span>
          </label>
          <label className="min-w-0 text-xs text-[var(--app-muted)]">{t.category}
            <select value={category} onChange={(event) => setCategory(event.target.value)} className={`${selectClass} mt-2 text-[var(--app-fg)]`}>
              <option value="">{t.allCategories}</option>{categories.map((id) => <option key={id} value={id}>{t.categories[id]}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-xs text-[var(--app-muted)]">{t.sort}
            <select value={sort} onChange={(event) => setSort(event.target.value)} className={`${selectClass} mt-2 text-[var(--app-fg)]`}>
              <option value="relevance">{t.relevance}</option><option value="newest">{t.newest}</option>
            </select>
          </label>
        </div>
        <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--app-soft)]">
          <input type="checkbox" checked={homeOnly} onChange={(event) => setHomeOnly(event.target.checked)} className="h-4 w-4 accent-[var(--app-positive)]" />{t.homeOnly} · {home}
        </label>
      </section>}

      <section className={view === "meeting" ? "missiondesk-print-panel py-5" : "py-5"}>
        <div className="missiondesk-print-screen-header mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title} <span className="ml-1 text-sm font-normal text-[var(--app-muted)]">{rows.length}</span></h2>
          {view === "meeting" && <div className="missiondesk-print-actions flex gap-2">
            <IconButton label={t.clearSelection} icon={Trash2} onClick={() => setMeeting([])} />
            <button type="button" onClick={() => window.print()} disabled={!rows.length} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--app-line)] px-3 text-sm disabled:opacity-50"><Printer className="h-4 w-4" />{t.print}</button>
          </div>}
        </div>
        {view === "meeting" && <><h2 className="missiondesk-print-title text-xl font-semibold">{t.meeting}</h2><p className="missiondesk-print-meta">MissionDesk · {home} · {t.mexico}</p></>}
        {!rows.length && <p className="border-t border-[var(--app-line)] py-10 text-sm text-[var(--app-muted)]">{view === "meeting" ? t.emptyMeeting : t.empty}</p>}
        <div className="missiondesk-print-list divide-y divide-[var(--app-line)] border-t border-[var(--app-line)]">
          {rows.map(({ item, content, relevance }) => <article key={item.id} className={`${view === "meeting" ? "missiondesk-print-item " : ""}grid min-w-0 gap-4 py-5 md:grid-cols-[minmax(0,1fr)_10rem]`}>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--app-muted)]">
                <span>{item.source_name}</span><time dateTime={item.published_at}>{personalDate(item.published_at, preferences.language)}</time>
                <span>{t.categories[personalCategory(item.category)]}</span>
                <span>{t.contentLanguage}: {t.sourceLanguages[content.language] ?? content.language}</span>
              </div>
              <h3 lang={content.language} className="break-words text-base font-medium leading-6"><a href={item.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--app-accent)]">{content.title}</a></h3>
              {content.summary && <p lang={content.language} className="mt-2 break-words text-sm leading-6 text-[var(--app-soft)]">{content.summary}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                <span className="text-[var(--app-muted)]">{t.relevance}: <strong className="font-medium text-[var(--app-fg)]">{relevance.score}</strong></span>
                {relevance.homeConnection && <span className="inline-flex items-center gap-1 text-[var(--app-gold)]"><Flag className="h-3 w-3" />{home}</span>}
                <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[var(--app-accent)]">{t.openSource}<ExternalLink className="h-3 w-3" /></a>
              </div>
            </div>
            <div className="missiondesk-print-actions flex flex-col items-start gap-3 text-xs md:items-stretch">
              {view === "meeting" ? <IconButton label={t.remove} icon={X} onClick={() => setMeeting((ids) => ids.filter((id) => id !== item.id))} /> : <>
                <label className="inline-flex min-h-8 cursor-pointer items-center gap-2"><input type="checkbox" checked={priorities.includes(item.id)} onChange={(event) => setPriorities((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} className="h-4 w-4 accent-[var(--app-positive)]" />{t.prioritize}</label>
                <label className="inline-flex min-h-8 cursor-pointer items-center gap-2"><input type="checkbox" checked={meeting.includes(item.id)} onChange={(event) => setMeeting((ids) => event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id))} className="h-4 w-4 accent-[var(--app-gold)]" />{t.meeting}</label>
              </>}
            </div>
          </article>)}
        </div>
      </section>
    </div>
  </main>;
}
