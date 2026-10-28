"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ClipboardList, ExternalLink, Flag, Info, Library, Loader2, Moon, Newspaper, Printer, Radar, RefreshCw, Search, Settings, Star, Sun, Trash2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { IntelligenceCategory, IntelligenceItem } from "@/lib/types";
import type { PersonalFeed } from "@/lib/product/feed";
import { aggregatePersonalSearchItems, normalizePersonalSearchQuery, personalSelectionItems } from "@/lib/product/feed";
import type { PersonalPreferences } from "@/lib/product/profiles";
import { personalCategory, personalContent, personalRelevance } from "@/lib/product/profiles";
import { personalDate, personalMessages } from "@/lib/product/messages";
import type { PlanId } from "@/lib/product/plans";
import type { WorkspaceRefreshResult } from "@/lib/product/workspace-refresh";
import type { WorkspaceSearchPage } from "@/lib/product/workspace-search";

type View = "signals" | "prioritized" | "tracking" | "meeting";

function IconButton({ label, icon: Icon, onClick, disabled = false }: {
  label: string; icon: LucideIcon; onClick: () => void; disabled?: boolean;
}) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--app-line)] hover:border-[var(--app-accent)] disabled:opacity-50">
    <Icon className={`h-4 w-4 ${Icon === Loader2 ? "animate-spin" : ""}`} />
  </button>;
}

