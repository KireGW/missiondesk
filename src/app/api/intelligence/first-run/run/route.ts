import { NextResponse } from "next/server";
import { runFirstRunIngestionWorker } from "@/lib/intelligence/first-run";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { limit?: number };
  const result = await runFirstRunIngestionWorker(body.limit ?? 1);
  return NextResponse.json(result);
}
