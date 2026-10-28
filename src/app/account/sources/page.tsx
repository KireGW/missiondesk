import { redirect } from "next/navigation";
import { getAccessMode } from "@/lib/product/config";
import { getPersonalAccount } from "@/lib/product/account";
import { getPersonalPreferences } from "@/lib/product/preferences-store";
import { sourceCatalogPreview } from "@/lib/product/source-catalog";
import { ProfileSourceCatalog } from "@/components/product/ProfileSourceCatalog";

export const dynamic = "force-dynamic";

export default async function ProfileSourcesPage({ searchParams }: {
  searchParams: Promise<{ home?: string; lang?: string }>;
}) {
  if (getAccessMode() !== "personal") redirect("/");
  const account = await getPersonalAccount();
  if (!account || account.status !== "active") redirect("/account");
  const preferences = await getPersonalPreferences(account.id);
  const preview = sourceCatalogPreview(preferences, await searchParams);
  return <ProfileSourceCatalog home={preview.home} language={preview.language} />;
}