export function PersonalDashboard({ initialFeed, initialPreferences, plan }: {
  initialFeed: PersonalFeed; initialPreferences: PersonalPreferences; plan: PlanId;
}) {
  const [feed, setFeed] = useState(initialFeed);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [view, setView] = useState<View>("signals");
  const [filters, setFilters] = useState({query:"",category:"",homeOnly:false,sort:"relevance"});
  const [priorityFilters, setPriorityFilters] = useState({query:"",category:"",homeOnly:false,sort:"relevance"});
  const {query,category,homeOnly,sort}=view==="prioritized" ? priorityFilters : filters;
  const [priorities, setPriorities] = useState<string[]>([]);
  const [meeting, setMeeting] = useState<string[]>([]);
  const [retained, setRetained] = useState<Record<string, IntelligenceItem>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchHomeOnly, setSearchHomeOnly] = useState(false);
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [submittedHomeOnly, setSubmittedHomeOnly] = useState(false);
  const [searchPage, setSearchPage] = useState<WorkspaceSearchPage>({items:[],nextCursor:null});
  const [searchPageIndex, setSearchPageIndex] = useState(0);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchRequested, setSearchRequested] = useState(false);
  const [light, setLight] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [feedback, setFeedback] = useState("");
  const controller = useRef<AbortController | null>(null);
  const searchController = useRef<AbortController | null>(null);
  const searchSnapshot = useRef<{query:string;homeOnly:boolean;homeCountry:string;items:IntelligenceItem[]} | null>(null);
  useEffect(() => () => {controller.current?.abort();searchController.current?.abort();}, []);
  useEffect(() => {
    if (loading || !feedback) return;
    const timeout = setTimeout(() => setFeedback(""), 30_000);
    return () => clearTimeout(timeout);
  }, [loading, feedback]);
  const t = personalMessages(preferences.language);
  const home = preferences.homeCountry === "NO" ? t.norway : t.sweden;
  const categories = [...new Set(feed.items.map((item) => personalCategory(item.category)))];
  const searchView = view === "tracking";
  const workspaceSearch = searchView && Boolean(feed.workspacePilot);
  const searchTerm = normalizePersonalSearchQuery(searchQuery);
  const canSearch = searchTerm.length>=2 || (searchHomeOnly && !searchTerm);
  const submittedSearchMatches = submittedQuery===searchTerm && submittedHomeOnly===searchHomeOnly;
  const searchPending = workspaceSearch && canSearch && (searchBusy || !searchRequested || !submittedSearchMatches);
  const aggregated = useMemo(()=>aggregatePersonalSearchItems(feed.items,submittedSearchMatches ? searchPage.items : [],searchTerm,searchHomeOnly ? preferences.homeCountry : undefined),[feed.items,submittedSearchMatches,searchTerm,searchPage.items,searchHomeOnly,preferences.homeCountry]);
  const hasNextSearchPage=aggregated.length>(searchPageIndex+1)*30 || Boolean(searchPage.nextCursor);
  function updateFilters(change: Partial<typeof filters>) {
    const update=view==="prioritized" ? setPriorityFilters : setFilters;
    update(previous=>({...previous,...change}));
  }
  const rows = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const items=searchView ? aggregated.slice(searchPageIndex*30,(searchPageIndex+1)*30) : view==="meeting" || view==="prioritized" ? personalSelectionItems(feed.items,retained,[...priorities,...meeting]) : feed.items;
    return items.map((item) => ({ item, content: personalContent(item, preferences), relevance: personalRelevance(item, preferences) }))
      .filter(({ item, content, relevance }) => {
        if (searchView) return true;
        // A meeting document must retain its selected items regardless of search/filter changes.
        if (view === "meeting") return meeting.includes(item.id);
        if (view === "prioritized" && !priorities.includes(item.id)) return false;
        if (category && personalCategory(item.category) !== category) return false;
        if (homeOnly && !relevance.homeConnection) return false;
        const text = `${content.title} ${content.summary} ${item.title_original} ${item.original_excerpt} ${item.source_name}`.toLocaleLowerCase();
        return terms.every((term) => text.includes(term));
      }).sort((a, b) => searchView ? 0 : (sort === "relevance" ? b.relevance.score - a.relevance.score : 0) ||
        Date.parse(b.item.published_at) - Date.parse(a.item.published_at) || a.item.id.localeCompare(b.item.id));
  }, [feed.items, preferences, query, category, homeOnly, sort, view, meeting, priorities, aggregated, searchPageIndex, searchView, retained]);

  function selectItem(kind: "priority" | "meeting", item: IntelligenceItem, checked: boolean) {
    const setIds=kind==="priority" ? setPriorities : setMeeting;
    const other=kind==="priority" ? meeting : priorities;
    setIds(ids=>checked ? ids.includes(item.id) ? ids : [...ids,item.id] : ids.filter(id=>id!==item.id));
    setRetained(previous=>{
      if(checked) return {...previous,[item.id]:item};
      if(other.includes(item.id)) return previous;
      const next={...previous};delete next[item.id];return next;
    });
  }

  const runSearch = useCallback(async (search: string, homeOnly: boolean, cursor: string | null, index: number, previousItems: IntelligenceItem[], currentItems: IntelligenceItem[]) => {
    searchController.current?.abort();
    const request=new AbortController();searchController.current=request;
    setSearchBusy(true);setSearchError("");
    setSubmittedQuery(search);setSubmittedHomeOnly(homeOnly);setSearchRequested(true);
    if(index===0 && !cursor) {
      searchSnapshot.current=null;
      setSearchPage({items:[],nextCursor:null});setSearchPageIndex(0);
    }
    try {
      let loaded=previousItems;
      let next=cursor;
      for(let batch=0;batch<4;batch++) {
        const response=await fetch("/api/personal/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:search,homeOnly,cursor:next}),cache:"no-store",signal:request.signal});
        if(response.status===401){window.location.assign("/account");return;}
        if(response.status===429) throw new Error("limited");
        if(!response.ok) throw new Error("unavailable");
        const result=await response.json() as WorkspaceSearchPage;
        if(request.signal.aborted) return;
        loaded=[...loaded,...result.items];next=result.nextCursor;
        if(!next || aggregatePersonalSearchItems(currentItems,loaded,search,homeOnly ? preferences.homeCountry : undefined).length>=(index+1)*30) break;
        if(batch===3) throw new Error("unavailable");
      }
      setSearchPage({items:loaded,nextCursor:next});setSearchPageIndex(index);
      searchSnapshot.current={query:search,homeOnly,homeCountry:preferences.homeCountry,items:currentItems};
    } catch(error) {
      if(!request.signal.aborted) setSearchError(error instanceof Error && error.message==="limited" ? t.searchLimited : t.searchFailed);
    } finally {if(searchController.current===request){setSearchBusy(false);searchController.current=null;}}
  },[t.searchLimited,t.searchFailed,preferences.homeCountry]);

  useEffect(()=>{
    if(!workspaceSearch || !canSearch) return;
    if(searchSnapshot.current?.query===searchTerm && searchSnapshot.current.homeOnly===searchHomeOnly &&
      searchSnapshot.current.homeCountry===preferences.homeCountry && searchSnapshot.current.items===feed.items) return;
    const timeout=setTimeout(()=>void runSearch(searchTerm,searchHomeOnly,null,0,[],feed.items),450);
    return ()=>{clearTimeout(timeout);searchController.current?.abort();};
  },[workspaceSearch,canSearch,searchTerm,searchHomeOnly,preferences.homeCountry,feed.items,runSearch]);

  function changeSearch(value: string) {
    searchController.current?.abort();
    setSearchQuery(value);setSearchPageIndex(0);setSearchError("");
  }

  function changeSearchHomeOnly(checked: boolean) {
    searchController.current?.abort();
    setSearchHomeOnly(checked);setSearchPageIndex(0);setSearchError("");
  }

  function nextSearchPage() {
    const next=searchPageIndex+1;
    if(aggregated.length>=(next+1)*30 || !searchPage.nextCursor) setSearchPageIndex(next);
    else void runSearch(submittedQuery,submittedHomeOnly,searchPage.nextCursor,next,searchPage.items,feed.items);
  }

  async function refresh() {
    if (loading || controller.current) return;
    setLoading(true);
    setError(false);
    setFeedback("");
    const requestController = new AbortController();
    controller.current = requestController;
    try {
      if (feed.workspacePilot?.refreshEnabled) {
        for (let step = 0; step < 35; step++) {
          const response = await fetch("/api/personal/feed/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", cache: "no-store", signal: requestController.signal });
          if (response.status === 401 || response.status === 403) { window.location.assign("/account"); return; }
          if (!response.ok) throw new Error("Refresh unavailable");
          const result = await response.json() as WorkspaceRefreshResult;
          setFeedback(result.state === "progress" ? `${t.scanProgress}: ${result.processed}/${result.total}` : result.state === "busy" ? t.scanBusy : result.state === "reused" ? `${t.scanReused}${result.partial ? ` ${t.scanPartial}` : ""}` : result.partial ? t.scanPartial : t.scanComplete);
          if (result.state !== "progress") break;
          if (step === 34) throw new Error("Refresh step limit reached");
        }
      }
      const response = await fetch("/api/personal/feed", { cache: "no-store", signal: requestController.signal });
      if (response.status === 401 || response.status === 403) { window.location.assign("/account"); return; }
      if (!response.ok) throw new Error("Feed unavailable");
      const payload = await response.json() as PersonalFeed & { preferences: PersonalPreferences };
      setFeed(payload);
      setPreferences(payload.preferences);
      searchSnapshot.current=null;setSearchRequested(false);
    } catch { if (!requestController.signal.aborted) { setError(true); setFeedback(""); } } finally { setLoading(false); controller.current = null; }
  }

  const tabs: Array<{ id: View; label: string; icon: LucideIcon; count?: number }> = [
    { id: "signals", label: t.current, icon: Newspaper, count: feed.items.length },
    { id: "prioritized", label: t.prioritized, icon: Star, count: priorities.length },
    { id: "tracking", label: t.tracking, icon: Radar },
    { id: "meeting", label: t.meeting, icon: ClipboardList, count: meeting.length },
  ];
  const title = searchView && (searchTerm || searchHomeOnly) ? t.searchResults : tabs.find((tab) => tab.id === view)!.label;
  const filterLabel = view === "prioritized" ? t.filterPrioritized : t.filterCurrent;
  const selectClass = "min-h-11 w-full min-w-0 rounded-md border border-[var(--app-line)] bg-[var(--app-panel-strong)] px-3 text-sm";

  return <main lang={preferences.language} className={`missiondesk personal-desk ${light ? "light" : ""}`}>
    <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--app-line)] py-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold"><Link href="/" onClick={event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();setView("signals");window.scrollTo(0,0);
          }} className="rounded-sm hover:text-[var(--app-accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--app-accent)]">MissionDesk</Link></h1>
          <p className="mt-1 text-sm text-[var(--app-muted)]">{feed.workspacePilot ? t.stationNames[preferences.homeCountry] : `${home} · ${t.mexico}`} <span className="px-1">/</span> {t.profileName}</p>
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
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-2">
          {feedback && <span role="status" className="min-w-0 max-w-72 text-right">{feedback}</span>}
          <IconButton label={feed.workspacePilot?.refreshEnabled ? t.refreshFeed : t.latest} icon={loading ? Loader2 : RefreshCw} onClick={() => void refresh()} disabled={loading} />
          <details className="relative">
            <summary title={t.information} aria-label={t.information} className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-md border border-[var(--app-line)]"><Info className="h-4 w-4" /></summary>
            <div className="absolute right-0 top-12 z-20 max-h-[60vh] w-80 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-md border border-[var(--app-line)] bg-[var(--app-panel-strong)] p-4 text-sm leading-6 text-[var(--app-soft)] shadow-xl">
              <h2 className="mb-2 font-semibold text-[var(--app-fg)]">{t.information}</h2><p>{feed.workspacePilot ? t.workspaceInfo : t.info}</p>
              {feed.workspacePilot ? <p className="mt-3">{t.heldCandidates}: {feed.workspacePilot.heldCount}. {feed.workspacePilot.attentionNeeded ? t.sourceAttention : ""}</p> : <p className="mt-3">{t.coverageInfo}</p>}
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

      {searchView ? <section aria-label={t.manualSearch} className="border-b border-[var(--app-line)] py-5">
        <label className="block min-w-0 text-xs text-[var(--app-muted)]">{t.manualSearch}
          <span className="relative mt-2 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4" />
            <input type="search" value={searchQuery} onChange={event=>changeSearch(event.target.value)} maxLength={120} autoComplete="off" placeholder={t.query} className={`${selectClass} pl-10 pr-10 text-[var(--app-fg)]`} />
            {searchPending && <span role="status" aria-label={t.searching} className="pointer-events-none absolute right-3 top-3.5"><Loader2 className="h-4 w-4 animate-spin" /></span>}
          </span>
        </label>
        <label className="mt-3 inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-[var(--app-soft)]"><input type="checkbox" checked={searchHomeOnly} onChange={event=>changeSearchHomeOnly(event.target.checked)} className="h-4 w-4 accent-[var(--app-positive)]" />{t.homeOnly} · {home}</label>
        {searchError && <p role="alert" className="mt-3 text-sm text-[var(--app-danger)]">{searchError}</p>}
      </section> : view !== "meeting" && <section aria-label={filterLabel} className="border-b border-[var(--app-line)] py-5">
        <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_13rem_12rem]">
          <label className="min-w-0 text-xs text-[var(--app-muted)]">{filterLabel}
            <span className="relative mt-2 block"><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4" />
              <input type="search" value={query} onChange={(event) => updateFilters({query:event.target.value})} maxLength={120} placeholder={t.query} className={`${selectClass} pl-10 text-[var(--app-fg)]`} />
            </span>
          </label>
          <label className="min-w-0 text-xs text-[var(--app-muted)]">{t.category}
            <select value={category} onChange={(event) => updateFilters({category:event.target.value})} className={`${selectClass} mt-2 text-[var(--app-fg)]`}>
              <option value="">{t.allCategories}</option>{categories.map((id) => <option key={id} value={id}>{t.categories[id]}</option>)}
            </select>
          </label>
          <label className="min-w-0 text-xs text-[var(--app-muted)]">{t.sort}
            <select value={sort} onChange={(event) => updateFilters({sort:event.target.value})} className={`${selectClass} mt-2 text-[var(--app-fg)]`}>
              <option value="relevance">{t.relevance}</option><option value="newest">{t.newest}</option>
            </select>
          </label>
        </div>
        <label className="mt-4 inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--app-soft)]">
          <input type="checkbox" checked={homeOnly} onChange={(event) => updateFilters({homeOnly:event.target.checked})} className="h-4 w-4 accent-[var(--app-positive)]" />{t.homeOnly} · {home}
        </label>
      </section>}

      <section aria-busy={searchPending} className={view === "meeting" ? "missiondesk-print-panel py-5" : "py-5"}>
        <div className="missiondesk-print-screen-header mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title} <span className="ml-1 text-sm font-normal text-[var(--app-muted)]">{rows.length}</span></h2>
          {view === "meeting" && <div className="missiondesk-print-actions flex gap-2">
            <IconButton label={t.clearSelection} icon={Trash2} onClick={() => {setMeeting([]);setRetained(previous=>Object.fromEntries(Object.entries(previous).filter(([id])=>priorities.includes(id))));}} />
            <button type="button" onClick={() => window.print()} disabled={!rows.length} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-[var(--app-line)] px-3 text-sm disabled:opacity-50"><Printer className="h-4 w-4" />{t.print}</button>
          </div>}
        </div>
        {view === "meeting" && <><h2 className="missiondesk-print-title text-xl font-semibold">{t.meeting}</h2><p className="missiondesk-print-meta">MissionDesk · {feed.workspacePilot ? t.stationNames[preferences.homeCountry] : `${home} · ${t.mexico}`}</p></>}
        {!rows.length && !(searchView && searchError) && <div className="border-t border-[var(--app-line)] py-10 text-sm text-[var(--app-muted)]">
          <p>{view === "meeting" ? t.emptyMeeting : searchPending ? t.searching : searchView && searchTerm.length===1 ? t.searchMinimum : searchView && !searchTerm && !searchHomeOnly ? t.searchNotStarted : t.empty}</p>
        </div>}
        <div className="missiondesk-print-list divide-y divide-[var(--app-line)] border-t border-[var(--app-line)]">
          {rows.map(({ item, content, relevance }) => <article key={item.id} className={`${view === "meeting" ? "missiondesk-print-item " : ""}grid min-w-0 gap-4 py-5 md:grid-cols-[minmax(0,1fr)_10rem]`}>
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--app-muted)]">
                <span>{item.source_name}</span><time dateTime={item.published_at}>{personalDate(item.published_at, preferences.language)}</time>
                <span>{t.categories[personalCategory(item.category)]}</span>
                <span>{t.contentLanguage}: {t.sourceLanguages[content.language] ?? content.language}</span>
                {view!=="meeting" && item.workspace_selection && item.workspace_selection!=="selected" && <span>{t.notInFeed}</span>}
                {item.content_kind==="reference" && <span>{t.sourceKinds.reference}</span>}
              </div>
              <h3 lang={content.language} className="break-words text-base font-medium leading-6"><a href={item.source_url} target="_blank" rel="noopener noreferrer" className="hover:text-[var(--app-accent)]">{content.title}</a></h3>
              {content.summary && <p lang={content.language} className="mt-2 break-words text-sm leading-6 text-[var(--app-soft)]">{content.summary}</p>}
              <div className={`mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs ${view === "meeting" ? "missiondesk-print-screen-only" : ""}`}>
                {view !== "meeting" && <>
                  {item.workspace_selection!=="unassessed" && <span className="text-[var(--app-muted)]">{t.relevance}: <strong className="font-medium text-[var(--app-fg)]">{relevance.score}</strong></span>}
                  {relevance.homeConnection && <span className="inline-flex items-center gap-1 text-[var(--app-gold)]"><Flag className="h-3 w-3" />{home}</span>}
                </>}
                <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="missiondesk-print-screen-only inline-flex items-center gap-1 text-[var(--app-accent)]">{t.openSource}<ExternalLink className="h-3 w-3" /></a>
              </div>
              {view === "meeting" && <p className="missiondesk-print-only missiondesk-print-source mt-3 text-xs text-[var(--app-muted)]">
                <strong>{t.source}: {item.source_name}</strong><br />
                <span dir="ltr">{item.source_url}</span>
              </p>}
            </div>
            <div className="missiondesk-print-actions flex flex-col items-start gap-3 text-xs md:items-stretch">
              {view === "meeting" ? <IconButton label={t.remove} icon={X} onClick={() => selectItem("meeting",item,false)} /> : <>
                <label className="inline-flex min-h-8 cursor-pointer items-center gap-2"><input type="checkbox" checked={priorities.includes(item.id)} onChange={(event) => selectItem("priority",item,event.target.checked)} className="h-4 w-4 accent-[var(--app-positive)]" />{t.prioritize}</label>
                <label className="inline-flex min-h-8 cursor-pointer items-center gap-2"><input type="checkbox" checked={meeting.includes(item.id)} onChange={(event) => selectItem("meeting",item,event.target.checked)} className="h-4 w-4 accent-[var(--app-gold)]" />{t.meeting}</label>
              </>}
            </div>
          </article>)}
        </div>
        {workspaceSearch && searchRequested && submittedSearchMatches && <nav aria-label={t.searchPages} className="mt-5 flex items-center justify-end gap-3 text-sm text-[var(--app-muted)]">
          <IconButton label={t.previousPage} icon={ChevronLeft} disabled={searchPending || searchPageIndex===0} onClick={()=>setSearchPageIndex(index=>index-1)} />
          <span className="min-w-16 text-center tabular-nums">{t.page} {searchPageIndex+1}</span>
          <IconButton label={t.nextPage} icon={ChevronRight} disabled={searchPending || !hasNextSearchPage} onClick={nextSearchPage} />
        </nav>}
      </section>
    </div>
  </main>;
}
