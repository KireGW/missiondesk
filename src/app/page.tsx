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
import { signalDisplaySince } from "@/lib/intelligence/cache-policy";
import { getSourcesSync } from "@/lib/sources/store";

export const dynamic = "force-dynamic";

export default function Home() {
  const primaryBriefings = listBriefings({ onlyFresh: true, limit: 8 });
  const primaryRecords = listProcessedItems({
    onlyFresh: true,
    publishedSince: signalDisplaySince(),
    limit: 100,
  });
  const initialItems = processedRecordsToIntelligenceItems(primaryRecords);
  const activeSourceCount = getSourcesSync().filter((source) => source.enabled).length;

  return (
    <MissionDashboard
      config={swedenMexicoEmbassyConfig}
      initialItems={initialItems}
      initialBriefings={primaryBriefings}
      initialCacheTimestamp={latestCacheTimestamp(primaryBriefings, primaryRecords)}
      initialCacheExpiresAt={earliestCacheExpiry(primaryBriefings, primaryRecords)}
      activeSourceCount={activeSourceCount}
    />
  );
}
