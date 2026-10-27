import { SourceManager } from "@/components/sources/SourceManager";
import { auditSources } from "@/lib/sources/audit";
import { getSources } from "@/lib/sources/store";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const sources = await getSources();
  return <SourceManager initialSources={sources} initialAudit={auditSources(sources)} />;
}
