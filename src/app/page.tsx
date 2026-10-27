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

export const dynamic = "force-dynamic";

export default async function Home() {
  const mode = getAccessMode();
  if (mode === "invalid") throw new Error("Ogiltig MISSIONDESK_ACCESS_MODE.");
  if (mode === "personal") {
    const account = await getPersonalAccount();
    if (!account || account.status !== "active") redirect("/account");
    const plan = effectivePlan(account);
    const feed = await getPersonalFeed(plan.id);
    const preferences = await getPersonalPreferences(account.id);
    return <PersonalDashboard key={`${preferences.homeCountry}:${preferences.language}`} initialFeed={feed} initialPreferences={preferences} plan={plan.id} />;
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
