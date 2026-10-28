import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { personalAdmin } from "./workspace-admin";
import { workspaceSchemaSql } from "../src/lib/product/workspace-schema";
import { evaluateWorkspace, scanWorkspace } from "../src/lib/product/workspace-ingestion";
import { workspacePilotSources } from "../src/lib/product/workspace-pilot-sources";
import { personalStations } from "../src/lib/product/profiles";
import type { WorkspacePolicy } from "../src/lib/product/workspace-candidates";
import { workspaceRefreshSchemaSql } from "../src/lib/product/workspace-refresh-schema";
import { refreshWorkspaceStep } from "../src/lib/product/workspace-refresh";
import { workspaceSources } from "../src/lib/product/workspace-pilot-sources";

const mode = process.argv[2];
if (!["--rehearse","--apply"].includes(mode)) throw new Error("Use --rehearse or --apply");
const admin = personalAdmin();
const name = `verify-workspace-${randomUUID().slice(0,8)}`;
const created = admin.neon(["branches","create","--project-id",admin.project,"--parent",admin.parentId,"--name",name,
  "--no-secrets","--cu","0.25","--expires-at",new Date(Date.now()+3_600_000).toISOString()]);
const branch = created.branch ?? created;
if (!branch.id || branch.id === admin.parentId || branch.parent_id !== admin.parentId || branch.name !== name || branch.primary || branch.default) throw new Error("Wrong rehearsal branch");
let db: Pool | undefined;
let appDb: Pool | undefined;
try {
  db = admin.connect(branch.id);
  const before = (await db.query("SELECT (SELECT COUNT(*) FROM raw_source_items)::int AS raw, (SELECT COUNT(*) FROM processed_items)::int AS processed")).rows;
  await db.query(workspaceSchemaSql);
  await db.query(workspaceRefreshSchemaSql);
  const source = workspacePilotSources[0];
  await db.query(`INSERT INTO product_public_sources (id,name,feed_url,article_host,language) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (id) DO NOTHING`,[source.id,source.name,source.feedUrl,source.host,source.language]);
  const accounts = [randomUUID(),randomUUID(),randomUUID()];
  for (const id of accounts) await db.query("INSERT INTO product_accounts (id,auth_subject) VALUES ($1,$2)",[id,`workspace-test:${id}`]);
  const policies: WorkspacePolicy[] = [
    {id:randomUUID(),homeCountry:"SE",countries:["MX"]},
    {id:randomUUID(),homeCountry:"NO",countries:[...personalStations.NO.countries]},
  ];
  for (const [index,p] of policies.entries()) {
    await db.query("INSERT INTO product_workspaces (id,slug,home_country,countries,enabled) VALUES ($1,$4,$2,$3::jsonb,true)",[p.id,p.homeCountry,JSON.stringify(p.countries),p.id]);
    await db.query("INSERT INTO product_workspace_members VALUES ($1,$2,'owner')",[p.id,accounts[index]]);
    await db.query("INSERT INTO product_workspace_sources VALUES ($1,$2)",[p.id,source.id]);
  }
  let calls=0;
  const fetchBefore=globalThis.fetch;
  const fixtureUrl=`https://${source.host}/workspace-fixture-${randomUUID()}`;
  try {
    globalThis.fetch=async(input)=>{assert.equal(String(input),source.feedUrl,"Only subscribed sources may be fetched");calls++;return new Response(`<rss><channel><item><title>Norway and Mexico meet today</title><link>${fixtureUrl}</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`);};
    for (const order of [policies,[...policies].reverse()]) {
      await db.query("DELETE FROM product_public_articles WHERE source_id=$1",[source.id]);
      await db.query("UPDATE product_public_sources SET last_success_at=NULL WHERE id=$1",[source.id]);
      calls=0;
      for (const p of order) await scanWorkspace(db,p);
      assert.equal(calls,1,"Second workspace must reuse the raw fetch, not lose its own evaluation");
      const rows: Array<{workspace_id:string;status:string}>=(await db.query("SELECT workspace_id,status FROM product_workspace_candidates WHERE workspace_id=ANY($1::uuid[]) ORDER BY workspace_id",[policies.map(p=>p.id)])).rows;
      assert.equal(rows.find(r=>r.workspace_id===policies[0].id)?.status,"held");
      assert.equal(rows.find(r=>r.workspace_id===policies[1].id)?.status,"selected");
    }
    await db.query("DELETE FROM product_public_articles WHERE source_id=$1",[source.id]);
    await db.query("UPDATE product_public_sources SET last_success_at=NULL WHERE id=$1",[source.id]);
    calls=0;
    await Promise.all(policies.map(p=>scanWorkspace(db!,p)));
    assert.equal(calls,1,"Concurrent scans must coalesce to one public fetch");
  } finally {globalThis.fetch=fetchBefore;}
  const versionClient=await db.connect();
  try {
    await db.query("UPDATE product_public_articles SET title='No explicit country evidence', countries='[]', content_hash='changed-fixture' WHERE source_id=$1",[source.id]);
    const current=(await db.query(`SELECT COUNT(*)::int AS count FROM product_workspace_candidates c JOIN product_public_articles a ON a.id=c.article_id
      WHERE c.workspace_id=ANY($1::uuid[]) AND c.content_hash=a.content_hash`,[policies.map(p=>p.id)])).rows[0].count;
    assert.equal(current,0,"Old decisions must not apply to changed content");
    for(const p of policies) assert.equal((await evaluateWorkspace(versionClient,p)).held,1);
  } finally {versionClient.release();}
  appDb=admin.connect(branch.id,"missiondesk_personal_app");
  const client=await appDb.connect();
  try {
    for (const [index,accountId] of accounts.entries()) {
      await client.query("BEGIN");
      await client.query("SELECT set_config('missiondesk.account_id',$1,true)",[accountId]);
      const visible=(await client.query("SELECT DISTINCT workspace_id FROM product_workspace_candidates")).rows;
      assert.equal(visible.length,index<2?1:0);
      if(index<2) assert.equal(visible[0].workspace_id,policies[index].id);
      assert.equal((await client.query("SELECT * FROM product_public_sources")).rowCount,index<2?1:0);
      await client.query("ROLLBACK");
    }
    await client.query("BEGIN");
    assert.equal((await client.query("SELECT * FROM product_public_articles")).rowCount,0,"No identity must mean no rows, including on a reused pooled connection");
    await assert.rejects(client.query("INSERT INTO product_workspace_members VALUES ($1,$2,'owner')",[policies[1].id,accounts[2]]),
      (e: unknown)=>(e as {code:string}).code==="42501");
    await client.query("ROLLBACK");
  } finally {client.release();}
  const page=workspaceSources.find(source=>source.id==="no-mx-noref")!;
  await db.query(`INSERT INTO product_public_sources(id,name,feed_url,article_host,language,fetch_mode) VALUES($1,$2,$3,$4,$5,'page')
    ON CONFLICT(id) DO UPDATE SET fetch_mode='page',last_success_at=NULL`,[page.id,page.name,page.feedUrl,page.host,page.language]);
  await db.query("INSERT INTO product_workspace_sources VALUES($1,$2)",[policies[0].id,page.id]);
  await db.query("INSERT INTO product_workspace_members VALUES($1,$2,'member')",[policies[0].id,accounts[2]]);
  await db.query("UPDATE product_public_sources SET last_success_at=NULL WHERE id=$1",[source.id]);
  let dailyCalls=0;
  const dailyFetch=globalThis.fetch;
  try {
    globalThis.fetch=async(input)=>{
      dailyCalls++;
      if(String(input)===page.feedUrl) return new Response(`<html><title>Reference</title><main>${"Public reference material for monitored countries. ".repeat(5)}</main></html>`,{headers:{"Content-Type":"text/html"}});
      assert.equal(String(input),source.feedUrl);
      return new Response(`<rss><channel><item><title>Mexico trade announcement</title><link>${fixtureUrl}</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`);
    };
    assert.equal((await refreshWorkspaceStep(accounts[0],"SE",appDb)).state,"progress","First request must commit one source, not launch a detached job");
    await Promise.all([refreshWorkspaceStep(accounts[0],"SE",appDb),refreshWorkspaceStep(accounts[2],"SE",appDb)]);
    const final=await refreshWorkspaceStep(accounts[2],"SE",appDb);
    assert.equal(final.state,"reused");
    assert.equal(final.processed,2);
    assert.equal(dailyCalls,2,"Colleagues share one daily scan and interrupted runs resume without refetching completed sources");
    await assert.rejects(()=>refreshWorkspaceStep(accounts[0],"NO",appDb));
    await assert.rejects(()=>refreshWorkspaceStep(randomUUID(),"SE",appDb));
    assert.equal(dailyCalls,2);
    const audit=await appDb.connect();
    try {
      await audit.query("BEGIN");
      await audit.query("SELECT set_config('missiondesk.account_id',$1,true)",[accounts[0]]);
      assert.equal((await audit.query("SELECT * FROM product_workspace_scan_runs")).rowCount,1);
      await assert.rejects(audit.query("UPDATE product_workspace_scan_runs SET run_day=run_day+1"),(e:unknown)=>(e as {code:string}).code==="42501");
      await audit.query("ROLLBACK");
      await audit.query("BEGIN");
      await audit.query("SELECT set_config('missiondesk.account_id',$1,true)",[accounts[0]]);
      await assert.rejects(audit.query("UPDATE product_public_sources SET feed_url='https://untrusted.example/'"),(e:unknown)=>(e as {code:string}).code==="42501");
      await audit.query("ROLLBACK");
    } finally {audit.release();}
  } finally {globalThis.fetch=dailyFetch;}
  const counts=(await db.query("SELECT COUNT(*)::int AS count FROM product_workspace_candidates")).rows;
  await db.query(workspaceSchemaSql);
  await db.query(workspaceRefreshSchemaSql);
  assert.deepEqual((await db.query("SELECT COUNT(*)::int AS count FROM product_workspace_candidates")).rows,counts);
  assert.deepEqual((await db.query("SELECT (SELECT COUNT(*) FROM raw_source_items)::int AS raw, (SELECT COUNT(*) FROM processed_items)::int AS processed")).rows,before);
  console.log("[workspace:rehearsal] Passed: independent scan orders/versions, shared fetches, RLS isolation, shared daily quota, colleague concurrency, resumable steps, no quota-date/source-address/member writes, idempotence and untouched legacy tables.");
} finally {
  await appDb?.end();
  await db?.end();
  admin.neon(["api",`/projects/${admin.project}/branches/${branch.id}`,"--method","DELETE"]);
  console.log("Disposable workspace rehearsal branch removed.");
}

