import nextEnv from "@next/env";
import pg from "pg";
import { sourceWithAuditMetadata } from "../src/lib/sources/audit";
import { defaultSources } from "../src/lib/sources/default-sources";
import { fetchRssSource } from "../src/lib/ingestion/rss";
import { fetchWebsiteSource } from "../src/lib/ingestion/website";
import type { SourceDefinition } from "../src/lib/types";

nextEnv.loadEnvConfig(process.cwd());

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL?.replace("sslmode=require", "sslmode=verify-full") });
  const apply = process.argv.includes("--apply");
  const paused = new Map([
    ["ap-mexico", "HTTP 403; åtkomst blockerad"],
    ["imf-mexico", "HTTP 403; åtkomst blockerad"],
    ["svd-utrikes", "HTTP 404; ny verifierad nyhetsadress behövs"],
    ["diario-oficial-federacion", "Upprepade anslutningsfel/timeouter; kontrollera manuellt"],
    ["scjn-mexico", "Pressindex fungerar, men artiklar på separat underdomän kräver en verifierad adapter"],
  ]);
  try {
    await client.connect();
    const rows = (await client.query("SELECT id,data FROM source_definitions WHERE id=ANY($1::text[])", [["milenio-rss", "aristegui-noticias-rss", ...paused.keys()]])).rows;
    const changes: SourceDefinition[] = [];
    for (const row of rows) {
      const source: SourceDefinition = { ...(typeof row.data === "string" ? JSON.parse(row.data) : row.data), id: row.id };
      const reason = paused.get(source.id);
      if (reason) {
        source.enabled = false;
        const note = `Kontroll 2026-10-27: pausad. ${reason}. Källan finns kvar för manuell kontroll.`;
        if (!source.notes?.includes(note)) source.notes = [source.notes, note].filter(Boolean).join("\n");
      } else {
        const configured = defaultSources.find((candidate) => candidate.id === source.id)!;
        Object.assign(source, { url: configured.url, type: configured.type, retrieval: configured.retrieval,
          retrievalMethod: configured.retrievalMethod, rssUrl: configured.rssUrl, websiteUrl: configured.websiteUrl });
        const options = { limit: 2, signal: AbortSignal.timeout(25_000) };
        const documents = configured.retrievalMethod === "rss" ? await fetchRssSource(source, options)
          : (await fetchWebsiteSource(source, options)).documents;
        if (documents.length === 0) throw new Error(`Repaired source still has no documents: ${source.id}`);
        source.notes = [source.notes, "Kontroll 2026-10-27: hämtadressen rättad och verifierad."].filter(Boolean).join("\n");
      }
      changes.push(sourceWithAuditMetadata(source));
    }
    console.log(JSON.stringify({ apply, changes: changes.map((s) => ({ id: s.id, enabled: s.enabled, url: s.url, method: s.retrievalMethod })) }, null, 2));
    if (apply) {
      await client.query("BEGIN");
      for (const source of changes) await client.query("UPDATE source_definitions SET data=$2::jsonb, updated_at=now()::text WHERE id=$1", [source.id, JSON.stringify(source)]);
      await client.query("COMMIT");
    }
  } finally { await client.end(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
