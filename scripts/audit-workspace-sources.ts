import { mkdirSync, writeFileSync } from "node:fs";
import { load } from "cheerio";
import { workspaceSources } from "../src/lib/product/workspace-pilot-sources";
import { fetchPilotFeed, fetchPublicText, referencePageHash } from "../src/lib/product/workspace-ingestion";
import { sourcePlainText } from "../src/lib/product/source-text";

const args=process.argv.slice(2);
if(args.length>1 || (args[0] && !args[0].startsWith("--ids="))) throw new Error("Use no arguments or --ids=id1,id2");
const ids=args[0]?.slice(6).split(",");
if(ids?.some(id=>!workspaceSources.some(source=>source.id===id))) throw new Error("Only configured non-premium sources may be audited");
const sources=workspaceSources.filter(source=>!ids || ids.includes(source.id));
const day=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const path=`reports/source-audit-${day}-${Date.now()}.json`;
const report: {checkedAt:string;readOnly:boolean;sources:Record<string,unknown>[]}={checkedAt:new Date().toISOString(),readOnly:true,sources:[]};
mkdirSync("reports",{recursive:true});
for(const source of sources) {
  const result:Record<string,unknown>={id:source.id,name:source.name,mode:source.mode,url:source.feedUrl};
  try {
    if(source.mode==="rss") {
      const feed=await fetchPilotFeed(source);
      const dates=feed.items.flatMap(item=>item.publishedAt?[item.publishedAt]:[]).sort();
      Object.assign(result,{reachable:true,articles:feed.items.length,truncated:feed.truncated,rejected:feed.rejected,
        references:feed.items.filter(item=>item.contentKind==="reference").length,
        futureDates:dates.filter(date=>Date.parse(date)>Date.now()+300000).length,
        undated:feed.items.length-dates.length,newest:dates.at(-1),oldest:dates[0]});
    } else {
      // A paused source is fetched once for diagnosis, never enabled or passed to a scan worker.
      const html=await fetchPublicText({...source,mode:"page"});
      const $=load(html);
      const feeds=$("link[rel~='alternate']").toArray().flatMap(element=>{
        const type=$(element).attr("type")??"";
        if(!/application\/(rss\+xml|atom\+xml)/i.test(type)) return [];
        try {
          const url=new URL($(element).attr("href")??"",source.feedUrl);
          return url.protocol==="https:" && url.hostname===new URL(source.feedUrl).hostname && !url.username && !url.password && !url.port ? [url.toString()] : [];
        } catch {return [];}
      });
      Object.assign(result,{reachable:true,title:sourcePlainText($("title").text()).slice(0,150),contentHash:referencePageHash(html),
        publishedFeedLinks:[...new Set(feeds)].slice(0,5),newsExtractionVerified:false});
    }
  } catch(error) {Object.assign(result,{reachable:false,error:error instanceof Error ? error.message : "Unavailable"});}
  report.sources.push(result);
  writeFileSync(path,JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(result));
}
console.log(JSON.stringify({report:path,checked:report.sources.length,reachable:report.sources.filter(source=>source.reachable).length,
  failed:report.sources.filter(source=>!source.reachable).length,paidCalls:0,databaseWrites:0}));
