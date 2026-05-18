import { NextResponse } from "next/server";
import { processRegionalIntelligenceOnDemand } from "@/lib/intelligence/regional-processing";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const regionId = url.searchParams.get("region")?.trim();
  const force = url.searchParams.get("force") === "1";
  const limit = Number(url.searchParams.get("limit") ?? 8);

  if (!regionId) {
    return NextResponse.json(
      { error: "Missing required query parameter: region" },
      { status: 400 },
    );
  }

  try {
    const result = await processRegionalIntelligenceOnDemand({
      regionId,
      force,
      limit: Number.isFinite(limit) ? limit : 8,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Regional intelligence processing failed",
      },
      { status: 500 },
    );
  }
}
