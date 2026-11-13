import { getAccessMode } from "@/lib/product/config";
import { getPersonalAccount } from "@/lib/product/account";
import { getPersonalPreferences } from "@/lib/product/preferences-store";
import { effectivePlan } from "@/lib/product/plans";
import { parseCurrentReviewChange } from "@/lib/product/current-review";
import { getCurrentReview, changeCurrentReview, CurrentReviewDenied, CurrentReviewConflict, CurrentReviewUnavailable } from "@/lib/product/current-review-store";

const headers={"Cache-Control":"private, no-store"};
const reply=(status:number,error:string)=>Response.json({error},{status,headers});
export async function GET() {
  if(getAccessMode()!=="personal")return new Response(null,{status:404});
  const account=await getPersonalAccount();if(!account)return reply(401,"authentication_required");
  if(account.status!=="active")return reply(403,"account_suspended");
  try{return Response.json(await getCurrentReview(account.id),{headers});}
  catch(error){return error instanceof CurrentReviewDenied?reply(403,"review_denied"):reply(503,"review_unavailable");}
}
export async function POST(request:Request) {
  if(getAccessMode()!=="personal")return new Response(null,{status:404});
  const account=await getPersonalAccount();if(!account)return reply(401,"authentication_required");
  if(account.status!=="active")return reply(403,"account_suspended");
  if(!process.env.APP_BASE_URL || request.headers.get("origin")!==new URL(process.env.APP_BASE_URL).origin)return reply(403,"invalid_origin");
  if(request.headers.get("x-review-account")!==account.id)return reply(409,"account_changed");
  if(request.headers.get("content-type")?.split(";")[0].trim()!=="application/json")return reply(415,"json_required");
  const reader=request.body?.getReader();if(!reader)return reply(400,"invalid_review");
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>16384){await reader.cancel();return reply(413,"review_too_large");}chunks.push(chunk.value);}}
  catch{return reply(400,"invalid_review");}finally{reader.releaseLock();}
  let value:unknown;try{value=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{return reply(400,"invalid_review");}
  const plan=effectivePlan(account),change=parseCurrentReviewChange(value,plan.feedLimit);if(!change)return reply(400,"invalid_review");
  try{return Response.json(await changeCurrentReview(account.id,await getPersonalPreferences(account.id),plan.id,change),{headers});}
  catch(error){return error instanceof CurrentReviewDenied?reply(403,"review_denied"):error instanceof CurrentReviewConflict?reply(409,"review_changed")
    :error instanceof CurrentReviewUnavailable?reply(409,"review_material_unavailable"):reply(503,"review_not_saved");}
}
