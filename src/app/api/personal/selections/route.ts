import { getAccessMode } from "@/lib/product/config";
import { getPersonalAccount } from "@/lib/product/account";
import { getPersonalPreferences } from "@/lib/product/preferences-store";
import { effectivePlan } from "@/lib/product/plans";
import { parsePersonalSelectionChange } from "@/lib/product/selections";
import { changePersonalSelection, getPersonalSelections, PersonalSelectionConflict, PersonalSelectionDenied, PersonalSelectionUnavailable } from "@/lib/product/selections-store";

const headers={"Cache-Control":"private, no-store"};
const reply=(status:number,error:string)=>Response.json({error},{status,headers});
export async function GET() {
  if(getAccessMode()!=="personal")return new Response(null,{status:404});
  const account=await getPersonalAccount();
  if(!account)return reply(401,"authentication_required");
  if(account.status!=="active")return reply(403,"account_suspended");
  try{return Response.json(await getPersonalSelections(account.id,await getPersonalPreferences(account.id),effectivePlan(account).id),{headers});}
  catch(error){return error instanceof PersonalSelectionDenied?reply(403,"selection_denied"):reply(503,"selections_unavailable");}
}
export async function PATCH(request:Request) {
  if(getAccessMode()!=="personal")return new Response(null,{status:404});
  const account=await getPersonalAccount();
  if(!account)return reply(401,"authentication_required");
  if(account.status!=="active")return reply(403,"account_suspended");
  if(!process.env.APP_BASE_URL || request.headers.get("origin")!==new URL(process.env.APP_BASE_URL).origin)return reply(403,"invalid_origin");
  if(request.headers.get("x-selection-account")!==account.id)return reply(409,"account_changed");
  if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")return reply(415,"json_required");
  const reader=request.body?.getReader();if(!reader)return reply(400,"invalid_selection");
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
    if(size>2048){await reader.cancel();return reply(413,"selection_too_large");}chunks.push(chunk.value);}}
  catch{return reply(400,"invalid_selection");}finally{reader.releaseLock();}
  let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return reply(400,"invalid_selection");}
  const change=parsePersonalSelectionChange(value);if(!change)return reply(400,"invalid_selection");
  try{return Response.json(await changePersonalSelection(account.id,await getPersonalPreferences(account.id),effectivePlan(account).id,change),{headers});}
  catch(error){return error instanceof PersonalSelectionConflict?reply(409,"selection_changed")
    :error instanceof PersonalSelectionDenied?reply(403,"selection_denied")
    :error instanceof PersonalSelectionUnavailable?reply(404,"article_unavailable"):reply(503,"selection_not_saved");}
}
