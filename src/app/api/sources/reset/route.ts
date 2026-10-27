import { NextResponse } from "next/server";
import { legacyEngineBoundary } from "@/lib/product/api-boundary";
import { resetSources } from "@/lib/sources/store";

export async function POST() {
  const blocked = legacyEngineBoundary();
  if (blocked) return blocked;
  return NextResponse.json({ sources: await resetSources() });
}
