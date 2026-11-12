import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { personalAdmin } from "./workspace-admin";
import { personalSelectionsSchemaSql } from "../src/lib/product/selections-schema";

if(!process.argv.includes("--apply"))throw new Error("Explicit --apply required for the additive personal selection migration");
const admin=personalAdmin();
assert.equal(admin.parentId,process.env.MISSIONDESK_SELECTION_MIGRATION_BRANCH_ID,"Explicit verified pilot branch required");
const db=admin.connect(admin.parentId),client=await db.connect();
const newTables=["product_account_selection_state","product_account_selections"];
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  await client.query("SET LOCAL statement_timeout='20s'");
  await client.query("SELECT pg_advisory_xact_lock(713492,37)");
  const columns=async()=>(await client.query(`SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND NOT(table_name=ANY($1::text[])) ORDER BY table_name,ordinal_position`,[newTables])).rows;
  const fingerprint=async()=>{
    const result:Record<string,unknown>={};
    for(const table of ["product_accounts","product_account_preferences","product_public_articles","product_workspace_candidates","product_workspace_scan_runs","product_usage","raw_source_items","processed_items"]){
      if((await client.query("SELECT to_regclass($1) AS table",[`public.${table}`])).rows[0].table)
        result[table]=(await client.query(`SELECT count(*)::int AS count,md5(string_agg(md5(row_to_json(v)::text),'' ORDER BY md5(row_to_json(v)::text))) AS hash FROM ${table} v`)).rows[0];
    }
    return result;
  };
  const beforeColumns=await columns(),beforeRows=await fingerprint();
  await client.query(personalSelectionsSchemaSql);
  assert.deepEqual(await columns(),beforeColumns,"Existing columns and defaults must be unchanged");
  assert.deepEqual(await fingerprint(),beforeRows,"Existing engine/account rows must be unchanged");
  const isolation=(await client.query("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname=ANY($1::text[]) ORDER BY relname",[newTables])).rows;
  assert.equal(isolation.length,2);assert.ok(isolation.every(row=>row.relrowsecurity&&row.relforcerowsecurity));
  await client.query("COMMIT");
  const report={branch:admin.parentId,verifiedAt:new Date().toISOString(),addedTables:newTables,
    existingSchemaUnchanged:true,existingRowsUnchanged:true,rls:isolation,
    schemaFingerprint:createHash("sha256").update(JSON.stringify(beforeColumns)).digest("hex")};
  if(process.env.MISSIONDESK_SELECTION_MIGRATION_REPORT)writeFileSync(process.env.MISSIONDESK_SELECTION_MIGRATION_REPORT,JSON.stringify(report,null,2)+"\n");
  console.log("Personal selections migration complete: two account-scoped tables; existing engine and account rows unchanged.");
}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();await db.end();}
