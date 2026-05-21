import { NextResponse } from "next/server";
import { getSources, saveSources } from "@/lib/sources/store";
import type { SourceDefinition } from "@/lib/types";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const patch = (await request.json()) as Partial<SourceDefinition>;
  const sources = await getSources();
  const index = sources.findIndex((source) => source.id === id);

  if (index === -1) {
    return NextResponse.json({ error: "source not found" }, { status: 404 });
  }

  const nextSources = [...sources];
  nextSources[index] = { ...nextSources[index], ...patch, id };
  const savedSources = await saveSources(nextSources);
  const savedSource = savedSources.find((source) => source.id === id) ?? savedSources[index];

  return NextResponse.json({ source: savedSource, sources: savedSources });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const sources = await getSources();
  const nextSources = sources.filter((source) => source.id !== id);

  if (nextSources.length === sources.length) {
    return NextResponse.json({ error: "source not found" }, { status: 404 });
  }

  const savedSources = await saveSources(nextSources);
  return NextResponse.json({ sources: savedSources });
}
