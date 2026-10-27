import { NextResponse } from "next/server";
import { legacyEngineBoundary } from "@/lib/product/api-boundary";
import {
  ensureFirstRunIngestionJob,
  startFirstRunWorkerInBackground,
} from "@/lib/intelligence/first-run";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blocked = legacyEngineBoundary();
  if (blocked) return blocked;
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };
  const status = await ensureFirstRunIngestionJob({ force: body.force ?? false });

  if (status.active && !status.missingApiKey && !status.missingSources) {
    setTimeout(() => {
      startFirstRunWorkerInBackground();
    }, 0);
  }

  return NextResponse.json(status);
}
