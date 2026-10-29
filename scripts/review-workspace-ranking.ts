import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { readPersonalTestEnvironment } from "./personal-test-env.mjs";
import { evaluateCandidate, workspacePolicyKey, type PublicCandidate, type WorkspacePolicy } from "../src/lib/product/workspace-candidates";
import { assessWorkspaceText, workspaceRank, workspaceRankSql } from "../src/lib/product/workspace-assessment";
import { evaluateWorkspace } from "../src/lib/product/workspace-ingestion";
import { personalRelevanceLevel } from "../src/lib/product/profiles";

const mode=process.argv[2];
if(process.argv.length!==3||!["--sample","--apply"].includes(mode)) throw new Error("Use --sample or --apply");
const {values}=readPersonalTestEnvironment(process.cwd(),{requireAuth:false});
assert.equal(values.MISSIONDESK_TEST_BRANCH_ID,"br-rapid-butterfly-aq74crs8");
const url=new URL(values.DATABASE_URL);
assert.equal(url.username,"missiondesk_personal_app");
url.searchParams.set("sslmode","verify-full");
const db=new Pool({connectionString:url.toString(),max:1,connectionTimeoutMillis:10000});
const previousFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error("Ranking review must not fetch sources or use paid APIs");};
let client: PoolClient | undefined;
try {
  client=await db.connect();
  await client.query(mode==="--sample"?"BEGIN READ ONLY":"BEGIN ISOLATION LEVEL REPEATABLE READ");
  await client.query("SET LOCAL statement_timeout='15s'");
  const subject=`${values.AUTH0_DOMAIN.toLowerCase()}|${values.MISSIONDESK_DANIEL_AUTH0_USER_ID}`;
  const accounts=(await client.query("SELECT id FROM product_accounts WHERE auth_subject=$1 AND status='active'",[subject])).rows;
  assert.equal(accounts.length,1);
  await client.query("SELECT set_config('missiondesk.account_id',$1,true)",[accounts[0].id]);
  const workspaces=(await client.query(`SELECT w.id,w.home_country,w.countries FROM product_workspaces w JOIN product_workspace_members m ON m.workspace_id=w.id
    WHERE m.account_id=$1 AND w.enabled`,[accounts[0].id])).rows;
  assert.equal(workspaces.length,1);
  assert.equal(workspaces[0].home_country,"NO");
  const w=workspaces[0];
  const policy: WorkspacePolicy={id:w.id,homeCountry:w.home_country,countries:w.countries};
  const key=workspacePolicyKey(policy),oldKey=key.replace("public-rules-v3:","public-rules-v2:");
  const rows=(await client.query(`SELECT a.*,c.score AS previous_score,c.status AS previous_status FROM product_public_articles a
    JOIN product_workspace_sources s ON s.source_id=a.source_id AND s.workspace_id=$1
    LEFT JOIN product_workspace_candidates c ON c.workspace_id=$1 AND c.article_id=a.id AND c.content_hash=a.content_hash AND c.policy_key=$2
    WHERE a.fetched_at>now()-interval '7 days' ORDER BY a.published_at DESC NULLS LAST,a.id LIMIT 2000`,[w.id,oldKey])).rows;
  assert.ok(rows.length>0&&rows.length<2000,"Review must cover a bounded, complete pilot window");
  const now=Date.now();
  const rankingFixtures=Array.from({length:31},(_,i)=>({id:`fixture-${String(i).padStart(2,"0")}`,score:i===30?88:49,published_at:new Date(now-(i===30?2*86400000:i*1000)).toISOString()}));
  const ranked=(await client.query(`SELECT a.id FROM jsonb_to_recordset($1::jsonb) AS a(id text,published_at timestamptz)
    JOIN jsonb_to_recordset($1::jsonb) AS c(id text,score integer) ON c.id=a.id
    ORDER BY ${workspaceRankSql} DESC,a.published_at DESC,a.id LIMIT 30`,[JSON.stringify(rankingFixtures)])).rows;
  assert.equal(ranked[0].id,"fixture-30","Actual PostgreSQL ordering must keep an important older story before LIMIT 30");
  const assessed=rows.map(row=>{
    const article: PublicCandidate={id:row.id,sourceId:row.source_id,url:row.url,title:row.title,excerpt:row.excerpt,
      publishedAt:row.published_at?.toISOString()??null,contentHash:row.content_hash,countries:row.countries,contentKind:row.content_kind};
    const decision=evaluateCandidate(article,policy,now);
    const details=assessWorkspaceText(article.title,article.excerpt,policy);
    return {articleId:article.id,sourceId:article.sourceId,title:article.title,excerpt:article.excerpt,publishedAt:article.publishedAt,
      previousScore:row.previous_score,previousStatus:row.previous_status,...decision,category:details.category,classified:details.classified,
      evidence:details.evidence,level:personalRelevanceLevel(decision.score),rank:article.publishedAt?workspaceRank(decision.score,article.publishedAt,now):null};
  });
  const groups=new Map<string,typeof assessed>();
  for(const entry of assessed) {const bucket=groups.get(entry.sourceId)??[];bucket.push(entry);groups.set(entry.sourceId,bucket);}
  const sample: typeof assessed=[];
  for(let offset=0;sample.length<40&&offset<assessed.length;offset++)
    for(const entries of groups.values()) if(entries[offset]&&sample.length<40)sample.push(entries[offset]);
  const before=(await client.query("SELECT count(*)::int AS count FROM product_workspace_candidates WHERE workspace_id=$1 AND policy_key=$2",[w.id,oldKey])).rows[0].count;
  let applied: unknown=null;
  if(mode==="--apply") {
    applied=await evaluateWorkspace(client,policy);
    assert.equal((await client.query("SELECT count(*)::int AS count FROM product_workspace_candidates WHERE workspace_id=$1 AND policy_key=$2",[w.id,oldKey])).rows[0].count,before,"Previous policy history must remain intact");
  }
  await client.query("COMMIT");
  const groupCounts=(key:"category"|"level"|"status")=>{
    const value=(a:typeof assessed[number])=>key==="category"&&!a.classified?"unclassified":a[key];
    return Object.fromEntries([...new Set(assessed.map(value))].map(label=>[label,assessed.filter(a=>value(a)===label).length]));
  };
  const selected=assessed.filter(a=>a.status==="selected").sort((a,b)=>(b.rank??-Infinity)-(a.rank??-Infinity)||Date.parse(b.publishedAt??"")-Date.parse(a.publishedAt??"")||a.articleId.localeCompare(b.articleId)).slice(0,30);
  const report={createdAt:new Date().toISOString(),mode,version:key,assessed:assessed.length,categoryCounts:groupCounts("category"),levels:groupCounts("level"),statuses:groupCounts("status"),postgresRankingVerified:true,applied,previousDecisionsPreserved:before,sample,selected};
  mkdirSync("reports",{recursive:true});
  const path=`reports/workspace-ranking-${Date.now()}.json`;
  writeFileSync(path,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify({report:path,mode,assessed:assessed.length,sample:sample.length,categoryCounts:report.categoryCounts,levels:report.levels,statuses:report.statuses,applied,paidCalls:0,sourceFetches:0}));
} catch {
  await client?.query("ROLLBACK").catch(()=>{});
  console.error("Ranking operation could not be completed; private details withheld");process.exitCode=1;
} finally {globalThis.fetch=previousFetch;client?.release();await db.end();}
