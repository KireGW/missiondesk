import type { Pool, PoolClient } from "pg";
import { getProductPool } from "@/lib/product/store";
import { personalSelectionMaterial } from "@/lib/product/selection-material";
import type { PersonalPreferences } from "@/lib/product/profiles";
import { productPlans, type PlanId } from "@/lib/product/plans";
import { emptyCurrentReview, parseCurrentReviewChange, type CurrentReview, type CurrentReviewChange } from "@/lib/product/current-review";

export class CurrentReviewDenied extends Error {}
export class CurrentReviewConflict extends Error {}
export class CurrentReviewUnavailable extends Error {}
async function scope(client:PoolClient,accountId:string) {
  if((await client.query("SELECT current_user AS role")).rows[0]?.role!=="missiondesk_personal_app")throw new CurrentReviewDenied("Scoped role required");
  await client.query("SET LOCAL statement_timeout='8s'");
  await client.query("SELECT set_config('missiondesk.account_id',$1,true)",[accountId]);
  if(!(await client.query("SELECT id FROM product_accounts WHERE id=$1 AND status='active'",[accountId])).rowCount)throw new CurrentReviewDenied("Active account required");
}
interface ReviewRow {revision:string;baseline_ids:string[];reviewed_at:Date|null}
const snapshot=(accountId:string,row?:ReviewRow):CurrentReview=>row
  ? {accountId,initialized:true,revision:row.revision,baselineIds:row.baseline_ids,reviewedAt:row.reviewed_at?.toISOString()??null}
  : emptyCurrentReview(accountId);
const read=async(client:PoolClient,accountId:string,lock=false)=>(await client.query<ReviewRow>(
  `SELECT revision::text,baseline_ids,reviewed_at FROM product_account_current_review WHERE account_id=$1${lock?" FOR UPDATE":""}`,[accountId])).rows[0];
export async function getCurrentReview(accountId:string,db:Pool=getProductPool()):Promise<CurrentReview> {
  const client=await db.connect();
  try{await client.query("BEGIN READ ONLY");await scope(client,accountId);const result=snapshot(accountId,await read(client,accountId));await client.query("COMMIT");return result;}
  catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function changeCurrentReview(accountId:string,preferences:PersonalPreferences,plan:PlanId,change:CurrentReviewChange,db:Pool=getProductPool()):Promise<CurrentReview> {
  if(!parseCurrentReviewChange(change,productPlans[plan].feedLimit))throw new CurrentReviewUnavailable("Invalid comparison point");
  const client=await db.connect();
  try{
    await client.query("BEGIN");await scope(client,accountId);
    const previous=await read(client,accountId,true);
    // Initialization never replaces a comparison point already established in another request/tab.
    if(change.action==="initialize" && previous){await client.query("COMMIT");return snapshot(accountId,previous);}
    if(change.action==="acknowledge" && (!previous || previous.revision!==change.revision))throw new CurrentReviewConflict("Review changed in another tab");
    const available=new Set((await personalSelectionMaterial(client,accountId,preferences,plan,change.ids)).map(item=>item.id));
    if(change.ids.some(id=>!available.has(id)))throw new CurrentReviewUnavailable("Displayed selection is no longer available");
    if(change.action==="initialize")await client.query(`INSERT INTO product_account_current_review(account_id,baseline_ids) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING`,[accountId,JSON.stringify(change.ids)]);
    else await client.query(`UPDATE product_account_current_review SET baseline_ids=$2::jsonb,revision=revision+1,reviewed_at=now() WHERE account_id=$1`,[accountId,JSON.stringify(change.ids)]);
    const result=snapshot(accountId,await read(client,accountId));
    await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
/** Called with the already-computed Current signals IDs. Does not fetch, sort or alter the feed. */
export async function initializeCurrentReview(accountId:string,preferences:PersonalPreferences,plan:PlanId,ids:string[],db:Pool=getProductPool()):Promise<CurrentReview> {
  const existing=await getCurrentReview(accountId,db);
  return existing.initialized?existing:changeCurrentReview(accountId,preferences,plan,{action:"initialize",revision:"0",ids},db);
}
