import { NextResponse } from "next/server";
import { getFirstRunStatus } from "@/lib/intelligence/first-run";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getFirstRunStatus());
}
