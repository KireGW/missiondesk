import { getAccessMode } from "@/lib/product/config";
import { getPersonalAccount } from "@/lib/product/account";
import { parsePersonalPreferences } from "@/lib/product/profiles";
import { savePersonalPreferences } from "@/lib/product/preferences-store";

const headers = { "Cache-Control": "private, no-store" };
const reply = (status: number, error: string) => Response.json({ error }, { status, headers });

export async function PATCH(request: Request) {
  if (getAccessMode() !== "personal") return new Response(null, { status: 404 });
  const account = await getPersonalAccount();
  if (!account) return reply(401, "authentication_required");
  if (account.status !== "active") return reply(403, "account_suspended");
  if (!process.env.APP_BASE_URL || request.headers.get("origin") !== new URL(process.env.APP_BASE_URL).origin) {
    return reply(403, "invalid_origin");
  }
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply(415, "json_required");
  const reader = request.body?.getReader();
  if (!reader) return reply(400, "invalid_profile");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2048) { await reader.cancel(); return reply(413, "profile_too_large"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reply(400, "invalid_profile"); }
  const preferences = parsePersonalPreferences(value);
  if (!preferences) return reply(400, "invalid_profile");
  if (!await savePersonalPreferences(account.id, preferences)) return reply(403, "profile_not_saved");
  return Response.json({ preferences }, { headers });
}