if(mode==="--apply") {
  const db=admin.connect(admin.parentId);
  const client=await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(713492,2)");
    await client.query(workspaceSchemaSql);
    await client.query(workspaceRefreshSchemaSql);
    const owners=(await client.query(`SELECT a.id FROM product_accounts a JOIN product_username_logins u ON u.account_id=a.id
      JOIN product_account_preferences p ON p.account_id=a.id
      WHERE a.status='active' AND u.enabled AND u.interface_profile='norwegian' AND u.connection_name='MissionDesk-Daniel-Dev'
      AND u.display_name='Daniel' AND p.home_country='NO'`)).rows;
    if(owners.length!==1) throw new Error("Expected exactly one verified Daniel pilot account");
    const workspace=(await client.query(`INSERT INTO product_workspaces (id,slug,home_country,countries,enabled) VALUES ($1,'daniel-regional-pilot','NO',$2::jsonb,true)
      ON CONFLICT (slug) DO UPDATE SET countries=EXCLUDED.countries RETURNING id,home_country`,[randomUUID(),JSON.stringify(personalStations.NO.countries)])).rows[0];
    if(workspace.home_country!=="NO") throw new Error("Wrong workspace");
    await client.query("INSERT INTO product_workspace_members VALUES ($1,$2,'owner') ON CONFLICT DO NOTHING",[workspace.id,owners[0].id]);
    for(const s of workspaceSources) {
      await client.query(`INSERT INTO product_public_sources (id,name,feed_url,article_host,language,fetch_mode) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (id) DO UPDATE SET feed_url=EXCLUDED.feed_url,article_host=EXCLUDED.article_host,fetch_mode=EXCLUDED.fetch_mode`,[s.id,s.name,s.feedUrl,s.host,s.language,s.mode]);
      await client.query("INSERT INTO product_workspace_sources VALUES ($1,$2) ON CONFLICT DO NOTHING",[workspace.id,s.id]);
    }
    await evaluateWorkspace(client,{id:workspace.id,homeCountry:"NO",countries:personalStations.NO.countries});
    await client.query("COMMIT");
    console.log("[workspace:apply] Installed scoped refresh permissions, daily shared quota and all 33 non-premium subscriptions on the isolated Daniel pilot. No live scans, paid calls or legacy writes started.");
  } catch(e) {await client.query("ROLLBACK");throw e;} finally {client.release();await db.end();}
}
