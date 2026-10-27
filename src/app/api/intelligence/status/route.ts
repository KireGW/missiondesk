import { NextResponse } from "next/server";
import { legacyEngineBoundary } from "@/lib/product/api-boundary";
import { getDashboardUpdateStatus } from "@/lib/intelligence/dashboard-status-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = legacyEngineBoundary();
  if (blocked) return blocked;
  return NextResponse.json(await getDashboardUpdateStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}
