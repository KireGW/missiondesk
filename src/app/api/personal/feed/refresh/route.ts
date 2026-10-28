import { getAccessMode } from "@/lib/product/config";
import { getPersonalAccount } from "@/lib/product/account";
import { getPersonalPreferences } from "@/lib/product/preferences-store";
import { refreshWorkspaceStep, WorkspaceRefreshDenied } from "@/lib/product/workspace-refresh";

export const maxDuration = 60;
const headers={"Cache-Control":"private, no-store"};
const reply=(status:number,error:string)=>Response.json({error},{status,headers});
export async function POST(request:Request) {
  if (getAccessMode()!=="personal" || process.env.MISSIONDESK_WORKSPACE_PILOT!=="true" || process.env.MISSIONDESK_WORKSPACE_REFRESH!=="true") return new Response(null,{status:404});
  const account=await getPersonalAccount();
  if (!account) return reply(401,"authentication_required");
  if (account.status!=="active") return reply(403,"account_suspended");
  if (!process.env.APP_BASE_URL || request.headers.get("origin")!==new URL(process.env.APP_BASE_URL).origin) return reply(403,"invalid_origin");
  if (request.headers.get("content-type")?.split(";")[0].trim()!=="application/json") return reply(415,"json_required");
  const reader=request.body?.getReader();
  if (!reader) return reply(400,"empty_object_required");
  const chunks:Uint8Array[]=[];
  let size=0;
  try {while(true) {const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>128){await reader.cancel();return reply(413,"payload_too_large");}chunks.push(part.value);}}
  finally {reader.releaseLock();}
  try {const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));if(!body || Array.isArray(body) || typeof body!=="object" || Object.keys(body).length) return reply(400,"empty_object_required");}
  catch {return reply(400,"invalid_json");}
  try {
    const preferences=await getPersonalPreferences(account.id);
    return Response.json(await refreshWorkspaceStep(account.id,preferences.homeCountry),{headers});
  } catch(error) {
    return error instanceof WorkspaceRefreshDenied ? reply(403,"workspace_unavailable") : reply(503,"refresh_unavailable");
  }
}
