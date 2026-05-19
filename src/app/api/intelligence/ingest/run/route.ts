import { NextResponse } from "next/server";
import { runRawIngestionWorker } from "@/lib/ingestion/raw-source-worker";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    limit?: number;
    enqueueMissingJobs?: boolean;
    workerId?: string;
    concurrency?: number;
    limitPerSource?: number;
    preserveRawContent?: boolean;
    since?: string;
    sourceIds?: string[];
    sourceTypes?: Array<"news" | "government" | "institution" | "social" | "report" | "advisory" | "event" | "other">;
  };

  const result = await runRawIngestionWorker({
    limit: body.limit,
    enqueueMissingJobs: body.enqueueMissingJobs,
    workerId: body.workerId,
    concurrency: body.concurrency,
    limitPerSource: body.limitPerSource,
    preserveRawContent: body.preserveRawContent,
    since: body.since,
    sourceIds: body.sourceIds,
    sourceTypes: body.sourceTypes,
  });

  return NextResponse.json(result);
}
