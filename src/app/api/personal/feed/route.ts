import { getAccessMode } from "@/lib/product/config";
import { getPersonalAccount } from "@/lib/product/account";
import { effectivePlan } from "@/lib/product/plans";
import { getPersonalFeed } from "@/lib/product/feed-store";
import { getPersonalPreferences } from "@/lib/product/preferences-store";
import { addWorkspaceFeed } from "@/lib/product/workspace-feed";

export async function GET() {
  if (getAccessMode() !== "personal") return new Response(null, { status: 404 });
  const account = await getPersonalAccount();
  if (!account) return Response.json({ error: "Inloggning krävs." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  if (account.status !== "active") return Response.json({ error: "Kontot är pausat." }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  const preferences = await getPersonalPreferences(account.id);
  const plan = effectivePlan(account);
  const feed = await addWorkspaceFeed(account.id, preferences, await getPersonalFeed(plan.id), plan.id);
  return Response.json({ ...feed, preferences }, { headers: { "Cache-Control": "private, no-store" } });
}
