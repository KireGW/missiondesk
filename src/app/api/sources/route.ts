import { NextResponse } from "next/server";
import { getSources, saveSources, sourceIdFromName } from "@/lib/sources/store";
import type { IntelligenceCategory, SourceDefinition, SourceType } from "@/lib/types";

const allowedTypes: SourceType[] = ["rss", "website", "social", "structured_scrape", "api", "calendar"];

function normalizeCategories(value: unknown): IntelligenceCategory[] {
  if (!Array.isArray(value)) return ["domestic_politics"];
  return value.filter((item): item is IntelligenceCategory => typeof item === "string");
}

export async function GET() {
  return NextResponse.json({ sources: await getSources() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<SourceDefinition>;
  const sources = await getSources();
  const id = body.id || sourceIdFromName(body.name ?? "");

  if (!id || !body.name || !body.url) {
    return NextResponse.json(
      { error: "name, url and a valid id are required" },
      { status: 400 },
    );
  }

  if (sources.some((source) => source.id === id)) {
    return NextResponse.json({ error: "source id already exists" }, { status: 409 });
  }

  const source: SourceDefinition = {
    id,
    name: body.name,
    country: body.country || "Okänt",
    language: body.language || "es",
    type: allowedTypes.includes(body.type as SourceType) ? (body.type as SourceType) : "rss",
    url: body.url,
    trustTier: body.trustTier ?? 2,
    categories: normalizeCategories(body.categories),
    enabled: body.enabled ?? true,
    notes: body.notes,
  };

  const nextSources = [source, ...sources];
  const savedSources = await saveSources(nextSources);
  const savedSource = savedSources.find((item) => item.id === source.id) ?? source;

  return NextResponse.json({ source: savedSource, sources: savedSources }, { status: 201 });
}
