import { SourceManager } from "@/components/sources/SourceManager";
import { auditSources } from "@/lib/sources/audit";
import { getSources } from "@/lib/sources/store";
import { redirect } from "next/navigation";
import { getAccessMode } from "@/lib/product/config";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  if (getAccessMode() !== "legacy") redirect("/account");
  const sources = await getSources();
  return <SourceManager initialSources={sources} initialAudit={auditSources(sources)} />;
}
