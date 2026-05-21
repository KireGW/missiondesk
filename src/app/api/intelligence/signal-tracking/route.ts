import { NextResponse } from "next/server";
import { searchSignalsAcrossSources } from "@/lib/intelligence/signal-tracking";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      query?: string;
      limit?: number;
      mode?: "local" | "deep";
      aiEnabled?: boolean;
      deepSearchOptions?: {
        includeWebRss?: boolean;
        includeSocialX?: boolean;
      };
    };
    const query = body.query?.trim() ?? "";

    if (query.length < 2) {
      return NextResponse.json(
        { error: "Sökningen behöver innehålla minst två tecken." },
        { status: 400 },
      );
    }

    const result = await searchSignalsAcrossSources({
      query,
      limit: body.limit ?? 50,
      mode: body.mode ?? "local",
      aiEnabled: body.aiEnabled ?? false,
      deepSearchOptions: {
        includeWebRss: body.deepSearchOptions?.includeWebRss ?? true,
        includeSocialX: body.deepSearchOptions?.includeSocialX ?? false,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Signalspårningen kunde inte genomföras.",
      },
      { status: 500 },
    );
  }
}
