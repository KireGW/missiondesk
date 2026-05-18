import { SourceManager } from "@/components/sources/SourceManager";
import { getSources } from "@/lib/sources/store";

export default async function SourcesPage() {
  return <SourceManager initialSources={await getSources()} />;
}
