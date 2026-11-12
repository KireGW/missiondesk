import type { Pool, PoolClient } from "pg";
import type { IntelligenceItem } from "@/lib/types";
import { getProductPool } from "@/lib/product/store";
import type { PersonalPreferences } from "@/lib/product/profiles";
import type { PlanId } from "@/lib/product/plans";
import { personalSelectionMaterial } from "@/lib/product/selection-material";
import { emptyPersonalSelections, type PersonalSelections, type PersonalSelectionChange, type PersonalSelectionKind } from "@/lib/product/selections";

type Bookmark = Pick<IntelligenceItem,"id"|"title_original"|"source_name"|"source_url"|"source_language"|"published_at"|"category"|"geographic_tags">;
interface SelectionRow { item_id:string;kind:PersonalSelectionKind;bookmark:Bookmark }
export class PersonalSelectionDenied extends Error {}
export class PersonalSelectionConflict extends Error {}
export class PersonalSelectionUnavailable extends Error {}

function bookmark(item: IntelligenceItem): Bookmark {
  const url = new URL(item.source_url);
  if (url.protocol!=="https:" || url.username || url.password) throw new PersonalSelectionUnavailable("Invalid publication link");
  return {id:item.id,title_original:item.title_original,source_name:item.source_name,source_url:item.source_url,
    source_language:item.source_language,published_at:item.published_at,category:item.category,geographic_tags:item.geographic_tags};
}
function bookmarkItem(value: Bookmark): IntelligenceItem {
  return {...value,title_sv:"",summary_sv:"",original_excerpt:"",source_country:"",country:value.geographic_tags.join(", "),region:"",subregion:"",
    geographic_scope:value.geographic_tags.length>1?"cross_border":"national",urgency_score:0,diplomatic_relevance_score:0,sweden_relevance_score:0,
    economic_impact_score:0,security_impact_score:0,public_attention_score:0,profile_tags:[],why_it_matters_sv:"",suggested_talking_points_sv:[]};
}
async function scope(client: PoolClient, accountId: string) {
  if ((await client.query("SELECT current_user AS role")).rows[0]?.role!=="missiondesk_personal_app") throw new PersonalSelectionDenied("Scoped application role required");
  await client.query("SET LOCAL statement_timeout='8s'");
  await client.query("SELECT set_config('missiondesk.account_id',$1,true)",[accountId]);
  if (!(await client.query("SELECT id FROM product_accounts WHERE id=$1 AND status='active'",[accountId])).rowCount) throw new PersonalSelectionDenied("Active account required");
}
async function snapshot(client: PoolClient, accountId: string, preferences: PersonalPreferences, plan: PlanId): Promise<PersonalSelections> {
  // Read revision and rows in one SQL snapshot, including after a concurrent writer commits.
  const record = (await client.query(`SELECT coalesce(s.revision,0)::text AS revision,
    coalesce((SELECT jsonb_agg(jsonb_build_object('item_id',v.item_id,'kind',v.kind,'bookmark',v.bookmark) ORDER BY v.created_at,v.item_id,v.kind)
      FROM product_account_selections v WHERE v.account_id=$1),'[]'::jsonb) AS selections
    FROM (SELECT $1::uuid AS id) a LEFT JOIN product_account_selection_state s ON s.account_id=a.id`,[accountId])).rows[0];
  const result = {...emptyPersonalSelections(accountId),revision:record.revision};
  const rows = record.selections as SelectionRow[];
  const ids = [...new Set(rows.map(row=>row.item_id))];
  const full = new Map((await personalSelectionMaterial(client,accountId,preferences,plan,ids)).map(item=>[item.id,item]));
  for (const row of rows) {
    (row.kind==="priority"?result.priorities:result.meeting).push(row.item_id);
    result.retained[row.item_id]=full.get(row.item_id) ?? bookmarkItem(row.bookmark);
  }
  result.bookmarkOnlyIds=ids.filter(id=>!full.has(id));
  return result;
}
export async function getPersonalSelections(accountId:string, preferences:PersonalPreferences, plan:PlanId, db:Pool=getProductPool()):Promise<PersonalSelections> {
  const client = await db.connect();
  try {await client.query("BEGIN READ ONLY");await scope(client,accountId);const result=await snapshot(client,accountId,preferences,plan);await client.query("COMMIT");return result;}
  catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
export async function changePersonalSelection(accountId:string, preferences:PersonalPreferences, plan:PlanId, change:PersonalSelectionChange, db:Pool=getProductPool()):Promise<PersonalSelections> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");await scope(client,accountId);
    await client.query("INSERT INTO product_account_selection_state(account_id) VALUES($1) ON CONFLICT DO NOTHING",[accountId]);
    const revision = (await client.query("SELECT revision::text FROM product_account_selection_state WHERE account_id=$1 FOR UPDATE",[accountId])).rows[0]?.revision;
    if (revision===undefined) throw new PersonalSelectionDenied("Selection state unavailable");
    let changed = 0;
    if ("clear" in change) {
      if (revision!==change.revision) throw new PersonalSelectionConflict("Selection changed in another tab");
      changed=(await client.query("DELETE FROM product_account_selections WHERE account_id=$1 AND kind='meeting'",[accountId])).rowCount ?? 0;
    } else if (!change.selected) {
      changed=(await client.query("DELETE FROM product_account_selections WHERE account_id=$1 AND item_id=$2 AND kind=$3",[accountId,change.itemId,change.kind])).rowCount ?? 0;
    } else {
      const material = await personalSelectionMaterial(client,accountId,preferences,plan,[change.itemId]);
      const owned = (await client.query("SELECT bookmark FROM product_account_selections WHERE account_id=$1 AND item_id=$2 LIMIT 1",[accountId,change.itemId])).rows[0]?.bookmark as Bookmark|undefined;
      const value = material[0] ? bookmark(material[0]) : owned;
      if (!value) throw new PersonalSelectionUnavailable("Article is not available to this account");
      changed=(await client.query(`INSERT INTO product_account_selections(account_id,item_id,kind,bookmark) VALUES($1,$2,$3,$4::jsonb)
        ON CONFLICT(account_id,item_id,kind) DO NOTHING`,[accountId,change.itemId,change.kind,JSON.stringify(value)])).rowCount ?? 0;
    }
    if (changed) await client.query("UPDATE product_account_selection_state SET revision=revision+1,updated_at=now() WHERE account_id=$1",[accountId]);
    const result=await snapshot(client,accountId,preferences,plan);
    await client.query("COMMIT");return result;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
