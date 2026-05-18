import { NextResponse } from "next/server";
import { rankAndStoreCandidates } from "@/lib/intelligence/ranking";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    since?: string;
    scanLimit?: number;
    targetMax?: number;
    hardCap?: number;
    allowRegionalAi?: boolean;
    enqueueAiJobs?: boolean;
  };

  const result = await rankAndStoreCandidates({
    since: body.since,
    scanLimit: body.scanLimit,
    targetMax: body.targetMax,
    hardCap: body.hardCap,
    allowRegionalAi: body.allowRegionalAi,
    enqueueAiJobs: body.enqueueAiJobs,
  });

  return NextResponse.json(result);
}
