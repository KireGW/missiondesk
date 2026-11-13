import { MissionDashboard } from "@/components/dashboard/MissionDashboard";
import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import {
  earliestCacheExpiry,
  latestCacheTimestamp,
  processedRecordsToIntelligenceItems,
} from "@/lib/intelligence/dashboard-view";
import {
  listBriefings,
  listProcessedItems,
} from "@/lib/intelligence/repository";
import { getDashboardUpdateStatus } from "@/lib/intelligence/dashboard-status-store";
import { signalDisplaySince } from "@/lib/intelligence/cache-policy";
import { getSources } from "@/lib/sources/store";
import { redirect } from "next/navigation";
import { getAccessMode } from "@/lib/product/config";
import { getPersonalAccount } from "@/lib/product/account";
import { effectivePlan } from "@/lib/product/plans";
import { getPersonalFeed } from "@/lib/product/feed-store";
import { getPersonalPreferences } from "@/lib/product/preferences-store";
import { PersonalDashboard } from "@/components/product/PersonalDashboard";
import { addWorkspaceFeed } from "@/lib/product/workspace-feed";
import { getPersonalSessionIdentity } from "@/lib/product/auth";
import { getPilotLoginRedirect } from "@/lib/product/username-login";
import { getPersonalSelections } from "@/lib/product/selections-store";
import { initializeCurrentReview } from "@/lib/product/current-review-store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const mode = getAccessMode();
  if (mode === "invalid") throw new Error("Ogiltig MISSIONDESK_ACCESS_MODE.");
  if (mode === "personal") {
    const account = await getPersonalAccount();
    if (!account || account.status !== "active") {
      const login = getPilotLoginRedirect(Boolean(await getPersonalSessionIdentity()));
      redirect(login ?? "/account");
    }
    const plan = effectivePlan(account);
    const preferences = await getPersonalPreferences(account.id);
    const [feed,selections] = await Promise.all([
      getPersonalFeed(plan.id).then(feed=>addWorkspaceFeed(account.id,preferences,feed,plan.id)),
      getPersonalSelections(account.id,preferences,plan.id).catch(()=>null),
    ]);
    const review=await initializeCurrentReview(account.id,preferences,plan.id,[...new Set((feed.currentItems??feed.items).map(item=>item.id))]).catch(()=>null);
    return <PersonalDashboard key={`${account.id}:${preferences.homeCountry}:${preferences.language}:${preferences.contentLanguage}`}
      selectionAccountId={account.id} initialSelections={selections} initialCurrentReview={review} initialFeed={feed} initialPreferences={preferences} plan={plan.id} />;
  }
  const primaryBriefings = await listBriefings({ onlyFresh: true, limit: 8 });
  const primaryRecords = await listProcessedItems({
    onlyFresh: true,
    publishedSince: signalDisplaySince(),
    limit: 100,
  });
  const referenceRecords = await listProcessedItems({ onlyFresh: false, referenceOnly: true, limit: 25 });
  const initialItems = processedRecordsToIntelligenceItems([...new Map(
    [...primaryRecords, ...referenceRecords].map((record) => [record.raw.id, record]),
  ).values()]);
  const activeSourceCount = (await getSources()).filter((source) => source.enabled).length;
  const updateStatus = await getDashboardUpdateStatus();

  return (
    <MissionDashboard
      config={swedenMexicoEmbassyConfig}
      initialItems={initialItems}
      initialBriefings={primaryBriefings}
      initialCacheTimestamp={latestCacheTimestamp(primaryBriefings, primaryRecords)}
      initialCacheExpiresAt={earliestCacheExpiry(primaryBriefings, primaryRecords)}
      activeSourceCount={activeSourceCount}
      initialUpdateStatus={updateStatus}
    />
  );
}
