import { NextResponse } from "next/server";
import { listRankedCandidates } from "@/lib/intelligence/repository";
import type { CandidateSelectionStatus } from "@/lib/intelligence/models";

export const dynamic = "force-dynamic";

const statuses: CandidateSelectionStatus[] = [
  "candidate",
  "selected",
  "deferred",
  "rejected",
  "regional_hold",
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const limitParam = Number(url.searchParams.get("limit") ?? 100);
  const status = statuses.includes(statusParam as CandidateSelectionStatus)
    ? (statusParam as CandidateSelectionStatus)
    : undefined;

  return NextResponse.json({
    candidates: listRankedCandidates({
      status,
      since: url.searchParams.get("since") ?? undefined,
      limit: Number.isFinite(limitParam) ? limitParam : 100,
    }),
  });
}
