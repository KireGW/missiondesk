import { redirect } from "next/navigation";
import { getAccessMode } from "@/lib/product/config";
import { getPersonalAccount } from "@/lib/product/account";
import { getPersonalPreferences } from "@/lib/product/preferences-store";
import { sourceCatalogPreview } from "@/lib/product/source-catalog";
import { ProfileSourceCatalog } from "@/components/product/ProfileSourceCatalog";
import { getPersonalSessionIdentity } from "@/lib/product/auth";
import { interfaceLanguagesForProfile } from "@/lib/product/profiles";
import { readWorkspaceSourceStatus } from "@/lib/product/workspace-source-status";

export const dynamic = "force-dynamic";

export default async function ProfileSourcesPage({ searchParams }: {
  searchParams: Promise<{ home?: string; lang?: string }>;
}) {
  if (getAccessMode() !== "personal") redirect("/");
  const account = await getPersonalAccount();
  if (!account || account.status !== "active") redirect("/account");
  const preferences = await getPersonalPreferences(account.id);
  const identity = await getPersonalSessionIdentity();
  const interfaceLanguages = interfaceLanguagesForProfile(identity?.interfaceProfile);
  const preview = sourceCatalogPreview(preferences, await searchParams, interfaceLanguages);
  const sourceStatus = await readWorkspaceSourceStatus(account.id);
  return <ProfileSourceCatalog home={preview.home} language={preview.language} interfaceLanguages={interfaceLanguages} sourceStatus={sourceStatus} />;
}
