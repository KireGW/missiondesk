import { NextResponse } from "next/server";
import { enqueueRawIngestionJobs } from "@/lib/ingestion/raw-source-ingestion";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    sourceIds?: string[];
    sourceTypes?: Array<
      "news" | "government" | "institution" | "social" | "report" | "advisory" | "event" | "other"
    >;
    limitPerSource?: number;
    preserveRawContent?: boolean;
    since?: string;
  };

  const jobs = enqueueRawIngestionJobs({
    sourceIds: body.sourceIds,
    sourceTypes: body.sourceTypes,
    limitPerSource: body.limitPerSource,
    preserveRawContent: body.preserveRawContent,
    since: body.since,
  });

  return NextResponse.json({
    enqueuedCount: jobs.length,
    jobs,
  });
}
