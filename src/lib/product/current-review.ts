import { validSelectionId, validSelectionRevision } from "@/lib/product/selections";

export interface CurrentReview {
  accountId: string;
  initialized: boolean;
  revision: string;
  baselineIds: string[];
  reviewedAt: string|null;
}
export interface CurrentReviewChange {
  action: "initialize"|"acknowledge";
  revision: string;
  ids: string[];
}
export const emptyCurrentReview=(accountId:string):CurrentReview=>({accountId,initialized:false,revision:"0",baselineIds:[],reviewedAt:null});
export function parseCurrentReviewChange(value:unknown,limit:number):CurrentReviewChange|null {
  if(!value || typeof value!=="object" || Array.isArray(value))return null;
  const body=value as Record<string,unknown>;
  if(Object.keys(body).sort().join(",")!=="action,ids,revision" || !["initialize","acknowledge"].includes(String(body.action))
    || !validSelectionRevision(body.revision) || body.action==="initialize" && body.revision!=="0"
    || !Array.isArray(body.ids) || body.ids.length>limit || !body.ids.every(validSelectionId) || new Set(body.ids).size!==body.ids.length)return null;
  return {action:body.action as CurrentReviewChange["action"],revision:body.revision,ids:body.ids};
}
/** Membership only: publication dates, relevance and the supplied order are never changed. */
export function newCurrentSignalIds(ids:readonly string[],review:CurrentReview|null|undefined):string[] {
  if(!review?.initialized)return [];
  const baseline=new Set(review.baselineIds);
  return ids.filter(id=>!baseline.has(id));
}
