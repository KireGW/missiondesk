import { NextResponse } from "next/server";
import { resetSources } from "@/lib/sources/store";

export async function POST() {
  return NextResponse.json({ sources: await resetSources() });
}
