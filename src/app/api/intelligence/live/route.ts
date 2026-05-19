import { NextResponse } from "next/server";
import { fetchLiveIntelligence } from "@/lib/ingestion/live-intelligence";
import { getSources } from "@/lib/sources/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const payload = await fetchLiveIntelligence(undefined, await getSources(), {
    enhanceWithAi: false,
  });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "s-maxage=900, stale-while-revalidate=1800",
    },
  });
}
