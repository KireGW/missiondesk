import { NextResponse } from "next/server";
import { rankAndStoreCandidates } from "@/lib/intelligence/ranking";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    since?: string;
    scanLimit?: number;
    targetMin?: number;
    targetMax?: number;
    hardCap?: number;
    nationalOnly?: boolean;
    allowRegionalAi?: boolean;
    enqueueAiJobs?: boolean;
    minSelectedScore?: number;
    minCandidateScore?: number;
  };

  const result = await rankAndStoreCandidates({
    since: body.since,
    scanLimit: body.scanLimit,
    targetMin: body.targetMin,
    targetMax: body.targetMax,
    hardCap: body.hardCap,
    nationalOnly: body.nationalOnly,
    allowRegionalAi: body.allowRegionalAi,
    enqueueAiJobs: body.enqueueAiJobs,
    minSelectedScore: body.minSelectedScore,
    minCandidateScore: body.minCandidateScore,
  });

  return NextResponse.json(result);
}
