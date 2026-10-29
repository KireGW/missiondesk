import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Pool, PoolClient } from "pg";
import { load } from "cheerio";
import { digest, evaluateCandidate, publicCandidate, workspacePolicyKey, type WorkspacePolicy } from "@/lib/product/workspace-candidates";
import { workspaceSources, type WorkspaceSource } from "@/lib/product/workspace-pilot-sources";
import { sourcePlainText } from "@/lib/product/source-text";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (value && typeof value === "object") return text((value as Record<string, unknown>)["#text"]);
  return "";
}
export function parsePilotFeed(xml: string, source: { id: string; feedUrl: string; host: string; articleHosts?: readonly string[]; newsPathPrefix?: string }) {
  if (XMLValidator.validate(xml) !== true) throw new Error("Invalid or unsafe XML");
  // Literal HTML declarations inside valid CDATA/comments are not XML declarations.
  const declarations=xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->/g,"");
  if (/<!DOCTYPE|<!ENTITY/i.test(declarations)) throw new Error("Invalid or unsafe XML");
  const parsed = parser.parse(xml);
  const entries = parsed.rss?.channel?.item ?? parsed.feed?.entry;
  if (!entries) throw new Error("Not an RSS/Atom feed, or feed is empty");
  const all = Array.isArray(entries) ? entries : [entries];
  const items = [];
  let rejected = 0;
  for (const entry of all.slice(0, 20)) {
    try {
      const links = Array.isArray(entry.link) ? entry.link : [entry.link];
      const link = links.find((link: unknown) => typeof link === "string" || (link && typeof link === "object" && (!('@_rel' in link) || link['@_rel'] === 'alternate')));
      const url = typeof link === "string" ? link : link?.["@_href"] ?? text(link);
      if (!url) throw new Error("Missing article link");
      const articleUrl = new URL(url, source.feedUrl);
      items.push(publicCandidate({ sourceId: source.id, url: articleUrl.toString(), title: text(entry.title),
        contentKind: source.newsPathPrefix && !articleUrl.pathname.startsWith(source.newsPathPrefix) ? "reference" : "news",
        excerpt: text(entry.description ?? entry.summary), publishedAt: text(entry.pubDate ?? entry.published ?? entry["dc:date"]) || null }, source.articleHosts ?? source.host));
    } catch { rejected++; }
  }
  if (!items.length) throw new Error("No valid articles on the approved host");
  return { items, truncated: all.length > 20, rejected };
}
export async function fetchPublicText(source: WorkspaceSource) {
  if (source.mode === "paused") throw new Error("Source is paused");
  let url = new URL(source.feedUrl);
  const signal = AbortSignal.timeout(15_000);
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 2; redirects++) {
    response = await fetch(url.toString(), { redirect: "manual", signal, cache: "no-store",
      headers: { Accept: source.mode === "rss" ? "application/rss+xml, application/atom+xml, application/xml, text/xml" : "text/html", "User-Agent": "MissionDesk/0.1 public source monitor" } });
    if (![301,302,303,307,308].includes(response.status)) break;
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location || redirects === 2) throw new Error("Unresolved redirect");
    const next = new URL(location, url);
    if (next.protocol !== "https:" || next.hostname !== url.hostname || next.username || next.password || next.port) throw new Error("Cross-host redirect denied");
    url = next;
  }
  if (!response?.ok) throw new Error(`Source HTTP ${response?.status}`);
  if (source.mode === "page" && !response.headers.get("content-type")?.includes("text/html")) throw new Error("Not a public HTML page");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 2_000_000) { await reader.cancel(); throw new Error("Feed exceeds 2 MB limit"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}
export async function fetchPilotFeed(source: WorkspaceSource) {
  if (source.mode !== "rss") throw new Error("Not a news feed");
  return parsePilotFeed(await fetchPublicText(source), source);
}
export function referencePageHash(html: string) {
  const $ = load(html);
  if (/just a moment|access denied|attention required|security check/i.test($("title").text())) throw new Error("Source requires manual access");
  $("script,style,nav,header,footer,form,noscript,iframe").remove();
  const main = $("main,[role='main']").first();
  const content = sourcePlainText((main.length ? main : $("body")).text());
  if (content.length < 80) throw new Error("No reliable reference content");
  return digest(content);
}
export async function evaluateWorkspace(db: PoolClient, policy: WorkspacePolicy, sourceId?: string) {
  const result = await db.query(`SELECT a.* FROM product_public_articles a JOIN product_workspace_sources s ON s.source_id = a.source_id
    WHERE s.workspace_id = $1 AND a.fetched_at > now() - interval '7 days' AND ($2::text IS NULL OR a.source_id=$2)`, [policy.id, sourceId ?? null]);
  const counts = { selected: 0, held: 0, rejected: 0 };
  const evaluatedAt=Date.now();
  const decisions = result.rows.map(row => {
    const decision = evaluateCandidate({ id: row.id, sourceId: row.source_id, url: row.url, title: row.title, excerpt: row.excerpt,
      publishedAt: row.published_at?.toISOString() ?? null, contentHash: row.content_hash, countries: row.countries, contentKind: row.content_kind }, policy,evaluatedAt);
    counts[decision.status]++;
    return { workspace_id: policy.id, article_id: row.id, content_hash: row.content_hash, policy_key: workspacePolicyKey(policy), ...decision };
  });
  if (decisions.length) await db.query(`INSERT INTO product_workspace_candidates (workspace_id,article_id,content_hash,policy_key,status,score,reason)
    SELECT workspace_id,article_id,content_hash,policy_key,status,score,reason FROM jsonb_to_recordset($1::jsonb)
      AS d(workspace_id uuid,article_id text,content_hash text,policy_key text,status text,score integer,reason text)
    ON CONFLICT (workspace_id,article_id,content_hash,policy_key) DO UPDATE SET status=EXCLUDED.status,score=EXCLUDED.score,reason=EXCLUDED.reason,evaluated_at=now()`,[JSON.stringify(decisions)]);
  return counts;
}
export interface SourceScanReport { source: string; reused?: boolean; stored?: number; truncated?: boolean; rejected?: number; monitored?: boolean; busy?: boolean; skipped?: boolean; error?: string }
// Caller owns the transaction and trusted account context. Source configuration is never client input.
export async function scanPublicSource(client: PoolClient, source: WorkspaceSource): Promise<SourceScanReport> {
  await client.query("SAVEPOINT source_attempt");
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,71294))",[source.id]);
    const state=(await client.query("SELECT last_success_at,last_content_hash,fetch_mode FROM product_public_sources WHERE id=$1",[source.id])).rows[0];
    if (!state) throw new Error("Source is not subscribed");
    if (state.fetch_mode!==source.mode || state.fetch_mode==="paused") throw new Error("Source mode is not enabled");
    if (state.last_success_at && Date.now()-state.last_success_at.getTime()<900_000) return {source:source.id,reused:true};
    if (source.mode === "page") {
      const hash=referencePageHash(await fetchPublicText(source));
      await client.query(`UPDATE product_public_sources SET last_success_at=now(),last_attempt_at=now(),last_error=NULL,truncated=false,
        changed_at=CASE WHEN last_content_hash IS NOT NULL AND last_content_hash<>$2 THEN now() ELSE changed_at END,last_content_hash=$2 WHERE id=$1`,[source.id,hash]);
      return {source:source.id,monitored:true};
    }
    const feed=await fetchPilotFeed(source);
    await client.query(`INSERT INTO product_public_articles (id,source_id,url,title,excerpt,published_at,content_hash,countries,content_kind)
      SELECT id,"sourceId",url,title,excerpt,"publishedAt","contentHash",countries,"contentKind" FROM jsonb_to_recordset($1::jsonb)
        AS a(id text,"sourceId" text,url text,title text,excerpt text,"publishedAt" timestamptz,"contentHash" text,countries jsonb,"contentKind" text)
      ON CONFLICT (source_id,url) DO UPDATE SET title=EXCLUDED.title,excerpt=EXCLUDED.excerpt,published_at=EXCLUDED.published_at,
        content_hash=EXCLUDED.content_hash,countries=EXCLUDED.countries,content_kind=EXCLUDED.content_kind,fetched_at=now()`,[JSON.stringify(feed.items)]);
    await client.query("UPDATE product_public_sources SET last_success_at=now(),last_attempt_at=now(),last_error=NULL,truncated=$2 WHERE id=$1",[source.id,feed.truncated]);
    return {source:source.id,stored:feed.items.length,truncated:feed.truncated,rejected:feed.rejected};
  } catch(error) {
    await client.query("ROLLBACK TO SAVEPOINT source_attempt");
    if ((error as {code?:string}).code === "55P03") return {source:source.id,busy:true};
    const message=error instanceof Error?error.message:"Source unavailable";
    await client.query("UPDATE product_public_sources SET last_attempt_at=now(),last_error=$2 WHERE id=$1",[source.id,message.slice(0,200)]);
    return {source:source.id,error:message};
  }
}
export async function scanWorkspace(db: Pool, policy: WorkspacePolicy) {
  const client = await db.connect();
  const report = [];
  try {
    const allowed = await client.query("SELECT source_id FROM product_workspace_sources WHERE workspace_id = $1", [policy.id]);
    for (const row of allowed.rows) {
      const source = workspaceSources.find((candidate) => candidate.id === row.source_id);
      if (!source || source.mode === "paused") continue;
      await client.query("BEGIN");
      try {
        report.push(await scanPublicSource(client,source));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        const message = error instanceof Error ? error.message : "Feed unavailable";
        await client.query("UPDATE product_public_sources SET last_attempt_at=now(), last_error=$2 WHERE id=$1", [source.id,message.slice(0,200)]);
        report.push({ source: source.id, error: message });
      }
    }
    // Always evaluate this workspace, including when another workspace already fetched the feed.
    const counts = await evaluateWorkspace(client, policy);
    return { report, ...counts };
  } finally { client.release(); }
}
