import { MissionDashboard } from "@/components/dashboard/MissionDashboard";
import { swedenMexicoEmbassyConfig } from "@/lib/config/embassies/sweden-mexico";
import {
  earliestCacheExpiry,
  latestCacheTimestamp,
  processedRecordsToIntelligenceItems,
} from "@/lib/intelligence/dashboard-view";
import { listBriefings, listProcessedItems } from "@/lib/intelligence/repository";

export const dynamic = "force-dynamic";

export default function Home() {
  const primaryBriefings = listBriefings({ onlyFresh: true, limit: 8 });
  const primaryRecords = listProcessedItems({ onlyFresh: true, limit: 60 });
  const initialItems = processedRecordsToIntelligenceItems(primaryRecords);

  return (
    <MissionDashboard
      config={swedenMexicoEmbassyConfig}
      initialItems={initialItems}
      initialBriefings={primaryBriefings}
      initialCacheTimestamp={latestCacheTimestamp(primaryBriefings, primaryRecords)}
      initialCacheExpiresAt={earliestCacheExpiry(primaryBriefings, primaryRecords)}
    />
  );
}
