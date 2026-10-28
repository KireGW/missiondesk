import { getAccessMode } from "@/lib/product/config";
import { getPersonalAccount } from "@/lib/product/account";
import { getPersonalPreferences } from "@/lib/product/preferences-store";
import { effectivePlan } from "@/lib/product/plans";
import { parseWorkspaceSearch, searchWorkspace, WorkspaceSearchDenied, WorkspaceSearchLimited } from "@/lib/product/workspace-search";

const headers={"Cache-Control":"private, no-store"};
const reply=(status:number,error:string)=>Response.json({error},{status,headers});
export async function POST(request:Request) {
  if (getAccessMode()!=="personal" || process.env.MISSIONDESK_WORKSPACE_PILOT!=="true") return new Response(null,{status:404});
  const account=await getPersonalAccount();
  if (!account) return reply(401,"authentication_required");
  if (account.status!=="active") return reply(403,"account_suspended");
  if (!process.env.APP_BASE_URL || request.headers.get("origin")!==new URL(process.env.APP_BASE_URL).origin) return reply(403,"invalid_origin");
  if (request.headers.get("content-type")?.split(";")[0].trim()!=="application/json") return reply(415,"json_required");
  const reader=request.body?.getReader();
  if (!reader) return reply(400,"invalid_search");
  const chunks:Uint8Array[]=[];
  let size=0;
  try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>1024){await reader.cancel();return reply(413,"payload_too_large");}chunks.push(part.value);}}
  finally {reader.releaseLock();}
  let input;
  try {input=parseWorkspaceSearch(JSON.parse(Buffer.concat(chunks).toString("utf8")));} catch {return reply(400,"invalid_search");}
  if (!input) return reply(400,"invalid_search");
  try {
    const preferences=await getPersonalPreferences(account.id);
    return Response.json(await searchWorkspace(account.id,preferences.homeCountry,effectivePlan(account).id,input),{headers});
  } catch(error) {
    if (error instanceof WorkspaceSearchLimited) return Response.json({error:"search_rate_limited"},{status:429,headers:{...headers,"Retry-After":String(error.retryAfter)}});
    return error instanceof WorkspaceSearchDenied ? reply(403,"workspace_unavailable") : reply(503,"search_unavailable");
  }
}
