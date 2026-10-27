import { NextResponse } from "next/server";
import { legacyEngineBoundary } from "@/lib/product/api-boundary";
import { getFirstRunStatus } from "@/lib/intelligence/first-run";

export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = legacyEngineBoundary();
  if (blocked) return blocked;
  return NextResponse.json(await getFirstRunStatus());
}
